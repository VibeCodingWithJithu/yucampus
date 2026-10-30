-- Tenant isolation (CLAUDE.md rule 2).
--
-- Two database roles:
--   * the owner role runs migrations and seeds and is NOT subject to row-level security;
--   * yucampus_app is what the API connects as at runtime. It only sees rows of the college named by the
--     transaction-local setting app.college_id, which the API sets with
--     SELECT set_config('app.college_id', '<uuid>', true) at the start of every request transaction.
--
-- When a later migration adds a tenant-owned table it must enable the same policy and grant access.
-- test/tenant-isolation.test.ts fails if a table with college_id has no policy.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'yucampus_app') THEN
    -- Created without a password. Local dev sets one in infra/postgres/init.sql; production sets it out of band.
    CREATE ROLE yucampus_app NOLOGIN;
  END IF;
END
$$;

-- The current request's college, or NULL when none is set (then no tenant row is visible).
CREATE FUNCTION app_college_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.college_id', true), '')::uuid $$;

-- Sign-in needs to turn a subdomain into a college id before any tenant is set. This is the only way the
-- app role can look outside its own tenant, and it returns nothing but the id.
CREATE FUNCTION resolve_college_id(p_subdomain text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$ SELECT id FROM colleges WHERE subdomain = lower(p_subdomain) $$;

REVOKE ALL ON FUNCTION resolve_college_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_college_id(text) TO yucampus_app;

-- Privileges ---------------------------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO yucampus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO yucampus_app;

-- Rules are configuration managed by the Yubhian team: colleges can read them, never change them.
REVOKE INSERT, UPDATE, DELETE ON frameworks, criteria, metrics, report_templates, task_templates FROM yucampus_app;

-- Colleges are created and removed by super admins only.
REVOKE INSERT, DELETE ON colleges FROM yucampus_app;

-- The audit log is append-only.
REVOKE UPDATE, DELETE ON audit_logs FROM yucampus_app;

DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON _prisma_migrations FROM yucampus_app;
  END IF;
END
$$;

-- Policies -----------------------------------------------------------------------------------------------

ALTER TABLE colleges ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON colleges
  USING (id = (SELECT app_college_id()))
  WITH CHECK (id = (SELECT app_college_id()));

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'college_id'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (college_id = (SELECT app_college_id())) WITH CHECK (college_id = (SELECT app_college_id()))',
      t
    );
  END LOOP;
END
$$;

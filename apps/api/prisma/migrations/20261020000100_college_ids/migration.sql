-- Background jobs (reminders, email summaries) visit every college in turn. The app role cannot list colleges
-- (row-level security), so this returns only their ids; each college's data is then read under its own tenant.
CREATE FUNCTION college_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$ SELECT id FROM colleges ORDER BY created_at $$;

REVOKE ALL ON FUNCTION college_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION college_ids() TO yucampus_app;

-- Sign-in: one-time codes, refresh tokens, and a lock after repeated wrong passwords.

ALTER TABLE "users"
  ADD COLUMN "failed_logins" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMPTZ;

CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "mobile" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "otp_codes_college_id_mobile_created_at_idx" ON "otp_codes"("college_id", "mobile", "created_at");
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE INDEX "refresh_tokens_college_id_user_id_idx" ON "refresh_tokens"("college_id", "user_id");

ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every later migration that adds a tenant-owned table calls this once per table:
--   SELECT enable_tenant_isolation('my_table');
CREATE FUNCTION enable_tenant_isolation(p_table regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s USING (college_id = (SELECT app_college_id())) WITH CHECK (college_id = (SELECT app_college_id()))',
    p_table
  );
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO yucampus_app', p_table);
END
$$;

SELECT enable_tenant_isolation('otp_codes');
SELECT enable_tenant_isolation('refresh_tokens');

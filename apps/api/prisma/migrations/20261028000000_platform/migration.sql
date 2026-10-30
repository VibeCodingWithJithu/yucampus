-- Platform panel for the YuCampus team, and college suspension (decided 2026-10-18).
-- Platform tables are global: no college_id and no row-level security. Only the platform module uses them.

-- CreateEnum
CREATE TYPE "college_status" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "platform_admin_status" AS ENUM ('active', 'invited', 'disabled');

-- AlterTable
ALTER TABLE "colleges" ADD COLUMN "status" "college_status" NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT,
    "status" "platform_admin_status" NOT NULL DEFAULT 'invited',
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "last_sign_in_at" TIMESTAMPTZ,
    "invited_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_password_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_password_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID,
    "action" TEXT NOT NULL,
    "about_college_id" UUID,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "platform_refresh_tokens_token_hash_key" ON "platform_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "platform_refresh_tokens_admin_id_idx" ON "platform_refresh_tokens"("admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_password_links_token_hash_key" ON "platform_password_links"("token_hash");

-- CreateIndex
CREATE INDEX "platform_password_links_admin_id_idx" ON "platform_password_links"("admin_id");

-- CreateIndex
CREATE INDEX "platform_audit_logs_at_idx" ON "platform_audit_logs"("at");

-- AddForeignKey
ALTER TABLE "platform_refresh_tokens" ADD CONSTRAINT "platform_refresh_tokens_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_password_links" ADD CONSTRAINT "platform_password_links_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Privileges ---------------------------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON platform_admins TO yucampus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_refresh_tokens TO yucampus_app;
GRANT SELECT, INSERT, UPDATE ON platform_password_links TO yucampus_app;
-- Append-only, like the college audit log.
GRANT SELECT, INSERT ON platform_audit_logs TO yucampus_app;

-- INSERT on colleges stays revoked for the app role. The platform adds a college through this function only.
CREATE FUNCTION create_college(p_name text, p_type college_type, p_subdomain text, p_state text, p_plan text) RETURNS uuid
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public
  AS $$
    INSERT INTO colleges (name, type, subdomain, state, plan, updated_at)
    VALUES (p_name, p_type, lower(p_subdomain), p_state, p_plan, now())
    RETURNING id
  $$;

REVOKE ALL ON FUNCTION create_college(text, college_type, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_college(text, college_type, text, text, text) TO yucampus_app;

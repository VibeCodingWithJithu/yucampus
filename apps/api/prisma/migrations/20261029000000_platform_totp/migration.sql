-- Two-step sign-in for the YuCampus team (decided 2026-10-21): authenticator-app secret and recovery codes.

-- AlterTable
ALTER TABLE "platform_admins" ADD COLUMN "totp_secret" TEXT,
ADD COLUMN "totp_confirmed_at" TIMESTAMPTZ,
ADD COLUMN "totp_last_step" INTEGER;

-- CreateTable
CREATE TABLE "platform_recovery_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ,

    CONSTRAINT "platform_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_recovery_codes_admin_id_idx" ON "platform_recovery_codes"("admin_id");

-- AddForeignKey
ALTER TABLE "platform_recovery_codes" ADD CONSTRAINT "platform_recovery_codes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON platform_recovery_codes TO yucampus_app;

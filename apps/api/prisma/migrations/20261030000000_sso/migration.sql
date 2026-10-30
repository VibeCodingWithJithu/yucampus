-- Sign-in with Google or Microsoft (decided 2026-10-21): one-time codes that carry a finished sign-in to the college.

-- CreateTable
CREATE TABLE "sso_handoffs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sso_handoffs_code_hash_key" ON "sso_handoffs"("code_hash");

-- CreateIndex
CREATE INDEX "sso_handoffs_college_id_user_id_idx" ON "sso_handoffs"("college_id", "user_id");

SELECT enable_tenant_isolation('sso_handoffs');

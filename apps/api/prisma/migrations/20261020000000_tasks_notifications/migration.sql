-- Tasks, reminders, notifications and password links (roadmap slice 6).

ALTER TABLE "users" ADD COLUMN "email_digest" TEXT NOT NULL DEFAULT 'instant';

ALTER TABLE "tasks"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "document_key" TEXT,
  ADD COLUMN "completed_at" TIMESTAMPTZ,
  ADD COLUMN "repeated_at" TIMESTAMPTZ;

ALTER TABLE "evidence" ADD COLUMN "task_id" UUID;
CREATE INDEX "evidence_college_id_task_id_idx" ON "evidence"("college_id", "task_id");
-- No foreign key on purpose: removing a task never removes or blocks the evidence uploaded for it.

ALTER TABLE "notifications"
  ADD COLUMN "dedupe_key" TEXT,
  ADD COLUMN "emailed_at" TIMESTAMPTZ;
-- Several rows without a key are allowed (NULLs are distinct); a keyed reminder exists once per person.
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

CREATE TABLE "password_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "password_links_token_hash_key" ON "password_links"("token_hash");
CREATE INDEX "password_links_college_id_user_id_idx" ON "password_links"("college_id", "user_id");
ALTER TABLE "password_links" ADD CONSTRAINT "password_links_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

SELECT enable_tenant_isolation('password_links');


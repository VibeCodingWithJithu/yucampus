-- Evidence upload and review (roadmap slice 3).

ALTER TYPE "review_action_kind" ADD VALUE IF NOT EXISTS 'resubmitted' AFTER 'submitted';

ALTER TABLE "evidence"
  ADD COLUMN "file_name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "file_sha256" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "document_date" DATE;
ALTER TABLE "evidence" ALTER COLUMN "file_name" DROP DEFAULT;

CREATE INDEX "evidence_college_id_file_sha256_idx" ON "evidence"("college_id", "file_sha256");

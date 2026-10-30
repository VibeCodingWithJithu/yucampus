-- Every file an evidence item has had (roadmap slice 5: version history).

CREATE TABLE "evidence_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "evidence_versions_evidence_id_version_key" ON "evidence_versions"("evidence_id", "version");
CREATE INDEX "evidence_versions_college_id_idx" ON "evidence_versions"("college_id");
ALTER TABLE "evidence_versions" ADD CONSTRAINT "evidence_versions_evidence_id_fkey"
  FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The current file of every existing item becomes its recorded version.
INSERT INTO "evidence_versions" ("college_id", "evidence_id", "version", "file_key", "file_name", "file_type", "file_size", "uploaded_by_id", "uploaded_at")
SELECT "college_id", "id", "version", "file_key", "file_name", "file_type", "file_size", "uploaded_by_id", "updated_at" FROM "evidence";

SELECT enable_tenant_isolation('evidence_versions');

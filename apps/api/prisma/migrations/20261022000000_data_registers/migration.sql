-- Data registers (decided 2026-10-17): configurable definitions (global rules) and per-college records.

-- CreateTable
CREATE TABLE "register_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "framework_status" NOT NULL DEFAULT 'draft',
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "definition" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "register_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "register_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "department_id" UUID,
    "user_id" UUID,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "register_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "register_record_evidence" (
    "college_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,

    CONSTRAINT "register_record_evidence_pkey" PRIMARY KEY ("record_id","evidence_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "register_definitions_code_version_key" ON "register_definitions"("code", "version");

-- CreateIndex
CREATE INDEX "register_records_college_id_definition_id_academic_year_id_idx" ON "register_records"("college_id", "definition_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "register_records_college_id_user_id_idx" ON "register_records"("college_id", "user_id");

-- CreateIndex
CREATE INDEX "register_record_evidence_college_id_evidence_id_idx" ON "register_record_evidence"("college_id", "evidence_id");

-- AddForeignKey
ALTER TABLE "register_records" ADD CONSTRAINT "register_records_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "register_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "register_records" ADD CONSTRAINT "register_records_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "register_records" ADD CONSTRAINT "register_records_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "register_records" ADD CONSTRAINT "register_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "register_record_evidence" ADD CONSTRAINT "register_record_evidence_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "register_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "register_record_evidence" ADD CONSTRAINT "register_record_evidence_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Definitions are rules: the app reads them, only migrations and imports (owner role) change them.
GRANT SELECT ON register_definitions TO yucampus_app;

SELECT enable_tenant_isolation('register_records');
SELECT enable_tenant_isolation('register_record_evidence');

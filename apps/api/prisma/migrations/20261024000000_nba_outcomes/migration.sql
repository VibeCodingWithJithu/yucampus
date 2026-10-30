-- NBA outcomes (decided 2026-10-17): program outcomes, courses, COs, CO-PO mapping and CO totals per assessment.
-- No individual student's marks are stored (DPDP Act).

-- CreateEnum
CREATE TYPE "course_status" AS ENUM ('draft', 'locked');

-- AlterTable
ALTER TABLE "programs" ADD COLUMN     "nba_settings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "program_outcomes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "program_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "semester" INTEGER,
    "teacher_id" UUID,
    "status" "course_status" NOT NULL DEFAULT 'draft',
    "locked_by_id" UUID,
    "locked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_outcomes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "indirect_level" DOUBLE PRECISION,

    CONSTRAINT "course_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "co_po_mappings" (
    "college_id" UUID NOT NULL,
    "course_outcome_id" UUID NOT NULL,
    "program_outcome_id" UUID NOT NULL,
    "strength" INTEGER NOT NULL,

    CONSTRAINT "co_po_mappings_pkey" PRIMARY KEY ("course_outcome_id","program_outcome_id")
);

-- CreateTable
CREATE TABLE "assessment_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "course_outcome_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "attempted" INTEGER NOT NULL,
    "reached" INTEGER NOT NULL,

    CONSTRAINT "assessment_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "program_outcomes_college_id_program_id_idx" ON "program_outcomes"("college_id", "program_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_outcomes_program_id_code_key" ON "program_outcomes"("program_id", "code");

-- CreateIndex
CREATE INDEX "courses_college_id_program_id_academic_year_id_idx" ON "courses"("college_id", "program_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "courses_college_id_teacher_id_idx" ON "courses"("college_id", "teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "courses_program_id_academic_year_id_code_key" ON "courses"("program_id", "academic_year_id", "code");

-- CreateIndex
CREATE INDEX "course_outcomes_college_id_course_id_idx" ON "course_outcomes"("college_id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_outcomes_course_id_code_key" ON "course_outcomes"("course_id", "code");

-- CreateIndex
CREATE INDEX "co_po_mappings_college_id_program_outcome_id_idx" ON "co_po_mappings"("college_id", "program_outcome_id");

-- CreateIndex
CREATE INDEX "assessment_results_college_id_course_id_idx" ON "assessment_results"("college_id", "course_id");

-- AddForeignKey
ALTER TABLE "program_outcomes" ADD CONSTRAINT "program_outcomes_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_outcomes" ADD CONSTRAINT "course_outcomes_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "co_po_mappings" ADD CONSTRAINT "co_po_mappings_course_outcome_id_fkey" FOREIGN KEY ("course_outcome_id") REFERENCES "course_outcomes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "co_po_mappings" ADD CONSTRAINT "co_po_mappings_program_outcome_id_fkey" FOREIGN KEY ("program_outcome_id") REFERENCES "program_outcomes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_course_outcome_id_fkey" FOREIGN KEY ("course_outcome_id") REFERENCES "course_outcomes"("id") ON DELETE CASCADE ON UPDATE CASCADE;


SELECT enable_tenant_isolation('program_outcomes');
SELECT enable_tenant_isolation('courses');
SELECT enable_tenant_isolation('course_outcomes');
SELECT enable_tenant_isolation('co_po_mappings');
SELECT enable_tenant_isolation('assessment_results');

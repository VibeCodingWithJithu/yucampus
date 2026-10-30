-- Permissions per college, assessment cycles, several frameworks per body, NBA per program, two approval levels.
-- Decided 2026-10-14 (docs/PRODUCT.md, docs/DATA_MODEL.md).

-- ------------------------------------------------------------------ New types

CREATE TYPE "review_level" AS ENUM ('department', 'final');
CREATE TYPE "framework_selection" AS ENUM ('single', 'multiple');
CREATE TYPE "framework_attachment" AS ENUM ('college', 'program');
CREATE TYPE "cycle_status" AS ENUM ('planned', 'active', 'closed');

ALTER TYPE "evidence_status" ADD VALUE IF NOT EXISTS 'department_approved' AFTER 'in_review';

-- ------------------------------------------------------------------ Rules: how a framework is chosen

ALTER TABLE "frameworks"
  ADD COLUMN "selection" "framework_selection" NOT NULL DEFAULT 'single',
  ADD COLUMN "attaches_to" "framework_attachment" NOT NULL DEFAULT 'college';

-- ------------------------------------------------------------------ Assessment cycles

CREATE TABLE "assessment_cycles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "body" "accreditation_body" NOT NULL,
    "label" TEXT NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "status" "cycle_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_cycles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "assessment_cycles_college_id_body_label_key" ON "assessment_cycles"("college_id", "body", "label");
ALTER TABLE "assessment_cycles" ADD CONSTRAINT "assessment_cycles_college_id_fkey"
  FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------------ College frameworks: many rows, active flag, cycle

ALTER TABLE "college_frameworks" DROP CONSTRAINT "college_frameworks_pkey";
ALTER TABLE "college_frameworks"
  ADD COLUMN "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN "cycle_id" UUID,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "retired_at" TIMESTAMPTZ;
ALTER TABLE "college_frameworks" ADD CONSTRAINT "college_frameworks_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "college_frameworks_college_id_framework_id_cycle_id_key"
  ON "college_frameworks"("college_id", "framework_id", "cycle_id") NULLS NOT DISTINCT;
ALTER TABLE "college_frameworks" ADD CONSTRAINT "college_frameworks_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "assessment_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------------ Program frameworks (NBA)

CREATE TABLE "program_frameworks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "framework_id" UUID NOT NULL,
    "cycle_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "adopted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMPTZ,

    CONSTRAINT "program_frameworks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "program_frameworks_program_id_framework_id_cycle_id_key"
  ON "program_frameworks"("program_id", "framework_id", "cycle_id") NULLS NOT DISTINCT;
CREATE INDEX "program_frameworks_college_id_idx" ON "program_frameworks"("college_id");
ALTER TABLE "program_frameworks" ADD CONSTRAINT "program_frameworks_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "program_frameworks" ADD CONSTRAINT "program_frameworks_framework_id_fkey"
  FOREIGN KEY ("framework_id") REFERENCES "frameworks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "program_frameworks" ADD CONSTRAINT "program_frameworks_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "assessment_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The NBA tier now comes from the program's framework (e.g. NBA_ENGG_TIER2).
ALTER TABLE "programs" DROP COLUMN "nba_tier";

-- ------------------------------------------------------------------ Permission adjustments per college

CREATE TABLE "college_role_permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "role" "role" NOT NULL,
    "permission" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "changed_by" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "college_role_permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "college_role_permissions_college_id_role_permission_key"
  ON "college_role_permissions"("college_id", "role", "permission");
ALTER TABLE "college_role_permissions" ADD CONSTRAINT "college_role_permissions_college_id_fkey"
  FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------------ Two approval levels

ALTER TABLE "review_actions" ADD COLUMN "level" "review_level";

-- ------------------------------------------------------------------ Tenant isolation for the new tables

SELECT enable_tenant_isolation('assessment_cycles');
SELECT enable_tenant_isolation('program_frameworks');
SELECT enable_tenant_isolation('college_role_permissions');

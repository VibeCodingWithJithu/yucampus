-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "college_type" AS ENUM ('affiliated', 'autonomous', 'university');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'invited', 'not_joined');

-- CreateEnum
CREATE TYPE "role" AS ENUM ('super_admin', 'college_admin', 'principal', 'iqac', 'hod', 'nba_coord', 'nirf_coord', 'faculty', 'office');

-- CreateEnum
CREATE TYPE "academic_year_status" AS ENUM ('current', 'locked', 'next');

-- CreateEnum
CREATE TYPE "accreditation_body" AS ENUM ('NAAC', 'NBA', 'NIRF', 'AISHE');

-- CreateEnum
CREATE TYPE "framework_status" AS ENUM ('draft', 'active', 'retired');

-- CreateEnum
CREATE TYPE "metric_type" AS ENUM ('quantitative', 'qualitative');

-- CreateEnum
CREATE TYPE "report_kind" AS ENUM ('SSR', 'AQAR', 'SAR', 'NIRF_SHEET', 'AISHE');

-- CreateEnum
CREATE TYPE "evidence_status" AS ENUM ('in_review', 'approved', 'needs_fix', 'rejected');

-- CreateEnum
CREATE TYPE "review_action_kind" AS ENUM ('submitted', 'approved', 'needs_fix', 'rejected', 'remapped');

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('open', 'in_progress', 'done', 'overdue');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('in_app', 'email', 'whatsapp');

-- CreateEnum
CREATE TYPE "export_status" AS ENUM ('queued', 'running', 'done', 'failed');

-- CreateTable
CREATE TABLE "colleges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "type" "college_type" NOT NULL,
    "subdomain" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "colleges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "mobile" TEXT,
    "password_hash" TEXT,
    "status" "user_status" NOT NULL DEFAULT 'not_joined',
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID,
    "user_id" UUID NOT NULL,
    "role" "role" NOT NULL,
    "department_id" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "hod_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "nba_tier" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_years" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "academic_year_status" NOT NULL,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_dates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reminder_rule" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "key_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "frameworks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "body" "accreditation_body" NOT NULL,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "valid_from" DATE,
    "status" "framework_status" NOT NULL DEFAULT 'draft',

    CONSTRAINT "frameworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "criteria" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "framework_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "weights" JSONB NOT NULL DEFAULT '{}',
    "applies_to_institution_types" "college_type"[],

    CONSTRAINT "criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "criterion_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plain_language" TEXT NOT NULL,
    "type" "metric_type" NOT NULL,
    "years_required" INTEGER NOT NULL DEFAULT 1,
    "required_documents" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "framework_id" UUID NOT NULL,
    "kind" "report_kind" NOT NULL,
    "version" TEXT NOT NULL,
    "layout" JSONB NOT NULL,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "framework_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tasks" JSONB NOT NULL,

    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "college_frameworks" (
    "college_id" UUID NOT NULL,
    "framework_id" UUID NOT NULL,
    "adopted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "college_frameworks_pkey" PRIMARY KEY ("college_id","framework_id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "department_id" UUID,
    "uploaded_by_id" UUID NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" "evidence_status" NOT NULL DEFAULT 'in_review',
    "version" INTEGER NOT NULL DEFAULT 1,
    "extracted" JSONB,
    "ai_confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_metrics" (
    "college_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "metric_id" UUID NOT NULL,

    CONSTRAINT "evidence_metrics_pkey" PRIMARY KEY ("evidence_id","metric_id")
);

-- CreateTable
CREATE TABLE "review_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" "review_action_kind" NOT NULL,
    "comment" TEXT,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "metric_id" UUID,
    "assignee_user_id" UUID,
    "assignee_department_id" UUID,
    "created_by_id" UUID NOT NULL,
    "due_date" DATE,
    "repeat_rule" JSONB,
    "reminder_rule" JSONB,
    "status" "task_status" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "link" TEXT,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "college_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "channels" "notification_channel"[],

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","event")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "outputs" TEXT[],
    "status" "export_status" NOT NULL DEFAULT 'queued',
    "created_by_id" UUID NOT NULL,
    "files" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "user_id" UUID,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "colleges_subdomain_key" ON "colleges"("subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "users_college_id_email_key" ON "users"("college_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_college_id_mobile_key" ON "users"("college_id", "mobile");

-- CreateIndex
CREATE INDEX "user_roles_college_id_role_idx" ON "user_roles"("college_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_department_id_key" ON "user_roles"("user_id", "role", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_college_id_code_key" ON "departments"("college_id", "code");

-- CreateIndex
CREATE INDEX "programs_college_id_department_id_idx" ON "programs"("college_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_college_id_label_key" ON "academic_years"("college_id", "label");

-- CreateIndex
CREATE INDEX "key_dates_college_id_academic_year_id_date_idx" ON "key_dates"("college_id", "academic_year_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "frameworks_code_version_key" ON "frameworks"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "criteria_framework_id_number_key" ON "criteria"("framework_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "metrics_criterion_id_code_key" ON "metrics"("criterion_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "report_templates_framework_id_kind_version_key" ON "report_templates"("framework_id", "kind", "version");

-- CreateIndex
CREATE INDEX "evidence_college_id_academic_year_id_status_idx" ON "evidence"("college_id", "academic_year_id", "status");

-- CreateIndex
CREATE INDEX "evidence_college_id_department_id_idx" ON "evidence"("college_id", "department_id");

-- CreateIndex
CREATE INDEX "evidence_college_id_uploaded_by_id_idx" ON "evidence"("college_id", "uploaded_by_id");

-- CreateIndex
CREATE INDEX "evidence_metrics_college_id_metric_id_idx" ON "evidence_metrics"("college_id", "metric_id");

-- CreateIndex
CREATE INDEX "review_actions_college_id_evidence_id_at_idx" ON "review_actions"("college_id", "evidence_id", "at");

-- CreateIndex
CREATE INDEX "tasks_college_id_academic_year_id_status_idx" ON "tasks"("college_id", "academic_year_id", "status");

-- CreateIndex
CREATE INDEX "tasks_college_id_assignee_user_id_status_idx" ON "tasks"("college_id", "assignee_user_id", "status");

-- CreateIndex
CREATE INDEX "tasks_college_id_assignee_department_id_status_idx" ON "tasks"("college_id", "assignee_department_id", "status");

-- CreateIndex
CREATE INDEX "comments_college_id_entity_type_entity_id_at_idx" ON "comments"("college_id", "entity_type", "entity_id", "at");

-- CreateIndex
CREATE INDEX "notifications_college_id_user_id_read_at_created_at_idx" ON "notifications"("college_id", "user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notification_preferences_college_id_idx" ON "notification_preferences"("college_id");

-- CreateIndex
CREATE INDEX "export_jobs_college_id_created_at_idx" ON "export_jobs"("college_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_college_id_entity_entity_id_at_idx" ON "audit_logs"("college_id", "entity", "entity_id", "at");

-- CreateIndex
CREATE INDEX "audit_logs_college_id_at_idx" ON "audit_logs"("college_id", "at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_dates" ADD CONSTRAINT "key_dates_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "criteria" ADD CONSTRAINT "criteria_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "frameworks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_criterion_id_fkey" FOREIGN KEY ("criterion_id") REFERENCES "criteria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "frameworks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "frameworks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "college_frameworks" ADD CONSTRAINT "college_frameworks_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "college_frameworks" ADD CONSTRAINT "college_frameworks_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "frameworks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_metrics" ADD CONSTRAINT "evidence_metrics_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_metrics" ADD CONSTRAINT "evidence_metrics_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "metrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_actions" ADD CONSTRAINT "review_actions_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "metrics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "report_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

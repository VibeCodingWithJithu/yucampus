-- Surveys (decided 2026-10-17): anonymous answers through an open link or QR code; no respondent lists (DPDP Act).

-- CreateEnum
CREATE TYPE "survey_status" AS ENUM ('draft', 'open', 'closed');

-- CreateTable
CREATE TABLE "surveys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "template_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "course_id" UUID,
    "status" "survey_status" NOT NULL DEFAULT 'draft',
    "public_token" TEXT NOT NULL,
    "expected_responses" INTEGER,
    "closes_on" DATE,
    "course_note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "survey_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "scale" INTEGER NOT NULL DEFAULT 5,
    "course_outcome_id" UUID,

    CONSTRAINT "survey_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_responses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "survey_id" UUID NOT NULL,
    "device_hash" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_answers" (
    "college_id" UUID NOT NULL,
    "response_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "rating" INTEGER,
    "comment" TEXT,

    CONSTRAINT "survey_answers_pkey" PRIMARY KEY ("response_id","question_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "surveys_public_token_key" ON "surveys"("public_token");

-- CreateIndex
CREATE INDEX "surveys_college_id_academic_year_id_idx" ON "surveys"("college_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "surveys_college_id_course_id_idx" ON "surveys"("college_id", "course_id");

-- CreateIndex
CREATE INDEX "survey_questions_college_id_survey_id_idx" ON "survey_questions"("college_id", "survey_id");

-- CreateIndex
CREATE INDEX "survey_responses_college_id_survey_id_idx" ON "survey_responses"("college_id", "survey_id");

-- CreateIndex
CREATE UNIQUE INDEX "survey_responses_survey_id_device_hash_key" ON "survey_responses"("survey_id", "device_hash");

-- CreateIndex
CREATE INDEX "survey_answers_college_id_question_id_idx" ON "survey_answers"("college_id", "question_id");

-- AddForeignKey
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_questions" ADD CONSTRAINT "survey_questions_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_questions" ADD CONSTRAINT "survey_questions_course_outcome_id_fkey" FOREIGN KEY ("course_outcome_id") REFERENCES "course_outcomes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "survey_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "survey_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The public form finds its college from the link token before any tenant is set. Returns nothing but the id.
CREATE FUNCTION survey_college_id(p_token text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$ SELECT college_id FROM surveys WHERE public_token = p_token $$;

REVOKE ALL ON FUNCTION survey_college_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION survey_college_id(text) TO yucampus_app;

SELECT enable_tenant_isolation('surveys');
SELECT enable_tenant_isolation('survey_questions');
SELECT enable_tenant_isolation('survey_responses');
SELECT enable_tenant_isolation('survey_answers');

-- AISHE (decided 2026-10-18): what the college submitted to AISHE, NIRF and NAAC, for the consistency checker.

-- CreateTable
CREATE TABLE "submitted_figures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "portal" "accreditation_body" NOT NULL,
    "figure_key" TEXT NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "submitted_figures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "submitted_figures_college_id_academic_year_id_portal_figure_key" ON "submitted_figures"("college_id", "academic_year_id", "portal", "figure_key");

-- AddForeignKey
ALTER TABLE "submitted_figures" ADD CONSTRAINT "submitted_figures_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

SELECT enable_tenant_isolation('submitted_figures');

-- Criteria templates with their source, and evidence linked to a metric's required document (roadmap slice 4).

ALTER TABLE "frameworks" ADD COLUMN "source" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "evidence_metrics" ADD COLUMN "document_key" TEXT;

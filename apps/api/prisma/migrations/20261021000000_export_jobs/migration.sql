-- Reports and export (slice 8): a label for the history and what the export covers.
ALTER TABLE "export_jobs" ADD COLUMN "label" TEXT NOT NULL DEFAULT '';
ALTER TABLE "export_jobs" ADD COLUMN "params" JSONB NOT NULL DEFAULT '{}';

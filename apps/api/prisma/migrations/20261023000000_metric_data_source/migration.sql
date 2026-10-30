-- Metrics pull their numbers from the data registers (decided 2026-10-17). Part of the criteria template (rules).
ALTER TABLE "metrics" ADD COLUMN "data_source" JSONB;

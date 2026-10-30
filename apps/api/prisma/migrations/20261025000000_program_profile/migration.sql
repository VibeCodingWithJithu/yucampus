-- Vision, mission and PEOs for the NBA SAR (criterion 1).

-- AlterTable
ALTER TABLE "programs" ADD COLUMN     "nba_profile" JSONB NOT NULL DEFAULT '{}';

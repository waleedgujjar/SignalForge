-- Stage 6 — Lead Qualification & Lead Intelligence
-- Adds structured qualification signals and version tracking to DiscoveredLead.
ALTER TABLE "DiscoveredLead" ADD COLUMN IF NOT EXISTS "qualificationVersion" TEXT;
ALTER TABLE "DiscoveredLead" ADD COLUMN IF NOT EXISTS "qualificationSignals" JSONB;

-- New activity type for requalification.
ALTER TYPE "LeadDiscoveryActivityType" ADD VALUE IF NOT EXISTS 'REQUALIFIED';

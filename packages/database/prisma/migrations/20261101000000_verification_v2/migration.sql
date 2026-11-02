-- Email verification v2: catch-all as its own status, stored evidence, and
-- job counters for catch-all and cache hits. Additive only.

-- Not used as a value within this migration, so no in-transaction enum-use
-- restriction applies.
ALTER TYPE "VerificationStatus" ADD VALUE IF NOT EXISTS 'CATCH_ALL';

ALTER TABLE "LeadVerification"
  ADD COLUMN "checks" JSONB,
  ADD COLUMN "smtpResponse" TEXT;

ALTER TABLE "EmailVerificationHistory"
  ADD COLUMN "checks" JSONB,
  ADD COLUMN "smtpResponse" TEXT;

ALTER TABLE "EmailVerificationJob"
  ADD COLUMN "catchAllCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cachedCount" INTEGER NOT NULL DEFAULT 0;

-- Per-enrollment record that a person approved a review-tier result.
ALTER TABLE "CampaignLead"
  ADD COLUMN "verificationApprovedAt" TIMESTAMP(3),
  ADD COLUMN "verificationApprovedById" TEXT;

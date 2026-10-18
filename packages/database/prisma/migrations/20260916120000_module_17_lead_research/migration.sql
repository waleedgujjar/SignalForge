-- Module 17 — Lead Research (LinkedIn first)
-- Idempotent: safe to run against a database that was previously `db push`ed.

-- CreateEnum (CREATE TYPE has no IF NOT EXISTS; guard via pg_type)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadResearchSource') THEN
    CREATE TYPE "LeadResearchSource" AS ENUM ('LINKEDIN', 'WEBSITE', 'FACEBOOK', 'YOUTUBE', 'REDDIT', 'WEB', 'OTHER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadResearchType') THEN
    CREATE TYPE "LeadResearchType" AS ENUM ('COMPANY', 'PERSON', 'JOB', 'OTHER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadResearchStatus') THEN
    CREATE TYPE "LeadResearchStatus" AS ENUM ('PENDING', 'QUEUED', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'MANUAL_REVIEW', 'FAILED', 'UNAVAILABLE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ResearchConfidence') THEN
    CREATE TYPE "ResearchConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');
  END IF;
END $$;

-- AlterEnum
-- The new value is intentionally NOT referenced by any DML/DEFAULT in this file:
-- Postgres forbids using an enum value added in the same transaction.
ALTER TYPE "WorkflowEventType" ADD VALUE IF NOT EXISTS 'LEAD_RESEARCH_COMPLETED';

-- AlterTable
ALTER TABLE "LeadEnrichment" ADD COLUMN IF NOT EXISTS "opportunityAssessment" JSONB;

-- CreateTable
CREATE TABLE IF NOT EXISTS "LeadResearch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "source" "LeadResearchSource" NOT NULL,
    "researchType" "LeadResearchType" NOT NULL,
    "sourceUrl" TEXT,
    "normalizedUrl" TEXT,
    "status" "LeadResearchStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "confidence" "ResearchConfidence",
    "summary" TEXT,
    "structuredData" JSONB,
    "provenance" JSONB,
    "rawData" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "inputHash" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadResearch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeadResearchActivity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT,
    "researchId" TEXT,
    "source" "LeadResearchSource" NOT NULL,
    "provider" TEXT,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "actorUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadResearchActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ResearchProviderConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "source" "LeadResearchSource" NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "successfulRequests" INTEGER NOT NULL DEFAULT 0,
    "failedRequests" INTEGER NOT NULL DEFAULT 0,
    "manualReviewCount" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastHealthStatus" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LeadResearch_workspaceId_status_idx" ON "LeadResearch"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "LeadResearch_workspaceId_source_status_idx" ON "LeadResearch"("workspaceId", "source", "status");
CREATE INDEX IF NOT EXISTS "LeadResearch_leadId_source_researchType_createdAt_idx" ON "LeadResearch"("leadId", "source", "researchType", "createdAt");
CREATE INDEX IF NOT EXISTS "LeadResearch_workspaceId_createdAt_idx" ON "LeadResearch"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "LeadResearchActivity_workspaceId_createdAt_idx" ON "LeadResearchActivity"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "LeadResearchActivity_leadId_createdAt_idx" ON "LeadResearchActivity"("leadId", "createdAt");
CREATE INDEX IF NOT EXISTS "LeadResearchActivity_researchId_createdAt_idx" ON "LeadResearchActivity"("researchId", "createdAt");
CREATE INDEX IF NOT EXISTS "ResearchProviderConfig_workspaceId_enabled_idx" ON "ResearchProviderConfig"("workspaceId", "enabled");
CREATE UNIQUE INDEX IF NOT EXISTS "ResearchProviderConfig_workspaceId_source_provider_key" ON "ResearchProviderConfig"("workspaceId", "source", "provider");

-- AddForeignKey (ADD CONSTRAINT has no IF NOT EXISTS; guard via pg_constraint)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadResearch_workspaceId_fkey') THEN
    ALTER TABLE "LeadResearch" ADD CONSTRAINT "LeadResearch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadResearch_leadId_fkey') THEN
    ALTER TABLE "LeadResearch" ADD CONSTRAINT "LeadResearch_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadResearchActivity_workspaceId_fkey') THEN
    ALTER TABLE "LeadResearchActivity" ADD CONSTRAINT "LeadResearchActivity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadResearchActivity_leadId_fkey') THEN
    ALTER TABLE "LeadResearchActivity" ADD CONSTRAINT "LeadResearchActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadResearchActivity_researchId_fkey') THEN
    ALTER TABLE "LeadResearchActivity" ADD CONSTRAINT "LeadResearchActivity_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "LeadResearch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ResearchProviderConfig_workspaceId_fkey') THEN
    ALTER TABLE "ResearchProviderConfig" ADD CONSTRAINT "ResearchProviderConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

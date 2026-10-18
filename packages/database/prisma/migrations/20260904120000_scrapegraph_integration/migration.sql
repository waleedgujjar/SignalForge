-- ScrapeGraphAI integration schema

-- CreateEnum
CREATE TYPE "ScrapeGraphJobStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'RETRYING');

-- AlterEnum
ALTER TYPE "WorkflowEventType" ADD VALUE IF NOT EXISTS 'WEBSITE_ANALYZED';
ALTER TYPE "WorkflowEventType" ADD VALUE IF NOT EXISTS 'SCRAPE_JOB_CREATED';
ALTER TYPE "WorkflowEventType" ADD VALUE IF NOT EXISTS 'SCRAPE_STARTED';
ALTER TYPE "WorkflowEventType" ADD VALUE IF NOT EXISTS 'SCRAPE_COMPLETED';
ALTER TYPE "WorkflowEventType" ADD VALUE IF NOT EXISTS 'SCRAPE_FAILED';
ALTER TYPE "WorkflowEventType" ADD VALUE IF NOT EXISTS 'SCRAPE_CANCELLED';
ALTER TYPE "WorkflowEventType" ADD VALUE IF NOT EXISTS 'BULK_ANALYSIS_STARTED';
ALTER TYPE "WorkflowEventType" ADD VALUE IF NOT EXISTS 'BULK_ANALYSIS_COMPLETED';

-- AlterTable
ALTER TABLE "WebsiteAnalysis" ADD COLUMN IF NOT EXISTS "scrapegraphIntelligence" JSONB;
ALTER TABLE "WebsiteAnalysis" ADD COLUMN IF NOT EXISTS "scrapegraphProvenance" JSONB;
ALTER TABLE "WebsiteAnalysis" ADD COLUMN IF NOT EXISTS "scrapegraphEngine" TEXT;
ALTER TABLE "WebsiteAnalysis" ADD COLUMN IF NOT EXISTS "scrapegraphVersion" TEXT;
ALTER TABLE "WebsiteAnalysis" ADD COLUMN IF NOT EXISTS "scrapegraphModel" TEXT;
ALTER TABLE "WebsiteAnalysis" ADD COLUMN IF NOT EXISTS "analyzedAt" TIMESTAMP(3);
ALTER TABLE "WebsiteAnalysis" ADD COLUMN IF NOT EXISTS "parentAnalysisId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ScrapeGraphJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "leadId" TEXT,
    "operation" TEXT NOT NULL,
    "status" "ScrapeGraphJobStatus" NOT NULL DEFAULT 'PENDING',
    "requestJson" JSONB NOT NULL,
    "resultJson" JSONB,
    "errorMessage" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "externalJobId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScrapeGraphJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ScrapeGraphScript" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "scriptContent" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'python',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapeGraphScript_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiUsageRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "estimatedCost" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ScrapeGraphJob_workspaceId_status_createdAt_idx" ON "ScrapeGraphJob"("workspaceId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ScrapeGraphJob_workspaceId_leadId_idx" ON "ScrapeGraphJob"("workspaceId", "leadId");
CREATE INDEX IF NOT EXISTS "ScrapeGraphJob_externalJobId_idx" ON "ScrapeGraphJob"("externalJobId");
CREATE INDEX IF NOT EXISTS "ScrapeGraphScript_workspaceId_createdAt_idx" ON "ScrapeGraphScript"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "ScrapeGraphScript_jobId_idx" ON "ScrapeGraphScript"("jobId");
CREATE INDEX IF NOT EXISTS "AiUsageRecord_workspaceId_createdAt_idx" ON "AiUsageRecord"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiUsageRecord_jobId_idx" ON "AiUsageRecord"("jobId");

-- AddForeignKey
ALTER TABLE "ScrapeGraphJob" ADD CONSTRAINT "ScrapeGraphJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScrapeGraphJob" ADD CONSTRAINT "ScrapeGraphJob_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScrapeGraphScript" ADD CONSTRAINT "ScrapeGraphScript_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScrapeGraphScript" ADD CONSTRAINT "ScrapeGraphScript_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ScrapeGraphJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiUsageRecord" ADD CONSTRAINT "AiUsageRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

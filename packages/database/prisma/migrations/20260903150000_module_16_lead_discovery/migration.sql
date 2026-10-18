-- CreateEnum
CREATE TYPE "LeadDiscoveryStatus" AS ENUM ('PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DiscoveryStage" AS ENUM ('DISCOVERED', 'NORMALIZED', 'DEDUPLICATED', 'ENRICHED', 'WEBSITE_ANALYZED', 'EMAIL_DISCOVERED', 'EMAIL_CHECKED', 'QUALIFIED', 'AI_RESEARCHED', 'READY', 'CAMPAIGN_ENROLLED', 'FAILED');

-- CreateEnum
CREATE TYPE "DiscoverySourceType" AS ENUM ('CSV', 'XLSX', 'GOOGLE_PLACES', 'MOCK', 'MANUAL', 'YELP', 'CLUTCH', 'YELLOW_PAGES');

-- CreateEnum
CREATE TYPE "EmailDiscoverySource" AS ENUM ('SOURCE_PROVIDED', 'MAILTO', 'PAGE_TEXT', 'ENRICHMENT', 'PATTERN_INFERRED');

-- CreateEnum
CREATE TYPE "LeadDiscoveryActivityType" AS ENUM ('CREATED', 'STARTED', 'CANCELLED', 'COMPLETED', 'FAILED', 'RETRIED', 'LEADS_SAVED', 'LEADS_EXPORTED', 'LEADS_ENROLLED', 'AI_RESEARCH_STARTED', 'SOURCE_CONFIG_UPDATED');

-- AlterTable
ALTER TABLE "Campaign" ALTER COLUMN "replyHandlingPolicy" SET DEFAULT '{"pauseOnReply":false,"stopOnReply":true,"autoArchiveOoo":false,"detectUnsubscribe":true}';

-- CreateTable
CREATE TABLE "LeadDiscoveryJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "initiatedByUserId" TEXT NOT NULL,
    "source" "DiscoverySourceType" NOT NULL,
    "status" "LeadDiscoveryStatus" NOT NULL DEFAULT 'PENDING',
    "name" TEXT,
    "query" JSONB NOT NULL DEFAULT '{}',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "requestedCount" INTEGER NOT NULL DEFAULT 0,
    "discoveredCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "enrichedCount" INTEGER NOT NULL DEFAULT 0,
    "websiteAnalyzedCount" INTEGER NOT NULL DEFAULT 0,
    "emailsFoundCount" INTEGER NOT NULL DEFAULT 0,
    "emailsVerifiedCount" INTEGER NOT NULL DEFAULT 0,
    "qualifiedCount" INTEGER NOT NULL DEFAULT 0,
    "promotedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "errorLog" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadDiscoveryJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveredLead" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stage" "DiscoveryStage" NOT NULL DEFAULT 'DISCOVERED',
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "duplicateOfId" TEXT,
    "matchReason" TEXT,
    "rawCompany" TEXT,
    "rawEmail" TEXT,
    "rawPhone" TEXT,
    "rawWebsite" TEXT,
    "company" TEXT,
    "normalizedCompany" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "fullName" TEXT,
    "jobTitle" TEXT,
    "email" TEXT,
    "normalizedEmail" TEXT,
    "phone" TEXT,
    "normalizedPhone" TEXT,
    "website" TEXT,
    "normalizedDomain" TEXT,
    "industry" TEXT,
    "countryCode" TEXT,
    "country" TEXT,
    "state" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "employeeCount" TEXT,
    "source" "DiscoverySourceType" NOT NULL,
    "sourceId" TEXT,
    "sourceUrl" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailSource" "EmailDiscoverySource",
    "emailConfidence" INTEGER,
    "emailStatus" "VerificationStatus",
    "emailScore" INTEGER,
    "websiteScore" INTEGER,
    "opportunityScore" INTEGER,
    "websiteAnalysis" JSONB,
    "aiOpportunity" TEXT,
    "aiResearch" JSONB,
    "icpFitScore" INTEGER,
    "icpBreakdown" JSONB,
    "qualified" BOOLEAN NOT NULL DEFAULT false,
    "qualifyReason" TEXT,
    "promotedLeadId" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveredLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSourceRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "source" "DiscoverySourceType" NOT NULL,
    "sourceId" TEXT,
    "sourceUrl" TEXT,
    "jobId" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSourceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadDiscoveryActivity" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "type" "LeadDiscoveryActivityType" NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadDiscoveryActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSourceConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "source" "DiscoverySourceType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "successfulRequests" INTEGER NOT NULL DEFAULT 0,
    "failedRequests" INTEGER NOT NULL DEFAULT 0,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSourceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadDiscoveryJob_workspaceId_status_idx" ON "LeadDiscoveryJob"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "LeadDiscoveryJob_workspaceId_createdAt_idx" ON "LeadDiscoveryJob"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadDiscoveryJob_workspaceId_source_idx" ON "LeadDiscoveryJob"("workspaceId", "source");

-- CreateIndex
CREATE INDEX "DiscoveredLead_jobId_stage_idx" ON "DiscoveredLead"("jobId", "stage");

-- CreateIndex
CREATE INDEX "DiscoveredLead_jobId_qualified_idx" ON "DiscoveredLead"("jobId", "qualified");

-- CreateIndex
CREATE INDEX "DiscoveredLead_workspaceId_createdAt_idx" ON "DiscoveredLead"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscoveredLead_workspaceId_normalizedEmail_idx" ON "DiscoveredLead"("workspaceId", "normalizedEmail");

-- CreateIndex
CREATE INDEX "DiscoveredLead_workspaceId_normalizedDomain_idx" ON "DiscoveredLead"("workspaceId", "normalizedDomain");

-- CreateIndex
CREATE INDEX "DiscoveredLead_workspaceId_normalizedPhone_idx" ON "DiscoveredLead"("workspaceId", "normalizedPhone");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredLead_jobId_source_sourceId_key" ON "DiscoveredLead"("jobId", "source", "sourceId");

-- CreateIndex
CREATE INDEX "LeadSourceRecord_workspaceId_source_idx" ON "LeadSourceRecord"("workspaceId", "source");

-- CreateIndex
CREATE INDEX "LeadSourceRecord_leadId_discoveredAt_idx" ON "LeadSourceRecord"("leadId", "discoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSourceRecord_leadId_source_sourceId_key" ON "LeadSourceRecord"("leadId", "source", "sourceId");

-- CreateIndex
CREATE INDEX "LeadDiscoveryActivity_jobId_createdAt_idx" ON "LeadDiscoveryActivity"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadDiscoveryActivity_workspaceId_createdAt_idx" ON "LeadDiscoveryActivity"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadSourceConfig_workspaceId_enabled_idx" ON "LeadSourceConfig"("workspaceId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSourceConfig_workspaceId_source_key" ON "LeadSourceConfig"("workspaceId", "source");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_companyDomain_idx" ON "Lead"("workspaceId", "companyDomain");

-- AddForeignKey
ALTER TABLE "LeadDiscoveryJob" ADD CONSTRAINT "LeadDiscoveryJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredLead" ADD CONSTRAINT "DiscoveredLead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredLead" ADD CONSTRAINT "DiscoveredLead_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "LeadDiscoveryJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredLead" ADD CONSTRAINT "DiscoveredLead_promotedLeadId_fkey" FOREIGN KEY ("promotedLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSourceRecord" ADD CONSTRAINT "LeadSourceRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSourceRecord" ADD CONSTRAINT "LeadSourceRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDiscoveryActivity" ADD CONSTRAINT "LeadDiscoveryActivity_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "LeadDiscoveryJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDiscoveryActivity" ADD CONSTRAINT "LeadDiscoveryActivity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSourceConfig" ADD CONSTRAINT "LeadSourceConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


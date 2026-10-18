-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'CRAWLING', 'ANALYZING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "OpportunityPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH');

-- CreateTable
CREATE TABLE "WebsiteAnalysis" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "websiteScore" INTEGER,
    "opportunityScore" INTEGER,
    "opportunityPriority" "OpportunityPriority",
    "scoreBreakdown" JSONB,
    "technicalFindings" JSONB,
    "performanceData" JSONB,
    "seoFindings" JSONB,
    "mobileFindings" JSONB,
    "contentFindings" JSONB,
    "conversionData" JSONB,
    "technologies" JSONB,
    "aiSignals" JSONB,
    "modernityAssessment" JSONB,
    "aiSummary" TEXT,
    "aiKeyIssues" JSONB,
    "aiOpportunities" JSONB,
    "aiPersonalizationHooks" JSONB,
    "recommendedServices" JSONB,
    "pagesCrawled" INTEGER NOT NULL DEFAULT 0,
    "crawlDurationMs" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebsiteAnalysis_workspaceId_createdAt_idx" ON "WebsiteAnalysis"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "WebsiteAnalysis_workspaceId_domain_idx" ON "WebsiteAnalysis"("workspaceId", "domain");

-- CreateIndex
CREATE INDEX "WebsiteAnalysis_workspaceId_opportunityPriority_idx" ON "WebsiteAnalysis"("workspaceId", "opportunityPriority");

-- CreateIndex
CREATE INDEX "WebsiteAnalysis_leadId_createdAt_idx" ON "WebsiteAnalysis"("leadId", "createdAt");

-- AddForeignKey
ALTER TABLE "WebsiteAnalysis" ADD CONSTRAINT "WebsiteAnalysis_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteAnalysis" ADD CONSTRAINT "WebsiteAnalysis_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

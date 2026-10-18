-- CreateEnum
CREATE TYPE "EnrichmentStatus" AS ENUM ('NOT_ENRICHED', 'QUEUED', 'ENRICHING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "ProspectPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH');

-- CreateEnum
CREATE TYPE "Seniority" AS ENUM ('EXECUTIVE', 'VP', 'DIRECTOR', 'MANAGER', 'INDIVIDUAL_CONTRIBUTOR', 'UNKNOWN');

-- CreateTable
CREATE TABLE "ICPProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "targetIndustries" JSONB NOT NULL DEFAULT '[]',
    "targetCountries" JSONB NOT NULL DEFAULT '[]',
    "targetCompanySizes" JSONB NOT NULL DEFAULT '[]',
    "targetJobTitles" JSONB NOT NULL DEFAULT '[]',
    "targetSeniorities" JSONB NOT NULL DEFAULT '[]',
    "targetKeywords" JSONB NOT NULL DEFAULT '[]',
    "minWebsiteScore" INTEGER,
    "minOpportunityScore" INTEGER,
    "requireVerifiedEmail" BOOLEAN NOT NULL DEFAULT false,
    "weights" JSONB NOT NULL DEFAULT '{"industry":25,"location":15,"companySize":15,"jobTitle":25,"seniority":20}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ICPProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEnrichment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "EnrichmentStatus" NOT NULL DEFAULT 'NOT_ENRICHED',
    "icpFitScore" INTEGER,
    "icpBreakdown" JSONB,
    "leadQualityScore" INTEGER,
    "leadQualityBreakdown" JSONB,
    "prospectScore" INTEGER,
    "prospectBreakdown" JSONB,
    "prospectPriority" "ProspectPriority",
    "seniority" "Seniority",
    "department" TEXT,
    "companyProfile" JSONB,
    "aiSummary" TEXT,
    "painPointHypotheses" JSONB,
    "recommendedServices" JSONB,
    "personalizationHooks" JSONB,
    "outreachAngles" JSONB,
    "dynamicVariables" JSONB,
    "aiConfidence" TEXT,
    "inputHash" TEXT,
    "enrichedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadEnrichment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCatalogEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "matchingSignals" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCatalogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ICPProfile_workspaceId_key" ON "ICPProfile"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadEnrichment_leadId_key" ON "LeadEnrichment"("leadId");

-- CreateIndex
CREATE INDEX "LeadEnrichment_workspaceId_status_idx" ON "LeadEnrichment"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "LeadEnrichment_workspaceId_prospectPriority_idx" ON "LeadEnrichment"("workspaceId", "prospectPriority");

-- CreateIndex
CREATE INDEX "LeadEnrichment_workspaceId_prospectScore_idx" ON "LeadEnrichment"("workspaceId", "prospectScore");

-- CreateIndex
CREATE INDEX "ServiceCatalogEntry_workspaceId_enabled_idx" ON "ServiceCatalogEntry"("workspaceId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCatalogEntry_workspaceId_name_key" ON "ServiceCatalogEntry"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "ICPProfile" ADD CONSTRAINT "ICPProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEnrichment" ADD CONSTRAINT "LeadEnrichment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEnrichment" ADD CONSTRAINT "LeadEnrichment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCatalogEntry" ADD CONSTRAINT "ServiceCatalogEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "StagedLeadStatus" AS ENUM ('UNIQUE', 'DUPLICATE', 'REVIEW', 'INVALID');

-- CreateTable
CREATE TABLE "StagingDataset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "sourceFileSize" INTEGER,
    "mimeType" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "initiatedByUserId" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "stagedCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "categorizedCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "columnMappings" JSONB NOT NULL DEFAULT '{}',
    "config" JSONB NOT NULL DEFAULT '{}',
    "errorLog" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StagingDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StagedLead" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,
    "bio" TEXT,
    "category" TEXT,
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "normalizedEmail" TEXT,
    "normalizedPhone" TEXT,
    "websiteDomain" TEXT,
    "normalizedUsername" TEXT,
    "status" "StagedLeadStatus" NOT NULL DEFAULT 'UNIQUE',
    "duplicateOfId" TEXT,
    "dedupReason" TEXT,
    "assignedCategory" TEXT,
    "categoryConfidence" DOUBLE PRECISION,
    "categoryReason" TEXT,
    "rawData" JSONB NOT NULL DEFAULT '{}',
    "sourceRow" INTEGER NOT NULL DEFAULT 0,
    "importedLeadId" TEXT,
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StagedLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StagingDataset_workspaceId_createdAt_idx" ON "StagingDataset"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "StagingDataset_workspaceId_status_idx" ON "StagingDataset"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "StagedLead_datasetId_status_idx" ON "StagedLead"("datasetId", "status");

-- CreateIndex
CREATE INDEX "StagedLead_datasetId_assignedCategory_idx" ON "StagedLead"("datasetId", "assignedCategory");

-- CreateIndex
CREATE INDEX "StagedLead_datasetId_normalizedEmail_idx" ON "StagedLead"("datasetId", "normalizedEmail");

-- CreateIndex
CREATE INDEX "StagedLead_datasetId_createdAt_idx" ON "StagedLead"("datasetId", "createdAt");

-- CreateIndex
CREATE INDEX "StagedLead_workspaceId_normalizedEmail_idx" ON "StagedLead"("workspaceId", "normalizedEmail");

-- AddForeignKey
ALTER TABLE "StagingDataset" ADD CONSTRAINT "StagingDataset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedLead" ADD CONSTRAINT "StagedLead_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "StagingDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedLead" ADD CONSTRAINT "StagedLead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

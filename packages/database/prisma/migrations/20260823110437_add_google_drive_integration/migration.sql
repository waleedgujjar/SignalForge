-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('GOOGLE_DRIVE');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('CONNECTED', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'SCANNING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE 'GOOGLE_DRIVE';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "importId" TEXT,
ADD COLUMN     "sourceFileId" TEXT;

-- CreateTable
CREATE TABLE "IntegrationAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'CONNECTED',
    "accountEmail" TEXT NOT NULL,
    "encryptedTokens" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "tokenExpiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "connectedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadImport" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "integrationId" TEXT,
    "source" "LeadSource" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "initiatedByUserId" TEXT NOT NULL,
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "columnMappings" JSONB NOT NULL DEFAULT '{}',
    "importOptions" JSONB NOT NULL DEFAULT '{}',
    "errorLog" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadImportFile" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "sourceFileMimeType" TEXT,
    "sourceFileSize" INTEGER,
    "detectedRowCount" INTEGER,
    "detectedColumns" JSONB NOT NULL DEFAULT '[]',
    "importedRowCount" INTEGER NOT NULL DEFAULT 0,
    "skippedRowCount" INTEGER NOT NULL DEFAULT 0,
    "errorRowCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "errorLog" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadImportFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationAccount_workspaceId_provider_idx" ON "IntegrationAccount"("workspaceId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationAccount_workspaceId_provider_accountEmail_key" ON "IntegrationAccount"("workspaceId", "provider", "accountEmail");

-- CreateIndex
CREATE INDEX "LeadImport_workspaceId_createdAt_idx" ON "LeadImport"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadImport_workspaceId_status_idx" ON "LeadImport"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "LeadImportFile_sourceFileId_idx" ON "LeadImportFile"("sourceFileId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadImportFile_importId_sourceFileId_key" ON "LeadImportFile"("importId", "sourceFileId");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_importId_idx" ON "Lead"("workspaceId", "importId");

-- AddForeignKey
ALTER TABLE "IntegrationAccount" ADD CONSTRAINT "IntegrationAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadImport" ADD CONSTRAINT "LeadImport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadImport" ADD CONSTRAINT "LeadImport_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadImportFile" ADD CONSTRAINT "LeadImportFile_importId_fkey" FOREIGN KEY ("importId") REFERENCES "LeadImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH');
CREATE TYPE "ProviderType" AS ENUM ('FREE', 'BUSINESS', 'UNKNOWN');
CREATE TYPE "EmailVerificationJobStatus" AS ENUM ('PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');
CREATE TYPE "EmailVerificationJobSource" AS ENUM ('LEADS', 'EXCEL', 'PASTE', 'DISCOVERY', 'SINGLE');

-- AlterTable LeadVerification
ALTER TABLE "LeadVerification" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "LeadVerification" ADD COLUMN "originalEmail" TEXT;
ALTER TABLE "LeadVerification" ADD COLUMN "normalizedEmail" TEXT;
ALTER TABLE "LeadVerification" ADD COLUMN "riskScore" INTEGER;
ALTER TABLE "LeadVerification" ADD COLUMN "riskLevel" "RiskLevel";
ALTER TABLE "LeadVerification" ADD COLUMN "confidenceScore" INTEGER;
ALTER TABLE "LeadVerification" ADD COLUMN "reasonCode" TEXT;
ALTER TABLE "LeadVerification" ADD COLUMN "syntaxValid" BOOLEAN;
ALTER TABLE "LeadVerification" ADD COLUMN "domainValid" BOOLEAN;
ALTER TABLE "LeadVerification" ADD COLUMN "dnsResolved" BOOLEAN;
ALTER TABLE "LeadVerification" ADD COLUMN "mxFound" BOOLEAN;
ALTER TABLE "LeadVerification" ADD COLUMN "mxRecords" JSONB;
ALTER TABLE "LeadVerification" ADD COLUMN "smtpStatus" TEXT;
ALTER TABLE "LeadVerification" ADD COLUMN "isDisposable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeadVerification" ADD COLUMN "isRole" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeadVerification" ADD COLUMN "roleType" TEXT;
ALTER TABLE "LeadVerification" ADD COLUMN "isCatchAll" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeadVerification" ADD COLUMN "providerType" "ProviderType";
ALTER TABLE "LeadVerification" ADD COLUMN "verificationMethod" TEXT;
ALTER TABLE "LeadVerification" ADD COLUMN "riskFactors" JSONB;
ALTER TABLE "LeadVerification" ADD COLUMN "verificationVersion" TEXT NOT NULL DEFAULT 'v1';

CREATE INDEX "LeadVerification_workspaceId_normalizedEmail_idx" ON "LeadVerification"("workspaceId", "normalizedEmail");
CREATE INDEX "LeadVerification_workspaceId_status_idx" ON "LeadVerification"("workspaceId", "status");

-- AlterTable WorkspaceVerificationPolicy
ALTER TABLE "WorkspaceVerificationPolicy" ADD COLUMN "blockUnverified" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "WorkspaceVerificationPolicy" ADD COLUMN "allowRoleEmails" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkspaceVerificationPolicy" ADD COLUMN "blockRisky" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "WorkspaceVerificationPolicy" ADD COLUMN "blockUnknown" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable EmailVerificationJob
CREATE TABLE "EmailVerificationJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "initiatedByUserId" TEXT,
    "status" "EmailVerificationJobStatus" NOT NULL DEFAULT 'PENDING',
    "source" "EmailVerificationJobSource" NOT NULL DEFAULT 'PASTE',
    "name" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "pending" INTEGER NOT NULL DEFAULT 0,
    "processing" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "validCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "riskyCount" INTEGER NOT NULL DEFAULT 0,
    "unknownCount" INTEGER NOT NULL DEFAULT 0,
    "disposableCount" INTEGER NOT NULL DEFAULT 0,
    "roleCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailVerificationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable EmailVerificationHistory
CREATE TABLE "EmailVerificationHistory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT,
    "leadId" TEXT,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL,
    "riskScore" INTEGER,
    "confidenceScore" INTEGER,
    "verificationMethod" TEXT,
    "reasonCode" TEXT,
    "reasonMessage" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable DomainVerificationCache
CREATE TABLE "DomainVerificationCache" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "mxRecords" JSONB,
    "mxFound" BOOLEAN,
    "isCatchAll" BOOLEAN,
    "isDisposable" BOOLEAN,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainVerificationCache_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailVerificationJob_workspaceId_status_idx" ON "EmailVerificationJob"("workspaceId", "status");
CREATE INDEX "EmailVerificationJob_workspaceId_createdAt_idx" ON "EmailVerificationJob"("workspaceId", "createdAt");
CREATE INDEX "EmailVerificationHistory_workspaceId_normalizedEmail_idx" ON "EmailVerificationHistory"("workspaceId", "normalizedEmail");
CREATE INDEX "EmailVerificationHistory_workspaceId_checkedAt_idx" ON "EmailVerificationHistory"("workspaceId", "checkedAt");
CREATE INDEX "EmailVerificationHistory_workspaceId_status_idx" ON "EmailVerificationHistory"("workspaceId", "status");
CREATE INDEX "EmailVerificationHistory_jobId_idx" ON "EmailVerificationHistory"("jobId");
CREATE INDEX "EmailVerificationHistory_leadId_idx" ON "EmailVerificationHistory"("leadId");
CREATE UNIQUE INDEX "DomainVerificationCache_workspaceId_domain_key" ON "DomainVerificationCache"("workspaceId", "domain");
CREATE INDEX "DomainVerificationCache_expiresAt_idx" ON "DomainVerificationCache"("expiresAt");

ALTER TABLE "EmailVerificationJob" ADD CONSTRAINT "EmailVerificationJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailVerificationHistory" ADD CONSTRAINT "EmailVerificationHistory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailVerificationHistory" ADD CONSTRAINT "EmailVerificationHistory_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "EmailVerificationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DomainVerificationCache" ADD CONSTRAINT "DomainVerificationCache_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

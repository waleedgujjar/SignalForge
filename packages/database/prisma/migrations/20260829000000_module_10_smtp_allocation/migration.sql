-- CreateEnum
CREATE TYPE "CampaignSendingMode" AS ENUM ('MAILBOX_LIST', 'SMTP_POOL', 'SINGLE_MAILBOX');

-- CreateEnum
CREATE TYPE "CapacityReservationStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');

-- CreateEnum
CREATE TYPE "AllocationOutcome" AS ENUM ('ALLOCATED', 'NO_ELIGIBLE_ACCOUNTS', 'SMTP_POOL_DISABLED', 'ACCOUNT_LIMIT_REACHED', 'CAMPAIGN_LIMIT_REACHED', 'ACCOUNT_UNAVAILABLE', 'ALLOCATION_CONFLICT', 'INVALID_SMTP_CONFIGURATION', 'IDEMPOTENT_HIT', 'REALLOCATED');

-- CreateEnum
CREATE TYPE "DegradedMailboxPolicy" AS ENUM ('ALLOW', 'DEPRIORITIZE', 'EXCLUDE');

-- AlterEnum
ALTER TYPE "RotationStrategy" ADD VALUE 'CAPACITY_BASED';

-- AlterTable Campaign: add sendingMode, smtpPoolId, mailboxId
ALTER TABLE "Campaign"
  ADD COLUMN "sendingMode" "CampaignSendingMode" NOT NULL DEFAULT 'MAILBOX_LIST',
  ADD COLUMN "smtpPoolId" TEXT,
  ADD COLUMN "mailboxId" TEXT;

-- AlterTable MailboxDailyUsage: add reservedCount
ALTER TABLE "MailboxDailyUsage"
  ADD COLUMN "reservedCount" INTEGER NOT NULL DEFAULT 0;

-- Dedupe existing SendingPolicy rows to allow unique(workspaceId)
DELETE FROM "SendingPolicy" p
USING "SendingPolicy" q
WHERE p."workspaceId" = q."workspaceId"
  AND p."createdAt" < q."createdAt";

-- AlterTable SendingPolicy: add enabled and degradedMailboxPolicy, drop old index, unique workspaceId, change default rotationStrategy
DROP INDEX IF EXISTS "SendingPolicy_workspaceId_idx";

ALTER TABLE "SendingPolicy"
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "degradedMailboxPolicy" "DegradedMailboxPolicy" NOT NULL DEFAULT 'ALLOW';

ALTER TABLE "SendingPolicy"
  ALTER COLUMN "rotationStrategy" SET DEFAULT 'ROUND_ROBIN';

CREATE UNIQUE INDEX "SendingPolicy_workspaceId_key" ON "SendingPolicy"("workspaceId");

-- CreateTable SmtpPool
CREATE TABLE "SmtpPool" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "strategy" "RotationStrategy" NOT NULL DEFAULT 'ROUND_ROBIN',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRoundRobinMailboxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmtpPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable SmtpPoolAccount
CREATE TABLE "SmtpPoolAccount" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmtpPoolAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable MailboxCapacityReservation
CREATE TABLE "MailboxCapacityReservation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sendingJobId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "poolId" TEXT,
    "usageDate" DATE NOT NULL,
    "status" "CapacityReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "strategy" "RotationStrategy" NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,

    CONSTRAINT "MailboxCapacityReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable MailboxAllocationHistory
CREATE TABLE "MailboxAllocationHistory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sendingJobId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "mailboxId" TEXT,
    "poolId" TEXT,
    "strategy" "RotationStrategy" NOT NULL,
    "outcome" "AllocationOutcome" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxAllocationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex Campaign additions
CREATE INDEX "Campaign_smtpPoolId_idx" ON "Campaign"("smtpPoolId");

-- CreateIndex SmtpPool
CREATE UNIQUE INDEX "SmtpPool_workspaceId_name_key" ON "SmtpPool"("workspaceId", "name");
CREATE INDEX "SmtpPool_workspaceId_enabled_idx" ON "SmtpPool"("workspaceId", "enabled");

-- CreateIndex SmtpPoolAccount
CREATE UNIQUE INDEX "SmtpPoolAccount_poolId_mailboxId_key" ON "SmtpPoolAccount"("poolId", "mailboxId");
CREATE INDEX "SmtpPoolAccount_poolId_enabled_priority_idx" ON "SmtpPoolAccount"("poolId", "enabled", "priority");
CREATE INDEX "SmtpPoolAccount_mailboxId_idx" ON "SmtpPoolAccount"("mailboxId");

-- CreateIndex MailboxCapacityReservation
CREATE UNIQUE INDEX "MailboxCapacityReservation_sendingJobId_key" ON "MailboxCapacityReservation"("sendingJobId");
CREATE INDEX "MailboxCapacityReservation_mailboxId_usageDate_status_idx" ON "MailboxCapacityReservation"("mailboxId", "usageDate", "status");
CREATE INDEX "MailboxCapacityReservation_workspaceId_status_idx" ON "MailboxCapacityReservation"("workspaceId", "status");
CREATE INDEX "MailboxCapacityReservation_poolId_status_idx" ON "MailboxCapacityReservation"("poolId", "status");

-- CreateIndex MailboxAllocationHistory
CREATE INDEX "MailboxAllocationHistory_workspaceId_createdAt_idx" ON "MailboxAllocationHistory"("workspaceId", "createdAt");
CREATE INDEX "MailboxAllocationHistory_campaignId_createdAt_idx" ON "MailboxAllocationHistory"("campaignId", "createdAt");
CREATE INDEX "MailboxAllocationHistory_mailboxId_createdAt_idx" ON "MailboxAllocationHistory"("mailboxId", "createdAt");
CREATE INDEX "MailboxAllocationHistory_poolId_createdAt_idx" ON "MailboxAllocationHistory"("poolId", "createdAt");
CREATE INDEX "MailboxAllocationHistory_sendingJobId_idx" ON "MailboxAllocationHistory"("sendingJobId");

-- AddForeignKey Campaign
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_smtpPoolId_fkey" FOREIGN KEY ("smtpPoolId") REFERENCES "SmtpPool"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey SmtpPool
ALTER TABLE "SmtpPool" ADD CONSTRAINT "SmtpPool_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey SmtpPoolAccount
ALTER TABLE "SmtpPoolAccount" ADD CONSTRAINT "SmtpPoolAccount_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "SmtpPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmtpPoolAccount" ADD CONSTRAINT "SmtpPoolAccount_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey MailboxCapacityReservation
ALTER TABLE "MailboxCapacityReservation" ADD CONSTRAINT "MailboxCapacityReservation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MailboxCapacityReservation" ADD CONSTRAINT "MailboxCapacityReservation_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MailboxCapacityReservation" ADD CONSTRAINT "MailboxCapacityReservation_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "SmtpPool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey MailboxAllocationHistory
ALTER TABLE "MailboxAllocationHistory" ADD CONSTRAINT "MailboxAllocationHistory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MailboxAllocationHistory" ADD CONSTRAINT "MailboxAllocationHistory_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MailboxAllocationHistory" ADD CONSTRAINT "MailboxAllocationHistory_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MailboxAllocationHistory" ADD CONSTRAINT "MailboxAllocationHistory_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "SmtpPool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Module 11: Email Warmup & Mailbox Reputation Protection

-- CreateEnum WarmupJobStatus
CREATE TYPE "WarmupJobStatus" AS ENUM ('QUEUED', 'DISPATCHED', 'IN_PROGRESS', 'SENT', 'DEFERRED', 'FAILED', 'CANCELLED', 'PAUSED');

-- CreateEnum WarmupReservationStatus
CREATE TYPE "WarmupReservationStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');

-- Replace WarmupStatus enum values: drop IN_PROGRESS (mapped to ACTIVE), add ACTIVE/PAUSED/BLOCKED/DISABLED
ALTER TYPE "WarmupStatus" RENAME TO "WarmupStatus_old";
CREATE TYPE "WarmupStatus" AS ENUM ('NOT_STARTED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'BLOCKED', 'DISABLED');

ALTER TABLE "Mailbox"
  ALTER COLUMN "warmupStatus" DROP DEFAULT,
  ALTER COLUMN "warmupStatus" TYPE "WarmupStatus" USING (
    CASE "warmupStatus"::text
      WHEN 'IN_PROGRESS' THEN 'ACTIVE'::"WarmupStatus"
      ELSE "warmupStatus"::text::"WarmupStatus"
    END
  ),
  ALTER COLUMN "warmupStatus" SET DEFAULT 'NOT_STARTED';

DROP TYPE "WarmupStatus_old";

-- AlterTable MailboxDailyUsage: add warmup counters
ALTER TABLE "MailboxDailyUsage"
  ADD COLUMN "warmupSentCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "warmupReservedCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable EmailWarmupConfig
CREATE TABLE "EmailWarmupConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "WarmupStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startingDailyLimit" INTEGER NOT NULL DEFAULT 5,
    "maximumDailyLimit" INTEGER NOT NULL DEFAULT 50,
    "rampStep" INTEGER NOT NULL DEFAULT 5,
    "rampIntervalHours" INTEGER NOT NULL DEFAULT 24,
    "currentDailyLimit" INTEGER NOT NULL DEFAULT 5,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "weekdays" JSONB NOT NULL DEFAULT '[1,2,3,4,5]',
    "windowStart" TEXT NOT NULL DEFAULT '09:00',
    "windowEnd" TEXT NOT NULL DEFAULT '17:00',
    "consecutiveFailureThreshold" INTEGER NOT NULL DEFAULT 3,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastFailureAt" TIMESTAMP(3),
    "blockReason" TEXT,
    "lastRecipientId" TEXT,
    "startDate" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "lastProgressionAt" TIMESTAMP(3),
    "resetRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailWarmupConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailWarmupConfig_mailboxId_key" ON "EmailWarmupConfig"("mailboxId");
CREATE INDEX "EmailWarmupConfig_workspaceId_status_idx" ON "EmailWarmupConfig"("workspaceId", "status");
CREATE INDEX "EmailWarmupConfig_enabled_status_idx" ON "EmailWarmupConfig"("enabled", "status");

ALTER TABLE "EmailWarmupConfig" ADD CONSTRAINT "EmailWarmupConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailWarmupConfig" ADD CONSTRAINT "EmailWarmupConfig_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable WarmupRecipient
CREATE TABLE "WarmupRecipient" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "consentConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarmupRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WarmupRecipient_workspaceId_email_key" ON "WarmupRecipient"("workspaceId", "email");
CREATE INDEX "WarmupRecipient_workspaceId_enabled_idx" ON "WarmupRecipient"("workspaceId", "enabled");

ALTER TABLE "WarmupRecipient" ADD CONSTRAINT "WarmupRecipient_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable WarmupJob
CREATE TABLE "WarmupJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "recipientId" TEXT,
    "recipientEmail" TEXT NOT NULL,
    "usageDate" DATE NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "WarmupJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "errorCategory" "SendErrorCategory",
    "lastError" TEXT,
    "bullmqJobId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "renderedSubject" TEXT NOT NULL,
    "renderedBody" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarmupJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WarmupJob_mailboxId_usageDate_slotIndex_key" ON "WarmupJob"("mailboxId", "usageDate", "slotIndex");
CREATE INDEX "WarmupJob_workspaceId_status_scheduledAt_idx" ON "WarmupJob"("workspaceId", "status", "scheduledAt");
CREATE INDEX "WarmupJob_mailboxId_scheduledAt_idx" ON "WarmupJob"("mailboxId", "scheduledAt");
CREATE INDEX "WarmupJob_status_scheduledAt_idx" ON "WarmupJob"("status", "scheduledAt");

ALTER TABLE "WarmupJob" ADD CONSTRAINT "WarmupJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarmupJob" ADD CONSTRAINT "WarmupJob_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarmupJob" ADD CONSTRAINT "WarmupJob_configId_fkey" FOREIGN KEY ("configId") REFERENCES "EmailWarmupConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarmupJob" ADD CONSTRAINT "WarmupJob_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "WarmupRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable WarmupDailyHistory
CREATE TABLE "WarmupDailyHistory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "usageDate" DATE NOT NULL,
    "configuredLimit" INTEGER NOT NULL DEFAULT 0,
    "scheduledCount" INTEGER NOT NULL DEFAULT 0,
    "attemptedCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "deferredCount" INTEGER NOT NULL DEFAULT 0,
    "statusSnapshot" "WarmupStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "healthSnapshot" "HealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarmupDailyHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WarmupDailyHistory_mailboxId_usageDate_key" ON "WarmupDailyHistory"("mailboxId", "usageDate");
CREATE INDEX "WarmupDailyHistory_workspaceId_usageDate_idx" ON "WarmupDailyHistory"("workspaceId", "usageDate");

ALTER TABLE "WarmupDailyHistory" ADD CONSTRAINT "WarmupDailyHistory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarmupDailyHistory" ADD CONSTRAINT "WarmupDailyHistory_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable WarmupCapacityReservation
CREATE TABLE "WarmupCapacityReservation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "warmupJobId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "usageDate" DATE NOT NULL,
    "status" "WarmupReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,

    CONSTRAINT "WarmupCapacityReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WarmupCapacityReservation_warmupJobId_key" ON "WarmupCapacityReservation"("warmupJobId");
CREATE INDEX "WarmupCapacityReservation_mailboxId_usageDate_status_idx" ON "WarmupCapacityReservation"("mailboxId", "usageDate", "status");
CREATE INDEX "WarmupCapacityReservation_workspaceId_status_idx" ON "WarmupCapacityReservation"("workspaceId", "status");

ALTER TABLE "WarmupCapacityReservation" ADD CONSTRAINT "WarmupCapacityReservation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarmupCapacityReservation" ADD CONSTRAINT "WarmupCapacityReservation_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarmupCapacityReservation" ADD CONSTRAINT "WarmupCapacityReservation_warmupJobId_fkey" FOREIGN KEY ("warmupJobId") REFERENCES "WarmupJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

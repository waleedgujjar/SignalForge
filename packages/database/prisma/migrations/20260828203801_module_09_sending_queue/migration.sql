-- CreateEnum
CREATE TYPE "SendingJobStatus" AS ENUM ('PENDING', 'SCHEDULED', 'PROCESSING', 'RETRYING', 'SENT', 'FAILED', 'CANCELLED', 'PAUSED');

-- CreateEnum
CREATE TYPE "SendErrorCategory" AS ENUM ('TEMPORARY', 'PERMANENT', 'AUTH', 'RATE_LIMIT', 'CONNECTION', 'BOUNCE', 'INVALID_ADDRESS', 'UNKNOWN');

-- CreateTable
CREATE TABLE "SendingJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignLeadId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "sequenceStepId" TEXT NOT NULL,
    "mailboxId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "SendingJobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
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
    "emailMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SendingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignDailyUsage" (
    "campaignId" TEXT NOT NULL,
    "usageDate" DATE NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignDailyUsage_pkey" PRIMARY KEY ("campaignId","usageDate")
);

-- CreateIndex
CREATE INDEX "SendingJob_workspaceId_status_scheduledAt_idx" ON "SendingJob"("workspaceId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "SendingJob_campaignId_status_idx" ON "SendingJob"("campaignId", "status");

-- CreateIndex
CREATE INDEX "SendingJob_mailboxId_scheduledAt_idx" ON "SendingJob"("mailboxId", "scheduledAt");

-- CreateIndex
CREATE INDEX "SendingJob_status_scheduledAt_idx" ON "SendingJob"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "SendingJob_campaignLeadId_sequenceStepId_key" ON "SendingJob"("campaignLeadId", "sequenceStepId");

-- CreateIndex
CREATE INDEX "CampaignDailyUsage_campaignId_usageDate_idx" ON "CampaignDailyUsage"("campaignId", "usageDate");

-- AddForeignKey
ALTER TABLE "SendingJob" ADD CONSTRAINT "SendingJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingJob" ADD CONSTRAINT "SendingJob_campaignLeadId_fkey" FOREIGN KEY ("campaignLeadId") REFERENCES "CampaignLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingJob" ADD CONSTRAINT "SendingJob_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingJob" ADD CONSTRAINT "SendingJob_sequenceStepId_fkey" FOREIGN KEY ("sequenceStepId") REFERENCES "CampaignStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingJob" ADD CONSTRAINT "SendingJob_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignDailyUsage" ADD CONSTRAINT "CampaignDailyUsage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

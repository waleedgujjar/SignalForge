-- CreateEnum
CREATE TYPE "LeadOutcomeType" AS ENUM ('MEETING_BOOKED', 'QUALIFIED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "LeadOutcomeSource" AS ENUM ('MANUAL', 'API', 'SYSTEM');

-- CreateTable
CREATE TABLE "LeadOutcomeEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "campaignId" TEXT,
    "conversationId" TEXT,
    "type" "LeadOutcomeType" NOT NULL,
    "source" "LeadOutcomeSource" NOT NULL DEFAULT 'MANUAL',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "note" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadOutcomeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceAnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "leadsCreated" INTEGER NOT NULL DEFAULT 0,
    "leadsVerified" INTEGER NOT NULL DEFAULT 0,
    "leadsQualified" INTEGER NOT NULL DEFAULT 0,
    "leadsContacted" INTEGER NOT NULL DEFAULT 0,
    "leadsReplied" INTEGER NOT NULL DEFAULT 0,
    "positiveReplies" INTEGER NOT NULL DEFAULT 0,
    "meetingsBooked" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "bounced" INTEGER NOT NULL DEFAULT 0,
    "hardBounces" INTEGER NOT NULL DEFAULT 0,
    "softBounces" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "unsubscribes" INTEGER NOT NULL DEFAULT 0,
    "complaints" INTEGER NOT NULL DEFAULT 0,
    "verifiedCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "riskyCount" INTEGER NOT NULL DEFAULT 0,
    "unknownCount" INTEGER NOT NULL DEFAULT 0,
    "warmupSent" INTEGER NOT NULL DEFAULT 0,
    "warmupFailed" INTEGER NOT NULL DEFAULT 0,
    "replyBreakdown" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceAnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadOutcomeEvent_workspaceId_occurredAt_idx" ON "LeadOutcomeEvent"("workspaceId", "occurredAt");

-- CreateIndex
CREATE INDEX "LeadOutcomeEvent_workspaceId_type_occurredAt_idx" ON "LeadOutcomeEvent"("workspaceId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "LeadOutcomeEvent_workspaceId_campaignId_type_occurredAt_idx" ON "LeadOutcomeEvent"("workspaceId", "campaignId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "LeadOutcomeEvent_leadId_idx" ON "LeadOutcomeEvent"("leadId");

-- CreateIndex
CREATE INDEX "WorkspaceAnalyticsSnapshot_workspaceId_snapshotDate_idx" ON "WorkspaceAnalyticsSnapshot"("workspaceId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceAnalyticsSnapshot_workspaceId_snapshotDate_key" ON "WorkspaceAnalyticsSnapshot"("workspaceId", "snapshotDate");

-- CreateIndex
CREATE INDEX "CampaignLead_campaignId_repliedAt_idx" ON "CampaignLead"("campaignId", "repliedAt");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_firstReplyAt_idx" ON "Conversation"("workspaceId", "firstReplyAt");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_campaignId_classification_idx" ON "Conversation"("workspaceId", "campaignId", "classification");

-- CreateIndex
CREATE INDEX "EmailMessage_workspaceId_sentAt_idx" ON "EmailMessage"("workspaceId", "sentAt");

-- CreateIndex
CREATE INDEX "EmailMessage_campaignId_jobId_idx" ON "EmailMessage"("campaignId", "jobId");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_industry_idx" ON "Lead"("workspaceId", "industry");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_jobTitle_idx" ON "Lead"("workspaceId", "jobTitle");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_status_createdAt_idx" ON "Lead"("workspaceId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "LeadOutcomeEvent" ADD CONSTRAINT "LeadOutcomeEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadOutcomeEvent" ADD CONSTRAINT "LeadOutcomeEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadOutcomeEvent" ADD CONSTRAINT "LeadOutcomeEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAnalyticsSnapshot" ADD CONSTRAINT "WorkspaceAnalyticsSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

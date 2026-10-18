-- Module 12: Reply / Inbox Management & Conversation Intelligence

-- CreateEnum InboundSyncStatus
CREATE TYPE "InboundSyncStatus" AS ENUM ('DISABLED', 'CONNECTED', 'SYNCING', 'ERROR', 'RECONNECT_REQUIRED');

-- CreateEnum InboxSyncJobStatus
CREATE TYPE "InboxSyncJobStatus" AS ENUM ('QUEUED', 'DISPATCHED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum ConversationStatus
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'NEEDS_RESPONSE', 'WAITING', 'INTERESTED', 'NOT_INTERESTED', 'UNSUBSCRIBED', 'CLOSED', 'ARCHIVED');

-- CreateEnum ConversationMatchStatus
CREATE TYPE "ConversationMatchStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'PARTIAL');

-- CreateEnum ReplyClassification
CREATE TYPE "ReplyClassification" AS ENUM ('INTERESTED', 'NOT_INTERESTED', 'QUESTION', 'NEEDS_FOLLOW_UP', 'OUT_OF_OFFICE', 'UNSUBSCRIBE', 'WRONG_PERSON', 'REFERRAL', 'POSITIVE', 'NEGATIVE', 'NEUTRAL', 'UNKNOWN');

-- CreateEnum ClassificationSource
CREATE TYPE "ClassificationSource" AS ENUM ('AI', 'USER', 'SYSTEM');

-- CreateEnum MessageDirection
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum ConversationMessageStatus
CREATE TYPE "ConversationMessageStatus" AS ENUM ('RECEIVED', 'SENT', 'FAILED', 'DEFERRED');

-- CreateEnum ConversationActivityType
CREATE TYPE "ConversationActivityType" AS ENUM ('CREATED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'CLASSIFIED', 'CLASSIFICATION_CHANGED', 'ASSIGNED', 'READ', 'UNREAD', 'ARCHIVED', 'CAMPAIGN_PAUSED', 'CAMPAIGN_RESUMED', 'CAMPAIGN_STOPPED', 'LEAD_UNSUBSCRIBED', 'MANUAL_MATCH', 'NOTE_ADDED', 'SYNC_ERROR');

-- AlterTable Mailbox: inbound fields
ALTER TABLE "Mailbox"
  ADD COLUMN "inboundEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "inboundStatus" "InboundSyncStatus" NOT NULL DEFAULT 'DISABLED',
  ADD COLUMN "lastInboundSyncAt" TIMESTAMP(3),
  ADD COLUMN "lastInboundError" TEXT;

CREATE INDEX "Mailbox_workspaceId_inboundEnabled_inboundStatus_idx" ON "Mailbox"("workspaceId", "inboundEnabled", "inboundStatus");

-- AlterTable Campaign: reply handling policy
ALTER TABLE "Campaign"
  ADD COLUMN "replyHandlingPolicy" JSONB NOT NULL DEFAULT '{"pauseOnReply":true,"stopOnReply":false,"autoArchiveOoo":false,"detectUnsubscribe":true}';

-- AlterTable CampaignLead: reply timestamps
ALTER TABLE "CampaignLead"
  ADD COLUMN "repliedAt" TIMESTAMP(3),
  ADD COLUMN "lastReplyAt" TIMESTAMP(3);

-- AlterTable EmailMessage: threading headers
ALTER TABLE "EmailMessage"
  ADD COLUMN "internetMessageId" TEXT,
  ADD COLUMN "inReplyTo" TEXT,
  ADD COLUMN "references" JSONB;

CREATE INDEX "EmailMessage_internetMessageId_idx" ON "EmailMessage"("internetMessageId");
CREATE INDEX "EmailMessage_providerMessageId_idx" ON "EmailMessage"("providerMessageId");

-- CreateTable MailboxInboundConfig
CREATE TABLE "MailboxInboundConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "imapHost" TEXT,
    "imapPort" INTEGER,
    "imapUsername" TEXT,
    "encryptionType" "SmtpEncryption" NOT NULL DEFAULT 'TLS',
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 5,
    "syncFolders" JSONB NOT NULL DEFAULT '["INBOX"]',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxInboundConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailboxInboundConfig_mailboxId_key" ON "MailboxInboundConfig"("mailboxId");
CREATE INDEX "MailboxInboundConfig_workspaceId_enabled_idx" ON "MailboxInboundConfig"("workspaceId", "enabled");

ALTER TABLE "MailboxInboundConfig" ADD CONSTRAINT "MailboxInboundConfig_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable MailboxSyncState
CREATE TABLE "MailboxSyncState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'IMAP',
    "lastSyncAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "cursor" JSONB NOT NULL DEFAULT '{}',
    "lastMessageUid" INTEGER,
    "status" "InboundSyncStatus" NOT NULL DEFAULT 'DISABLED',
    "errorCategory" TEXT,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailboxSyncState_mailboxId_key" ON "MailboxSyncState"("mailboxId");
CREATE INDEX "MailboxSyncState_workspaceId_status_idx" ON "MailboxSyncState"("workspaceId", "status");

ALTER TABLE "MailboxSyncState" ADD CONSTRAINT "MailboxSyncState_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable InboxSyncJob
CREATE TABLE "InboxSyncJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "status" "InboxSyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "bullmqJobId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "messagesFetched" INTEGER NOT NULL DEFAULT 0,
    "messagesProcessed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxSyncJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboxSyncJob_mailboxId_runKey_key" ON "InboxSyncJob"("mailboxId", "runKey");
CREATE INDEX "InboxSyncJob_workspaceId_status_createdAt_idx" ON "InboxSyncJob"("workspaceId", "status", "createdAt");
CREATE INDEX "InboxSyncJob_status_createdAt_idx" ON "InboxSyncJob"("status", "createdAt");

ALTER TABLE "InboxSyncJob" ADD CONSTRAINT "InboxSyncJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboxSyncJob" ADD CONSTRAINT "InboxSyncJob_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable Conversation
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "leadId" TEXT,
    "campaignId" TEXT,
    "campaignLeadId" TEXT,
    "subject" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "matchStatus" "ConversationMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "classification" "ReplyClassification",
    "classificationSource" "ClassificationSource",
    "classificationConfidence" DOUBLE PRECISION,
    "classifiedAt" TIMESTAMP(3),
    "suggestedAction" TEXT,
    "classificationSummary" TEXT,
    "assignedUserId" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "firstReplyAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Conversation_workspaceId_lastMessageAt_idx" ON "Conversation"("workspaceId", "lastMessageAt");
CREATE INDEX "Conversation_workspaceId_status_idx" ON "Conversation"("workspaceId", "status");
CREATE INDEX "Conversation_workspaceId_classification_idx" ON "Conversation"("workspaceId", "classification");
CREATE INDEX "Conversation_workspaceId_matchStatus_idx" ON "Conversation"("workspaceId", "matchStatus");
CREATE INDEX "Conversation_workspaceId_unreadCount_idx" ON "Conversation"("workspaceId", "unreadCount");
CREATE INDEX "Conversation_leadId_idx" ON "Conversation"("leadId");
CREATE INDEX "Conversation_campaignId_idx" ON "Conversation"("campaignId");
CREATE INDEX "Conversation_mailboxId_lastMessageAt_idx" ON "Conversation"("mailboxId", "lastMessageAt");
CREATE INDEX "Conversation_assignedUserId_idx" ON "Conversation"("assignedUserId");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_campaignLeadId_fkey" FOREIGN KEY ("campaignLeadId") REFERENCES "CampaignLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable ConversationMessage
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "providerMessageId" TEXT,
    "internetMessageId" TEXT,
    "inReplyTo" TEXT,
    "references" JSONB,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "toRecipients" JSONB NOT NULL DEFAULT '[]',
    "ccRecipients" JSONB NOT NULL DEFAULT '[]',
    "bccRecipients" JSONB NOT NULL DEFAULT '[]',
    "subject" TEXT,
    "textBody" TEXT,
    "htmlBodySanitized" TEXT,
    "attachmentsMetadata" JSONB NOT NULL DEFAULT '[]',
    "receivedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "status" "ConversationMessageStatus" NOT NULL DEFAULT 'RECEIVED',
    "classification" "ReplyClassification",
    "emailMessageId" TEXT,
    "sendingJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationMessage_workspaceId_providerMessageId_key" ON "ConversationMessage"("workspaceId", "providerMessageId");
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");
CREATE INDEX "ConversationMessage_workspaceId_internetMessageId_idx" ON "ConversationMessage"("workspaceId", "internetMessageId");
CREATE INDEX "ConversationMessage_inReplyTo_idx" ON "ConversationMessage"("inReplyTo");
CREATE INDEX "ConversationMessage_internetMessageId_idx" ON "ConversationMessage"("internetMessageId");

ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable ConversationNote
CREATE TABLE "ConversationNote" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConversationNote_conversationId_createdAt_idx" ON "ConversationNote"("conversationId", "createdAt");
CREATE INDEX "ConversationNote_workspaceId_idx" ON "ConversationNote"("workspaceId");

ALTER TABLE "ConversationNote" ADD CONSTRAINT "ConversationNote_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationNote" ADD CONSTRAINT "ConversationNote_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable ConversationActivity
CREATE TABLE "ConversationActivity" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "type" "ConversationActivityType" NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConversationActivity_conversationId_createdAt_idx" ON "ConversationActivity"("conversationId", "createdAt");
CREATE INDEX "ConversationActivity_workspaceId_createdAt_idx" ON "ConversationActivity"("workspaceId", "createdAt");

ALTER TABLE "ConversationActivity" ADD CONSTRAINT "ConversationActivity_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationActivity" ADD CONSTRAINT "ConversationActivity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

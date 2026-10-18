-- Module 13: Deliverability & Email Health

-- CreateEnum BounceType
CREATE TYPE "BounceType" AS ENUM ('HARD', 'SOFT');

-- CreateEnum DeliveryEventType
CREATE TYPE "DeliveryEventType" AS ENUM ('SENT', 'DELIVERED', 'BOUNCED', 'FAILED', 'COMPLAINT', 'UNSUBSCRIBE', 'REPLY');

-- CreateEnum DeliveryEventSource
CREATE TYPE "DeliveryEventSource" AS ENUM ('SENDING', 'INBOX', 'SYSTEM');

-- CreateEnum DeliverabilityProtectionLevel
CREATE TYPE "DeliverabilityProtectionLevel" AS ENUM ('NORMAL', 'WARNING', 'AT_RISK', 'CRITICAL');

-- CreateEnum RecipientBounceStatus
CREATE TYPE "RecipientBounceStatus" AS ENUM ('ACTIVE', 'AT_RISK', 'SUPPRESSED');

-- CreateEnum DnsCheckStatus
CREATE TYPE "DnsCheckStatus" AS ENUM ('PASS', 'FAIL', 'INVALID', 'UNKNOWN', 'NOT_CHECKED');

-- CreateEnum DeliverabilityAlertSeverity
CREATE TYPE "DeliverabilityAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum DeliverabilityAlertStatus
CREATE TYPE "DeliverabilityAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum DeliverabilityAlertType
CREATE TYPE "DeliverabilityAlertType" AS ENUM ('ELEVATED_BOUNCE_RATE', 'ELEVATED_FAILURE_RATE', 'ELEVATED_UNSUBSCRIBE_RATE', 'MAILBOX_HEALTH_DROP', 'MAILBOX_HEALTH_IMPROVED', 'HARD_BOUNCE_DETECTED', 'MAILBOX_PAUSED', 'DOMAIN_AUTH_ISSUE', 'SENDING_VELOCITY_ANOMALY');

-- CreateEnum DeliverabilityEntityType
CREATE TYPE "DeliverabilityEntityType" AS ENUM ('WORKSPACE', 'MAILBOX', 'CAMPAIGN', 'DOMAIN');

-- AlterEnum MailboxActivityType: protection transitions
ALTER TYPE "MailboxActivityType" ADD VALUE 'PROTECTION_PAUSED';
ALTER TYPE "MailboxActivityType" ADD VALUE 'PROTECTION_RESUMED';

-- AlterTable EmailMessage: delivery metadata
ALTER TABLE "EmailMessage"
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "bounceType" "BounceType",
  ADD COLUMN "smtpStatusCode" TEXT,
  ADD COLUMN "enhancedStatusCode" TEXT,
  ADD COLUMN "providerResponse" TEXT;

CREATE INDEX "EmailMessage_workspaceId_status_createdAt_idx" ON "EmailMessage"("workspaceId", "status", "createdAt");

-- AlterTable MailboxHealth: bounce counters + protection state
ALTER TABLE "MailboxHealth"
  ADD COLUMN "hardBounceCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "softBounceCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "protectionLevel" "DeliverabilityProtectionLevel" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "protectionReason" TEXT,
  ADD COLUMN "protectionUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "scoreBreakdown" JSONB NOT NULL DEFAULT '{}';

-- CreateTable EmailDeliveryEvent
CREATE TABLE "EmailDeliveryEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "emailMessageId" TEXT,
    "sendingJobId" TEXT,
    "mailboxId" TEXT,
    "leadId" TEXT,
    "campaignId" TEXT,
    "eventType" "DeliveryEventType" NOT NULL,
    "bounceType" "BounceType",
    "smtpStatusCode" TEXT,
    "enhancedStatusCode" TEXT,
    "providerResponse" TEXT,
    "source" "DeliveryEventSource" NOT NULL DEFAULT 'SENDING',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDeliveryEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailDeliveryEvent_workspaceId_idempotencyKey_key" ON "EmailDeliveryEvent"("workspaceId", "idempotencyKey");
CREATE INDEX "EmailDeliveryEvent_workspaceId_occurredAt_idx" ON "EmailDeliveryEvent"("workspaceId", "occurredAt");
CREATE INDEX "EmailDeliveryEvent_workspaceId_mailboxId_occurredAt_idx" ON "EmailDeliveryEvent"("workspaceId", "mailboxId", "occurredAt");
CREATE INDEX "EmailDeliveryEvent_workspaceId_campaignId_eventType_occurre_idx" ON "EmailDeliveryEvent"("workspaceId", "campaignId", "eventType", "occurredAt");
CREATE INDEX "EmailDeliveryEvent_workspaceId_eventType_occurredAt_idx" ON "EmailDeliveryEvent"("workspaceId", "eventType", "occurredAt");
CREATE INDEX "EmailDeliveryEvent_workspaceId_leadId_idx" ON "EmailDeliveryEvent"("workspaceId", "leadId");

ALTER TABLE "EmailDeliveryEvent" ADD CONSTRAINT "EmailDeliveryEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailDeliveryEvent" ADD CONSTRAINT "EmailDeliveryEvent_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailDeliveryEvent" ADD CONSTRAINT "EmailDeliveryEvent_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailDeliveryEvent" ADD CONSTRAINT "EmailDeliveryEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable RecipientBounceState
CREATE TABLE "RecipientBounceState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "lastBounceType" "BounceType",
    "bounceCount" INTEGER NOT NULL DEFAULT 0,
    "softBounceCount" INTEGER NOT NULL DEFAULT 0,
    "hardBounceCount" INTEGER NOT NULL DEFAULT 0,
    "status" "RecipientBounceStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSmtpCode" TEXT,
    "lastResponse" TEXT,
    "firstBounceAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBounceAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipientBounceState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecipientBounceState_workspaceId_email_key" ON "RecipientBounceState"("workspaceId", "email");
CREATE INDEX "RecipientBounceState_workspaceId_status_idx" ON "RecipientBounceState"("workspaceId", "status");

ALTER TABLE "RecipientBounceState" ADD CONSTRAINT "RecipientBounceState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable MailboxHealthSnapshot
CREATE TABLE "MailboxHealthSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "bounced" INTEGER NOT NULL DEFAULT 0,
    "hardBounces" INTEGER NOT NULL DEFAULT 0,
    "softBounces" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "unsubscribes" INTEGER NOT NULL DEFAULT 0,
    "complaints" INTEGER NOT NULL DEFAULT 0,
    "bounceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "failureRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "replyRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unsubscribeRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "healthScore" INTEGER NOT NULL DEFAULT 100,
    "protectionLevel" "DeliverabilityProtectionLevel" NOT NULL DEFAULT 'NORMAL',
    "scoreBreakdown" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxHealthSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailboxHealthSnapshot_mailboxId_snapshotDate_key" ON "MailboxHealthSnapshot"("mailboxId", "snapshotDate");
CREATE INDEX "MailboxHealthSnapshot_workspaceId_snapshotDate_idx" ON "MailboxHealthSnapshot"("workspaceId", "snapshotDate");
CREATE INDEX "MailboxHealthSnapshot_workspaceId_healthScore_idx" ON "MailboxHealthSnapshot"("workspaceId", "healthScore");

ALTER TABLE "MailboxHealthSnapshot" ADD CONSTRAINT "MailboxHealthSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MailboxHealthSnapshot" ADD CONSTRAINT "MailboxHealthSnapshot_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable CampaignHealthSnapshot
CREATE TABLE "CampaignHealthSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "bounced" INTEGER NOT NULL DEFAULT 0,
    "hardBounces" INTEGER NOT NULL DEFAULT 0,
    "softBounces" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "unsubscribes" INTEGER NOT NULL DEFAULT 0,
    "complaints" INTEGER NOT NULL DEFAULT 0,
    "bounceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "failureRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "replyRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unsubscribeRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "healthScore" INTEGER NOT NULL DEFAULT 100,
    "scoreBreakdown" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignHealthSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CampaignHealthSnapshot_campaignId_snapshotDate_key" ON "CampaignHealthSnapshot"("campaignId", "snapshotDate");
CREATE INDEX "CampaignHealthSnapshot_workspaceId_snapshotDate_idx" ON "CampaignHealthSnapshot"("workspaceId", "snapshotDate");
CREATE INDEX "CampaignHealthSnapshot_workspaceId_healthScore_idx" ON "CampaignHealthSnapshot"("workspaceId", "healthScore");

ALTER TABLE "CampaignHealthSnapshot" ADD CONSTRAINT "CampaignHealthSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignHealthSnapshot" ADD CONSTRAINT "CampaignHealthSnapshot_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable DomainHealthCheck
CREATE TABLE "DomainHealthCheck" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "spfStatus" "DnsCheckStatus" NOT NULL DEFAULT 'NOT_CHECKED',
    "dkimStatus" "DnsCheckStatus" NOT NULL DEFAULT 'NOT_CHECKED',
    "dmarcStatus" "DnsCheckStatus" NOT NULL DEFAULT 'NOT_CHECKED',
    "mxStatus" "DnsCheckStatus" NOT NULL DEFAULT 'NOT_CHECKED',
    "spfRecord" TEXT,
    "dmarcPolicy" TEXT,
    "dkimSelectors" JSONB NOT NULL DEFAULT '[]',
    "rawResults" JSONB NOT NULL DEFAULT '{}',
    "lastError" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainHealthCheck_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DomainHealthCheck_workspaceId_domain_key" ON "DomainHealthCheck"("workspaceId", "domain");
CREATE INDEX "DomainHealthCheck_workspaceId_expiresAt_idx" ON "DomainHealthCheck"("workspaceId", "expiresAt");

ALTER TABLE "DomainHealthCheck" ADD CONSTRAINT "DomainHealthCheck_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable DeliverabilityAlert
CREATE TABLE "DeliverabilityAlert" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "severity" "DeliverabilityAlertSeverity" NOT NULL,
    "alertType" "DeliverabilityAlertType" NOT NULL,
    "entityType" "DeliverabilityEntityType" NOT NULL,
    "entityId" TEXT,
    "entityLabel" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "recommendation" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "status" "DeliverabilityAlertStatus" NOT NULL DEFAULT 'OPEN',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverabilityAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliverabilityAlert_workspaceId_dedupeKey_key" ON "DeliverabilityAlert"("workspaceId", "dedupeKey");
CREATE INDEX "DeliverabilityAlert_workspaceId_status_occurredAt_idx" ON "DeliverabilityAlert"("workspaceId", "status", "occurredAt");
CREATE INDEX "DeliverabilityAlert_workspaceId_severity_occurredAt_idx" ON "DeliverabilityAlert"("workspaceId", "severity", "occurredAt");
CREATE INDEX "DeliverabilityAlert_workspaceId_entityType_entityId_idx" ON "DeliverabilityAlert"("workspaceId", "entityType", "entityId");

ALTER TABLE "DeliverabilityAlert" ADD CONSTRAINT "DeliverabilityAlert_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable WorkspaceDeliverabilityPolicy
CREATE TABLE "WorkspaceDeliverabilityPolicy" (
    "workspaceId" TEXT NOT NULL,
    "protection" JSONB NOT NULL DEFAULT '{}',
    "thresholds" JSONB NOT NULL DEFAULT '{}',
    "weights" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceDeliverabilityPolicy_pkey" PRIMARY KEY ("workspaceId")
);

ALTER TABLE "WorkspaceDeliverabilityPolicy" ADD CONSTRAINT "WorkspaceDeliverabilityPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "MailboxProvider" AS ENUM ('SMTP', 'GOOGLE_OAUTH', 'MICROSOFT_OAUTH');

-- CreateEnum
CREATE TYPE "SmtpEncryption" AS ENUM ('NONE', 'TLS', 'SSL');

-- CreateEnum
CREATE TYPE "MailboxStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "HealthStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'UNHEALTHY');

-- CreateEnum
CREATE TYPE "WarmupStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('VERIFIED', 'RISKY', 'INVALID', 'UNKNOWN', 'DISPOSABLE', 'ROLE_BASED');

-- CreateEnum
CREATE TYPE "SuppressionType" AS ENUM ('EMAIL', 'DOMAIN');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('MANUAL', 'UNSUBSCRIBED', 'BOUNCED', 'SPAM_COMPLAINT', 'INVALID', 'RISKY');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CampaignLeadStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'BOUNCED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "RotationStrategy" AS ENUM ('ROUND_ROBIN', 'LEAST_UTILIZED', 'HEALTH_AWARE', 'CAMPAIGN_SPECIFIC');

-- CreateEnum
CREATE TYPE "EmailMessageStatus" AS ENUM ('QUEUED', 'SENT', 'BLOCKED', 'FAILED', 'BOUNCED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mailbox" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "MailboxProvider" NOT NULL DEFAULT 'SMTP',
    "emailAddress" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUsername" TEXT,
    "encryptionType" "SmtpEncryption" NOT NULL DEFAULT 'TLS',
    "status" "MailboxStatus" NOT NULL DEFAULT 'ACTIVE',
    "dailySendingLimit" INTEGER NOT NULL DEFAULT 100,
    "currentDailyUsage" INTEGER NOT NULL DEFAULT 0,
    "usageResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "healthStatus" "HealthStatus" NOT NULL DEFAULT 'HEALTHY',
    "warmupStatus" "WarmupStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "lastSuccessfulSendAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxCredential" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxHealth" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 100,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "fullName" TEXT,
    "company" TEXT,
    "companyDomain" TEXT,
    "jobTitle" TEXT,
    "industry" TEXT,
    "countryCode" TEXT,
    "country" TEXT,
    "region" TEXT,
    "state" TEXT,
    "city" TEXT,
    "website" TEXT,
    "icpScore" INTEGER,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadVerification" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "score" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "domain" TEXT,
    "mxStatus" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT 'LEAD',
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL DEFAULT 'TEXT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "SuppressionType" NOT NULL,
    "value" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "rotationStrategy" "RotationStrategy" NOT NULL DEFAULT 'HEALTH_AWARE',
    "dailySendingLimit" INTEGER,
    "scheduleConfig" JSONB NOT NULL DEFAULT '{}',
    "verificationPolicy" JSONB NOT NULL DEFAULT '{}',
    "suppressionPolicy" JSONB NOT NULL DEFAULT '{}',
    "pausedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignStep" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "subjectTemplate" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignLead" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "currentStepOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "CampaignLeadStatus" NOT NULL DEFAULT 'PENDING',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),

    CONSTRAINT "CampaignLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMailbox" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,

    CONSTRAINT "CampaignMailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendingPolicy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "rotationStrategy" "RotationStrategy" NOT NULL DEFAULT 'HEALTH_AWARE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SendingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceVerificationPolicy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "excludeInvalid" BOOLEAN NOT NULL DEFAULT true,
    "excludeDisposable" BOOLEAN NOT NULL DEFAULT true,
    "excludeHighRisk" BOOLEAN NOT NULL DEFAULT true,
    "minScore" INTEGER NOT NULL DEFAULT 50,

    CONSTRAINT "WorkspaceVerificationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT,
    "campaignLeadId" TEXT,
    "leadId" TEXT,
    "mailboxId" TEXT,
    "jobId" TEXT,
    "templateSubject" TEXT,
    "templateBody" TEXT,
    "renderedSubject" TEXT,
    "renderedBody" TEXT,
    "status" "EmailMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "blockReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_token_idx" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_workspaceId_emailAddress_key" ON "Mailbox"("workspaceId", "emailAddress");

-- CreateIndex
CREATE INDEX "Mailbox_workspaceId_status_idx" ON "Mailbox"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxCredential_mailboxId_key" ON "MailboxCredential"("mailboxId");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxHealth_mailboxId_key" ON "MailboxHealth"("mailboxId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_workspaceId_email_key" ON "Lead"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_countryCode_idx" ON "Lead"("workspaceId", "countryCode");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_countryCode_state_idx" ON "Lead"("workspaceId", "countryCode", "state");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_countryCode_state_city_idx" ON "Lead"("workspaceId", "countryCode", "state", "city");

-- CreateIndex
CREATE UNIQUE INDEX "LeadVerification_leadId_key" ON "LeadVerification"("leadId");

-- CreateIndex
CREATE INDEX "LeadVerification_status_idx" ON "LeadVerification"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_workspaceId_key_key" ON "CustomField"("workspaceId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_workspaceId_type_value_key" ON "Suppression"("workspaceId", "type", "value");

-- CreateIndex
CREATE INDEX "Suppression_workspaceId_type_value_idx" ON "Suppression"("workspaceId", "type", "value");

-- CreateIndex
CREATE INDEX "Campaign_workspaceId_status_createdAt_idx" ON "Campaign"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignStep_campaignId_order_key" ON "CampaignStep"("campaignId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLead_campaignId_leadId_key" ON "CampaignLead"("campaignId", "leadId");

-- CreateIndex
CREATE INDEX "CampaignLead_campaignId_status_idx" ON "CampaignLead"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMailbox_campaignId_mailboxId_key" ON "CampaignMailbox"("campaignId", "mailboxId");

-- CreateIndex
CREATE INDEX "SendingPolicy_workspaceId_idx" ON "SendingPolicy"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceVerificationPolicy_workspaceId_key" ON "WorkspaceVerificationPolicy"("workspaceId");

-- CreateIndex
CREATE INDEX "EmailMessage_workspaceId_campaignId_idx" ON "EmailMessage"("workspaceId", "campaignId");

-- CreateIndex
CREATE INDEX "EmailMessage_mailboxId_createdAt_idx" ON "EmailMessage"("mailboxId", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mailbox" ADD CONSTRAINT "Mailbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxCredential" ADD CONSTRAINT "MailboxCredential_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxHealth" ADD CONSTRAINT "MailboxHealth_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadVerification" ADD CONSTRAINT "LeadVerification_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignStep" ADD CONSTRAINT "CampaignStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMailbox" ADD CONSTRAINT "CampaignMailbox_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMailbox" ADD CONSTRAINT "CampaignMailbox_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingPolicy" ADD CONSTRAINT "SendingPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceVerificationPolicy" ADD CONSTRAINT "WorkspaceVerificationPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

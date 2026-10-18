-- CreateEnum
CREATE TYPE "MailboxConnectionTestStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "SmtpErrorCategory" AS ENUM ('AUTH_FAILED', 'CONNECTION_REFUSED', 'CONNECTION_TIMEOUT', 'INVALID_HOST', 'INVALID_PORT', 'TLS_FAILED', 'PROVIDER_REJECTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MailboxActivityType" AS ENUM ('CREATED', 'UPDATED', 'TESTED', 'VERIFIED', 'ENABLED', 'DISABLED', 'DELETED', 'PASSWORD_UPDATED');

-- AlterEnum
ALTER TYPE "HealthStatus" ADD VALUE 'UNKNOWN';

-- AlterEnum
ALTER TYPE "MailboxStatus" ADD VALUE 'UNVERIFIED';
ALTER TYPE "MailboxStatus" ADD VALUE 'DISABLED';

-- AlterTable
ALTER TABLE "Mailbox" ADD COLUMN     "lastTestedAt" TIMESTAMP(3),
ADD COLUMN     "name" TEXT,
ADD COLUMN     "replyTo" TEXT,
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MailboxConnectionTest" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "MailboxConnectionTestStatus" NOT NULL,
    "errorCategory" "SmtpErrorCategory",
    "summary" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxConnectionTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxActivity" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "type" "MailboxActivityType" NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxDailyUsage" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "usageDate" DATE NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxDailyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailboxConnectionTest_mailboxId_createdAt_idx" ON "MailboxConnectionTest"("mailboxId", "createdAt");

-- CreateIndex
CREATE INDEX "MailboxConnectionTest_workspaceId_createdAt_idx" ON "MailboxConnectionTest"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "MailboxActivity_mailboxId_createdAt_idx" ON "MailboxActivity"("mailboxId", "createdAt");

-- CreateIndex
CREATE INDEX "MailboxActivity_workspaceId_createdAt_idx" ON "MailboxActivity"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "MailboxDailyUsage_mailboxId_usageDate_idx" ON "MailboxDailyUsage"("mailboxId", "usageDate");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxDailyUsage_mailboxId_usageDate_key" ON "MailboxDailyUsage"("mailboxId", "usageDate");

-- AddForeignKey
ALTER TABLE "MailboxConnectionTest" ADD CONSTRAINT "MailboxConnectionTest_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxActivity" ADD CONSTRAINT "MailboxActivity_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxDailyUsage" ADD CONSTRAINT "MailboxDailyUsage_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

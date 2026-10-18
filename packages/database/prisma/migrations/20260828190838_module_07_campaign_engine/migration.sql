/*
  Warnings:

  - Added the required column `updatedAt` to the `CampaignStep` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "DuplicateEnrollmentPolicy" AS ENUM ('BLOCK', 'ALLOW', 'WARN');

-- CreateEnum
CREATE TYPE "StepType" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "DelayUnit" AS ENUM ('MINUTES', 'HOURS', 'DAYS');

-- CreateEnum
CREATE TYPE "CampaignActivityType" AS ENUM ('CREATED', 'UPDATED', 'LEADS_ADDED', 'LEADS_REMOVED', 'SEQUENCE_UPDATED', 'SCHEDULE_UPDATED', 'VALIDATED', 'LAUNCHED', 'PAUSED', 'RESUMED', 'STOPPED', 'ARCHIVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CampaignStatus" ADD VALUE 'SCHEDULED';
ALTER TYPE "CampaignStatus" ADD VALUE 'STOPPED';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "description" TEXT,
ADD COLUMN     "duplicateEnrollmentPolicy" "DuplicateEnrollmentPolicy" NOT NULL DEFAULT 'BLOCK',
ADD COLUMN     "launchedAt" TIMESTAMP(3),
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "stoppedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CampaignStep" ADD COLUMN     "delayAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "delayUnit" "DelayUnit" NOT NULL DEFAULT 'DAYS',
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "type" "StepType" NOT NULL DEFAULT 'EMAIL',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "CampaignActivity" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "type" "CampaignActivityType" NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignActivity_campaignId_createdAt_idx" ON "CampaignActivity"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignActivity_workspaceId_createdAt_idx" ON "CampaignActivity"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignStep_campaignId_order_idx" ON "CampaignStep"("campaignId", "order");

-- AddForeignKey
ALTER TABLE "CampaignActivity" ADD CONSTRAINT "CampaignActivity_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

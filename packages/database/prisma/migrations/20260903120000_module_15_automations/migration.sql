-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkflowExecutionStatus" AS ENUM ('RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowNodeExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WorkflowNodeErrorCategory" AS ENUM ('VALIDATION_ERROR', 'CONFIGURATION_ERROR', 'TRANSIENT_ERROR', 'PERMISSION_ERROR', 'SAFETY_BLOCK', 'SYSTEM_ERROR');

-- CreateEnum
CREATE TYPE "WorkflowActivityType" AS ENUM ('CREATED', 'UPDATED', 'PUBLISHED', 'PAUSED', 'RESUMED', 'ARCHIVED', 'DUPLICATED');

-- CreateEnum
CREATE TYPE "WorkflowEventType" AS ENUM ('LEAD_CREATED', 'LEAD_IMPORTED', 'LEAD_VERIFIED', 'LEAD_QUALIFIED', 'CAMPAIGN_STARTED', 'EMAIL_SENT', 'EMAIL_DELIVERED', 'EMAIL_BOUNCED', 'EMAIL_REPLIED', 'POSITIVE_REPLY_RECEIVED', 'NEGATIVE_REPLY_RECEIVED', 'UNSUBSCRIBE_RECEIVED', 'MEETING_BOOKED', 'WEBSITE_ANALYSIS_COMPLETED');

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedVersionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowVersion" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "nodes" JSONB NOT NULL DEFAULT '[]',
    "edges" JSONB NOT NULL DEFAULT '[]',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowExecution" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "workflowVersionId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "triggerEventId" TEXT,
    "status" "WorkflowExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "currentNodeId" TEXT,
    "resumeAt" TIMESTAMP(3),
    "context" JSONB NOT NULL DEFAULT '{}',
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowNodeExecution" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "status" "WorkflowNodeExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "errorCategory" "WorkflowNodeErrorCategory",
    "result" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowNodeExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventType" "WorkflowEventType" NOT NULL,
    "leadId" TEXT,
    "campaignId" TEXT,
    "mailboxId" TEXT,
    "conversationId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowActivity" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "type" "WorkflowActivityType" NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "workflowExecutionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_publishedVersionId_key" ON "Workflow"("publishedVersionId");

-- CreateIndex
CREATE INDEX "Workflow_workspaceId_status_idx" ON "Workflow"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Workflow_workspaceId_createdAt_idx" ON "Workflow"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowVersion_workflowId_idx" ON "WorkflowVersion"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowVersion_workflowId_version_key" ON "WorkflowVersion"("workflowId", "version");

-- CreateIndex
CREATE INDEX "WorkflowExecution_workflowId_leadId_status_idx" ON "WorkflowExecution"("workflowId", "leadId", "status");

-- CreateIndex
CREATE INDEX "WorkflowExecution_workspaceId_status_idx" ON "WorkflowExecution"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "WorkflowExecution_status_resumeAt_idx" ON "WorkflowExecution"("status", "resumeAt");

-- CreateIndex
CREATE INDEX "WorkflowExecution_workflowId_createdAt_idx" ON "WorkflowExecution"("workflowId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowNodeExecution_executionId_idx" ON "WorkflowNodeExecution"("executionId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowNodeExecution_executionId_nodeId_key" ON "WorkflowNodeExecution"("executionId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowEvent_workspaceId_idempotencyKey_key" ON "WorkflowEvent"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WorkflowEvent_workspaceId_eventType_createdAt_idx" ON "WorkflowEvent"("workspaceId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowEvent_processedAt_idx" ON "WorkflowEvent"("processedAt");

-- CreateIndex
CREATE INDEX "WorkflowActivity_workflowId_createdAt_idx" ON "WorkflowActivity"("workflowId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowActivity_workspaceId_createdAt_idx" ON "WorkflowActivity"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_workspaceId_userId_readAt_idx" ON "Notification"("workspaceId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_workspaceId_createdAt_idx" ON "Notification"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "WorkflowVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_workflowVersionId_fkey" FOREIGN KEY ("workflowVersionId") REFERENCES "WorkflowVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_triggerEventId_fkey" FOREIGN KEY ("triggerEventId") REFERENCES "WorkflowEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowNodeExecution" ADD CONSTRAINT "WorkflowNodeExecution_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "WorkflowExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEvent" ADD CONSTRAINT "WorkflowEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowActivity" ADD CONSTRAINT "WorkflowActivity_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowActivity" ADD CONSTRAINT "WorkflowActivity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workflowExecutionId_fkey" FOREIGN KEY ("workflowExecutionId") REFERENCES "WorkflowExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

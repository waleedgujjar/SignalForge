import { prisma, type Prisma, type WorkflowEventType } from '@signalforge/database';
import { loadEnv } from '@signalforge/config';
import type { Queue } from 'bullmq';
import { createQueue } from './bullmq.js';
import { createRedisConnection } from './redis.js';
import { enqueueWorkflowEvent, type WorkflowEventQueuePayload } from './workflow.js';

const WORKFLOW_QUEUE_NAME = 'workflow';

export interface PublishWorkflowEventInput {
  eventType: WorkflowEventType;
  workspaceId: string;
  leadId?: string;
  campaignId?: string;
  mailboxId?: string;
  conversationId?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

let workflowQueue: Queue<WorkflowEventQueuePayload> | null = null;

function getWorkflowQueue() {
  if (!workflowQueue) {
    const env = loadEnv();
    workflowQueue = createQueue(WORKFLOW_QUEUE_NAME, createRedisConnection(env.REDIS_URL));
  }
  return workflowQueue;
}

export async function publishWorkflowEvent(input: PublishWorkflowEventInput): Promise<string | null> {
  const payload = {
    eventType: input.eventType,
    workspaceId: input.workspaceId,
    leadId: input.leadId ?? null,
    campaignId: input.campaignId ?? null,
    mailboxId: input.mailboxId ?? null,
    conversationId: input.conversationId ?? null,
    timestamp: new Date().toISOString(),
    metadata: input.metadata ?? {},
  };

  try {
    const event = await prisma.workflowEvent.create({
      data: {
        workspaceId: input.workspaceId,
        eventType: input.eventType,
        leadId: input.leadId,
        campaignId: input.campaignId,
        mailboxId: input.mailboxId,
        conversationId: input.conversationId,
        idempotencyKey: input.idempotencyKey,
        payload: payload as Prisma.InputJsonValue,
      },
    });

    await enqueueWorkflowEvent(getWorkflowQueue(), { workflowEventId: event.id });
    return event.id;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'P2002') {
      const existing = await prisma.workflowEvent.findFirst({
        where: {
          workspaceId: input.workspaceId,
          idempotencyKey: input.idempotencyKey,
        },
      });
      return existing?.id ?? null;
    }
    throw err;
  }
}

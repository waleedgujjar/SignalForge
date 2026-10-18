import { prisma, type Prisma } from '@signalforge/database';
import type { DelayUnit } from '@signalforge/campaigns';
import { loadEnv } from '@signalforge/config';
import { createQueue, createRedisConnection, QUEUE_NAMES } from '@signalforge/queue';
import { runActionNode } from './actions/index.js';
import { buildLeadConditionContext, evaluateCondition } from './conditions.js';
import { calculateResumeAt } from './delay.js';
import {
  getNextNodeId,
  getNodeById,
  parseWorkflowGraph,
} from './graph.js';
import { hasExceededStepLimit, isExecutionExpired } from './limits.js';
import { enqueueWorkflowStep, type WorkflowStepQueuePayload } from './queue-helpers.js';
import { matchWorkflowsForEvent } from './trigger-matcher.js';
import type { ConditionConfig, WorkflowContext } from './types.js';

let stepQueue: ReturnType<typeof createQueue<WorkflowStepQueuePayload>> | null = null;

function getStepQueue() {
  if (!stepQueue) {
    const env = loadEnv();
    stepQueue = createQueue(QUEUE_NAMES.WORKFLOW, createRedisConnection(env.REDIS_URL));
  }
  return stepQueue;
}

const ACTIVE_STATUSES = ['RUNNING', 'WAITING', 'PAUSED'] as const;

export async function processWorkflowEvent(workflowEventId: string): Promise<void> {
  const event = await prisma.workflowEvent.findUnique({ where: { id: workflowEventId } });
  if (!event) return;

  if (event.processedAt) return;

  const matches = await matchWorkflowsForEvent({
    id: event.id,
    eventType: event.eventType,
    workspaceId: event.workspaceId,
    leadId: event.leadId,
    campaignId: event.campaignId,
    payload: event.payload as Record<string, unknown>,
  });

  if (event.leadId) {
    for (const match of matches) {
      await startExecution({
        workflowId: match.workflowId,
        workflowVersionId: match.workflowVersionId,
        workspaceId: event.workspaceId,
        leadId: event.leadId!,
        triggerEventId: event.id,
        triggerNodeId: match.triggerNodeId,
        context: {
          leadId: event.leadId,
          workspaceId: event.workspaceId,
          campaignId: event.campaignId ?? undefined,
          mailboxId: event.mailboxId ?? undefined,
          conversationId: event.conversationId ?? undefined,
          triggerEventType: event.eventType,
          metadata: (event.payload as Record<string, unknown>)?.metadata as Record<string, unknown>,
        },
      });
    }
  }

  await prisma.workflowEvent.update({
    where: { id: event.id },
    data: { processedAt: new Date() },
  });
}

async function startExecution(input: {
  workflowId: string;
  workflowVersionId: string;
  workspaceId: string;
  leadId: string;
  triggerEventId: string;
  triggerNodeId: string;
  context: WorkflowContext;
}): Promise<void> {
  const workflow = await prisma.workflow.findFirst({
    where: { id: input.workflowId, workspaceId: input.workspaceId },
  });
  if (!workflow || workflow.status !== 'ACTIVE') return;

  const existing = await prisma.workflowExecution.findFirst({
    where: {
      workflowId: input.workflowId,
      leadId: input.leadId,
      status: { in: [...ACTIVE_STATUSES] },
    },
  });
  if (existing) return;

  const execution = await prisma.workflowExecution.create({
    data: {
      workspaceId: input.workspaceId,
      workflowId: input.workflowId,
      workflowVersionId: input.workflowVersionId,
      leadId: input.leadId,
      triggerEventId: input.triggerEventId,
      status: 'RUNNING',
      currentNodeId: input.triggerNodeId,
      context: input.context as unknown as Prisma.InputJsonValue,
    },
  });

  const version = await prisma.workflowVersion.findUnique({
    where: { id: input.workflowVersionId },
  });
  if (!version) return;

  const graph = parseWorkflowGraph(version.nodes, version.edges);
  const firstNodeId = getNextNodeId(graph, input.triggerNodeId);
  if (!firstNodeId) {
    await completeExecution(execution.id);
    return;
  }

  await prisma.workflowExecution.update({
    where: { id: execution.id },
    data: { currentNodeId: firstNodeId },
  });

  await enqueueWorkflowStep(getStepQueue(), { executionId: execution.id, reason: 'STEP' });
}

export async function advanceWorkflowExecution(
  executionId: string,
  reason: 'STEP' | 'DELAY_RESUME' | 'RETRY' = 'STEP',
): Promise<void> {
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
    include: { workflow: true, workflowVersion: true },
  });
  if (!execution) return;

  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(execution.status)) return;

  if (execution.workflow.status === 'PAUSED' && execution.status === 'WAITING') return;
  if (execution.workflow.status === 'PAUSED' && reason !== 'DELAY_RESUME') {
    if (execution.status === 'RUNNING') {
      await prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { status: 'PAUSED' },
      });
    }
    return;
  }

  if (execution.status === 'WAITING' && reason === 'DELAY_RESUME') {
    if (execution.resumeAt && execution.resumeAt > new Date()) return;
    await prisma.workflowExecution.update({
      where: { id: execution.id },
      data: { status: 'RUNNING', resumeAt: null },
    });
  } else if (execution.status === 'WAITING') {
    return;
  }

  if (isExecutionExpired(execution.startedAt)) {
    await failExecution(execution.id, 'Execution exceeded maximum duration');
    return;
  }

  if (hasExceededStepLimit(execution.stepCount)) {
    await failExecution(execution.id, 'Execution exceeded maximum step count');
    return;
  }

  const graph = parseWorkflowGraph(execution.workflowVersion.nodes, execution.workflowVersion.edges);
  const nodeId = execution.currentNodeId;
  if (!nodeId) {
    await completeExecution(execution.id);
    return;
  }

  const node = getNodeById(graph, nodeId);
  if (!node) {
    await failExecution(execution.id, `Node ${nodeId} not found`);
    return;
  }

  if (node.type === 'TRIGGER') {
    const nextId = getNextNodeId(graph, node.id);
    await moveToNode(execution.id, nextId, execution.stepCount);
    if (nextId) {
      await enqueueWorkflowStep(getStepQueue(), { executionId, reason: 'STEP' });
    } else {
      await completeExecution(execution.id);
    }
    return;
  }

  let nodeExecution;
  try {
    nodeExecution = await prisma.workflowNodeExecution.create({
      data: {
        executionId: execution.id,
        nodeId: node.id,
        nodeType: node.type,
        status: 'RUNNING',
        attempts: 1,
        startedAt: new Date(),
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'P2002') {
      const existing = await prisma.workflowNodeExecution.findUnique({
        where: { executionId_nodeId: { executionId: execution.id, nodeId: node.id } },
      });
      if (existing?.status === 'COMPLETED') {
        const handle = (existing.result as { branch?: string })?.branch ?? 'default';
        const nextId = getNextNodeId(graph, node.id, handle);
        await moveToNode(execution.id, nextId, execution.stepCount + 1);
        if (nextId) {
          await enqueueWorkflowStep(getStepQueue(), { executionId, reason: 'STEP' });
        } else {
          await completeExecution(execution.id);
        }
      }
      return;
    }
    throw err;
  }

  const context: WorkflowContext = {
    ...((execution.context as unknown as WorkflowContext) ?? {
      leadId: execution.leadId,
      workspaceId: execution.workspaceId,
    }),
    metadata: {
      ...(((execution.context as unknown as WorkflowContext)?.metadata) ?? {}),
      executionId: execution.id,
    },
  };

  try {
    if (node.type === 'DELAY') {
      const amount = Number(node.data.amount ?? 0);
      const unit = (node.data.unit ?? 'HOURS') as DelayUnit;
      const useBusinessHours = Boolean(node.data.useBusinessHours);
      const resumeAt = calculateResumeAt(new Date(), amount, unit, useBusinessHours);

      await prisma.workflowNodeExecution.update({
        where: { id: nodeExecution.id },
        data: { status: 'COMPLETED', completedAt: new Date(), result: { resumeAt: resumeAt.toISOString() } },
      });

      const nextId = getNextNodeId(graph, node.id);
      await prisma.workflowExecution.update({
        where: { id: execution.id },
        data: {
          status: 'WAITING',
          resumeAt,
          currentNodeId: nextId ?? node.id,
          stepCount: execution.stepCount + 1,
        },
      });

      if (nextId) {
        const delayMs = Math.max(0, resumeAt.getTime() - Date.now());
        await enqueueWorkflowStep(
          getStepQueue(),
          { executionId, reason: 'DELAY_RESUME' },
          { delayMs },
        );
      }
      return;
    }

    if (node.type === 'CONDITION') {
      const config = node.data as unknown as ConditionConfig;
      const evalContext = await buildLeadConditionContext(
        execution.workspaceId,
        execution.leadId,
        context.metadata ?? {},
      );
      const passed = evaluateCondition(config, evalContext);
      const branch = passed ? 'yes' : 'no';

      await prisma.workflowNodeExecution.update({
        where: { id: nodeExecution.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          result: { passed, branch },
        },
      });

      const nextId = getNextNodeId(graph, node.id, branch);
      await moveToNode(execution.id, nextId, execution.stepCount + 1);
      if (nextId) {
        await enqueueWorkflowStep(getStepQueue(), { executionId, reason: 'STEP' });
      } else {
        await completeExecution(execution.id);
      }
      return;
    }

    const result = await runActionNode(node, context);

    if (!result.success) {
      const isTransient = result.errorCategory === 'TRANSIENT_ERROR';
      await prisma.workflowNodeExecution.update({
        where: { id: nodeExecution.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          error: result.error,
          errorCategory: result.errorCategory ?? 'SYSTEM_ERROR',
        },
      });

      if (isTransient && nodeExecution.attempts < 3) {
        await enqueueWorkflowStep(getStepQueue(), { executionId, reason: 'RETRY' });
        return;
      }

      await failExecution(execution.id, result.error ?? 'Action failed');
      return;
    }

    if (node.type === 'STOP_WORKFLOW') {
      await prisma.workflowNodeExecution.update({
        where: { id: nodeExecution.id },
        data: { status: 'COMPLETED', completedAt: new Date(), result: { stopped: true } },
      });
      await completeExecution(execution.id);
      return;
    }

    const branch = result.branch ?? 'default';
    await prisma.workflowNodeExecution.update({
      where: { id: nodeExecution.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        result: { ...(result.output ?? {}), branch },
      },
    });

    const nextId = getNextNodeId(graph, node.id, branch);
    await moveToNode(execution.id, nextId, execution.stepCount + 1);
    if (nextId) {
      await enqueueWorkflowStep(getStepQueue(), { executionId, reason: 'STEP' });
    } else {
      await completeExecution(execution.id);
    }
  } catch (err) {
    await prisma.workflowNodeExecution.update({
      where: { id: nodeExecution.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        error: err instanceof Error ? err.message : 'Unknown error',
        errorCategory: 'SYSTEM_ERROR',
      },
    });
    await failExecution(execution.id, err instanceof Error ? err.message : 'Unknown error');
  }
}

async function moveToNode(
  executionId: string,
  nodeId: string | undefined,
  stepCount: number,
): Promise<void> {
  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: { currentNodeId: nodeId ?? null, stepCount },
  });
}

async function completeExecution(executionId: string): Promise<void> {
  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: { status: 'COMPLETED', completedAt: new Date(), currentNodeId: null },
  });
}

async function failExecution(executionId: string, error: string): Promise<void> {
  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: { status: 'FAILED', completedAt: new Date() },
  });
  console.error(`Workflow execution ${executionId} failed: ${error}`);
}

export async function cancelActiveExecutions(workflowId: string): Promise<number> {
  const result = await prisma.workflowExecution.updateMany({
    where: {
      workflowId,
      status: { in: ['RUNNING', 'WAITING', 'PAUSED'] },
    },
    data: { status: 'CANCELLED', completedAt: new Date() },
  });
  return result.count;
}

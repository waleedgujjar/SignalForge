import type { JobsOptions, Queue } from 'bullmq';

export interface WorkflowEventQueuePayload {
  workflowEventId: string;
}

export interface WorkflowStepQueuePayload {
  executionId: string;
  reason: 'STEP' | 'DELAY_RESUME' | 'RETRY';
}

export type WorkflowQueuePayload = WorkflowEventQueuePayload | WorkflowStepQueuePayload;

export const WORKFLOW_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 30_000,
  },
  removeOnComplete: 500,
  removeOnFail: 1000,
};

export async function enqueueWorkflowEvent(
  queue: Queue<WorkflowEventQueuePayload>,
  payload: WorkflowEventQueuePayload,
) {
  return queue.add('workflow-event', payload, {
    ...WORKFLOW_JOB_OPTIONS,
    jobId: `workflow-event-${payload.workflowEventId}`,
  });
}

export async function enqueueWorkflowStep(
  queue: Queue<WorkflowStepQueuePayload>,
  payload: WorkflowStepQueuePayload,
  options?: { delayMs?: number },
) {
  return queue.add('workflow-step', payload, {
    ...WORKFLOW_JOB_OPTIONS,
    jobId: `workflow-step-${payload.executionId}-${payload.reason}-${Date.now()}`,
    delay: options?.delayMs,
  });
}

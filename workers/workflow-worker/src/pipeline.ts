import { advanceWorkflowExecution, processWorkflowEvent } from '@signalforge/automations';
import type {
  WorkflowEventQueuePayload,
  WorkflowStepQueuePayload,
} from '@signalforge/queue';

export async function processWorkflowEventJob(
  jobName: string,
  data: WorkflowEventQueuePayload | WorkflowStepQueuePayload,
): Promise<void> {
  if (jobName === 'workflow-event') {
    const payload = data as WorkflowEventQueuePayload;
    await processWorkflowEvent(payload.workflowEventId);
    return;
  }

  if (jobName === 'workflow-step') {
    const payload = data as WorkflowStepQueuePayload;
    await advanceWorkflowExecution(payload.executionId, payload.reason);
  }
}

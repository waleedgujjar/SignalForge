import { prisma } from '@signalforge/database';
import { loadEnv } from '@signalforge/config';
import { createQueue, createRedisConnection, QUEUE_NAMES } from '@signalforge/queue';
import { advanceWorkflowExecution } from './engine.js';
import { enqueueWorkflowStep, type WorkflowStepQueuePayload } from './queue-helpers.js';

let stepQueue: ReturnType<typeof createQueue<WorkflowStepQueuePayload>> | null = null;

function getStepQueue() {
  if (!stepQueue) {
    const env = loadEnv();
    stepQueue = createQueue(QUEUE_NAMES.WORKFLOW, createRedisConnection(env.REDIS_URL));
  }
  return stepQueue;
}

export interface AutomationSchedulerTickResult {
  resumed: number;
  errors: number;
}

export class AutomationSchedulerService {
  async runTick(now: Date = new Date()): Promise<AutomationSchedulerTickResult> {
    const due = await prisma.workflowExecution.findMany({
      where: {
        status: 'WAITING',
        resumeAt: { lte: now },
        workflow: { status: 'ACTIVE' },
      },
      take: 100,
    });

    let resumed = 0;
    let errors = 0;

    for (const execution of due) {
      try {
        await enqueueWorkflowStep(
          getStepQueue(),
          { executionId: execution.id, reason: 'DELAY_RESUME' },
        );
        resumed += 1;
      } catch {
        errors += 1;
        try {
          await advanceWorkflowExecution(execution.id, 'DELAY_RESUME');
        } catch {
          errors += 1;
        }
      }
    }

    return { resumed, errors };
  }
}

export const automationSchedulerService = new AutomationSchedulerService();

export function createAutomationSchedulerService() {
  return new AutomationSchedulerService();
}

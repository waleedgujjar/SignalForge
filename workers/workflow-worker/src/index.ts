import './load-env.js';

import { loadEnv } from '@signalforge/config';
import {
  QUEUE_NAMES,
  createRedisConnection,
  createWorker,
  registerWorkerShutdown,
  type WorkflowQueuePayload,
} from '@signalforge/queue';
import { processWorkflowEventJob } from './pipeline.js';

function log(message: string, meta: Record<string, unknown> = {}): void {
  console.info(
    JSON.stringify({
      worker: 'workflow-worker',
      message,
      ...meta,
      timestamp: new Date().toISOString(),
    }),
  );
}

async function startWorker(): Promise<void> {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);

  const worker = createWorker<WorkflowQueuePayload>(
    QUEUE_NAMES.WORKFLOW,
    async (job) => {
      await processWorkflowEventJob(job.name, job.data);
      return { ok: true };
    },
    connection,
  );

  worker.on('failed', (job, error) => {
    log('Workflow job failed', {
      jobId: job?.id,
      jobName: job?.name,
      status: 'failed',
      error: error.message,
      retryCount: job?.attemptsMade,
    });
  });

  worker.on('stalled', (jobId) => {
    log('Job stalled', { jobId });
  });

  registerWorkerShutdown([worker]);

  log('Workflow worker ready', { queues: [QUEUE_NAMES.WORKFLOW] });
}

void startWorker().catch((error) => {
  console.error('Failed to start workflow worker', error);
  process.exit(1);
});

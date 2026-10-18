import './load-env.js';

import { loadEnv } from '@signalforge/config';
import {
  QUEUE_NAMES,
  createRedisConnection,
  createWorker,
  registerWorkerShutdown,
  type WarmupQueuePayload,
} from '@signalforge/queue';
import { processWarmupSendJob } from './pipeline.js';

function log(message: string, meta: Record<string, unknown> = {}): void {
  console.info(
    JSON.stringify({ worker: 'warmup-worker', message, ...meta, timestamp: new Date().toISOString() }),
  );
}

async function startWorker(): Promise<void> {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);

  const warmupWorker = createWorker<WarmupQueuePayload>(
    QUEUE_NAMES.WARMUP,
    async (job) => {
      const outcome = await processWarmupSendJob(job.data);
      if (!outcome.ok && outcome.retryable) {
        throw new Error(outcome.reason);
      }
      return outcome;
    },
    connection,
  );

  warmupWorker.on('failed', (job, error) => {
    log('Warmup job failed', {
      jobId: job?.id,
      status: 'failed',
      error: error.message,
      retryCount: job?.attemptsMade,
    });
  });

  warmupWorker.on('stalled', (jobId) => {
    log('Job stalled', { jobId });
  });

  registerWorkerShutdown([warmupWorker]);

  log('Warmup worker ready', { queues: [QUEUE_NAMES.WARMUP] });
}

void startWorker().catch((error) => {
  console.error('Failed to start warmup worker', error);
  process.exit(1);
});

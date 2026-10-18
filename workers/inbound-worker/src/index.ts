import './load-env.js';

import { loadEnv } from '@signalforge/config';
import { InboxSchedulerService } from '@signalforge/inbox';
import {
  QUEUE_NAMES,
  createQueue,
  createRedisConnection,
  createWorker,
  registerWorkerShutdown,
  type InboundSyncQueuePayload,
} from '@signalforge/queue';
import { processInboundSyncJob } from './pipeline.js';

function log(message: string, meta: Record<string, unknown> = {}): void {
  console.info(
    JSON.stringify({ worker: 'inbound-worker', message, ...meta, timestamp: new Date().toISOString() }),
  );
}

async function startWorker(): Promise<void> {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);
  const inboxSyncQueue = createQueue<InboundSyncQueuePayload>(QUEUE_NAMES.EMAIL_INBOUND, connection);
  const inboxScheduler = new InboxSchedulerService(inboxSyncQueue);

  const inboundWorker = createWorker<InboundSyncQueuePayload>(
    QUEUE_NAMES.EMAIL_INBOUND,
    async (job) => {
      const outcome = await processInboundSyncJob(job.data, inboxScheduler);
      if (!outcome.ok && outcome.retryable) {
        throw new Error(outcome.reason);
      }
      return outcome;
    },
    connection,
  );

  inboundWorker.on('failed', (job, error) => {
    log('Inbound sync job failed', {
      jobId: job?.id,
      status: 'failed',
      error: error.message,
      retryCount: job?.attemptsMade,
    });
  });

  inboundWorker.on('stalled', (jobId) => {
    log('Job stalled', { jobId });
  });

  registerWorkerShutdown([inboundWorker], {
    onShutdown: async () => {
      await inboxSyncQueue.close();
    },
  });

  log('Inbound worker ready', { queues: [QUEUE_NAMES.EMAIL_INBOUND] });
}

void startWorker().catch((error) => {
  console.error('Failed to start inbound worker', error);
  process.exit(1);
});

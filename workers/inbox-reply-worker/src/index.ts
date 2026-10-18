import './load-env.js';

import { loadEnv } from '@signalforge/config';
import {
  QUEUE_NAMES,
  createRedisConnection,
  createWorker,
  registerWorkerShutdown,
  type InboxReplyQueuePayload,
} from '@signalforge/queue';
import { processInboxReplyJob } from './pipeline.js';

function log(message: string, meta: Record<string, unknown> = {}): void {
  console.info(
    JSON.stringify({ worker: 'inbox-reply-worker', message, ...meta, timestamp: new Date().toISOString() }),
  );
}

async function startWorker(): Promise<void> {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);

  const inboxReplyWorker = createWorker<InboxReplyQueuePayload>(
    QUEUE_NAMES.INBOX_REPLY,
    async (job) => {
      const outcome = await processInboxReplyJob(job.data);
      if (!outcome.ok && outcome.retryable) {
        throw new Error(outcome.reason);
      }
      return outcome;
    },
    connection,
  );

  inboxReplyWorker.on('failed', (job, error) => {
    log('Inbox reply job failed', {
      jobId: job?.id,
      status: 'failed',
      error: error.message,
      retryCount: job?.attemptsMade,
    });
  });

  inboxReplyWorker.on('stalled', (jobId) => {
    log('Job stalled', { jobId });
  });

  registerWorkerShutdown([inboxReplyWorker]);

  log('Inbox reply worker ready', { queues: [QUEUE_NAMES.INBOX_REPLY] });
}

void startWorker().catch((error) => {
  console.error('Failed to start inbox reply worker', error);
  process.exit(1);
});

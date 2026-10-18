import './load-env.js';

import { loadEnv } from '@signalforge/config';
import {
  QUEUE_NAMES,
  createQueue,
  createRedisConnection,
  createWorker,
  DEFAULT_JOB_OPTIONS,
  registerWorkerShutdown,
  type EmailSendQueuePayload,
} from '@signalforge/queue';
import { processEmailSendJob } from './pipeline.js';

interface HealthJobData {
  worker: string;
  timestamp: string;
}

function logJobContext(message: string, context: Record<string, unknown>): void {
  console.info(JSON.stringify({ worker: 'email-worker', message, ...context, timestamp: new Date().toISOString() }));
}

async function startWorker(): Promise<void> {
  loadEnv();
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);

  const healthQueue = createQueue<HealthJobData>(QUEUE_NAMES.HEALTH, connection);

  await healthQueue.add(
    'heartbeat',
    {
      worker: 'email-worker',
      timestamp: new Date().toISOString(),
    },
    DEFAULT_JOB_OPTIONS,
  );

  const healthWorker = createWorker<HealthJobData>(
    QUEUE_NAMES.HEALTH,
    async (job) => {
      logJobContext('Health job completed', {
        jobId: job.id,
        status: 'completed',
        worker: job.data.worker,
      });
      return { ok: true };
    },
    connection,
  );

  healthWorker.on('failed', (job, error) => {
    logJobContext('Health job failed', {
      jobId: job?.id,
      status: 'failed',
      error: error.message,
    });
  });

  const emailWorker = createWorker<EmailSendQueuePayload>(
    QUEUE_NAMES.EMAIL_SEND,
    async (job) => {
      const outcome = await processEmailSendJob(job.data);
      if (!outcome.ok && outcome.retryable) {
        throw new Error(outcome.reason);
      }
      return outcome;
    },
    connection,
  );

  emailWorker.on('failed', (job, error) => {
    logJobContext('Email send job failed', {
      jobId: job?.id,
      status: 'failed',
      error: error.message,
      retryCount: job?.attemptsMade,
    });
  });

  healthWorker.on('stalled', (jobId) => {
    logJobContext('Job stalled', { jobId, queue: QUEUE_NAMES.HEALTH });
  });

  emailWorker.on('stalled', (jobId) => {
    logJobContext('Job stalled', { jobId, queue: QUEUE_NAMES.EMAIL_SEND });
  });

  registerWorkerShutdown([healthWorker, emailWorker], {
    onShutdown: async () => {
      await healthQueue.close();
    },
  });

  logJobContext('Email worker ready', {
    status: 'ready',
    queues: [QUEUE_NAMES.HEALTH, QUEUE_NAMES.EMAIL_SEND],
  });
}

void startWorker().catch((error) => {
  console.error('Failed to start email worker', error);
  process.exit(1);
});

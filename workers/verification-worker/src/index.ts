import './load-env.js';

import { loadEnv } from '@signalforge/config';
import { QUEUE_NAMES, createRedisConnection, registerWorkerShutdown } from '@signalforge/queue';
import { Worker } from 'bullmq';

import { processEmailVerificationJob, type EmailVerificationJobData } from './processor.js';

function logJobContext(message: string, context: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      worker: 'verification-worker',
      message,
      ...context,
      timestamp: new Date().toISOString(),
    }),
  );
}

async function startWorker() {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);
  const concurrency = env.EMAIL_VERIFICATION_MAX_CONCURRENCY;

  const worker = new Worker<EmailVerificationJobData>(
    QUEUE_NAMES.EMAIL_VERIFICATION,
    async (job) => processEmailVerificationJob(job.data),
    { connection, concurrency },
  );

  worker.on('completed', (job, result) => {
    logJobContext('Queue job completed', {
      queueJobId: job.id,
      verificationJobId: job.data.jobId,
      email: job.data.email,
      result,
    });
  });

  worker.on('failed', (job, error) => {
    logJobContext('Queue job failed', {
      queueJobId: job?.id,
      verificationJobId: job?.data.jobId,
      email: job?.data.email,
      error: error.message,
      retryCount: job?.attemptsMade,
    });
  });

  worker.on('stalled', (jobId) => {
    logJobContext('Job stalled', { jobId });
  });

  registerWorkerShutdown(worker);

  logJobContext('Verification worker ready', {
    status: 'ready',
    queues: [QUEUE_NAMES.EMAIL_VERIFICATION],
    concurrency,
  });
}

void startWorker().catch((error) => {
  console.error('Failed to start verification worker', error);
  process.exit(1);
});

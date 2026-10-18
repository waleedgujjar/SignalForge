import './load-env.js';

import { loadEnv } from '@signalforge/config';
import {
  QUEUE_NAMES,
  createRedisConnection,
  createWorker,
  registerWorkerShutdown,
} from '@signalforge/queue';

import { processLeadDiscoveryJob, processRequalifyJob, type LeadDiscoveryJobData } from './processor.js';
import type { RequalifyQueuePayload } from '@signalforge/queue';

function logJobContext(message: string, context: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      worker: 'lead-discovery-worker',
      message,
      ...context,
      timestamp: new Date().toISOString(),
    }),
  );
}

async function startWorker() {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);

  const worker = createWorker<LeadDiscoveryJobData | RequalifyQueuePayload>(
    QUEUE_NAMES.LEAD_DISCOVERY,
    async (job) => {
      if (job.name === 'requalify') {
        logJobContext('Processing requalification job', {
          jobId: job.id,
          workspaceId: job.data.workspaceId,
        });
        return processRequalifyJob(job.data as RequalifyQueuePayload);
      }

      logJobContext('Processing lead discovery job', {
        jobId: job.id,
        discoveryJobId: (job.data as LeadDiscoveryJobData).jobId,
        workspaceId: job.data.workspaceId,
      });

      return processLeadDiscoveryJob(job.data as LeadDiscoveryJobData);
    },
    connection,
    { lockDuration: 300_000 },
  );

  worker.on('completed', (job, result) => {
    logJobContext('Lead discovery job completed', {
      jobId: job.id,
      discoveryJobId: job.data.jobId,
      workspaceId: job.data.workspaceId,
      status: (result as { status: string }).status,
      unique: (result as { unique: number }).unique,
      qualified: (result as { qualified: number }).qualified,
    });
  });

  worker.on('failed', (job, error) => {
    logJobContext('Lead discovery job failed', {
      jobId: job?.id,
      discoveryJobId: job?.data.jobId,
      workspaceId: job?.data.workspaceId,
      status: 'failed',
      error: error.message,
      retryCount: job?.attemptsMade,
    });
  });

  worker.on('stalled', (jobId) => {
    logJobContext('Job stalled', { jobId });
  });

  registerWorkerShutdown(worker);

  logJobContext('Lead discovery worker ready', {
    status: 'ready',
    queues: [QUEUE_NAMES.LEAD_DISCOVERY],
  });
}

void startWorker().catch((error) => {
  console.error('Failed to start lead discovery worker', error);
  process.exit(1);
});

import './load-env.js';

import { loadEnv } from '@signalforge/config';
import {
  QUEUE_NAMES,
  createRedisConnection,
  createWorker,
  registerWorkerShutdown,
  type CampaignEnrollmentQueuePayload,
} from '@signalforge/queue';
import { processCampaignEnrollment } from './processor.js';

function logJobContext(message: string, context: Record<string, unknown>): void {
  console.info(JSON.stringify({ worker: 'campaign-enrollment-worker', message, ...context, timestamp: new Date().toISOString() }));
}

async function startWorker(): Promise<void> {
  loadEnv();
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);

  const worker = createWorker<CampaignEnrollmentQueuePayload>(
    QUEUE_NAMES.CAMPAIGN_ENROLLMENT,
    async (job) => {
      logJobContext('Processing campaign enrollment', {
        jobId: job.id,
        campaignId: job.data.campaignId,
        leadCount: job.data.leadIds.length,
        source: job.data.source,
      });

      const result = await processCampaignEnrollment(job.data);

      logJobContext('Campaign enrollment completed', {
        jobId: job.id,
        campaignId: job.data.campaignId,
        ...result,
      });

      if (!result.ok) {
        throw new Error(`Enrollment blocked: ${result.blocked}`);
      }

      return result;
    },
    connection,
  );

  worker.on('failed', (job, error) => {
    logJobContext('Campaign enrollment job failed', {
      jobId: job?.id,
      status: 'failed',
      error: error.message,
      retryCount: job?.attemptsMade,
    });
  });

  worker.on('stalled', (jobId) => {
    logJobContext('Job stalled', { jobId });
  });

  registerWorkerShutdown([worker]);

  logJobContext('Campaign enrollment worker ready', {
    status: 'ready',
    queues: [QUEUE_NAMES.CAMPAIGN_ENROLLMENT],
  });
}

void startWorker().catch((error) => {
  console.error('Failed to start campaign enrollment worker', error);
  process.exit(1);
});

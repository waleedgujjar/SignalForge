import './load-env.js';

import { loadEnv } from '@signalforge/config';
import {
  QUEUE_NAMES,
  createRedisConnection,
  createWorker,
  registerWorkerShutdown,
  type AnalyticsAggregationPayload,
} from '@signalforge/queue';
import { processAnalyticsAggregationJob } from './pipeline.js';

function log(message: string, meta: Record<string, unknown> = {}): void {
  console.info(
    JSON.stringify({
      worker: 'analytics-worker',
      message,
      ...meta,
      timestamp: new Date().toISOString(),
    }),
  );
}

async function startWorker(): Promise<void> {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);

  const worker = createWorker<AnalyticsAggregationPayload>(
    QUEUE_NAMES.ANALYTICS,
    async (job) => {
      const outcome = await processAnalyticsAggregationJob(job.data);
      if (!outcome.ok && outcome.retryable) {
        throw new Error(outcome.reason);
      }
      return outcome;
    },
    connection,
  );

  worker.on('failed', (job, error) => {
    log('Analytics aggregation job failed', {
      jobId: job?.id,
      status: 'failed',
      error: error.message,
      retryCount: job?.attemptsMade,
    });
  });

  worker.on('stalled', (jobId) => {
    log('Job stalled', { jobId });
  });

  registerWorkerShutdown([worker]);

  log('Analytics worker ready', { queues: [QUEUE_NAMES.ANALYTICS] });
}

void startWorker().catch((error) => {
  console.error('Failed to start analytics worker', error);
  process.exit(1);
});

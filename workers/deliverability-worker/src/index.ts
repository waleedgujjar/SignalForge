import './load-env.js';

import { loadEnv } from '@signalforge/config';
import {
  QUEUE_NAMES,
  createRedisConnection,
  createWorker,
  registerWorkerShutdown,
  type DeliverabilityAggregationPayload,
  type DomainHealthCheckPayload,
} from '@signalforge/queue';
import { processAggregationJob, processDomainCheckJob } from './pipeline.js';

function log(message: string, meta: Record<string, unknown> = {}): void {
  console.info(
    JSON.stringify({
      worker: 'deliverability-worker',
      message,
      ...meta,
      timestamp: new Date().toISOString(),
    }),
  );
}

async function startWorker(): Promise<void> {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);

  const aggregationWorker = createWorker<DeliverabilityAggregationPayload>(
    QUEUE_NAMES.DELIVERABILITY_AGGREGATION,
    async (job) => {
      const outcome = await processAggregationJob(job.data);
      if (!outcome.ok && outcome.retryable) {
        throw new Error(outcome.reason);
      }
      return outcome;
    },
    connection,
  );

  const domainWorker = createWorker<DomainHealthCheckPayload>(
    QUEUE_NAMES.DOMAIN_HEALTH_CHECK,
    async (job) => {
      const outcome = await processDomainCheckJob(job.data);
      if (!outcome.ok && outcome.retryable) {
        throw new Error(outcome.reason);
      }
      return outcome;
    },
    connection,
  );

  aggregationWorker.on('failed', (job, error) => {
    log('Deliverability aggregation job failed', {
      jobId: job?.id,
      status: 'failed',
      error: error.message,
      retryCount: job?.attemptsMade,
    });
  });

  domainWorker.on('failed', (job, error) => {
    log('Domain health check job failed', {
      jobId: job?.id,
      status: 'failed',
      error: error.message,
      retryCount: job?.attemptsMade,
    });
  });

  aggregationWorker.on('stalled', (jobId) => {
    log('Job stalled', { jobId, queue: QUEUE_NAMES.DELIVERABILITY_AGGREGATION });
  });

  domainWorker.on('stalled', (jobId) => {
    log('Job stalled', { jobId, queue: QUEUE_NAMES.DOMAIN_HEALTH_CHECK });
  });

  registerWorkerShutdown([aggregationWorker, domainWorker]);

  log('Deliverability worker ready', {
    queues: [QUEUE_NAMES.DELIVERABILITY_AGGREGATION, QUEUE_NAMES.DOMAIN_HEALTH_CHECK],
  });
}

void startWorker().catch((error) => {
  console.error('Failed to start deliverability worker', error);
  process.exit(1);
});

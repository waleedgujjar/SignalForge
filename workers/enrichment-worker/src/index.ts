import './load-env.js';

import { loadEnv } from '@signalforge/config';
import {
  QUEUE_NAMES,
  createRedisConnection,
  createWorker,
  registerWorkerShutdown,
} from '@signalforge/queue';
import { createAIProvider } from '@signalforge/ai';
import { processEnrichmentJob, type EnrichmentJobData } from './processor.js';

function logJobContext(message: string, context: Record<string, unknown>): void {
  console.info(JSON.stringify({ worker: 'enrichment-worker', message, ...context, timestamp: new Date().toISOString() }));
}

async function startWorker() {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);
  const aiProvider = createAIProvider(env.AI_PROVIDER, {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    baseURL: env.OPENAI_BASE_URL,
  });

  const worker = createWorker<EnrichmentJobData>(
    QUEUE_NAMES.LEAD_ENRICHMENT,
    async (job) => {
      logJobContext('Processing enrichment job', {
        jobId: job.id,
        enrichmentId: job.data.enrichmentId,
        leadId: job.data.leadId,
      });

      return processEnrichmentJob(job.data, aiProvider);
    },
    connection,
    { lockDuration: 120_000 },
  );

  worker.on('completed', (job, result) => {
    logJobContext('Enrichment job completed', {
      jobId: job.id,
      enrichmentId: job.data.enrichmentId,
      status: (result as { status: string }).status,
    });
  });

  worker.on('failed', (job, error) => {
    logJobContext('Enrichment job failed', {
      jobId: job?.id,
      enrichmentId: job?.data.enrichmentId,
      status: 'failed',
      error: error.message,
      retryCount: job?.attemptsMade,
    });
  });

  worker.on('stalled', (jobId) => {
    logJobContext('Job stalled', { jobId });
  });

  registerWorkerShutdown(worker);

  logJobContext('Enrichment worker ready', {
    status: 'ready',
    queues: [QUEUE_NAMES.LEAD_ENRICHMENT],
    aiProvider: env.AI_PROVIDER,
  });
}

void startWorker().catch((error) => {
  console.error('Failed to start enrichment worker', error);
  process.exit(1);
});

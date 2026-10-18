import './load-env.js';

import { loadEnv } from '@signalforge/config';
import {
  QUEUE_NAMES,
  createRedisConnection,
  createWorker,
  registerWorkerShutdown,
} from '@signalforge/queue';
import { createAIProvider } from '@signalforge/ai';
import { processWebsiteAnalysisJob, type WebsiteAnalysisJobData } from './processor.js';

function logJobContext(message: string, context: Record<string, unknown>): void {
  console.info(JSON.stringify({ worker: 'website-worker', message, ...context, timestamp: new Date().toISOString() }));
}

async function startWorker() {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);
  const aiProvider = createAIProvider(env.AI_PROVIDER, {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    baseURL: env.OPENAI_BASE_URL,
  });

  const worker = createWorker<WebsiteAnalysisJobData>(
    QUEUE_NAMES.WEBSITE_ANALYSIS,
    async (job) => {
      logJobContext('Processing website analysis job', {
        jobId: job.id,
        analysisId: job.data.analysisId,
        domain: job.data.domain,
      });

      return processWebsiteAnalysisJob(job.data, aiProvider);
    },
    connection,
    { lockDuration: 120_000 },
  );

  worker.on('completed', (job, result) => {
    logJobContext('Website analysis job completed', {
      jobId: job.id,
      analysisId: job.data.analysisId,
      status: (result as { status: string }).status,
    });
  });

  worker.on('failed', (job, error) => {
    logJobContext('Website analysis job failed', {
      jobId: job?.id,
      analysisId: job?.data.analysisId,
      status: 'failed',
      error: error.message,
      retryCount: job?.attemptsMade,
    });
  });

  worker.on('stalled', (jobId) => {
    logJobContext('Job stalled', { jobId });
  });

  registerWorkerShutdown(worker);

  logJobContext('Website worker ready', {
    status: 'ready',
    queues: [QUEUE_NAMES.WEBSITE_ANALYSIS],
    aiProvider: env.AI_PROVIDER,
  });
}

void startWorker().catch((error) => {
  console.error('Failed to start website worker', error);
  process.exit(1);
});

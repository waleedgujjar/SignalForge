import './load-env.js';

import { loadEnv } from '@signalforge/config';
import { QUEUE_NAMES, createRedisConnection, registerWorkerShutdown, type LeadResearchQueuePayload } from '@signalforge/queue';
import { Worker } from 'bullmq';

import { logResearch } from './log.js';
import { processLeadResearchJob } from './processor.js';

async function startWorker() {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);
  // Research talks to third parties one URL at a time. Concurrency is a
  // deliberate research-job control (default 1), never a throughput target.
  const concurrency = env.LINKEDIN_RESEARCH_MAX_CONCURRENCY;

  const worker = new Worker<LeadResearchQueuePayload>(
    QUEUE_NAMES.LEAD_RESEARCH,
    async (job) =>
      processLeadResearchJob(job.data, {
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 1,
      }),
    { connection, concurrency, lockDuration: 120_000, maxStalledCount: 2 },
  );

  worker.on('completed', (job, result) => {
    logResearch('research_job_completed', {
      jobId: job.id,
      researchId: job.data.researchId,
      leadId: job.data.leadId,
      workspaceId: job.data.workspaceId,
      status: (result as { status?: string } | undefined)?.status,
    });
  });

  worker.on('failed', (job, error) => {
    logResearch('research_job_failed', {
      jobId: job?.id,
      researchId: job?.data.researchId,
      leadId: job?.data.leadId,
      workspaceId: job?.data.workspaceId,
      status: 'failed',
      errorMessage: error.message,
      retryCount: job?.attemptsMade,
    });
  });

  worker.on('stalled', (jobId) => {
    logResearch('job_stalled', { jobId });
  });

  registerWorkerShutdown(worker);

  logResearch('lead_research_worker_ready', {
    status: 'ready',
    queues: [QUEUE_NAMES.LEAD_RESEARCH],
    concurrency,
  });
}

void startWorker().catch((error) => {
  console.error('Failed to start lead research worker', error);
  process.exit(1);
});

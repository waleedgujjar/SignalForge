import './load-env.js';

import { loadEnv } from '@signalforge/config';
import {
  QUEUE_NAMES,
  createRedisConnection,
  createWorker,
  registerWorkerShutdown,
  type LeadImportQueuePayload,
  type LeadProcessingQueuePayload,
} from '@signalforge/queue';
import { processLeadImportJob } from './processor.js';
import { processLeadProcessingJob, markStagingJobFailed } from './staging.js';

function log(message: string, context: Record<string, unknown>): void {
  console.info(JSON.stringify({ worker: 'import-worker', message, ...context, timestamp: new Date().toISOString() }));
}

async function startWorker() {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);

  const worker = createWorker<LeadImportQueuePayload>(
    QUEUE_NAMES.LEAD_IMPORT,
    async (job) => {
      log('Processing import job', { jobId: job.id, importId: job.data.importId, fileName: job.data.fileName });
      return processLeadImportJob(job.data);
    },
    connection,
    // Large files can take minutes; keep the lock long and limit concurrency so
    // two big imports cannot overrun the worker's memory budget at once.
    { lockDuration: 600_000, concurrency: 2 },
  );

  worker.on('completed', (job, result) => {
    log('Import job completed', {
      jobId: job.id,
      importId: job.data.importId,
      created: (result as { created?: number })?.created,
    });
  });

  worker.on('failed', (job, error) => {
    log('Import job failed', { jobId: job?.id, importId: job?.data.importId, error: error.message });
  });

  worker.on('stalled', (jobId) => log('Job stalled', { jobId }));

  // Large Lead Data staging pipeline (dataset processing + transfers to Leads).
  const stagingWorker = createWorker<LeadProcessingQueuePayload>(
    QUEUE_NAMES.LEAD_PROCESSING,
    async (job) => {
      log('Processing staging job', { jobId: job.id, kind: job.data.kind, datasetId: job.data.datasetId });
      return processLeadProcessingJob(job.data);
    },
    connection,
    { lockDuration: 600_000, concurrency: 1 },
  );

  stagingWorker.on('completed', (job) => {
    log('Staging job completed', { jobId: job.id, kind: job.data.kind, datasetId: job.data.datasetId });
  });

  stagingWorker.on('failed', (job, error) => {
    log('Staging job failed', { jobId: job?.id, kind: job?.data.kind, datasetId: job?.data.datasetId, error: error.message });
    if (job?.data) {
      void markStagingJobFailed(job.data, error.message).catch((err) =>
        log('Could not mark staging job failed', { jobId: job.id, error: (err as Error).message }),
      );
    }
  });

  registerWorkerShutdown([worker, stagingWorker]);

  log('Import worker ready', {
    status: 'ready',
    queues: [QUEUE_NAMES.LEAD_IMPORT, QUEUE_NAMES.LEAD_PROCESSING],
  });
}

void startWorker().catch((error) => {
  console.error('Failed to start import worker', error);
  process.exit(1);
});

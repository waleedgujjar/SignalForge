import './load-env.js';

import { loadEnv } from '@signalforge/config';
import {
  QUEUE_NAMES,
  createRedisConnection,
  createWorker,
  registerWorkerShutdown,
  type LeadImportQueuePayload,
} from '@signalforge/queue';
import { processLeadImportJob } from './processor.js';

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

  registerWorkerShutdown(worker);

  log('Import worker ready', { status: 'ready', queues: [QUEUE_NAMES.LEAD_IMPORT] });
}

void startWorker().catch((error) => {
  console.error('Failed to start import worker', error);
  process.exit(1);
});

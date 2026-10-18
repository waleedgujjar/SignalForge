import type { Queue, JobsOptions } from 'bullmq';

export interface InboundSyncQueuePayload {
  inboxSyncJobId: string;
  workspaceId: string;
  mailboxId: string;
}

export const INBOUND_SYNC_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 60_000,
  },
  removeOnComplete: 500,
  removeOnFail: 1000,
};

export async function enqueueInboundSync(
  queue: Queue<InboundSyncQueuePayload>,
  payload: InboundSyncQueuePayload,
  options?: { delayMs?: number; jobId?: string },
) {
  return queue.add('inbox-sync', payload, {
    ...INBOUND_SYNC_JOB_OPTIONS,
    delay: options?.delayMs,
    jobId: options?.jobId ?? `inbox-sync-${payload.inboxSyncJobId}`,
  });
}

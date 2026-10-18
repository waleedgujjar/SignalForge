import type { Queue, JobsOptions } from 'bullmq';

export interface WarmupQueuePayload {
  warmupJobId: string;
  workspaceId: string;
  mailboxId: string;
}

export const WARMUP_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5 * 60_000,
  },
  removeOnComplete: 500,
  removeOnFail: 1000,
};

export async function enqueueWarmupSend(
  queue: Queue<WarmupQueuePayload>,
  payload: WarmupQueuePayload,
  options?: { delayMs?: number; jobId?: string },
) {
  return queue.add('warmup-send', payload, {
    ...WARMUP_JOB_OPTIONS,
    delay: options?.delayMs,
    jobId: options?.jobId ?? `warmup-job-${payload.warmupJobId}`,
  });
}

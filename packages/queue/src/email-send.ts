import type { Queue, JobsOptions } from 'bullmq';

export interface EmailSendQueuePayload {
  sendingJobId: string;
  workspaceId: string;
  campaignId: string;
  campaignLeadId: string;
  leadId: string;
  stepId: string;
}

export const EMAIL_SEND_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 60_000,
  },
  removeOnComplete: 500,
  removeOnFail: 1000,
};

export async function enqueueEmailSend(
  queue: Queue<EmailSendQueuePayload>,
  payload: EmailSendQueuePayload,
  options?: { delayMs?: number; jobId?: string },
) {
  return queue.add('send', payload, {
    ...EMAIL_SEND_JOB_OPTIONS,
    delay: options?.delayMs,
    jobId: options?.jobId ?? `sending-job-${payload.sendingJobId}`,
  });
}

export async function enqueueEmailRetry(
  queue: Queue<EmailSendQueuePayload>,
  payload: EmailSendQueuePayload,
  delayMs: number,
) {
  return queue.add('retry', payload, {
    ...EMAIL_SEND_JOB_OPTIONS,
    delay: delayMs,
    jobId: `sending-job-retry-${payload.sendingJobId}-${Date.now()}`,
  });
}

import type { JobsOptions, Queue } from 'bullmq';

export interface EmailVerificationQueuePayload {
  jobId: string;
  workspaceId: string;
  email: string;
  leadId?: string;
  forceRecheck?: boolean;
}

export const EMAIL_VERIFICATION_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 500,
  removeOnFail: 1000,
};

function verificationJobId(payload: EmailVerificationQueuePayload): string {
  return `email-verification-${payload.workspaceId}:${payload.email.toLowerCase()}:${payload.jobId}`;
}

export async function enqueueEmailVerification(
  queue: Queue<EmailVerificationQueuePayload>,
  payload: EmailVerificationQueuePayload,
) {
  return queue.add('verify-email', payload, {
    ...EMAIL_VERIFICATION_JOB_OPTIONS,
    jobId: verificationJobId(payload),
  });
}

/**
 * Enqueue many verification jobs in one round trip. The per-email `jobId` keeps
 * BullMQ's built-in dedup, so a retried bulk create cannot double-process an
 * email. Avoids the per-email awaited `add` loop that made large uploads block
 * the request long enough to trip the client timeout.
 */
export async function enqueueEmailVerificationBatch(
  queue: Queue<EmailVerificationQueuePayload>,
  payloads: EmailVerificationQueuePayload[],
) {
  if (payloads.length === 0) return [];
  return queue.addBulk(
    payloads.map((payload) => ({
      name: 'verify-email',
      data: payload,
      opts: { ...EMAIL_VERIFICATION_JOB_OPTIONS, jobId: verificationJobId(payload) },
    })),
  );
}

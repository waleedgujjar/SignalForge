import { createHash } from 'node:crypto';
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

/**
 * Deterministic per (job, email) id so a retried enqueue is deduplicated. The
 * email is hashed: BullMQ rejects custom ids containing ':' and raw addresses
 * can contain any printable character.
 */
export function verificationJobId(payload: Pick<EmailVerificationQueuePayload, 'jobId' | 'email'>): string {
  const digest = createHash('sha1').update(payload.email.trim().toLowerCase()).digest('hex').slice(0, 20);
  return `email-verification-${payload.jobId}-${digest}`;
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

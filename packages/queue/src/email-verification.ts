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

export async function enqueueEmailVerification(
  queue: Queue<EmailVerificationQueuePayload>,
  payload: EmailVerificationQueuePayload,
) {
  const idempotencyKey = `${payload.workspaceId}:${payload.email.toLowerCase()}:${payload.jobId}`;
  return queue.add('verify-email', payload, {
    ...EMAIL_VERIFICATION_JOB_OPTIONS,
    jobId: `email-verification-${idempotencyKey}`,
  });
}

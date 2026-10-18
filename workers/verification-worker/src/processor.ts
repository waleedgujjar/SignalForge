import { prisma } from '@signalforge/database';
import { emailVerificationService, verificationJobService } from '@signalforge/verification';
import type { EmailVerificationQueuePayload } from '@signalforge/queue';

function logJobContext(message: string, context: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      worker: 'verification-worker',
      message,
      ...context,
      timestamp: new Date().toISOString(),
    }),
  );
}

export type EmailVerificationJobData = EmailVerificationQueuePayload;

export async function processEmailVerificationJob(data: EmailVerificationJobData) {
  const job = await prisma.emailVerificationJob.findUnique({ where: { id: data.jobId } });
  if (!job || job.status === 'CANCELLED' || job.status === 'PAUSED') {
    logJobContext('verification_skipped', {
      jobId: data.jobId,
      email: data.email,
      reason: job?.status ?? 'missing_job',
    });
    return { skipped: true };
  }

  let leadId = data.leadId;
  if (!leadId) {
    const lead = await prisma.lead.findFirst({
      where: { workspaceId: data.workspaceId, email: data.email.toLowerCase() },
      select: { id: true },
    });
    leadId = lead?.id;
  }

  logJobContext('verification_started', {
    jobId: data.jobId,
    workspaceId: data.workspaceId,
    email: data.email,
    leadId,
  });

  try {
    const result = await emailVerificationService.verifyAndPersist(data.email, {
      workspaceId: data.workspaceId,
      leadId,
      jobId: data.jobId,
      options: { forceRecheck: data.forceRecheck, workspaceId: data.workspaceId },
    });

    await verificationJobService.incrementCounter(data.jobId, result.status);

    logJobContext('verification_completed', {
      jobId: data.jobId,
      email: data.email,
      status: result.status,
      riskScore: result.riskScore,
      confidenceScore: result.confidenceScore,
    });

    return { status: result.status, email: data.email };
  } catch (error) {
    await verificationJobService.incrementCounter(data.jobId, 'UNKNOWN', true);
    logJobContext('verification_failed', {
      jobId: data.jobId,
      email: data.email,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

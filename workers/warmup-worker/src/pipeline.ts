import { prisma } from '@signalforge/database';
import { loadEnv } from '@signalforge/config';
import { decryptSecret, createSmtpProvider } from '@signalforge/email';
import { classifySendError } from '@signalforge/sending';
import type { WarmupQueuePayload } from '@signalforge/queue';
import {
  computeUsageDate,
  toUsageDate,
  getWarmupEligibility,
  warmupJobService,
  warmupConfigService,
  reserveWarmupCapacity,
  consumeWarmupReservation,
  releaseWarmupReservation,
  logWarmupEvent,
  WarmupCapacityExhaustedError,
  WarmupReservationConflictError,
} from '@signalforge/warmup';

export type WarmupPipelineOutcome =
  | { ok: true; providerMessageId?: string | null }
  | { ok: false; reason: string; deferred?: boolean; retryable?: boolean };

async function bumpHistory(
  workspaceId: string,
  mailboxId: string,
  usageDate: Date,
  patch: {
    attemptedIncrement?: number;
    sentIncrement?: number;
    failedIncrement?: number;
    deferredIncrement?: number;
    statusSnapshot?: string;
    healthSnapshot?: string;
  },
): Promise<void> {
  await prisma.warmupDailyHistory.upsert({
    where: { mailboxId_usageDate: { mailboxId, usageDate } },
    create: {
      workspaceId,
      mailboxId,
      usageDate,
      attemptedCount: patch.attemptedIncrement ?? 0,
      sentCount: patch.sentIncrement ?? 0,
      failedCount: patch.failedIncrement ?? 0,
      deferredCount: patch.deferredIncrement ?? 0,
      statusSnapshot: (patch.statusSnapshot as never) ?? 'NOT_STARTED',
      healthSnapshot: (patch.healthSnapshot as never) ?? 'UNKNOWN',
    },
    update: {
      attemptedCount: { increment: patch.attemptedIncrement ?? 0 },
      sentCount: { increment: patch.sentIncrement ?? 0 },
      failedCount: { increment: patch.failedIncrement ?? 0 },
      deferredCount: { increment: patch.deferredIncrement ?? 0 },
      statusSnapshot: patch.statusSnapshot ? (patch.statusSnapshot as never) : undefined,
      healthSnapshot: patch.healthSnapshot ? (patch.healthSnapshot as never) : undefined,
    },
  });
}

export async function processWarmupSendJob(
  data: WarmupQueuePayload,
): Promise<WarmupPipelineOutcome> {
  const start = Date.now();
  const env = loadEnv();

  logWarmupEvent('Processing warmup job', {
    workspaceId: data.workspaceId,
    mailboxId: data.mailboxId,
    jobId: data.warmupJobId,
    status: 'processing',
  });

  const job = await warmupJobService.claimJob(data.warmupJobId);
  if (!job) {
    return { ok: false, reason: 'JOB_NOT_CLAIMABLE' };
  }
  if (job.providerMessageId) {
    return { ok: true, providerMessageId: job.providerMessageId };
  }

  const eligibility = await getWarmupEligibility(job.mailboxId, job.workspaceId);
  if (!eligibility.eligible) {
    await warmupJobService.markDeferred(job.id, {
      reason: eligibility.reason,
      nextScheduledAt: null,
    });
    await bumpHistory(job.workspaceId, job.mailboxId, job.usageDate, {
      deferredIncrement: 1,
    });
    logWarmupEvent('Warmup deferred', {
      workspaceId: job.workspaceId,
      mailboxId: job.mailboxId,
      jobId: job.id,
      status: 'deferred',
      reason: eligibility.reason,
      durationMs: Date.now() - start,
    });
    return { ok: false, reason: eligibility.reason, deferred: true };
  }

  const mailbox = await prisma.mailbox.findFirst({
    where: { id: job.mailboxId, workspaceId: job.workspaceId },
    include: { credential: true, workspace: true },
  });
  if (!mailbox || !mailbox.credential || !mailbox.smtpHost || !mailbox.smtpPort) {
    await warmupJobService.markFailed(job.id, {
      errorCategory: 'PERMANENT',
      message: 'Mailbox missing SMTP configuration',
    });
    await bumpHistory(job.workspaceId, job.mailboxId, job.usageDate, {
      failedIncrement: 1,
    });
    return { ok: false, reason: 'MISSING_CREDENTIALS' };
  }

  const timezone =
    mailbox.timezone && mailbox.timezone.trim() !== ''
      ? mailbox.timezone
      : mailbox.workspace.timezone || 'UTC';
  const usageDateStr = computeUsageDate(new Date(), timezone);

  let reservationId: string;
  try {
    const result = await reserveWarmupCapacity({
      workspaceId: job.workspaceId,
      warmupJobId: job.id,
      mailboxId: mailbox.id,
      usageDate: usageDateStr,
      warmupDailyLimit: eligibility.configuredLimit,
      accountDailyLimit: mailbox.dailySendingLimit,
    });
    reservationId = result.reservationId;
  } catch (error) {
    if (error instanceof WarmupCapacityExhaustedError) {
      await warmupJobService.markDeferred(job.id, {
        reason: 'CAPACITY_EXHAUSTED',
        nextScheduledAt: null,
      });
      await bumpHistory(job.workspaceId, job.mailboxId, job.usageDate, {
        deferredIncrement: 1,
      });
      return { ok: false, reason: 'CAPACITY_EXHAUSTED', deferred: true };
    }
    if (error instanceof WarmupReservationConflictError) {
      return { ok: false, reason: 'RESERVATION_CONFLICT', retryable: true };
    }
    throw error;
  }

  const password = decryptSecret(mailbox.credential.encryptedPayload, env.ENCRYPTION_KEY);
  const provider = createSmtpProvider({
    host: mailbox.smtpHost,
    port: mailbox.smtpPort,
    username: mailbox.smtpUsername ?? mailbox.emailAddress,
    password,
    encryption: mailbox.encryptionType,
    fromEmail: mailbox.emailAddress,
    fromName: mailbox.fromName,
  });

  try {
    await bumpHistory(job.workspaceId, job.mailboxId, job.usageDate, {
      attemptedIncrement: 1,
    });
    const sendResult = await provider.send({
      to: job.recipientEmail,
      subject: job.renderedSubject,
      body: job.renderedBody,
    });

    await prisma.$transaction(async (tx) => {
      await tx.mailbox.update({
        where: { id: mailbox.id },
        data: { lastSuccessfulSendAt: new Date() },
      });
      const existingHealth = await tx.mailboxHealth.findUnique({
        where: { mailboxId: mailbox.id },
      });
      if (existingHealth) {
        await tx.mailboxHealth.update({
          where: { mailboxId: mailbox.id },
          data: { consecutiveFailures: 0, lastCheckedAt: new Date() },
        });
      }
    });

    await consumeWarmupReservation({ reservationId });
    await warmupJobService.markSent(job.id, {
      providerMessageId: sendResult.messageId ?? null,
    });
    await warmupConfigService.recordSuccess(job.mailboxId, job.workspaceId);
    await bumpHistory(job.workspaceId, job.mailboxId, job.usageDate, {
      sentIncrement: 1,
      statusSnapshot: 'ACTIVE',
      healthSnapshot: mailbox.healthStatus,
    });

    logWarmupEvent('Warmup email sent', {
      workspaceId: job.workspaceId,
      mailboxId: mailbox.id,
      jobId: job.id,
      status: 'sent',
      durationMs: Date.now() - start,
    });
    return { ok: true, providerMessageId: sendResult.messageId ?? null };
  } catch (error) {
    const classified = classifySendError(error);
    await releaseWarmupReservation({
      reservationId,
      reason: classified.category,
    });
    await warmupJobService.markFailed(job.id, {
      errorCategory: classified.category,
      message: classified.message,
    });
    await bumpHistory(job.workspaceId, job.mailboxId, job.usageDate, {
      failedIncrement: 1,
      healthSnapshot: classified.retryable ? 'DEGRADED' : 'UNHEALTHY',
    });
    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: {
        healthStatus: classified.retryable ? 'DEGRADED' : 'UNHEALTHY',
        lastErrorAt: new Date(),
        lastErrorMessage: classified.message.slice(0, 500),
      },
    });
    const { blocked } = await warmupConfigService.recordFailure(job.mailboxId, job.workspaceId);
    logWarmupEvent('Warmup send failed', {
      workspaceId: job.workspaceId,
      mailboxId: mailbox.id,
      jobId: job.id,
      status: blocked ? 'blocked' : 'failed',
      error: classified.message,
      durationMs: Date.now() - start,
    });
    return { ok: false, reason: classified.category, retryable: classified.retryable && !blocked };
  }
}

export { toUsageDate };

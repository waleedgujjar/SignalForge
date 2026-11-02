import { randomUUID } from 'node:crypto';
import { prisma, type SendingJob } from '@signalforge/database';
import { loadEnv } from '@signalforge/config';
import {
  decryptSecret,
  createSmtpProvider,
  evaluateSendingPolicy,
  leadToVariableContext,
  buildUnsubscribeUrl,
  buildTrackingPixelUrl,
  resolveVerificationPolicy,
} from '@signalforge/email';
import {
  allocationService,
  consumeReservation,
  releaseReservation,
} from '@signalforge/allocation';
import {
  calculateNextValidSlot,
  classifySendError,
  isWithinSendingWindow,
  retryBackoffMs,
  sendingJobService,
  sendingEligibilityService,
  sendingLimitService,
  logSendingEvent,
} from '@signalforge/sending';
import type { SendingJobEligibilityResult } from '@signalforge/sending';
import {
  buildIdempotencyKey,
  classifyBounceFromCategory,
  deliverabilityProtectionService,
  deliverabilitySendGate,
  deliveryEventService,
  recipientBounceService,
  type BounceClassification,
} from '@signalforge/deliverability';
import type { ScheduleConfig } from '@signalforge/campaigns';
import { publishWorkflowEvent } from '@signalforge/automations';
import { computeUsageDate } from '@signalforge/mailboxes';
import type { EmailSendQueuePayload } from '@signalforge/queue';

export type EmailSendJobData = EmailSendQueuePayload;

export type PipelineOutcome =
  | { ok: true; providerMessageId?: string | null }
  | { ok: false; reason: string; deferred?: boolean; retryable?: boolean };

const NO_ACCOUNTS_DEFER_MS = 15 * 60_000;
/// How long to hold a job when the allocated mailbox is under deliverability
/// protection. The block is expected to clear once health recovers.
const PROTECTION_DEFER_MS = 60 * 60_000;

export async function processEmailSendJob(data: EmailSendJobData): Promise<PipelineOutcome> {
  const start = Date.now();
  const env = loadEnv();

  logSendingEvent('Processing sending job', {
    jobId: data.sendingJobId,
    workspaceId: data.workspaceId,
    campaignId: data.campaignId,
    campaignLeadId: data.campaignLeadId,
    leadId: data.leadId,
    status: 'processing',
  });

  const job = await sendingJobService.claimJob(data.sendingJobId);
  if (!job) {
    return { ok: false, reason: 'JOB_NOT_CLAIMABLE' };
  }

  const [campaign, campaignLead, step, lead, suppressions, workspaceVerificationPolicy] = await Promise.all([
    prisma.campaign.findFirst({
      where: { id: data.campaignId, workspaceId: data.workspaceId },
      include: { workspace: true },
    }),
    prisma.campaignLead.findFirst({ where: { id: data.campaignLeadId, campaignId: data.campaignId } }),
    prisma.campaignStep.findFirst({ where: { id: data.stepId, campaignId: data.campaignId } }),
    prisma.lead.findFirst({
      where: { id: data.leadId, workspaceId: data.workspaceId },
      include: {
        verification: true,
        enrichment: true,
        websiteAnalyses: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
        research: {
          where: { status: 'COMPLETED' },
          orderBy: { completedAt: 'desc' },
          take: 1,
        },
      },
    }),
    prisma.suppression.findMany({ where: { workspaceId: data.workspaceId } }),
    prisma.workspaceVerificationPolicy.findFirst({ where: { workspaceId: data.workspaceId } }),
  ]);

  if (!campaign || !campaignLead || !step || !lead) {
    await sendingJobService.markFailed(job.id, { errorCategory: 'PERMANENT', message: 'Missing campaign, lead, or step' });
    return { ok: false, reason: 'MISSING_DATA' };
  }

  if (job.providerMessageId) {
    logSendingEvent('Job already delivered, skipping', {
      jobId: job.id,
      workspaceId: data.workspaceId,
      status: 'idempotent_skip',
    });
    return { ok: true, providerMessageId: job.providerMessageId };
  }

  const scheduleConfig = (campaign.scheduleConfig ?? {}) as ScheduleConfig;

  if (!isWithinSendingWindow(new Date(), scheduleConfig)) {
    const nextSlot = calculateNextValidSlot(new Date(), scheduleConfig);
    await sendingJobService.rescheduleForWindow(job.id, nextSlot);
    logSendingEvent('Deferred job outside window', {
      jobId: job.id,
      status: 'deferred',
      durationMs: Date.now() - start,
    });
    return { ok: false, reason: 'DEFERRED_OUTSIDE_WINDOW', deferred: true };
  }

  const eligibility = await sendingEligibilityService.check({
    campaignLeadId: data.campaignLeadId,
    workspaceId: data.workspaceId,
  });
  if (!eligibility.eligible) {
    return handleIneligibleJob(job, eligibility);
  }

  // Delegate mailbox selection + capacity reservation to the allocation service.
  const allocation = await allocationService.allocateAccount({
    jobId: job.id,
    workspaceId: data.workspaceId,
  });

  if (allocation.status === 'FAILED') {
    if (allocation.retryable) {
      const deferMs = allocation.outcome === 'CAMPAIGN_LIMIT_REACHED' ? 60 * 60_000 : NO_ACCOUNTS_DEFER_MS;
      const nextSlot = calculateNextValidSlot(new Date(Date.now() + deferMs), scheduleConfig);
      await sendingJobService.rescheduleForWindow(job.id, nextSlot);
      logSendingEvent('Allocation deferred', {
        jobId: job.id,
        status: 'deferred_allocation',
        outcome: allocation.outcome,
        reason: allocation.reason,
        durationMs: Date.now() - start,
      });
      return { ok: false, reason: allocation.outcome, deferred: true };
    }
    await sendingJobService.markFailed(job.id, {
      errorCategory: 'PERMANENT',
      message: `${allocation.outcome}: ${allocation.reason}`,
    });
    return { ok: false, reason: allocation.outcome };
  }

  const mailbox = await prisma.mailbox.findUnique({
    where: { id: allocation.mailboxId },
    include: { credential: true },
  });
  if (!mailbox) {
    await releaseReservation({
      reservationId: allocation.reservationId,
      reason: 'MAILBOX_MISSING',
    });
    await sendingJobService.markFailed(job.id, {
      errorCategory: 'PERMANENT',
      message: 'Allocated mailbox not found',
    });
    return { ok: false, reason: 'MAILBOX_MISSING' };
  }

  const mailboxGate = await deliverabilitySendGate.checkMailbox(data.workspaceId, mailbox.id);
  if (!mailboxGate.allowed) {
    await releaseReservation({
      reservationId: allocation.reservationId,
      reason: mailboxGate.reason ?? 'DELIVERABILITY_BLOCK',
    });
    const nextSlot = calculateNextValidSlot(
      new Date(Date.now() + PROTECTION_DEFER_MS),
      scheduleConfig,
    );
    await sendingJobService.rescheduleForWindow(job.id, nextSlot);
    logSendingEvent('Send deferred by deliverability protection', {
      jobId: job.id,
      mailboxId: mailbox.id,
      status: 'deferred_protection',
      reason: mailboxGate.reason ?? undefined,
      durationMs: Date.now() - start,
    });
    return { ok: false, reason: mailboxGate.reason ?? 'DELIVERABILITY_BLOCK', deferred: true };
  }

  const subjectTemplate = job.templateSubject ?? step.subjectTemplate;
  const bodyTemplate = job.templateBody ?? step.bodyTemplate;

  const freshLeadState = await prisma.campaignLead.findUnique({
    where: { id: data.campaignLeadId },
    include: { lead: { select: { status: true } } },
  });
  if (
    freshLeadState?.repliedAt ||
    freshLeadState?.lead.status === 'REPLIED' ||
    freshLeadState?.stopReason === 'REPLIED' ||
    freshLeadState?.stopReason === 'POSITIVE_REPLY' ||
    freshLeadState?.stopReason === 'NEGATIVE_REPLY' ||
    freshLeadState?.stopReason === 'UNSUBSCRIBED'
  ) {
    await releaseReservation({
      reservationId: allocation.reservationId,
      reason: 'REPLY_DETECTED',
    });
    await sendingJobService.stopCampaignLeadSequence({
      campaignLeadId: data.campaignLeadId,
      workspaceId: data.workspaceId,
      stopReason: 'REPLIED',
      campaignLeadStatus: 'PAUSED',
    });
    await sendingJobService.cancelJob(job.id, data.workspaceId);
    logSendingEvent('Follow-up cancelled — reply detected before send', {
      jobId: job.id,
      campaignLeadId: data.campaignLeadId,
      status: 'cancelled_reply_race',
    });
    return { ok: false, reason: 'REPLY_DETECTED' };
  }

  // Same resolver as enrollment, so a lead accepted there is not blocked here.
  const verificationPolicy = {
    ...resolveVerificationPolicy(
      workspaceVerificationPolicy,
      campaign.verificationPolicy as Record<string, unknown> | null,
    ),
    // A reviewer approved this enrollment despite a review-tier result.
    reviewApproved: campaignLead.verificationApprovedAt != null,
  };

  const policy = evaluateSendingPolicy({
    campaignStatus: campaign.status,
    campaignLeadStatus: campaignLead.status,
    leadEmail: lead.email,
    subjectTemplate,
    bodyTemplate,
    variableContext: leadToVariableContext({
      ...lead,
      websiteAnalysis: lead.websiteAnalyses?.[0] ?? null,
    }),
    suppressions: suppressions.map((s) => ({ type: s.type, value: s.value, reason: s.reason })),
    verification: lead.verification,
    verificationPolicy,
    mailboxes: [],
    rotationStrategy: campaign.rotationStrategy,
    skipRotation: true,
    preselectedMailboxId: mailbox.id,
    isWithinWindow: true,
  });

  if (policy.decision === 'DEFER') {
    await releaseReservation({
      reservationId: allocation.reservationId,
      reason: 'POLICY_DEFER',
    });
    const nextSlot = calculateNextValidSlot(new Date(), scheduleConfig);
    await sendingJobService.rescheduleForWindow(job.id, nextSlot);
    return { ok: false, reason: policy.reason ?? 'DEFERRED', deferred: true };
  }

  if (policy.decision !== 'ALLOW_SEND') {
    await releaseReservation({
      reservationId: allocation.reservationId,
      reason: `POLICY_${policy.decision}`,
    });
    await prisma.emailMessage.create({
      data: {
        workspaceId: data.workspaceId,
        campaignId: data.campaignId,
        campaignLeadId: data.campaignLeadId,
        leadId: data.leadId,
        templateSubject: subjectTemplate,
        templateBody: bodyTemplate,
        status: 'BLOCKED',
        blockReason: policy.reason ?? 'BLOCKED',
        jobId: job.id,
      },
    });
    await sendingJobService.markFailed(job.id, {
      errorCategory: 'PERMANENT',
      message: policy.reason ?? 'BLOCKED',
    });
    logSendingEvent('Send blocked by policy', {
      jobId: job.id,
      blockReason: policy.reason,
      status: 'blocked',
      durationMs: Date.now() - start,
    });
    return { ok: false, reason: policy.reason ?? 'BLOCKED' };
  }

  const credential = mailbox.credential;
  if (!credential || !mailbox.smtpHost || !mailbox.smtpPort) {
    await releaseReservation({
      reservationId: allocation.reservationId,
      reason: 'MAILBOX_NOT_CONFIGURED',
    });
    await sendingJobService.markFailed(job.id, {
      errorCategory: 'PERMANENT',
      message: 'Mailbox not configured',
    });
    return { ok: false, reason: 'MAILBOX_NOT_CONFIGURED' };
  }

  const password = decryptSecret(credential.encryptedPayload, env.ENCRYPTION_KEY);
  const provider = createSmtpProvider({
    host: mailbox.smtpHost,
    port: mailbox.smtpPort,
    username: mailbox.smtpUsername ?? mailbox.emailAddress,
    password,
    encryption: mailbox.encryptionType,
    fromEmail: mailbox.emailAddress,
    fromName: mailbox.fromName,
  });

  // Set once the SMTP server has accepted the message. After that point an
  // error is a bookkeeping failure, not a send failure: retrying would email
  // the lead a second time.
  let delivered: { messageId: string | null } | null = null;

  try {
    const listUnsubscribeUrl = buildUnsubscribeUrl(env.API_URL, data.campaignId, data.leadId, env.SESSION_SECRET);

    // Open tracking: an opaque per-email id drives the pixel URL. Build the HTML
    // from the already-rendered body (after variable/spintax substitution) and
    // append a 1x1 pixel, so the tracker is never scanned as a template token and
    // the layout is unaffected. The plain-text part stays pixel-free.
    const trackingId = randomUUID();
    // A visible opt-out in the body (CAN-SPAM, and expected by mailbox
    // providers) in addition to the List-Unsubscribe header.
    const renderedBody = `${policy.renderedBody ?? bodyTemplate}\n\n${UNSUBSCRIBE_FOOTER_TEXT} ${listUnsubscribeUrl}`;
    const pixelUrl = buildTrackingPixelUrl(env.API_URL, trackingId, env.SESSION_SECRET);
    const htmlBody = `${(policy.renderedBody ?? bodyTemplate).replace(/\n/g, '<br>')}<br><br><span style="font-size:12px;color:#6b7280">${UNSUBSCRIBE_FOOTER_TEXT} <a href="${escapeHtml(listUnsubscribeUrl)}" style="color:#6b7280">unsubscribe</a></span><img src="${pixelUrl}" alt="" width="1" height="1" style="display:none;width:1px;height:1px;border:0;overflow:hidden" />`;

    const sendResult = await provider.send({
      to: lead.email,
      subject: policy.renderedSubject ?? subjectTemplate,
      body: renderedBody,
      html: htmlBody,
      listUnsubscribeUrl,
    });
    delivered = { messageId: sendResult.messageId ?? null };

    const internetMessageId = sendResult.internetMessageId ?? sendResult.messageId ?? null;

    const timezone = scheduleConfig.timezone ?? campaign.workspace.timezone ?? 'UTC';
    const emailMessage = await prisma.$transaction(async (tx) => {
      const message = await tx.emailMessage.create({
        data: {
          workspaceId: data.workspaceId,
          campaignId: data.campaignId,
          campaignLeadId: data.campaignLeadId,
          leadId: data.leadId,
          mailboxId: mailbox.id,
          jobId: job.id,
          templateSubject: step.subjectTemplate,
          templateBody: step.bodyTemplate,
          renderedSubject: policy.renderedSubject,
          renderedBody: policy.renderedBody,
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: sendResult.messageId,
          internetMessageId: internetMessageId ?? null,
          trackingId,
        },
      });
      // currentDailyUsage is "sent today" for display; start a new count on the
      // first send of the mailbox's local day (the scheduler also resets idle
      // mailboxes). Capacity enforcement uses MailboxDailyUsage, not this field.
      const usageTz = mailbox.timezone ?? campaign.workspace.timezone ?? 'UTC';
      const sendNow = new Date();
      const sameUsageDay =
        computeUsageDate(mailbox.usageResetAt, usageTz) === computeUsageDate(sendNow, usageTz);
      await tx.mailbox.update({
        where: { id: mailbox.id },
        data: {
          ...(sameUsageDay
            ? { currentDailyUsage: { increment: 1 } }
            : { currentDailyUsage: 1, usageResetAt: sendNow }),
          lastSuccessfulSendAt: sendNow,
          // Only promote a never-evaluated mailbox. Overwriting DEGRADED/UNHEALTHY
          // here erased the protection service's health tier on every send.
          ...(mailbox.healthStatus === 'UNKNOWN' ? { healthStatus: 'HEALTHY' as const } : {}),
        },
      });
      const existingHealth = await tx.mailboxHealth.findUnique({ where: { mailboxId: mailbox.id } });
      if (existingHealth) {
        await tx.mailboxHealth.update({
          where: { mailboxId: mailbox.id },
          data: { consecutiveFailures: 0, lastCheckedAt: new Date() },
        });
      }
      // Marks the analytics funnel "Contacted" stage. Scoped to NEW so replies
      // or manual qualification are never downgraded by a later step send.
      await tx.lead.updateMany({
        where: { id: data.leadId, workspaceId: data.workspaceId, status: 'NEW' },
        data: { status: 'CONTACTED' },
      });
      return message;
    });

    await deliveryEventService.recordEvent({
      workspaceId: data.workspaceId,
      eventType: 'SENT',
      idempotencyKey: buildIdempotencyKey([job.id, 'SENT', job.attempts]),
      emailMessageId: emailMessage.id,
      sendingJobId: job.id,
      mailboxId: mailbox.id,
      leadId: data.leadId,
      campaignId: data.campaignId,
      metadata: { providerMessageId: sendResult.messageId ?? null },
    });

    void publishWorkflowEvent({
      eventType: 'EMAIL_SENT',
      workspaceId: data.workspaceId,
      leadId: data.leadId,
      campaignId: data.campaignId,
      mailboxId: mailbox.id,
      idempotencyKey: buildIdempotencyKey([job.id, 'workflow-EMAIL_SENT', job.attempts]),
      metadata: { sendingJobId: job.id },
    }).catch(() => {});

    await consumeReservation({ reservationId: allocation.reservationId });
    await sendingLimitService.incrementCampaignDailyUsage(campaign.id, timezone);
    await sendingJobService.markSent(job.id, {
      providerMessageId: sendResult.messageId ?? null,
      emailMessageId: emailMessage.id,
    });
    await sendingJobService.scheduleNextStep({ ...job, sentAt: new Date(), status: 'SENT' } as SendingJob);

    logSendingEvent('Email sent successfully', {
      jobId: job.id,
      workspaceId: data.workspaceId,
      campaignId: data.campaignId,
      campaignLeadId: data.campaignLeadId,
      leadId: data.leadId,
      mailboxId: mailbox.id,
      status: 'sent',
      durationMs: Date.now() - start,
    });

    return { ok: true, providerMessageId: sendResult.messageId ?? null };
  } catch (error) {
    if (delivered) {
      return recordDeliveredAfterBookkeepingError(job, allocation.reservationId, delivered, error, data);
    }
    const classified = classifySendError(error);
    const bounce = classifyBounceFromCategory(classified.category, error);
    const isHardBounce = bounce.isBounce && bounce.bounceType === 'HARD';

    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: {
        healthStatus: classified.retryable ? 'DEGRADED' : 'UNHEALTHY',
        lastErrorAt: new Date(),
        lastErrorMessage: classified.message.slice(0, 500),
      },
    });
    const failedMessage = await prisma.emailMessage.create({
      data: {
        workspaceId: data.workspaceId,
        campaignId: data.campaignId,
        campaignLeadId: data.campaignLeadId,
        leadId: data.leadId,
        mailboxId: mailbox.id,
        jobId: job.id,
        templateSubject: subjectTemplate,
        templateBody: bodyTemplate,
        renderedSubject: policy.renderedSubject,
        renderedBody: policy.renderedBody,
        status: bounce.isBounce ? 'BOUNCED' : 'FAILED',
        bounceType: bounce.bounceType,
        smtpStatusCode: bounce.statusCode,
        enhancedStatusCode: bounce.enhancedStatusCode,
        providerResponse: bounce.response.slice(0, 500),
        blockReason: classified.message.slice(0, 500),
      },
    });

    await deliveryEventService.recordEvent({
      workspaceId: data.workspaceId,
      eventType: bounce.isBounce ? 'BOUNCED' : 'FAILED',
      idempotencyKey: buildIdempotencyKey([
        job.id,
        bounce.isBounce ? 'BOUNCED' : 'FAILED',
        job.attempts,
      ]),
      emailMessageId: failedMessage.id,
      sendingJobId: job.id,
      mailboxId: mailbox.id,
      leadId: data.leadId,
      campaignId: data.campaignId,
      bounceType: bounce.bounceType,
      smtpStatusCode: bounce.statusCode,
      enhancedStatusCode: bounce.enhancedStatusCode,
      providerResponse: bounce.response.slice(0, 500),
      metadata: { errorCategory: classified.category, bounceReason: bounce.reason },
    });

    if (bounce.isBounce) {
      void publishWorkflowEvent({
        eventType: 'EMAIL_BOUNCED',
        workspaceId: data.workspaceId,
        leadId: data.leadId,
        campaignId: data.campaignId,
        mailboxId: mailbox.id,
        idempotencyKey: buildIdempotencyKey([job.id, 'workflow-EMAIL_BOUNCED', job.attempts]),
        metadata: { bounceType: bounce.bounceType, bounceReason: bounce.reason },
      }).catch(() => {});
    }

    if (bounce.isBounce && bounce.bounceType) {
      await recipientBounceService.recordBounce({
        workspaceId: data.workspaceId,
        email: lead.email,
        bounceType: bounce.bounceType,
        smtpStatusCode: bounce.statusCode,
        response: bounce.response,
      });
    }

    // Release the reservation on failure so a re-allocation on retry
    // considers fresh capacity rather than double-counting this attempt.
    await releaseReservation({
      reservationId: allocation.reservationId,
      reason: classified.category,
    });

    if (isHardBounce || classified.category === 'INVALID_ADDRESS') {
      await handleHardBounce({
        workspaceId: data.workspaceId,
        campaignId: data.campaignId,
        campaignLeadId: data.campaignLeadId,
        leadId: data.leadId,
        email: lead.email,
        errorCategory: classified.category,
        bounce,
      });
    }

    // Recompute health from the updated signals so protection state reflects
    // this failure before the next job for this mailbox is dispatched.
    await deliverabilityProtectionService
      .evaluateMailbox(data.workspaceId, mailbox.id)
      .catch(() => null);

    const attempts = job.attempts;
    const isPermanentMailboxIssue =
      classified.category === 'AUTH' ||
      classified.category === 'CONNECTION' ||
      !classified.retryable;

    // A soft bounce is a temporary recipient-side rejection, so it keeps the
    // normal retry budget even when the error category is a blanket BOUNCE.
    const retryable = classified.retryable || (bounce.isBounce && bounce.bounceType === 'SOFT');

    if (retryable && attempts < job.maxAttempts) {
      const delayMs = retryBackoffMs(attempts);
      const retryAt = new Date(Date.now() + delayMs);

      // If the failure is a mailbox-level problem (auth/connection), clear the
      // job's mailbox pointer so re-allocation on retry picks a different one.
      if (isPermanentMailboxIssue) {
        await prisma.sendingJob.update({
          where: { id: job.id },
          data: { mailboxId: null },
        });
      }

      await sendingJobService.rescheduleForRetry(job.id, {
        scheduledAt: retryAt,
        errorCategory: classified.category,
        message: classified.message,
      });
      logSendingEvent('Send failed, scheduled retry', {
        jobId: job.id,
        error: classified.message,
        retryCount: attempts,
        reallocate: isPermanentMailboxIssue,
        status: 'retrying',
        durationMs: Date.now() - start,
      });
      return { ok: false, reason: classified.category, retryable: true };
    }

    await sendingJobService.markFailed(job.id, {
      errorCategory: classified.category,
      message: classified.message,
    });
    logSendingEvent('Send failed permanently', {
      jobId: job.id,
      error: classified.message,
      status: 'failed',
      durationMs: Date.now() - start,
    });
    return { ok: false, reason: classified.category };
  }
}

async function handleIneligibleJob(
  job: SendingJob,
  eligibility: SendingJobEligibilityResult,
): Promise<PipelineOutcome> {
  if (eligibility.reason === 'INVALID_EMAIL') {
    await sendingJobService.markFailed(job.id, {
      errorCategory: 'INVALID_ADDRESS',
      message: eligibility.message,
    });
    logSendingEvent('Send skipped — invalid email', {
      jobId: job.id,
      workspaceId: job.workspaceId,
      status: 'failed',
      reason: eligibility.reason,
    });
    return { ok: false, reason: eligibility.reason };
  }

  await sendingJobService.cancelJob(job.id, job.workspaceId);
  logSendingEvent('Send skipped — lead ineligible', {
    jobId: job.id,
    workspaceId: job.workspaceId,
    status: 'cancelled',
    reason: eligibility.reason,
  });
  return { ok: false, reason: eligibility.reason };
}

/**
 * Permanently removes a recipient from future sending after an unambiguous
 * hard bounce: suppression, lead and enrollment status, and cancellation of any
 * queued follow-ups. Soft bounces never reach this path.
 */
async function handleHardBounce(input: {
  workspaceId: string;
  campaignId: string;
  campaignLeadId: string;
  leadId: string;
  email: string;
  errorCategory: string;
  bounce: BounceClassification;
}): Promise<void> {
  const email = input.email.trim().toLowerCase();

  await prisma.$transaction(async (tx) => {
    await tx.suppression.upsert({
      where: {
        workspaceId_type_value: {
          workspaceId: input.workspaceId,
          type: 'EMAIL',
          value: email,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        type: 'EMAIL',
        value: email,
        reason: 'BOUNCED',
        source: 'SENDING',
      },
      update: {
        reason: 'BOUNCED',
        source: 'SENDING',
      },
    });

    await tx.lead.update({
      where: { id: input.leadId },
      data: { status: 'BOUNCED' },
    });
  });

  await sendingJobService.stopCampaignLeadSequence({
    campaignLeadId: input.campaignLeadId,
    workspaceId: input.workspaceId,
    stopReason: 'HARD_BOUNCED',
    campaignLeadStatus: 'BOUNCED',
  });

  logSendingEvent('Lead marked bounced after send failure', {
    workspaceId: input.workspaceId,
    campaignLeadId: input.campaignLeadId,
    leadId: input.leadId,
    status: 'bounced',
    reason: input.errorCategory,
    error: input.bounce.response,
  });
}

/**
 * The SMTP server accepted the message but recording it failed. Mark the job
 * SENT and consume the reservation (best effort) so it is never retried or
 * re-sent, and log loudly for follow-up. The lead's next step is not scheduled
 * here; that is safer than a duplicate email.
 */
async function recordDeliveredAfterBookkeepingError(
  job: SendingJob,
  reservationId: string,
  delivered: { messageId: string | null },
  error: unknown,
  data: EmailSendJobData,
): Promise<PipelineOutcome> {
  const message = error instanceof Error ? error.message : String(error);
  await sendingJobService
    .markSent(job.id, { providerMessageId: delivered.messageId, emailMessageId: null })
    .catch(() => null);
  await consumeReservation({ reservationId }).catch(() => null);
  logSendingEvent('Email delivered but recording failed; not retrying to avoid a duplicate send', {
    jobId: job.id,
    workspaceId: data.workspaceId,
    campaignId: data.campaignId,
    campaignLeadId: data.campaignLeadId,
    leadId: data.leadId,
    status: 'sent_bookkeeping_error',
    error: message.slice(0, 500),
  });
  return { ok: true, providerMessageId: delivered.messageId };
}

const UNSUBSCRIBE_FOOTER_TEXT = "If you'd rather not hear from me again:";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

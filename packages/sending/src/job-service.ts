import { prisma, Prisma, type CampaignLeadStopReason, type SendingJob, type SendingJobStatus } from '@signalforge/database';
import type { ScheduleConfig } from '@signalforge/campaigns';
import { countFollowUpSteps, delayToDays } from '@signalforge/campaigns';
import { buildIdempotencyKey } from '@signalforge/deliverability';
import { publishWorkflowEvent } from '@signalforge/queue';
import { calculateNextSendTime } from './schedule-calculator.js';
import { logSendingEvent } from './activity.js';
import { assertTransition, isTerminal } from './job-state-machine.js';

const DEFAULT_MAX_ATTEMPTS = 3;

export interface CreateSendingJobInput {
  workspaceId: string;
  campaignId: string;
  campaignLeadId: string;
  leadId: string;
  sequenceStepId: string;
  scheduledAt: Date;
  priority?: number;
  maxAttempts?: number;
  mailboxId?: string | null;
  templateSubject?: string | null;
  templateBody?: string | null;
}
export interface BootstrapCampaignResult {
  created: number;
  skipped: number;
  eligibleLeads: number;
}

export class SendingJobService {
  async createJob(input: CreateSendingJobInput): Promise<SendingJob> {
    return prisma.sendingJob.upsert({
      where: {
        campaignLeadId_sequenceStepId: {
          campaignLeadId: input.campaignLeadId,
          sequenceStepId: input.sequenceStepId,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        campaignId: input.campaignId,
        campaignLeadId: input.campaignLeadId,
        leadId: input.leadId,
        sequenceStepId: input.sequenceStepId,
        mailboxId: input.mailboxId ?? null,
        scheduledAt: input.scheduledAt,
        priority: input.priority ?? 0,
        maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        status: 'SCHEDULED',
        templateSubject: input.templateSubject ?? null,
        templateBody: input.templateBody ?? null,
      },
      update: {
        scheduledAt: input.scheduledAt,
        status: 'SCHEDULED',
        priority: input.priority ?? 0,
        ...(input.templateSubject !== undefined && { templateSubject: input.templateSubject }),
        ...(input.templateBody !== undefined && { templateBody: input.templateBody }),
      },    });
  }

  async bootstrapCampaign(campaignId: string, workspaceId: string): Promise<BootstrapCampaignResult> {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, workspaceId },
      include: {
        steps: { where: { enabled: true }, orderBy: { order: 'asc' } },
        campaignLeads: {
          where: { status: { in: ['PENDING', 'ACTIVE'] } },
          include: { lead: true },
        },
      },
    });
    if (!campaign) throw new Error('Campaign not found');

    const firstStep = campaign.steps[0];
    if (!firstStep) return { created: 0, skipped: 0, eligibleLeads: 0 };

    const scheduleConfig = (campaign.scheduleConfig ?? {}) as ScheduleConfig;
    const now = new Date();
    let created = 0;
    let skipped = 0;

    for (const cl of campaign.campaignLeads) {
      const existing = await prisma.sendingJob.findUnique({
        where: {
          campaignLeadId_sequenceStepId: {
            campaignLeadId: cl.id,
            sequenceStepId: firstStep.id,
          },
        },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      const next = calculateNextSendTime({
        now,
        baseDelayDays: 0,
        config: scheduleConfig,
      });
      await this.createJob({
        workspaceId,
        campaignId,
        campaignLeadId: cl.id,
        leadId: cl.leadId,
        sequenceStepId: firstStep.id,
        scheduledAt: next.scheduledAt,
        templateSubject: cl.subjectOverride ?? firstStep.subjectTemplate,
        templateBody: cl.bodyOverride ?? firstStep.bodyTemplate,
      });      created += 1;
    }

    logSendingEvent('Campaign sending jobs bootstrapped', {
      workspaceId,
      campaignId,
      status: 'bootstrapped',
      created,
      skipped,
    });

    return { created, skipped, eligibleLeads: campaign.campaignLeads.length };
  }

  async scheduleNextStep(job: SendingJob): Promise<SendingJob | null> {
    const [campaignLead, lead, campaign] = await Promise.all([
      prisma.campaignLead.findUnique({ where: { id: job.campaignLeadId } }),
      prisma.lead.findUnique({ where: { id: job.leadId } }),
      prisma.campaign.findUnique({
        where: { id: job.campaignId },
        include: {
          steps: { where: { enabled: true }, orderBy: { order: 'asc' } },
        },
      }),
    ]);
    if (!campaign || !campaignLead || !lead) return null;

    const ineligibleLeadStatuses = ['REPLIED', 'UNSUBSCRIBED', 'BOUNCED', 'ARCHIVED'];
    const ineligibleCampaignLeadStatuses = ['PAUSED', 'COMPLETED', 'UNSUBSCRIBED', 'BOUNCED'];
    if (
      ineligibleLeadStatuses.includes(lead.status) ||
      ineligibleCampaignLeadStatuses.includes(campaignLead.status)
    ) {
      logSendingEvent('Skipped scheduling next step — lead not eligible', {
        workspaceId: job.workspaceId,
        campaignId: job.campaignId,
        campaignLeadId: job.campaignLeadId,
        leadId: job.leadId,
        status: 'skipped_ineligible',
      });
      return null;
    }

    const currentStep = campaign.steps.find((s) => s.id === job.sequenceStepId);
    if (!currentStep) return null;

    if (!campaign.followUpsEnabled) {
      await prisma.campaignLead.update({
        where: { id: job.campaignLeadId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          stopReason: 'COMPLETED',
          stoppedAt: new Date(),
        },
      });
      void publishWorkflowEvent({
        eventType: 'SEQUENCE_COMPLETED',
        workspaceId: job.workspaceId,
        leadId: job.leadId,
        campaignId: job.campaignId,
        idempotencyKey: buildIdempotencyKey(['sequence-completed', job.campaignLeadId]),
        metadata: { campaignLeadId: job.campaignLeadId, followUpsEnabled: false },
      }).catch(() => {});
      return null;
    }

    const followUpSteps = campaign.steps.filter((s) => s.order > currentStep.order);
    const nextStep = followUpSteps[0];
    const enabledFollowUps = countFollowUpSteps(campaign.steps);
    if (enabledFollowUps > campaign.maxFollowUps) {
      logSendingEvent('Follow-up count exceeds campaign maxFollowUps', {
        workspaceId: job.workspaceId,
        campaignId: job.campaignId,
        status: 'skipped_max_followups',
      });
    }

    if (!nextStep) {
      await prisma.campaignLead.update({
        where: { id: job.campaignLeadId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          stopReason: 'COMPLETED',
          stoppedAt: new Date(),
        },
      });
      void publishWorkflowEvent({
        eventType: 'SEQUENCE_COMPLETED',
        workspaceId: job.workspaceId,
        leadId: job.leadId,
        campaignId: job.campaignId,
        idempotencyKey: buildIdempotencyKey(['sequence-completed', job.campaignLeadId]),
        metadata: { campaignLeadId: job.campaignLeadId },
      }).catch(() => {});
      return null;
    }

    if (nextStep.order > campaign.maxFollowUps) {
      await prisma.campaignLead.update({
        where: { id: job.campaignLeadId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          stopReason: 'COMPLETED',
          stoppedAt: new Date(),
        },
      });
      return null;
    }

    const scheduleConfig = (campaign.scheduleConfig ?? {}) as ScheduleConfig;    const delayDays = delayToDays(nextStep.delayAmount, nextStep.delayUnit);
    const next = calculateNextSendTime({
      now: new Date(),
      baseDelayDays: delayDays,
      config: scheduleConfig,
    });

    await prisma.campaignLead.update({
      where: { id: job.campaignLeadId },
      data: { currentStepOrder: nextStep.order, status: 'ACTIVE' },
    });

    const scheduledJob = await this.createJob({
      workspaceId: job.workspaceId,
      campaignId: job.campaignId,
      campaignLeadId: job.campaignLeadId,
      leadId: job.leadId,
      sequenceStepId: nextStep.id,
      scheduledAt: next.scheduledAt,
      templateSubject: nextStep.subjectTemplate,
      templateBody: nextStep.bodyTemplate,
    });

    void publishWorkflowEvent({
      eventType: 'FOLLOW_UP_SCHEDULED',
      workspaceId: job.workspaceId,
      leadId: job.leadId,
      campaignId: job.campaignId,
      idempotencyKey: buildIdempotencyKey([
        'follow-up-scheduled',
        job.campaignLeadId,
        nextStep.id,
      ]),
      metadata: {
        campaignLeadId: job.campaignLeadId,
        stepId: nextStep.id,
        stepOrder: nextStep.order,
        scheduledAt: next.scheduledAt.toISOString(),
      },
    }).catch(() => {});

    logSendingEvent('Follow-up scheduled', {
      workspaceId: job.workspaceId,
      campaignId: job.campaignId,
      campaignLeadId: job.campaignLeadId,
      leadId: job.leadId,
      status: 'follow_up_scheduled',
      stepOrder: nextStep.order,
    });

    return scheduledJob;
  }

  async stopCampaignLeadSequence(input: {
    campaignLeadId: string;
    workspaceId: string;
    stopReason: CampaignLeadStopReason;
    campaignLeadStatus?: 'PAUSED' | 'COMPLETED' | 'UNSUBSCRIBED' | 'BOUNCED';
    cancelJobs?: boolean;
  }): Promise<void> {
    const now = new Date();
    const campaignLead = await prisma.campaignLead.findFirst({
      where: { id: input.campaignLeadId, campaign: { workspaceId: input.workspaceId } },
      include: { campaign: true, lead: true },
    });
    if (!campaignLead) return;

    await prisma.campaignLead.update({
      where: { id: input.campaignLeadId },
      data: {
        status: input.campaignLeadStatus ?? 'COMPLETED',
        stopReason: input.stopReason,
        stoppedAt: now,
        ...(input.stopReason === 'REPLIED' ||
        input.stopReason === 'POSITIVE_REPLY' ||
        input.stopReason === 'NEGATIVE_REPLY'
          ? { repliedAt: now, lastReplyAt: now }
          : {}),
      },
    });

    if (input.cancelJobs !== false) {
      await this.cancelCampaignLeadJobs(input.campaignLeadId, input.workspaceId, input.stopReason);
    }

    void publishWorkflowEvent({
      eventType: 'SEQUENCE_STOPPED',
      workspaceId: input.workspaceId,
      leadId: campaignLead.leadId,
      campaignId: campaignLead.campaignId,
      idempotencyKey: buildIdempotencyKey([
        'sequence-stopped',
        input.campaignLeadId,
        input.stopReason,
      ]),
      metadata: {
        campaignLeadId: input.campaignLeadId,
        stopReason: input.stopReason,
      },
    }).catch(() => {});

    void publishWorkflowEvent({
      eventType: 'FOLLOW_UP_CANCELLED',
      workspaceId: input.workspaceId,
      leadId: campaignLead.leadId,
      campaignId: campaignLead.campaignId,
      idempotencyKey: buildIdempotencyKey([
        'follow-up-cancelled',
        input.campaignLeadId,
        input.stopReason,
      ]),
      metadata: {
        campaignLeadId: input.campaignLeadId,
        stopReason: input.stopReason,
      },
    }).catch(() => {});

    logSendingEvent('Campaign lead sequence stopped', {
      workspaceId: input.workspaceId,
      campaignId: campaignLead.campaignId,
      campaignLeadId: input.campaignLeadId,
      leadId: campaignLead.leadId,
      status: 'sequence_stopped',
      stopReason: input.stopReason,
    });
  }

  async cancelPendingFollowUpJobs(
    campaignId: string,
    workspaceId: string,
    campaignLeadId?: string,
  ): Promise<number> {
    const steps = await prisma.campaignStep.findMany({
      where: { campaignId, order: { gt: 0 } },
      select: { id: true },
    });
    const followUpStepIds = steps.map((s) => s.id);
    if (followUpStepIds.length === 0) return 0;

    const result = await prisma.sendingJob.updateMany({
      where: {
        campaignId,
        workspaceId,
        ...(campaignLeadId ? { campaignLeadId } : {}),
        sequenceStepId: { in: followUpStepIds },
        status: { in: ['PENDING', 'SCHEDULED', 'RETRYING', 'PAUSED'] },
      },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    if (result.count > 0) {
      logSendingEvent('Pending follow-up jobs cancelled', {
        workspaceId,
        campaignId,
        status: 'follow_ups_cancelled',
        count: result.count,
      });
    }

    return result.count;
  }
  async claimJob(jobId: string): Promise<SendingJob | null> {
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await tx.sendingJob.findUnique({ where: { id: jobId } });
        if (!current) return null;
        if (current.status !== 'SCHEDULED' && current.status !== 'RETRYING' && current.status !== 'PENDING') {
          return null;
        }
        return tx.sendingJob.update({
          where: { id: jobId },
          data: {
            status: 'PROCESSING',
            claimedAt: new Date(),
            attempts: { increment: 1 },
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return null;
      }
      throw error;
    }
  }

  async markSent(
    jobId: string,
    data: { providerMessageId?: string | null; emailMessageId?: string | null },
  ): Promise<SendingJob> {
    return prisma.sendingJob.update({
      where: { id: jobId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        providerMessageId: data.providerMessageId ?? null,
        emailMessageId: data.emailMessageId ?? null,
        lastError: null,
        errorCategory: null,
      },
    });
  }

  async markFailed(
    jobId: string,
    data: { errorCategory: string; message: string },
  ): Promise<SendingJob> {
    return prisma.sendingJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorCategory: data.errorCategory as never,
        lastError: data.message.slice(0, 500),
      },
    });
  }

  async rescheduleForRetry(
    jobId: string,
    data: { scheduledAt: Date; errorCategory: string; message: string },
  ): Promise<SendingJob> {
    return prisma.sendingJob.update({
      where: { id: jobId },
      data: {
        status: 'SCHEDULED',
        scheduledAt: data.scheduledAt,
        errorCategory: data.errorCategory as never,
        lastError: data.message.slice(0, 500),
      },
    });
  }

  async rescheduleForWindow(jobId: string, scheduledAt: Date): Promise<SendingJob> {
    return prisma.sendingJob.update({
      where: { id: jobId },
      data: { status: 'SCHEDULED', scheduledAt, claimedAt: null },
    });
  }

  async cancelJob(jobId: string, workspaceId: string): Promise<SendingJob> {
    const job = await prisma.sendingJob.findFirst({ where: { id: jobId, workspaceId } });
    if (!job) throw new Error('Sending job not found');
    if (isTerminal(job.status)) return job;
    assertTransition(job.status, 'CANCELLED');
    return prisma.sendingJob.update({
      where: { id: jobId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }

  async retryJob(jobId: string, workspaceId: string): Promise<SendingJob> {
    const job = await prisma.sendingJob.findFirst({ where: { id: jobId, workspaceId } });
    if (!job) throw new Error('Sending job not found');
    if (job.status !== 'FAILED') {
      throw new Error(`Cannot retry job in status ${job.status}`);
    }
    if (job.errorCategory === 'PERMANENT' || job.errorCategory === 'AUTH' || job.errorCategory === 'BOUNCE' || job.errorCategory === 'INVALID_ADDRESS') {
      throw new Error(`Job cannot be retried; error category ${job.errorCategory}`);
    }
    return prisma.sendingJob.update({
      where: { id: jobId },
      data: {
        status: 'SCHEDULED',
        scheduledAt: new Date(),
        attempts: 0,
        failedAt: null,
        errorCategory: null,
        lastError: null,
      },
    });
  }

  async pauseCampaignJobs(campaignId: string, workspaceId: string): Promise<number> {
    const result = await prisma.sendingJob.updateMany({
      where: {
        campaignId,
        workspaceId,
        status: { in: ['PENDING', 'SCHEDULED', 'RETRYING'] },
      },
      data: { status: 'PAUSED', pausedAt: new Date() },
    });
    return result.count;
  }

  async resumeCampaignJobs(campaignId: string, workspaceId: string): Promise<number> {
    const jobs = await prisma.sendingJob.findMany({
      where: { campaignId, workspaceId, status: 'PAUSED' },
    });
    const now = new Date();
    let updated = 0;
    for (const job of jobs) {
      const scheduledAt = job.scheduledAt.getTime() < now.getTime() ? now : job.scheduledAt;
      await prisma.sendingJob.update({
        where: { id: job.id },
        data: { status: 'SCHEDULED', pausedAt: null, scheduledAt },
      });
      updated += 1;
    }
    return updated;
  }

  async cancelCampaignJobs(campaignId: string, workspaceId: string): Promise<number> {
    const result = await prisma.sendingJob.updateMany({
      where: {
        campaignId,
        workspaceId,
        status: { in: ['PENDING', 'SCHEDULED', 'RETRYING', 'PAUSED'] },
      },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    return result.count;
  }

  async cancelCampaignLeadJobs(
    campaignLeadId: string,
    workspaceId: string,
    reason?: string,
  ): Promise<number> {
    const result = await prisma.sendingJob.updateMany({
      where: {
        campaignLeadId,
        workspaceId,
        status: { in: ['PENDING', 'SCHEDULED', 'RETRYING'] },
      },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    if (result.count > 0) {
      logSendingEvent('Campaign lead sending jobs cancelled', {
        workspaceId,
        campaignLeadId,
        status: 'cancelled',
        ...(reason ? { reason } : {}),
      });
    }
    return result.count;
  }

  async listJobs(
    workspaceId: string,
    filters: {
      campaignId?: string;
      status?: SendingJobStatus | SendingJobStatus[];
      mailboxId?: string;
      leadId?: string;
      errorCategory?: string;
      from?: Date;
      to?: Date;
      search?: string;
    },
    pagination: { page: number; limit: number },
  ) {
    const where: Prisma.SendingJobWhereInput = { workspaceId };
    if (filters.campaignId) where.campaignId = filters.campaignId;
    if (filters.status) {
      where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
    }
    if (filters.mailboxId) where.mailboxId = filters.mailboxId;
    if (filters.leadId) where.leadId = filters.leadId;
    if (filters.errorCategory) where.errorCategory = filters.errorCategory as never;
    if (filters.from || filters.to) {
      where.scheduledAt = {};
      if (filters.from) (where.scheduledAt as { gte?: Date }).gte = filters.from;
      if (filters.to) (where.scheduledAt as { lte?: Date }).lte = filters.to;
    }
    if (filters.search) {
      where.lead = { email: { contains: filters.search, mode: 'insensitive' } };
    }

    const skip = (pagination.page - 1) * pagination.limit;
    const [data, total] = await Promise.all([
      prisma.sendingJob.findMany({
        where,
        orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: pagination.limit,
        include: {
          campaign: { select: { id: true, name: true } },
          lead: { select: { id: true, email: true, firstName: true, lastName: true, company: true } },
          mailbox: { select: { id: true, emailAddress: true, fromName: true } },
          step: { select: { id: true, order: true, subjectTemplate: true } },
        },
      }),
      prisma.sendingJob.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    };
  }

  async getJob(jobId: string, workspaceId: string) {
    return prisma.sendingJob.findFirst({
      where: { id: jobId, workspaceId },
      include: {
        campaign: { select: { id: true, name: true } },
        lead: true,
        mailbox: { select: { id: true, emailAddress: true, fromName: true } },
        step: true,
      },
    });
  }

  async getQueueStats(workspaceId: string): Promise<Record<SendingJobStatus, number>> {
    const rows = await prisma.sendingJob.groupBy({
      by: ['status'],
      where: { workspaceId },
      _count: { _all: true },
    });
    const base: Record<SendingJobStatus, number> = {
      PENDING: 0,
      SCHEDULED: 0,
      PROCESSING: 0,
      RETRYING: 0,
      SENT: 0,
      FAILED: 0,
      CANCELLED: 0,
      PAUSED: 0,
    };
    for (const row of rows) {
      base[row.status] = row._count._all;
    }
    return base;
  }

  async getCampaignSendingStats(campaignId: string, workspaceId: string) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, workspaceId },
      include: { workspace: true },
    });
    if (!campaign) return null;

    const rows = await prisma.sendingJob.groupBy({
      by: ['status'],
      where: { campaignId, workspaceId },
      _count: { _all: true },
    });
    const counts: Record<SendingJobStatus, number> = {
      PENDING: 0,
      SCHEDULED: 0,
      PROCESSING: 0,
      RETRYING: 0,
      SENT: 0,
      FAILED: 0,
      CANCELLED: 0,
      PAUSED: 0,
    };
    for (const row of rows) {
      counts[row.status] = row._count._all;
    }

    const scheduleConfig = (campaign.scheduleConfig ?? {}) as { timezone?: string };
    const timezone = scheduleConfig.timezone ?? campaign.workspace.timezone ?? 'UTC';
    const { computeCampaignUsageDate } = await import('./schedule-calculator.js');
    const usageDate = computeCampaignUsageDate(new Date(), timezone);
    const usage = await prisma.campaignDailyUsage.findUnique({
      where: {
        campaignId_usageDate: {
          campaignId,
          usageDate: new Date(`${usageDate}T00:00:00Z`),
        },
      },
    });

    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    const pending = counts.PENDING + counts.SCHEDULED + counts.RETRYING + counts.PAUSED;

    return {
      counts,
      total,
      pending,
      sent: counts.SENT,
      failed: counts.FAILED,
      cancelled: counts.CANCELLED,
      dailyLimit: campaign.dailySendingLimit,
      sentToday: usage?.sentCount ?? 0,
      timezone,
    };
  }
}

export const sendingJobService = new SendingJobService();

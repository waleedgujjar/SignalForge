import type { CampaignStatus, Prisma } from '@signalforge/database';
import { prisma } from '@signalforge/database';
import { logCampaignActivity } from './activity.js';
import { campaignValidationService } from './validation.js';
import type { ScheduleConfig } from './types.js';

const LAUNCHABLE_STATUSES = new Set<CampaignStatus>(['DRAFT', 'PAUSED', 'SCHEDULED']);
const PAUSABLE_STATUSES = new Set<CampaignStatus>(['ACTIVE', 'SCHEDULED']);
const RESUMABLE_STATUSES = new Set<CampaignStatus>(['PAUSED']);
const STOPPABLE_STATUSES = new Set<CampaignStatus>(['ACTIVE', 'PAUSED', 'SCHEDULED']);

function parseScheduleConfig(raw: unknown): ScheduleConfig {
  if (!raw || typeof raw !== 'object') return {};
  return raw as ScheduleConfig;
}

export class CampaignService {
  async createDraft(
    workspaceId: string,
    data: {
      name: string;
      description?: string | null;
      rotationStrategy?: string;
      sendingMode?: 'MAILBOX_LIST' | 'SMTP_POOL' | 'SINGLE_MAILBOX';
      smtpPoolId?: string | null;
      mailboxId?: string | null;
      dailySendingLimit?: number;
      scheduleConfig?: Record<string, unknown>;
      verificationPolicy?: Record<string, unknown>;
      suppressionPolicy?: Record<string, unknown>;
      duplicateEnrollmentPolicy?: string;
      actorUserId?: string;
    },
  ) {
    const campaign = await prisma.campaign.create({
      data: {
        workspaceId,
        name: data.name,
        description: data.description ?? null,
        status: 'DRAFT',
        rotationStrategy: (data.rotationStrategy as Prisma.CampaignCreateInput['rotationStrategy']) ?? 'HEALTH_AWARE',
        sendingMode: (data.sendingMode as Prisma.CampaignCreateInput['sendingMode']) ?? 'MAILBOX_LIST',
        smtpPoolId: data.smtpPoolId ?? null,
        mailboxId: data.mailboxId ?? null,
        dailySendingLimit: data.dailySendingLimit,
        scheduleConfig: (data.scheduleConfig ?? {}) as Prisma.InputJsonValue,
        verificationPolicy: (data.verificationPolicy ?? {}) as Prisma.InputJsonValue,
        suppressionPolicy: (data.suppressionPolicy ?? {}) as Prisma.InputJsonValue,
        duplicateEnrollmentPolicy:
          (data.duplicateEnrollmentPolicy as Prisma.CampaignCreateInput['duplicateEnrollmentPolicy']) ?? 'BLOCK',
      },
    });

    await logCampaignActivity({
      campaignId: campaign.id,
      workspaceId,
      type: 'CREATED',
      summary: `Campaign "${campaign.name}" created`,
      actorUserId: data.actorUserId,
    });

    return campaign;
  }

  async updateCampaign(
    campaignId: string,
    workspaceId: string,
    data: Partial<{
      name: string;
      description: string | null;
      rotationStrategy: string;
      sendingMode: 'MAILBOX_LIST' | 'SMTP_POOL' | 'SINGLE_MAILBOX';
      smtpPoolId: string | null;
      mailboxId: string | null;
      dailySendingLimit: number | null;
      scheduleConfig: Record<string, unknown>;
      verificationPolicy: Record<string, unknown>;
      suppressionPolicy: Record<string, unknown>;
      duplicateEnrollmentPolicy: string;
      followUpsEnabled?: boolean;
      maxFollowUps?: number;
      replyHandlingPolicy?: Record<string, unknown>;
      mailboxIds: string[];
      actorUserId: string;
    }>,
  ) {
    const existing = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
    if (!existing) throw new Error('Campaign not found');

    if (data.smtpPoolId) {
      const pool = await prisma.smtpPool.findFirst({
        where: { id: data.smtpPoolId, workspaceId },
      });
      if (!pool) throw new Error('SMTP pool not found in workspace');
    }
    if (data.mailboxId) {
      const mailbox = await prisma.mailbox.findFirst({
        where: { id: data.mailboxId, workspaceId },
      });
      if (!mailbox) throw new Error('Mailbox not found in workspace');
    }

    const campaign = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.rotationStrategy !== undefined && {
          rotationStrategy: data.rotationStrategy as Prisma.CampaignUpdateInput['rotationStrategy'],
        }),
        ...(data.sendingMode !== undefined && {
          sendingMode: data.sendingMode as Prisma.CampaignUpdateInput['sendingMode'],
        }),
        ...(data.smtpPoolId !== undefined && { smtpPoolId: data.smtpPoolId }),
        ...(data.mailboxId !== undefined && { mailboxId: data.mailboxId }),
        ...(data.dailySendingLimit !== undefined && { dailySendingLimit: data.dailySendingLimit }),
        ...(data.scheduleConfig !== undefined && {
          scheduleConfig: data.scheduleConfig as Prisma.InputJsonValue,
        }),
        ...(data.verificationPolicy !== undefined && {
          verificationPolicy: data.verificationPolicy as Prisma.InputJsonValue,
        }),
        ...(data.suppressionPolicy !== undefined && {
          suppressionPolicy: data.suppressionPolicy as Prisma.InputJsonValue,
        }),
        ...(data.duplicateEnrollmentPolicy !== undefined && {
          duplicateEnrollmentPolicy:
            data.duplicateEnrollmentPolicy as Prisma.CampaignUpdateInput['duplicateEnrollmentPolicy'],
        }),
        ...(data.followUpsEnabled !== undefined && { followUpsEnabled: data.followUpsEnabled }),
        ...(data.maxFollowUps !== undefined && { maxFollowUps: data.maxFollowUps }),
        ...(data.replyHandlingPolicy !== undefined && {
          replyHandlingPolicy: data.replyHandlingPolicy as Prisma.InputJsonValue,
        }),
      },
    });

    if (data.mailboxIds) {
      await prisma.campaignMailbox.deleteMany({ where: { campaignId } });
      if (data.mailboxIds.length > 0) {
        await prisma.campaignMailbox.createMany({
          data: data.mailboxIds.map((mailboxId) => ({ campaignId, mailboxId })),
        });
      }
    }

    const activityType = data.scheduleConfig !== undefined ? 'SCHEDULE_UPDATED' : 'UPDATED';
    await logCampaignActivity({
      campaignId,
      workspaceId,
      type: activityType,
      summary: 'Campaign settings updated',
      actorUserId: data.actorUserId,
    });

    return campaign;
  }

  async launch(campaignId: string, workspaceId: string, actorUserId?: string) {
    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
    if (!campaign) throw new Error('Campaign not found');
    if (!LAUNCHABLE_STATUSES.has(campaign.status)) {
      throw new Error(`Cannot launch campaign in ${campaign.status} status`);
    }

    const validation = await campaignValidationService.validate(campaignId, workspaceId);
    if (!validation.valid) {
      return { success: false as const, validation };
    }

    const scheduleConfig = parseScheduleConfig(campaign.scheduleConfig);
    const scheduledAt = campaign.scheduledAt;
    const useScheduled = scheduledAt && scheduledAt.getTime() > Date.now();

    const updated = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: useScheduled ? 'SCHEDULED' : 'ACTIVE',
        launchedAt: useScheduled ? campaign.launchedAt : new Date(),
        scheduledAt: useScheduled ? scheduledAt : campaign.scheduledAt,
      },
    });

    await logCampaignActivity({
      campaignId,
      workspaceId,
      type: 'LAUNCHED',
      summary: useScheduled ? 'Campaign scheduled for launch' : 'Campaign launched',
      actorUserId,
      metadata: { status: updated.status, scheduleConfig },
    });

    return { success: true as const, campaign: updated, validation };
  }

  async pause(campaignId: string, workspaceId: string, actorUserId?: string) {
    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
    if (!campaign) throw new Error('Campaign not found');
    if (!PAUSABLE_STATUSES.has(campaign.status)) {
      throw new Error(`Cannot pause campaign in ${campaign.status} status`);
    }

    const updated = await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'PAUSED', pausedAt: new Date() },
    });

    await logCampaignActivity({
      campaignId,
      workspaceId,
      type: 'PAUSED',
      summary: 'Campaign paused',
      actorUserId,
    });

    return updated;
  }

  async resume(campaignId: string, workspaceId: string, actorUserId?: string) {
    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
    if (!campaign) throw new Error('Campaign not found');
    if (!RESUMABLE_STATUSES.has(campaign.status)) {
      throw new Error(`Cannot resume campaign in ${campaign.status} status`);
    }

    const updated = await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'ACTIVE', pausedAt: null },
    });

    await logCampaignActivity({
      campaignId,
      workspaceId,
      type: 'RESUMED',
      summary: 'Campaign resumed',
      actorUserId,
    });

    return updated;
  }

  async stop(
    campaignId: string,
    workspaceId: string,
    input: { confirmed: boolean; reason?: string },
    actorUserId?: string,
  ) {
    if (!input.confirmed) throw new Error('Stop confirmation required');

    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
    if (!campaign) throw new Error('Campaign not found');
    if (!STOPPABLE_STATUSES.has(campaign.status)) {
      throw new Error(`Cannot stop campaign in ${campaign.status} status`);
    }

    const updated = await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'STOPPED', stoppedAt: new Date() },
    });

    await logCampaignActivity({
      campaignId,
      workspaceId,
      type: 'STOPPED',
      summary: input.reason ? `Campaign stopped: ${input.reason}` : 'Campaign stopped',
      actorUserId,
      metadata: { reason: input.reason },
    });

    return updated;
  }

  async archive(campaignId: string, workspaceId: string, actorUserId?: string) {
    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
    if (!campaign) throw new Error('Campaign not found');

    const updated = await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });

    await logCampaignActivity({
      campaignId,
      workspaceId,
      type: 'ARCHIVED',
      summary: 'Campaign archived',
      actorUserId,
    });

    return updated;
  }

  async getActivity(
    campaignId: string,
    workspaceId: string,
    page: number,
    limit: number,
  ) {
    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
    if (!campaign) throw new Error('Campaign not found');

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      prisma.campaignActivity.findMany({
        where: { campaignId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.campaignActivity.count({ where: { campaignId } }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

export const campaignService = new CampaignService();

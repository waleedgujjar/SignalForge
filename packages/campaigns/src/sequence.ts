import type { Prisma } from '@signalforge/database';
import { prisma } from '@signalforge/database';
import { logCampaignActivity } from './activity.js';
import { syncDelayDays, type DelayUnit } from './delays.js';
import {
  MAX_SEQUENCE_STEPS,
  buildDefaultFollowUpSteps,
  clampMaxFollowUps,
  isInitialStep,
  validateDelayAmount,
} from './follow-up-policy.js';

export { delayToDays, syncDelayDays } from './delays.js';

type StepType = 'EMAIL';

export class SequenceService {
  async seedFollowUpSteps(
    campaignId: string,
    workspaceId: string,
    maxFollowUps: number,
    actorUserId?: string,
  ) {
    await this.assertCampaignEditable(campaignId, workspaceId);

    const existing = await prisma.campaignStep.count({ where: { campaignId } });
    if (existing > 0) {
      throw new Error('Campaign already has sequence steps. Remove existing steps before seeding.');
    }

    const count = clampMaxFollowUps(maxFollowUps);
    const defaults = buildDefaultFollowUpSteps(count);

    await prisma.$transaction(
      defaults.map((step) =>
        prisma.campaignStep.create({
          data: {
            campaignId,
            order: step.order,
            type: 'EMAIL',
            subjectTemplate: step.subjectTemplate,
            bodyTemplate: step.bodyTemplate,
            delayAmount: step.delayAmount,
            delayUnit: step.delayUnit,
            delayDays: syncDelayDays(step.delayAmount, step.delayUnit),
            enabled: step.enabled,
          },
        }),
      ),
    );

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { followUpsEnabled: true, maxFollowUps: count },
    });

    await logCampaignActivity({
      campaignId,
      workspaceId,
      type: 'SEQUENCE_UPDATED',
      summary: `Seeded ${count} automated follow-up steps`,
      actorUserId,
      metadata: { action: 'seed', maxFollowUps: count },
    });

    return prisma.campaignStep.findMany({
      where: { campaignId },
      orderBy: { order: 'asc' },
    });
  }

  async addStep(    campaignId: string,
    workspaceId: string,
    data: {
      subjectTemplate: string;
      bodyTemplate: string;
      delayAmount?: number;
      delayUnit?: DelayUnit;
      type?: StepType;
      enabled?: boolean;
      actorUserId?: string;
    },
  ) {
    await this.assertCampaignEditable(campaignId, workspaceId);

    const stepCount = await prisma.campaignStep.count({ where: { campaignId } });
    if (stepCount >= MAX_SEQUENCE_STEPS) {
      throw new Error(`Maximum ${MAX_SEQUENCE_STEPS} steps allowed (1 initial + 5 follow-ups)`);
    }

    const maxOrder = await prisma.campaignStep.aggregate({
      where: { campaignId },
      _max: { order: true },
    });
    const order = (maxOrder._max.order ?? -1) + 1;
    const delayAmount = data.delayAmount ?? (order === 0 ? 0 : 3);
    const delayUnit = data.delayUnit ?? 'DAYS';

    if (!isInitialStep(order)) {
      const delayError = validateDelayAmount(delayAmount, delayUnit);
      if (delayError) throw new Error(delayError);
    }

    const step = await prisma.campaignStep.create({
      data: {
        campaignId,
        order,
        type: data.type ?? 'EMAIL',
        subjectTemplate: data.subjectTemplate,
        bodyTemplate: data.bodyTemplate,
        delayAmount,
        delayUnit,
        delayDays: syncDelayDays(delayAmount, delayUnit),
        enabled: data.enabled ?? true,
      },
    });

    await logCampaignActivity({
      campaignId,
      workspaceId,
      type: 'SEQUENCE_UPDATED',
      summary: `Added step ${order + 1}`,
      actorUserId: data.actorUserId,
      metadata: { stepId: step.id, action: 'add' },
    });

    return step;
  }

  async updateStep(
    campaignId: string,
    stepId: string,
    workspaceId: string,
    data: Partial<{
      subjectTemplate: string;
      bodyTemplate: string;
      delayAmount: number;
      delayUnit: DelayUnit;
      enabled: boolean;
      metadata: Record<string, unknown>;
      actorUserId: string;
    }>,
  ) {
    await this.assertCampaignEditable(campaignId, workspaceId);

    const existing = await prisma.campaignStep.findFirst({
      where: { id: stepId, campaignId },
    });
    if (!existing) throw new Error('Step not found');

    const delayAmount = data.delayAmount ?? existing.delayAmount;
    const delayUnit = data.delayUnit ?? existing.delayUnit;

    if (!isInitialStep(existing.order)) {
      const delayError = validateDelayAmount(delayAmount, delayUnit);
      if (delayError) throw new Error(delayError);
    }

    const step = await prisma.campaignStep.update({      where: { id: stepId },
      data: {
        ...(data.subjectTemplate !== undefined && { subjectTemplate: data.subjectTemplate }),
        ...(data.bodyTemplate !== undefined && { bodyTemplate: data.bodyTemplate }),
        ...(data.delayAmount !== undefined && { delayAmount: data.delayAmount }),
        ...(data.delayUnit !== undefined && { delayUnit: data.delayUnit }),
        ...(data.enabled !== undefined && { enabled: data.enabled }),
        ...(data.metadata !== undefined && { metadata: data.metadata as Prisma.InputJsonValue }),
        delayDays: syncDelayDays(delayAmount, delayUnit),
      },
    });

    await logCampaignActivity({
      campaignId,
      workspaceId,
      type: 'SEQUENCE_UPDATED',
      summary: `Updated step ${existing.order + 1}`,
      actorUserId: data.actorUserId,
      metadata: { stepId, action: 'update' },
    });

    return step;
  }

  async deleteStep(campaignId: string, stepId: string, workspaceId: string, actorUserId?: string) {
    await this.assertCampaignEditable(campaignId, workspaceId);

    const existing = await prisma.campaignStep.findFirst({
      where: { id: stepId, campaignId },
    });
    if (!existing) throw new Error('Step not found');
    if (isInitialStep(existing.order)) {
      throw new Error('The initial email step cannot be deleted');
    }

    await prisma.campaignStep.delete({ where: { id: stepId } });    await this.reindexSteps(campaignId);

    await logCampaignActivity({
      campaignId,
      workspaceId,
      type: 'SEQUENCE_UPDATED',
      summary: `Removed step ${existing.order + 1}`,
      actorUserId,
      metadata: { stepId, action: 'delete' },
    });
  }

  async reorderSteps(
    campaignId: string,
    workspaceId: string,
    orderedStepIds: string[],
    actorUserId?: string,
  ) {
    await this.assertCampaignEditable(campaignId, workspaceId);

    const steps = await prisma.campaignStep.findMany({
      where: { campaignId },
      orderBy: { order: 'asc' },
    });

    if (steps.length !== orderedStepIds.length) {
      throw new Error('Ordered step IDs must include all campaign steps');
    }

    const stepIdSet = new Set(steps.map((s) => s.id));
    for (const id of orderedStepIds) {
      if (!stepIdSet.has(id)) throw new Error('Invalid step ID in reorder list');
    }

    await prisma.$transaction(
      orderedStepIds.map((id, order) =>
        prisma.campaignStep.update({
          where: { id },
          data: { order },
        }),
      ),
    );

    await logCampaignActivity({
      campaignId,
      workspaceId,
      type: 'SEQUENCE_UPDATED',
      summary: 'Reordered sequence steps',
      actorUserId,
      metadata: { orderedStepIds, action: 'reorder' },
    });

    return prisma.campaignStep.findMany({
      where: { campaignId },
      orderBy: { order: 'asc' },
    });
  }

  async duplicateStep(campaignId: string, stepId: string, workspaceId: string, actorUserId?: string) {
    await this.assertCampaignEditable(campaignId, workspaceId);

    const source = await prisma.campaignStep.findFirst({
      where: { id: stepId, campaignId },
    });
    if (!source) throw new Error('Step not found');

    const stepCount = await prisma.campaignStep.count({ where: { campaignId } });
    if (stepCount >= MAX_SEQUENCE_STEPS) {
      throw new Error(`Maximum ${MAX_SEQUENCE_STEPS} steps allowed (1 initial + 5 follow-ups)`);
    }

    const maxOrder = await prisma.campaignStep.aggregate({
      where: { campaignId },
      _max: { order: true },
    });
    const order = (maxOrder._max.order ?? -1) + 1;

    const step = await prisma.campaignStep.create({
      data: {
        campaignId,
        order,
        type: source.type,
        subjectTemplate: source.subjectTemplate,
        bodyTemplate: source.bodyTemplate,
        delayAmount: source.delayAmount,
        delayUnit: source.delayUnit,
        delayDays: source.delayDays,
        enabled: source.enabled,
        metadata: source.metadata as Prisma.InputJsonValue,
      },
    });

    await logCampaignActivity({
      campaignId,
      workspaceId,
      type: 'SEQUENCE_UPDATED',
      summary: `Duplicated step ${source.order + 1}`,
      actorUserId,
      metadata: { stepId: step.id, sourceStepId: source.id, action: 'duplicate' },
    });

    return step;
  }

  private async reindexSteps(campaignId: string) {
    const steps = await prisma.campaignStep.findMany({
      where: { campaignId },
      orderBy: { order: 'asc' },
    });

    await prisma.$transaction(
      steps.map((step, order) =>
        prisma.campaignStep.update({
          where: { id: step.id },
          data: { order },
        }),
      ),
    );
  }

  private async assertCampaignEditable(campaignId: string, workspaceId: string) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, workspaceId },
      select: { status: true },
    });
    if (!campaign) throw new Error('Campaign not found');
    if (!['DRAFT', 'PAUSED', 'SCHEDULED'].includes(campaign.status)) {
      throw new Error('Campaign sequence cannot be edited in current status');
    }
  }
}

export const sequenceService = new SequenceService();

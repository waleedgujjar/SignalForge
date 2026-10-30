import type { FastifyPluginAsync } from 'fastify';
import type { CampaignStatus } from '@signalforge/database';
import { prisma } from '@signalforge/database';
import {
  campaignService,
  campaignLeadService,
  campaignValidationService,
  campaignPreviewService,
  campaignExecutionPlanner,
  sequenceService,
  leadSequenceService,
  syncDelayDays,
} from '@signalforge/campaigns';
import {
  leadToVariableContext,
  validateTemplate,
} from '@signalforge/email';
import { sendingJobService } from '@signalforge/sending';
import { publishWorkflowEvent } from '@signalforge/automations';
import {
  QUEUE_NAMES,
  BULK_ENROLLMENT_THRESHOLD,
  enqueueCampaignEnrollment,
  type CampaignEnrollmentQueuePayload,
} from '@signalforge/queue';
import { getQueue } from '../queue-registry.js';
import {
  createCampaignSchema,
  updateCampaignSchema,
  campaignListQuerySchema,
  validateTemplateSchema,
  previewEmailSchema,
  enrollCampaignLeadsSchema,
  previewEligibilitySchema,
  createCampaignStepSchema,
  updateCampaignStepSchema,
  reorderCampaignStepsSchema,
  launchCampaignSchema,
  stopCampaignSchema,
  campaignActivityQuerySchema,
  seedFollowUpsSchema,
} from '@signalforge/validation';
import { requireWorkspaceGuard, getWorkspaceId } from '../plugins/auth.js';

function getActorUserId(request: { user?: { userId?: string } }): string | undefined {
  return request.user?.userId;
}

async function existingFollowUpsEnabled(
  campaignId: string,
  workspaceId: string,
): Promise<boolean> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    select: { followUpsEnabled: true },
  });
  return campaign?.followUpsEnabled ?? false;
}

function handleServiceError(error: unknown, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  if (error instanceof Error) {
    if (error.message.includes('not found')) {
      return reply.status(404).send({ error: error.message });
    }
    if (
      error.message.includes('Cannot') ||
      error.message.includes('cannot') ||
      error.message.includes('required') ||
      error.message.includes('Invalid')
    ) {
      return reply.status(400).send({ error: error.message });
    }
  }
  throw error;
}

export const campaignRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  app.post('/', async (request, reply) => {
    const body = createCampaignSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);

    const campaign = await campaignService.createDraft(workspaceId, {
      name: body.name,
      description: body.description,
      rotationStrategy: body.rotationStrategy,
      sendingMode: body.sendingMode,
      smtpPoolId: body.smtpPoolId,
      mailboxId: body.mailboxId,
      dailySendingLimit: body.dailySendingLimit,
      scheduleConfig: body.scheduleConfig,
      verificationPolicy: body.verificationPolicy,
      suppressionPolicy: body.suppressionPolicy,
      duplicateEnrollmentPolicy: body.duplicateEnrollmentPolicy,
      actorUserId,
    });

    if (body.steps.length > 0) {
      for (const [index, step] of body.steps.entries()) {
        await sequenceService.addStep(campaign.id, workspaceId, {
          subjectTemplate: step.subjectTemplate,
          bodyTemplate: step.bodyTemplate,
          delayAmount: step.delayAmount ?? step.delayDays,
          delayUnit: step.delayUnit,
          type: step.type,
          enabled: step.enabled,
          actorUserId,
        });
        if (step.order !== index) {
          const steps = await prisma.campaignStep.findMany({
            where: { campaignId: campaign.id },
            orderBy: { order: 'asc' },
          });
          const last = steps[steps.length - 1];
          if (last) {
            await prisma.campaignStep.update({
              where: { id: last.id },
              data: { order: step.order, delayDays: syncDelayDays(step.delayAmount ?? step.delayDays, step.delayUnit ?? 'DAYS') },
            });
          }
        }
      }
    }

    if (body.mailboxIds.length > 0) {
      await prisma.campaignMailbox.createMany({
        data: body.mailboxIds.map((mailboxId) => ({ campaignId: campaign.id, mailboxId })),
      });
    }

    if (body.leadIds.length > 0) {
      await campaignLeadService.enrollLeads(campaign.id, workspaceId, body.leadIds, { actorUserId });
    }

    const full = await prisma.campaign.findFirst({
      where: { id: campaign.id, workspaceId },
      include: {
        steps: { orderBy: { order: 'asc' } },
        mailboxes: { include: { mailbox: true } },
        campaignLeads: { include: { lead: true } },
        _count: { select: { campaignLeads: true, steps: true, mailboxes: true } },
      },
    });

    return reply.status(201).send(full);
  });

  app.get('/', async (request) => {
    const query = campaignListQuerySchema.parse(request.query);
    const workspaceId = getWorkspaceId(request);

    const where = {
      workspaceId,
      ...(query.status && { status: query.status as CampaignStatus }),
      ...(query.search && {
        name: { contains: query.search, mode: 'insensitive' as const },
      }),
    };

    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          _count: { select: { campaignLeads: true, steps: true, mailboxes: true } },
        },
      }),
      prisma.campaign.count({ where }),
    ]);

    return {
      data: campaigns,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);

    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId },
      include: {
        steps: { orderBy: { order: 'asc' } },
        mailboxes: { include: { mailbox: true } },
        smtpPool: {
          include: {
            _count: { select: { members: true } },
          },
        },
        singleMailbox: true,
        campaignLeads: {
          include: { lead: { include: { verification: true, enrichment: true } } },
          take: 100,
          orderBy: { enrolledAt: 'desc' as const },
        },
        _count: { select: { campaignLeads: true, steps: true, mailboxes: true } },
      },
    });

    if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });
    return campaign;
  });

  app.get('/:id/leads', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const query = request.query as { page?: string; limit?: string };
    const page = Math.max(1, parseInt(query.page ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '50', 10)));
    const skip = (page - 1) * limit;

    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });

    const [leads, total] = await Promise.all([
      prisma.campaignLead.findMany({
        where: { campaignId: id },
        include: { lead: { include: { verification: true, enrichment: true } } },
        orderBy: { enrolledAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.campaignLead.count({ where: { campaignId: id } }),
    ]);

    // Per-recipient send + open summary, aggregated across this recipient's
    // messages (a recipient can receive multiple sequence steps).
    const campaignLeadIds = leads.map((cl) => cl.id);
    const messages = campaignLeadIds.length
      ? await prisma.emailMessage.findMany({
          where: { campaignId: id, campaignLeadId: { in: campaignLeadIds } },
          select: {
            campaignLeadId: true,
            status: true,
            openCount: true,
            firstOpenedAt: true,
            lastOpenedAt: true,
          },
        })
      : [];

    const trackingByLead = new Map<
      string,
      { sent: boolean; totalOpens: number; firstOpenedAt: Date | null; lastOpenedAt: Date | null }
    >();
    for (const message of messages) {
      if (!message.campaignLeadId) continue;
      const agg = trackingByLead.get(message.campaignLeadId) ?? {
        sent: false,
        totalOpens: 0,
        firstOpenedAt: null,
        lastOpenedAt: null,
      };
      agg.totalOpens += message.openCount;
      if (message.status === 'SENT') agg.sent = true;
      if (message.firstOpenedAt && (!agg.firstOpenedAt || message.firstOpenedAt < agg.firstOpenedAt)) {
        agg.firstOpenedAt = message.firstOpenedAt;
      }
      if (message.lastOpenedAt && (!agg.lastOpenedAt || message.lastOpenedAt > agg.lastOpenedAt)) {
        agg.lastOpenedAt = message.lastOpenedAt;
      }
      trackingByLead.set(message.campaignLeadId, agg);
    }

    const data = leads.map((cl) => {
      const agg = trackingByLead.get(cl.id);
      return {
        ...cl,
        tracking: {
          sent: agg?.sent ?? false,
          opened: (agg?.totalOpens ?? 0) > 0,
          totalOpens: agg?.totalOpens ?? 0,
          firstOpenedAt: agg?.firstOpenedAt ?? null,
          lastOpenedAt: agg?.lastOpenedAt ?? null,
        },
      };
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  });

  app.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateCampaignSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);

    try {
      if (body.followUpsEnabled === false && (await existingFollowUpsEnabled(id, workspaceId))) {
        if (!body.disableFollowUpsConfirmed) {
          return reply.status(400).send({
            error: 'Disabling automated follow-ups requires confirmation',
            requiresConfirmation: true,
          });
        }
        await sendingJobService.cancelPendingFollowUpJobs(id, workspaceId);
      }

      const campaign = await campaignService.updateCampaign(id, workspaceId, {
        name: body.name,
        description: body.description,
        rotationStrategy: body.rotationStrategy,
        sendingMode: body.sendingMode,
        smtpPoolId: body.smtpPoolId,
        mailboxId: body.mailboxId,
        dailySendingLimit: body.dailySendingLimit,
        scheduleConfig: body.scheduleConfig,
        verificationPolicy: body.verificationPolicy,
        suppressionPolicy: body.suppressionPolicy,
        duplicateEnrollmentPolicy: body.duplicateEnrollmentPolicy,
        followUpsEnabled: body.followUpsEnabled,
        maxFollowUps: body.maxFollowUps,
        replyHandlingPolicy: body.replyHandlingPolicy,
        mailboxIds: body.mailboxIds,
        actorUserId,
      });

      if (body.scheduledAt !== undefined) {
        await prisma.campaign.update({
          where: { id, workspaceId },
          data: { scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null },
        });
      }

      return campaign;
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);

    try {
      await campaignService.archive(id, workspaceId, actorUserId);
      return reply.status(204).send();
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.post('/:id/leads', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = enrollCampaignLeadsSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);

    try {
      if (body.leadIds.length > BULK_ENROLLMENT_THRESHOLD) {
        const queue = getQueue<CampaignEnrollmentQueuePayload>(QUEUE_NAMES.CAMPAIGN_ENROLLMENT);
        const job = await enqueueCampaignEnrollment(queue, {
          workspaceId,
          campaignId: id,
          leadIds: body.leadIds,
          actorUserId,
          force: body.force,
          source: 'api',
        });
        return reply.status(202).send({
          queued: true,
          jobId: job.id,
          leadCount: body.leadIds.length,
        });
      }

      const result = await campaignLeadService.enrollLeads(id, workspaceId, body.leadIds, {
        actorUserId,
        force: body.force,
      });
      return result;
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.delete('/:id/leads/:leadId', async (request, reply) => {
    const { id, leadId } = request.params as { id: string; leadId: string };
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);

    try {
      await campaignLeadService.removeLead(id, leadId, workspaceId, actorUserId);
      return reply.status(204).send();
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.patch('/:id/leads/:leadId/override', async (request, reply) => {
    const { id, leadId } = request.params as { id: string; leadId: string };
    const workspaceId = getWorkspaceId(request);
    const body = request.body as { subjectOverride?: string | null; bodyOverride?: string | null };

    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId },
      select: { id: true, status: true },
    });
    if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });

    const cl = await prisma.campaignLead.findUnique({
      where: { campaignId_leadId: { campaignId: id, leadId } },
    });
    if (!cl) return reply.status(404).send({ error: 'Lead not enrolled in this campaign' });

    const updated = await prisma.campaignLead.update({
      where: { id: cl.id },
      data: {
        subjectOverride: body.subjectOverride !== undefined ? body.subjectOverride : undefined,
        bodyOverride: body.bodyOverride !== undefined ? body.bodyOverride : undefined,
      },
      include: { lead: true },
    });
    return updated;
  });

  app.post('/:id/leads/preview-eligibility', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = previewEligibilitySchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);

    try {
      return await campaignLeadService.previewEligibility(workspaceId, id, body.leadIds);
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.post('/:id/follow-ups/seed', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = seedFollowUpsSchema.parse(request.body ?? {});
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);

    try {
      const steps = await sequenceService.seedFollowUpSteps(
        id,
        workspaceId,
        body.maxFollowUps,
        actorUserId,
      );
      return reply.status(201).send({ steps });
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.get('/:id/leads/:leadId/sequence', async (request, reply) => {
    const { id, leadId } = request.params as { id: string; leadId: string };
    const workspaceId = getWorkspaceId(request);

    const status = await leadSequenceService.getLeadSequenceStatus(id, leadId, workspaceId);
    if (!status) return reply.status(404).send({ error: 'Lead not enrolled in campaign' });
    return status;
  });

  app.post('/:id/steps', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = createCampaignStepSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);

    try {
      const step = await sequenceService.addStep(id, workspaceId, {
        subjectTemplate: body.subjectTemplate,
        bodyTemplate: body.bodyTemplate,
        delayAmount: body.delayAmount ?? body.delayDays,
        delayUnit: body.delayUnit,
        type: body.type,
        enabled: body.enabled,
        actorUserId,
      });
      return reply.status(201).send(step);
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.patch('/:id/steps/:stepId', async (request, reply) => {
    const { id, stepId } = request.params as { id: string; stepId: string };
    const body = updateCampaignStepSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);

    try {
      const step = await sequenceService.updateStep(id, stepId, workspaceId, {
        ...body,
        actorUserId,
      });
      return step;
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.delete('/:id/steps/:stepId', async (request, reply) => {
    const { id, stepId } = request.params as { id: string; stepId: string };
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);

    try {
      await sequenceService.deleteStep(id, stepId, workspaceId, actorUserId);
      return reply.status(204).send();
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.post('/:id/steps/reorder', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = reorderCampaignStepsSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);

    try {
      const steps = await sequenceService.reorderSteps(id, workspaceId, body.orderedStepIds, actorUserId);
      return { steps };
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.post('/:id/steps/:stepId/duplicate', async (request, reply) => {
    const { id, stepId } = request.params as { id: string; stepId: string };
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);

    try {
      const step = await sequenceService.duplicateStep(id, stepId, workspaceId, actorUserId);
      return reply.status(201).send(step);
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.post('/:id/validate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);

    try {
      const validation = await campaignValidationService.validate(id, workspaceId);
      await prisma.campaignActivity.create({
        data: {
          campaignId: id,
          workspaceId,
          type: 'VALIDATED',
          summary: validation.valid ? 'Campaign passed validation' : 'Campaign validation failed',
          actorUserId: actorUserId ?? null,
          metadata: { valid: validation.valid, errorCount: validation.errors.length },
        },
      });
      return validation;
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.post('/:id/launch', async (request, reply) => {
    const { id } = request.params as { id: string };
    launchCampaignSchema.parse(request.body ?? {});
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);

    try {
      const result = await campaignService.launch(id, workspaceId, actorUserId);
      if (!result.success) {
        return reply.status(400).send(result);
      }
      if (result.campaign.status === 'ACTIVE') {
        const bootstrap = await sendingJobService.bootstrapCampaign(id, workspaceId);
        const enrolledLeads = await prisma.campaignLead.findMany({
          where: { campaignId: id },
          select: { leadId: true },
        });
        for (const cl of enrolledLeads) {
          void publishWorkflowEvent({
            eventType: 'CAMPAIGN_STARTED',
            workspaceId,
            leadId: cl.leadId,
            campaignId: id,
            idempotencyKey: `campaign-started:${id}:${cl.leadId}`,
          }).catch(() => {});
        }
        return { ...result, sendingJobs: bootstrap };
      }
      return result;
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.post('/:id/pause', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);

    try {
      const campaign = await campaignService.pause(id, workspaceId, actorUserId);
      const paused = await sendingJobService.pauseCampaignJobs(id, workspaceId);
      return { campaign, pausedJobs: paused };
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.post('/:id/resume', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);

    try {
      const campaign = await campaignService.resume(id, workspaceId, actorUserId);
      const resumed = await sendingJobService.resumeCampaignJobs(id, workspaceId);
      return { campaign, resumedJobs: resumed };
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.post('/:id/stop', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = stopCampaignSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);

    try {
      const campaign = await campaignService.stop(id, workspaceId, body, actorUserId);
      const cancelled = await sendingJobService.cancelCampaignJobs(id, workspaceId);
      return { campaign, cancelledJobs: cancelled };
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.post('/:id/activate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);

    try {
      const result = await campaignService.launch(id, workspaceId, actorUserId);
      if (!result.success) {
        return reply.status(400).send({ ...result.validation, issues: result.validation.errors });
      }
      return {
        ready: true,
        campaign: result.campaign,
        validation: result.validation,
      };
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.post('/:id/validate-template', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validateTemplateSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);

    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId },
      include: {
        campaignLeads: {
          include: {
            lead: {
              include: {
                enrichment: true,
                websiteAnalyses: { take: 1, orderBy: { createdAt: 'desc' } },
              },
            },
          },
        },
      },
    });

    if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });

    const leads = body.leadId
      ? campaign.campaignLeads.filter((cl) => cl.leadId === body.leadId)
      : campaign.campaignLeads;

    const results = leads.map((cl) => {
      const context = leadToVariableContext({
        ...cl.lead,
        enrichment: cl.lead.enrichment,
        websiteAnalysis: cl.lead.websiteAnalyses[0] ?? null,
      });
      return {
        leadId: cl.leadId,
        ...validateTemplate(body.subjectTemplate, body.bodyTemplate, context),
      };
    });

    const invalidLeads = results.filter((r) => !r.valid);
    return {
      valid: invalidLeads.length === 0,
      totalLeads: results.length,
      invalidCount: invalidLeads.length,
      results: invalidLeads,
      summary: invalidLeads.length > 0
        ? Object.entries(
            invalidLeads.reduce<Record<string, number>>((acc, r) => {
              for (const err of r.errors) {
                acc[err] = (acc[err] ?? 0) + 1;
              }
              return acc;
            }, {}),
          ).map(([msg]) => msg)
        : [],
    };
  });

  app.post('/:id/preview', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = previewEmailSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);

    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId },
    });
    if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });

    try {
      if (body.variationCount && body.variationCount > 1) {
        const variations = await campaignPreviewService.previewVariations(workspaceId, {
          leadId: body.leadId,
          subjectTemplate: body.subjectTemplate,
          bodyTemplate: body.bodyTemplate,
          count: body.variationCount,
        });
        return { variations };
      }

      return await campaignPreviewService.preview(workspaceId, {
        leadId: body.leadId,
        subjectTemplate: body.subjectTemplate,
        bodyTemplate: body.bodyTemplate,
        seed: body.seed,
      });
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.get('/:id/activity', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = campaignActivityQuerySchema.parse(request.query);
    const workspaceId = getWorkspaceId(request);

    try {
      return await campaignService.getActivity(id, workspaceId, query.page, query.limit);
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.get('/:id/execution-plan', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);

    try {
      const jobs = await campaignExecutionPlanner.buildPlan(id, workspaceId);
      return { jobs, count: jobs.length };
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  app.get('/:id/sending-stats', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);

    const stats = await sendingJobService.getCampaignSendingStats(id, workspaceId);
    if (!stats) {
      return reply.status(404).send({ error: 'Campaign not found' });
    }
    return stats;
  });
};

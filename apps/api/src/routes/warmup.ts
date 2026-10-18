import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { prisma } from '@signalforge/database';
import {
  warmupConfigService,
  warmupRecipientService,
  getWarmupEligibility,
  computeUsageDate,
  toUsageDate,
  MailboxNotInWorkspaceError,
  InvalidWarmupSettingsError,
  RecipientConsentRequiredError,
  InvalidRecipientEmailError,
  RecipientAlreadyExistsError,
  RecipientNotFoundError,
} from '@signalforge/warmup';
import { mailboxUsageService } from '@signalforge/mailboxes';
import {
  createWarmupRecipientSchema,
  enableWarmupSchema,
  updateWarmupRecipientSchema,
  warmupHistoryQuerySchema,
  warmupResetSchema,
  warmupSettingsSchema,
} from '@signalforge/validation';
import { getWorkspaceId, requireWorkspaceGuard } from '../plugins/auth.js';

function handleError(error: unknown, reply: FastifyReply) {
  if (error instanceof MailboxNotInWorkspaceError) {
    return reply.status(404).send({ error: error.message });
  }
  if (error instanceof InvalidWarmupSettingsError) {
    return reply.status(400).send({ error: error.message });
  }
  if (error instanceof RecipientConsentRequiredError) {
    return reply.status(400).send({ error: error.message });
  }
  if (error instanceof InvalidRecipientEmailError) {
    return reply.status(400).send({ error: error.message });
  }
  if (error instanceof RecipientAlreadyExistsError) {
    return reply.status(409).send({ error: error.message });
  }
  if (error instanceof RecipientNotFoundError) {
    return reply.status(404).send({ error: error.message });
  }
  if (error instanceof Error) {
    return reply.status(400).send({ error: error.message });
  }
  return reply.status(500).send({ error: 'Internal server error' });
}

function summarizeConfig(config: {
  id: string;
  enabled: boolean;
  status: string;
  startingDailyLimit: number;
  maximumDailyLimit: number;
  rampStep: number;
  rampIntervalHours: number;
  currentDailyLimit: number;
  timezone: string;
  weekdays: unknown;
  windowStart: string;
  windowEnd: string;
  consecutiveFailureThreshold: number;
  consecutiveFailures: number;
  lastFailureAt: Date | null;
  blockReason: string | null;
  startDate: Date | null;
  pausedAt: Date | null;
  completedAt: Date | null;
  blockedAt: Date | null;
  lastProgressionAt: Date | null;
}) {
  return {
    id: config.id,
    enabled: config.enabled,
    status: config.status,
    startingDailyLimit: config.startingDailyLimit,
    maximumDailyLimit: config.maximumDailyLimit,
    rampStep: config.rampStep,
    rampIntervalHours: config.rampIntervalHours,
    currentDailyLimit: config.currentDailyLimit,
    timezone: config.timezone,
    weekdays: warmupConfigService.getWeekdays(config.weekdays),
    windowStart: config.windowStart,
    windowEnd: config.windowEnd,
    consecutiveFailureThreshold: config.consecutiveFailureThreshold,
    consecutiveFailures: config.consecutiveFailures,
    lastFailureAt: config.lastFailureAt,
    blockReason: config.blockReason,
    startDate: config.startDate,
    pausedAt: config.pausedAt,
    completedAt: config.completedAt,
    blockedAt: config.blockedAt,
    lastProgressionAt: config.lastProgressionAt,
  };
}

export const warmupRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  app.get('/stats', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const [total, byStatus, recipients] = await Promise.all([
      prisma.emailWarmupConfig.count({ where: { workspaceId } }),
      prisma.emailWarmupConfig.groupBy({
        by: ['status'],
        where: { workspaceId },
        _count: { _all: true },
      }),
      warmupRecipientService.countEligible(workspaceId),
    ]);
    const statusCounts: Record<string, number> = {};
    for (const row of byStatus) statusCounts[row.status] = row._count._all;
    return { totalConfigs: total, statusCounts, eligibleRecipients: recipients };
  });

  app.get('/recipients', async (request) => {
    const workspaceId = getWorkspaceId(request);
    return warmupRecipientService.list(workspaceId);
  });

  app.post('/recipients', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const body = createWarmupRecipientSchema.parse(request.body);
    try {
      const created = await warmupRecipientService.create({
        workspaceId,
        email: body.email,
        name: body.name ?? null,
        consentConfirmed: body.consentConfirmed,
      });
      return reply.status(201).send(created);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.patch('/recipients/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const body = updateWarmupRecipientSchema.parse(request.body);
    try {
      return await warmupRecipientService.update(workspaceId, id, body);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.delete('/recipients/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    try {
      await warmupRecipientService.remove(workspaceId, id);
      return reply.status(204).send();
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/accounts', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const mailboxes = await warmupConfigService.listAccounts(workspaceId);
    return Promise.all(
      mailboxes.map(async (mb) => {
        const timezone = mb.timezone || mb.workspace?.timezone || 'UTC';
        const usageDate = computeUsageDate(new Date(), timezone);
        const usage = await prisma.mailboxDailyUsage.findUnique({
          where: {
            mailboxId_usageDate: { mailboxId: mb.id, usageDate: toUsageDate(usageDate) },
          },
        });
        return {
          mailbox: {
            id: mb.id,
            emailAddress: mb.emailAddress,
            fromName: mb.fromName,
            status: mb.status,
            healthStatus: mb.healthStatus,
            warmupStatus: mb.warmupStatus,
            dailySendingLimit: mb.dailySendingLimit,
            timezone: mb.timezone,
          },
          config: mb.warmupConfig ? summarizeConfig(mb.warmupConfig) : null,
          usage: {
            warmupSentToday: usage?.warmupSentCount ?? 0,
            warmupReservedToday: usage?.warmupReservedCount ?? 0,
            campaignSentToday: usage?.sentCount ?? 0,
            campaignReservedToday: usage?.reservedCount ?? 0,
            usageDate,
          },
        };
      }),
    );
  });

  app.get('/accounts/:mailboxId', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { mailboxId } = request.params as { mailboxId: string };
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, workspaceId },
      include: { workspace: true },
    });
    if (!mailbox) return reply.status(404).send({ error: 'Mailbox not found' });
    const config = await warmupConfigService.getConfig(mailboxId, workspaceId);
    const eligibility = await getWarmupEligibility(mailboxId, workspaceId);
    const capacity = await mailboxUsageService.getRemainingCapacity(mailboxId, workspaceId);
    const recentFailures = await prisma.warmupJob.findMany({
      where: { mailboxId, status: 'FAILED' },
      orderBy: { failedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        recipientEmail: true,
        errorCategory: true,
        lastError: true,
        failedAt: true,
      },
    });
    return {
      mailbox: {
        id: mailbox.id,
        emailAddress: mailbox.emailAddress,
        fromName: mailbox.fromName,
        status: mailbox.status,
        healthStatus: mailbox.healthStatus,
        warmupStatus: mailbox.warmupStatus,
        dailySendingLimit: mailbox.dailySendingLimit,
        timezone: mailbox.timezone,
      },
      config: config ? summarizeConfig(config) : null,
      eligibility,
      capacity,
      recentFailures,
    };
  });

  app.post('/accounts/:mailboxId/enable', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { mailboxId } = request.params as { mailboxId: string };
    const body = enableWarmupSchema.parse(request.body ?? {});
    try {
      const config = await warmupConfigService.enable(mailboxId, workspaceId, body);
      return summarizeConfig(config);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post('/accounts/:mailboxId/pause', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { mailboxId } = request.params as { mailboxId: string };
    try {
      const config = await warmupConfigService.pause(mailboxId, workspaceId);
      return summarizeConfig(config);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post('/accounts/:mailboxId/resume', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { mailboxId } = request.params as { mailboxId: string };
    try {
      const config = await warmupConfigService.resume(mailboxId, workspaceId);
      return summarizeConfig(config);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post('/accounts/:mailboxId/disable', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { mailboxId } = request.params as { mailboxId: string };
    try {
      const config = await warmupConfigService.disable(mailboxId, workspaceId);
      return summarizeConfig(config);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post('/accounts/:mailboxId/reset', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { mailboxId } = request.params as { mailboxId: string };
    warmupResetSchema.parse(request.body);
    try {
      const config = await warmupConfigService.reset(mailboxId, workspaceId);
      return summarizeConfig(config);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.patch('/accounts/:mailboxId/settings', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { mailboxId } = request.params as { mailboxId: string };
    const body = warmupSettingsSchema.parse(request.body);
    try {
      const config = await warmupConfigService.updateSettings(mailboxId, workspaceId, body);
      return summarizeConfig(config);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/accounts/:mailboxId/history', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { mailboxId } = request.params as { mailboxId: string };
    const { page, limit } = warmupHistoryQuerySchema.parse(request.query);

    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, workspaceId },
      select: { id: true },
    });
    if (!mailbox) return reply.status(404).send({ error: 'Mailbox not found' });

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      prisma.warmupDailyHistory.findMany({
        where: { mailboxId, workspaceId },
        orderBy: { usageDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.warmupDailyHistory.count({ where: { mailboxId, workspaceId } }),
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
  });
};

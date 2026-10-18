import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '@signalforge/database';
import type { Mailbox, MailboxHealth } from '@signalforge/database';
import { loadEnv } from '@signalforge/config';
import {
  MailboxService,
  MailboxConnectionService,
  mailboxEligibilityService,
  mailboxUsageService,
  evaluateMailboxEligibility,
  type EligibilityResult,
} from '@signalforge/mailboxes';
import {
  createMailboxSchema,
  updateMailboxSchema,
  testConnectionSchema,
  mailboxListQuerySchema,
  bulkMailboxActionSchema,
  mailboxTestHistoryQuerySchema,
  mailboxInboundConfigSchema,
  testImapConnectionSchema,
} from '@signalforge/validation';
import { createAIProvider } from '@signalforge/ai';
import { InboundConnectionTestService, testImapConnection } from '@signalforge/inbound';
import { createInboxSyncService } from '@signalforge/inbox';
import { requireWorkspaceGuard, getWorkspaceId } from '../plugins/auth.js';

type MailboxWithRelations = Mailbox & {
  campaigns?: { campaign: { id: string; name: string; status: string } }[];
  health?: MailboxHealth | null;
};

function toMailboxResponse(mailbox: MailboxWithRelations, eligibility?: EligibilityResult) {
  const remaining = eligibility
    ? eligibility.remainingToday
    : Math.max(0, mailbox.dailySendingLimit - mailbox.currentDailyUsage);

  return {
    id: mailbox.id,
    provider: mailbox.provider,
    name: mailbox.name ?? null,
    emailAddress: mailbox.emailAddress,
    fromName: mailbox.fromName,
    replyTo: mailbox.replyTo ?? null,
    smtpHost: mailbox.smtpHost,
    smtpPort: mailbox.smtpPort,
    smtpUsername: mailbox.smtpUsername,
    encryptionType: mailbox.encryptionType,
    status: mailbox.status,
    dailySendingLimit: mailbox.dailySendingLimit,
    currentDailyUsage: mailbox.currentDailyUsage,
    remainingToday: remaining,
    timezone: mailbox.timezone ?? null,
    healthStatus: mailbox.healthStatus,
    healthScore: mailbox.health?.score ?? null,
    warmupStatus: mailbox.warmupStatus,
    verifiedAt: mailbox.verifiedAt?.toISOString() ?? null,
    lastTestedAt: mailbox.lastTestedAt?.toISOString() ?? null,
    lastSuccessfulSendAt: mailbox.lastSuccessfulSendAt?.toISOString() ?? null,
    lastErrorAt: mailbox.lastErrorAt?.toISOString() ?? null,
    lastErrorMessage: mailbox.lastErrorMessage,
    inboundEnabled: mailbox.inboundEnabled,
    inboundStatus: mailbox.inboundStatus,
    lastInboundSyncAt: mailbox.lastInboundSyncAt?.toISOString() ?? null,
    lastInboundError: mailbox.lastInboundError,
    assignedCampaigns: mailbox.campaigns?.map((c) => ({
      id: c.campaign.id,
      name: c.campaign.name,
      status: c.campaign.status,
    })),
    eligibility: eligibility
      ? {
          eligible: eligibility.eligible,
          reason: eligibility.reason,
          message: eligibility.message,
          remainingToday: eligibility.remainingToday,
        }
      : undefined,
    createdAt: mailbox.createdAt.toISOString(),
    updatedAt: mailbox.updatedAt.toISOString(),
  };
}

const INCLUDE_ALL = {
  campaigns: { include: { campaign: true } },
  health: true,
} as const;

export const mailboxRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  const env = loadEnv();
  const mailboxService = new MailboxService(env.ENCRYPTION_KEY);
  const connectionService = new MailboxConnectionService(env.ENCRYPTION_KEY);

  app.get('/', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const query = mailboxListQuerySchema.parse(request.query ?? {});

    const where: Record<string, unknown> = { workspaceId };
    if (query.status) where.status = query.status;
    if (query.healthStatus) where.healthStatus = query.healthStatus;
    if (query.search) {
      where.OR = [
        { emailAddress: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
        { fromName: { contains: query.search, mode: 'insensitive' } },
        { smtpHost: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const mailboxes = await prisma.mailbox.findMany({
      where,
      include: INCLUDE_ALL,
      orderBy: { createdAt: 'desc' },
    });

    const enriched = mailboxes.map((m) => {
      const eligibility = evaluateMailboxEligibility(m);
      return toMailboxResponse(m as unknown as MailboxWithRelations, eligibility);
    });

    if (query.eligibleOnly) {
      return enriched.filter((m) => m.eligibility?.eligible);
    }
    return enriched;
  });

  app.post('/', async (request, reply) => {
    const body = createMailboxSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);
    const actorUserId = request.user?.userId ?? null;

    if (body.provider === 'SMTP' && (!body.smtpHost || !body.smtpPort || !body.smtpPassword)) {
      return reply
        .status(400)
        .send({ error: 'SMTP host, port, and password are required for SMTP accounts.' });
    }

    try {
      const mailbox = await mailboxService.create({
        workspaceId,
        provider: body.provider,
        name: body.name ?? null,
        emailAddress: body.emailAddress,
        fromName: body.fromName,
        replyTo: body.replyTo ?? null,
        smtpHost: body.smtpHost ?? null,
        smtpPort: body.smtpPort ?? null,
        smtpUsername: body.smtpUsername ?? body.emailAddress,
        smtpPassword: body.smtpPassword ?? null,
        encryptionType: body.encryptionType,
        dailySendingLimit: body.dailySendingLimit,
        timezone: body.timezone ?? null,
        verified: body.verified === true,
        actorUserId,
      });
      const eligibility = evaluateMailboxEligibility(mailbox);
      return reply.status(201).send(toMailboxResponse(mailbox as unknown as MailboxWithRelations, eligibility));
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        return reply
          .status(409)
          .send({ error: 'An account with this email address already exists in this workspace.' });
      }
      throw err;
    }
  });

  app.post('/test-connection', async (request, reply) => {
    const body = testConnectionSchema.parse(request.body);
    const outcome = await connectionService.testEphemeral({
      host: body.smtpHost,
      port: body.smtpPort,
      username: body.smtpUsername,
      password: body.smtpPassword,
      encryption: body.encryptionType,
      fromEmail: body.emailAddress,
      fromName: body.fromName,
    });
    if (!outcome.success) {
      return reply.status(400).send({
        success: false,
        errorCategory: outcome.errorCategory,
        message: outcome.message,
        metadata: outcome.metadata,
      });
    }
    return {
      success: true,
      message: outcome.message,
      metadata: outcome.metadata,
    };
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);

    const mailbox = await prisma.mailbox.findFirst({
      where: { id, workspaceId },
      include: INCLUDE_ALL,
    });
    if (!mailbox) return reply.status(404).send({ error: 'Mailbox not found' });

    const eligibility = evaluateMailboxEligibility(mailbox);
    const usage = await mailboxUsageService.getUsageSummary(id, workspaceId);
    const response = toMailboxResponse(mailbox as unknown as MailboxWithRelations, eligibility);
    return {
      ...response,
      usage,
    };
  });

  app.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateMailboxSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);
    const actorUserId = request.user?.userId ?? null;

    const mailbox = await mailboxService.update(id, workspaceId, {
      ...body,
      actorUserId,
    });
    if (!mailbox) return reply.status(404).send({ error: 'Mailbox not found' });
    const eligibility = evaluateMailboxEligibility(mailbox);
    return toMailboxResponse(mailbox as unknown as MailboxWithRelations, eligibility);
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const actorUserId = request.user?.userId ?? null;

    const result = await mailboxService.delete(id, workspaceId, actorUserId);
    if (!result.deleted) return reply.status(404).send({ error: 'Mailbox not found' });
    return reply.status(204).send();
  });

  app.post('/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const actorUserId = request.user?.userId ?? null;

    try {
      const outcome = await connectionService.testStored(id, workspaceId, { actorUserId });
      if (!outcome.success) {
        return reply.status(400).send({
          success: false,
          errorCategory: outcome.errorCategory,
          message: outcome.message,
          metadata: outcome.metadata,
        });
      }
      return {
        success: true,
        message: outcome.message,
        metadata: outcome.metadata,
      };
    } catch (err) {
      if ((err as Error).message === 'Mailbox not found') {
        return reply.status(404).send({ error: 'Mailbox not found' });
      }
      throw err;
    }
  });

  app.get('/:id/test-history', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const query = mailboxTestHistoryQuerySchema.parse(request.query ?? {});

    const mailbox = await prisma.mailbox.findFirst({ where: { id, workspaceId } });
    if (!mailbox) return reply.status(404).send({ error: 'Mailbox not found' });

    const [items, total] = await Promise.all([
      prisma.mailboxConnectionTest.findMany({
        where: { mailboxId: id, workspaceId },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.mailboxConnectionTest.count({ where: { mailboxId: id, workspaceId } }),
    ]);

    return {
      items: items.map((t) => ({
        id: t.id,
        status: t.status,
        errorCategory: t.errorCategory,
        summary: t.summary,
        metadata: t.metadata,
        createdAt: t.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  });

  app.post('/:id/enable', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const actorUserId = request.user?.userId ?? null;

    try {
      const mailbox = await mailboxService.enable(id, workspaceId, actorUserId);
      if (!mailbox) return reply.status(404).send({ error: 'Mailbox not found' });
      const eligibility = evaluateMailboxEligibility(mailbox);
      return toMailboxResponse(mailbox as unknown as MailboxWithRelations, eligibility);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.post('/:id/disable', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const actorUserId = request.user?.userId ?? null;

    const mailbox = await mailboxService.disable(id, workspaceId, actorUserId);
    if (!mailbox) return reply.status(404).send({ error: 'Mailbox not found' });
    const eligibility = evaluateMailboxEligibility(mailbox);
    return toMailboxResponse(mailbox as unknown as MailboxWithRelations, eligibility);
  });

  app.post('/bulk', async (request, reply) => {
    const body = bulkMailboxActionSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);
    const actorUserId = request.user?.userId ?? null;

    const owned = await prisma.mailbox.findMany({
      where: { id: { in: body.mailboxIds }, workspaceId },
      select: { id: true },
    });
    const ownedIds = owned.map((m) => m.id);
    const skipped = body.mailboxIds.filter((id) => !ownedIds.includes(id));

    const results: Array<{ id: string; success: boolean; error?: string }> = [];
    for (const id of ownedIds) {
      try {
        if (body.action === 'ENABLE') {
          await mailboxService.enable(id, workspaceId, actorUserId);
        } else {
          await mailboxService.disable(id, workspaceId, actorUserId);
        }
        results.push({ id, success: true });
      } catch (err) {
        results.push({ id, success: false, error: (err as Error).message });
      }
    }

    return reply.status(200).send({
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      skipped: skipped.length,
      results,
    });
  });

  app.get('/:id/eligibility', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const eligibility = await mailboxEligibilityService.isMailboxEligible(id, workspaceId);
    return reply.status(200).send({
      mailboxId: id,
      ...eligibility,
    });
  });

  app.post('/:id/pause', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const mailbox = await prisma.mailbox.findFirst({ where: { id, workspaceId } });
    if (!mailbox) return reply.status(404).send({ error: 'Mailbox not found' });

    const updated = await prisma.mailbox.update({
      where: { id },
      data: { status: 'PAUSED' },
      include: INCLUDE_ALL,
    });
    const eligibility = evaluateMailboxEligibility(updated);
    return toMailboxResponse(updated as unknown as MailboxWithRelations, eligibility);
  });

  app.post('/:id/resume', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const mailbox = await prisma.mailbox.findFirst({ where: { id, workspaceId } });
    if (!mailbox) return reply.status(404).send({ error: 'Mailbox not found' });

    const targetStatus = mailbox.verifiedAt ? 'ACTIVE' : 'UNVERIFIED';
    const updated = await prisma.mailbox.update({
      where: { id },
      data: { status: targetStatus },
      include: INCLUDE_ALL,
    });
    const eligibility = evaluateMailboxEligibility(updated);
    return toMailboxResponse(updated as unknown as MailboxWithRelations, eligibility);
  });

  const inboundTestService = new InboundConnectionTestService(env.ENCRYPTION_KEY);
  const aiProvider = createAIProvider(env.AI_PROVIDER, {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    baseURL: env.OPENAI_BASE_URL,
  });
  const inboxSyncService = createInboxSyncService(aiProvider);

  app.get('/:id/inbound', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);

    const mailbox = await prisma.mailbox.findFirst({ where: { id, workspaceId } });
    if (!mailbox) return reply.status(404).send({ error: 'Mailbox not found' });

    const config = await prisma.mailboxInboundConfig.findUnique({ where: { mailboxId: id } });
    return {
      config: config
        ? {
            ...config,
            syncFolders: Array.isArray(config.syncFolders)
              ? (config.syncFolders as string[])
              : ['INBOX'],
            createdAt: config.createdAt.toISOString(),
            updatedAt: config.updatedAt.toISOString(),
          }
        : null,
      inboundEnabled: mailbox.inboundEnabled,
      inboundStatus: mailbox.inboundStatus,
      lastInboundSyncAt: mailbox.lastInboundSyncAt?.toISOString() ?? null,
      lastInboundError: mailbox.lastInboundError,
    };
  });

  app.patch('/:id/inbound', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const body = mailboxInboundConfigSchema.parse(request.body);

    const mailbox = await prisma.mailbox.findFirst({ where: { id, workspaceId } });
    if (!mailbox) return reply.status(404).send({ error: 'Mailbox not found' });

    const enabled = body.enabled ?? false;
    await prisma.mailboxInboundConfig.upsert({
      where: { mailboxId: id },
      create: {
        workspaceId,
        mailboxId: id,
        enabled,
        imapHost: body.imapHost ?? null,
        imapPort: body.imapPort ?? null,
        imapUsername: body.imapUsername ?? null,
        encryptionType: body.encryptionType ?? 'TLS',
        syncIntervalMinutes: body.syncIntervalMinutes ?? 5,
        syncFolders: body.syncFolders ?? ['INBOX'],
      },
      update: {
        enabled,
        ...(body.imapHost !== undefined ? { imapHost: body.imapHost } : {}),
        ...(body.imapPort !== undefined ? { imapPort: body.imapPort } : {}),
        ...(body.imapUsername !== undefined ? { imapUsername: body.imapUsername } : {}),
        ...(body.encryptionType !== undefined ? { encryptionType: body.encryptionType } : {}),
        ...(body.syncIntervalMinutes !== undefined
          ? { syncIntervalMinutes: body.syncIntervalMinutes }
          : {}),
        ...(body.syncFolders !== undefined ? { syncFolders: body.syncFolders } : {}),
      },
    });

    await prisma.mailbox.update({
      where: { id },
      data: {
        inboundEnabled: enabled,
        inboundStatus: enabled ? 'CONNECTED' : 'DISABLED',
      },
    });

    const config = await prisma.mailboxInboundConfig.findUnique({ where: { mailboxId: id } });
    return { ok: true, config };
  });

  app.post('/:id/inbound/test', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const body = request.body as Record<string, unknown> | null | undefined;

    try {
      if (body && typeof body === 'object' && Object.keys(body).length > 0) {
        const parsed = testImapConnectionSchema.parse(body);
        const result = await testImapConnection({
          host: parsed.imapHost,
          port: parsed.imapPort,
          username: parsed.imapUsername ?? '',
          password: parsed.password,
          encryption: parsed.encryptionType,
          folders: ['INBOX'],
        });
        return result;
      }
      const result = await inboundTestService.testStored(id, workspaceId);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'IMAP test failed';
      return reply.status(400).send({ error: message });
    }
  });

  app.post('/:id/sync', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);

    const mailbox = await prisma.mailbox.findFirst({
      where: { id, workspaceId, inboundEnabled: true },
    });
    if (!mailbox) {
      return reply.status(404).send({ error: 'Mailbox not found or inbound not enabled' });
    }

    try {
      const result = await inboxSyncService.syncMailbox(id, workspaceId, env.ENCRYPTION_KEY);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      return reply.status(400).send({ error: message });
    }
  });
};

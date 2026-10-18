import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@signalforge/database';
import { loadEnv } from '@signalforge/config';
import { publishWorkflowEvent } from '@signalforge/automations';
import {
  QUEUE_NAMES,
  createQueue,
  createRedisConnection,
  enqueueLeadResearch,
  type LeadResearchQueuePayload,
} from '@signalforge/queue';
import {
  researchLeadSchema,
  approveResearchSchema,
  manualVerificationSchema,
  researchQueueQuerySchema,
  updateResearchProviderSchema,
  researchHealthCheckSchema,
  webResearchRequestSchema,
} from '@signalforge/validation';
import {
  isLinkedInResearchEnabled,
  isWebResearchEnabled,
  leadResearchService,
  listProviders,
  runProviderHealthChecks,
  selectProviderChain,
  buildResearchSuggestions,
  ensureEnrichmentQueued,
  logResearchActivity,
  stripSecrets,
  LinkedInUrlError,
  ResearchNotFoundError,
  InvalidResearchStateError,
  ResearchDisabledError,
  type LinkedInProviderName,
  type ProviderHealth,
} from '@signalforge/lead-research';
import { requireWorkspaceGuard, requireWorkspaceRole, getWorkspaceId } from '../plugins/auth.js';

/// Module 17 — Lead Research (LinkedIn first).
///
/// Every handler is workspace-guarded and every query is scoped by workspaceId;
/// a record from another workspace is indistinguishable from a missing one (404).
/// Mutations return 501 while LINKEDIN_RESEARCH_ENABLED is off so the rest of
/// SignalForge keeps working with the module dark. Provider status payloads
/// pass through stripSecrets() — credentials never reach the browser.

const DISABLED_RESPONSE = { error: 'LinkedIn research is disabled' };
const ATTENTION_STATUSES = ['MANUAL_REVIEW', 'PENDING', 'FAILED', 'UNAVAILABLE'] as const;

function getResearchQueue() {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);
  return createQueue<LeadResearchQueuePayload>(QUEUE_NAMES.LEAD_RESEARCH, connection);
}

function handleResearchError(error: unknown, reply: FastifyReply) {
  if (error instanceof LinkedInUrlError) {
    return reply.status(422).send({ error: error.message, code: error.code });
  }
  if (error instanceof ResearchNotFoundError) {
    return reply.status(404).send({ error: error.message });
  }
  if (error instanceof InvalidResearchStateError) {
    return reply.status(409).send({ error: error.message });
  }
  if (error instanceof ResearchDisabledError) {
    return reply.status(501).send(DISABLED_RESPONSE);
  }
  if (error instanceof Error && error.name === 'ZodError') {
    return reply
      .status(400)
      .send({ error: 'Validation failed', issues: (error as { issues?: unknown }).issues });
  }
  throw error;
}

function actorId(request: FastifyRequest): string | null {
  return request.user?.userId ?? null;
}

/// Composes the provider status payload: env selection + per-workspace toggles +
/// last persisted (or freshly supplied) health, with secrets stripped.
async function buildProviderStatus(
  workspaceId: string,
  healthByProvider?: Record<string, ProviderHealth>,
) {
  const env = loadEnv();
  const configs = await leadResearchService.getProviderConfigs(workspaceId);
  const descriptors = listProviders();
  const providers = leadResearchService.buildProviderStatusEntries({
    descriptors,
    configs,
    env,
    healthByProvider,
  });
  const chain = selectProviderChain(env, {
    workspaceEnabled: leadResearchService.resolveWorkspaceEnabled(configs),
  }).map((provider) => provider.name);

  return stripSecrets({
    status: 'ok' as const,
    enabled: true,
    selectedProvider: env.LINKEDIN_RESEARCH_PROVIDER,
    chain,
    providers,
  });
}

async function queueResearchForEnrichment(workspaceId: string, leadId: string, request: FastifyRequest) {
  try {
    await ensureEnrichmentQueued(workspaceId, leadId);
  } catch (err: unknown) {
    request.log.warn({ err, leadId }, 'Research saved but enrichment could not be re-queued');
  }
}

export const leadResearchRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  // ─── Providers ──────────────────────────────────────────────────────────────

  app.get('/providers/status', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    if (!isLinkedInResearchEnabled()) return reply.send({ status: 'disabled' });
    try {
      return reply.send(await buildProviderStatus(workspaceId));
    } catch (err: unknown) {
      request.log.warn({ err }, 'Research provider status unavailable');
      return reply.send({ status: 'unavailable', degraded: true });
    }
  });

  app.post(
    '/providers/health-check',
    { preHandler: requireWorkspaceRole('ADMIN').preHandler },
    async (request, reply) => {
      const workspaceId = getWorkspaceId(request);
      if (!isLinkedInResearchEnabled()) return reply.status(501).send(DISABLED_RESPONSE);
      try {
        const body = researchHealthCheckSchema.parse(request.body ?? {});
        const names: LinkedInProviderName[] | undefined = body.provider ? [body.provider] : undefined;
        const results = await runProviderHealthChecks(names);

        const healthByProvider: Record<string, ProviderHealth> = {};
        for (const health of results) {
          healthByProvider[health.provider] = health;
          await leadResearchService.recordHealthCheck(workspaceId, 'LINKEDIN', health);
          await logResearchActivity({
            workspaceId,
            leadId: null,
            source: 'LINKEDIN',
            provider: health.provider,
            operation: 'PROVIDER_HEALTH_CHECK',
            status: health.status,
            actorUserId: actorId(request),
            completedAt: new Date(health.checkedAt),
          });
        }

        return reply.send(await buildProviderStatus(workspaceId, healthByProvider));
      } catch (error) {
        return handleResearchError(error, reply);
      }
    },
  );

  app.get('/providers', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    if (!isLinkedInResearchEnabled()) return reply.send({ providers: [], disabled: true });

    const configs = await leadResearchService.getProviderConfigs(workspaceId);
    const isEnabled = leadResearchService.resolveWorkspaceEnabled(configs);
    const providers = listProviders().map((descriptor) => {
      const config = configs.find((row) => row.provider === descriptor.provider);
      return {
        source: 'LINKEDIN' as const,
        provider: descriptor.provider,
        enabled: config ? config.enabled : isEnabled(descriptor.provider),
        implemented: descriptor.implemented,
        requestCount: config?.requestCount ?? 0,
        successfulRequests: config?.successfulRequests ?? 0,
        failedRequests: config?.failedRequests ?? 0,
        manualReviewCount: config?.manualReviewCount ?? 0,
        lastUsedAt: config?.lastUsedAt ?? null,
        lastHealthCheckAt: config?.lastHealthCheckAt ?? null,
        lastHealthStatus: config?.lastHealthStatus ?? null,
      };
    });
    return reply.send({ providers });
  });

  app.put(
    '/providers',
    { preHandler: requireWorkspaceRole('ADMIN').preHandler },
    async (request, reply) => {
      const workspaceId = getWorkspaceId(request);
      if (!isLinkedInResearchEnabled()) return reply.status(501).send(DISABLED_RESPONSE);
      try {
        const body = updateResearchProviderSchema.parse(request.body);
        if (body.provider === 'manual' && !body.enabled) {
          return reply
            .status(400)
            .send({ error: 'The manual provider is the terminal fallback and cannot be disabled' });
        }

        await leadResearchService.upsertProviderConfig({
          workspaceId,
          source: body.source,
          provider: body.provider,
          enabled: body.enabled,
        });
        await logResearchActivity({
          workspaceId,
          leadId: null,
          source: body.source,
          provider: body.provider,
          operation: 'PROVIDER_TOGGLED',
          status: body.enabled ? 'ENABLED' : 'DISABLED',
          actorUserId: actorId(request),
        });

        const configs = await leadResearchService.getProviderConfigs(workspaceId);
        return reply.send({ providers: configs });
      } catch (error) {
        return handleResearchError(error, reply);
      }
    },
  );

  // ─── Research requests ──────────────────────────────────────────────────────

  app.post('/research', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    if (!isLinkedInResearchEnabled()) return reply.status(501).send(DISABLED_RESPONSE);
    try {
      const body = researchLeadSchema.parse(request.body);

      const lead = await prisma.lead.findFirst({
        where: { id: body.leadId, workspaceId },
        select: { id: true },
      });
      if (!lead) return reply.status(404).send({ error: 'Lead not found' });

      const result = await leadResearchService.createResearchRequests({
        workspaceId,
        leadId: lead.id,
        requestedByUserId: actorId(request),
        companyUrl: body.companyUrl,
        personUrl: body.personUrl,
        forceRefresh: body.forceRefresh,
      });

      const queue = getResearchQueue();
      await Promise.all(
        result.research
          .filter((row) => row.status === 'QUEUED')
          .map((row) =>
            enqueueLeadResearch(queue, {
              workspaceId,
              leadId: lead.id,
              researchId: row.id,
              forceRefresh: body.forceRefresh,
            }),
          ),
      );

      return reply.status(202).send(result);
    } catch (error) {
      return handleResearchError(error, reply);
    }
  });

  app.post('/research/batch', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    if (!isLinkedInResearchEnabled()) return reply.status(501).send(DISABLED_RESPONSE);
    try {
      const body = approveResearchSchema.parse(request.body);
      const env = loadEnv();
      const approved = await leadResearchService.approvePending({
        workspaceId,
        researchIds: body.researchIds,
        leadIds: body.leadIds,
        limit: env.LINKEDIN_RESEARCH_MAX_BATCH_SIZE,
      });

      if (approved.rows.length > 0) {
        const queue = getResearchQueue();
        await Promise.all(
          approved.rows.map((row) =>
            enqueueLeadResearch(queue, { workspaceId, leadId: row.leadId, researchId: row.id }),
          ),
        );
        await Promise.all(
          approved.rows.map((row) =>
            logResearchActivity({
              workspaceId,
              leadId: row.leadId,
              researchId: row.id,
              source: row.source as import('@signalforge/database').LeadResearchSource,
              operation: 'RESEARCH_APPROVED',
              status: 'QUEUED',
              actorUserId: actorId(request),
            }),
          ),
        );
      }

      return reply.status(202).send({
        queued: approved.rows.length,
        skipped: approved.skipped,
        capped: approved.capped,
        limit: env.LINKEDIN_RESEARCH_MAX_BATCH_SIZE,
      });
    } catch (error) {
      return handleResearchError(error, reply);
    }
  });

  // ─── Web Research ──────────────────────────────────────────────────────────

  app.post('/research/web', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    if (!isWebResearchEnabled()) {
      return reply.status(501).send({ error: 'Web research is disabled' });
    }
    try {
      const body = webResearchRequestSchema.parse(request.body);

      const lead = await prisma.lead.findFirst({
        where: { id: body.leadId, workspaceId },
        select: { id: true },
      });
      if (!lead) return reply.status(404).send({ error: 'Lead not found' });

      const result = await leadResearchService.createWebResearchRequests({
        workspaceId,
        leadId: lead.id,
        requestedByUserId: actorId(request),
        websiteUrl: body.websiteUrl,
        forceRefresh: body.forceRefresh,
      });

      const queue = getResearchQueue();
      await Promise.all(
        result.research
          .filter((row) => row.status === 'QUEUED')
          .map((row) =>
            enqueueLeadResearch(queue, {
              workspaceId,
              leadId: lead.id,
              researchId: row.id,
              forceRefresh: body.forceRefresh,
            }),
          ),
      );

      return reply.status(202).send(result);
    } catch (error) {
      return handleResearchError(error, reply);
    }
  });

  // ─── Queue, stats, suggestions ──────────────────────────────────────────────

  app.get('/queue', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    try {
      const query = researchQueueQuerySchema.parse(request.query ?? {});
      if (!isLinkedInResearchEnabled()) {
        return reply.send({
          data: [],
          pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 0 },
          disabled: true,
        });
      }
      const result = await leadResearchService.listQueue(workspaceId, {
        statuses: query.status ? [query.status] : [...ATTENTION_STATUSES],
        source: query.source,
        researchType: query.researchType,
        search: query.search,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
        page: query.page,
        limit: query.limit,
      });
      return reply.send(result);
    } catch (error) {
      return handleResearchError(error, reply);
    }
  });

  app.get('/stats', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    if (!isLinkedInResearchEnabled()) {
      return reply.send({
        total: 0,
        byStatus: {},
        byType: {},
        manualReviewCount: 0,
        pendingCount: 0,
        verifiedCount: 0,
        completedLast7Days: 0,
        providers: [],
        disabled: true,
      });
    }
    return reply.send(await leadResearchService.getStats(workspaceId));
  });

  app.get('/suggestions/:leadId', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { leadId } = request.params as { leadId: string };

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, workspaceId },
      select: {
        id: true,
        linkedinUrl: true,
        website: true,
        companyDomain: true,
        jobTitle: true,
        websiteAnalyses: { where: { status: 'COMPLETED' }, select: { id: true }, take: 1 },
      },
    });
    if (!lead) return reply.status(404).send({ error: 'Lead not found' });

    const enabled = isLinkedInResearchEnabled();
    const webEnabled = isWebResearchEnabled();
    const research = (enabled || webEnabled) ? await leadResearchService.getLatestPerSource(workspaceId, lead.id) : [];
    const suggestions = buildResearchSuggestions(
      {
        linkedinUrl: lead.linkedinUrl,
        website: lead.website,
        companyDomain: lead.companyDomain,
        jobTitle: lead.jobTitle,
      },
      research,
      { enabled, hasWebsiteAnalysis: lead.websiteAnalyses.length > 0, webResearchEnabled: webEnabled },
    );
    return reply.send({ suggestions });
  });

  // ─── Per-lead reads ─────────────────────────────────────────────────────────

  app.get('/lead/:leadId', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { leadId } = request.params as { leadId: string };

    const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId }, select: { id: true } });
    if (!lead) return reply.status(404).send({ error: 'Lead not found' });

    if (!isLinkedInResearchEnabled()) return reply.send({ research: [], disabled: true });
    const research = await leadResearchService.getLatestPerSource(workspaceId, lead.id);
    return reply.send({ research: stripSecrets(research) });
  });

  app.get('/lead/:leadId/history', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { leadId } = request.params as { leadId: string };

    const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId }, select: { id: true } });
    if (!lead) return reply.status(404).send({ error: 'Lead not found' });

    // History is composed at read time from research, website analyses and
    // email verification — it stays useful even while the module flag is off.
    const items = await leadResearchService.getUnifiedHistory(workspaceId, lead.id);
    return reply.send({ items, researchDisabled: !isLinkedInResearchEnabled() });
  });

  // ─── Single record ──────────────────────────────────────────────────────────

  app.get('/research/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };

    const row = await leadResearchService.getResearch(workspaceId, id);
    if (!row) return reply.status(404).send({ error: 'Research not found' });
    return reply.send(stripSecrets(row));
  });

  app.post('/research/:id/verify', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    if (!isLinkedInResearchEnabled()) return reply.status(501).send(DISABLED_RESPONSE);
    try {
      const parsed = manualVerificationSchema.parse(request.body);
      const input = JSON.parse(JSON.stringify(parsed)) as import('@signalforge/lead-research').ManualVerificationInput;
      const row = await leadResearchService.applyManualVerification({
        workspaceId,
        researchId: id,
        userId: request.user!.userId,
        input,
      });

      void publishWorkflowEvent({
        eventType: 'LEAD_RESEARCH_COMPLETED',
        workspaceId,
        leadId: row.leadId,
        // Distinct from the worker's key so a manual verification after an
        // automated run still produces its own event.
        idempotencyKey: `lead-research-verified:${row.id}`,
        metadata: {
          researchId: row.id,
          source: row.source,
          researchType: row.researchType,
          provider: row.provider,
          status: row.status,
          confidence: row.confidence,
          verified: true,
        },
      }).catch(() => {});

      await queueResearchForEnrichment(workspaceId, row.leadId, request);
      return reply.send(stripSecrets(row));
    } catch (error) {
      return handleResearchError(error, reply);
    }
  });

  app.post('/research/:id/mark-verified', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    if (!isLinkedInResearchEnabled()) return reply.status(501).send(DISABLED_RESPONSE);
    try {
      const row = await leadResearchService.markVerified({
        workspaceId,
        researchId: id,
        userId: request.user!.userId,
      });
      await queueResearchForEnrichment(workspaceId, row.leadId, request);
      return reply.send(stripSecrets(row));
    } catch (error) {
      return handleResearchError(error, reply);
    }
  });

  app.post('/research/:id/retry', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    if (!isLinkedInResearchEnabled()) return reply.status(501).send(DISABLED_RESPONSE);
    try {
      const row = await leadResearchService.resetForRetry({ workspaceId, researchId: id });
      const queue = getResearchQueue();
      // A fresh job id: BullMQ silently ignores a duplicate id while the earlier
      // (retained) job still exists, which would make the retry a no-op.
      await enqueueLeadResearch(
        queue,
        { workspaceId, leadId: row.leadId, researchId: row.id, forceRefresh: true },
        { jobId: `lead-research-${row.id}-retry-${Date.now()}` },
      );
      await logResearchActivity({
        workspaceId,
        leadId: row.leadId,
        researchId: row.id,
        source: row.source as import('@signalforge/database').LeadResearchSource,
        operation: 'RESEARCH_RETRIED',
        status: 'QUEUED',
        actorUserId: actorId(request),
      });
      return reply.status(202).send({ researchId: row.id, status: 'QUEUED' });
    } catch (error) {
      return handleResearchError(error, reply);
    }
  });
};

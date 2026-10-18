import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { prisma } from '@signalforge/database';
import type { Prisma } from '@signalforge/database';
import { loadEnv } from '@signalforge/config';
import { createAIProvider } from '@signalforge/ai';
import {
  DomainHealthCheckRateLimitError,
  HEALTH_SCORE_EXPLANATION,
  DEFAULT_WEIGHTS,
  buildDomainRecommendations,
  campaignRowsToCsv,
  deliverabilityAlertService,
  deliverabilityPolicyService,
  deliverabilityProtectionService,
  deliverabilityStatsService,
  domainHealthService,
  mailboxRowsToCsv,
  normalizeDomain,
  resolveRange,
} from '@signalforge/deliverability';
import {
  analyzeDeliverabilitySchema,
  checkDomainHealthSchema,
  deliverabilityAlertListQuerySchema,
  deliverabilityExportQuerySchema,
  deliverabilityRangeQuerySchema,
  deliverabilityReportQuerySchema,
  resumeMailboxSendingSchema,
  updateDeliverabilityAlertSchema,
  updateDeliverabilityPolicySchema,
} from '@signalforge/validation';
import { getWorkspaceId, requireWorkspaceGuard, requireWorkspaceRole } from '../plugins/auth.js';

const DISCLAIMER =
  'Health scores reflect measurable sending signals, not guaranteed inbox placement.';

function handleError(error: unknown, reply: FastifyReply) {
  if (error instanceof DomainHealthCheckRateLimitError) {
    return reply
      .status(429)
      .header('Retry-After', String(error.retryAfterSeconds))
      .send({ error: error.message });
  }
  if (error instanceof Error) {
    if (/not found/i.test(error.message)) {
      return reply.status(404).send({ error: error.message });
    }
    return reply.status(400).send({ error: error.message });
  }
  return reply.status(500).send({ error: 'Internal server error' });
}

export const deliverabilityRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  // ─── Overview & scoring ─────────────────────────────────────────────────────

  app.get('/overview', async (request, reply) => {
    try {
      const { period } = deliverabilityRangeQuerySchema.parse(request.query);
      const workspaceId = getWorkspaceId(request);
      const overview = await deliverabilityStatsService.getOverview(workspaceId, resolveRange(period));
      return { ...overview, period, disclaimer: DISCLAIMER };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/score-formula', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const policy = await deliverabilityPolicyService.get(workspaceId);
    return {
      explanation: HEALTH_SCORE_EXPLANATION,
      disclaimer: DISCLAIMER,
      weights: policy.weights,
      defaultWeights: DEFAULT_WEIGHTS,
      thresholds: policy.thresholds,
    };
  });

  app.get('/timeline', async (request, reply) => {
    try {
      const { period } = deliverabilityRangeQuerySchema.parse(request.query);
      const workspaceId = getWorkspaceId(request);
      const points = await deliverabilityStatsService.getWorkspaceTimeline(
        workspaceId,
        resolveRange(period),
      );
      return { points };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // ─── Mailboxes ──────────────────────────────────────────────────────────────

  app.get('/mailboxes', async (request, reply) => {
    try {
      const { period } = deliverabilityRangeQuerySchema.parse(request.query);
      const workspaceId = getWorkspaceId(request);
      const mailboxes = await deliverabilityStatsService.getMailboxRows(
        workspaceId,
        resolveRange(period),
      );
      return { mailboxes, disclaimer: DISCLAIMER };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get<{ Params: { id: string } }>('/mailboxes/:id', async (request, reply) => {
    try {
      const { period } = deliverabilityRangeQuerySchema.parse(request.query);
      const workspaceId = getWorkspaceId(request);
      const detail = await deliverabilityStatsService.getMailboxDetail(
        workspaceId,
        request.params.id,
        resolveRange(period),
      );
      if (!detail) {
        return reply.status(404).send({ error: 'Mailbox not found' });
      }
      return { ...detail, disclaimer: DISCLAIMER };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get<{ Params: { id: string } }>('/mailboxes/:id/timeline', async (request, reply) => {
    try {
      const { period } = deliverabilityRangeQuerySchema.parse(request.query);
      const workspaceId = getWorkspaceId(request);
      const mailbox = await prisma.mailbox.findFirst({
        where: { id: request.params.id, workspaceId },
        select: { id: true },
      });
      if (!mailbox) {
        return reply.status(404).send({ error: 'Mailbox not found' });
      }
      const snapshots = await deliverabilityStatsService.getMailboxTimeline(
        workspaceId,
        request.params.id,
        resolveRange(period),
      );
      return {
        points: snapshots.map((snapshot) => ({
          date: snapshot.snapshotDate.toISOString().slice(0, 10),
          sent: snapshot.sent,
          bounced: snapshot.bounced,
          failed: snapshot.failed,
          replies: snapshot.replies,
          unsubscribes: snapshot.unsubscribes,
          bounceRate: snapshot.bounceRate,
          failureRate: snapshot.failureRate,
          replyRate: snapshot.replyRate,
          unsubscribeRate: snapshot.unsubscribeRate,
          healthScore: snapshot.healthScore,
        })),
      };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // Resuming a protected mailbox is an operator override, so it requires ADMIN
  // and is always written to the mailbox activity log.
  app.post<{ Params: { id: string } }>(
    '/mailboxes/:id/resume',
    { preHandler: requireWorkspaceRole('ADMIN').preHandler },
    async (request, reply) => {
      try {
        const body = resumeMailboxSendingSchema.parse(request.body ?? {});
        const workspaceId = getWorkspaceId(request);
        const actorUserId = request.user?.userId;
        if (!actorUserId) {
          return reply.status(401).send({ error: 'Unauthorized' });
        }

        const result = await deliverabilityProtectionService.resumeMailbox({
          workspaceId,
          mailboxId: request.params.id,
          actorUserId,
          note: body.note,
        });
        if (!result.resumed) {
          return reply.status(404).send({ error: 'Mailbox not found' });
        }
        return {
          resumed: true,
          note: 'Recipient suppressions from hard bounces remain enforced.',
        };
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  // ─── Campaigns ──────────────────────────────────────────────────────────────

  app.get('/campaigns', async (request, reply) => {
    try {
      const { period } = deliverabilityRangeQuerySchema.parse(request.query);
      const workspaceId = getWorkspaceId(request);
      const campaigns = await deliverabilityStatsService.getCampaignRows(
        workspaceId,
        resolveRange(period),
      );
      return { campaigns, disclaimer: DISCLAIMER };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get<{ Params: { id: string } }>('/campaigns/:id', async (request, reply) => {
    try {
      const { period } = deliverabilityRangeQuerySchema.parse(request.query);
      const workspaceId = getWorkspaceId(request);
      const detail = await deliverabilityStatsService.getCampaignDetail(
        workspaceId,
        request.params.id,
        resolveRange(period),
      );
      if (!detail) {
        return reply.status(404).send({ error: 'Campaign not found' });
      }
      return { ...detail, disclaimer: DISCLAIMER };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // ─── Alerts ─────────────────────────────────────────────────────────────────

  app.get('/alerts', async (request, reply) => {
    try {
      const query = deliverabilityAlertListQuerySchema.parse(request.query);
      const workspaceId = getWorkspaceId(request);
      const where: Prisma.DeliverabilityAlertWhereInput = {
        workspaceId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
      };

      const [alerts, total] = await Promise.all([
        prisma.deliverabilityAlert.findMany({
          where,
          orderBy: [{ status: 'asc' }, { occurredAt: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.deliverabilityAlert.count({ where }),
      ]);

      return {
        alerts,
        pagination: { page: query.page, limit: query.limit, total },
      };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.patch<{ Params: { id: string } }>('/alerts/:id', async (request, reply) => {
    try {
      const body = updateDeliverabilityAlertSchema.parse(request.body);
      const workspaceId = getWorkspaceId(request);
      const updated = await deliverabilityAlertService.updateStatus(
        workspaceId,
        request.params.id,
        body.status,
      );
      if (!updated) {
        return reply.status(404).send({ error: 'Alert not found' });
      }
      return { status: body.status };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // ─── Domain authentication ──────────────────────────────────────────────────

  app.get('/domains', async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request);
      const [checked, sendingDomains] = await Promise.all([
        domainHealthService.list(workspaceId),
        domainHealthService.listSendingDomains(workspaceId),
      ]);

      const checkedByDomain = new Map(checked.map((row) => [row.domain, row]));
      const domains = sendingDomains.map((domain) => {
        const record = checkedByDomain.get(domain);
        if (!record) {
          return {
            domain,
            spfStatus: 'NOT_CHECKED' as const,
            dkimStatus: 'NOT_CHECKED' as const,
            dmarcStatus: 'NOT_CHECKED' as const,
            mxStatus: 'NOT_CHECKED' as const,
            dmarcPolicy: null,
            dkimSelectors: [],
            checkedAt: null,
            expiresAt: null,
            lastError: null,
            recommendations: [],
          };
        }
        return {
          domain: record.domain,
          spfStatus: record.spfStatus,
          dkimStatus: record.dkimStatus,
          dmarcStatus: record.dmarcStatus,
          mxStatus: record.mxStatus,
          dmarcPolicy: record.dmarcPolicy,
          dkimSelectors: record.dkimSelectors,
          checkedAt: record.checkedAt,
          expiresAt: record.expiresAt,
          lastError: record.lastError,
          recommendations: buildDomainRecommendations(record),
        };
      });

      return {
        domains,
        note: 'DKIM cannot be verified without a selector. An unknown result is not a failure.',
      };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post<{ Params: { domain: string } }>('/domains/:domain/check', async (request, reply) => {
    try {
      const body = checkDomainHealthSchema.parse(request.body ?? {});
      const workspaceId = getWorkspaceId(request);
      const domain = normalizeDomain(decodeURIComponent(request.params.domain));

      // Only domains this workspace actually sends from can be checked, so the
      // endpoint cannot be used as a general-purpose DNS probe.
      const sendingDomains = await domainHealthService.listSendingDomains(workspaceId);
      if (!sendingDomains.includes(domain)) {
        return reply.status(404).send({ error: 'Domain is not a sending domain for this workspace' });
      }

      const record = body.dkimSelector
        ? await domainHealthService.addSelector(workspaceId, domain, body.dkimSelector)
        : await domainHealthService.runCheck(workspaceId, domain, { force: body.force });

      await deliverabilityAlertService.evaluateDomain({
        workspaceId,
        domain: record,
        recommendation: buildDomainRecommendations(record)[0] ?? null,
      });

      return { ...record, recommendations: buildDomainRecommendations(record) };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // ─── Protection policy ──────────────────────────────────────────────────────

  app.get('/policy', async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request);
      const policy = await deliverabilityPolicyService.get(workspaceId);
      return { ...policy, disclaimer: DISCLAIMER };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.put(
    '/policy',
    { preHandler: requireWorkspaceRole('ADMIN').preHandler },
    async (request, reply) => {
      try {
        const body = updateDeliverabilityPolicySchema.parse(request.body);
        const workspaceId = getWorkspaceId(request);
        const policy = await deliverabilityPolicyService.update(workspaceId, body);
        return policy;
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  // ─── Report & export ────────────────────────────────────────────────────────

  app.get('/report', async (request, reply) => {
    try {
      const query = deliverabilityReportQuerySchema.parse(request.query);
      const workspaceId = getWorkspaceId(request);
      const range =
        query.from && query.to ? { from: query.from, to: query.to } : resolveRange(query.period);
      const report = await deliverabilityStatsService.getReport(workspaceId, range);
      return { ...report, disclaimer: DISCLAIMER };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/export', async (request, reply) => {
    try {
      const query = deliverabilityExportQuerySchema.parse(request.query);
      const workspaceId = getWorkspaceId(request);
      const range = resolveRange(query.period);

      const csv =
        query.entity === 'campaigns'
          ? campaignRowsToCsv(await deliverabilityStatsService.getCampaignRows(workspaceId, range))
          : mailboxRowsToCsv(await deliverabilityStatsService.getMailboxRows(workspaceId, range));

      reply.header('Content-Type', 'text/csv');
      reply.header(
        'Content-Disposition',
        `attachment; filename="deliverability-${query.entity}-${query.period}.csv"`,
      );
      return csv;
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // ─── AI advisory ────────────────────────────────────────────────────────────

  /**
   * Summarizes already-computed metrics. The response is narrative only: the
   * server never applies anything the model returns to suppression, protection,
   * or send eligibility.
   */
  app.post('/analyze', async (request, reply) => {
    try {
      const body = analyzeDeliverabilitySchema.parse(request.body);
      const workspaceId = getWorkspaceId(request);
      const detail = await deliverabilityStatsService.getMailboxDetail(
        workspaceId,
        body.mailboxId,
        resolveRange(body.period),
      );
      if (!detail) {
        return reply.status(404).send({ error: 'Mailbox not found' });
      }

      const env = loadEnv();
      const aiProvider = createAIProvider(env.AI_PROVIDER, {
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL,
        baseURL: env.OPENAI_BASE_URL,
      });
      const analysis = await aiProvider.analyzeDeliverability({
        mailboxLabel: detail.mailbox.emailAddress,
        healthScore: detail.healthScore,
        tier: detail.tier,
        protectionLevel: detail.mailbox.protectionLevel,
        metrics: {
          attempted: detail.counters.attempted,
          sent: detail.counters.sent,
          delivered: detail.counters.delivered,
          bounced: detail.counters.bounced,
          hardBounces: detail.counters.hardBounces,
          softBounces: detail.counters.softBounces,
          failed: detail.counters.failed,
          uniqueReplies: detail.counters.uniqueRepliedLeads,
          unsubscribes: detail.counters.unsubscribes,
        },
        rates: {
          bounceRate: detail.rates.bounceRate,
          failureRate: detail.rates.failureRate,
          replyRate: detail.rates.replyRate,
          unsubscribeRate: detail.rates.unsubscribeRate,
        },
        authentication: detail.domain
          ? {
              spf: detail.domain.spfStatus,
              dkim: detail.domain.dkimStatus,
              dmarc: detail.domain.dmarcStatus,
              mx: detail.domain.mxStatus,
            }
          : null,
        complaintDataAvailable: detail.complaintDataAvailable,
      });

      return {
        summary: analysis.summary,
        riskScore: analysis.riskScore,
        investigationAreas: analysis.investigationAreas,
        recommendations: analysis.recommendations,
        advisoryOnly: true,
        disclaimer: `${DISCLAIMER} This summary is advisory and does not change any protection or suppression rule.`,
      };
    } catch (error) {
      return handleError(error, reply);
    }
  });
};

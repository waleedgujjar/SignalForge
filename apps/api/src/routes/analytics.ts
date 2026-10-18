import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { loadEnv } from '@signalforge/config';
import { createAIProvider } from '@signalforge/ai';
import {
  ANALYTICS_LIMITATIONS,
  AnalyticsRangeError,
  LeadOutcomeNotFoundError,
  OPEN_TRACKING_NOTE,
  analyticsStatsService,
  campaignRowsToCsv,
  dimensionRowsToCsv,
  discoveryRowsToCsv,
  funnelService,
  funnelToCsv,
  mailboxRowsToCsv,
  outcomeService,
  resolveAnalyticsRange,
  sequenceRowsToCsv,
  timelineToCsv,
  type AnalyticsFilters,
  type AnalyticsRange,
  type StatsWindow,
} from '@signalforge/analytics';
import {
  analyticsExportQuerySchema,
  analyticsOutcomeListQuerySchema,
  analyticsRangeQuerySchema,
  analyzeAnalyticsSchema,
  recordLeadOutcomeSchema,
} from '@signalforge/validation';
import { getWorkspaceId, requireWorkspaceGuard, requireWorkspaceRole } from '../plugins/auth.js';

function handleError(error: unknown, reply: FastifyReply) {
  if (error instanceof AnalyticsRangeError) {
    return reply.status(400).send({ error: error.message });
  }
  if (error instanceof LeadOutcomeNotFoundError) {
    return reply.status(404).send({ error: error.message });
  }
  if (error instanceof Error) {
    return reply.status(400).send({ error: error.message });
  }
  return reply.status(500).send({ error: 'Internal server error' });
}

/**
 * Builds the query window from request parameters.
 *
 * The workspace id always comes from the authenticated session, never from the
 * query string, so a caller cannot read another tenant's analytics by guessing
 * an id.
 */
function buildWindow(request: FastifyRequest): StatsWindow {
  const query = analyticsRangeQuerySchema.parse(request.query);
  const range = resolveAnalyticsRange({
    period: query.period,
    startDate: query.startDate,
    endDate: query.endDate,
  });
  const filters: AnalyticsFilters = {
    campaignId: query.campaignId,
    mailboxId: query.mailboxId,
    source: query.source,
    industry: query.industry,
    country: query.country,
  };
  return { workspaceId: getWorkspaceId(request), range, filters };
}

function rangeMeta(range: AnalyticsRange) {
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    period: range.period,
    days: range.days,
  };
}

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  // ─── Overview ───────────────────────────────────────────────────────────────

  app.get('/overview', async (request, reply) => {
    try {
      return await analyticsStatsService.getOverview(buildWindow(request));
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/timeline', async (request, reply) => {
    try {
      const window = buildWindow(request);
      const points = await analyticsStatsService.getTimeline(window);
      return { range: rangeMeta(window.range), points, note: OPEN_TRACKING_NOTE };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/funnel', async (request, reply) => {
    try {
      const window = buildWindow(request);
      const funnel = await funnelService.getFunnel({
        workspaceId: window.workspaceId,
        from: window.range.from,
        to: window.range.to,
        filters: window.filters,
      });
      return { range: rangeMeta(window.range), ...funnel };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/daily-activity', async (request, reply) => {
    try {
      return await analyticsStatsService.getDailyActivity(getWorkspaceId(request));
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/insights', async (request, reply) => {
    try {
      const overview = await analyticsStatsService.getOverview(buildWindow(request));
      return { insights: overview.insights, limitations: overview.limitations };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/top-performers', async (request, reply) => {
    try {
      return await analyticsStatsService.getTopPerformers(buildWindow(request));
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // ─── Campaigns & sequences ──────────────────────────────────────────────────

  app.get('/campaigns', async (request, reply) => {
    try {
      const window = buildWindow(request);
      const campaigns = await analyticsStatsService.getCampaignRows(window);
      return { range: rangeMeta(window.range), campaigns };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get<{ Params: { id: string } }>('/campaigns/:id', async (request, reply) => {
    try {
      const window = buildWindow(request);
      const detail = await analyticsStatsService.getCampaignDetail(window, request.params.id);
      if (!detail) {
        return reply.status(404).send({ error: 'Campaign not found' });
      }
      return { range: rangeMeta(window.range), ...detail };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/sequences', async (request, reply) => {
    try {
      const window = buildWindow(request);
      const steps = await analyticsStatsService.getSequenceRows(window);
      return {
        range: rangeMeta(window.range),
        steps,
        attributionNote:
          'Replies are attributed to the most recent step sent before the reply arrived.',
      };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/subjects', async (request, reply) => {
    try {
      const window = buildWindow(request);
      const subjects = await analyticsStatsService.getSubjectRows(window);
      return { range: rangeMeta(window.range), subjects, note: OPEN_TRACKING_NOTE };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // ─── Sending infrastructure ─────────────────────────────────────────────────

  app.get('/mailboxes', async (request, reply) => {
    try {
      const window = buildWindow(request);
      const mailboxes = await analyticsStatsService.getMailboxRows(window);
      return { range: rangeMeta(window.range), mailboxes };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/smtp-pools', async (request, reply) => {
    try {
      const window = buildWindow(request);
      const pools = await analyticsStatsService.getSmtpPoolRows(window);
      return { range: rangeMeta(window.range), pools };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/warmup', async (request, reply) => {
    try {
      const window = buildWindow(request);
      const warmup = await analyticsStatsService.getWarmupAnalytics(window);
      return {
        range: rangeMeta(window.range),
        ...warmup,
        note: 'Warmup traffic is tracked separately and is never counted in campaign metrics.',
      };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // ─── Leads & dimensions ─────────────────────────────────────────────────────

  app.get('/leads', async (request, reply) => {
    try {
      const window = buildWindow(request);
      const [verification, funnel] = await Promise.all([
        analyticsStatsService.getLeadAnalytics(window),
        funnelService.getFunnel({
          workspaceId: window.workspaceId,
          from: window.range.from,
          to: window.range.to,
          filters: window.filters,
        }),
      ]);
      return { range: rangeMeta(window.range), verification, funnel };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/sources', async (request, reply) => {
    try {
      const window = buildWindow(request);
      const rows = await analyticsStatsService.getDimensionRows(window, 'source');
      return {
        range: rangeMeta(window.range),
        rows,
        note: 'Sources are the values recorded at import time, not external provider names.',
      };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/industries', async (request, reply) => {
    try {
      const window = buildWindow(request);
      return { range: rangeMeta(window.range), rows: await analyticsStatsService.getDimensionRows(window, 'industry') };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/geography', async (request, reply) => {
    try {
      const window = buildWindow(request);
      return { range: rangeMeta(window.range), rows: await analyticsStatsService.getDimensionRows(window, 'country') };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/job-titles', async (request, reply) => {
    try {
      const window = buildWindow(request);
      return { range: rangeMeta(window.range), rows: await analyticsStatsService.getDimensionRows(window, 'jobTitle') };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/company-sizes', async (request, reply) => {
    try {
      const window = buildWindow(request);
      const rows = await analyticsStatsService.getCompanySizeRows(window);
      return {
        range: rangeMeta(window.range),
        rows,
        note: 'Company size depends on enrichment data; leads without an employee count are grouped as Unknown.',
      };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/website-intelligence', async (request, reply) => {
    try {
      const window = buildWindow(request);
      return {
        range: rangeMeta(window.range),
        ...(await analyticsStatsService.getWebsiteIntelligence(window)),
      };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/imports', async (request, reply) => {
    try {
      const window = buildWindow(request);
      return { range: rangeMeta(window.range), ...(await analyticsStatsService.getImportAnalytics(window)) };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/discovery', async (request, reply) => {
    try {
      const window = buildWindow(request);
      return { range: rangeMeta(window.range), ...(await analyticsStatsService.getDiscoveryAnalytics(window)) };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // ─── Replies & outcomes ─────────────────────────────────────────────────────

  app.get('/replies', async (request, reply) => {
    try {
      const window = buildWindow(request);
      const [replies, meetings] = await Promise.all([
        analyticsStatsService.getReplyAnalytics(window),
        analyticsStatsService.getMeetingAnalytics(window),
      ]);
      return { range: rangeMeta(window.range), replies, meetings };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/meetings', async (request, reply) => {
    try {
      const window = buildWindow(request);
      return { range: rangeMeta(window.range), ...(await analyticsStatsService.getMeetingAnalytics(window)) };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/outcomes', async (request, reply) => {
    try {
      const query = analyticsOutcomeListQuerySchema.parse(request.query);
      const workspaceId = getWorkspaceId(request);
      const result = await outcomeService.list({
        workspaceId,
        type: query.type,
        from: query.startDate ? new Date(query.startDate) : undefined,
        to: query.endDate ? new Date(query.endDate) : undefined,
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      });
      return { ...result, page: query.page, limit: query.limit };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post(
    '/outcomes',
    { preHandler: requireWorkspaceRole('ADMIN').preHandler },
    async (request, reply) => {
      try {
        const body = recordLeadOutcomeSchema.parse(request.body);
        const outcome = await outcomeService.record({
          workspaceId: getWorkspaceId(request),
          leadId: body.leadId,
          type: body.type,
          campaignId: body.campaignId,
          conversationId: body.conversationId,
          occurredAt: body.occurredAt,
          recordedById: request.user?.userId ?? null,
          note: body.note,
          source: 'MANUAL',
        });
        return reply.status(201).send(outcome);
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/outcomes/:id',
    { preHandler: requireWorkspaceRole('ADMIN').preHandler },
    async (request, reply) => {
      try {
        await outcomeService.delete(getWorkspaceId(request), request.params.id);
        return reply.status(204).send();
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  // ─── Export ─────────────────────────────────────────────────────────────────

  app.get('/export', async (request, reply) => {
    try {
      const query = analyticsExportQuerySchema.parse(request.query);
      const range = resolveAnalyticsRange({
        period: query.period,
        startDate: query.startDate,
        endDate: query.endDate,
      });
      const window: StatsWindow = {
        workspaceId: getWorkspaceId(request),
        range,
        filters: {
          campaignId: query.campaignId,
          mailboxId: query.mailboxId,
          source: query.source,
          industry: query.industry,
          country: query.country,
        },
      };

      const csv = await buildExport(window, query.entity);
      reply.header('Content-Type', 'text/csv');
      reply.header(
        'Content-Disposition',
        `attachment; filename="analytics-${query.entity}-${query.period}.csv"`,
      );
      return csv;
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // ─── AI advisory ────────────────────────────────────────────────────────────

  /**
   * Narrates already-computed KPIs. Nothing the model returns is stored or used
   * to change campaign, mailbox, or send behaviour.
   */
  app.post('/analyze', async (request, reply) => {
    try {
      const body = analyzeAnalyticsSchema.parse(request.body ?? {});
      const range = resolveAnalyticsRange({
        period: body.period,
        startDate: body.startDate,
        endDate: body.endDate,
      });
      const overview = await analyticsStatsService.getOverview({
        workspaceId: getWorkspaceId(request),
        range,
        filters: { campaignId: body.campaignId },
      });

      const stageCount = (stage: string): number =>
        overview.funnel.steps.find((step) => step.stage === stage)?.count ?? 0;

      const env = loadEnv();
      const aiProvider = createAIProvider(env.AI_PROVIDER, {
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL,
        baseURL: env.OPENAI_BASE_URL,
      });
      const analysis = await aiProvider.analyzeAnalytics({
        periodLabel: `${range.days} day${range.days === 1 ? '' : 's'} ending ${range.to.toISOString().slice(0, 10)}`,
        leads: {
          imported: stageCount('IMPORTED'),
          verified: stageCount('VERIFIED'),
          qualified: stageCount('QUALIFIED'),
          contacted: stageCount('CONTACTED'),
          replied: stageCount('REPLIED'),
          positiveReplies: overview.replies.positive,
          meetings: overview.meetings.booked,
        },
        email: {
          sent: overview.counters.sent,
          delivered: overview.counters.delivered,
          bounced: overview.counters.bounced,
          failed: overview.counters.failed,
          replies: overview.counters.replies,
          unsubscribes: overview.counters.unsubscribes,
        },
        rates: {
          deliveryRate: overview.rates.deliveryRate,
          bounceRate: overview.rates.bounceRate,
          replyRate: overview.rates.replyRate,
          unsubscribeRate: overview.rates.unsubscribeRate,
        },
        trends: overview.kpis
          .filter((card) => card.trend !== null)
          .map((card) => ({
            metric: card.label,
            current: card.trend!.current,
            previous: card.trend!.previous,
          })),
        topCampaigns: overview.topCampaigns.map((campaign) => ({
          name: campaign.name,
          sent: campaign.counters.sent,
          replyRate: campaign.rates.replyRate,
        })),
        unavailableMetrics: ['open rate', 'click rate', 'revenue', 'ROI'],
      });

      return {
        ...analysis,
        advisoryOnly: true,
        limitations: ANALYTICS_LIMITATIONS,
        disclaimer:
          'This summary describes measured metrics only. It is advisory and does not change any campaign or sending behaviour.',
      };
    } catch (error) {
      return handleError(error, reply);
    }
  });
};

async function buildExport(window: StatsWindow, entity: string): Promise<string> {
  switch (entity) {
    case 'mailboxes':
      return mailboxRowsToCsv(await analyticsStatsService.getMailboxRows(window));
    case 'sequences':
      return sequenceRowsToCsv(await analyticsStatsService.getSequenceRows(window));
    case 'funnel':
      return funnelToCsv(
        await funnelService.getFunnel({
          workspaceId: window.workspaceId,
          from: window.range.from,
          to: window.range.to,
          filters: window.filters,
        }),
      );
    case 'timeline':
      return timelineToCsv(await analyticsStatsService.getTimeline(window));
    case 'sources':
      return dimensionRowsToCsv('source', await analyticsStatsService.getDimensionRows(window, 'source'));
    case 'industries':
      return dimensionRowsToCsv('industry', await analyticsStatsService.getDimensionRows(window, 'industry'));
    case 'geography':
      return dimensionRowsToCsv('country', await analyticsStatsService.getDimensionRows(window, 'country'));
    case 'job-titles':
      return dimensionRowsToCsv('jobTitle', await analyticsStatsService.getDimensionRows(window, 'jobTitle'));
    case 'discovery':
      return discoveryRowsToCsv(await analyticsStatsService.getDiscoveryAnalytics(window));
    case 'campaigns':
    default:
      return campaignRowsToCsv(await analyticsStatsService.getCampaignRows(window));
  }
}

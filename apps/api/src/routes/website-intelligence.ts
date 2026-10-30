import { resolve4, resolve6 } from 'node:dns/promises';
import { isIPv4 } from 'node:net';
import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '@signalforge/database';
import {
  analyzeWebsiteSchema,
  analyzeWebsiteUrlSchema,
  batchAnalyzeSchema,
  websiteAnalysisQuerySchema,
} from '@signalforge/validation';
import { QUEUE_NAMES, WEBSITE_ANALYSIS_JOB_OPTIONS } from '@signalforge/queue';
import { publishWorkflowEvent } from '@signalforge/automations';
import { requireWorkspaceGuard, getWorkspaceId } from '../plugins/auth.js';
import { getQueue } from '../queue-registry.js';

function getAnalysisQueue() {
  return getQueue(QUEUE_NAMES.WEBSITE_ANALYSIS);
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80') ||
    normalized === '::' ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.') ||
    normalized.startsWith('::ffff:169.254.')
  );
}

async function assertNotInternalUrl(hostname: string): Promise<void> {
  if (isIPv4(hostname)) {
    if (isPrivateIPv4(hostname)) throw new Error('URL resolves to a private address');
    return;
  }
  if (hostname.startsWith('[') || hostname.includes(':')) {
    const bare = hostname.replace(/^\[|\]$/g, '');
    if (isPrivateIPv6(bare)) throw new Error('URL resolves to a private address');
    return;
  }

  const blocked = ['localhost', 'metadata.google.internal'];
  if (blocked.includes(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('URL resolves to a private address');
  }

  let addresses: string[] = [];
  try { addresses = addresses.concat(await resolve4(hostname)); } catch { /* no A records */ }
  try { addresses = addresses.concat(await resolve6(hostname)); } catch { /* no AAAA records */ }

  if (addresses.length === 0) throw new Error('Could not resolve hostname');

  for (const addr of addresses) {
    if (isIPv4(addr) ? isPrivateIPv4(addr) : isPrivateIPv6(addr)) {
      throw new Error('URL resolves to a private address');
    }
  }
}

function normalizeWebsiteUrl(raw: string): { normalizedUrl: string; domain: string } {
  const normalizedUrl = raw.startsWith('http') ? raw : `https://${raw}`;
  const parsed = new URL(normalizedUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP(S) URLs are allowed');
  }
  const domain = parsed.hostname;
  return { normalizedUrl, domain };
}

async function resolveLeadForAnalysis(
  workspaceId: string,
  options: { leadId?: string; email?: string; company?: string; url: string; domain: string },
) {
  if (options.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: options.leadId, workspaceId },
      select: { id: true, website: true, companyDomain: true },
    });
    if (!lead) return null;

    if (!lead.website || !lead.companyDomain) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          website: lead.website ?? options.url,
          companyDomain: lead.companyDomain ?? options.domain,
          ...(options.company ? { company: options.company } : {}),
        },
      });
    }

    return lead;
  }

  const existingByDomain = await prisma.lead.findFirst({
    where: {
      workspaceId,
      OR: [
        { companyDomain: options.domain },
        { website: { contains: options.domain, mode: 'insensitive' } },
      ],
    },
    select: { id: true, website: true, companyDomain: true },
    orderBy: { createdAt: 'desc' },
  });

  if (existingByDomain) {
    if (!existingByDomain.website) {
      await prisma.lead.update({
        where: { id: existingByDomain.id },
        data: { website: options.url, companyDomain: options.domain },
      });
    }
    return existingByDomain;
  }

  if (options.email) {
    const existingByEmail = await prisma.lead.findFirst({
      where: { workspaceId, email: options.email },
      select: { id: true, website: true, companyDomain: true },
    });

    if (existingByEmail) {
      await prisma.lead.update({
        where: { id: existingByEmail.id },
        data: {
          website: existingByEmail.website ?? options.url,
          companyDomain: existingByEmail.companyDomain ?? options.domain,
          ...(options.company ? { company: options.company } : {}),
        },
      });
      return existingByEmail;
    }

    return prisma.lead.create({
      data: {
        workspaceId,
        email: options.email,
        company: options.company,
        website: options.url,
        companyDomain: options.domain,
        source: 'MANUAL',
        status: 'NEW',
      },
      select: { id: true, website: true, companyDomain: true },
    });
  }

  const placeholderEmail = `website-intel+${options.domain.replace(/[^a-z0-9.-]/gi, '-')}@signalforge.local`;
  let email = placeholderEmail;
  let suffix = 1;
  while (await prisma.lead.findFirst({ where: { workspaceId, email }, select: { id: true } })) {
    email = `website-intel+${options.domain.replace(/[^a-z0-9.-]/gi, '-')}-${suffix}@signalforge.local`;
    suffix++;
  }

  return prisma.lead.create({
    data: {
      workspaceId,
      email,
      company: options.company ?? options.domain,
      website: options.url,
      companyDomain: options.domain,
      source: 'MANUAL',
      status: 'NEW',
    },
    select: { id: true, website: true, companyDomain: true },
  });
}

async function enqueueWebsiteAnalysis(
  workspaceId: string,
  leadId: string,
  normalizedUrl: string,
  domain: string,
  options?: { maxPages?: number; reanalyze?: boolean; forceRescan?: boolean },
) {
  await assertNotInternalUrl(new URL(normalizedUrl).hostname);

  const analysis = await prisma.websiteAnalysis.create({
    data: {
      workspaceId,
      leadId,
      domain,
      url: normalizedUrl,
      status: 'PENDING',
    },
  });

  const queue = getAnalysisQueue();
  await queue.add(
    'analyze',
    {
      workspaceId,
      leadId,
      analysisId: analysis.id,
      url: normalizedUrl,
      domain,
      maxPages: options?.maxPages,
      reanalyze: options?.reanalyze,
      forceRescan: options?.forceRescan,
    },
    WEBSITE_ANALYSIS_JOB_OPTIONS,
  );

  return analysis;
}

export const websiteIntelligenceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  app.post('/analyze', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const body = analyzeWebsiteSchema.parse(request.body);

    const lead = await prisma.lead.findFirst({
      where: { id: body.leadId, workspaceId },
      select: { id: true, website: true, companyDomain: true, email: true },
    });

    if (!lead) {
      return reply.status(404).send({ error: 'Lead not found' });
    }

    const url = lead.website || (lead.companyDomain ? `https://${lead.companyDomain}` : null);
    if (!url) {
      return reply.status(400).send({ error: 'Lead has no website or company domain' });
    }

    let normalizedUrl: string;
    let domain: string;
    try {
      ({ normalizedUrl, domain } = normalizeWebsiteUrl(url));
      await assertNotInternalUrl(domain);
    } catch {
      return reply.status(400).send({ error: 'Invalid website URL' });
    }

    const analysis = await enqueueWebsiteAnalysis(workspaceId, lead.id, normalizedUrl, domain, {
      maxPages: body.maxPages,
      reanalyze: body.reanalyze,
    });

    return reply.status(202).send({ analysisId: analysis.id, leadId: lead.id });
  });

  app.post('/analyze/url', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const body = analyzeWebsiteUrlSchema.parse(request.body);

    let normalizedUrl: string;
    let domain: string;
    try {
      ({ normalizedUrl, domain } = normalizeWebsiteUrl(body.url.trim()));
      await assertNotInternalUrl(domain);
    } catch {
      return reply.status(400).send({ error: 'Invalid website URL' });
    }

    const lead = await resolveLeadForAnalysis(workspaceId, {
      leadId: body.leadId,
      email: body.email,
      company: body.company,
      url: normalizedUrl,
      domain,
    });

    if (!lead) {
      return reply.status(404).send({ error: 'Lead not found' });
    }

    const analysis = await enqueueWebsiteAnalysis(workspaceId, lead.id, normalizedUrl, domain, {
      maxPages: body.maxPages,
      reanalyze: body.reanalyze,
    });

    return reply.status(202).send({ analysisId: analysis.id, leadId: lead.id });
  });

  app.post('/analyze/batch', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const body = batchAnalyzeSchema.parse(request.body);

    if (body.leadIds.length > 10 && !body.confirmBulk) {
      return reply.status(400).send({
        error: 'Bulk confirmation required',
        message: `Analyze ${body.leadIds.length} websites? Set confirmBulk=true to proceed.`,
        estimatedJobs: body.leadIds.length,
      });
    }

    void publishWorkflowEvent({
      eventType: 'BULK_ANALYSIS_STARTED',
      workspaceId,
      idempotencyKey: `bulk-analysis-started:${workspaceId}:${Date.now()}`,
      metadata: { count: body.leadIds.length },
    }).catch(() => {});

    const leads = await prisma.lead.findMany({
      where: { id: { in: body.leadIds }, workspaceId },
      select: { id: true, website: true, companyDomain: true, email: true },
    });

    let queued = 0;
    const skipped: string[] = [];

    for (const lead of leads) {
      const url = lead.website || (lead.companyDomain ? `https://${lead.companyDomain}` : null);
      if (!url) {
        skipped.push(lead.id);
        continue;
      }

      let domain: string;
      let normalizedUrl: string;
      try {
        ({ normalizedUrl, domain } = normalizeWebsiteUrl(url));
        await assertNotInternalUrl(domain);
      } catch {
        skipped.push(lead.id);
        continue;
      }

      await enqueueWebsiteAnalysis(workspaceId, lead.id, normalizedUrl, domain, {
        maxPages: body.maxPages,
      });

      queued++;
    }

    void publishWorkflowEvent({
      eventType: 'BULK_ANALYSIS_COMPLETED',
      workspaceId,
      idempotencyKey: `bulk-analysis-queued:${workspaceId}:${Date.now()}`,
      metadata: { queued, skipped: skipped.length },
    }).catch(() => {});

    return reply.status(202).send({ queued, skipped: skipped.length, skippedLeadIds: skipped });
  });

  app.get('/analyses', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const query = websiteAnalysisQuerySchema.parse(request.query);

    const where: Record<string, unknown> = { workspaceId };
    if (query.status) where['status'] = query.status;
    if (query.opportunityPriority) where['opportunityPriority'] = query.opportunityPriority;
    if (query.minWebsiteScore !== undefined || query.maxWebsiteScore !== undefined) {
      where['websiteScore'] = {
        ...(query.minWebsiteScore !== undefined ? { gte: query.minWebsiteScore } : {}),
        ...(query.maxWebsiteScore !== undefined ? { lte: query.maxWebsiteScore } : {}),
      };
    }

    const [analyses, total] = await Promise.all([
      prisma.websiteAnalysis.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          lead: { select: { id: true, email: true, fullName: true, company: true } },
        },
      }),
      prisma.websiteAnalysis.count({ where }),
    ]);

    return {
      analyses,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  });

  app.get('/analyses/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };

    const analysis = await prisma.websiteAnalysis.findFirst({
      where: { id, workspaceId },
      include: {
        lead: { select: { id: true, email: true, fullName: true, company: true, website: true } },
      },
    });

    if (!analysis) {
      return reply.status(404).send({ error: 'Analysis not found' });
    }

    return analysis;
  });

  app.get('/lead/:leadId', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { leadId } = request.params as { leadId: string };

    const analysis = await prisma.websiteAnalysis.findFirst({
      where: { leadId, workspaceId },
      orderBy: { createdAt: 'desc' },
    });

    if (!analysis) {
      return reply.status(404).send({ error: 'No analysis found for this lead' });
    }

    return analysis;
  });

  app.get('/lead/:leadId/history', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const { leadId } = request.params as { leadId: string };

    const analyses = await prisma.websiteAnalysis.findMany({
      where: { leadId, workspaceId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        websiteScore: true,
        opportunityScore: true,
        opportunityPriority: true,
        domain: true,
        pagesCrawled: true,
        createdAt: true,
      },
    });

    return { analyses };
  });

  app.post('/rescan/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };

    const existing = await prisma.websiteAnalysis.findFirst({
      where: { id, workspaceId },
      select: { leadId: true, url: true, domain: true },
    });

    if (!existing) {
      return reply.status(404).send({ error: 'Analysis not found' });
    }

    const analysis = await enqueueWebsiteAnalysis(
      workspaceId,
      existing.leadId,
      existing.url,
      existing.domain,
      { forceRescan: true },
    );

    return reply.status(202).send({ analysisId: analysis.id });
  });

  app.get('/stats', async (request) => {
    const workspaceId = getWorkspaceId(request);

    const [totalAnalyzed, avgScores, priorityDistribution] = await Promise.all([
      prisma.websiteAnalysis.count({
        where: { workspaceId, status: 'COMPLETED' },
      }),
      prisma.websiteAnalysis.aggregate({
        where: { workspaceId, status: 'COMPLETED' },
        _avg: { websiteScore: true, opportunityScore: true },
      }),
      prisma.websiteAnalysis.groupBy({
        by: ['opportunityPriority'],
        where: { workspaceId, status: 'COMPLETED', opportunityPriority: { not: null } },
        _count: true,
      }),
    ]);

    return {
      totalAnalyzed,
      avgWebsiteScore: Math.round(avgScores._avg.websiteScore ?? 0),
      avgOpportunityScore: Math.round(avgScores._avg.opportunityScore ?? 0),
      priorityDistribution: Object.fromEntries(
        priorityDistribution.map((p) => [p.opportunityPriority, p._count]),
      ),
    };
  });
};

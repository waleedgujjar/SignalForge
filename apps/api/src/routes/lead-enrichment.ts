import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '@signalforge/database';
import {
  enrichLeadSchema,
  batchEnrichSchema,
  enrichmentQuerySchema,
  icpProfileSchema,
  serviceCatalogSchema,
} from '@signalforge/validation';
import { QUEUE_NAMES, ENRICHMENT_JOB_OPTIONS } from '@signalforge/queue';
import { requireWorkspaceGuard, getWorkspaceId } from '../plugins/auth.js';
import { getQueue } from '../queue-registry.js';

function getEnrichmentQueue() {
  return getQueue(QUEUE_NAMES.LEAD_ENRICHMENT);
}

export const leadEnrichmentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  // ─── Enrichment ─────────────────────────────────────────────────────────────

  app.post('/enrich', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const body = enrichLeadSchema.parse(request.body);

    const lead = await prisma.lead.findFirst({
      where: { id: body.leadId, workspaceId },
      select: { id: true },
    });
    if (!lead) return reply.status(404).send({ error: 'Lead not found' });

    let enrichment = await prisma.leadEnrichment.findUnique({
      where: { leadId: lead.id },
    });

    if (!enrichment) {
      try {
        enrichment = await prisma.leadEnrichment.create({
          data: { leadId: lead.id, workspaceId, status: 'QUEUED' },
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          enrichment = await prisma.leadEnrichment.findUnique({ where: { leadId: lead.id } });
          if (!enrichment) throw err;
        } else {
          throw err;
        }
      }
    }

    if (enrichment.status === 'COMPLETED' || enrichment.status === 'PARTIAL') {
      return reply.status(200).send({ enrichmentId: enrichment.id, status: enrichment.status, message: 'Already enriched' });
    } else {
      await prisma.leadEnrichment.update({
        where: { id: enrichment.id },
        data: { status: 'QUEUED' },
      });
    }

    const queue = getEnrichmentQueue();
    await queue.add('enrich-lead', {
      workspaceId,
      leadId: lead.id,
      enrichmentId: enrichment.id,
    }, ENRICHMENT_JOB_OPTIONS);

    return reply.status(202).send({ enrichmentId: enrichment.id, status: 'QUEUED' });
  });

  app.post('/enrich/batch', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const body = batchEnrichSchema.parse(request.body);

    const leads = await prisma.lead.findMany({
      where: { id: { in: body.leadIds }, workspaceId },
      select: { id: true },
    });
    const foundIds = new Set(leads.map(l => l.id));

    const existing = await prisma.leadEnrichment.findMany({
      where: { leadId: { in: body.leadIds }, workspaceId },
      select: { leadId: true, status: true },
    });
    const existingMap = new Map(existing.map(e => [e.leadId, e.status]));

    const toEnqueue: { leadId: string; enrichmentId: string }[] = [];
    const skipped: string[] = [];
    const alreadyEnriched: string[] = [];

    for (const leadId of body.leadIds) {
      if (!foundIds.has(leadId)) { skipped.push(leadId); continue; }
      const status = existingMap.get(leadId);
      if (status === 'COMPLETED' || status === 'PARTIAL') { alreadyEnriched.push(leadId); continue; }

      let enrichment;
      if (status) {
        enrichment = await prisma.leadEnrichment.findUnique({ where: { leadId } });
        if (enrichment) {
          await prisma.leadEnrichment.update({ where: { id: enrichment.id }, data: { status: 'QUEUED' } });
        }
      }
      if (!enrichment) {
        try {
          enrichment = await prisma.leadEnrichment.create({
            data: { leadId, workspaceId, status: 'QUEUED' },
          });
        } catch (err) {
          if ((err as { code?: string }).code === 'P2002') {
            enrichment = await prisma.leadEnrichment.findUnique({ where: { leadId } });
            if (!enrichment) throw err;
          } else {
            throw err;
          }
        }
      }
      toEnqueue.push({ leadId, enrichmentId: enrichment.id });
    }

    if (toEnqueue.length > 0) {
      const queue = getEnrichmentQueue();
      await Promise.all(toEnqueue.map(item =>
        queue.add('enrich-lead', {
          workspaceId,
          leadId: item.leadId,
          enrichmentId: item.enrichmentId,
        }, ENRICHMENT_JOB_OPTIONS),
      ));
    }

    return reply.send({
      queued: toEnqueue.length,
      skipped: skipped.length,
      alreadyEnriched: alreadyEnriched.length,
    });
  });

  app.get('/enrichments', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const query = enrichmentQuerySchema.parse(request.query);

    const where: Record<string, unknown> = { workspaceId };
    if (query.status) where['status'] = query.status;
    if (query.prospectPriority) where['prospectPriority'] = query.prospectPriority;
    if (query.minProspectScore != null || query.maxProspectScore != null) {
      const scoreFilter: Record<string, number> = {};
      if (query.minProspectScore != null) scoreFilter['gte'] = query.minProspectScore;
      if (query.maxProspectScore != null) scoreFilter['lte'] = query.maxProspectScore;
      where['prospectScore'] = scoreFilter;
    }

    const [enrichments, total] = await Promise.all([
      prisma.leadEnrichment.findMany({
        where,
        include: { lead: { select: { id: true, email: true, firstName: true, lastName: true, fullName: true, company: true } } },
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.leadEnrichment.count({ where }),
    ]);

    return {
      enrichments,
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  });

  app.get('/enrichments/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };

    const enrichment = await prisma.leadEnrichment.findUnique({
      where: { id },
      include: { lead: { select: { id: true, email: true, firstName: true, lastName: true, fullName: true, company: true, jobTitle: true } } },
    });

    if (!enrichment || enrichment.workspaceId !== workspaceId) {
      return reply.status(404).send({ error: 'Enrichment not found' });
    }

    return enrichment;
  });

  app.get('/lead/:leadId', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { leadId } = request.params as { leadId: string };

    const enrichment = await prisma.leadEnrichment.findUnique({
      where: { leadId },
    });

    if (!enrichment || enrichment.workspaceId !== workspaceId) {
      return reply.status(404).send({ error: 'Enrichment not found for this lead' });
    }

    return enrichment;
  });

  app.post('/retry/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };

    const enrichment = await prisma.leadEnrichment.findUnique({ where: { id } });
    if (!enrichment || enrichment.workspaceId !== workspaceId) {
      return reply.status(404).send({ error: 'Enrichment not found' });
    }
    if (enrichment.status !== 'FAILED' && enrichment.status !== 'PARTIAL') {
      return reply.status(400).send({ error: 'Only failed or partial enrichments can be retried' });
    }

    await prisma.leadEnrichment.update({
      where: { id },
      data: { status: 'QUEUED', errorMessage: null },
    });

    const queue = getEnrichmentQueue();
    await queue.add('enrich-lead', {
      workspaceId,
      leadId: enrichment.leadId,
      enrichmentId: enrichment.id,
      forceRefresh: true,
    }, ENRICHMENT_JOB_OPTIONS);

    return reply.status(202).send({ enrichmentId: id, status: 'QUEUED' });
  });

  app.get('/stats', async (request) => {
    const workspaceId = getWorkspaceId(request);

    const [total, statusCounts, priorityCounts, avgScores] = await Promise.all([
      prisma.leadEnrichment.count({ where: { workspaceId } }),
      prisma.leadEnrichment.groupBy({ by: ['status'], where: { workspaceId }, _count: true }),
      prisma.leadEnrichment.groupBy({ by: ['prospectPriority'], where: { workspaceId, prospectPriority: { not: null } }, _count: true }),
      prisma.leadEnrichment.aggregate({
        where: { workspaceId, status: { in: ['COMPLETED', 'PARTIAL'] } },
        _avg: { prospectScore: true, icpFitScore: true, leadQualityScore: true },
      }),
    ]);

    const statusDistribution: Record<string, number> = {};
    for (const s of statusCounts) statusDistribution[s.status] = s._count;

    const priorityDistribution: Record<string, number> = {};
    for (const p of priorityCounts) {
      if (p.prospectPriority) priorityDistribution[p.prospectPriority] = p._count;
    }

    return {
      total,
      statusDistribution,
      priorityDistribution,
      avgProspectScore: Math.round(avgScores._avg.prospectScore ?? 0),
      avgICPFitScore: Math.round(avgScores._avg.icpFitScore ?? 0),
      avgLeadQualityScore: Math.round(avgScores._avg.leadQualityScore ?? 0),
    };
  });

  // ─── ICP Profile ────────────────────────────────────────────────────────────

  app.get('/icp', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const profile = await prisma.iCPProfile.findUnique({ where: { workspaceId } });
    return profile ?? { targetIndustries: [], targetCountries: [], targetCompanySizes: [], targetJobTitles: [], targetSeniorities: [], targetKeywords: [], weights: { industry: 25, location: 15, companySize: 15, jobTitle: 25, seniority: 20 }, requireVerifiedEmail: false, minWebsiteScore: null, minOpportunityScore: null };
  });

  app.put('/icp', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const body = icpProfileSchema.parse(request.body);

    const profile = await prisma.iCPProfile.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        targetIndustries: JSON.parse(JSON.stringify(body.targetIndustries)),
        targetCountries: JSON.parse(JSON.stringify(body.targetCountries)),
        targetCompanySizes: JSON.parse(JSON.stringify(body.targetCompanySizes)),
        targetJobTitles: JSON.parse(JSON.stringify(body.targetJobTitles)),
        targetSeniorities: JSON.parse(JSON.stringify(body.targetSeniorities)),
        targetKeywords: JSON.parse(JSON.stringify(body.targetKeywords)),
        minWebsiteScore: body.minWebsiteScore ?? null,
        minOpportunityScore: body.minOpportunityScore ?? null,
        requireVerifiedEmail: body.requireVerifiedEmail,
        weights: JSON.parse(JSON.stringify(body.weights)),
      },
      update: {
        targetIndustries: JSON.parse(JSON.stringify(body.targetIndustries)),
        targetCountries: JSON.parse(JSON.stringify(body.targetCountries)),
        targetCompanySizes: JSON.parse(JSON.stringify(body.targetCompanySizes)),
        targetJobTitles: JSON.parse(JSON.stringify(body.targetJobTitles)),
        targetSeniorities: JSON.parse(JSON.stringify(body.targetSeniorities)),
        targetKeywords: JSON.parse(JSON.stringify(body.targetKeywords)),
        minWebsiteScore: body.minWebsiteScore ?? null,
        minOpportunityScore: body.minOpportunityScore ?? null,
        requireVerifiedEmail: body.requireVerifiedEmail,
        weights: JSON.parse(JSON.stringify(body.weights)),
      },
    });

    return profile;
  });

  // ─── Service Catalog ────────────────────────────────────────────────────────

  app.get('/services', async (request) => {
    const workspaceId = getWorkspaceId(request);
    return prisma.serviceCatalogEntry.findMany({
      where: { workspaceId },
      orderBy: { sortOrder: 'asc' },
    });
  });

  app.post('/services', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const body = serviceCatalogSchema.parse(request.body);

    return prisma.serviceCatalogEntry.create({
      data: {
        workspaceId,
        name: body.name,
        description: body.description ?? null,
        matchingSignals: JSON.parse(JSON.stringify(body.matchingSignals)),
        enabled: body.enabled,
        sortOrder: body.sortOrder,
      },
    });
  });

  app.put('/services/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const body = serviceCatalogSchema.partial().parse(request.body);

    const existing = await prisma.serviceCatalogEntry.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== workspaceId) {
      return reply.status(404).send({ error: 'Service not found' });
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData['name'] = body.name;
    if (body.description !== undefined) updateData['description'] = body.description;
    if (body.matchingSignals !== undefined) updateData['matchingSignals'] = JSON.parse(JSON.stringify(body.matchingSignals));
    if (body.enabled !== undefined) updateData['enabled'] = body.enabled;
    if (body.sortOrder !== undefined) updateData['sortOrder'] = body.sortOrder;

    return prisma.serviceCatalogEntry.update({ where: { id }, data: updateData });
  });

  app.delete('/services/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };

    const { count } = await prisma.serviceCatalogEntry.deleteMany({ where: { id, workspaceId } });
    if (count === 0) {
      return reply.status(404).send({ error: 'Service not found' });
    }

    return { success: true };
  });

  app.post('/services/seed', async (request) => {
    const workspaceId = getWorkspaceId(request);

    const defaults = [
      { name: 'Website Redesign', description: 'Full website redesign and development', matchingSignals: ['outdated design', 'poor mobile', 'low website score', 'modernity'] },
      { name: 'SEO Optimization', description: 'Search engine optimization services', matchingSignals: ['missing meta', 'no sitemap', 'no structured data', 'poor seo'] },
      { name: 'Lead Generation', description: 'Lead generation and conversion optimization', matchingSignals: ['no contact form', 'no CTA', 'low conversion', 'no lead form'] },
      { name: 'Digital Marketing', description: 'Comprehensive digital marketing strategy', matchingSignals: ['no social proof', 'no blog', 'poor content', 'no testimonials'] },
      { name: 'AI & Automation', description: 'AI chatbots, automation, and intelligent systems', matchingSignals: ['no chatbot', 'no AI assistant', 'manual processes', 'no scheduling'] },
    ];

    const results = [];
    for (let i = 0; i < defaults.length; i++) {
      const d = defaults[i]!;
      const entry = await prisma.serviceCatalogEntry.upsert({
        where: { workspaceId_name: { workspaceId, name: d.name } },
        create: {
          workspaceId,
          name: d.name,
          description: d.description,
          matchingSignals: JSON.parse(JSON.stringify(d.matchingSignals)),
          sortOrder: i,
        },
        update: {},
      });
      results.push(entry);
    }

    return results;
  });
};

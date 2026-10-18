import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '@signalforge/database';
import { publishWorkflowEvent } from '@signalforge/automations';
import {
  createLeadSchema,
  updateLeadSchema,
  leadListQuerySchema,
  bulkLeadActionSchema,
  bulkTagSchema,
  bulkListSchema,
  bulkStatusSchema,
  createTagSchema,
  updateTagSchema,
  createLeadListSchema,
  updateLeadListSchema,
  createLeadNoteSchema,
  csvImportSchema,
  leadTagAssignmentSchema,
  listMemberAddSchema,
} from '@signalforge/validation';
import { requireWorkspaceGuard, getWorkspaceId } from '../plugins/auth.js';
import { verificationJobService } from '@signalforge/verification';
import { isLinkedInResearchEnabled, leadResearchService } from '@signalforge/lead-research';
import { isPlaceholderEmail } from '@signalforge/lead-discovery';
import { processImportRows, executeImportRows } from '../services/lead-import-processor.js';

const LEAD_INCLUDE = {
  verification: true,
  campaignLeads: {
    include: { campaign: { select: { id: true, name: true, status: true } } },
  },
  tags: { include: { tag: true } },
  listMembers: { include: { list: { select: { id: true, name: true } } } },
  enrichment: {
    select: { id: true, status: true, prospectScore: true, icpFitScore: true, prospectPriority: true, seniority: true },
  },
};

export const leadRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  // ─── Lead CRUD ──────────────────────────────────────────────────────────────

  app.post('/', async (request, reply) => {
    const body = createLeadSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);

    const lead = await prisma.lead.create({
      data: {
        workspaceId,
        email: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
        fullName:
          body.fullName ??
          ([body.firstName, body.lastName].filter(Boolean).join(' ') || undefined),
        company: body.company,
        companyDomain: body.companyDomain,
        jobTitle: body.jobTitle,
        industry: body.industry,
        phone: body.phone,
        linkedinUrl: body.linkedinUrl,
        countryCode: body.countryCode?.toUpperCase(),
        country: body.country,
        region: body.region,
        state: body.state,
        city: body.city,
        website: body.website,
        status: body.status ?? 'NEW',
        source: body.source ?? 'MANUAL',
        customFields: body.customFields ?? {},
      },
      include: LEAD_INCLUDE,
    });

    void publishWorkflowEvent({
      eventType: body.source === 'CSV_IMPORT' || body.source === 'GOOGLE_DRIVE' ? 'LEAD_IMPORTED' : 'LEAD_CREATED',
      workspaceId,
      leadId: lead.id,
      idempotencyKey: `lead-created:${lead.id}`,
      metadata: { source: lead.source, country: lead.country },
    }).catch(() => {});

    return reply.status(201).send(lead);
  });

  app.get('/', async (request) => {
    const query = leadListQuerySchema.parse(request.query);
    const workspaceId = getWorkspaceId(request);

    const where: Record<string, unknown> = { workspaceId };

    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;
    if (query.countryCode) where.countryCode = query.countryCode.toUpperCase();
    if (query.state)
      where.state = { contains: query.state, mode: 'insensitive' };
    if (query.city)
      where.city = { contains: query.city, mode: 'insensitive' };
    if (query.verificationStatus)
      where.verification = { status: query.verificationStatus };
    if (query.campaignId)
      where.campaignLeads = { some: { campaignId: query.campaignId } };
    if (query.tagId) where.tags = { some: { tagId: query.tagId } };
    if (query.listId)
      where.listMembers = { some: { listId: query.listId } };
    if (query.enrichmentStatus)
      where.enrichment = { ...((where.enrichment as Record<string, unknown>) ?? {}), status: query.enrichmentStatus };
    if (query.prospectPriority)
      where.enrichment = { ...((where.enrichment as Record<string, unknown>) ?? {}), prospectPriority: query.prospectPriority };
    if (query.minProspectScore != null)
      where.enrichment = { ...((where.enrichment as Record<string, unknown>) ?? {}), prospectScore: { gte: query.minProspectScore } };
    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: 'insensitive' } },
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { company: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
        { website: { contains: query.search, mode: 'insensitive' } },
        { companyDomain: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const orderBy = query.sortBy === 'prospectScore'
      ? { enrichment: { prospectScore: query.sortOrder } }
      : { [query.sortBy]: query.sortOrder };

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy,
        include: LEAD_INCLUDE,
      }),
      prisma.lead.count({ where }),
    ]);

    return {
      data: leads,
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

    const lead = await prisma.lead.findFirst({
      where: { id, workspaceId },
      include: {
        ...LEAD_INCLUDE,
        notes: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });

    if (!lead) return reply.status(404).send({ error: 'Lead not found' });
    return lead;
  });

  app.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const body = updateLeadSchema.parse(request.body);

    const existing = await prisma.lead.findFirst({
      where: { id, workspaceId },
    });
    if (!existing)
      return reply.status(404).send({ error: 'Lead not found' });

    const data: Record<string, unknown> = { ...body };
    if (body.countryCode) data.countryCode = body.countryCode.toUpperCase();
    if (body.firstName !== undefined || body.lastName !== undefined) {
      const fn = body.firstName ?? existing.firstName;
      const ln = body.lastName ?? existing.lastName;
      data.fullName = [fn, ln].filter(Boolean).join(' ') || null;
    }

    const lead = await prisma.lead.update({
      where: { id, workspaceId },
      data,
      include: LEAD_INCLUDE,
    });

    if (body.status === 'QUALIFIED' && existing.status !== 'QUALIFIED') {
      void publishWorkflowEvent({
        eventType: 'LEAD_QUALIFIED',
        workspaceId,
        leadId: lead.id,
        idempotencyKey: `lead-qualified:${lead.id}:${Date.now()}`,
      }).catch(() => {});
    }

    return lead;
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);

    const { count } = await prisma.lead.deleteMany({
      where: { id, workspaceId },
    });
    if (count === 0)
      return reply.status(404).send({ error: 'Lead not found' });

    return reply.status(204).send();
  });

  // ─── Bulk Operations ────────────────────────────────────────────────────────

  app.post('/bulk/delete', async (request) => {
    const { leadIds } = bulkLeadActionSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);

    const result = await prisma.lead.deleteMany({
      where: { id: { in: leadIds }, workspaceId },
    });

    return { deleted: result.count };
  });

  app.post('/bulk/tag', async (request) => {
    const { leadIds, tagIds } = bulkTagSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);

    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds }, workspaceId },
      select: { id: true },
    });
    const validLeadIds = leads.map((l) => l.id);

    const tags = await prisma.tag.findMany({
      where: { id: { in: tagIds }, workspaceId },
      select: { id: true },
    });
    const validTagIds = tags.map((t) => t.id);

    const data = validLeadIds.flatMap((leadId) =>
      validTagIds.map((tagId) => ({ leadId, tagId })),
    );

    await prisma.leadTag.createMany({ data, skipDuplicates: true });

    return { tagged: validLeadIds.length };
  });

  app.post('/bulk/list', async (request) => {
    const { leadIds, listId } = bulkListSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);

    const list = await prisma.leadList.findFirst({
      where: { id: listId, workspaceId },
    });
    if (!list)
      return { error: 'List not found' };

    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds }, workspaceId },
      select: { id: true },
    });

    const data = leads.map((l) => ({ listId, leadId: l.id }));
    await prisma.leadListMember.createMany({ data, skipDuplicates: true });

    return { added: leads.length };
  });

  app.post('/bulk/status', async (request) => {
    const { leadIds, status } = bulkStatusSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);

    const result = await prisma.lead.updateMany({
      where: { id: { in: leadIds }, workspaceId },
      data: { status },
    });

    if (status === 'QUALIFIED') {
      for (const leadId of leadIds) {
        void publishWorkflowEvent({
          eventType: 'LEAD_QUALIFIED',
          workspaceId,
          leadId,
          idempotencyKey: `lead-qualified-bulk:${leadId}:${Date.now()}`,
        }).catch(() => {});
      }
    }

    return { updated: result.count };
  });

  // ─── CSV Import ─────────────────────────────────────────────────────────────

  app.post('/import', async (request, _reply) => {
    const workspaceId = getWorkspaceId(request);
    const { rows, mappings, skipDuplicates, verifyOnImport } = csvImportSchema.parse(request.body);

    const unmappedColumns = rows[0]
      ? Object.keys(rows[0]).filter((h) => !Object.keys(mappings).includes(h))
      : [];

    const processResult = processImportRows(rows, mappings, unmappedColumns);
    const mergeStrategy = skipDuplicates !== false ? 'skip' : 'fill_missing';
    const researchEnabled = isLinkedInResearchEnabled();

    const { summary, createdLeadIds, researchInputs } = await executeImportRows({
      workspaceId,
      processedRows: processResult.processedRows,
      mergeStrategy,
      source: 'CSV_IMPORT',
      researchEnabled,
    });

    const results = {
      created: summary.created,
      skipped: summary.skipped + processResult.skipped,
      errors: processResult.errors.map((e) => `Row ${e.row}: ${e.message}`),
      researchSuggested: 0,
    };

    if (researchEnabled && researchInputs.length > 0) {
      try {
        results.researchSuggested = await leadResearchService.createSuggestions(
          researchInputs.map((r) => ({ workspaceId, ...r })),
        );
      } catch (err: unknown) {
        request.log.warn({ err }, 'Failed to create LinkedIn research suggestions from import');
      }
    }

    if (verifyOnImport && createdLeadIds.length > 0) {
      const leads = await prisma.lead.findMany({
        where: { id: { in: createdLeadIds } },
        select: { email: true },
      });
      const emails = leads
        .map((l) => l.email)
        .filter((email) => !isPlaceholderEmail(email));
      if (emails.length > 0) {
        void verificationJobService
          .createJob({
            workspaceId,
            source: 'LEADS',
            name: 'Import verification',
            emails,
          })
          .catch(() => {});
      }
    }

    return results;
  });

  // ─── CSV Export ─────────────────────────────────────────────────────────────

  app.get('/export', async (request, reply) => {
    const query = leadListQuerySchema.parse(request.query);
    const workspaceId = getWorkspaceId(request);

    const where: Record<string, unknown> = { workspaceId };
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;
    if (query.countryCode) where.countryCode = query.countryCode.toUpperCase();
    if (query.tagId) where.tags = { some: { tagId: query.tagId } };
    if (query.listId) where.listMembers = { some: { listId: query.listId } };
    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: 'insensitive' } },
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { company: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
        { website: { contains: query.search, mode: 'insensitive' } },
        { companyDomain: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: {
        verification: true,
        tags: { include: { tag: true } },
        websiteAnalyses: { take: 1, orderBy: { createdAt: 'desc' as const }, select: { websiteScore: true, opportunityScore: true, opportunityPriority: true, status: true, recommendedServices: true, aiPersonalizationHooks: true } },
        enrichment: { select: { icpFitScore: true, leadQualityScore: true, prospectScore: true, prospectPriority: true, status: true, seniority: true, aiSummary: true, recommendedServices: true, personalizationHooks: true, outreachAngles: true, painPointHypotheses: true } },
      },
    });

    const CSV_FIELDS = [
      'email', 'firstName', 'lastName', 'company', 'companyDomain', 'jobTitle',
      'industry', 'phone', 'linkedinUrl', 'countryCode', 'country', 'state',
      'city', 'website', 'status', 'source', 'verificationStatus', 'tags',
      'websiteScore', 'opportunityScore', 'opportunityPriority', 'websiteAnalysisStatus',
      'icpFitScore', 'leadQualityScore', 'prospectScore', 'prospectPriority',
      'enrichmentStatus', 'seniority', 'topRecommendedService', 'topPainPoint',
      'topPersonalizationHook', 'topOutreachAngle', 'aiSummary',
    ];

    const escape = (val: string | null | undefined) => {
      if (!val) return '';
      if (val.includes(',') || val.includes('"') || val.includes('\n'))
        return `"${val.replace(/"/g, '""')}"`;
      return val;
    };

    const csvRows = [CSV_FIELDS.join(',')];
    for (const lead of leads) {
      const tagNames = lead.tags.map((t) => t.tag.name).join(';');
      csvRows.push(
        CSV_FIELDS.map((f) => {
          if (f === 'verificationStatus')
            return escape(lead.verification?.status);
          if (f === 'tags') return escape(tagNames);
          const wa = lead.websiteAnalyses?.[0];
          if (f === 'websiteScore') return escape(wa?.websiteScore != null ? String(wa.websiteScore) : '');
          if (f === 'opportunityScore') return escape(wa?.opportunityScore != null ? String(wa.opportunityScore) : '');
          if (f === 'opportunityPriority') return escape(wa?.opportunityPriority ?? '');
          if (f === 'websiteAnalysisStatus') return escape(wa?.status ?? '');
          const en = lead.enrichment;
          if (f === 'icpFitScore') return escape(en?.icpFitScore != null ? String(en.icpFitScore) : '');
          if (f === 'leadQualityScore') return escape(en?.leadQualityScore != null ? String(en.leadQualityScore) : '');
          if (f === 'prospectScore') return escape(en?.prospectScore != null ? String(en.prospectScore) : '');
          if (f === 'prospectPriority') return escape(en?.prospectPriority ?? '');
          if (f === 'enrichmentStatus') return escape(en?.status ?? '');
          if (f === 'seniority') return escape(en?.seniority ?? '');
          if (f === 'aiSummary') return escape(en?.aiSummary ?? '');
          if (f === 'topRecommendedService') {
            const svcs = en?.recommendedServices as { service: string }[] | null;
            return escape(svcs?.[0]?.service ?? '');
          }
          if (f === 'topPainPoint') {
            const pains = en?.painPointHypotheses as { hypothesis: string }[] | null;
            return escape(pains?.[0]?.hypothesis ?? '');
          }
          if (f === 'topPersonalizationHook') {
            const hooks = en?.personalizationHooks as { angle: string }[] | null;
            return escape(hooks?.[0]?.angle ?? '');
          }
          if (f === 'topOutreachAngle') {
            const angles = en?.outreachAngles as { angle: string }[] | null;
            return escape(angles?.[0]?.angle ?? '');
          }
          return escape(String((lead as Record<string, unknown>)[f] ?? ''));
        }).join(','),
      );
    }

    reply.header('Content-Type', 'text/csv');
    reply.header(
      'Content-Disposition',
      `attachment; filename="leads-export.csv"`,
    );
    return csvRows.join('\n');
  });

  // ─── Tags ───────────────────────────────────────────────────────────────────

  app.get('/tags', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const tags = await prisma.tag.findMany({
      where: { workspaceId },
      include: { _count: { select: { leads: true } } },
      orderBy: { name: 'asc' },
    });
    return tags;
  });

  app.post('/tags', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const body = createTagSchema.parse(request.body);

    const tag = await prisma.tag.create({
      data: { workspaceId, name: body.name, color: body.color ?? '#2563EB' },
      include: { _count: { select: { leads: true } } },
    });

    return reply.status(201).send(tag);
  });

  app.patch('/tags/:tagId', async (request, reply) => {
    const { tagId } = request.params as { tagId: string };
    const workspaceId = getWorkspaceId(request);
    const body = updateTagSchema.parse(request.body);

    const existing = await prisma.tag.findFirst({
      where: { id: tagId, workspaceId },
    });
    if (!existing)
      return reply.status(404).send({ error: 'Tag not found' });

    const tag = await prisma.tag.update({
      where: { id: tagId, workspaceId },
      data: body,
      include: { _count: { select: { leads: true } } },
    });

    return tag;
  });

  app.delete('/tags/:tagId', async (request, reply) => {
    const { tagId } = request.params as { tagId: string };
    const workspaceId = getWorkspaceId(request);

    const { count } = await prisma.tag.deleteMany({
      where: { id: tagId, workspaceId },
    });
    if (count === 0)
      return reply.status(404).send({ error: 'Tag not found' });

    return reply.status(204).send();
  });

  // Lead-Tag assignment
  app.post('/:id/tags', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const { tagIds } = leadTagAssignmentSchema.parse(request.body);

    const lead = await prisma.lead.findFirst({ where: { id, workspaceId } });
    if (!lead) return reply.status(404).send({ error: 'Lead not found' });

    const tags = await prisma.tag.findMany({
      where: { id: { in: tagIds }, workspaceId },
    });

    await prisma.leadTag.createMany({
      data: tags.map((t) => ({ leadId: id, tagId: t.id })),
      skipDuplicates: true,
    });

    return { added: tags.length };
  });

  app.delete('/:id/tags/:tagId', async (request, reply) => {
    const { id, tagId } = request.params as { id: string; tagId: string };
    const workspaceId = getWorkspaceId(request);

    const lead = await prisma.lead.findFirst({ where: { id, workspaceId } });
    if (!lead) return reply.status(404).send({ error: 'Lead not found' });

    await prisma.leadTag.deleteMany({ where: { leadId: id, tagId } });
    return reply.status(204).send();
  });

  // ─── Lists ──────────────────────────────────────────────────────────────────

  app.get('/lists', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const lists = await prisma.leadList.findMany({
      where: { workspaceId },
      include: { _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
      take: 200,
    });
    return lists;
  });

  app.post('/lists', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const body = createLeadListSchema.parse(request.body);

    const list = await prisma.leadList.create({
      data: { workspaceId, name: body.name, description: body.description },
      include: { _count: { select: { members: true } } },
    });

    return reply.status(201).send(list);
  });

  app.patch('/lists/:listId', async (request, reply) => {
    const { listId } = request.params as { listId: string };
    const workspaceId = getWorkspaceId(request);
    const body = updateLeadListSchema.parse(request.body);

    const existing = await prisma.leadList.findFirst({
      where: { id: listId, workspaceId },
    });
    if (!existing)
      return reply.status(404).send({ error: 'List not found' });

    const list = await prisma.leadList.update({
      where: { id: listId, workspaceId },
      data: body,
      include: { _count: { select: { members: true } } },
    });

    return list;
  });

  app.delete('/lists/:listId', async (request, reply) => {
    const { listId } = request.params as { listId: string };
    const workspaceId = getWorkspaceId(request);

    const { count } = await prisma.leadList.deleteMany({
      where: { id: listId, workspaceId },
    });
    if (count === 0)
      return reply.status(404).send({ error: 'List not found' });

    return reply.status(204).send();
  });

  // List membership
  app.post('/lists/:listId/members', async (request, reply) => {
    const { listId } = request.params as { listId: string };
    const workspaceId = getWorkspaceId(request);
    const { leadIds } = listMemberAddSchema.parse(request.body);

    const list = await prisma.leadList.findFirst({
      where: { id: listId, workspaceId },
    });
    if (!list) return reply.status(404).send({ error: 'List not found' });

    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds }, workspaceId },
      select: { id: true },
    });

    await prisma.leadListMember.createMany({
      data: leads.map((l) => ({ listId, leadId: l.id })),
      skipDuplicates: true,
    });

    return { added: leads.length };
  });

  app.delete('/lists/:listId/members/:leadId', async (request, reply) => {
    const { listId, leadId } = request.params as {
      listId: string;
      leadId: string;
    };
    const workspaceId = getWorkspaceId(request);

    const list = await prisma.leadList.findFirst({
      where: { id: listId, workspaceId },
    });
    if (!list) return reply.status(404).send({ error: 'List not found' });

    await prisma.leadListMember.deleteMany({ where: { listId, leadId } });
    return reply.status(204).send();
  });

  // ─── Notes ──────────────────────────────────────────────────────────────────

  app.get('/:id/notes', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);

    const lead = await prisma.lead.findFirst({ where: { id, workspaceId } });
    if (!lead) return reply.status(404).send({ error: 'Lead not found' });

    const notes = await prisma.leadNote.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
    });

    return notes;
  });

  app.post('/:id/notes', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const { content } = createLeadNoteSchema.parse(request.body);

    const lead = await prisma.lead.findFirst({ where: { id, workspaceId } });
    if (!lead) return reply.status(404).send({ error: 'Lead not found' });

    const note = await prisma.leadNote.create({
      data: {
        leadId: id,
        workspaceId,
        authorId: request.user!.userId,
        content,
      },
    });

    return reply.status(201).send(note);
  });

  app.delete('/:id/notes/:noteId', async (request, reply) => {
    const { id, noteId } = request.params as { id: string; noteId: string };
    const workspaceId = getWorkspaceId(request);

    const { count } = await prisma.leadNote.deleteMany({
      where: { id: noteId, leadId: id, workspaceId },
    });
    if (count === 0) return reply.status(404).send({ error: 'Note not found' });

    return reply.status(204).send();
  });
};

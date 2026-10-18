import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { loadEnv } from '@signalforge/config';
import { prisma } from '@signalforge/database';
import type { Prisma } from '@signalforge/database';
import { campaignLeadService } from '@signalforge/campaigns';
import {
  AdapterNotAvailableError,
  AdapterNotConfiguredError,
  DISCOVERED_LEAD_EXPORT_COLUMNS,
  InvalidDiscoveryRequestError,
  isFileBased,
  listSources,
  logDiscoveryActivity,
  promoteDiscoveredLeads,
  requalifyLeads,
  toCsv,
  toXlsx,
  type DiscoveredLeadExportRow,
} from '@signalforge/lead-discovery';
import { buildLeadImportMappingsRecord, detectLeadImportMappings, parseFileStream } from '@signalforge/integrations';
import {
  QUEUE_NAMES,
  BULK_ENROLLMENT_THRESHOLD,
  createQueue,
  createRedisConnection,
  enqueueLeadDiscovery,
  enqueueCampaignEnrollment,
  type LeadDiscoveryQueuePayload,
  type CampaignEnrollmentQueuePayload,
} from '@signalforge/queue';
import {
  createDiscoveryJobSchema,
  discoveryExportQuerySchema,
  discoveryImportPreviewSchema,
  discoveryJobListQuerySchema,
  discoveryResultsQuerySchema,
  enrollDiscoveredLeadsSchema,
  saveDiscoveredLeadsSchema,
  updateLeadSourceConfigSchema,
} from '@signalforge/validation';
import { Readable } from 'node:stream';

import { getWorkspaceId, requireWorkspaceGuard, requireWorkspaceRole } from '../plugins/auth.js';

function getDiscoveryQueue() {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);
  return createQueue<LeadDiscoveryQueuePayload>(QUEUE_NAMES.LEAD_DISCOVERY, connection);
}

/// Local error mapper, matching the per-route convention used across this API.
function handleDiscoveryError(error: unknown, reply: FastifyReply) {
  if (error instanceof AdapterNotConfiguredError) return reply.status(400).send({ error: error.message });
  if (error instanceof AdapterNotAvailableError) return reply.status(501).send({ error: error.message });
  if (error instanceof InvalidDiscoveryRequestError) return reply.status(400).send({ error: error.message });
  if (error instanceof Error && error.name === 'ZodError') {
    return reply.status(400).send({ error: 'Validation failed', issues: (error as { issues?: unknown }).issues });
  }
  if (error instanceof Error) return reply.status(400).send({ error: error.message });
  return reply.status(500).send({ error: 'Internal server error' });
}

function getActorUserId(request: { user?: { userId?: string } }): string | undefined {
  return request.user?.userId;
}

/// Uploads arrive base64-encoded in JSON. Fastify's bodyLimit is 12MB, so the
/// decoded ceiling is well under the 50MB the parser allows.
function decodeFile(file: { data: string; mimeType: string }): Buffer {
  const buffer = Buffer.from(file.data, 'base64');
  if (buffer.length === 0) throw new InvalidDiscoveryRequestError('Uploaded file is empty');
  return buffer;
}


export const leadDiscoveryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  // ── Sources ───────────────────────────────────────────────────────────────

  app.get('/sources', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const configs = await prisma.leadSourceConfig.findMany({ where: { workspaceId } });
    const bySource = new Map(configs.map((c) => [c.source, c]));

    return {
      data: listSources().map((descriptor) => {
        const config = bySource.get(descriptor.source);
        return {
          ...descriptor,
          // File sources are always on: they are the zero-cost path and must
          // never be switched off by configuration.
          enabled: descriptor.fileBased ? true : (config?.enabled ?? false),
          usage: config
            ? {
                requestCount: config.requestCount,
                successfulRequests: config.successfulRequests,
                failedRequests: config.failedRequests,
                resultCount: config.resultCount,
                periodStart: config.periodStart,
                lastUsedAt: config.lastUsedAt,
              }
            : null,
        };
      }),
    };
  });

  app.put('/sources', { preHandler: requireWorkspaceRole('ADMIN').preHandler }, async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request);
      const body = updateLeadSourceConfigSchema.parse(request.body);

      const config = await prisma.leadSourceConfig.upsert({
        where: { workspaceId_source: { workspaceId, source: body.source } },
        create: { workspaceId, source: body.source, enabled: body.enabled },
        update: { enabled: body.enabled },
      });

      await logDiscoveryActivity({
        workspaceId,
        actorUserId: getActorUserId(request),
        type: 'SOURCE_CONFIG_UPDATED',
        summary: `${body.source} ${body.enabled ? 'enabled' : 'disabled'}`,
      });

      return config;
    } catch (error) {
      return handleDiscoveryError(error, reply);
    }
  });

  // ── Import preview (column mapping) ───────────────────────────────────────

  app.post('/import/preview', async (request, reply) => {
    try {
      const body = discoveryImportPreviewSchema.parse(request.body);
      const parsed = await parseFileStream(Readable.from(decodeFile(body)), body.mimeType, {
        previewOnly: true,
        maxRows: 10,
        filename: body.filename,
      });

      const mappingResult = detectLeadImportMappings(parsed.headers, parsed.rows);
      return {
        headers: parsed.headers,
        rows: parsed.rows,
        totalRowCount: parsed.totalRowCount,
        detectedMappings: mappingResult.mappings,
        mappings: buildLeadImportMappingsRecord(mappingResult),
        unmappedColumns: mappingResult.unmappedColumns,
      };
    } catch (error) {
      return handleDiscoveryError(error, reply);
    }
  });

  // ── Jobs ──────────────────────────────────────────────────────────────────

  app.post('/jobs', async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request);
      const actorUserId = getActorUserId(request);
      if (!actorUserId) return reply.status(401).send({ error: 'Authentication required' });

      const body = createDiscoveryJobSchema.parse(request.body);

      if (isFileBased(body.source) && !body.file) {
        return reply.status(400).send({ error: 'A CSV or XLSX file is required for this source' });
      }
      if (body.file) decodeFile(body.file);

      const job = await prisma.leadDiscoveryJob.create({
        data: {
          workspaceId,
          initiatedByUserId: actorUserId,
          source: body.source,
          name: body.name ?? null,
          query: body.query as unknown as Prisma.InputJsonValue,
          filters: { minScore: body.query.minScore } as Prisma.InputJsonValue,
          requestedCount: body.query.maxResults,
          status: 'PENDING',
        },
      });

      await logDiscoveryActivity({
        workspaceId,
        jobId: job.id,
        actorUserId,
        type: 'CREATED',
        summary: `Discovery job created for ${body.source}`,
        metadata: { maxResults: body.query.maxResults },
      });

      // The request returns immediately; all work happens in the worker so a
      // 500-lead search never blocks an HTTP connection.
      await enqueueLeadDiscovery(getDiscoveryQueue(), {
        workspaceId,
        jobId: job.id,
        file: body.file,
      });

      return reply.status(202).send({ jobId: job.id, status: job.status });
    } catch (error) {
      return handleDiscoveryError(error, reply);
    }
  });

  app.get('/jobs', async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request);
      const query = discoveryJobListQuerySchema.parse(request.query ?? {});

      const where: Prisma.LeadDiscoveryJobWhereInput = { workspaceId };
      if (query.status) where.status = query.status;
      if (query.source) where.source = query.source;

      const [jobs, total] = await Promise.all([
        prisma.leadDiscoveryJob.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.leadDiscoveryJob.count({ where }),
      ]);

      return {
        data: jobs,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      };
    } catch (error) {
      return handleDiscoveryError(error, reply);
    }
  });

  app.get('/jobs/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };

    // findFirst with workspaceId is the tenant guard used throughout this API.
    const job = await prisma.leadDiscoveryJob.findFirst({ where: { id, workspaceId } });
    if (!job) return reply.status(404).send({ error: 'Discovery job not found' });

    return job;
  });

  app.post('/jobs/:id/cancel', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };

    const job = await prisma.leadDiscoveryJob.findFirst({ where: { id, workspaceId } });
    if (!job) return reply.status(404).send({ error: 'Discovery job not found' });
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
      return reply.status(409).send({ error: `Job is already ${job.status.toLowerCase()}` });
    }

    const updated = await prisma.leadDiscoveryJob.update({
      where: { id: job.id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });

    await logDiscoveryActivity({
      workspaceId,
      jobId: job.id,
      actorUserId: getActorUserId(request),
      type: 'CANCELLED',
      summary: 'Discovery job cancelled',
    });

    return updated;
  });

  app.post('/jobs/:id/retry', async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request);
      const { id } = request.params as { id: string };

      const job = await prisma.leadDiscoveryJob.findFirst({ where: { id, workspaceId } });
      if (!job) return reply.status(404).send({ error: 'Discovery job not found' });
      if (job.status === 'RUNNING') {
        return reply.status(409).send({ error: 'Job is still running' });
      }

      await prisma.leadDiscoveryJob.update({
        where: { id: job.id },
        data: { status: 'PENDING', error: null, completedAt: null },
      });

      await logDiscoveryActivity({
        workspaceId,
        jobId: job.id,
        actorUserId: getActorUserId(request),
        type: 'RETRIED',
        summary: 'Discovery job retried',
      });

      // A distinct jobId, because the deterministic default would collide with
      // the original run and BullMQ would silently drop the retry.
      await enqueueLeadDiscovery(
        getDiscoveryQueue(),
        { workspaceId, jobId: job.id },
        { jobId: `discovery-${job.id}-retry-${Date.now()}` },
      );

      return reply.status(202).send({ jobId: job.id, status: 'PENDING' });
    } catch (error) {
      return handleDiscoveryError(error, reply);
    }
  });

  app.get('/jobs/:id/activity', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };

    const job = await prisma.leadDiscoveryJob.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!job) return reply.status(404).send({ error: 'Discovery job not found' });

    const activities = await prisma.leadDiscoveryActivity.findMany({
      where: { workspaceId, jobId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return { data: activities };
  });

  // ── Results ───────────────────────────────────────────────────────────────

  function buildResultsWhere(
    workspaceId: string,
    jobId: string,
    query: ReturnType<typeof discoveryResultsQuerySchema.parse>,
  ): Prisma.DiscoveredLeadWhereInput {
    const where: Prisma.DiscoveredLeadWhereInput = { workspaceId, jobId };

    if (query.qualified !== undefined) where.qualified = query.qualified;
    if (query.isDuplicate !== undefined) where.isDuplicate = query.isDuplicate;
    if (query.stage) where.stage = query.stage;
    if (query.emailStatus) where.emailStatus = query.emailStatus;
    if (query.country) where.country = query.country;
    if (query.state) where.state = query.state;
    if (query.city) where.city = query.city;
    if (query.industry) where.industry = query.industry;
    if (query.minScore !== undefined) where.icpFitScore = { gte: query.minScore };
    if (query.hasEmail !== undefined) where.normalizedEmail = query.hasEmail ? { not: null } : null;
    if (query.hasWebsite !== undefined) where.normalizedDomain = query.hasWebsite ? { not: null } : null;
    if (query.hasPhone !== undefined) where.normalizedPhone = query.hasPhone ? { not: null } : null;
    if (query.search) {
      where.OR = [
        { company: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { normalizedDomain: { contains: query.search, mode: 'insensitive' } },
        { fullName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  app.get('/jobs/:id/results', async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request);
      const { id } = request.params as { id: string };
      const query = discoveryResultsQuerySchema.parse(request.query ?? {});

      const job = await prisma.leadDiscoveryJob.findFirst({ where: { id, workspaceId }, select: { id: true } });
      if (!job) return reply.status(404).send({ error: 'Discovery job not found' });

      const where = buildResultsWhere(workspaceId, id, query);

      const [results, total] = await Promise.all([
        prisma.discoveredLead.findMany({
          where,
          orderBy: { [query.sortBy]: query.sortOrder },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.discoveredLead.count({ where }),
      ]);

      return {
        data: results,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      };
    } catch (error) {
      return handleDiscoveryError(error, reply);
    }
  });

  app.get('/jobs/:id/export', async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request);
      const { id } = request.params as { id: string };
      const query = discoveryExportQuerySchema.parse(request.query ?? {});

      const job = await prisma.leadDiscoveryJob.findFirst({ where: { id, workspaceId } });
      if (!job) return reply.status(404).send({ error: 'Discovery job not found' });

      const rows = await prisma.discoveredLead.findMany({
        where: { workspaceId, jobId: id, ...(query.qualified !== undefined ? { qualified: query.qualified } : {}) },
        orderBy: { icpFitScore: 'desc' },
        take: 10_000,
      });

      await logDiscoveryActivity({
        workspaceId,
        jobId: id,
        actorUserId: getActorUserId(request),
        type: 'LEADS_EXPORTED',
        summary: `Exported ${rows.length} discovered lead(s) as ${query.format.toUpperCase()}`,
      });

      const exportRows = rows as unknown as DiscoveredLeadExportRow[];

      if (query.format === 'xlsx') {
        const buffer = await toXlsx(exportRows, DISCOVERED_LEAD_EXPORT_COLUMNS, 'Discovered Leads');
        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        reply.header('Content-Disposition', `attachment; filename="discovery-${id}.xlsx"`);
        return reply.send(buffer);
      }

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="discovery-${id}.csv"`);
      return reply.send(toCsv(exportRows, DISCOVERED_LEAD_EXPORT_COLUMNS));
    } catch (error) {
      return handleDiscoveryError(error, reply);
    }
  });

  // ── Requalification ──────────────────────────────────────────────────────

  app.post('/jobs/:id/requalify', { preHandler: requireWorkspaceRole('ADMIN').preHandler }, async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request);
      const { id } = request.params as { id: string };

      const job = await prisma.leadDiscoveryJob.findFirst({ where: { id, workspaceId }, select: { id: true } });
      if (!job) return reply.status(404).send({ error: 'Discovery job not found' });

      const result = await requalifyLeads({ workspaceId, jobId: id });

      await logDiscoveryActivity({
        workspaceId,
        jobId: id,
        actorUserId: getActorUserId(request),
        type: 'REQUALIFIED',
        summary: `Requalified ${result.requalified} lead(s): ${result.newlyQualified} newly qualified, ${result.newlyDisqualified} newly disqualified`,
        metadata: result as unknown as Record<string, unknown>,
      });

      return result;
    } catch (error) {
      return handleDiscoveryError(error, reply);
    }
  });

  // ── Saving and campaign enrollment ────────────────────────────────────────

  app.post('/jobs/:id/save', async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request);
      const { id } = request.params as { id: string };
      const body = saveDiscoveredLeadsSchema.parse(request.body);

      const result = await promoteDiscoveredLeads({
        workspaceId,
        discoveredLeadIds: body.discoveredLeadIds,
        actorUserId: getActorUserId(request),
        jobId: id,
      });

      await prisma.leadDiscoveryJob.update({
        where: { id },
        data: { promotedCount: { increment: result.promoted } },
      });

      return result;
    } catch (error) {
      return handleDiscoveryError(error, reply);
    }
  });

  app.post('/jobs/:id/enroll', async (request, reply) => {
    try {
      const workspaceId = getWorkspaceId(request);
      const { id } = request.params as { id: string };
      const body = enrollDiscoveredLeadsSchema.parse(request.body);
      const actorUserId = getActorUserId(request);

      const campaign = await prisma.campaign.findFirst({
        where: { id: body.campaignId, workspaceId },
        select: { id: true, name: true },
      });
      if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });

      // Promote first: enrollment operates on canonical Leads, and this is what
      // guarantees discovery cannot bypass the campaign safety rules below.
      const promotion = await promoteDiscoveredLeads({
        workspaceId,
        discoveredLeadIds: body.discoveredLeadIds,
        actorUserId,
        jobId: id,
      });

      if (promotion.leadIds.length === 0) {
        return reply.status(400).send({
          error: 'No leads could be saved — every selected row is missing an email address',
          skipped: promotion.skipped,
        });
      }

      if (promotion.leadIds.length > BULK_ENROLLMENT_THRESHOLD) {
        const env = loadEnv();
        const connection = createRedisConnection(env.REDIS_URL);
        const queue = createQueue<CampaignEnrollmentQueuePayload>(
          QUEUE_NAMES.CAMPAIGN_ENROLLMENT,
          connection,
        );
        const job = await enqueueCampaignEnrollment(queue, {
          workspaceId,
          campaignId: campaign.id,
          leadIds: promotion.leadIds,
          actorUserId,
          force: body.force,
          source: 'discovery',
          discoveryJobId: id,
          discoveredLeadIds: body.discoveredLeadIds,
        });

        await logDiscoveryActivity({
          workspaceId,
          jobId: id,
          actorUserId,
          type: 'LEADS_ENROLLED',
          summary: `Queued ${promotion.leadIds.length} lead(s) for enrollment into "${campaign.name}"`,
          metadata: { queued: true, jobId: job.id, campaignId: campaign.id },
        });

        return reply.status(202).send({
          promotion,
          enrollment: { queued: true, jobId: job.id, leadCount: promotion.leadIds.length },
        });
      }

      const enrollment = await campaignLeadService.enrollLeads(
        campaign.id,
        workspaceId,
        promotion.leadIds,
        { actorUserId, force: body.force },
      );

      await prisma.discoveredLead.updateMany({
        where: { workspaceId, id: { in: body.discoveredLeadIds }, promotedLeadId: { not: null } },
        data: { stage: 'CAMPAIGN_ENROLLED' },
      });

      await logDiscoveryActivity({
        workspaceId,
        jobId: id,
        actorUserId,
        type: 'LEADS_ENROLLED',
        summary: `Enrolled ${enrollment.enrolled} lead(s) into "${campaign.name}"`,
        metadata: { skipped: enrollment.skipped, campaignId: campaign.id },
      });

      return { promotion, enrollment };
    } catch (error) {
      return handleDiscoveryError(error, reply);
    }
  });
};

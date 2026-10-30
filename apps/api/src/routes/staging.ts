import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { prisma, type Prisma, type StagedLeadStatus } from '@signalforge/database';
import { streamParseFile, resolveImportMimeType, FileParseError } from '@signalforge/integrations';
import {
  STAGING_FIELDS,
  detectStagingMappings,
  buildStagedLeadData,
  buildStagedLeadWhere,
  UNCATEGORIZED,
  toCsv,
  toXlsx,
  type StagingField,
  type StagedLeadFilter,
  type ExportColumn,
} from '@signalforge/lead-discovery';
import {
  QUEUE_NAMES,
  enqueueLeadProcessing,
  type LeadProcessingQueuePayload,
} from '@signalforge/queue';
import { requireWorkspaceOrUploadToken, getWorkspaceId } from '../plugins/auth.js';
import { getQueue } from '../queue-registry.js';

const IMPORT_DIR = process.env.IMPORT_DATA_DIR ?? join(tmpdir(), 'signalforge-imports');
const STAGING_DIR = () => join(IMPORT_DIR, 'staging');
const PREVIEW_SAMPLE_ROWS = 200;
const STAGED_STATUSES: StagedLeadStatus[] = ['UNIQUE', 'DUPLICATE', 'REVIEW', 'INVALID'];

function getUserId(request: { user?: { userId?: string } }): string {
  return request.user?.userId ?? 'unknown';
}

function sanitizeFileName(name: string): string {
  return (name || 'upload').replace(/[^\w.-]+/g, '_').slice(0, 120) || 'upload';
}

function sanitizeMappings(raw: unknown): Record<string, StagingField> | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('mappings must be an object');
  const result: Record<string, StagingField> = {};
  for (const [header, field] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof field !== 'string') throw new Error('mapping values must be strings');
    if ((STAGING_FIELDS as readonly string[]).includes(field)) {
      result[header] = field as StagingField;
    }
  }
  return result;
}

function parseFilter(query: Record<string, unknown>): StagedLeadFilter {
  const filter: StagedLeadFilter = {};
  if (typeof query.status === 'string' && STAGED_STATUSES.includes(query.status as StagedLeadStatus)) {
    filter.status = query.status as StagedLeadStatus;
  }
  if (typeof query.category === 'string' && query.category) filter.category = query.category.slice(0, 80);
  if (query.hasEmail === 'true') filter.hasEmail = true;
  else if (query.hasEmail === 'false') filter.hasEmail = false;
  if (query.hasWebsite === 'true') filter.hasWebsite = true;
  else if (query.hasWebsite === 'false') filter.hasWebsite = false;
  if (typeof query.search === 'string' && query.search.trim()) filter.search = query.search.trim().slice(0, 200);
  return filter;
}

function getProcessingQueue() {
  return getQueue<LeadProcessingQueuePayload>(QUEUE_NAMES.LEAD_PROCESSING);
}

async function findDataset(id: string, workspaceId: string) {
  return prisma.stagingDataset.findFirst({ where: { id, workspaceId } });
}

export const stagingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceOrUploadToken().preHandler);

  // Upload a dataset file: streams to the shared volume, samples rows for
  // column detection, records a PENDING dataset. One upload for the whole flow.
  app.post('/datasets', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    await mkdir(STAGING_DIR(), { recursive: true });
    const token = randomUUID();
    const fileName = data.filename || 'upload';
    const filePath = join(STAGING_DIR(), `${token}__${sanitizeFileName(fileName)}`);

    try {
      await pipeline(data.file, createWriteStream(filePath));
    } catch {
      await unlink(filePath).catch(() => {});
      return reply.status(400).send({ error: 'Upload failed. Please try again.' });
    }
    if (data.file.truncated) {
      await unlink(filePath).catch(() => {});
      return reply.status(413).send({ error: 'File exceeds the maximum upload size (150 MB).' });
    }

    const mimeType = resolveImportMimeType(data.mimetype, fileName);

    let headers: string[] = [];
    const sampleRows: Record<string, string>[] = [];
    try {
      await streamParseFile(
        filePath,
        mimeType,
        {
          batchSize: PREVIEW_SAMPLE_ROWS,
          maxRows: PREVIEW_SAMPLE_ROWS,
          stopAtMaxRows: true,
          onHeaders: (hs) => {
            headers = hs;
          },
          onBatch: async (rows) => {
            for (const r of rows) if (sampleRows.length < PREVIEW_SAMPLE_ROWS) sampleRows.push(r);
          },
        },
        fileName,
      );
    } catch (err) {
      await unlink(filePath).catch(() => {});
      if (err instanceof FileParseError) return reply.status(400).send({ error: err.message });
      throw err;
    }

    if (sampleRows.length === 0) {
      await unlink(filePath).catch(() => {});
      return reply.status(400).send({ error: 'File contains no data rows' });
    }

    const mappings = detectStagingMappings(headers, sampleRows);

    // Preview of the first rows as they would be staged (mapped + categorized).
    const stagedSample = sampleRows.map((row, i) =>
      buildStagedLeadData(row, mappings, { datasetId: 'preview', workspaceId, sourceRow: i + 1 }),
    );
    const previewRows = stagedSample.slice(0, 20).map((staged) => ({
      username: staged.username ?? null,
      name: staged.name ?? null,
      category: staged.assignedCategory ?? null,
      website: staged.website ?? null,
      email: staged.email ?? null,
      phone: staged.phone ?? null,
    }));
    const sampleStats = {
      sampleSize: sampleRows.length,
      withEmail: stagedSample.filter((s) => s.normalizedEmail).length,
      withWebsite: stagedSample.filter((s) => s.website).length,
      invalid: stagedSample.filter((s) => s.status === 'INVALID').length,
    };

    const dataset = await prisma.stagingDataset.create({
      data: {
        workspaceId,
        name: fileName.replace(/\.[^.]+$/, '').slice(0, 120) || fileName,
        sourceFileName: fileName,
        sourceFileSize: data.file.bytesRead,
        mimeType,
        status: 'PENDING',
        initiatedByUserId: getUserId(request),
        columnMappings: mappings as unknown as Prisma.InputJsonValue,
        config: { filePath, headers } as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      datasetId: dataset.id,
      headers,
      detectedMappings: mappings,
      previewRows,
      sampleStats,
    };
  });

  // Start (or retry) background processing for an uploaded dataset.
  app.post('/datasets/:id/start', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { mappings?: unknown; aiCategorization?: unknown };

    let mappings: Record<string, StagingField> | undefined;
    try {
      mappings = sanitizeMappings(body.mappings);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid mappings' });
    }

    const dataset = await findDataset(id, workspaceId);
    if (!dataset) return reply.status(404).send({ error: 'Dataset not found' });
    const config = (dataset.config ?? {}) as { filePath?: string };
    if (!config.filePath) {
      return reply.status(400).send({ error: 'The uploaded file is no longer available. Please re-upload.' });
    }

    // Atomic gate: only one processing run at a time; a COMPLETED dataset that
    // already transferred rows must not be wiped by a silent reprocess.
    const gated = await prisma.stagingDataset.updateMany({
      where: { id, workspaceId, status: { in: ['PENDING', 'FAILED', 'CANCELLED'] } },
      data: { status: 'SCANNING' },
    });
    if (gated.count !== 1) {
      return reply.status(409).send({
        error:
          dataset.status === 'COMPLETED'
            ? 'This dataset has already been processed. Upload it again to reprocess.'
            : 'This dataset is already being processed.',
      });
    }

    const effectiveMappings =
      mappings && Object.keys(mappings).length > 0
        ? mappings
        : ((dataset.columnMappings as Record<string, string> | null) ?? undefined);

    const aiCategorization = body.aiCategorization === true;
    const queue = getProcessingQueue();
    await enqueueLeadProcessing(queue, {
      kind: 'process-dataset',
      datasetId: id,
      workspaceId,
      filePath: config.filePath,
      fileName: dataset.sourceFileName,
      mimeType: dataset.mimeType ?? 'text/csv',
      mappings: effectiveMappings,
      aiCategorization,
    });

    await prisma.stagingDataset.update({
      where: { id },
      data: {
        columnMappings: (effectiveMappings ?? {}) as unknown as Prisma.InputJsonValue,
        config: { ...config, aiCategorization } as unknown as Prisma.InputJsonValue,
      },
    });

    return reply.status(202).send({ datasetId: id });
  });

  app.get('/datasets', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const datasets = await prisma.stagingDataset.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { data: datasets };
  });

  app.get('/datasets/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const dataset = await findDataset(id, workspaceId);
    if (!dataset) return reply.status(404).send({ error: 'Dataset not found' });
    return dataset;
  });

  app.get('/datasets/:id/progress', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const dataset = await prisma.stagingDataset.findFirst({
      where: { id, workspaceId },
      select: {
        status: true,
        totalRows: true,
        stagedCount: true,
        uniqueCount: true,
        duplicateCount: true,
        reviewCount: true,
        invalidCount: true,
        categorizedCount: true,
        importedCount: true,
        errorCount: true,
        completedAt: true,
      },
    });
    if (!dataset) return reply.status(404).send({ error: 'Dataset not found' });
    return dataset;
  });

  // Server-side pagination + filters over staged rows. Never ships whole datasets.
  app.get('/datasets/:id/leads', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, unknown>;
    const dataset = await findDataset(id, workspaceId);
    if (!dataset) return reply.status(404).send({ error: 'Dataset not found' });

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const where = buildStagedLeadWhere(id, parseFilter(query));

    const [total, rows] = await Promise.all([
      prisma.stagedLead.count({ where }),
      prisma.stagedLead.findMany({
        where,
        orderBy: { sourceRow: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: rows,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  });

  app.get('/datasets/:id/categories', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const dataset = await findDataset(id, workspaceId);
    if (!dataset) return reply.status(404).send({ error: 'Dataset not found' });

    const groups = await prisma.stagedLead.groupBy({
      by: ['assignedCategory'],
      where: { datasetId: id },
      _count: { _all: true },
      orderBy: { _count: { assignedCategory: 'desc' } },
    });
    return {
      data: groups.map((g) => ({
        category: g.assignedCategory ?? UNCATEGORIZED,
        count: g._count._all,
      })),
    };
  });

  // Bulk manual recategorization: explicit ids or the current filter.
  app.patch('/datasets/:id/leads/bulk', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as {
      ids?: unknown;
      filter?: Record<string, unknown>;
      category?: unknown;
    };
    const dataset = await findDataset(id, workspaceId);
    if (!dataset) return reply.status(404).send({ error: 'Dataset not found' });

    const category = typeof body.category === 'string' ? body.category.trim().slice(0, 60) : '';
    if (!category) return reply.status(400).send({ error: 'category is required' });

    const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === 'string') : [];
    const where: Prisma.StagedLeadWhereInput = ids.length
      ? { datasetId: id, id: { in: ids.slice(0, 10_000) } }
      : buildStagedLeadWhere(id, parseFilter(body.filter ?? {}));

    const updated = await prisma.stagedLead.updateMany({
      where,
      data: { assignedCategory: category, categoryConfidence: 1, categoryReason: 'manually assigned' },
    });

    const categorized = await prisma.stagedLead.count({
      where: { datasetId: id, assignedCategory: { not: UNCATEGORIZED }, NOT: { assignedCategory: null } },
    });
    await prisma.stagingDataset.update({ where: { id }, data: { categorizedCount: categorized } });

    return { updated: updated.count };
  });

  // Transfer staged rows into the regular Leads module. dryRun returns a preview.
  app.post('/datasets/:id/transfer', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as {
      ids?: unknown;
      filter?: Record<string, unknown>;
      mergeStrategy?: unknown;
      dryRun?: unknown;
    };
    const dataset = await findDataset(id, workspaceId);
    if (!dataset) return reply.status(404).send({ error: 'Dataset not found' });

    const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === 'string') : [];
    const filter = parseFilter(body.filter ?? {});
    const mergeStrategy = body.mergeStrategy === 'fill_missing' ? 'fill_missing' : 'skip';

    const baseWhere: Prisma.StagedLeadWhereInput = ids.length
      ? { datasetId: id, id: { in: ids.slice(0, 10_000) } }
      : buildStagedLeadWhere(id, filter);
    if (!ids.length && !filter.status) {
      baseWhere.status = { in: ['UNIQUE', 'REVIEW'] };
    }

    const [selected, importable, noEmail, alreadyImported] = await Promise.all([
      prisma.stagedLead.count({ where: baseWhere }),
      prisma.stagedLead.count({
        where: { ...baseWhere, importedLeadId: null, normalizedEmail: { not: null } },
      }),
      prisma.stagedLead.count({ where: { ...baseWhere, importedLeadId: null, normalizedEmail: null } }),
      prisma.stagedLead.count({ where: { ...baseWhere, importedLeadId: { not: null } } }),
    ]);

    if (body.dryRun === true) {
      const existingInLeads = await countExistingInLeads(workspaceId, {
        ...baseWhere,
        importedLeadId: null,
        normalizedEmail: { not: null },
      });
      return { selected, importable, noEmail, alreadyImported, existingInLeads };
    }

    if (importable === 0) {
      return reply.status(400).send({ error: 'Nothing to import: no selected rows have a valid email.' });
    }

    const leadImport = await prisma.leadImport.create({
      data: {
        workspaceId,
        source: 'CSV_IMPORT',
        status: 'PENDING',
        initiatedByUserId: getUserId(request),
        totalFiles: 1,
        totalRows: selected,
        importOptions: { stagingDatasetId: id, mergeStrategy } as unknown as Prisma.InputJsonValue,
        files: {
          create: {
            sourceFileId: `staging:${id}`,
            sourceFileName: `Large Lead Data: ${dataset.name}`,
            detectedRowCount: selected,
            status: 'PENDING',
          },
        },
      },
    });

    const queue = getProcessingQueue();
    await enqueueLeadProcessing(queue, {
      kind: 'transfer',
      datasetId: id,
      workspaceId,
      leadImportId: leadImport.id,
      mergeStrategy,
      stagedLeadIds: ids.length ? ids.slice(0, 10_000) : undefined,
      filter: ids.length
        ? undefined
        : {
            status: filter.status,
            category: filter.category,
            hasEmail: filter.hasEmail,
            hasWebsite: filter.hasWebsite,
            search: filter.search,
          },
      initiatedByUserId: getUserId(request),
    });

    return reply.status(202).send({ leadImportId: leadImport.id, selected, importable, noEmail, alreadyImported });
  });

  // Export the filtered rows as CSV or XLSX (token link bypasses the web proxy).
  app.get('/datasets/:id/export', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, unknown>;
    const dataset = await findDataset(id, workspaceId);
    if (!dataset) return reply.status(404).send({ error: 'Dataset not found' });

    const format = query.format === 'xlsx' ? 'xlsx' : 'csv';
    const where = buildStagedLeadWhere(id, parseFilter(query));

    type ExportRow = {
      username: string | null;
      name: string | null;
      bio: string | null;
      sourceCategory: string | null;
      category: string | null;
      confidence: number | null;
      website: string | null;
      email: string | null;
      phone: string | null;
      status: string;
      dedupReason: string | null;
    };
    const rows: ExportRow[] = [];
    let cursor: string | undefined;
    while (rows.length < 200_000) {
      const batch = await prisma.stagedLead.findMany({
        where,
        orderBy: { id: 'asc' },
        take: 5_000,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.id;
      for (const lead of batch) {
        rows.push({
          username: lead.username,
          name: lead.name,
          bio: lead.bio,
          sourceCategory: lead.category,
          category: lead.assignedCategory,
          confidence: lead.categoryConfidence,
          website: lead.website,
          email: lead.email,
          phone: lead.phone,
          status: lead.status,
          dedupReason: lead.dedupReason,
        });
      }
      if (batch.length < 5_000) break;
    }

    const columns: ExportColumn<ExportRow>[] = [
      { header: 'Username', value: (r) => r.username },
      { header: 'Name', value: (r) => r.name },
      { header: 'Bio', value: (r) => r.bio },
      { header: 'Original Category', value: (r) => r.sourceCategory },
      { header: 'Category', value: (r) => r.category },
      { header: 'Category Confidence', value: (r) => r.confidence },
      { header: 'Website', value: (r) => r.website },
      { header: 'Email', value: (r) => r.email },
      { header: 'Phone', value: (r) => r.phone },
      { header: 'Status', value: (r) => r.status },
      { header: 'Duplicate Reason', value: (r) => r.dedupReason },
    ];

    const safeName = sanitizeFileName(dataset.name || 'large-lead-data');
    if (format === 'xlsx') {
      const buffer = await toXlsx(rows, columns, 'Large Lead Data');
      void reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      void reply.header('Content-Disposition', `attachment; filename="${safeName}.xlsx"`);
      return reply.send(buffer);
    }
    void reply.header('Content-Type', 'text/csv; charset=utf-8');
    void reply.header('Content-Disposition', `attachment; filename="${safeName}.csv"`);
    return reply.send(toCsv(rows, columns));
  });

  app.delete('/datasets/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const dataset = await findDataset(id, workspaceId);
    if (!dataset) return reply.status(404).send({ error: 'Dataset not found' });

    const config = (dataset.config ?? {}) as { filePath?: string };
    await prisma.stagingDataset.delete({ where: { id } }); // cascades staged rows
    if (config.filePath) await unlink(config.filePath).catch(() => {});
    return reply.status(204).send();
  });
};

/** Approximate count of importable staged rows whose email already exists in Leads. */
async function countExistingInLeads(
  workspaceId: string,
  where: Prisma.StagedLeadWhereInput,
): Promise<number> {
  let existing = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.stagedLead.findMany({
      where,
      select: { id: true, normalizedEmail: true },
      orderBy: { id: 'asc' },
      take: 2_000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;
    const emails = [...new Set(batch.map((b) => b.normalizedEmail).filter((e): e is string => Boolean(e)))];
    if (emails.length > 0) {
      existing += await prisma.lead.count({ where: { workspaceId, email: { in: emails } } });
    }
    if (batch.length < 2_000) break;
  }
  return existing;
}

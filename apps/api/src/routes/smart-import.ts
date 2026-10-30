import { Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { prisma, type Prisma } from '@signalforge/database';
import {
  parseFileStream,
  streamParseFile,
  resolveImportMimeType,
  detectLeadImportMappings,
  buildLeadImportMappingsRecord,
  FileParseError,
} from '@signalforge/integrations';
import {
  QUEUE_NAMES,
  enqueueLeadImport,
  ENRICHMENT_JOB_OPTIONS,
  type LeadImportQueuePayload,
} from '@signalforge/queue';
import { requireWorkspaceOrUploadToken, getWorkspaceId } from '../plugins/auth.js';
import { getQueue } from '../queue-registry.js';
import { isLinkedInResearchEnabled, leadResearchService } from '@signalforge/lead-research';
import {
  processImportRows,
  computeFieldStats,
  toPreviewRows,
  executeImportRows,
  formatMappingsResponse,
} from '../services/lead-import-processor.js';

// Uploaded files are streamed to this shared directory; the import-worker reads
// them from the same path (a shared Docker volume in production).
const IMPORT_DIR = process.env.IMPORT_DATA_DIR ?? join(tmpdir(), 'signalforge-imports');
const PREVIEW_SAMPLE_ROWS = 200;
// The synchronous endpoint (campaign uploads) stays bounded; large files go
// through the background flow (/smart-import/preview + /start).
const SYNC_MAX_ROWS = 10_000;

interface ImportOptions {
  mergeStrategy?: 'skip' | 'fill_missing';
  mappings?: Record<string, string>;
}

const ALLOWED_IMPORT_KEYS = new Set(['mergeStrategy', 'mappings']);
const VALID_MERGE_STRATEGIES = new Set(['skip', 'fill_missing']);

function parseImportOptions(raw: unknown): ImportOptions {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid import options');
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_IMPORT_KEYS.has(key)) throw new Error(`Unknown option: ${key}`);
  }
  if (obj.mergeStrategy !== undefined && (typeof obj.mergeStrategy !== 'string' || !VALID_MERGE_STRATEGIES.has(obj.mergeStrategy))) {
    throw new Error('mergeStrategy must be "skip" or "fill_missing"');
  }
  if (obj.mappings !== undefined) {
    if (typeof obj.mappings !== 'object' || obj.mappings === null || Array.isArray(obj.mappings)) throw new Error('mappings must be an object');
    for (const v of Object.values(obj.mappings as Record<string, unknown>)) {
      if (typeof v !== 'string') throw new Error('mapping values must be strings');
    }
  }
  return obj as ImportOptions;
}

function getUserId(request: { user?: { userId?: string } }): string {
  return request.user?.userId ?? 'unknown';
}

function sanitizeFileName(name: string): string {
  return (name || 'upload').replace(/[^\w.-]+/g, '_').slice(0, 120) || 'upload';
}

function validateMappings(raw: unknown): Record<string, string> | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('mappings must be an object');
  for (const v of Object.values(raw as Record<string, unknown>)) {
    if (typeof v !== 'string') throw new Error('mapping values must be strings');
  }
  return raw as Record<string, string>;
}

function getEnrichmentQueue() {
  return getQueue(QUEUE_NAMES.LEAD_ENRICHMENT);
}

async function parseUploadedFile(data: { toBuffer: () => Promise<Buffer>; filename: string; mimetype: string }) {
  const filename = data.filename;
  const mimeType = resolveImportMimeType(data.mimetype, filename);
  const fileBuffer = await data.toBuffer();
  const stream = Readable.from(fileBuffer);
  const parsed = await parseFileStream(stream, mimeType, { filename });
  return { parsed, filename, mimeType, fileBuffer };
}

export const smartImportRoutes: FastifyPluginAsync = async (app) => {
  // Session cookie (via the web proxy) or a short-lived upload token (direct
  // large uploads from the browser to this origin).
  app.addHook('preHandler', requireWorkspaceOrUploadToken().preHandler);

  // ── Synchronous import (small files; used by campaign lead uploads) ──────────
  app.post('/smart-import', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const optionsRaw = (data.fields as Record<string, { value?: string }>)?.options?.value;
    const options: ImportOptions = parseImportOptions(optionsRaw ? JSON.parse(optionsRaw) : {});
    const mergeStrategy = options.mergeStrategy ?? 'fill_missing';

    const startTime = new Date();
    let parseResult: Awaited<ReturnType<typeof parseUploadedFile>>;
    try {
      parseResult = await parseUploadedFile(data);
    } catch (err) {
      if (err instanceof FileParseError) {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
    const { parsed, filename, mimeType, fileBuffer } = parseResult;

    if (!parsed.rows.length) {
      return reply.status(400).send({ error: 'File contains no data rows' });
    }
    if (parsed.rows.length > SYNC_MAX_ROWS) {
      return reply.status(400).send({
        error: `This file has more than ${SYNC_MAX_ROWS.toLocaleString()} rows. Use the Import Leads page, which processes large files in the background.`,
      });
    }

    const mappingResult = detectLeadImportMappings(parsed.headers, parsed.rows, options.mappings);
    const mappings = buildLeadImportMappingsRecord(mappingResult);

    if (Object.keys(mappings).length === 0) {
      return reply.status(400).send({
        error: 'Could not detect any mappable columns. Check that your file has recognizable headers.',
        headers: parsed.headers,
      });
    }

    const processResult = processImportRows(parsed.rows, mappings, mappingResult.unmappedColumns);
    const fieldStats = computeFieldStats(processResult.processedRows, parsed.totalRowCount);
    const researchEnabled = isLinkedInResearchEnabled();

    const { summary: execSummary, createdLeadIds, researchInputs } = await executeImportRows({
      workspaceId,
      processedRows: processResult.processedRows,
      mergeStrategy,
      source: 'CSV_IMPORT',
      sourceFile: filename,
      researchEnabled,
    });

    const summary = {
      totalRows: parsed.totalRowCount,
      created: execSummary.created,
      updated: execSummary.updated,
      skipped: execSummary.skipped + processResult.skipped,
      errors: execSummary.errors + processResult.errorCount,
      noEmail: processResult.noEmail,
      invalidEmail: processResult.invalidEmail,
      qualificationQueued: 0,
      nameFromOwner: execSummary.nameFromOwner,
      nameFromCompany: execSummary.nameFromCompany,
      researchSuggested: 0,
      emailDetected: fieldStats.email,
      phoneDetected: fieldStats.phone,
      websiteDetected: fieldStats.website,
      ownerDetected: fieldStats.owner,
      companyDetected: fieldStats.company,
    };

    if (researchEnabled && researchInputs.length > 0) {
      try {
        summary.researchSuggested = await leadResearchService.createSuggestions(
          researchInputs.map((r) => ({ workspaceId, ...r })),
        );
      } catch {
        request.log.warn('Failed to create LinkedIn research suggestions from smart import');
      }
    }

    if (createdLeadIds.length > 0) {
      try {
        const queue = getEnrichmentQueue();
        const enrichmentRecords = await Promise.all(
          createdLeadIds.map((leadId) =>
            prisma.leadEnrichment.upsert({
              where: { leadId },
              create: { leadId, workspaceId, status: 'QUEUED' },
              update: { status: 'QUEUED' },
            }),
          ),
        );
        await Promise.all(
          enrichmentRecords.map((record) =>
            queue.add('enrich-lead', {
              workspaceId,
              leadId: record.leadId,
              enrichmentId: record.id,
            }, ENRICHMENT_JOB_OPTIONS),
          ),
        );
        summary.qualificationQueued = enrichmentRecords.length;
      } catch {
        request.log.warn('Failed to enqueue enrichment jobs for imported leads');
      }
    }

    let importId: string | undefined;
    try {
      const sourceFileId = `upload:${Date.now()}`;
      const leadImport = await prisma.leadImport.create({
        data: {
          workspaceId,
          source: 'CSV_IMPORT',
          status: 'COMPLETED',
          initiatedByUserId: getUserId(request),
          totalFiles: 1,
          totalRows: summary.totalRows,
          importedCount: summary.created,
          skippedCount: summary.skipped + summary.noEmail + summary.invalidEmail,
          duplicateCount: summary.updated + execSummary.skipped,
          errorCount: summary.errors,
          columnMappings: mappings,
          importOptions: { ...options, fieldStats } as unknown as Prisma.InputJsonValue,
          errorLog: processResult.errors.length > 0 ? (processResult.errors as unknown as Prisma.InputJsonValue) : undefined,
          startedAt: startTime,
          completedAt: new Date(),
          files: {
            create: {
              sourceFileId,
              sourceFileName: filename,
              sourceFileMimeType: mimeType,
              sourceFileSize: fileBuffer.length,
              detectedRowCount: summary.totalRows,
              detectedColumns: parsed.headers,
              importedRowCount: summary.created,
              skippedRowCount: summary.skipped,
              errorRowCount: summary.errors,
              status: 'COMPLETED',
            },
          },
        },
      });
      importId = leadImport.id;

      if (createdLeadIds.length > 0) {
        await prisma.lead.updateMany({
          where: { id: { in: createdLeadIds } },
          data: { importId: leadImport.id, sourceFileId },
        });
      }
    } catch {
      request.log.warn('Failed to create LeadImport tracking record');
    }

    return {
      importId,
      createdLeadIds,
      summary,
      mappings: formatMappingsResponse(mappingResult.mappings),
      errors: processResult.errors.slice(0, 50),
    };
  });

  // ── Background flow for large files: upload + sample preview ─────────────────
  // Streams the full file to disk (bounded memory), parses only a small sample
  // for column detection, and records a PENDING LeadImport that /start enqueues.
  app.post('/smart-import/preview', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    await mkdir(IMPORT_DIR, { recursive: true });
    const token = randomUUID();
    const fileName = data.filename || 'upload';
    const filePath = join(IMPORT_DIR, `${token}__${sanitizeFileName(fileName)}`);

    try {
      await pipeline(data.file, createWriteStream(filePath));
    } catch {
      await unlink(filePath).catch(() => {});
      return reply.status(400).send({ error: 'Upload failed. Please try again.' });
    }
    if (data.file.truncated) {
      await unlink(filePath).catch(() => {});
      return reply.status(413).send({ error: 'File exceeds the maximum upload size.' });
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
            for (const r of rows) {
              if (sampleRows.length < PREVIEW_SAMPLE_ROWS) sampleRows.push(r);
            }
          },
        },
        fileName,
      );
    } catch (err) {
      await unlink(filePath).catch(() => {});
      if (err instanceof FileParseError) {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }

    if (sampleRows.length === 0) {
      await unlink(filePath).catch(() => {});
      return reply.status(400).send({ error: 'File contains no data rows' });
    }

    const mappingResult = detectLeadImportMappings(headers, sampleRows);
    const mappings = buildLeadImportMappingsRecord(mappingResult);
    if (Object.keys(mappings).length === 0) {
      await unlink(filePath).catch(() => {});
      return reply.status(400).send({
        error: 'Could not detect any mappable columns. Check that your file has recognizable headers.',
        headers,
      });
    }

    const processResult = processImportRows(sampleRows, mappings, mappingResult.unmappedColumns);
    const fieldStats = computeFieldStats(processResult.processedRows, sampleRows.length);

    const leadImport = await prisma.leadImport.create({
      data: {
        workspaceId,
        source: 'CSV_IMPORT',
        status: 'PENDING',
        initiatedByUserId: getUserId(request),
        totalFiles: 1,
        columnMappings: mappings,
        importOptions: { filePath, mimeType, fileName } as unknown as Prisma.InputJsonValue,
        files: {
          create: {
            sourceFileId: token,
            sourceFileName: fileName,
            sourceFileMimeType: mimeType,
            sourceFileSize: data.file.bytesRead,
            detectedColumns: headers,
            status: 'PENDING',
          },
        },
      },
    });

    return {
      importId: leadImport.id,
      headers,
      sampleSize: sampleRows.length,
      detectedMappings: formatMappingsResponse(mappingResult.mappings),
      unmappedColumns: mappingResult.unmappedColumns,
      fieldStats,
      previewRows: toPreviewRows(processResult.processedRows, 20),
      skipped: processResult.skipped,
      noEmail: processResult.noEmail,
      invalidEmail: processResult.invalidEmail,
      errors: processResult.errors,
    };
  });

  app.post('/smart-import/:importId/start', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { importId } = request.params as { importId: string };
    const body = (request.body ?? {}) as { mappings?: unknown; mergeStrategy?: unknown };

    const mergeStrategy = body.mergeStrategy === 'fill_missing' ? 'fill_missing' : 'skip';
    let mappings: Record<string, string> | undefined;
    try {
      mappings = validateMappings(body.mappings);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid mappings' });
    }

    const imp = await prisma.leadImport.findFirst({ where: { id: importId, workspaceId } });
    if (!imp) return reply.status(404).send({ error: 'Import not found' });
    if (imp.status !== 'PENDING') {
      return reply.status(409).send({ error: 'This import has already been started.' });
    }

    const opts = (imp.importOptions ?? {}) as { filePath?: string; mimeType?: string; fileName?: string };
    if (!opts.filePath) {
      return reply.status(400).send({ error: 'The uploaded file is no longer available. Please re-upload.' });
    }

    const effectiveMappings =
      mappings ?? ((imp.columnMappings as Record<string, string> | null) ?? undefined);

    const queue = getQueue<LeadImportQueuePayload>(QUEUE_NAMES.LEAD_IMPORT);
    await enqueueLeadImport(queue, {
      importId,
      workspaceId,
      filePath: opts.filePath,
      fileName: opts.fileName ?? 'upload',
      mimeType: opts.mimeType ?? 'text/csv',
      mappings: effectiveMappings,
      mergeStrategy,
      initiatedByUserId: getUserId(request),
    });

    await prisma.leadImport.update({
      where: { id: importId },
      data: {
        status: 'SCANNING',
        columnMappings: effectiveMappings ?? (imp.columnMappings ?? undefined),
        importOptions: { ...opts, mergeStrategy } as unknown as Prisma.InputJsonValue,
        startedAt: new Date(),
      },
    });

    return reply.status(202).send({ importId });
  });

  app.get('/smart-import/imports/:importId/progress', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { importId } = request.params as { importId: string };

    const imp = await prisma.leadImport.findFirst({
      where: { id: importId, workspaceId },
      select: {
        status: true,
        totalRows: true,
        importedCount: true,
        skippedCount: true,
        duplicateCount: true,
        errorCount: true,
        completedAt: true,
        files: {
          select: {
            sourceFileName: true,
            status: true,
            importedRowCount: true,
            skippedRowCount: true,
            errorRowCount: true,
          },
        },
      },
    });

    if (!imp) return reply.status(404).send({ error: 'Import not found' });
    return imp;
  });
};

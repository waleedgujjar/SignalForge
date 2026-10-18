import { Readable } from 'node:stream';
import type { FastifyPluginAsync } from 'fastify';
import { prisma, type Prisma } from '@signalforge/database';
import {
  parseFileStream,
  resolveImportMimeType,
  detectLeadImportMappings,
  buildLeadImportMappingsRecord,
} from '@signalforge/integrations';
import {
  QUEUE_NAMES,
  createQueue,
  createRedisConnection,
  ENRICHMENT_JOB_OPTIONS,
} from '@signalforge/queue';
import { loadEnv } from '@signalforge/config';
import { requireWorkspaceGuard, getWorkspaceId } from '../plugins/auth.js';
import { isLinkedInResearchEnabled, leadResearchService } from '@signalforge/lead-research';
import {
  processImportRows,
  computeFieldStats,
  toPreviewRows,
  executeImportRows,
  formatMappingsResponse,
} from '../services/lead-import-processor.js';

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

function getEnrichmentQueue() {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);
  return createQueue(QUEUE_NAMES.LEAD_ENRICHMENT, connection);
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
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  app.post('/smart-import/preview', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const optionsRaw = (data.fields as Record<string, { value?: string }>)?.options?.value;
    const options: ImportOptions = parseImportOptions(optionsRaw ? JSON.parse(optionsRaw) : {});

    const { parsed } = await parseUploadedFile(data);

    if (!parsed.rows.length && parsed.totalRowCount === 0) {
      return reply.status(400).send({ error: 'File contains no data rows' });
    }

    const mappingResult = detectLeadImportMappings(parsed.headers, parsed.rows, options.mappings);
    const mappings = buildLeadImportMappingsRecord(mappingResult);

    if (Object.keys(mappings).length === 0) {
      return reply.status(400).send({
        error: 'Could not detect any mappable columns. Check that your file has recognizable headers or data patterns.',
        headers: parsed.headers,
      });
    }

    const processResult = processImportRows(parsed.rows, mappings, mappingResult.unmappedColumns);
    const fieldStats = computeFieldStats(processResult.processedRows, parsed.totalRowCount);

    return {
      headers: parsed.headers,
      totalRowCount: parsed.totalRowCount,
      detectedMappings: formatMappingsResponse(mappingResult.mappings),
      unmappedColumns: mappingResult.unmappedColumns,
      fieldStats,
      previewRows: toPreviewRows(processResult.processedRows, 20),
      skipped: processResult.skipped,
      errors: processResult.errors,
    };
  });

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
    const { parsed, filename, mimeType, fileBuffer } = await parseUploadedFile(data);

    if (!parsed.rows.length) {
      return reply.status(400).send({ error: 'File contains no data rows' });
    }
    if (parsed.rows.length > 10_000) {
      return reply.status(400).send({ error: 'Maximum 10,000 rows per import' });
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
      noEmail: execSummary.noEmail,
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
          initiatedByUserId: (request as { user?: { userId: string } }).user?.userId ?? 'unknown',
          totalFiles: 1,
          totalRows: summary.totalRows,
          importedCount: summary.created,
          skippedCount: summary.skipped,
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
};

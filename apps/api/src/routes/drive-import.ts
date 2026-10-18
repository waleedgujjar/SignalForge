import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '@signalforge/database';
import { loadEnv } from '@signalforge/config';
import { isLinkedInResearchEnabled, leadResearchService } from '@signalforge/lead-research';
import {
  GoogleDriveAdapter,
  encryptTokens,
  getValidTokens,
  parseFileStream,
  detectLeadImportMappings,
  MAX_PREVIEW_ROWS,
} from '@signalforge/integrations';
import {
  processImportRows,
  executeImportRows,
  formatMappingsResponse,
} from '../services/lead-import-processor.js';
import type { IntegrationTokens } from '@signalforge/integrations';
import {
  driveListFoldersSchema,
  driveListFilesSchema,
  drivePreviewFileSchema,
  driveImportSchema,
  importHistoryQuerySchema,
} from '@signalforge/validation';
import { requireWorkspaceGuard, getWorkspaceId } from '../plugins/auth.js';

function getAdapter() {
  const env = loadEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Google OAuth not configured');
  }
  return new GoogleDriveAdapter(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
}

async function resolveTokens(
  integrationId: string,
  workspaceId: string,
): Promise<{ tokens: IntegrationTokens; integration: { id: string } }> {
  const env = loadEnv();
  const integration = await prisma.integrationAccount.findFirst({
    where: { id: integrationId, workspaceId },
  });

  if (!integration) {
    throw Object.assign(new Error('Integration not found'), { statusCode: 404 });
  }

  if (integration.status !== 'CONNECTED') {
    throw Object.assign(new Error('Integration is not connected'), { statusCode: 400 });
  }

  const adapter = getAdapter();
  const { tokens, refreshed } = await getValidTokens(
    integration.encryptedTokens,
    env.ENCRYPTION_KEY,
    adapter,
  );

  if (refreshed) {
    const { encryptedPayload, keyVersion } = encryptTokens(tokens, env.ENCRYPTION_KEY);
    await prisma.integrationAccount.update({
      where: { id: integration.id },
      data: {
        encryptedTokens: encryptedPayload,
        keyVersion,
        tokenExpiresAt: new Date(tokens.expiresAt),
      },
    });
  }

  await prisma.integrationAccount.update({
    where: { id: integration.id },
    data: { lastUsedAt: new Date() },
  });

  return { tokens, integration };
}

export const driveImportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  app.get('/folders', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const query = driveListFoldersSchema.parse(request.query);

    try {
      const { tokens } = await resolveTokens(query.integrationId, workspaceId);
      const adapter = getAdapter();
      return await adapter.listFolders(tokens, query.parentFolderId);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ error: e.message });
    }
  });

  app.get('/files', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const query = driveListFilesSchema.parse(request.query);

    try {
      const { tokens } = await resolveTokens(query.integrationId, workspaceId);
      const adapter = getAdapter();
      return await adapter.listFiles(tokens, query.folderId);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ error: e.message });
    }
  });

  app.get('/files/:fileId/preview', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { fileId } = request.params as { fileId: string };
    const query = drivePreviewFileSchema.parse({
      ...request.query as Record<string, unknown>,
      fileId,
    });

    try {
      const { tokens } = await resolveTokens(query.integrationId, workspaceId);
      const adapter = getAdapter();

      const files = await adapter.listFiles(tokens, 'root');
      const fileMeta = files.find((f) => f.id === fileId);
      const mimeType = fileMeta?.mimeType ?? 'text/csv';

      const stream = await adapter.downloadFile(tokens, fileId);
      const result = await parseFileStream(stream, mimeType, {
        previewOnly: true,
        maxRows: Math.min(query.maxRows, MAX_PREVIEW_ROWS),
      });

      const mappingResult = detectLeadImportMappings(result.headers, result.rows);

      const previousImport = await prisma.leadImportFile.findFirst({
        where: { sourceFileId: fileId },
        include: { import: { select: { workspaceId: true, createdAt: true } } },
        orderBy: { createdAt: 'desc' },
      });

      const previouslyImported =
        previousImport?.import.workspaceId === workspaceId;

      return {
        headers: result.headers,
        rows: result.rows,
        totalRowCount: result.totalRowCount,
        suggestedMappings: formatMappingsResponse(mappingResult.mappings),
        unmappedColumns: mappingResult.unmappedColumns,
        previouslyImported,
        lastImportedAt: previouslyImported
          ? previousImport.createdAt.toISOString()
          : null,
      };
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ error: e.message });
    }
  });

  app.post('/import', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const body = driveImportSchema.parse(request.body);

    try {
      await resolveTokens(body.integrationId, workspaceId);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ error: e.message });
    }

    const leadImport = await prisma.leadImport.create({
      data: {
        workspaceId,
        integrationId: body.integrationId,
        source: 'GOOGLE_DRIVE',
        status: 'PENDING',
        initiatedByUserId: request.user!.userId,
        totalFiles: body.files.length,
        columnMappings: body.mappings,
        importOptions: body.options,
        files: {
          create: body.files.map((f) => ({
            sourceFileId: f.fileId,
            sourceFileName: f.fileName,
            sourceFileMimeType: f.mimeType,
            sourceFileSize: f.size ?? 0,
            status: 'PENDING' as const,
          })),
        },
      },
      include: { files: true },
    });

    // Enqueue import jobs — in a real production setup this would use BullMQ.
    // For now, process inline in a non-blocking way.
    processImportInBackground(leadImport.id, workspaceId).catch(() => {});

    return reply.status(202).send({ importId: leadImport.id });
  });

  app.get('/imports', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const query = importHistoryQuerySchema.parse(request.query);

    const where: Record<string, unknown> = { workspaceId };
    if (query.source) where.source = query.source;
    if (query.status) where.status = query.status;

    const [imports, total] = await Promise.all([
      prisma.leadImport.findMany({
        where,
        include: {
          files: {
            select: {
              id: true,
              sourceFileId: true,
              sourceFileName: true,
              sourceFileMimeType: true,
              importedRowCount: true,
              skippedRowCount: true,
              errorRowCount: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: (query.page - 1) * query.limit,
      }),
      prisma.leadImport.count({ where }),
    ]);

    return {
      imports,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  });

  app.get('/imports/:importId', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { importId } = request.params as { importId: string };

    const imp = await prisma.leadImport.findFirst({
      where: { id: importId, workspaceId },
      include: { files: true },
    });

    if (!imp) {
      return reply.status(404).send({ error: 'Import not found' });
    }

    return imp;
  });

  app.get('/imports/:importId/progress', async (request, reply) => {
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

    if (!imp) {
      return reply.status(404).send({ error: 'Import not found' });
    }

    return imp;
  });
};

async function processImportInBackground(importId: string, workspaceId: string) {
  const env = loadEnv();
  const adapter = getAdapter();

  const imp = await prisma.leadImport.findUnique({
    where: { id: importId },
    include: { files: true },
  });
  if (!imp || !imp.integrationId) return;

  await prisma.leadImport.update({
    where: { id: importId },
    data: { status: 'PROCESSING', startedAt: new Date() },
  });

  const integration = await prisma.integrationAccount.findUnique({
    where: { id: imp.integrationId },
  });
  if (!integration) return;

  const tokens = (
    await getValidTokens(integration.encryptedTokens, env.ENCRYPTION_KEY, adapter)
  ).tokens;

  const mappings = imp.columnMappings as Record<string, string>;
  const options = imp.importOptions as {
    skipDuplicates?: boolean;
    tagIds?: string[];
    listId?: string;
  };
  const mergeStrategy = options.skipDuplicates !== false ? 'skip' : 'fill_missing';
  const researchEnabled = isLinkedInResearchEnabled();

  let totalRows = 0;
  let totalImported = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalDuplicates = 0;
  const allResearchInputs: { leadId: string; companyUrl?: string; personUrl?: string }[] = [];

  for (const file of imp.files) {
    try {
      await prisma.leadImportFile.update({
        where: { id: file.id },
        data: { status: 'PROCESSING' },
      });

      const stream = await adapter.downloadFile(tokens, file.sourceFileId);
      const mimeType = file.sourceFileMimeType ?? 'text/csv';
      const parsed = await parseFileStream(stream, mimeType);

      let fileImported = 0;
      let fileSkipped = 0;
      let fileErrors = 0;
      const fileErrorLog: string[] = [];

      await prisma.leadImportFile.update({
        where: { id: file.id },
        data: { detectedRowCount: parsed.totalRowCount, detectedColumns: parsed.headers },
      });

      totalRows += parsed.totalRowCount;

      const unmappedColumns = parsed.headers.filter(
        (h) => !Object.keys(mappings).includes(h),
      );
      const processResult = processImportRows(parsed.rows, mappings, unmappedColumns);

      const { summary, createdLeadIds, researchInputs } = await executeImportRows({
        workspaceId,
        processedRows: processResult.processedRows,
        mergeStrategy,
        source: 'GOOGLE_DRIVE',
        sourceFile: file.sourceFileName,
        importBatchId: importId,
        researchEnabled,
      });

      if (createdLeadIds.length > 0) {
        await prisma.lead.updateMany({
          where: { id: { in: createdLeadIds } },
          data: { importId, sourceFileId: file.sourceFileId },
        });
      }

      if (researchEnabled && researchInputs.length > 0) {
        try {
          await leadResearchService.createSuggestions(
            researchInputs.map((r) => ({ workspaceId, ...r })),
          );
          allResearchInputs.push(...researchInputs);
        } catch {
          // Suggestions are a convenience; an import must never fail because of them.
        }
      }

      fileImported = summary.created;
      fileSkipped = summary.skipped + processResult.skipped;
      fileErrors = summary.errors + processResult.errorCount;
      totalDuplicates += summary.updated + summary.skipped;

      if (processResult.errors.length > 0) {
        for (const err of processResult.errors.slice(0, 100 - fileErrorLog.length)) {
          fileErrorLog.push(`Row ${err.row}: ${err.message}`);
        }
      }

      totalImported += fileImported;
      totalSkipped += fileSkipped;
      totalErrors += fileErrors;

      await prisma.leadImportFile.update({
        where: { id: file.id },
        data: {
          status: 'COMPLETED',
          importedRowCount: fileImported,
          skippedRowCount: fileSkipped,
          errorRowCount: fileErrors,
          errorLog: fileErrorLog,
        },
      });
    } catch (err: unknown) {
      totalErrors++;
      await prisma.leadImportFile.update({
        where: { id: file.id },
        data: {
          status: 'FAILED',
          errorLog: [(err as Error).message],
        },
      });
    }
  }

  // Apply tags if specified
  if (options.tagIds?.length && totalImported > 0) {
    const leads = await prisma.lead.findMany({
      where: { workspaceId, importId },
      select: { id: true },
    });
    for (const tagId of options.tagIds) {
      const tag = await prisma.tag.findFirst({ where: { id: tagId, workspaceId } });
      if (!tag) continue;
      await prisma.leadTag.createMany({
        data: leads.map((l) => ({ leadId: l.id, tagId })),
        skipDuplicates: true,
      });
    }
  }

  // Apply list if specified
  if (options.listId && totalImported > 0) {
    const list = await prisma.leadList.findFirst({
      where: { id: options.listId, workspaceId },
    });
    if (list) {
      const leads = await prisma.lead.findMany({
        where: { workspaceId, importId },
        select: { id: true },
      });
      await prisma.leadListMember.createMany({
        data: leads.map((l) => ({ listId: list.id, leadId: l.id })),
        skipDuplicates: true,
      });
    }
  }

  await prisma.leadImport.update({
    where: { id: importId },
    data: {
      status: 'COMPLETED',
      totalRows,
      importedCount: totalImported,
      skippedCount: totalSkipped,
      duplicateCount: totalDuplicates,
      errorCount: totalErrors,
      completedAt: new Date(),
    },
  });
}

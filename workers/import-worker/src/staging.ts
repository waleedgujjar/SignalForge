import { prisma, type Prisma } from '@signalforge/database';
import { streamParseFile, FileParseError } from '@signalforge/integrations';
import {
  STAGING_FIELDS,
  detectStagingMappings,
  buildStagedLeadData,
  buildStagedLeadWhere,
  dedupDataset,
  mergeDuplicateFieldsIntoCanonicals,
  recomputeDatasetStats,
  buildTransferRows,
  persistLeadBatch,
  UNCATEGORIZED,
  type StagingField,
  type StagedLeadFilter,
} from '@signalforge/lead-discovery';
import { createAIProvider } from '@signalforge/ai';
import { loadEnv } from '@signalforge/config';
import type { LeadProcessingQueuePayload, StagedLeadFilterPayload } from '@signalforge/queue';

const BATCH_SIZE = 1_000;
const MAX_ROWS = 2_000_000;
const TRANSFER_BATCH = 500;
const AI_BATCH = 50;
const AI_MAX_ROWS = 2_000;

export async function processLeadProcessingJob(
  payload: LeadProcessingQueuePayload,
): Promise<{ status: string }> {
  if (payload.kind === 'process-dataset') return processDataset(payload);
  return processTransfer(payload);
}

function sanitizeMappings(raw?: Record<string, string>): Record<string, StagingField> {
  const result: Record<string, StagingField> = {};
  if (!raw) return result;
  for (const [header, field] of Object.entries(raw)) {
    if ((STAGING_FIELDS as readonly string[]).includes(field)) {
      result[header] = field as StagingField;
    }
  }
  return result;
}

async function processDataset(
  p: Extract<LeadProcessingQueuePayload, { kind: 'process-dataset' }>,
): Promise<{ status: string }> {
  const { datasetId, workspaceId } = p;

  // Restartable: wipe any partial rows from a previous attempt, then reprocess
  // from the retained upload. Nothing outside this dataset is touched.
  await prisma.stagedLead.deleteMany({ where: { datasetId } });
  await prisma.stagingDataset.update({
    where: { id: datasetId },
    data: {
      status: 'PROCESSING',
      startedAt: new Date(),
      completedAt: null,
      errorLog: [],
      totalRows: 0,
      stagedCount: 0,
      uniqueCount: 0,
      duplicateCount: 0,
      reviewCount: 0,
      invalidCount: 0,
      categorizedCount: 0,
      errorCount: 0,
    },
  });

  let mappings = sanitizeMappings(p.mappings);
  let headers: string[] = [];
  let staged = 0;
  let rowOffset = 0;
  const rowErrors: Array<{ row: number; message: string }> = [];

  try {
    const result = await streamParseFile(
      p.filePath,
      p.mimeType,
      {
        batchSize: BATCH_SIZE,
        maxRows: MAX_ROWS,
        onHeaders: (hs) => {
          headers = hs;
        },
        onBatch: async (rows) => {
          if (Object.keys(mappings).length === 0) {
            mappings = detectStagingMappings(headers, rows);
            if (Object.keys(mappings).length === 0) {
              throw new FileParseError(
                'Could not detect any of the expected columns (username, name, bio, category, website, email, phone). Map the columns manually and retry.',
              );
            }
          }

          const data: Prisma.StagedLeadCreateManyInput[] = [];
          for (let i = 0; i < rows.length; i++) {
            try {
              data.push(
                buildStagedLeadData(rows[i]!, mappings, {
                  datasetId,
                  workspaceId,
                  sourceRow: rowOffset + i + 1,
                }),
              );
            } catch (err) {
              if (rowErrors.length < 100) {
                rowErrors.push({
                  row: rowOffset + i + 1,
                  message: err instanceof Error ? err.message : 'Row could not be processed',
                });
              }
            }
          }
          rowOffset += rows.length;

          if (data.length > 0) {
            const res = await prisma.stagedLead.createMany({ data });
            staged += res.count;
          }

          await prisma.stagingDataset
            .update({
              where: { id: datasetId },
              data: { stagedCount: staged, totalRows: rowOffset, errorCount: rowErrors.length },
            })
            .catch(() => {});
        },
      },
      p.fileName,
    );

    await prisma.stagingDataset.update({
      where: { id: datasetId },
      data: {
        totalRows: result.totalRowCount,
        columnMappings: mappings as unknown as Prisma.InputJsonValue,
      },
    });

    await dedupDataset(datasetId);
    await mergeDuplicateFieldsIntoCanonicals(datasetId);
    if (p.aiCategorization) {
      await aiCategorizePass(datasetId);
    }
    await recomputeDatasetStats(datasetId);

    await prisma.stagingDataset.update({
      where: { id: datasetId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        errorCount: rowErrors.length,
        errorLog: rowErrors as unknown as Prisma.InputJsonValue,
      },
    });
    return { status: 'completed' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Dataset processing failed';
    await prisma.stagingDataset
      .update({
        where: { id: datasetId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorLog: [{ message }, ...rowErrors] as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});
    throw err;
  }
}

/** Optional, bounded AI pass over rows the rules could not categorize. */
async function aiCategorizePass(datasetId: string): Promise<void> {
  const env = loadEnv();
  if (env.AI_PROVIDER !== 'openai' || !env.OPENAI_API_KEY) return;

  const provider = createAIProvider(env.AI_PROVIDER, {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    baseURL: env.OPENAI_BASE_URL,
  });

  const existing = await prisma.stagedLead.groupBy({
    by: ['assignedCategory'],
    where: { datasetId, NOT: { assignedCategory: UNCATEGORIZED } },
    _count: { _all: true },
  });
  const knownCategories = existing
    .map((e) => e.assignedCategory)
    .filter((c): c is string => Boolean(c));

  const targets = await prisma.stagedLead.findMany({
    where: { datasetId, assignedCategory: UNCATEGORIZED, status: { in: ['UNIQUE', 'REVIEW'] } },
    select: { id: true, name: true, bio: true, username: true, website: true },
    orderBy: { sourceRow: 'asc' },
    take: AI_MAX_ROWS,
  });

  for (let i = 0; i < targets.length; i += AI_BATCH) {
    const batch = targets.slice(i, i + AI_BATCH);
    try {
      const res = await provider.categorizeLeads({ leads: batch, knownCategories });
      const updates = res.categories
        .filter((c) => c.id && c.category && c.category !== UNCATEGORIZED)
        .map((c) =>
          prisma.stagedLead.update({
            where: { id: c.id },
            data: {
              assignedCategory: c.category.slice(0, 60),
              categoryConfidence: Math.max(0, Math.min(1, c.confidence ?? 0.5)),
              categoryReason: 'AI classification',
            },
          }),
        );
      if (updates.length > 0) await prisma.$transaction(updates);
      for (const c of res.categories) {
        const label = c.category?.slice(0, 60);
        if (label && label !== UNCATEGORIZED && !knownCategories.includes(label)) {
          knownCategories.push(label);
        }
      }
    } catch {
      // AI is best-effort: a failed batch leaves rows Uncategorized.
    }
  }
}

function toFilter(filter?: StagedLeadFilterPayload): StagedLeadFilter {
  if (!filter) return {};
  return {
    status: filter.status as StagedLeadFilter['status'],
    category: filter.category,
    hasEmail: filter.hasEmail,
    hasWebsite: filter.hasWebsite,
    search: filter.search,
  };
}

async function processTransfer(
  p: Extract<LeadProcessingQueuePayload, { kind: 'transfer' }>,
): Promise<{ status: string }> {
  const { datasetId, workspaceId, leadImportId, mergeStrategy } = p;

  await prisma.leadImport.update({
    where: { id: leadImportId },
    data: { status: 'PROCESSING', startedAt: new Date() },
  });

  const dataset = await prisma.stagingDataset.findUnique({ where: { id: datasetId } });
  const sourceFile = dataset?.name ?? 'Large Lead Data';

  const baseWhere: Prisma.StagedLeadWhereInput = p.stagedLeadIds?.length
    ? { datasetId, id: { in: p.stagedLeadIds } }
    : buildStagedLeadWhere(datasetId, toFilter(p.filter));
  // Never transfer rows flagged invalid or duplicate unless explicitly selected
  // by id or by an explicit status filter.
  if (!p.stagedLeadIds?.length && !p.filter?.status) {
    baseWhere.status = { in: ['UNIQUE', 'REVIEW'] };
  }

  const totals = { created: 0, updated: 0, duplicates: 0, noEmail: 0, errors: 0 };
  totals.noEmail = await prisma.stagedLead.count({
    where: { ...baseWhere, importedLeadId: null, normalizedEmail: null },
  });

  const transferWhere: Prisma.StagedLeadWhereInput = {
    ...baseWhere,
    importedLeadId: null,
    normalizedEmail: { not: null },
  };

  try {
    for (;;) {
      const staged = await prisma.stagedLead.findMany({
        where: transferWhere,
        orderBy: { sourceRow: 'asc' },
        take: TRANSFER_BATCH,
      });
      if (staged.length === 0) break;

      const { processedRows, byEmail } = buildTransferRows(staged);
      const result = await persistLeadBatch({
        workspaceId,
        processedRows,
        mergeStrategy,
        source: 'CSV_IMPORT',
        sourceFile,
        importBatchId: leadImportId,
      });
      totals.created += result.created;
      totals.updated += result.updated;
      totals.duplicates += result.skipped;
      totals.errors += result.errors;

      // Resolve the Lead ids for this batch's emails and link the staged rows.
      const emails = [...byEmail.keys()];
      const leads = await prisma.lead.findMany({
        where: { workspaceId, email: { in: emails } },
        select: { id: true, email: true },
      });
      const leadIdByEmail = new Map(leads.map((l) => [l.email, l.id]));

      const updates: Prisma.PrismaPromise<unknown>[] = [];
      for (const [email, stagedIds] of byEmail) {
        const leadId = leadIdByEmail.get(email);
        if (!leadId) continue;
        updates.push(
          prisma.stagedLead.updateMany({
            where: { id: { in: stagedIds } },
            data: { importedLeadId: leadId, importedAt: new Date() },
          }),
        );
      }
      if (updates.length > 0) await prisma.$transaction(updates);

      // Progress + stall guard: if nothing in this batch could be linked (e.g.
      // every insert failed), stop instead of refetching the same rows forever.
      await prisma.leadImport
        .update({
          where: { id: leadImportId },
          data: {
            importedCount: totals.created + totals.updated,
            duplicateCount: totals.duplicates,
            skippedCount: totals.noEmail,
            errorCount: totals.errors,
          },
        })
        .catch(() => {});
      if (updates.length === 0) {
        totals.errors += staged.length;
        break;
      }
      if (staged.length < TRANSFER_BATCH) break;
    }

    await prisma.leadImport.update({
      where: { id: leadImportId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        importedCount: totals.created + totals.updated,
        duplicateCount: totals.duplicates,
        skippedCount: totals.noEmail,
        errorCount: totals.errors,
      },
    });
    await recomputeDatasetStats(datasetId);
    return { status: 'completed' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transfer failed';
    await prisma.leadImport
      .update({
        where: { id: leadImportId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorLog: [{ message }] as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});
    await recomputeDatasetStats(datasetId).catch(() => {});
    throw err;
  }
}

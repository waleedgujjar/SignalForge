import { unlink } from 'node:fs/promises';
import { prisma, type Prisma } from '@signalforge/database';
import {
  streamParseFile,
  detectLeadImportMappings,
  buildLeadImportMappingsRecord,
} from '@signalforge/integrations';
import { processImportRows, persistLeadBatch } from '@signalforge/lead-discovery';
import type { LeadImportQueuePayload } from '@signalforge/queue';

// Safety ceiling; streaming keeps memory bounded regardless, but this caps a
// runaway/corrupt file.
const MAX_IMPORT_ROWS = 2_000_000;
const BATCH_SIZE = 1_000;

export async function processLeadImportJob(
  data: LeadImportQueuePayload,
): Promise<{ status: string; created: number; totalRows: number }> {
  const { importId, workspaceId, filePath, fileName, mimeType, mergeStrategy } = data;
  let mappings = data.mappings;

  await prisma.leadImport.update({
    where: { id: importId },
    data: { status: 'PROCESSING', startedAt: new Date() },
  });

  const totals = {
    created: 0,
    updated: 0,
    duplicates: 0,
    rejected: 0, // no-email + invalid-email + empty rows
    errors: 0,
  };
  let headers: string[] = [];
  let totalRows = 0;

  const writeProgress = () =>
    prisma.leadImport
      .update({
        where: { id: importId },
        data: {
          importedCount: totals.created + totals.updated,
          duplicateCount: totals.duplicates,
          skippedCount: totals.rejected,
          errorCount: totals.errors,
        },
      })
      .catch(() => {});

  try {
    const result = await streamParseFile(
      filePath,
      mimeType,
      {
        batchSize: BATCH_SIZE,
        maxRows: MAX_IMPORT_ROWS,
        onHeaders: (hs) => {
          headers = hs;
        },
        onBatch: async (rows) => {
          if (!mappings || Object.keys(mappings).length === 0) {
            const detection = detectLeadImportMappings(headers, rows);
            mappings = buildLeadImportMappingsRecord(detection);
          }
          const unmapped = headers.filter((h) => !Object.keys(mappings!).includes(h));
          const processed = processImportRows(rows, mappings!, unmapped);

          totals.rejected += processed.skipped + processed.noEmail + processed.invalidEmail;
          totals.errors += processed.errorCount;

          const persisted = await persistLeadBatch({
            workspaceId,
            processedRows: processed.processedRows,
            mergeStrategy: mergeStrategy ?? 'skip',
            source: 'CSV_IMPORT',
            sourceFile: fileName,
            importBatchId: importId,
          });
          totals.created += persisted.created;
          totals.updated += persisted.updated;
          totals.duplicates += persisted.skipped;
          totals.errors += persisted.errors;

          await writeProgress();
        },
      },
      fileName,
    );
    totalRows = result.totalRowCount;

    await prisma.leadImport.update({
      where: { id: importId },
      data: {
        status: 'COMPLETED',
        totalRows,
        importedCount: totals.created + totals.updated,
        duplicateCount: totals.duplicates,
        skippedCount: totals.rejected,
        errorCount: totals.errors,
        completedAt: new Date(),
      },
    });

    return { status: 'completed', created: totals.created, totalRows };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    await prisma.leadImport
      .update({
        where: { id: importId },
        data: {
          status: 'FAILED',
          errorLog: { message } as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      })
      .catch(() => {});
    throw err;
  } finally {
    await unlink(filePath).catch(() => {});
  }
}

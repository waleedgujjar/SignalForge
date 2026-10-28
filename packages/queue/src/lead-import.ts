import type { Queue, JobsOptions } from 'bullmq';

export interface LeadImportQueuePayload {
  importId: string;
  workspaceId: string;
  /** Absolute path to the uploaded file on the shared import volume. */
  filePath: string;
  fileName: string;
  mimeType: string;
  /** Manual column mappings from the review step: { csvColumn: leadField }. */
  mappings?: Record<string, string>;
  mergeStrategy?: 'skip' | 'fill_missing';
  initiatedByUserId?: string;
}

// Imports are large and not safe to replay wholesale, so we do not auto-retry;
// a failure is recorded on the LeadImport row and surfaced to the user.
export const LEAD_IMPORT_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: 100,
  removeOnFail: 200,
};

export async function enqueueLeadImport(
  queue: Queue<LeadImportQueuePayload>,
  payload: LeadImportQueuePayload,
) {
  return queue.add('lead-import', payload, {
    ...LEAD_IMPORT_JOB_OPTIONS,
    jobId: `lead-import-${payload.importId}`,
  });
}

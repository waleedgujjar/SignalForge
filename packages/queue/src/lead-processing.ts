import type { Queue, JobsOptions } from 'bullmq';

export interface StagedLeadFilterPayload {
  status?: string;
  category?: string;
  hasEmail?: boolean;
  hasWebsite?: boolean;
  search?: string;
}

export type LeadProcessingQueuePayload =
  | {
      kind: 'process-dataset';
      datasetId: string;
      workspaceId: string;
      filePath: string;
      fileName: string;
      mimeType: string;
      mappings?: Record<string, string>;
      aiCategorization?: boolean;
    }
  | {
      kind: 'transfer';
      datasetId: string;
      workspaceId: string;
      leadImportId: string;
      mergeStrategy: 'skip' | 'fill_missing';
      stagedLeadIds?: string[];
      filter?: StagedLeadFilterPayload;
      initiatedByUserId?: string;
    };

// Dataset processing is restartable (a retry wipes and reprocesses from the
// retained file) but is never auto-retried; failures surface on the dataset.
export const LEAD_PROCESSING_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: 100,
  removeOnFail: 200,
};

export async function enqueueLeadProcessing(
  queue: Queue<LeadProcessingQueuePayload>,
  payload: LeadProcessingQueuePayload,
) {
  return queue.add(payload.kind, payload, LEAD_PROCESSING_JOB_OPTIONS);
}

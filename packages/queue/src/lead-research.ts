import type { Queue, JobsOptions } from 'bullmq';

export interface LeadResearchQueuePayload {
  workspaceId: string;
  leadId: string;
  researchId: string;
  /// Re-run even when the record already completed (explicit re-research).
  forceRefresh?: boolean;
}

export const LEAD_RESEARCH_JOB_OPTIONS: JobsOptions = {
  // Two attempts only, and the processor rethrows solely for TIMEOUT /
  // PROVIDER_UNAVAILABLE. A provider refusal (authwall, 429/999, private
  // profile) is persisted as MANUAL_REVIEW and is never retried around.
  attempts: 2,
  backoff: {
    type: 'exponential',
    delay: 30_000,
  },
  removeOnComplete: 200,
  removeOnFail: 500,
};

export async function enqueueLeadResearch(
  queue: Queue<LeadResearchQueuePayload>,
  payload: LeadResearchQueuePayload,
  options?: { delayMs?: number; jobId?: string },
) {
  return queue.add('research', payload, {
    ...LEAD_RESEARCH_JOB_OPTIONS,
    delay: options?.delayMs,
    // Deterministic id: enqueuing the same research row twice collapses to one
    // queued run. Retries pass an explicit suffixed id because BullMQ ignores a
    // duplicate id while the earlier job is still retained.
    jobId: options?.jobId ?? `lead-research-${payload.researchId}`,
  });
}

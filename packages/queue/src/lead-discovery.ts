import type { Queue, JobsOptions } from 'bullmq';

export interface LeadDiscoveryQueuePayload {
  workspaceId: string;
  jobId: string;
  /// Base64 payload for file-backed sources (CSV/XLSX). Redis holds this only
  /// for the life of the job; nothing is persisted to disk.
  file?: { data: string; mimeType: string; filename?: string; columnMappings?: Record<string, string> };
}

export const LEAD_DISCOVERY_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    // Discovery touches third-party APIs and DNS; a slow first retry gives a
    // rate-limited provider room to recover instead of hammering it.
    delay: 30_000,
  },
  removeOnComplete: 200,
  removeOnFail: 500,
};

export async function enqueueLeadDiscovery(
  queue: Queue<LeadDiscoveryQueuePayload>,
  payload: LeadDiscoveryQueuePayload,
  options?: { delayMs?: number; jobId?: string },
) {
  return queue.add('discovery-run', payload, {
    ...LEAD_DISCOVERY_JOB_OPTIONS,
    delay: options?.delayMs,
    // Deterministic id: enqueuing the same discovery job twice collapses to one
    // queued run, and the pipeline upserts, so a retry is harmless either way.
    jobId: options?.jobId ?? `discovery-${payload.jobId}`,
  });
}

export interface RequalifyQueuePayload {
  workspaceId: string;
  jobId?: string;
  discoveredLeadIds?: string[];
  minScore?: number;
}

export async function enqueueRequalification(
  queue: Queue<RequalifyQueuePayload>,
  payload: RequalifyQueuePayload,
) {
  return queue.add('requalify', payload, {
    ...LEAD_DISCOVERY_JOB_OPTIONS,
    jobId: `requalify-${payload.jobId ?? payload.workspaceId}-${Date.now()}`,
  });
}

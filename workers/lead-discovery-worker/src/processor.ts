import { runDiscoveryJob, requalifyLeads, type RunDiscoveryResult, type RequalifyResult } from '@signalforge/lead-discovery';
import type { LeadDiscoveryQueuePayload, RequalifyQueuePayload } from '@signalforge/queue';

export type LeadDiscoveryJobData = LeadDiscoveryQueuePayload;

export async function processLeadDiscoveryJob(
  data: LeadDiscoveryJobData,
): Promise<RunDiscoveryResult> {
  const file = data.file
    ? {
        buffer: Buffer.from(data.file.data, 'base64'),
        mimeType: data.file.mimeType,
        filename: data.file.filename,
        columnMappings: data.file.columnMappings,
      }
    : undefined;

  return runDiscoveryJob({
    jobId: data.jobId,
    workspaceId: data.workspaceId,
    file,
  });
}

export async function processRequalifyJob(
  data: RequalifyQueuePayload,
): Promise<RequalifyResult> {
  return requalifyLeads({
    workspaceId: data.workspaceId,
    jobId: data.jobId,
    discoveredLeadIds: data.discoveredLeadIds,
    minScore: data.minScore,
  });
}

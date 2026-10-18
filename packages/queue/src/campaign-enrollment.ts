import { createHash } from 'node:crypto';
import type { Queue, JobsOptions } from 'bullmq';

export interface CampaignEnrollmentQueuePayload {
  workspaceId: string;
  campaignId: string;
  leadIds: string[];
  actorUserId?: string;
  force?: boolean;
  source?: 'api' | 'discovery';
  discoveryJobId?: string;
  discoveredLeadIds?: string[];
}

export const CAMPAIGN_ENROLLMENT_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: {
    type: 'exponential',
    delay: 30_000,
  },
  removeOnComplete: 200,
  removeOnFail: 500,
};

function enrollmentJobId(campaignId: string, leadIds: string[]): string {
  const sorted = [...leadIds].sort().join(',');
  const hash = createHash('sha256').update(sorted).digest('hex').slice(0, 12);
  return `campaign-enroll-${campaignId}-${hash}`;
}

export async function enqueueCampaignEnrollment(
  queue: Queue<CampaignEnrollmentQueuePayload>,
  payload: CampaignEnrollmentQueuePayload,
  options?: { jobId?: string },
) {
  return queue.add('campaign-enrollment', payload, {
    ...CAMPAIGN_ENROLLMENT_JOB_OPTIONS,
    jobId: options?.jobId ?? enrollmentJobId(payload.campaignId, payload.leadIds),
  });
}

export const BULK_ENROLLMENT_THRESHOLD = 100;

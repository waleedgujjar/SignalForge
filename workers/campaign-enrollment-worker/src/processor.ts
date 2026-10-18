import { campaignLeadService } from '@signalforge/campaigns';
import type { CampaignEnrollmentQueuePayload } from '@signalforge/queue';

const CHUNK_SIZE = 100;

export interface EnrollmentResult {
  ok: boolean;
  enrolled: number;
  skipped: number;
  chunks: number;
  blocked?: string;
}

export async function processCampaignEnrollment(
  data: CampaignEnrollmentQueuePayload,
): Promise<EnrollmentResult> {
  const { workspaceId, campaignId, leadIds, actorUserId, force } = data;

  if (leadIds.length === 0) {
    return { ok: true, enrolled: 0, skipped: 0, chunks: 0 };
  }

  let totalEnrolled = 0;
  let totalSkipped = 0;
  let chunksProcessed = 0;

  for (let i = 0; i < leadIds.length; i += CHUNK_SIZE) {
    const chunk = leadIds.slice(i, i + CHUNK_SIZE);
    const result = await campaignLeadService.enrollLeads(campaignId, workspaceId, chunk, {
      actorUserId,
      force,
    });

    if (result.blocked) {
      return {
        ok: false,
        enrolled: totalEnrolled,
        skipped: totalSkipped + chunk.length,
        chunks: chunksProcessed,
        blocked: result.blocked,
      };
    }

    totalEnrolled += result.enrolled;
    totalSkipped += result.skipped;
    chunksProcessed++;
  }

  return {
    ok: true,
    enrolled: totalEnrolled,
    skipped: totalSkipped,
    chunks: chunksProcessed,
  };
}

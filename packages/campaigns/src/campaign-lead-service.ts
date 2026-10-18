import type { DuplicateEnrollmentPolicy } from '@signalforge/database';
import { prisma } from '@signalforge/database';
import { logCampaignActivity } from './activity.js';
import { campaignEligibilityService } from './eligibility.js';

export const ENROLLABLE_STATUSES = new Set(['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED']);

export class CampaignLeadService {
  async enrollLeads(
    campaignId: string,
    workspaceId: string,
    leadIds: string[],
    options?: { actorUserId?: string; force?: boolean },
  ) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, workspaceId },
    });
    if (!campaign) throw new Error('Campaign not found');

    if (!ENROLLABLE_STATUSES.has(campaign.status)) {
      return {
        enrolled: 0,
        skipped: leadIds.length,
        eligibility: null,
        blocked: `CAMPAIGN_${campaign.status}` as const,
      };
    }

    const validLeads = await prisma.lead.findMany({
      where: { workspaceId, id: { in: leadIds } },
      select: { id: true },
    });
    const validLeadIds = validLeads.map((l) => l.id);

    const eligibility = await campaignEligibilityService.checkLeadsBulk(
      workspaceId,
      campaignId,
      validLeadIds,
    );

    const policy = campaign.duplicateEnrollmentPolicy;
    let toEnroll = eligibility.eligible.map((r) => r.leadId);

    if (policy === 'ALLOW') {
      toEnroll = validLeadIds.filter(
        (id) => !eligibility.alreadyEnrolled.some((r) => r.leadId === id),
      );
    } else if (policy === 'WARN' && options?.force) {
      toEnroll = validLeadIds.filter(
        (id) =>
          !eligibility.alreadyEnrolled.some((r) => r.leadId === id) &&
          !eligibility.ineligible.some(
            (r) => r.leadId === id && !r.reasons.includes('ALREADY_ENROLLED'),
          ),
      );
    }

    if (toEnroll.length > 0) {
      await prisma.campaignLead.createMany({
        data: toEnroll.map((leadId) => ({ campaignId, leadId })),
        skipDuplicates: true,
      });

      await logCampaignActivity({
        campaignId,
        workspaceId,
        type: 'LEADS_ADDED',
        summary: `Enrolled ${toEnroll.length} lead(s)`,
        actorUserId: options?.actorUserId,
        metadata: { leadIds: toEnroll, count: toEnroll.length },
      });
    }

    return {
      enrolled: toEnroll.length,
      skipped: validLeadIds.length - toEnroll.length,
      eligibility,
    };
  }

  async removeLead(
    campaignId: string,
    leadId: string,
    workspaceId: string,
    actorUserId?: string,
  ) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, workspaceId },
    });
    if (!campaign) throw new Error('Campaign not found');

    const existing = await prisma.campaignLead.findFirst({
      where: { campaignId, leadId },
    });
    if (!existing) throw new Error('Lead not enrolled in campaign');

    await prisma.campaignLead.delete({ where: { id: existing.id } });

    await logCampaignActivity({
      campaignId,
      workspaceId,
      type: 'LEADS_REMOVED',
      summary: 'Removed lead from campaign',
      actorUserId,
      metadata: { leadId },
    });
  }

  async previewEligibility(workspaceId: string, campaignId: string, leadIds: string[]) {
    return campaignEligibilityService.checkLeadsBulk(workspaceId, campaignId, leadIds);
  }
}

export const campaignLeadService = new CampaignLeadService();

export function shouldBlockDuplicateEnrollment(
  policy: DuplicateEnrollmentPolicy,
  ineligibleCount: number,
): boolean {
  if (policy === 'BLOCK') return ineligibleCount > 0;
  return false;
}

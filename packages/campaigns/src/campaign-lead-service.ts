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
    options?: { actorUserId?: string; force?: boolean; approvedLeadIds?: string[] },
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
      { approvedLeadIds: options?.approvedLeadIds },
    );

    // Only eligible leads are enrolled, whatever the duplicate-enrollment
    // policy. That policy decides whether a partially ineligible batch is
    // rejected outright (BLOCK, enforced by the route), never whether
    // suppression, unsubscribe or verification checks apply. Leads already in
    // this campaign are never eligible, and (campaignId, leadId) is unique.
    const toEnroll = eligibility.eligible.map((r) => r.leadId);
    const approved = new Set(eligibility.eligible.filter((r) => r.reviewApproved).map((r) => r.leadId));
    const approvedAt = new Date();

    if (toEnroll.length > 0) {
      await prisma.campaignLead.createMany({
        data: toEnroll.map((leadId) => ({
          campaignId,
          leadId,
          ...(approved.has(leadId)
            ? { verificationApprovedAt: approvedAt, verificationApprovedById: options?.actorUserId ?? null }
            : {}),
        })),
        skipDuplicates: true,
      });

      await logCampaignActivity({
        campaignId,
        workspaceId,
        type: 'LEADS_ADDED',
        summary: `Enrolled ${toEnroll.length} lead(s)`,
        actorUserId: options?.actorUserId,
        metadata: { leadIds: toEnroll, count: toEnroll.length, reviewApproved: [...approved] },
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

import { prisma } from '@signalforge/database';
import {
  checkSuppression,
  isVerificationFresh,
  resolveVerificationPolicy,
  shouldExcludeByVerification,
  verificationEligibilityTier,
  REVIEWABLE_VERIFICATION_REASONS,
} from '@signalforge/email';
import type { SuppressionEntry } from '@signalforge/email';
import type { SuppressionPolicyConfig, VerificationPolicyConfig } from './types.js';
import type { BulkEligibilityReport, EligibilityReason, LeadEligibilityResult } from './types.js';

const BLOCKED_LEAD_STATUSES = new Set(['UNSUBSCRIBED', 'BOUNCED', 'ARCHIVED']);

type LeadRecord = {
  id: string;
  email: string;
  status: string;
  verification?: {
    status: string;
    score: number;
    reason?: string | null;
    domain?: string | null;
    mxStatus?: string | null;
    riskScore?: number | null;
    riskLevel?: string | null;
    reasonCode?: string | null;
    verifiedAt?: Date | null;
    verificationVersion?: string | null;
    email?: string;
  } | null;
};

function mapVerificationReason(reason?: string): LeadEligibilityResult['reasons'][number] {
  switch (reason) {
    case 'UNVERIFIED_EMAIL':
      return 'UNVERIFIED_EMAIL';
    case 'EMAIL_VERIFICATION_ROLE':
      return 'ROLE_EMAIL';
    case 'EMAIL_VERIFICATION_RISKY':
      return 'RISKY_EMAIL';
    case 'EMAIL_VERIFICATION_UNKNOWN':
      return 'UNKNOWN_EMAIL';
    case 'EMAIL_VERIFICATION_CATCH_ALL':
      return 'CATCH_ALL_EMAIL';
    case 'EMAIL_VERIFICATION_LOW_SCORE':
      return 'LOW_CONFIDENCE_EMAIL';
    default:
      return 'INVALID_EMAIL';
  }
}

function evaluateLead(
  lead: LeadRecord,
  options: {
    enrolledLeadIds: Set<string>;
    suppressions: SuppressionEntry[];
    verificationPolicy: VerificationPolicyConfig;
    respectSuppressions: boolean;
    requireQualification: boolean;
    approvedLeadIds: Set<string>;
  },
): LeadEligibilityResult {
  const reasons: LeadEligibilityResult['reasons'] = [];

  if (options.enrolledLeadIds.has(lead.id)) {
    reasons.push('ALREADY_ENROLLED');
  }

  if (!lead.email?.trim()) {
    reasons.push('MISSING_EMAIL');
  }

  if (BLOCKED_LEAD_STATUSES.has(lead.status)) {
    if (lead.status === 'UNSUBSCRIBED') reasons.push('UNSUBSCRIBED');
    if (lead.status === 'BOUNCED') reasons.push('BOUNCED');
    if (lead.status === 'ARCHIVED') reasons.push('ARCHIVED');
  }

  if (options.requireQualification && lead.status !== 'QUALIFIED') {
    reasons.push('LEAD_NOT_QUALIFIED');
  }

  if (options.respectSuppressions) {
    const suppression = checkSuppression(lead.email, options.suppressions);
    if (suppression.suppressed) {
      reasons.push('SUPPRESSED');
    }
  }

  const verification = lead.verification ?? null;
  const exclusion = shouldExcludeByVerification(verification, options.verificationPolicy);
  let reviewApproved = false;
  if (exclusion.excluded) {
    if (options.approvedLeadIds.has(lead.id) && REVIEWABLE_VERIFICATION_REASONS.has(exclusion.reason!)) {
      reviewApproved = true;
    } else {
      reasons.push(mapVerificationReason(exclusion.reason));
    }
  }

  return {
    leadId: lead.id,
    email: lead.email,
    eligible: reasons.length === 0,
    reasons,
    verification: verification
      ? {
          status: verification.status,
          tier: verificationEligibilityTier(verification.status),
          reason: verification.reason ?? null,
          verifiedAt: verification.verifiedAt?.toISOString() ?? null,
          stale: !isVerificationFresh({
            status: verification.status,
            reasonCode: verification.reasonCode,
            verifiedAt: verification.verifiedAt,
            verificationVersion: verification.verificationVersion,
          }),
        }
      : null,
    reviewable: reasons.length > 0 && reasons.every((r) => REVIEWABLE_REASONS.has(r)),
    reviewApproved,
  };
}

/** Lead-level reasons a reviewer may override (verification review tier only). */
const REVIEWABLE_REASONS = new Set<EligibilityReason>([
  'RISKY_EMAIL',
  'UNKNOWN_EMAIL',
  'CATCH_ALL_EMAIL',
  'ROLE_EMAIL',
  'LOW_CONFIDENCE_EMAIL',
]);

export class CampaignEligibilityService {
  async checkLead(
    workspaceId: string,
    campaignId: string,
    leadId: string,
    policies?: {
      verificationPolicy?: VerificationPolicyConfig;
      suppressionPolicy?: SuppressionPolicyConfig;
    },
  ): Promise<LeadEligibilityResult> {
    const report = await this.checkLeadsBulk(workspaceId, campaignId, [leadId], policies);
    return (
      report.eligible.find((r) => r.leadId === leadId) ??
      report.ineligible.find((r) => r.leadId === leadId) ?? {
        leadId,
        email: '',
        eligible: false,
        reasons: ['MISSING_EMAIL'],
      }
    );
  }

  async checkLeadsBulk(
    workspaceId: string,
    campaignId: string,
    leadIds: string[],
    policies?: {
      verificationPolicy?: VerificationPolicyConfig;
      suppressionPolicy?: SuppressionPolicyConfig;
      /** Leads a reviewer approved despite a review-tier verification result. */
      approvedLeadIds?: string[];
    },
  ): Promise<BulkEligibilityReport> {
    const [campaign, workspacePolicy, leads, enrolled, suppressions] = await Promise.all([
      prisma.campaign.findFirst({
        where: { id: campaignId, workspaceId },
        select: { verificationPolicy: true, suppressionPolicy: true },
      }),
      prisma.workspaceVerificationPolicy.findFirst({ where: { workspaceId } }),
      prisma.lead.findMany({
        where: { workspaceId, id: { in: leadIds } },
        include: { verification: true },
      }),
      prisma.campaignLead.findMany({
        where: { campaignId },
        select: { leadId: true },
      }),
      prisma.suppression.findMany({
        where: { workspaceId },
        select: { type: true, value: true, reason: true },
      }),
    ]);

    const verificationPolicy = resolveVerificationPolicy(
      workspacePolicy,
      campaign?.verificationPolicy as VerificationPolicyConfig | undefined,
      policies?.verificationPolicy,
    );

    const suppressionPolicy = {
      respectWorkspaceSuppressions: true,
      ...(campaign?.suppressionPolicy as SuppressionPolicyConfig | undefined),
      ...policies?.suppressionPolicy,
    };

    const enrolledLeadIds = new Set(enrolled.map((e) => e.leadId));
    const suppressionEntries = suppressions.map((s) => ({
      type: s.type as 'EMAIL' | 'DOMAIN',
      value: s.value,
      reason: s.reason as 'MANUAL' | 'UNSUBSCRIBED' | 'BOUNCED' | 'SPAM_COMPLAINT' | 'INVALID' | 'RISKY',
    }));

    const approvedLeadIds = new Set(policies?.approvedLeadIds ?? []);
    const requireQualification =
      (verificationPolicy as Record<string, unknown>).requireQualification === true;

    const results = leads.map((lead) =>
      evaluateLead(lead, {
        enrolledLeadIds,
        suppressions: suppressionEntries,
        verificationPolicy,
        respectSuppressions: suppressionPolicy.respectWorkspaceSuppressions !== false,
        requireQualification,
        approvedLeadIds,
      }),
    );
    // Keep request order so review tables line up with what the user selected.
    const order = new Map(leadIds.map((id, i) => [id, i]));
    results.sort((a, b) => (order.get(a.leadId) ?? 0) - (order.get(b.leadId) ?? 0));
    const review = results.filter((r) => !r.eligible && r.reviewable);
    const needsVerification = results
      .filter((r) => !r.verification || r.verification.stale)
      .map((r) => r.leadId);

    const eligible = results.filter((r) => r.eligible);
    const alreadyEnrolled = results.filter((r) => r.reasons.includes('ALREADY_ENROLLED'));
    const suppressed = results.filter(
      (r) => !r.eligible && r.reasons.includes('SUPPRESSED') && !r.reasons.includes('ALREADY_ENROLLED'),
    );
    const ineligible = results.filter((r) => !r.eligible && !r.reasons.every((reason) => reason === 'ALREADY_ENROLLED'));

    return {
      eligible,
      ineligible,
      suppressed,
      alreadyEnrolled,
      counts: {
        total: leadIds.length,
        eligible: eligible.length,
        ineligible: ineligible.length,
        suppressed: suppressed.length,
        alreadyEnrolled: alreadyEnrolled.length,
        review: review.length,
        needsVerification: needsVerification.length,
      },
      leads: results,
      needsVerification,
    };
  }
}

export const campaignEligibilityService = new CampaignEligibilityService();

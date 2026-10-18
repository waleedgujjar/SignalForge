import { prisma } from '@signalforge/database';
import { checkSuppression, shouldExcludeByVerification } from '@signalforge/email';
import type { SuppressionEntry } from '@signalforge/email';
import type { SuppressionPolicyConfig, VerificationPolicyConfig } from './types.js';
import type { BulkEligibilityReport, LeadEligibilityResult } from './types.js';

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
    email?: string;
  } | null;
};

function defaultVerificationPolicy(): VerificationPolicyConfig {
  return {
    excludeInvalid: true,
    excludeDisposable: true,
    excludeHighRisk: true,
    minScore: 50,
    blockUnverified: false,
    allowRoleEmails: false,
    blockRisky: true,
    blockUnknown: true,
  };
}

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

  const verification = lead.verification;
  const exclusion = shouldExcludeByVerification(
    verification
      ? {
          email: verification.email ?? lead.email,
          originalEmail: lead.email,
          normalizedEmail: lead.email.toLowerCase(),
          status: verification.status as never,
          score: verification.score,
          riskScore: verification.riskScore ?? 0,
          riskLevel: (verification.riskLevel ?? 'LOW') as never,
          confidenceScore: 0,
          reason: verification.reason ?? '',
          reasonCode: '',
          domain: verification.domain ?? lead.email.split('@')[1] ?? '',
          mxStatus: verification.mxStatus ?? 'UNKNOWN',
          syntaxValid: true,
          domainValid: true,
          dnsResolved: true,
          mxFound: true,
          mxRecords: [],
          smtpStatus: 'SKIPPED',
          isDisposable: verification.status === 'DISPOSABLE',
          isRole: verification.status === 'ROLE_BASED',
          roleType: null,
          isCatchAll: false,
          providerType: 'UNKNOWN',
          verificationMethod: 'LOCAL',
          riskFactors: [],
          verificationVersion: 'v1',
        }
      : null,
    options.verificationPolicy,
  );

  if (exclusion.excluded) {
    reasons.push(mapVerificationReason(exclusion.reason));
  }

  return {
    leadId: lead.id,
    email: lead.email,
    eligible: reasons.length === 0,
    reasons,
  };
}

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

    const verificationPolicy = {
      ...defaultVerificationPolicy(),
      ...(workspacePolicy
        ? {
            excludeInvalid: workspacePolicy.excludeInvalid,
            excludeDisposable: workspacePolicy.excludeDisposable,
            excludeHighRisk: workspacePolicy.excludeHighRisk,
            minScore: workspacePolicy.minScore,
            blockUnverified: workspacePolicy.blockUnverified,
            allowRoleEmails: workspacePolicy.allowRoleEmails,
            blockRisky: workspacePolicy.blockRisky,
            blockUnknown: workspacePolicy.blockUnknown,
          }
        : {}),
      ...(campaign?.verificationPolicy as VerificationPolicyConfig | undefined),
      ...policies?.verificationPolicy,
    };

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

    const requireQualification =
      (verificationPolicy as Record<string, unknown>).requireQualification === true;

    const results = leads.map((lead) =>
      evaluateLead(lead, {
        enrolledLeadIds,
        suppressions: suppressionEntries,
        verificationPolicy,
        respectSuppressions: suppressionPolicy.respectWorkspaceSuppressions !== false,
        requireQualification,
      }),
    );

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
      },
    };
  }
}

export const campaignEligibilityService = new CampaignEligibilityService();

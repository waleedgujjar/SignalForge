export interface CampaignExecutionJob {
  campaignId: string;
  campaignLeadId: string;
  leadId: string;
  sequenceStepId: string;
  scheduledAt: string;
  workspaceId: string;
}

export interface ScheduleConfig {
  timezone?: string;
  days?: number[];
  startTime?: string;
  endTime?: string;
  minDelayMinutes?: number;
  maxDelayMinutes?: number;
}

export interface VerificationPolicyConfig {
  excludeInvalid?: boolean;
  excludeDisposable?: boolean;
  excludeHighRisk?: boolean;
  minScore?: number;
  blockUnverified?: boolean;
  allowRoleEmails?: boolean;
  blockRisky?: boolean;
  blockUnknown?: boolean;
  blockCatchAll?: boolean;
}

export interface SuppressionPolicyConfig {
  respectWorkspaceSuppressions?: boolean;
}

export type EligibilityReason =
  | 'ALREADY_ENROLLED'
  | 'SUPPRESSED'
  | 'INVALID_EMAIL'
  | 'UNVERIFIED_EMAIL'
  | 'ROLE_EMAIL'
  | 'RISKY_EMAIL'
  | 'UNKNOWN_EMAIL'
  | 'CATCH_ALL_EMAIL'
  | 'LOW_CONFIDENCE_EMAIL'
  | 'UNSUBSCRIBED'
  | 'BOUNCED'
  | 'ARCHIVED'
  | 'MISSING_EMAIL'
  | 'LEAD_NOT_QUALIFIED';

export type VerificationTier = 'ELIGIBLE' | 'REVIEW' | 'NOT_ELIGIBLE' | 'UNVERIFIED';

export interface LeadVerificationSummary {
  status: string;
  tier: VerificationTier;
  reason: string | null;
  verifiedAt: string | null;
  /** Older than the cache TTL or produced by an older engine: re-verify before trusting. */
  stale: boolean;
}

export interface LeadEligibilityResult {
  leadId: string;
  email: string;
  eligible: boolean;
  reasons: EligibilityReason[];
  verification?: LeadVerificationSummary | null;
  /**
   * Every blocking reason is a review-tier verification result, so a person
   * may approve enrolling this lead anyway.
   */
  reviewable?: boolean;
  /** Eligible only because a reviewer approved it. */
  reviewApproved?: boolean;
}

export interface BulkEligibilityReport {
  eligible: LeadEligibilityResult[];
  ineligible: LeadEligibilityResult[];
  suppressed: LeadEligibilityResult[];
  alreadyEnrolled: LeadEligibilityResult[];
  counts: {
    total: number;
    eligible: number;
    ineligible: number;
    suppressed: number;
    alreadyEnrolled: number;
    review: number;
    needsVerification: number;
  };
  /** Every evaluated lead, in request order, for per-lead review tables. */
  leads: LeadEligibilityResult[];
  /** Lead ids with no verification result or a stale one. */
  needsVerification: string[];
}

export interface ValidationCheck {
  id: string;
  label: string;
  passed: boolean;
  severity: 'error' | 'warning';
  message?: string;
}

export interface CampaignValidationResult {
  valid: boolean;
  ready: boolean;
  checks: ValidationCheck[];
  errors: string[];
  warnings: string[];
}

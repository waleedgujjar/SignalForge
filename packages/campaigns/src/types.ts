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
  | 'UNSUBSCRIBED'
  | 'BOUNCED'
  | 'ARCHIVED'
  | 'MISSING_EMAIL'
  | 'LEAD_NOT_QUALIFIED';

export interface LeadEligibilityResult {
  leadId: string;
  email: string;
  eligible: boolean;
  reasons: EligibilityReason[];
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
  };
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

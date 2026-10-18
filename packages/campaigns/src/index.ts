export type {
  CampaignExecutionJob,
  ScheduleConfig,
  VerificationPolicyConfig,
  SuppressionPolicyConfig,
  EligibilityReason,
  LeadEligibilityResult,
  BulkEligibilityReport,
  ValidationCheck,
  CampaignValidationResult,
} from './types.js';

export { logCampaignActivity } from './activity.js';
export { CampaignEligibilityService, campaignEligibilityService } from './eligibility.js';
export { delayToDays, syncDelayDays, type DelayUnit } from './delays.js';
export { SequenceService, sequenceService } from './sequence.js';
export { CampaignLeadService, campaignLeadService } from './campaign-lead-service.js';
export { CampaignValidationService, campaignValidationService } from './validation.js';
export { CampaignPreviewService, campaignPreviewService } from './preview.js';
export { CampaignExecutionPlanner, campaignExecutionPlanner } from './execution-planner.js';
export { CampaignService, campaignService } from './campaign-service.js';
export { LeadSequenceService, leadSequenceService } from './lead-sequence-service.js';

export { CAMPAIGN_VARIABLE_GROUPS, normalizeVariableKey } from './variables.js';
export {
  MAX_FOLLOW_UPS,
  MAX_SEQUENCE_STEPS,
  DEFAULT_FOLLOW_UP_DELAYS_DAYS,
  MIN_DELAY_BY_UNIT,
  buildDefaultFollowUpSteps,
  clampMaxFollowUps,
  countFollowUpSteps,
  getDefaultFollowUpDelayDays,
  isFollowUpStep,
  isInitialStep,
  validateDelayAmount,
  type FollowUpSeedStep,
} from './follow-up-policy.js';

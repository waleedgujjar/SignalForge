export {
  SendingJobService,
  sendingJobService,
  type CreateSendingJobInput,
  type BootstrapCampaignResult,
} from './job-service.js';
export {
  SendingEligibilityService,
  sendingEligibilityService,
  evaluateSendingEligibility,
} from './eligibility.js';
export { SendingLimitService, sendingLimitService, type CampaignLimitCheckResult } from './limits.js';
export { SendingSchedulerService, type SchedulerDispatchResult } from './scheduler.js';
export {
  calculateNextSendTime,
  calculateNextValidSlot,
  isWithinSendingWindow,
  computeCampaignUsageDate,
  type CalculateSendTimeInput,
} from './schedule-calculator.js';
export {
  canTransition,
  assertTransition,
  isTerminal,
  isActive,
} from './job-state-machine.js';
export { classifySendError, retryBackoffMs, type ClassifiedError } from './error-classifier.js';
export { logSendingEvent, sanitizeMetadata } from './activity.js';
export type {
  SendingScheduleConfig,
  NextSendResult,
  ScheduleWindowOptions,
  SendingJobEligibilityReason,
  SendingJobEligibilityResult,
  CampaignLimitContext,
  SendingJobPayload,
  SendingJobStatus,
  SendErrorCategory,
} from './types.js';

export type {
  WarmupStatus,
  WarmupJobStatus,
  WarmupReservationStatus,
  HealthStatus,
  WarmupIneligibilityReason,
  WarmupEligibilityResult,
  WarmupScheduleConfig,
  WarmupQueuePayload,
} from './types.js';

export {
  computeCurrentLimit,
  advanceLimit,
  isWarmupComplete,
  type RampComputeInput,
  type RampComputeResult,
} from './ramp-calculator.js';

export {
  isWithinWarmupWindow,
  computeUsageDate,
  toUsageDate,
  distributeSlots,
  usageDateStart,
} from './schedule-calculator.js';

export { getWarmupEligibility, parseWeekdays } from './eligibility.js';

export {
  reserveWarmupCapacity,
  consumeWarmupReservation,
  releaseWarmupReservation,
  findActiveWarmupReservation,
  WarmupCapacityExhaustedError,
  WarmupReservationConflictError,
  type ReserveWarmupCapacityInput,
  type ReserveWarmupCapacityResult,
} from './reservation.js';

export {
  UserConfiguredRecipientProvider,
  defaultRecipientProvider,
  type WarmupRecipientProvider,
  type SelectedWarmupRecipient,
} from './recipient-provider.js';

export { renderWarmupTemplate, templateCount, type WarmupTemplate } from './templates.js';

export {
  WarmupConfigService,
  warmupConfigService,
  InvalidWarmupSettingsError,
  MailboxNotInWorkspaceError,
  type WarmupSettingsInput,
} from './config-service.js';

export {
  WarmupRecipientService,
  warmupRecipientService,
  RecipientConsentRequiredError,
  InvalidRecipientEmailError,
  RecipientAlreadyExistsError,
  RecipientNotFoundError,
  type CreateWarmupRecipientInput,
  type UpdateWarmupRecipientInput,
} from './recipient-service.js';

export {
  WarmupJobService,
  warmupJobService,
  type CreateWarmupJobInput,
} from './job-service.js';

export {
  WarmupSchedulerService,
  type WarmupSchedulerTickResult,
} from './scheduler.js';

export { logWarmupEvent, type WarmupLogFields } from './activity.js';

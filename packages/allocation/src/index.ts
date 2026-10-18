export type {
  AllocationCandidate,
  AllocationContext,
  AllocationFailure,
  AllocationIdempotent,
  AllocationResult,
  AllocationStrategy,
  AllocationSuccess,
  AllocationOutcome,
  CampaignSendingMode,
  CapacityReservationStatus,
  DegradedMailboxPolicy,
  RotationStrategy,
  StrategyContext,
} from './types.js';

export {
  CapacityBasedStrategy,
  HealthAwareStrategy,
  LeastUsedStrategy,
  RoundRobinStrategy,
  getStrategy,
} from './strategies/index.js';

export {
  filterEligibleAccounts,
  type CandidateMailbox,
  type EligibilityFilterResult,
  type EligibleCandidate,
} from './eligibility.js';

export {
  reserveCapacity,
  consumeReservation,
  releaseReservation,
  findActiveReservation,
  CapacityExhaustedError,
  ReservationConflictError,
  type ReserveCapacityInput,
  type ReserveCapacityResult,
} from './reservation.js';

export {
  SmtpPoolService,
  smtpPoolService,
  PoolNameConflictError,
  PoolNotFoundError,
  MailboxNotInWorkspaceError,
  type CreatePoolInput,
  type UpdatePoolInput,
  type AddPoolMemberInput,
  type UpdatePoolMemberInput,
} from './pool-service.js';

export {
  resolveCampaignCandidates,
  CampaignNotFoundError,
  InvalidSmtpConfigurationError,
  type ResolvedCampaign,
} from './campaign-resolver.js';

export {
  AllocationService,
  allocationService,
  type AllocateAccountInput,
} from './allocation-service.js';

export { logAllocation, type AllocationHistoryEntry } from './activity.js';

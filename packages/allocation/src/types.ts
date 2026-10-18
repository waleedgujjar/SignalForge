import type {
  AllocationOutcome,
  CampaignSendingMode,
  CapacityReservationStatus,
  DegradedMailboxPolicy,
  HealthStatus,
  RotationStrategy,
} from '@signalforge/database';

export type {
  AllocationOutcome,
  CampaignSendingMode,
  CapacityReservationStatus,
  DegradedMailboxPolicy,
  RotationStrategy,
};

/**
 * Candidate mailbox metadata used by allocation strategies.
 * Kept flat and free of Prisma types so strategies are trivially unit-testable.
 */
export interface AllocationCandidate {
  mailboxId: string;
  priority: number;
  dailyLimit: number;
  sentToday: number;
  reservedToday: number;
  warmupSentToday: number;
  warmupReservedToday: number;
  healthStatus: HealthStatus | string;
  poolMemberEnabled: boolean;
}

export interface AllocationContext {
  workspaceId: string;
  campaignId: string;
  jobId: string;
  poolId: string | null;
  strategy: RotationStrategy;
  now: Date;
  usageDate: string;
  degradedPolicy: DegradedMailboxPolicy;
  lastRoundRobinMailboxId?: string | null;
}

export interface AllocationSuccess {
  status: 'ALLOCATED';
  mailboxId: string;
  reservationId: string;
  strategy: RotationStrategy;
  poolId: string | null;
}

export interface AllocationIdempotent {
  status: 'IDEMPOTENT';
  mailboxId: string;
  reservationId: string;
  strategy: RotationStrategy;
  poolId: string | null;
}

export interface AllocationFailure {
  status: 'FAILED';
  outcome: Exclude<AllocationOutcome, 'ALLOCATED' | 'IDEMPOTENT_HIT' | 'REALLOCATED'>;
  reason: string;
  retryable: boolean;
}

export type AllocationResult = AllocationSuccess | AllocationIdempotent | AllocationFailure;

export interface StrategyContext {
  now: Date;
  lastRoundRobinMailboxId?: string | null;
  degradedPolicy: DegradedMailboxPolicy;
}

export interface AllocationStrategy {
  name: RotationStrategy;
  select(candidates: AllocationCandidate[], context: StrategyContext): AllocationCandidate | null;
}

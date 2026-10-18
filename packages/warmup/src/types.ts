import type {
  WarmupStatus,
  WarmupJobStatus,
  WarmupReservationStatus,
  HealthStatus,
} from '@signalforge/database';

export type {
  WarmupStatus,
  WarmupJobStatus,
  WarmupReservationStatus,
  HealthStatus,
};

export type WarmupIneligibilityReason =
  | 'ELIGIBLE'
  | 'WARMUP_DISABLED'
  | 'WARMUP_PAUSED'
  | 'WARMUP_BLOCKED'
  | 'WARMUP_COMPLETED'
  | 'WARMUP_NOT_STARTED'
  | 'WARMUP_DAILY_LIMIT_REACHED'
  | 'ACCOUNT_DAILY_LIMIT_REACHED'
  | 'OUTSIDE_SENDING_WINDOW'
  | 'MAILBOX_UNHEALTHY'
  | 'MAILBOX_DISABLED'
  | 'MAILBOX_UNVERIFIED'
  | 'MAILBOX_NOT_FOUND'
  | 'MISSING_CREDENTIALS'
  | 'NO_WARMUP_RECIPIENTS'
  | 'NO_ELIGIBLE_RECIPIENT';

export interface WarmupEligibilityResult {
  eligible: boolean;
  reason: WarmupIneligibilityReason;
  message: string;
  remainingCapacity: number;
  warmupRemaining: number;
  accountRemaining: number;
  configuredLimit: number;
}

export interface WarmupScheduleConfig {
  timezone: string;
  weekdays: number[];
  windowStart: string;
  windowEnd: string;
}

export interface WarmupQueuePayload {
  warmupJobId: string;
  workspaceId: string;
  mailboxId: string;
}

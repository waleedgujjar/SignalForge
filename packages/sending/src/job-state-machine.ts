import type { SendingJobStatus } from './types.js';

const TRANSITIONS: Record<SendingJobStatus, SendingJobStatus[]> = {
  PENDING: ['SCHEDULED', 'CANCELLED', 'PAUSED'],
  SCHEDULED: ['PROCESSING', 'CANCELLED', 'PAUSED', 'SCHEDULED'],
  PROCESSING: ['SENT', 'FAILED', 'RETRYING', 'CANCELLED', 'SCHEDULED'],
  RETRYING: ['SCHEDULED', 'FAILED', 'CANCELLED', 'PAUSED'],
  SENT: [],
  FAILED: ['RETRYING', 'SCHEDULED'],
  CANCELLED: [],
  PAUSED: ['SCHEDULED', 'CANCELLED'],
};

const TERMINAL_STATES: ReadonlySet<SendingJobStatus> = new Set(['SENT', 'CANCELLED']);
const ACTIVE_STATES: ReadonlySet<SendingJobStatus> = new Set(['PENDING', 'SCHEDULED', 'PROCESSING', 'RETRYING']);

export function canTransition(from: SendingJobStatus, to: SendingJobStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: SendingJobStatus, to: SendingJobStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid sending job transition ${from} -> ${to}`);
  }
}

export function isTerminal(status: SendingJobStatus): boolean {
  return TERMINAL_STATES.has(status);
}

export function isActive(status: SendingJobStatus): boolean {
  return ACTIVE_STATES.has(status);
}

export type RotationStrategy =
  | 'ROUND_ROBIN'
  | 'LEAST_UTILIZED'
  | 'HEALTH_AWARE'
  | 'CAMPAIGN_SPECIFIC'
  | 'CAPACITY_BASED';

export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

export interface MailboxCandidate {
  id: string;
  status: string;
  healthStatus: HealthStatus;
  dailySendingLimit: number;
  currentDailyUsage: number;
  reservedDailyUsage?: number;
  lastErrorAt?: Date | null;
}

export interface RotationResult {
  mailboxId: string | null;
  reason?: string;
  strategy: RotationStrategy;
}

/**
 * Legacy in-memory round-robin index. Kept only so historical unit tests keep
 * working; the production allocation path uses per-pool DB cursors via
 * `@signalforge/allocation` instead.
 */
let roundRobinIndex = 0;

export function selectMailbox(
  candidates: MailboxCandidate[],
  strategy: RotationStrategy = 'HEALTH_AWARE',
): RotationResult {
  const eligible = candidates.filter(isEligible);

  if (eligible.length === 0) {
    return {
      mailboxId: null,
      reason: 'No eligible mailboxes available',
      strategy,
    };
  }

  switch (strategy) {
    case 'ROUND_ROBIN':
      return { mailboxId: selectRoundRobin(eligible), strategy };
    case 'LEAST_UTILIZED':
      return { mailboxId: selectLeastUtilized(eligible), strategy };
    case 'CAPACITY_BASED':
      return { mailboxId: selectCapacityBased(eligible), strategy };
    case 'CAMPAIGN_SPECIFIC':
    case 'HEALTH_AWARE':
    default:
      return { mailboxId: selectHealthAware(eligible), strategy };
  }
}

function isEligible(mailbox: MailboxCandidate): boolean {
  if (mailbox.status === 'PAUSED') return false;
  if (mailbox.status !== 'ACTIVE') return false;
  if (mailbox.healthStatus === 'UNHEALTHY') return false;
  const reserved = mailbox.reservedDailyUsage ?? 0;
  if (mailbox.currentDailyUsage + reserved >= mailbox.dailySendingLimit) return false;
  return true;
}

function selectRoundRobin(candidates: MailboxCandidate[]): string {
  const index = roundRobinIndex % candidates.length;
  roundRobinIndex += 1;
  return candidates[index]!.id;
}

function selectLeastUtilized(candidates: MailboxCandidate[]): string {
  const sorted = [...candidates].sort((a, b) => {
    const ratioA = utilization(a);
    const ratioB = utilization(b);
    return ratioA - ratioB;
  });
  return sorted[0]!.id;
}

function selectCapacityBased(candidates: MailboxCandidate[]): string {
  const sorted = [...candidates].sort((a, b) => remaining(b) - remaining(a));
  return sorted[0]!.id;
}

function selectHealthAware(candidates: MailboxCandidate[]): string {
  const sorted = [...candidates].sort((a, b) => {
    const healthScore = (m: MailboxCandidate) => {
      if (m.healthStatus === 'HEALTHY') return 3;
      if (m.healthStatus === 'DEGRADED') return 2;
      return 0;
    };
    const scoreDiff = healthScore(b) - healthScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return utilization(a) - utilization(b);
  });
  return sorted[0]!.id;
}

function utilization(m: MailboxCandidate): number {
  if (m.dailySendingLimit <= 0) return 1;
  return (m.currentDailyUsage + (m.reservedDailyUsage ?? 0)) / m.dailySendingLimit;
}

function remaining(m: MailboxCandidate): number {
  return Math.max(0, m.dailySendingLimit - m.currentDailyUsage - (m.reservedDailyUsage ?? 0));
}

export function resetRoundRobin(): void {
  roundRobinIndex = 0;
}

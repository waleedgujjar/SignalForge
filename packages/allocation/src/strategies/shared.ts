import type { AllocationCandidate, StrategyContext } from '../types.js';

export function totalUsedToday(candidate: AllocationCandidate): number {
  return (
    candidate.sentToday +
    candidate.reservedToday +
    candidate.warmupSentToday +
    candidate.warmupReservedToday
  );
}

export function remainingCapacity(candidate: AllocationCandidate): number {
  return Math.max(0, candidate.dailyLimit - totalUsedToday(candidate));
}

export function utilizationRatio(candidate: AllocationCandidate): number {
  if (candidate.dailyLimit <= 0) return 1;
  return totalUsedToday(candidate) / candidate.dailyLimit;
}

/**
 * Apply the workspace's degraded-mailbox policy: strategies never receive
 * excluded candidates, and DEPRIORITIZE candidates are sorted last.
 */
export function applyDegradedPolicy(
  candidates: AllocationCandidate[],
  context: StrategyContext,
): AllocationCandidate[] {
  if (context.degradedPolicy === 'EXCLUDE') {
    return candidates.filter((c) => c.healthStatus !== 'DEGRADED');
  }
  return candidates;
}

export function comparePriority(a: AllocationCandidate, b: AllocationCandidate): number {
  return b.priority - a.priority;
}

export function tieBreakByHealthThenId(a: AllocationCandidate, b: AllocationCandidate): number {
  const healthOrder: Record<string, number> = { HEALTHY: 0, UNKNOWN: 1, DEGRADED: 2, UNHEALTHY: 3 };
  const ha = healthOrder[a.healthStatus] ?? 4;
  const hb = healthOrder[b.healthStatus] ?? 4;
  if (ha !== hb) return ha - hb;
  return a.mailboxId.localeCompare(b.mailboxId);
}

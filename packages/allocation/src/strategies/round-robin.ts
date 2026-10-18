import type { AllocationCandidate, AllocationStrategy, StrategyContext } from '../types.js';
import { applyDegradedPolicy, comparePriority, remainingCapacity } from './shared.js';

export class RoundRobinStrategy implements AllocationStrategy {
  readonly name = 'ROUND_ROBIN' as const;

  select(candidates: AllocationCandidate[], context: StrategyContext): AllocationCandidate | null {
    const available = applyDegradedPolicy(candidates, context)
      .filter((c) => c.poolMemberEnabled && remainingCapacity(c) > 0)
      .sort((a, b) => comparePriority(a, b) || a.mailboxId.localeCompare(b.mailboxId));
    if (available.length === 0) return null;

    const cursorId = context.lastRoundRobinMailboxId;
    if (!cursorId) return available[0] ?? null;

    const index = available.findIndex((c) => c.mailboxId === cursorId);
    if (index === -1) return available[0] ?? null;

    const nextIndex = (index + 1) % available.length;
    return available[nextIndex] ?? null;
  }
}

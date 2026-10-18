import type { AllocationCandidate, AllocationStrategy, StrategyContext } from '../types.js';
import {
  applyDegradedPolicy,
  comparePriority,
  remainingCapacity,
  tieBreakByHealthThenId,
} from './shared.js';

export class CapacityBasedStrategy implements AllocationStrategy {
  readonly name = 'CAPACITY_BASED' as const;

  select(candidates: AllocationCandidate[], context: StrategyContext): AllocationCandidate | null {
    const available = applyDegradedPolicy(candidates, context)
      .filter((c) => c.poolMemberEnabled && remainingCapacity(c) > 0)
      .sort((a, b) => {
        const priorityDiff = comparePriority(a, b);
        if (priorityDiff !== 0) return priorityDiff;
        const capacityDiff = remainingCapacity(b) - remainingCapacity(a);
        if (capacityDiff !== 0) return capacityDiff;
        return tieBreakByHealthThenId(a, b);
      });
    return available[0] ?? null;
  }
}

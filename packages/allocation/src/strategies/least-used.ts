import type { AllocationCandidate, AllocationStrategy, StrategyContext } from '../types.js';
import {
  applyDegradedPolicy,
  comparePriority,
  remainingCapacity,
  tieBreakByHealthThenId,
  utilizationRatio,
} from './shared.js';

export class LeastUsedStrategy implements AllocationStrategy {
  readonly name = 'LEAST_UTILIZED' as const;

  select(candidates: AllocationCandidate[], context: StrategyContext): AllocationCandidate | null {
    const available = applyDegradedPolicy(candidates, context)
      .filter((c) => c.poolMemberEnabled && remainingCapacity(c) > 0)
      .sort((a, b) => {
        const priorityDiff = comparePriority(a, b);
        if (priorityDiff !== 0) return priorityDiff;
        const utilDiff = utilizationRatio(a) - utilizationRatio(b);
        if (utilDiff !== 0) return utilDiff;
        return tieBreakByHealthThenId(a, b);
      });
    return available[0] ?? null;
  }
}

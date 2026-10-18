import type { AllocationCandidate, AllocationStrategy, StrategyContext } from '../types.js';
import { applyDegradedPolicy, comparePriority, remainingCapacity, utilizationRatio } from './shared.js';

const HEALTH_WEIGHT: Record<string, number> = {
  HEALTHY: 0,
  UNKNOWN: 1,
  DEGRADED: 2,
  UNHEALTHY: 3,
};

export class HealthAwareStrategy implements AllocationStrategy {
  readonly name = 'HEALTH_AWARE' as const;

  select(candidates: AllocationCandidate[], context: StrategyContext): AllocationCandidate | null {
    const available = applyDegradedPolicy(candidates, context)
      .filter((c) => c.poolMemberEnabled && remainingCapacity(c) > 0)
      .sort((a, b) => {
        const priorityDiff = comparePriority(a, b);
        if (priorityDiff !== 0) return priorityDiff;
        const healthDiff = (HEALTH_WEIGHT[a.healthStatus] ?? 4) - (HEALTH_WEIGHT[b.healthStatus] ?? 4);
        if (healthDiff !== 0) return healthDiff;
        const utilDiff = utilizationRatio(a) - utilizationRatio(b);
        if (utilDiff !== 0) return utilDiff;
        return a.mailboxId.localeCompare(b.mailboxId);
      });
    return available[0] ?? null;
  }
}

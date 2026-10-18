import { RoundRobinStrategy } from './round-robin.js';
import { LeastUsedStrategy } from './least-used.js';
import { CapacityBasedStrategy } from './capacity-based.js';
import { HealthAwareStrategy } from './health-aware.js';
import type { AllocationStrategy, RotationStrategy } from '../types.js';

export { RoundRobinStrategy } from './round-robin.js';
export { LeastUsedStrategy } from './least-used.js';
export { CapacityBasedStrategy } from './capacity-based.js';
export { HealthAwareStrategy } from './health-aware.js';

const registry: Record<RotationStrategy, AllocationStrategy> = {
  ROUND_ROBIN: new RoundRobinStrategy(),
  LEAST_UTILIZED: new LeastUsedStrategy(),
  HEALTH_AWARE: new HealthAwareStrategy(),
  CAMPAIGN_SPECIFIC: new RoundRobinStrategy(),
  CAPACITY_BASED: new CapacityBasedStrategy(),
};

export function getStrategy(name: RotationStrategy): AllocationStrategy {
  return registry[name] ?? registry.ROUND_ROBIN;
}

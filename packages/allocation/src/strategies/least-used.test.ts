import { describe, expect, it } from 'vitest';
import { LeastUsedStrategy } from './least-used.js';
import type { AllocationCandidate, StrategyContext } from '../types.js';

const ctx: StrategyContext = { now: new Date(), degradedPolicy: 'ALLOW' };

function candidate(overrides: Partial<AllocationCandidate> = {}): AllocationCandidate {
  return {
    mailboxId: 'a',
    priority: 0,
    dailyLimit: 100,
    sentToday: 0,
    reservedToday: 0,
    warmupSentToday: 0,
    warmupReservedToday: 0,
    healthStatus: 'HEALTHY',
    poolMemberEnabled: true,
    ...overrides,
  };
}

describe('LeastUsedStrategy', () => {
  const strategy = new LeastUsedStrategy();

  it('picks the lowest utilization ratio', () => {
    // 70%, 20%, 50% → picks 20%
    const cs = [
      candidate({ mailboxId: 'a', sentToday: 70 }),
      candidate({ mailboxId: 'b', sentToday: 20 }),
      candidate({ mailboxId: 'c', sentToday: 50 }),
    ];
    expect(strategy.select(cs, ctx)?.mailboxId).toBe('b');
  });

  it('includes reservedToday in utilization', () => {
    // a: 40 sent + 30 reserved = 70/100 = 70%
    // b: 10 sent + 60 reserved = 70/100 = 70% (tie)
    // c: 40 sent + 20 reserved = 60/100 = 60%
    const cs = [
      candidate({ mailboxId: 'a', sentToday: 40, reservedToday: 30 }),
      candidate({ mailboxId: 'b', sentToday: 10, reservedToday: 60 }),
      candidate({ mailboxId: 'c', sentToday: 40, reservedToday: 20 }),
    ];
    expect(strategy.select(cs, ctx)?.mailboxId).toBe('c');
  });

  it('respects priority above utilization', () => {
    const cs = [
      candidate({ mailboxId: 'a', priority: 100, sentToday: 90 }),
      candidate({ mailboxId: 'b', priority: 0, sentToday: 10 }),
    ];
    expect(strategy.select(cs, ctx)?.mailboxId).toBe('a');
  });
});

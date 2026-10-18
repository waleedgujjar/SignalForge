import { describe, expect, it } from 'vitest';
import { CapacityBasedStrategy } from './capacity-based.js';
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

describe('CapacityBasedStrategy', () => {
  const strategy = new CapacityBasedStrategy();

  it('picks the mailbox with the most remaining capacity', () => {
    // remaining 5, 30, 10 → picks 30
    const cs = [
      candidate({ mailboxId: 'a', dailyLimit: 50, sentToday: 45 }),
      candidate({ mailboxId: 'b', dailyLimit: 100, sentToday: 70 }),
      candidate({ mailboxId: 'c', dailyLimit: 20, sentToday: 10 }),
    ];
    expect(strategy.select(cs, ctx)?.mailboxId).toBe('b');
  });

  it('excludes candidates with no remaining capacity', () => {
    const cs = [
      candidate({ mailboxId: 'a', dailyLimit: 10, sentToday: 10 }),
      candidate({ mailboxId: 'b', dailyLimit: 50, sentToday: 25 }),
    ];
    expect(strategy.select(cs, ctx)?.mailboxId).toBe('b');
  });

  it('excludes DEGRADED when policy is EXCLUDE', () => {
    const cs = [
      candidate({ mailboxId: 'a', dailyLimit: 100, sentToday: 0, healthStatus: 'DEGRADED' }),
      candidate({ mailboxId: 'b', dailyLimit: 20, sentToday: 0 }),
    ];
    expect(strategy.select(cs, { ...ctx, degradedPolicy: 'EXCLUDE' })?.mailboxId).toBe('b');
    expect(strategy.select(cs, { ...ctx, degradedPolicy: 'ALLOW' })?.mailboxId).toBe('a');
  });
});

import { describe, expect, it } from 'vitest';
import { RoundRobinStrategy } from './round-robin.js';
import type { AllocationCandidate, StrategyContext } from '../types.js';

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

const ctx: StrategyContext = { now: new Date(), degradedPolicy: 'ALLOW' };

describe('RoundRobinStrategy', () => {
  const strategy = new RoundRobinStrategy();

  it('returns first candidate when no cursor', () => {
    const result = strategy.select(
      [candidate({ mailboxId: 'a' }), candidate({ mailboxId: 'b' }), candidate({ mailboxId: 'c' })],
      ctx,
    );
    expect(result?.mailboxId).toBe('a');
  });

  it('advances to next candidate after last cursor', () => {
    const cs = [
      candidate({ mailboxId: 'a' }),
      candidate({ mailboxId: 'b' }),
      candidate({ mailboxId: 'c' }),
    ];
    expect(strategy.select(cs, { ...ctx, lastRoundRobinMailboxId: 'a' })?.mailboxId).toBe('b');
    expect(strategy.select(cs, { ...ctx, lastRoundRobinMailboxId: 'b' })?.mailboxId).toBe('c');
    expect(strategy.select(cs, { ...ctx, lastRoundRobinMailboxId: 'c' })?.mailboxId).toBe('a');
  });

  it('skips mailboxes with no remaining capacity', () => {
    const result = strategy.select(
      [
        candidate({ mailboxId: 'a', dailyLimit: 10, sentToday: 10 }),
        candidate({ mailboxId: 'b' }),
      ],
      ctx,
    );
    expect(result?.mailboxId).toBe('b');
  });

  it('respects priority tie-breaking within same rotation', () => {
    const result = strategy.select(
      [
        candidate({ mailboxId: 'a', priority: 0 }),
        candidate({ mailboxId: 'b', priority: 10 }),
      ],
      ctx,
    );
    expect(result?.mailboxId).toBe('b');
  });

  it('returns null when all pool members disabled', () => {
    const result = strategy.select(
      [candidate({ mailboxId: 'a', poolMemberEnabled: false })],
      ctx,
    );
    expect(result).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { filterEligibleAccounts, type CandidateMailbox } from './eligibility.js';

function candidate(overrides: Partial<CandidateMailbox> = {}): CandidateMailbox {
  return {
    id: 'mb_1',
    status: 'ACTIVE',
    healthStatus: 'HEALTHY',
    dailySendingLimit: 100,
    currentDailyUsage: 0,
    verifiedAt: new Date(),
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    poolMemberEnabled: true,
    priority: 0,
    reservedToday: 0,
    warmupSentToday: 0,
    warmupReservedToday: 0,
    ...overrides,
  };
}

describe('filterEligibleAccounts', () => {
  it('accepts a healthy verified mailbox', () => {
    const { eligible, rejected } = filterEligibleAccounts([candidate()], 'ALLOW');
    expect(eligible).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it('rejects disabled pool members', () => {
    const { eligible, rejected } = filterEligibleAccounts(
      [candidate({ poolMemberEnabled: false })],
      'ALLOW',
    );
    expect(eligible).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('POOL_MEMBER_DISABLED');
  });

  it('rejects unverified mailboxes', () => {
    const { eligible, rejected } = filterEligibleAccounts(
      [candidate({ verifiedAt: null, status: 'UNVERIFIED' })],
      'ALLOW',
    );
    expect(eligible).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('UNVERIFIED');
  });

  it('rejects mailboxes at daily limit including reservations', () => {
    const { eligible, rejected } = filterEligibleAccounts(
      [candidate({ dailySendingLimit: 10, currentDailyUsage: 5, reservedToday: 5 })],
      'ALLOW',
    );
    expect(eligible).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('DAILY_LIMIT_EXHAUSTED');
  });

  it('subtracts warmup usage when computing remaining capacity', () => {
    const { eligible, rejected } = filterEligibleAccounts(
      [
        candidate({
          dailySendingLimit: 50,
          currentDailyUsage: 0,
          reservedToday: 0,
          warmupSentToday: 40,
          warmupReservedToday: 10,
        }),
      ],
      'ALLOW',
    );
    expect(eligible).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('DAILY_LIMIT_EXHAUSTED');
  });

  it('shares account capacity between campaign and warmup usage', () => {
    const { eligible } = filterEligibleAccounts(
      [
        candidate({
          dailySendingLimit: 50,
          currentDailyUsage: 30,
          reservedToday: 0,
          warmupSentToday: 15,
          warmupReservedToday: 0,
        }),
      ],
      'ALLOW',
    );
    expect(eligible).toHaveLength(1);
  });

  it('rejects UNHEALTHY mailboxes', () => {
    const { eligible, rejected } = filterEligibleAccounts(
      [candidate({ healthStatus: 'UNHEALTHY' })],
      'ALLOW',
    );
    expect(eligible).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('UNHEALTHY');
  });

  it('excludes DEGRADED when workspace policy is EXCLUDE', () => {
    const { eligible, rejected } = filterEligibleAccounts(
      [candidate({ healthStatus: 'DEGRADED' })],
      'EXCLUDE',
    );
    expect(eligible).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('DEGRADED_EXCLUDED');
  });

  it('allows DEGRADED when workspace policy is ALLOW', () => {
    const { eligible } = filterEligibleAccounts(
      [candidate({ healthStatus: 'DEGRADED' })],
      'ALLOW',
    );
    expect(eligible).toHaveLength(1);
    expect(eligible[0]?.healthStatus).toBe('DEGRADED');
  });
});

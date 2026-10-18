import { describe, expect, it } from 'vitest';
import { evaluateMailboxEligibility } from './eligibility-rules.js';

function makeMailbox(overrides: Partial<Parameters<typeof evaluateMailboxEligibility>[0]> = {}) {
  return {
    status: 'ACTIVE',
    healthStatus: 'HEALTHY',
    dailySendingLimit: 100,
    currentDailyUsage: 0,
    verifiedAt: new Date(),
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    ...overrides,
  };
}

describe('evaluateMailboxEligibility', () => {
  it('marks a verified active healthy mailbox as eligible', () => {
    const result = evaluateMailboxEligibility(makeMailbox());
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe('ELIGIBLE');
    expect(result.remainingToday).toBe(100);
  });

  it('rejects disabled accounts', () => {
    const result = evaluateMailboxEligibility(makeMailbox({ status: 'DISABLED' }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('DISABLED');
  });

  it('rejects unverified accounts even if status is ACTIVE', () => {
    const result = evaluateMailboxEligibility(makeMailbox({ verifiedAt: null }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('UNVERIFIED');
  });

  it('rejects accounts in error state', () => {
    const result = evaluateMailboxEligibility(makeMailbox({ status: 'ERROR' }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('ERROR');
  });

  it('rejects unhealthy accounts', () => {
    const result = evaluateMailboxEligibility(makeMailbox({ healthStatus: 'UNHEALTHY' }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('UNHEALTHY');
  });

  it('rejects accounts that hit their daily limit', () => {
    const result = evaluateMailboxEligibility(
      makeMailbox({ dailySendingLimit: 50, currentDailyUsage: 50 }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('DAILY_LIMIT_EXHAUSTED');
    expect(result.remainingToday).toBe(0);
  });

  it('rejects accounts missing SMTP host/port', () => {
    const result = evaluateMailboxEligibility(
      makeMailbox({ smtpHost: null, smtpPort: null }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('MISSING_CREDENTIALS');
  });
});

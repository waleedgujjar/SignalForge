import { describe, expect, it, beforeEach } from 'vitest';
import { selectMailbox, resetRoundRobin } from './rotation-engine.js';

describe('SMTP Rotation Engine', () => {
  beforeEach(() => resetRoundRobin());

  const mailboxes = [
    {
      id: 'a',
      status: 'ACTIVE',
      healthStatus: 'HEALTHY' as const,
      dailySendingLimit: 100,
      currentDailyUsage: 80,
    },
    {
      id: 'b',
      status: 'ACTIVE',
      healthStatus: 'HEALTHY' as const,
      dailySendingLimit: 100,
      currentDailyUsage: 30,
    },
    {
      id: 'c',
      status: 'ACTIVE',
      healthStatus: 'UNHEALTHY' as const,
      dailySendingLimit: 100,
      currentDailyUsage: 0,
    },
  ];

  it('excludes unhealthy mailboxes with health-aware strategy', () => {
    const result = selectMailbox(mailboxes, 'HEALTH_AWARE');
    expect(result.mailboxId).toBe('b');
    expect(result.mailboxId).not.toBe('c');
  });

  it('selects least utilized mailbox', () => {
    const result = selectMailbox(mailboxes, 'LEAST_UTILIZED');
    expect(result.mailboxId).toBe('b');
  });
});

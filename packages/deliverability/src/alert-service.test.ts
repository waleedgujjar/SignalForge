import { describe, expect, it } from 'vitest';

import { buildDedupeKey, dailyWindow } from './alert-service.js';

describe('dailyWindow', () => {
  it('buckets timestamps by UTC day', () => {
    expect(dailyWindow(new Date('2026-03-04T01:15:00.000Z'))).toBe('2026-03-04');
    expect(dailyWindow(new Date('2026-03-04T23:59:59.000Z'))).toBe('2026-03-04');
  });
});

describe('buildDedupeKey', () => {
  const base = {
    alertType: 'ELEVATED_BOUNCE_RATE',
    entityType: 'MAILBOX',
    entityId: 'mailbox-1',
  };

  it('collapses repeated observations of the same issue within a day', () => {
    const morning = buildDedupeKey({
      ...base,
      window: dailyWindow(new Date('2026-03-04T08:00:00.000Z')),
    });
    const evening = buildDedupeKey({
      ...base,
      window: dailyWindow(new Date('2026-03-04T20:00:00.000Z')),
    });

    expect(morning).toBe(evening);
  });

  it('produces a new key on the next day so a persistent issue is re-surfaced', () => {
    const today = buildDedupeKey({ ...base, window: '2026-03-04' });
    const tomorrow = buildDedupeKey({ ...base, window: '2026-03-05' });
    expect(today).not.toBe(tomorrow);
  });

  it('keeps alerts for different mailboxes separate', () => {
    const first = buildDedupeKey({ ...base, window: '2026-03-04' });
    const second = buildDedupeKey({ ...base, entityId: 'mailbox-2', window: '2026-03-04' });
    expect(first).not.toBe(second);
  });

  it('keeps different alert types separate for the same mailbox', () => {
    const bounce = buildDedupeKey({ ...base, window: '2026-03-04' });
    const failure = buildDedupeKey({
      ...base,
      alertType: 'ELEVATED_FAILURE_RATE',
      window: '2026-03-04',
    });
    expect(bounce).not.toBe(failure);
  });

  it('handles workspace-level alerts that have no entity id', () => {
    const key = buildDedupeKey({
      alertType: 'ELEVATED_BOUNCE_RATE',
      entityType: 'WORKSPACE',
      window: '2026-03-04',
    });
    expect(key).toContain('none');
  });
});

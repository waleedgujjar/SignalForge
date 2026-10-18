import { describe, expect, it } from 'vitest';

import { buildIdempotencyKey } from './delivery-event-service.js';

describe('buildIdempotencyKey', () => {
  it('produces the same key for the same event, so a retried job cannot double-count', () => {
    const first = buildIdempotencyKey(['SENT', 'job-1', 'message-1']);
    const second = buildIdempotencyKey(['SENT', 'job-1', 'message-1']);
    expect(first).toBe(second);
  });

  it('produces different keys for different events on the same job', () => {
    expect(buildIdempotencyKey(['SENT', 'job-1'])).not.toBe(
      buildIdempotencyKey(['BOUNCED', 'job-1']),
    );
  });

  it('ignores null and undefined parts so optional ids do not change the key', () => {
    expect(buildIdempotencyKey(['REPLY', null, 'lead-1', undefined])).toBe(
      buildIdempotencyKey(['REPLY', 'lead-1']),
    );
  });

  it('returns a fixed-length hex key that fits the database column', () => {
    const key = buildIdempotencyKey(['SENT', 'x'.repeat(5000)]);
    expect(key).toHaveLength(48);
    expect(key).toMatch(/^[0-9a-f]+$/);
  });
});

import { describe, expect, it } from 'vitest';
import { classifySendError, retryBackoffMs } from './error-classifier.js';

describe('classifySendError', () => {
  it('classifies auth failures', () => {
    const result = classifySendError(new Error('535 Authentication failed'));
    expect(result.category).toBe('AUTH');
    expect(result.retryable).toBe(false);
  });

  it('classifies rate limit errors as retryable', () => {
    const result = classifySendError('421 Too many messages');
    expect(result.category).toBe('RATE_LIMIT');
    expect(result.retryable).toBe(true);
  });

  it('classifies connection timeouts as retryable', () => {
    const result = classifySendError(new Error('ETIMEDOUT connecting to smtp.example.com'));
    expect(result.category).toBe('CONNECTION');
    expect(result.retryable).toBe(true);
  });

  it('classifies 550 bounces as permanent', () => {
    const result = classifySendError('550 mailbox unavailable');
    expect(result.category).toBe('INVALID_ADDRESS');
    expect(result.retryable).toBe(false);
  });

  it('falls back to PERMANENT for 5xx', () => {
    const result = classifySendError('Server said 554 rejected');
    expect(result.category).toBe('PERMANENT');
    expect(result.retryable).toBe(false);
  });

  it('falls back to TEMPORARY for 4xx', () => {
    const result = classifySendError('Server said 452 not now');
    expect(result.category).toBe('TEMPORARY');
    expect(result.retryable).toBe(true);
  });

  it('falls back to UNKNOWN for unclassified errors', () => {
    const result = classifySendError('mysterious failure');
    expect(result.category).toBe('UNKNOWN');
    expect(result.retryable).toBe(true);
  });
});

describe('retryBackoffMs', () => {
  it('grows with attempts', () => {
    const a1 = retryBackoffMs(1);
    const a2 = retryBackoffMs(2);
    const a3 = retryBackoffMs(3);
    expect(a2).toBeGreaterThan(a1);
    expect(a3).toBeGreaterThan(a2);
  });

  it('caps at the last table value for high attempts', () => {
    const capped = retryBackoffMs(100);
    expect(capped).toBe(60 * 60_000);
  });
});

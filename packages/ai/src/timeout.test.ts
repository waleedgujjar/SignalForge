import { describe, expect, it } from 'vitest';
import { createRequestTimeout, AI_TIMEOUT_MS, AI_HEAVY_TIMEOUT_MS } from './timeout.js';

describe('createRequestTimeout', () => {
  it('returns an AbortSignal that is not aborted initially', () => {
    const { signal, clear } = createRequestTimeout(5000);
    expect(signal.aborted).toBe(false);
    clear();
  });

  it('aborts the signal after the specified duration', async () => {
    const { signal } = createRequestTimeout(50);
    await new Promise((r) => setTimeout(r, 100));
    expect(signal.aborted).toBe(true);
  });

  it('does not abort if clear() is called before timeout', async () => {
    const { signal, clear } = createRequestTimeout(50);
    clear();
    await new Promise((r) => setTimeout(r, 100));
    expect(signal.aborted).toBe(false);
  });
});

describe('timeout constants', () => {
  it('AI_TIMEOUT_MS is 60 seconds', () => {
    expect(AI_TIMEOUT_MS).toBe(60_000);
  });

  it('AI_HEAVY_TIMEOUT_MS is 90 seconds', () => {
    expect(AI_HEAVY_TIMEOUT_MS).toBe(90_000);
  });
});

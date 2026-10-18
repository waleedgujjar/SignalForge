import { describe, expect, it } from 'vitest';
import { checkSuppression } from './suppression-engine.js';

describe('SuppressionEngine', () => {
  const suppressions = [
    { type: 'EMAIL' as const, value: 'blocked@example.com', reason: 'MANUAL' as const },
    { type: 'DOMAIN' as const, value: 'spam.com', reason: 'BOUNCED' as const },
  ];

  it('blocks suppressed email', () => {
    const result = checkSuppression('blocked@example.com', suppressions);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toBe('MANUAL');
  });

  it('blocks suppressed domain', () => {
    const result = checkSuppression('user@spam.com', suppressions);
    expect(result.suppressed).toBe(true);
    expect(result.matchedType).toBe('DOMAIN');
  });

  it('allows non-suppressed email', () => {
    const result = checkSuppression('valid@company.com', suppressions);
    expect(result.suppressed).toBe(false);
  });
});

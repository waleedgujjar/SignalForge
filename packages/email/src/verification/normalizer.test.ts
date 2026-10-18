import { describe, expect, it } from 'vitest';
import { normalizeEmail } from './normalizer.js';

describe('normalizeEmail', () => {
  it('lowercases domain and trims whitespace', () => {
    const result = normalizeEmail('  User@Example.COM  ');
    expect(result.valid).toBe(true);
    expect(result.normalizedEmail).toBe('User@example.com');
    expect(result.domain).toBe('example.com');
  });

  it('rejects missing @ symbol', () => {
    const result = normalizeEmail('not-an-email');
    expect(result.valid).toBe(false);
  });
});

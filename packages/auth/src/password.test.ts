import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('auth password', () => {
  it('hashes and verifies passwords', () => {
    const hash = hashPassword('secure-password');
    expect(hash).not.toContain('secure-password');
    expect(verifyPassword('secure-password', hash)).toBe(true);
    expect(verifyPassword('wrong-password', hash)).toBe(false);
  });
});

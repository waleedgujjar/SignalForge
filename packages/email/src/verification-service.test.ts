import { describe, expect, it } from 'vitest';
import { verifyEmail } from './verification-service.js';

describe('EmailVerificationService', () => {
  it('rejects invalid syntax', async () => {
    const result = await verifyEmail('not-an-email');
    expect(result.status).toBe('INVALID');
  });

  it('detects disposable domains', async () => {
    const result = await verifyEmail('test@mailinator.com');
    expect(result.status).toBe('DISPOSABLE');
  });

  it('detects role-based emails', async () => {
    const result = await verifyEmail('admin@example.com');
    expect(result.status).toBe('ROLE_BASED');
  });
});

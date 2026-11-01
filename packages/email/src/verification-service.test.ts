import { describe, expect, it, vi } from 'vitest';

// Keep this suite off the network: the engine's DNS/SMTP steps are covered in
// verification/verification-engine.test.ts.
vi.mock('./verification/domain-validator.js', () => ({
  validateDomain: vi.fn(async () => ({ result: 'DOMAIN_VALID', dnsResolved: true, domainValid: true })),
}));
vi.mock('./verification/mx-verifier.js', () => ({
  verifyMx: vi.fn(async () => ({
    mxFound: true,
    mxRecords: [{ exchange: 'mx.acme.test', priority: 10 }],
    mxStatus: 'VALID',
    mailServers: ['mx.acme.test'],
    mailServer: 'mx.acme.test',
  })),
}));
vi.mock('./verification/smtp-verifier.js', () => ({
  verifySmtpRecipient: vi.fn(async () => ({ status: 'ACCEPTED', response: '250 OK', catchAll: false })),
  isSmtpUnavailable: () => false,
}));

const { verifyEmail } = await import('./verification-service.js');

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
    const result = await verifyEmail('admin@acme.test');
    expect(result.status).toBe('ROLE_BASED');
  });
});

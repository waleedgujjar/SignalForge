import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmtpVerifyResult } from './smtp-verifier.js';

const dns = vi.hoisted(() => ({
  domain: { result: 'DOMAIN_VALID', dnsResolved: true, domainValid: true } as {
    result: string;
    dnsResolved: boolean;
    domainValid: boolean;
  },
  mx: {
    mxFound: true,
    mxRecords: [{ exchange: 'aspmx.l.google.com', priority: 1 }],
    mxStatus: 'VALID',
    mailServers: ['aspmx.l.google.com', 'alt1.aspmx.l.google.com'],
    mailServer: 'aspmx.l.google.com',
  } as Record<string, unknown>,
  smtp: { status: 'ACCEPTED', response: '250 2.1.5 OK', catchAll: false } as SmtpVerifyResult,
  smtpUnavailable: false,
  smtpCalls: 0,
}));

vi.mock('./domain-validator.js', () => ({ validateDomain: vi.fn(async () => dns.domain) }));
vi.mock('./mx-verifier.js', () => ({ verifyMx: vi.fn(async () => dns.mx) }));
vi.mock('./smtp-verifier.js', () => ({
  verifySmtpRecipient: vi.fn(async () => {
    dns.smtpCalls++;
    return dns.smtp;
  }),
  isSmtpUnavailable: () => dns.smtpUnavailable,
}));

const { EmailVerificationEngine, resetCatchAllCacheForTests } = await import('./verification-engine.js');
const engine = new EmailVerificationEngine();

beforeEach(() => {
  resetCatchAllCacheForTests();
  dns.domain = { result: 'DOMAIN_VALID', dnsResolved: true, domainValid: true };
  dns.mx = {
    mxFound: true,
    mxRecords: [{ exchange: 'aspmx.l.google.com', priority: 1 }],
    mxStatus: 'VALID',
    mailServers: ['aspmx.l.google.com'],
    mailServer: 'aspmx.l.google.com',
  };
  dns.smtp = { status: 'ACCEPTED', response: '250 2.1.5 OK', catchAll: false };
  dns.smtpUnavailable = false;
  dns.smtpCalls = 0;
  process.env.EMAIL_VERIFICATION_SMTP_ENABLED = 'true';
});

describe('EmailVerificationEngine', () => {
  it('marks a mailbox the server accepts (non catch-all) as VERIFIED with evidence', async () => {
    const r = await engine.verify('waleed@excersys.com');
    expect(r.status).toBe('VERIFIED');
    expect(r.reasonCode).toBe('VALID_SMTP_ACCEPTED');
    expect(r.riskLevel).toBe('LOW');
    expect(r.confidenceScore).toBeGreaterThanOrEqual(90);
    expect(r.checks.map((c) => c.check)).toEqual(['syntax', 'disposable', 'role', 'domain', 'mx', 'smtp', 'catch_all']);
    expect(r.smtpResponse).toBe('250 2.1.5 OK');
    expect(r.verificationVersion).toBe('v2');
  });

  it('reports a catch-all domain as CATCH_ALL, not RISKY', async () => {
    dns.smtp = { status: 'ACCEPTED', response: '250 OK', catchAll: true };
    const r = await engine.verify('waleed@excersys.com');
    expect(r.status).toBe('CATCH_ALL');
    expect(r.isCatchAll).toBe(true);
    expect(r.riskLevel).toBe('MEDIUM');
  });

  it('reuses the cached catch-all verdict for the same domain', async () => {
    dns.smtp = { status: 'ACCEPTED', response: '250 OK', catchAll: true };
    await engine.verify('a.person@corp.example');
    dns.smtp = { status: 'ACCEPTED', response: '250 OK' }; // probe not run this time
    const r = await engine.verify('b.person@corp.example');
    expect(r.status).toBe('CATCH_ALL');
  });

  it('marks a mailbox the server says does not exist as INVALID', async () => {
    dns.smtp = { status: 'REJECTED', response: '550 5.1.1 The email account that you tried to reach does not exist' };
    const r = await engine.verify('nobody-here@gmail.com');
    expect(r.status).toBe('INVALID');
    expect(r.reasonCode).toBe('SMTP_REJECTED');
  });

  it.each([
    ['UNAVAILABLE', 'SMTP_UNAVAILABLE'],
    ['TIMEOUT', 'SMTP_TIMEOUT'],
    ['BLOCKED', 'SMTP_BLOCKED'],
    ['TEMPORARY_FAILURE', 'SMTP_TEMPORARY_FAILURE'],
  ] as const)('does not treat SMTP %s as risky: UNKNOWN with low risk', async (status, reason) => {
    dns.smtp = { status };
    const r = await engine.verify('waleednisar687@gmail.com');
    expect(r.status).toBe('UNKNOWN');
    expect(r.reasonCode).toBe(reason);
    expect(r.riskLevel).toBe('LOW');
    expect(r.domainValid).toBe(true);
    expect(r.mxFound).toBe(true);
  });

  it('skips the SMTP probe entirely once port 25 is known to be blocked', async () => {
    dns.smtpUnavailable = true;
    const r = await engine.verify('waleednisar687@gmail.com');
    expect(r.status).toBe('UNKNOWN');
    expect(r.reasonCode).toBe('SMTP_UNAVAILABLE');
    expect(dns.smtpCalls).toBe(0);
  });

  it('never reports VERIFIED without SMTP evidence', async () => {
    process.env.EMAIL_VERIFICATION_SMTP_ENABLED = 'false';
    const r = await engine.verify('waleed@excersys.com');
    expect(r.status).toBe('UNKNOWN');
    expect(r.reasonCode).toBe('SMTP_SKIPPED');
  });

  it('marks role addresses ROLE_BASED, but INVALID when the mailbox is rejected', async () => {
    expect((await engine.verify('info@excersys.com')).status).toBe('ROLE_BASED');
    dns.smtp = { status: 'REJECTED', response: '550 5.1.1 user unknown' };
    expect((await engine.verify('support@excersys.com')).status).toBe('INVALID');
  });

  it('flags a full mailbox as RISKY', async () => {
    dns.smtp = { status: 'MAILBOX_FULL', response: '552 5.2.2 Mailbox full' };
    expect((await engine.verify('busy@excersys.com')).status).toBe('RISKY');
  });

  it('detects disposable providers including subdomains without network calls', async () => {
    const r = await engine.verify('someone@inbox.mailinator.com');
    expect(r.status).toBe('DISPOSABLE');
    expect(dns.smtpCalls).toBe(0);
  });

  it('rejects malformed addresses', async () => {
    expect((await engine.verify('not-an-email')).status).toBe('INVALID');
    expect((await engine.verify('a..b@example.com')).status).toBe('INVALID');
  });

  it('marks a non-existent domain INVALID and a DNS outage UNKNOWN', async () => {
    dns.domain = { result: 'DOMAIN_NOT_FOUND', dnsResolved: false, domainValid: false };
    expect((await engine.verify('x@no-such-domain-zz.com')).status).toBe('INVALID');
    dns.domain = { result: 'DNS_ERROR', dnsResolved: false, domainValid: false };
    const r = await engine.verify('x@excersys.com');
    expect(r.status).toBe('UNKNOWN');
    expect(r.reasonCode).toBe('DNS_FAILURE');
  });

  it('marks a null-MX domain INVALID', async () => {
    dns.mx = { mxFound: false, mxRecords: [{ exchange: '', priority: 0 }], mxStatus: 'NULL_MX', mailServers: [], mailServer: null };
    const r = await engine.verify('x@example.com');
    expect(r.status).toBe('INVALID');
    expect(r.reasonCode).toBe('NULL_MX');
  });
});

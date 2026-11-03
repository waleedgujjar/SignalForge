import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    domainHealthCheck: { findUnique: vi.fn() },
    mailboxHealth: { findUnique: vi.fn() },
  },
}));
vi.mock('@signalforge/database', () => ({ prisma }));

import { getDomainAuthHold, getReputationHold } from './warmup-gate.js';

beforeEach(() => vi.clearAllMocks());

describe('getDomainAuthHold', () => {
  it('holds when DKIM is FAIL for the domain', async () => {
    prisma.domainHealthCheck.findUnique.mockResolvedValueOnce({ spfStatus: 'PASS', dkimStatus: 'FAIL' });
    const r = await getDomainAuthHold('ws', 'sender@rankologic.com');
    expect(r.held).toBe(true);
    expect(r.reason).toMatch(/DKIM/);
  });

  it('holds when SPF is INVALID', async () => {
    prisma.domainHealthCheck.findUnique.mockResolvedValueOnce({ spfStatus: 'INVALID', dkimStatus: 'PASS' });
    expect((await getDomainAuthHold('ws', 'a@x.com')).held).toBe(true);
  });

  it('does not hold when SPF+DKIM pass', async () => {
    prisma.domainHealthCheck.findUnique.mockResolvedValueOnce({ spfStatus: 'PASS', dkimStatus: 'PASS' });
    expect((await getDomainAuthHold('ws', 'a@websiterankerrs.tech')).held).toBe(false);
  });

  it('does not hold on UNKNOWN or when the domain was never checked', async () => {
    prisma.domainHealthCheck.findUnique.mockResolvedValueOnce({ spfStatus: 'UNKNOWN', dkimStatus: 'UNKNOWN' });
    expect((await getDomainAuthHold('ws', 'a@x.com')).held).toBe(false);
    prisma.domainHealthCheck.findUnique.mockResolvedValueOnce(null);
    expect((await getDomainAuthHold('ws', 'a@x.com')).held).toBe(false);
  });

  it('does not hold when the address has no domain', async () => {
    expect((await getDomainAuthHold('ws', 'not-an-email')).held).toBe(false);
  });
});

describe('getReputationHold', () => {
  it('holds when the mailbox is AT_RISK or CRITICAL', async () => {
    prisma.mailboxHealth.findUnique.mockResolvedValueOnce({ protectionLevel: 'CRITICAL', protectionReason: 'bounce spike' });
    const r = await getReputationHold('mb');
    expect(r.held).toBe(true);
    expect(r.reason).toBe('bounce spike');
  });

  it('does not hold at NORMAL/WARNING or when no health row exists', async () => {
    prisma.mailboxHealth.findUnique.mockResolvedValueOnce({ protectionLevel: 'WARNING', protectionReason: null });
    expect((await getReputationHold('mb')).held).toBe(false);
    prisma.mailboxHealth.findUnique.mockResolvedValueOnce(null);
    expect((await getReputationHold('mb')).held).toBe(false);
  });
});

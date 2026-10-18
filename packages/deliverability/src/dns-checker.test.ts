import { describe, expect, it } from 'vitest';

import {
  checkDomainAuth,
  evaluateDkimRecord,
  evaluateDmarcRecord,
  evaluateSpfRecord,
  normalizeDomain,
  type DnsResolverLike,
} from './dns-checker.js';

describe('normalizeDomain', () => {
  it('strips schemes, paths, and local parts', () => {
    expect(normalizeDomain('https://Example.com/path')).toBe('example.com');
    expect(normalizeDomain('  sales@Example.COM ')).toBe('example.com');
    expect(normalizeDomain('example.com')).toBe('example.com');
  });
});

describe('evaluateSpfRecord', () => {
  it('passes a single well-formed record', () => {
    expect(evaluateSpfRecord(['v=spf1 include:_spf.google.com ~all']).status).toBe('PASS');
  });

  it('fails when no SPF record is published', () => {
    expect(evaluateSpfRecord(['google-site-verification=abc']).status).toBe('FAIL');
  });

  it('flags multiple SPF records as invalid', () => {
    const result = evaluateSpfRecord(['v=spf1 include:a ~all', 'v=spf1 include:b -all']);
    expect(result.status).toBe('INVALID');
  });

  it('flags a record with no terminating mechanism as invalid', () => {
    expect(evaluateSpfRecord(['v=spf1 include:_spf.example.com']).status).toBe('INVALID');
  });

  it('accepts a redirect modifier in place of an all mechanism', () => {
    expect(evaluateSpfRecord(['v=spf1 redirect=_spf.example.com']).status).toBe('PASS');
  });
});

describe('evaluateDmarcRecord', () => {
  it('passes and extracts the policy', () => {
    const result = evaluateDmarcRecord(['v=DMARC1; p=quarantine; rua=mailto:d@example.com']);
    expect(result.status).toBe('PASS');
    expect(result.policy).toBe('quarantine');
  });

  it('fails when no DMARC record exists', () => {
    expect(evaluateDmarcRecord([]).status).toBe('FAIL');
  });

  it('flags a record without an explicit policy as invalid', () => {
    expect(evaluateDmarcRecord(['v=DMARC1; rua=mailto:d@example.com']).status).toBe('INVALID');
  });
});

describe('evaluateDkimRecord', () => {
  it('passes when a public key is published', () => {
    expect(evaluateDkimRecord(['v=DKIM1; k=rsa; p=MIGfMA0GCSq']).status).toBe('PASS');
  });

  it('flags a revoked key (empty p=) as invalid', () => {
    expect(evaluateDkimRecord(['v=DKIM1; k=rsa; p=']).status).toBe('INVALID');
  });

  it('fails when the selector host has no DKIM record', () => {
    expect(evaluateDkimRecord([]).status).toBe('FAIL');
  });
});

function resolver(overrides: Partial<DnsResolverLike> = {}): DnsResolverLike {
  return {
    resolveTxt: async () => [],
    resolveMx: async () => [],
    ...overrides,
  };
}

describe('checkDomainAuth', () => {
  it('reports a fully configured domain', async () => {
    const result = await checkDomainAuth('example.com', {
      dkimSelectors: ['s1'],
      resolver: resolver({
        resolveTxt: async (hostname) => {
          if (hostname === '_dmarc.example.com') return [['v=DMARC1; p=reject']];
          if (hostname === 's1._domainkey.example.com') return [['v=DKIM1; p=MIGfMA0']];
          return [['v=spf1 include:_spf.example.com -all']];
        },
        resolveMx: async () => [{ exchange: 'mx.example.com', priority: 10 }],
      }),
    });

    expect(result.spfStatus).toBe('PASS');
    expect(result.dmarcStatus).toBe('PASS');
    expect(result.dkimStatus).toBe('PASS');
    expect(result.mxStatus).toBe('PASS');
    expect(result.dmarcPolicy).toBe('reject');
    expect(result.lastError).toBeNull();
  });

  it('leaves DKIM unknown when no selector is supplied', async () => {
    const result = await checkDomainAuth('example.com', {
      resolver: resolver({ resolveTxt: async () => [['v=spf1 -all']] }),
    });

    expect(result.dkimStatus).toBe('UNKNOWN');
    expect(result.dkimSelectors).toHaveLength(0);
  });

  it('reports UNKNOWN rather than FAIL when a lookup errors', async () => {
    const result = await checkDomainAuth('example.com', {
      resolver: resolver({
        resolveTxt: async () => {
          throw new Error('queryTxt ETIMEOUT example.com');
        },
        resolveMx: async () => {
          throw new Error('queryMx ETIMEOUT example.com');
        },
      }),
    });

    expect(result.spfStatus).toBe('UNKNOWN');
    expect(result.dmarcStatus).toBe('UNKNOWN');
    expect(result.mxStatus).toBe('UNKNOWN');
    expect(result.lastError).toContain('SPF');
  });

  it('reports UNKNOWN when a lookup exceeds the timeout', async () => {
    const result = await checkDomainAuth('example.com', {
      timeoutMs: 10,
      resolver: resolver({
        resolveTxt: () => new Promise(() => {}),
        resolveMx: () => new Promise(() => {}),
      }),
    });

    expect(result.spfStatus).toBe('UNKNOWN');
    expect(result.lastError).toContain('timed out');
  });

  it('reports missing MX records as a failure', async () => {
    const result = await checkDomainAuth('example.com', {
      resolver: resolver({ resolveTxt: async () => [['v=spf1 -all']] }),
    });
    expect(result.mxStatus).toBe('FAIL');
  });

  it('rejects an unusable domain without making lookups', async () => {
    const result = await checkDomainAuth('   ');
    expect(result.lastError).toBe('Invalid domain.');
    expect(result.spfStatus).toBe('UNKNOWN');
  });
});

import { Resolver } from 'node:dns/promises';
import type { DnsCheckStatus, DomainAuthResult } from './types.js';

/**
 * Server-side SPF/DKIM/DMARC/MX inspection.
 *
 * Every lookup is timeout-bounded and failures resolve to UNKNOWN rather than
 * FAIL — a DNS timeout tells us nothing about the domain's configuration, and
 * reporting it as a failure would be misleading. Nothing here modifies DNS.
 */

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Selectors probed when the caller supplies none, so a domain's DKIM can be
 * detected without the operator knowing the exact selector. Covers Hostinger
 * (`hostingermail1/2/3`, published as CNAMEs that resolveTxt follows) plus the
 * common defaults used by Google Workspace and other providers. A selector that
 * resolves to no record counts toward a real FAIL; a lookup that times out stays
 * UNKNOWN (see the probe logic below).
 */
export const DEFAULT_DKIM_SELECTORS = [
  'hostingermail1',
  'hostingermail2',
  'hostingermail3',
  'default',
  'google',
  'selector1',
  'selector2',
  's1',
  's2',
  'k1',
  'dkim',
];

/// True when a DNS error means "this name has no such record" (NXDOMAIN /
/// ENODATA) rather than an inconclusive failure (timeout, SERVFAIL). Only the
/// former lets us conclude a selector is absent.
function isNoRecordError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? '';
  const message = error instanceof Error ? error.message : String(error);
  return /ENOTFOUND|ENODATA|NXDOMAIN/i.test(code) || /ENOTFOUND|ENODATA|NXDOMAIN/i.test(message);
}

export interface DnsLookupOptions {
  timeoutMs?: number;
  /// DKIM selectors to probe. DKIM stays UNKNOWN when none are supplied,
  /// because the presence of an SMTP account proves nothing about DKIM.
  dkimSelectors?: string[];
  resolver?: DnsResolverLike;
}

export interface DnsResolverLike {
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveMx(hostname: string): Promise<Array<{ exchange: string; priority: number }>>;
}

function createDefaultResolver(timeoutMs: number): DnsResolverLike {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  return {
    resolveTxt: (hostname) => resolver.resolveTxt(hostname),
    resolveMx: (hostname) => resolver.resolveMx(hostname),
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('DNS lookup timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function flattenTxt(records: string[][]): string[] {
  return records.map((chunks) => chunks.join(''));
}

export function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const withoutScheme = trimmed.replace(/^https?:\/\//, '');
  const host = withoutScheme.split('/')[0] ?? '';
  return host.includes('@') ? (host.split('@')[1] ?? '') : host;
}

export function evaluateSpfRecord(records: string[]): { status: DnsCheckStatus; record: string | null } {
  const spfRecords = records.filter((record) => record.toLowerCase().startsWith('v=spf1'));
  if (spfRecords.length === 0) return { status: 'FAIL', record: null };
  // RFC 7208 permits exactly one SPF record; multiple records are a hard config error.
  if (spfRecords.length > 1) return { status: 'INVALID', record: spfRecords.join(' | ') };

  const record = spfRecords[0] ?? '';
  const hasTerminator = /\s(?:[-~?+]all)\s*$/.test(record) || /\sredirect=/.test(record);
  return { status: hasTerminator ? 'PASS' : 'INVALID', record };
}

export function evaluateDmarcRecord(records: string[]): {
  status: DnsCheckStatus;
  policy: string | null;
  record: string | null;
} {
  const dmarcRecords = records.filter((record) => record.toLowerCase().startsWith('v=dmarc1'));
  if (dmarcRecords.length === 0) return { status: 'FAIL', policy: null, record: null };
  if (dmarcRecords.length > 1) return { status: 'INVALID', policy: null, record: dmarcRecords.join(' | ') };

  const record = dmarcRecords[0] ?? '';
  const policyMatch = /\bp\s*=\s*(none|quarantine|reject)\b/i.exec(record);
  if (!policyMatch) return { status: 'INVALID', policy: null, record };
  return { status: 'PASS', policy: policyMatch[1]?.toLowerCase() ?? null, record };
}

export function evaluateDkimRecord(records: string[]): { status: DnsCheckStatus; record: string | null } {
  const dkimRecords = records.filter(
    (record) => record.toLowerCase().includes('v=dkim1') || record.toLowerCase().includes('p='),
  );
  if (dkimRecords.length === 0) return { status: 'FAIL', record: null };

  const record = dkimRecords[0] ?? '';
  const keyMatch = /\bp\s*=\s*([A-Za-z0-9+/=]*)/.exec(record);
  // An empty p= value is how providers publish a revoked key.
  if (!keyMatch || keyMatch[1] === '') return { status: 'INVALID', record };
  return { status: 'PASS', record };
}

export async function checkDomainAuth(
  domain: string,
  options: DnsLookupOptions = {},
): Promise<DomainAuthResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const resolver = options.resolver ?? createDefaultResolver(timeoutMs);
  const normalized = normalizeDomain(domain);
  const selectors = options.dkimSelectors ?? [];
  const errors: string[] = [];

  const result: DomainAuthResult = {
    domain: normalized,
    spfStatus: 'UNKNOWN',
    dkimStatus: 'UNKNOWN',
    dmarcStatus: 'UNKNOWN',
    mxStatus: 'UNKNOWN',
    spfRecord: null,
    dmarcPolicy: null,
    dkimSelectors: [],
    lastError: null,
    checkedAt: new Date(),
  };

  if (!normalized) {
    return { ...result, lastError: 'Invalid domain.' };
  }

  const [spf, dmarc, mx] = await Promise.all([
    withTimeout(resolver.resolveTxt(normalized), timeoutMs)
      .then((records) => evaluateSpfRecord(flattenTxt(records)))
      .catch((error: unknown) => {
        errors.push(`SPF: ${errorMessage(error)}`);
        return null;
      }),
    withTimeout(resolver.resolveTxt(`_dmarc.${normalized}`), timeoutMs)
      .then((records) => evaluateDmarcRecord(flattenTxt(records)))
      .catch((error: unknown) => {
        errors.push(`DMARC: ${errorMessage(error)}`);
        return null;
      }),
    withTimeout(resolver.resolveMx(normalized), timeoutMs)
      .then((records) => (records.length > 0 ? ('PASS' as const) : ('FAIL' as const)))
      .catch((error: unknown) => {
        errors.push(`MX: ${errorMessage(error)}`);
        return null;
      }),
  ]);

  if (spf) {
    result.spfStatus = spf.status;
    result.spfRecord = spf.record;
  }
  if (dmarc) {
    result.dmarcStatus = dmarc.status;
    result.dmarcPolicy = dmarc.policy;
  }
  if (mx) {
    result.mxStatus = mx;
  }

  // Probe selectors in parallel — most resolve or NXDOMAIN quickly, so a long
  // default list does not serialize into a long wall-clock time.
  result.dkimSelectors = await Promise.all(
    selectors.map(async (selector) => {
      const host = `${selector}._domainkey.${normalized}`;
      try {
        const records = await withTimeout(resolver.resolveTxt(host), timeoutMs);
        const evaluated = evaluateDkimRecord(flattenTxt(records));
        return { selector, status: evaluated.status, record: evaluated.record };
      } catch (error) {
        const absent = isNoRecordError(error);
        // A definitively absent selector is a real FAIL signal; only truly
        // inconclusive errors (timeout/SERVFAIL) are reported and kept UNKNOWN.
        if (!absent) errors.push(`DKIM(${selector}): ${errorMessage(error)}`);
        return { selector, status: absent ? ('FAIL' as const) : ('UNKNOWN' as const), record: null };
      }
    }),
  );

  // Without a selector we cannot query DKIM at all, so it stays UNKNOWN.
  if (result.dkimSelectors.length > 0) {
    const statuses = result.dkimSelectors.map((entry) => entry.status);
    if (statuses.includes('PASS')) result.dkimStatus = 'PASS';
    else if (statuses.every((status) => status === 'UNKNOWN')) result.dkimStatus = 'UNKNOWN';
    else if (statuses.includes('INVALID')) result.dkimStatus = 'INVALID';
    else result.dkimStatus = 'FAIL';
  }

  result.lastError = errors.length > 0 ? errors.join('; ').slice(0, 500) : null;
  return result;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    // ENOTFOUND/ENODATA mean "no record", which the caller distinguishes from a
    // transport failure via the individual evaluate* results.
    return error.message;
  }
  return 'Unknown DNS error';
}

import { isBlockedHostname, resolveSafeAddresses } from './network-guard.js';
import type { MxRecord } from './types.js';

const DNS_TIMEOUT_MS = 5000;

export interface MxVerificationResult {
  mxFound: boolean;
  mxRecords: MxRecord[];
  mxStatus: 'VALID' | 'NONE' | 'ERROR' | 'TIMEOUT';
  mailServer: string | null;
}

export async function verifyMx(domain: string): Promise<MxVerificationResult> {
  if (!domain || isBlockedHostname(domain)) {
    return { mxFound: false, mxRecords: [], mxStatus: 'NONE', mailServer: null };
  }

  const { promises: dns } = await import('node:dns');
  try {
    const records = await withTimeout(dns.resolveMx(domain), DNS_TIMEOUT_MS);
    if (records.length > 0) {
      const mxRecords = records
        .map((r) => ({ exchange: r.exchange.toLowerCase(), priority: r.priority }))
        .sort((a, b) => a.priority - b.priority);
      return {
        mxFound: true,
        mxRecords,
        mxStatus: 'VALID',
        mailServer: mxRecords[0]?.exchange ?? null,
      };
    }

    // RFC 5321 fallback: A/AAAA record
    const safeIps = await resolveSafeAddresses(domain);
    if (safeIps.length > 0) {
      return {
        mxFound: true,
        mxRecords: [{ exchange: domain, priority: 0 }],
        mxStatus: 'VALID',
        mailServer: domain,
      };
    }

    return { mxFound: false, mxRecords: [], mxStatus: 'NONE', mailServer: null };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ETIMEOUT') {
      return { mxFound: false, mxRecords: [], mxStatus: 'TIMEOUT', mailServer: null };
    }
    return { mxFound: false, mxRecords: [], mxStatus: 'ERROR', mailServer: null };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => {
        const err = new Error('DNS timeout') as NodeJS.ErrnoException;
        err.code = 'ETIMEOUT';
        reject(err);
      }, ms),
    ),
  ]);
}

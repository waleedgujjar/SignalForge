import { lookup } from './dns-resolver.js';
import { isBlockedHostname, resolveSafeAddresses } from './network-guard.js';
import type { MxRecord } from './types.js';

export interface MxVerificationResult {
  mxFound: boolean;
  mxRecords: MxRecord[];
  mxStatus: 'VALID' | 'NONE' | 'NULL_MX' | 'ERROR' | 'TIMEOUT';
  /** Mail hosts in priority order (MX exchanges, or the domain itself as the RFC 5321 implicit MX). */
  mailServers: string[];
  /** First entry of mailServers, kept for existing callers. */
  mailServer: string | null;
}

export async function verifyMx(domain: string): Promise<MxVerificationResult> {
  if (!domain || isBlockedHostname(domain)) {
    return none('NONE');
  }

  const mx = await lookup((r) => r.resolveMx(domain));

  if (mx.kind === 'ok' && mx.value.length > 0) {
    const mxRecords = mx.value
      .map((r) => ({ exchange: r.exchange.toLowerCase().replace(/\.$/, ''), priority: r.priority }))
      .sort((a, b) => a.priority - b.priority);

    // RFC 7505 null MX ("MX 0 .") means the domain explicitly accepts no mail.
    if (mxRecords.length === 1 && mxRecords[0]!.exchange === '') {
      return { ...none('NULL_MX'), mxRecords };
    }

    const mailServers = mxRecords.map((r) => r.exchange).filter((h) => h && !isBlockedHostname(h));
    return {
      mxFound: mailServers.length > 0,
      mxRecords,
      mxStatus: mailServers.length > 0 ? 'VALID' : 'NONE',
      mailServers,
      mailServer: mailServers[0] ?? null,
    };
  }

  if (mx.kind === 'timeout') return none('TIMEOUT');
  if (mx.kind === 'error') return none('ERROR');

  // No MX records: RFC 5321 section 5.1 falls back to the domain's A record.
  const safeIps = await resolveSafeAddresses(domain);
  if (safeIps.length > 0) {
    return {
      mxFound: true,
      mxRecords: [{ exchange: domain, priority: 0 }],
      mxStatus: 'VALID',
      mailServers: [domain],
      mailServer: domain,
    };
  }
  return none('NONE');
}

function none(mxStatus: MxVerificationResult['mxStatus']): MxVerificationResult {
  return { mxFound: false, mxRecords: [], mxStatus, mailServers: [], mailServer: null };
}

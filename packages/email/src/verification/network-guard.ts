import { isIP } from 'node:net';

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

export function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith('.local') || lower.endsWith('.internal')) return true;
  return false;
}

export function isBlockedIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return true;
  const [a, b = 0] = parts;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;
  if (lower.startsWith('fe80:')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.replace('::ffff:', '');
    if (isIP(mapped) === 4) return isPrivateIpv4(mapped);
  }
  return false;
}

export async function resolveSafeAddresses(hostname: string): Promise<string[]> {
  if (isBlockedHostname(hostname)) return [];
  const { promises: dns } = await import('node:dns');
  try {
    const records = await dns.resolve4(hostname, { ttl: true });
    return records.map((r) => r.address).filter((ip) => !isBlockedIp(ip));
  } catch {
    return [];
  }
}

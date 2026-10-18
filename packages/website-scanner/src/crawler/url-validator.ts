import { lookup } from 'node:dns/promises';
import { URL } from 'node:url';

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

const BLOCKED_IPV6 = ['::1', '::ffff:127.0.0.1', 'fe80::'];

const BLOCKED_HOSTS = ['metadata.google.internal'];

function isPrivateIp(ip: string): boolean {
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  for (const range of PRIVATE_IP_RANGES) {
    if (range.test(ip)) return true;
  }
  for (const blocked of BLOCKED_IPV6) {
    if (ip === blocked || ip.startsWith('fe80:')) return true;
  }
  return false;
}

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SSRFError';
  }
}

export async function validateUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SSRFError(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SSRFError(`Blocked scheme: ${parsed.protocol}`);
  }

  if (parsed.username || parsed.password) {
    throw new SSRFError('URLs with credentials are not allowed');
  }

  const hostname = parsed.hostname;

  if (hostname === 'localhost' || hostname === '0.0.0.0') {
    throw new SSRFError(`Blocked hostname: ${hostname}`);
  }

  if (BLOCKED_HOSTS.includes(hostname)) {
    throw new SSRFError(`Blocked hostname: ${hostname}`);
  }

  const ipDirect = hostname.match(/^\d+\.\d+\.\d+\.\d+$/) || hostname.includes(':');
  if (ipDirect && isPrivateIp(hostname)) {
    throw new SSRFError(`Blocked private IP: ${hostname}`);
  }

  try {
    const result = await lookup(hostname);
    if (isPrivateIp(result.address)) {
      throw new SSRFError(`DNS resolved to private IP: ${hostname} → ${result.address}`);
    }
  } catch (err) {
    if (err instanceof SSRFError) throw err;
    throw new SSRFError(`DNS resolution failed for: ${hostname}`);
  }

  return parsed;
}

export function isAllowedRedirect(redirectUrl: string, originalUrl: string): boolean {
  try {
    const parsed = new URL(redirectUrl, originalUrl);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;

    const hostname = parsed.hostname;
    if (hostname === 'localhost' || hostname === '0.0.0.0') return false;
    if (BLOCKED_HOSTS.includes(hostname)) return false;

    const ipDirect = hostname.match(/^\d+\.\d+\.\d+\.\d+$/) || hostname.includes(':');
    if (ipDirect && isPrivateIp(hostname)) return false;

    return true;
  } catch {
    return false;
  }
}

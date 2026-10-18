import type { CrawledPage, TechnicalFindings, Finding } from '../types.js';

const SECURITY_HEADERS = [
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
  'content-security-policy',
  'referrer-policy',
  'permissions-policy',
] as const;

export function analyzeTechnical(pages: CrawledPage[]): TechnicalFindings {
  const findings: Finding[] = [];
  const homepage = pages[0];
  if (!homepage) {
    return {
      findings: [{ category: 'technical', severity: 'CRITICAL', title: 'No pages crawled', description: 'Could not fetch any pages for analysis.', confidence: 'HIGH', source: 'DETERMINISTIC' }],
      httpsEnabled: false, hasSecurityHeaders: false, securityHeaderDetails: {}, hasCompression: false, hasCaching: false, hasFavicon: false, brokenLinkCount: 0,
    };
  }

  const httpsEnabled = homepage.url.startsWith('https://');
  if (!httpsEnabled) {
    findings.push({ category: 'technical', severity: 'HIGH', title: 'No HTTPS', description: 'Website does not use HTTPS encryption.', confidence: 'HIGH', source: 'DETERMINISTIC' });
  }

  const securityHeaderDetails: Record<string, boolean> = {};
  let securityHeaderCount = 0;
  for (const header of SECURITY_HEADERS) {
    const present = header in homepage.headers;
    securityHeaderDetails[header] = present;
    if (present) securityHeaderCount++;
  }

  const hasSecurityHeaders = securityHeaderCount >= 3;
  if (securityHeaderCount === 0) {
    findings.push({ category: 'technical', severity: 'HIGH', title: 'No security headers', description: 'No security-related HTTP headers detected.', confidence: 'HIGH', source: 'DETERMINISTIC' });
  } else if (securityHeaderCount < 3) {
    findings.push({ category: 'technical', severity: 'MEDIUM', title: 'Missing security headers', description: `Only ${securityHeaderCount} of ${SECURITY_HEADERS.length} security headers present.`, confidence: 'HIGH', source: 'DETERMINISTIC' });
  }

  const hasCompression = pages.some(p => {
    const encoding = p.headers['content-encoding'] ?? '';
    return encoding.includes('gzip') || encoding.includes('br') || encoding.includes('deflate');
  });
  if (!hasCompression) {
    findings.push({ category: 'technical', severity: 'MEDIUM', title: 'No compression', description: 'Server does not use gzip/brotli compression.', confidence: 'MEDIUM', source: 'DETERMINISTIC' });
  }

  const hasCaching = pages.some(p => {
    const cc = p.headers['cache-control'] ?? '';
    return cc.includes('max-age') || cc.includes('public') || !!p.headers['etag'] || !!p.headers['last-modified'];
  });
  if (!hasCaching) {
    findings.push({ category: 'technical', severity: 'LOW', title: 'No caching headers', description: 'No cache-control or ETag headers detected.', confidence: 'MEDIUM', source: 'DETERMINISTIC' });
  }

  const hasFavicon = pages.some(p => {
    const lower = p.html.toLowerCase();
    return lower.includes('rel="icon"') || lower.includes("rel='icon'") || lower.includes('rel="shortcut icon"');
  });
  if (!hasFavicon) {
    findings.push({ category: 'technical', severity: 'INFO', title: 'No favicon', description: 'No favicon link tag detected.', confidence: 'MEDIUM', source: 'DETERMINISTIC' });
  }

  const brokenLinkCount = pages.filter(p => p.statusCode >= 400).length;
  if (brokenLinkCount > 0) {
    findings.push({ category: 'technical', severity: 'MEDIUM', title: 'Broken pages detected', description: `${brokenLinkCount} page(s) returned error status codes.`, confidence: 'HIGH', source: 'DETERMINISTIC' });
  }

  return { findings, httpsEnabled, hasSecurityHeaders, securityHeaderDetails, hasCompression, hasCaching, hasFavicon, brokenLinkCount };
}

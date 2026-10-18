import { describe, it, expect } from 'vitest';
import { analyzeTechnical } from '../analyzers/technical.js';
import { analyzeSeo } from '../analyzers/seo.js';
import { analyzeMobile } from '../analyzers/mobile.js';
import { analyzeConversion } from '../analyzers/conversion.js';
import { detectTechnologies } from '../analyzers/technology.js';
import { analyzeModernity } from '../analyzers/modernity.js';
import type { CrawledPage } from '../types.js';

function makePage(html: string, overrides: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url: 'https://example.com',
    statusCode: 200,
    headers: {},
    html,
    contentLength: html.length,
    loadTimeMs: 500,
    ...overrides,
  };
}

describe('analyzeTechnical', () => {
  it('detects HTTPS', () => {
    const page = makePage('<html></html>', { url: 'https://example.com' });
    const result = analyzeTechnical([page]);
    expect(result.httpsEnabled).toBe(true);
  });

  it('detects missing HTTPS', () => {
    const page = makePage('<html></html>', { url: 'http://example.com' });
    const result = analyzeTechnical([page]);
    expect(result.httpsEnabled).toBe(false);
    expect(result.findings.some(f => f.title === 'No HTTPS')).toBe(true);
  });

  it('detects security headers', () => {
    const page = makePage('<html></html>', {
      headers: {
        'strict-transport-security': 'max-age=31536000',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'self'",
      },
    });
    const result = analyzeTechnical([page]);
    expect(result.hasSecurityHeaders).toBe(true);
  });

  it('detects favicon', () => {
    const result = analyzeTechnical([makePage('<link rel="icon" href="/favicon.ico">')]);
    expect(result.hasFavicon).toBe(true);
  });

  it('handles empty pages array', () => {
    const result = analyzeTechnical([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.severity).toBe('CRITICAL');
  });
});

describe('analyzeSeo', () => {
  it('detects title and meta description', () => {
    const html = '<html><head><title>My Page Title</title><meta name="description" content="A great page about things."></head><body><h1>Welcome</h1></body></html>';
    const result = analyzeSeo([makePage(html)]);
    expect(result.hasTitle).toBe(true);
    expect(result.hasMetaDescription).toBe(true);
    expect(result.hasH1).toBe(true);
    expect(result.h1Count).toBe(1);
  });

  it('detects missing title', () => {
    const result = analyzeSeo([makePage('<html><head></head><body></body></html>')]);
    expect(result.hasTitle).toBe(false);
    expect(result.findings.some(f => f.title === 'Missing title tag')).toBe(true);
  });

  it('detects OG and Twitter tags', () => {
    const html = '<html><head><title>T</title><meta property="og:title" content="T"><meta name="twitter:card" content="summary"></head><body><h1>H</h1></body></html>';
    const result = analyzeSeo([makePage(html)]);
    expect(result.hasOpenGraph).toBe(true);
    expect(result.hasTwitterCard).toBe(true);
  });

  it('counts images missing alt', () => {
    const html = '<html><head><title>T</title></head><body><h1>H</h1><img src="a.jpg"><img src="b.jpg" alt="B"></body></html>';
    const result = analyzeSeo([makePage(html)]);
    expect(result.imgsMissingAlt).toBe(1);
  });
});

describe('analyzeMobile', () => {
  it('detects viewport meta tag', () => {
    const html = '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>';
    const result = analyzeMobile([makePage(html)]);
    expect(result.hasViewportMeta).toBe(true);
  });

  it('detects missing viewport', () => {
    const result = analyzeMobile([makePage('<html><head></head><body></body></html>')]);
    expect(result.hasViewportMeta).toBe(false);
    expect(result.findings.some(f => f.title === 'No viewport meta tag')).toBe(true);
  });

  it('detects responsive CSS signals', () => {
    const html = '<html><head><meta name="viewport" content="width=device-width"><style>@media (max-width: 768px) {}</style></head><body></body></html>';
    const result = analyzeMobile([makePage(html)]);
    expect(result.hasResponsiveSignals).toBe(true);
  });
});

describe('analyzeConversion', () => {
  it('detects contact form', () => {
    const html = '<html><body><form><input type="email" name="email"><textarea name="message"></textarea><button>Contact Us</button></form></body></html>';
    const page = makePage(html, { url: 'https://example.com/contact' });
    const result = analyzeConversion([page]);
    expect(result.hasContactForm).toBe(true);
  });

  it('detects CTA buttons', () => {
    const html = '<html><body><a href="/signup">Get Started</a><button>Free Trial</button><a href="/demo">Request Demo</a></body></html>';
    const result = analyzeConversion([makePage(html)]);
    expect(result.ctaCount).toBeGreaterThanOrEqual(3);
  });

  it('detects live chat', () => {
    const html = '<html><body><script src="https://widget.intercom.io/widget/abc"></script></body></html>';
    const result = analyzeConversion([makePage(html)]);
    expect(result.hasLiveChat).toBe(true);
    expect(result.hasChatbot).toBe(true);
  });
});

describe('detectTechnologies', () => {
  it('detects WordPress', () => {
    const html = '<html><body><link rel="stylesheet" href="/wp-content/themes/mytheme/style.css"></body></html>';
    const result = detectTechnologies([makePage(html)]);
    expect(result.some(t => t.name === 'WordPress')).toBe(true);
  });

  it('detects React', () => {
    const html = '<html><body><div id="root" data-reactroot=""></div></body></html>';
    const result = detectTechnologies([makePage(html)]);
    expect(result.some(t => t.name === 'React')).toBe(true);
  });

  it('detects Google Analytics', () => {
    const html = '<html><body><script src="https://www.google-analytics.com/analytics.js"></script></body></html>';
    const result = detectTechnologies([makePage(html)]);
    expect(result.some(t => t.name === 'Google Analytics')).toBe(true);
  });

  it('detects Cloudflare from headers', () => {
    const page = makePage('<html></html>', { headers: { server: 'cloudflare', 'cf-ray': '123' } });
    const result = detectTechnologies([page]);
    expect(result.some(t => t.name === 'Cloudflare')).toBe(true);
  });
});

describe('analyzeModernity', () => {
  it('detects outdated patterns', () => {
    const html = '<!DOCTYPE html><html><body><font color="red">old</font><center>centered</center></body></html>';
    const result = analyzeModernity([makePage(html)]);
    expect(result.outdatedSignals.length).toBeGreaterThan(0);
    expect(result.outdatedSignals).toContain('Deprecated <font> tag');
  });

  it('detects modern patterns', () => {
    const html = '<!DOCTYPE html><html><head></head><body><header></header><main><div style="display: flex"></div></main><footer></footer></body></html>';
    const result = analyzeModernity([makePage(html)]);
    expect(result.modernSignals).toContain('HTML5 semantic elements');
    expect(result.modernSignals).toContain('Modern CSS layout');
  });

  it('scores appropriately', () => {
    const modernHtml = '<!DOCTYPE html><html><head></head><body><header></header><nav></nav><main><img loading="lazy" src="a.jpg"><picture><source srcset="b.webp"></picture><svg viewBox="0 0 1 1"></svg><div style="display: grid"></div></main><footer></footer></body></html>';
    const result = analyzeModernity([makePage(modernHtml)]);
    expect(result.modernityScore).toBeGreaterThanOrEqual(70);
  });
});

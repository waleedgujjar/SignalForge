import { describe, expect, it } from 'vitest';
import { parseRobotsTxt, isPathAllowed } from './robots-parser.js';

describe('parseRobotsTxt', () => {
  it('parses disallow rules for wildcard agent', () => {
    const rules = parseRobotsTxt(`
User-agent: *
Disallow: /admin
Disallow: /private/
    `);
    expect(rules.disallowed).toEqual(['/admin', '/private/']);
  });

  it('ignores rules for specific agents', () => {
    const rules = parseRobotsTxt(`
User-agent: Googlebot
Disallow: /google-only

User-agent: *
Disallow: /general
    `);
    expect(rules.disallowed).toEqual(['/general']);
  });

  it('parses sitemap URLs', () => {
    const rules = parseRobotsTxt(`
Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap2.xml
    `);
    expect(rules.sitemapUrls).toEqual([
      'https://example.com/sitemap.xml',
      'https://example.com/sitemap2.xml',
    ]);
  });

  it('skips comment lines', () => {
    const rules = parseRobotsTxt(`
# This is a comment
User-agent: *
# Another comment
Disallow: /secret
    `);
    expect(rules.disallowed).toEqual(['/secret']);
  });

  it('skips empty lines', () => {
    const rules = parseRobotsTxt('\n\nUser-agent: *\n\nDisallow: /foo\n\n');
    expect(rules.disallowed).toEqual(['/foo']);
  });

  it('ignores empty disallow value', () => {
    const rules = parseRobotsTxt(`
User-agent: *
Disallow:
Disallow: /real
    `);
    expect(rules.disallowed).toEqual(['/real']);
  });

  it('returns empty arrays for empty content', () => {
    const rules = parseRobotsTxt('');
    expect(rules.disallowed).toEqual([]);
    expect(rules.sitemapUrls).toEqual([]);
  });

  it('stops collecting disallow rules after switching agent', () => {
    const rules = parseRobotsTxt(`
User-agent: *
Disallow: /general

User-agent: Bingbot
Disallow: /bing-only
    `);
    expect(rules.disallowed).toEqual(['/general']);
  });
});

describe('isPathAllowed', () => {
  const rules = parseRobotsTxt(`
User-agent: *
Disallow: /admin
Disallow: /private/
  `);

  it('blocks disallowed paths', () => {
    expect(isPathAllowed('/admin', rules)).toBe(false);
    expect(isPathAllowed('/admin/dashboard', rules)).toBe(false);
    expect(isPathAllowed('/private/', rules)).toBe(false);
    expect(isPathAllowed('/private/secret', rules)).toBe(false);
  });

  it('allows paths not in disallow list', () => {
    expect(isPathAllowed('/', rules)).toBe(true);
    expect(isPathAllowed('/about', rules)).toBe(true);
    expect(isPathAllowed('/contact', rules)).toBe(true);
  });

  it('allows everything when no rules', () => {
    const empty = { disallowed: [], sitemapUrls: [] };
    expect(isPathAllowed('/anything', empty)).toBe(true);
  });
});

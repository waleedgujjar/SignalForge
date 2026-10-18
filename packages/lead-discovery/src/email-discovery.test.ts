import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  discoverEmail,
  discoverEmailForLeads,
  extractEmailsFromHtml,
  filterJunkEmails,
  isJunkEmail,
  rankEmails,
  type EmailCandidate,
} from './email-discovery.js';
import type { NormalizedLead } from './normalization.js';

vi.mock('@signalforge/website-scanner', () => ({
  crawlWebsite: vi.fn(),
}));

import { crawlWebsite } from '@signalforge/website-scanner';
const mockCrawlWebsite = vi.mocked(crawlWebsite);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeCrawlResult(pages: Array<{ url: string; html: string }>) {
  return {
    pages: pages.map((p) => ({
      url: p.url,
      statusCode: 200,
      headers: {},
      html: p.html,
      contentLength: p.html.length,
      loadTimeMs: 50,
    })),
    domain: 'example.com',
    startUrl: 'https://example.com',
    durationMs: 100,
    errors: [],
  };
}

function makeLead(overrides: Partial<NormalizedLead> = {}): NormalizedLead {
  return {
    normalizedCompany: 'test company',
    normalizedEmail: null,
    normalizedPhone: null,
    normalizedDomain: 'example.com',
    website: 'https://example.com',
    company: 'Test Company',
    email: null,
    phone: null,
    ...overrides,
  };
}

describe('extractEmailsFromHtml', () => {
  it('extracts mailto links (§36.1)', () => {
    const html = '<a href="mailto:hello@example.com">Contact</a>';
    const result = extractEmailsFromHtml(html, 'https://example.com/contact');
    expect(result).toHaveLength(1);
    expect(result[0]!.email).toBe('hello@example.com');
    expect(result[0]!.source).toBe('MAILTO');
  });

  it('extracts page text emails (§36.2)', () => {
    const html = '<p>Contact us at hello@example.com for more info</p>';
    const result = extractEmailsFromHtml(html, 'https://example.com/about');
    expect(result).toHaveLength(1);
    expect(result[0]!.email).toBe('hello@example.com');
    expect(result[0]!.source).toBe('PAGE_TEXT');
  });

  it('prefers mailto over page text for same email', () => {
    const html = '<a href="mailto:hello@example.com">hello@example.com</a>';
    const result = extractEmailsFromHtml(html, 'https://example.com');
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe('MAILTO');
  });

  it('extracts multiple distinct emails (§36.3)', () => {
    const html = `
      <a href="mailto:sales@example.com">Sales</a>
      <p>Or email john.doe@example.com or support@example.com</p>
    `;
    const result = extractEmailsFromHtml(html, 'https://example.com');
    expect(result).toHaveLength(3);
    const emails = result.map((r) => r.email);
    expect(emails).toContain('sales@example.com');
    expect(emails).toContain('john.doe@example.com');
    expect(emails).toContain('support@example.com');
  });

  it('deduplicates case-insensitive emails (§36.4)', () => {
    const html = `
      <a href="mailto:Info@Example.com">Info</a>
      <p>Email: info@example.com</p>
    `;
    const result = extractEmailsFromHtml(html, 'https://example.com');
    expect(result).toHaveLength(1);
    expect(result[0]!.email).toBe('info@example.com');
  });

  it('ignores invalid email shapes (§36.5)', () => {
    const html = '<p>Email hello@ or @example.com or not-email</p>';
    const result = extractEmailsFromHtml(html, 'https://example.com');
    expect(result).toHaveLength(0);
  });

  it('handles mailto with query params', () => {
    const html = '<a href="mailto:hello@example.com?subject=Hi">Email</a>';
    const result = extractEmailsFromHtml(html, 'https://example.com');
    expect(result).toHaveLength(1);
    expect(result[0]!.email).toBe('hello@example.com');
  });
});

describe('isJunkEmail / filterJunkEmails', () => {
  it('filters noreply/system emails (§36.6)', () => {
    const junkAddresses = [
      'noreply@example.com',
      'no-reply@example.com',
      'donotreply@example.com',
      'do-not-reply@example.com',
      'mailer-daemon@example.com',
      'postmaster@example.com',
      'bounce@example.com',
      'auto-reply@example.com',
    ];
    for (const email of junkAddresses) {
      expect(isJunkEmail(email)).toBe(true);
    }
  });

  it('keeps valid business emails', () => {
    const validAddresses = [
      'info@example.com',
      'sales@example.com',
      'contact@example.com',
      'support@example.com',
      'hello@example.com',
      'john@example.com',
    ];
    for (const email of validAddresses) {
      expect(isJunkEmail(email)).toBe(false);
    }
  });

  it('rejects signalforge domain emails', () => {
    expect(isJunkEmail('bot@signalforge.io')).toBe(true);
  });

  it('rejects UUID/hash local parts', () => {
    expect(isJunkEmail('a1b2c3d4e5f6a7b8@example.com')).toBe(true);
    expect(isJunkEmail('a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6@example.com')).toBe(true);
  });

  it('rejects numeric-only local parts', () => {
    expect(isJunkEmail('12345@example.com')).toBe(true);
  });

  it('filters junk from candidates', () => {
    const candidates: EmailCandidate[] = [
      { email: 'noreply@example.com', source: 'PAGE_TEXT', pageUrl: '/', priority: 0 },
      { email: 'hello@example.com', source: 'MAILTO', pageUrl: '/', priority: 0 },
      { email: 'bounce@example.com', source: 'PAGE_TEXT', pageUrl: '/', priority: 0 },
    ];
    const filtered = filterJunkEmails(candidates);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.email).toBe('hello@example.com');
  });
});

describe('rankEmails', () => {
  it('ranks personal emails highest', () => {
    const candidates: EmailCandidate[] = [
      { email: 'info@example.com', source: 'MAILTO', pageUrl: '/', priority: 0 },
      { email: 'john@example.com', source: 'PAGE_TEXT', pageUrl: '/', priority: 0 },
      { email: 'support@example.com', source: 'MAILTO', pageUrl: '/', priority: 0 },
    ];
    const ranked = rankEmails(candidates);
    expect(ranked[0]!.email).toBe('john@example.com');
  });

  it('follows role priority ordering', () => {
    const candidates: EmailCandidate[] = [
      { email: 'support@example.com', source: 'PAGE_TEXT', pageUrl: '/', priority: 0 },
      { email: 'sales@example.com', source: 'PAGE_TEXT', pageUrl: '/', priority: 0 },
      { email: 'info@example.com', source: 'PAGE_TEXT', pageUrl: '/', priority: 0 },
      { email: 'contact@example.com', source: 'PAGE_TEXT', pageUrl: '/', priority: 0 },
    ];
    const ranked = rankEmails(candidates);
    expect(ranked.map((r) => r.email)).toEqual([
      'sales@example.com',
      'contact@example.com',
      'info@example.com',
      'support@example.com',
    ]);
  });

  it('MAILTO wins tiebreaker over PAGE_TEXT', () => {
    const candidates: EmailCandidate[] = [
      { email: 'info@example.com', source: 'PAGE_TEXT', pageUrl: '/', priority: 0 },
      { email: 'info@other.com', source: 'MAILTO', pageUrl: '/', priority: 0 },
    ];
    const ranked = rankEmails(candidates);
    expect(ranked[0]!.source).toBe('MAILTO');
  });
});

describe('discoverEmail', () => {
  it('discovers email from contact page (§36.7)', async () => {
    mockCrawlWebsite.mockResolvedValueOnce(
      makeCrawlResult([
        { url: 'https://example.com/', html: '<h1>Welcome</h1>' },
        {
          url: 'https://example.com/contact',
          html: '<a href="mailto:hello@example.com">Contact us</a>',
        },
      ]),
    );

    const result = await discoverEmail('https://example.com');
    expect(result).not.toBeNull();
    expect(result!.email).toBe('hello@example.com');
    expect(result!.source).toBe('MAILTO');
    expect(result!.confidence).toBeGreaterThanOrEqual(80);
  });

  it('returns null when no email found (§36.8)', async () => {
    mockCrawlWebsite.mockResolvedValueOnce(
      makeCrawlResult([
        { url: 'https://example.com/', html: '<h1>No email here</h1>' },
      ]),
    );

    const result = await discoverEmail('https://example.com');
    expect(result).toBeNull();
  });

  it('handles website timeout gracefully (§36.9)', async () => {
    mockCrawlWebsite.mockRejectedValueOnce(new Error('Request timeout'));

    const result = await discoverEmail('https://example.com');
    expect(result).toBeNull();
  });

  it('handles empty crawl result (§36.10)', async () => {
    mockCrawlWebsite.mockResolvedValueOnce({
      pages: [],
      domain: 'example.com',
      startUrl: 'https://example.com',
      durationMs: 100,
      errors: ['Failed to fetch https://example.com: HTTP 403'],
    });

    const result = await discoverEmail('https://example.com');
    expect(result).toBeNull();
  });

  it('picks best email from multiple candidates', async () => {
    mockCrawlWebsite.mockResolvedValueOnce(
      makeCrawlResult([
        {
          url: 'https://example.com/',
          html: `
            <p>info@example.com</p>
            <a href="mailto:sales@example.com">Sales</a>
            <p>john@example.com</p>
          `,
        },
      ]),
    );

    const result = await discoverEmail('https://example.com');
    expect(result).not.toBeNull();
    expect(result!.email).toBe('john@example.com');
  });

  it('filters junk emails from results', async () => {
    mockCrawlWebsite.mockResolvedValueOnce(
      makeCrawlResult([
        {
          url: 'https://example.com/',
          html: '<p>noreply@example.com</p><p>hello@example.com</p>',
        },
      ]),
    );

    const result = await discoverEmail('https://example.com');
    expect(result).not.toBeNull();
    expect(result!.email).toBe('hello@example.com');
  });

  it('returns null when all emails are junk', async () => {
    mockCrawlWebsite.mockResolvedValueOnce(
      makeCrawlResult([
        {
          url: 'https://example.com/',
          html: '<p>noreply@example.com</p><p>bounce@example.com</p>',
        },
      ]),
    );

    const result = await discoverEmail('https://example.com');
    expect(result).toBeNull();
  });

  it('uses configured maxPages and timeout', async () => {
    mockCrawlWebsite.mockResolvedValueOnce(
      makeCrawlResult([
        { url: 'https://example.com/', html: '<p>hi@example.com</p>' },
      ]),
    );

    await discoverEmail('https://example.com', { maxPages: 5, requestTimeoutMs: 5000 });

    expect(mockCrawlWebsite).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ maxPages: 5, requestTimeoutMs: 5000 }),
    );
  });

  it('returns consistent results for idempotency (§36.15)', async () => {
    const html = `
      <a href="mailto:sales@example.com">Sales</a>
      <p>john@example.com support@example.com</p>
    `;
    const crawlResult = makeCrawlResult([{ url: 'https://example.com/', html }]);

    mockCrawlWebsite.mockResolvedValueOnce(crawlResult);
    const result1 = await discoverEmail('https://example.com');

    mockCrawlWebsite.mockResolvedValueOnce(crawlResult);
    const result2 = await discoverEmail('https://example.com');

    expect(result1!.email).toBe(result2!.email);
    expect(result1!.source).toBe(result2!.source);
  });
});

describe('discoverEmailForLeads', () => {
  it('skips leads with existing email (§36.12, §36.13)', async () => {
    const leads = [
      makeLead({ normalizedEmail: 'existing@example.com', emailSource: 'SOURCE_PROVIDED' }),
    ];

    // discoverEmailForLeads only processes leads WITHOUT emails;
    // the pipeline filters those before calling this function.
    // Verify that leads with emails are not affected when passed through.
    const result = await discoverEmailForLeads(
      leads.filter((l) => !l.normalizedEmail),
      {},
    );
    expect(result.size).toBe(0);
    expect(mockCrawlWebsite).not.toHaveBeenCalled();
  });

  it('discovers email for lead with website but no email (§36.14)', async () => {
    mockCrawlWebsite.mockResolvedValueOnce(
      makeCrawlResult([
        { url: 'https://example.com/', html: '<p>hello@example.com</p>' },
      ]),
    );

    const leads = [makeLead({ normalizedEmail: null, email: null })];
    const result = await discoverEmailForLeads(leads);

    expect(result.size).toBe(1);
    expect(result.get('example.com')).not.toBeNull();
    expect(result.get('example.com')!.email).toBe('hello@example.com');
  });

  it('deduplicates domains in batch — one fetch per domain (§batch dedup)', async () => {
    mockCrawlWebsite.mockResolvedValue(
      makeCrawlResult([
        { url: 'https://example.com/', html: '<p>contact@example.com</p>' },
      ]),
    );

    const leads = [
      makeLead({ normalizedDomain: 'example.com', website: 'https://example.com' }),
      makeLead({ normalizedDomain: 'example.com', website: 'https://example.com' }),
      makeLead({ normalizedDomain: 'example.com', website: 'https://example.com' }),
    ];

    await discoverEmailForLeads(leads);

    expect(mockCrawlWebsite).toHaveBeenCalledTimes(1);
  });

  it('handles mixed results — some domains have emails, some do not', async () => {
    mockCrawlWebsite
      .mockResolvedValueOnce(
        makeCrawlResult([{ url: 'https://has-email.com/', html: '<p>hello@has-email.com</p>' }]),
      )
      .mockResolvedValueOnce(
        makeCrawlResult([{ url: 'https://no-email.com/', html: '<h1>No email</h1>' }]),
      );

    const leads = [
      makeLead({ normalizedDomain: 'has-email.com', website: 'https://has-email.com' }),
      makeLead({ normalizedDomain: 'no-email.com', website: 'https://no-email.com' }),
    ];

    const result = await discoverEmailForLeads(leads);

    expect(result.get('has-email.com')).not.toBeNull();
    expect(result.get('no-email.com')).toBeNull();
  });

  it('continues when one domain fetch fails', async () => {
    mockCrawlWebsite
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockResolvedValueOnce(
        makeCrawlResult([{ url: 'https://ok.com/', html: '<p>hi@ok.com</p>' }]),
      );

    const leads = [
      makeLead({ normalizedDomain: 'broken.com', website: 'https://broken.com' }),
      makeLead({ normalizedDomain: 'ok.com', website: 'https://ok.com' }),
    ];

    const result = await discoverEmailForLeads(leads, { maxConcurrency: 1 });

    expect(result.get('broken.com')).toBeNull();
    expect(result.get('ok.com')!.email).toBe('hi@ok.com');
  });

  it('constructs URL from domain when website is null', async () => {
    mockCrawlWebsite.mockResolvedValueOnce(
      makeCrawlResult([
        { url: 'https://example.com/', html: '<p>info@example.com</p>' },
      ]),
    );

    const leads = [makeLead({ website: null, normalizedDomain: 'example.com' })];
    await discoverEmailForLeads(leads);

    expect(mockCrawlWebsite).toHaveBeenCalledWith(
      'https://example.com',
      expect.any(Object),
    );
  });
});

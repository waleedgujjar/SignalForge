import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrawledPage, CrawlResult } from '@signalforge/website-scanner';
import type { ResearchFailureOutcome } from '../../types.js';

const mockCrawlWebsite = vi.fn<(url: string, config?: unknown) => Promise<CrawlResult>>();
const mockValidateUrl = vi.fn<(url: string) => Promise<URL>>();
vi.mock('@signalforge/website-scanner', () => ({
  crawlWebsite: (...args: unknown[]) => mockCrawlWebsite(...(args as [string, unknown])),
  validateUrl: (...args: unknown[]) => mockValidateUrl(...(args as [string])),
}));

const configState = {
  WEB_RESEARCH_ENABLED: true,
  WEB_RESEARCH_TIMEOUT_MS: 30_000,
  WEB_RESEARCH_MAX_PAGES: 5,
  WEB_RESEARCH_AI_INTERPRETATION_ENABLED: false,
  AI_PROVIDER: 'openai',
  OPENAI_API_KEY: 'test-key',
  OPENAI_BASE_URL: '',
  OPENAI_MODEL: 'gpt-4o-mini',
};
vi.mock('@signalforge/config', () => ({ loadEnv: () => configState }));

vi.mock('../interpret.js', () => ({
  interpretWebContent: vi.fn().mockResolvedValue({}),
}));

import { websiteProvider } from '../providers/website.js';
import { interpretWebContent } from '../interpret.js';
import type { ResearchContext } from '../../types.js';

function makePage(url: string, html: string): CrawledPage {
  return { url, html, status: 200, contentType: 'text/html', headers: {} } as unknown as CrawledPage;
}

function hvacFixture(): CrawledPage[] {
  return [
    makePage('https://acme-hvac.com', `
      <html>
        <head>
          <meta property="og:site_name" content="Acme HVAC" />
          <meta property="og:description" content="Acme HVAC provides expert heating and cooling services to the greater Houston area since 1985." />
        </head>
        <body><h1>Acme HVAC - Houston's Trusted HVAC Company</h1></body>
      </html>
    `),
    makePage('https://acme-hvac.com/about', `
      <html><body><main>
        <p>Acme HVAC has been proudly serving the Houston community for over 35 years with top-quality heating and cooling solutions for residential and commercial properties.</p>
        <p>We are NATE certified and BBB accredited.</p>
        <p>Established in 1985.</p>
      </main></body></html>
    `),
    makePage('https://acme-hvac.com/services', `
      <html><body>
        <h2>AC Installation</h2>
        <h2>Heating Repair</h2>
        <h2>Duct Cleaning</h2>
        <h2>Maintenance Plans</h2>
      </body></html>
    `),
    makePage('https://acme-hvac.com/team', '<html><body>Our Team</body></html>'),
    makePage('https://acme-hvac.com/contact', `
      <html><body>
        <address>1234 Main St, Houston, TX 77001</address>
        <form><input type="text" /><button>Send</button></form>
      </body></html>
    `),
  ];
}

const ctx: ResearchContext = {
  workspaceId: 'ws1',
  leadId: 'l1',
  researchId: 'r1',
  timeoutMs: 30_000,
  chainNotes: [],
};

describe('websiteProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configState.WEB_RESEARCH_AI_INTERPRETATION_ENABLED = false;
    mockValidateUrl.mockResolvedValue(new URL('https://acme-hvac.com'));
  });

  it('is always configured', () => {
    expect(websiteProvider.isConfigured()).toBe(true);
  });

  it('reports READY on health check', async () => {
    const health = await websiteProvider.healthCheck();
    expect(health.status).toBe('READY');
    expect(health.authentication).toBe('NOT_REQUIRED');
  });

  it('extracts company data from HVAC fixture pages (test #1)', async () => {
    mockCrawlWebsite.mockResolvedValue({ pages: hvacFixture(), errors: [] } as unknown as CrawlResult);

    const result = await websiteProvider.researchCompany({ url: 'https://acme-hvac.com' }, ctx);

    expect(result.status).toBe('COMPLETED');
    if (result.status !== 'COMPLETED' && result.status !== 'PARTIAL') throw new Error('unexpected');
    const data = result.data as Record<string, unknown>;
    const company = data.company as Record<string, unknown>;
    expect(company.name).toBe('Acme HVAC');
    expect(company.description).toContain('Acme HVAC');
    expect(company.services).toEqual(expect.arrayContaining(['AC Installation', 'Heating Repair']));
    expect(company.location).toBeDefined();
    expect(company.hasTeamPage).toBe(true);
    expect(company.hasContactForm).toBe(true);
    expect(company.yearEstablished).toBe('1985');
  });

  it('attaches provenance to every extracted field (test #2)', async () => {
    mockCrawlWebsite.mockResolvedValue({ pages: hvacFixture(), errors: [] } as unknown as CrawlResult);

    const result = await websiteProvider.researchCompany({ url: 'https://acme-hvac.com' }, ctx);

    expect(result.status).toBe('COMPLETED');
    if (result.status !== 'COMPLETED' && result.status !== 'PARTIAL') throw new Error('unexpected');
    expect(result.provenance.length).toBeGreaterThan(0);
    for (const entry of result.provenance) {
      expect(entry.source).toBe('WEB_PUBLIC');
      expect(entry.sourceUrl).toBeTruthy();
      expect(entry.provider).toBe('website');
      expect(entry.confidence).toBeGreaterThan(0);
      expect(entry.retrievedAt).toBeTruthy();
    }
    const fields = result.provenance.map((e) => e.field);
    expect(fields).toContain('company.name');
  });

  it('preserves deterministic extractions when AI fails (test #4)', async () => {
    configState.WEB_RESEARCH_AI_INTERPRETATION_ENABLED = true;
    mockCrawlWebsite.mockResolvedValue({ pages: hvacFixture(), errors: [] } as unknown as CrawlResult);
    vi.mocked(interpretWebContent).mockRejectedValue(new Error('AI service down'));

    const result = await websiteProvider.researchCompany({ url: 'https://acme-hvac.com' }, ctx);

    expect(result.status === 'COMPLETED' || result.status === 'PARTIAL').toBe(true);
    if (result.status !== 'COMPLETED' && result.status !== 'PARTIAL') throw new Error('unexpected');
    const company = (result.data as Record<string, unknown>).company as Record<string, unknown>;
    expect(company.name).toBe('Acme HVAC');
    expect(company.services).toBeDefined();
  });

  it('returns FAILED with PAGE_UNAVAILABLE when crawl returns 0 pages (test #7)', async () => {
    mockCrawlWebsite.mockResolvedValue({ pages: [], errors: [] } as unknown as CrawlResult);

    const result = await websiteProvider.researchCompany({ url: 'https://acme-hvac.com' }, ctx);

    expect(result.status).toBe('FAILED');
    const failure = result as ResearchFailureOutcome;
    expect(failure.errorCode).toBe('PAGE_UNAVAILABLE');
  });

  it('returns FAILED with PAGE_UNAVAILABLE when crawl throws', async () => {
    mockCrawlWebsite.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await websiteProvider.researchCompany({ url: 'https://acme-hvac.com' }, ctx);

    expect(result.status).toBe('FAILED');
    const failure = result as ResearchFailureOutcome;
    expect(failure.errorCode).toBe('PAGE_UNAVAILABLE');
    expect(failure.retryable).toBe(true);
  });

  it('returns UNAVAILABLE with INVALID_URL when no URL provided', async () => {
    const result = await websiteProvider.researchCompany({}, ctx);
    expect(result.status).toBe('UNAVAILABLE');
    const failure = result as ResearchFailureOutcome;
    expect(failure.errorCode).toBe('INVALID_URL');
  });

  it('returns FAILED with INVALID_URL when validation fails', async () => {
    mockValidateUrl.mockRejectedValue(new Error('SSRF blocked'));

    const result = await websiteProvider.researchCompany({ url: 'http://169.254.169.254' }, ctx);

    expect(result.status).toBe('FAILED');
    const failure = result as ResearchFailureOutcome;
    expect(failure.errorCode).toBe('INVALID_URL');
  });

  it('constructs URL from domain when no url given', async () => {
    mockCrawlWebsite.mockResolvedValue({
      pages: [makePage('https://example.com', '<html><head><title>Test Co</title></head><body></body></html>')],
      errors: [],
    } as unknown as CrawlResult);

    const result = await websiteProvider.researchCompany({ domain: 'example.com' }, ctx);
    expect(mockCrawlWebsite).toHaveBeenCalledWith('https://example.com', expect.any(Object));
    expect(result.status === 'COMPLETED' || result.status === 'PARTIAL').toBe(true);
  });
});

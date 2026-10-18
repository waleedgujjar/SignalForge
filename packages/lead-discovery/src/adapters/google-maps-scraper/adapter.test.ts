import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleMapsScraperAdapter } from './adapter.js';
import { GoogleMapsScraperClient, ScraperError } from './client.js';
import type { ScraperResultRow } from './client.js';
import { NominatimGeocoder } from './geocode.js';
import type { Env } from '@signalforge/config';
import type { AdapterContext, LeadSearchParams } from '../../types.js';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GOOGLE_MAPS_SCRAPER_ENABLED: true,
    GOOGLE_MAPS_SCRAPER_URL: 'http://scraper.test:8080',
    GOOGLE_MAPS_SCRAPER_MAX_TIME: 120,
    GOOGLE_MAPS_SCRAPER_DEPTH: 1,
    GOOGLE_MAPS_SCRAPER_POLL_INTERVAL_MS: 10,
    GOOGLE_MAPS_SCRAPER_MAX_POLL_ATTEMPTS: 5,
    ...overrides,
  } as Env;
}

function makeRow(overrides: Partial<ScraperResultRow> = {}): ScraperResultRow {
  return {
    input_id: '0',
    link: 'https://maps.google.com/?cid=123',
    title: 'Test Business',
    category: 'Restaurant',
    address: '123 Main St, Austin, TX 78701, United States',
    open_hours: '',
    popular_times: '',
    website: 'https://testbiz.com',
    phone: '+15125551234',
    plus_code: '',
    review_count: '42',
    review_rating: '4.5',
    reviews_per_rating: '',
    latitude: '30.2672',
    longitude: '-97.7431',
    cid: '123',
    status: '',
    descriptions: '',
    reviews_link: '',
    thumbnail: '',
    timezone: 'America/Chicago',
    price_range: '$$',
    data_id: '',
    place_id: 'ChIJ_test',
    images: '',
    reservations: '',
    order_online: '',
    menu: '',
    owner: 'John Doe',
    complete_address: '123 Main St, Austin, TX 78701, United States',
    about: '',
    user_reviews: '',
    user_reviews_extended: '',
    emails: 'info@testbiz.com',
    ...overrides,
  };
}

function makeContext(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return { workspaceId: 'ws-1', jobId: 'job-1', ...overrides };
}

function makeParams(overrides: Partial<LeadSearchParams> = {}): LeadSearchParams {
  return {
    maxResults: 100,
    keywords: ['restaurants'],
    city: 'Austin',
    state: 'Texas',
    country: 'United States',
    ...overrides,
  };
}

describe('GoogleMapsScraperAdapter', () => {
  let mockClient: {
    createJob: ReturnType<typeof vi.fn>;
    waitForCompletion: ReturnType<typeof vi.fn>;
    downloadResults: ReturnType<typeof vi.fn>;
    deleteJob: ReturnType<typeof vi.fn>;
    healthCheck: ReturnType<typeof vi.fn>;
  };
  let mockGeocoder: { geocode: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockClient = {
      createJob: vi.fn().mockResolvedValue('scraper-job-1'),
      waitForCompletion: vi.fn().mockResolvedValue({ id: 'scraper-job-1', Status: 'ok' }),
      downloadResults: vi.fn().mockResolvedValue([makeRow()]),
      deleteJob: vi.fn().mockResolvedValue(undefined),
      healthCheck: vi.fn().mockResolvedValue({ status: 'READY', details: [] }),
    };
    mockGeocoder = {
      geocode: vi.fn().mockResolvedValue({ lat: '30.2672', lon: '-97.7431', displayName: 'Austin, TX' }),
    };
  });

  it('has source GOOGLE_MAPS_SCRAPER', () => {
    const adapter = new GoogleMapsScraperAdapter({ env: makeEnv() });
    expect(adapter.source).toBe('GOOGLE_MAPS_SCRAPER');
  });

  it('is not billable', () => {
    const adapter = new GoogleMapsScraperAdapter({ env: makeEnv() });
    expect(adapter.billable).toBe(false);
  });

  describe('isConfigured', () => {
    it('returns true when GOOGLE_MAPS_SCRAPER_ENABLED is true', () => {
      const adapter = new GoogleMapsScraperAdapter({ env: makeEnv({ GOOGLE_MAPS_SCRAPER_ENABLED: true } as Partial<Env>) });
      expect(adapter.isConfigured()).toBe(true);
    });

    it('returns false when GOOGLE_MAPS_SCRAPER_ENABLED is false', () => {
      const adapter = new GoogleMapsScraperAdapter({ env: makeEnv({ GOOGLE_MAPS_SCRAPER_ENABLED: false } as Partial<Env>) });
      expect(adapter.isConfigured()).toBe(false);
    });

    it('returns false when env throws', () => {
      const adapter = new GoogleMapsScraperAdapter({
        env: () => { throw new Error('no env'); },
      });
      expect(adapter.isConfigured()).toBe(false);
    });
  });

  describe('search', () => {
    it('orchestrates geocode → create → poll → download → cleanup', async () => {
      const adapter = new GoogleMapsScraperAdapter({
        client: mockClient as unknown as GoogleMapsScraperClient,
        geocoder: mockGeocoder as unknown as NominatimGeocoder,
        env: makeEnv(),
      });

      const result = await adapter.search(makeParams(), makeContext());

      expect(mockGeocoder.geocode).toHaveBeenCalledWith({
        city: 'Austin', state: 'Texas', country: 'United States', postalCode: undefined,
      });
      expect(mockClient.createJob).toHaveBeenCalledWith(
        expect.objectContaining({ keywords: ['restaurants'], lat: '30.2672', lon: '-97.7431' }),
        undefined,
      );
      expect(mockClient.waitForCompletion).toHaveBeenCalledWith('scraper-job-1', undefined);
      expect(mockClient.downloadResults).toHaveBeenCalledWith('scraper-job-1', undefined);
      expect(mockClient.deleteJob).toHaveBeenCalledWith('scraper-job-1');

      expect(result.leads).toHaveLength(1);
      expect(result.requestsUsed).toBe(1);
    });

    it('maps CSV fields to RawDiscoveredLead correctly', async () => {
      const adapter = new GoogleMapsScraperAdapter({
        client: mockClient as unknown as GoogleMapsScraperClient,
        geocoder: mockGeocoder as unknown as NominatimGeocoder,
        env: makeEnv(),
      });

      const result = await adapter.search(makeParams(), makeContext());
      const lead = result.leads[0]!;

      expect(lead.company).toBe('Test Business');
      expect(lead.phone).toBe('+15125551234');
      expect(lead.email).toBe('info@testbiz.com');
      expect(lead.website).toBe('https://testbiz.com');
      expect(lead.industry).toBe('Restaurant');
      expect(lead.sourceId).toBe('ChIJ_test');
      expect(lead.sourceUrl).toBe('https://maps.google.com/?cid=123');
      expect(lead.fullName).toBe('John Doe');
      expect(lead.jobTitle).toBe('Owner');
      expect(lead.emailSource).toBe('SOURCE_PROVIDED');
      expect((lead.metadata as Record<string, unknown>).reviewRating).toBe(4.5);
      expect((lead.metadata as Record<string, unknown>).reviewCount).toBe(42);
    });

    it('extracts first email from comma-separated emails field', async () => {
      mockClient.downloadResults.mockResolvedValue([
        makeRow({ emails: 'first@biz.com, second@biz.com' }),
      ]);
      const adapter = new GoogleMapsScraperAdapter({
        client: mockClient as unknown as GoogleMapsScraperClient,
        geocoder: mockGeocoder as unknown as NominatimGeocoder,
        env: makeEnv(),
      });

      const result = await adapter.search(makeParams(), makeContext());
      expect(result.leads[0]!.email).toBe('first@biz.com');
    });

    it('sets email to null when no emails in row', async () => {
      mockClient.downloadResults.mockResolvedValue([makeRow({ emails: '' })]);
      const adapter = new GoogleMapsScraperAdapter({
        client: mockClient as unknown as GoogleMapsScraperClient,
        geocoder: mockGeocoder as unknown as NominatimGeocoder,
        env: makeEnv(),
      });

      const result = await adapter.search(makeParams(), makeContext());
      expect(result.leads[0]!.email).toBeNull();
      expect(result.leads[0]!.emailSource).toBeNull();
    });

    it('respects maxResults cap', async () => {
      mockClient.downloadResults.mockResolvedValue([makeRow(), makeRow(), makeRow()]);
      const adapter = new GoogleMapsScraperAdapter({
        client: mockClient as unknown as GoogleMapsScraperClient,
        geocoder: mockGeocoder as unknown as NominatimGeocoder,
        env: makeEnv(),
      });

      const result = await adapter.search(makeParams({ maxResults: 2 }), makeContext());
      expect(result.leads).toHaveLength(2);
      expect(result.warnings).toContain('Scraper returned 3 results; capped at 2');
    });

    it('returns empty result when no keywords derivable', async () => {
      const adapter = new GoogleMapsScraperAdapter({
        client: mockClient as unknown as GoogleMapsScraperClient,
        geocoder: mockGeocoder as unknown as NominatimGeocoder,
        env: makeEnv(),
      });

      const result = await adapter.search(
        makeParams({ keywords: [], industry: undefined, category: undefined }),
        makeContext(),
      );
      expect(result.leads).toEqual([]);
      expect(result.requestsUsed).toBe(0);
      expect(result.warnings).toContain('No keywords could be derived from the search parameters');
    });

    it('cleans up scraper job even when polling fails', async () => {
      mockClient.waitForCompletion.mockRejectedValue(new ScraperError('timeout', 'TIMEOUT'));
      const adapter = new GoogleMapsScraperAdapter({
        client: mockClient as unknown as GoogleMapsScraperClient,
        geocoder: mockGeocoder as unknown as NominatimGeocoder,
        env: makeEnv(),
      });

      await expect(adapter.search(makeParams(), makeContext())).rejects.toThrow(ScraperError);
      expect(mockClient.deleteJob).toHaveBeenCalledWith('scraper-job-1');
    });

    it('cleans up scraper job even when download fails', async () => {
      mockClient.downloadResults.mockRejectedValue(new ScraperError('download failed', 'PROVIDER_UNAVAILABLE'));
      const adapter = new GoogleMapsScraperAdapter({
        client: mockClient as unknown as GoogleMapsScraperClient,
        geocoder: mockGeocoder as unknown as NominatimGeocoder,
        env: makeEnv(),
      });

      await expect(adapter.search(makeParams(), makeContext())).rejects.toThrow(ScraperError);
      expect(mockClient.deleteJob).toHaveBeenCalledWith('scraper-job-1');
    });

    it('falls back to search params for missing address fields', async () => {
      mockClient.downloadResults.mockResolvedValue([
        makeRow({ complete_address: '', address: '' }),
      ]);
      const adapter = new GoogleMapsScraperAdapter({
        client: mockClient as unknown as GoogleMapsScraperClient,
        geocoder: mockGeocoder as unknown as NominatimGeocoder,
        env: makeEnv(),
      });

      const result = await adapter.search(
        makeParams({ city: 'Austin', state: 'Texas', country: 'United States' }),
        makeContext(),
      );
      expect(result.leads[0]!.city).toBe('Austin');
      expect(result.leads[0]!.state).toBe('Texas');
      expect(result.leads[0]!.country).toBe('United States');
    });

    it('includes industry and category as keywords', async () => {
      const adapter = new GoogleMapsScraperAdapter({
        client: mockClient as unknown as GoogleMapsScraperClient,
        geocoder: mockGeocoder as unknown as NominatimGeocoder,
        env: makeEnv(),
      });

      await adapter.search(
        makeParams({ keywords: ['pizza'], industry: 'Food', category: 'Italian' }),
        makeContext(),
      );

      expect(mockClient.createJob).toHaveBeenCalledWith(
        expect.objectContaining({ keywords: ['pizza', 'Food', 'Italian'] }),
        undefined,
      );
    });
  });
});

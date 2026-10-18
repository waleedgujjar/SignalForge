import { describe, it, expect, vi } from 'vitest';
import { GoogleMapsScraperClient, ScraperError } from './client.js';
import type { Env } from '@signalforge/config';

const HEADER = 'input_id,link,title,category,address,open_hours,popular_times,website,phone,plus_code,review_count,review_rating,reviews_per_rating,latitude,longitude,cid,status,descriptions,reviews_link,thumbnail,timezone,price_range,data_id,place_id,images,reservations,order_online,menu,owner,complete_address,about,user_reviews,user_reviews_extended,emails';
const ROW1 = '0,https://maps.google.com/?cid=123,Joe\'s Coffee,Coffee shop,"123 Main St, Austin, TX 78701, US",,,,+15125551234,,42,4.5,,30.2672,-97.7431,123,,,,,,,,ChIJ123,,,,,Joe Smith,"123 Main St, Austin, TX 78701, United States",,,,joe@joescoffee.com';
const ROW2 = '1,https://maps.google.com/?cid=456,Tea House,Tea room,"456 Oak Ave, Austin, TX 78702, US",,,https://teahouse.com,+15125555678,,18,4.2,,30.2700,-97.7400,456,,,,,,,,ChIJ456,,,,,,,"456 Oak Ave, Austin, TX 78702, United States",,,,';

const SAMPLE_CSV = [HEADER, ROW1, ROW2].join('\n');

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GOOGLE_MAPS_SCRAPER_URL: 'http://scraper.test:8080',
    GOOGLE_MAPS_SCRAPER_ENABLED: true,
    GOOGLE_MAPS_SCRAPER_MAX_TIME: 120,
    GOOGLE_MAPS_SCRAPER_DEPTH: 1,
    GOOGLE_MAPS_SCRAPER_POLL_INTERVAL_MS: 10,
    GOOGLE_MAPS_SCRAPER_MAX_POLL_ATTEMPTS: 3,
    ...overrides,
  } as Env;
}

function mockFetch(responses: Array<{ ok: boolean; status: number; body: unknown; text?: string }>) {
  let callIndex = 0;
  return vi.fn().mockImplementation(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1]!;
    callIndex++;
    return {
      ok: resp.ok,
      status: resp.status,
      json: () => Promise.resolve(resp.body),
      text: () => Promise.resolve(resp.text ?? JSON.stringify(resp.body)),
    };
  });
}

describe('GoogleMapsScraperClient', () => {
  describe('parseCsv', () => {
    it('parses a 34-column CSV into typed rows', () => {
      const rows = GoogleMapsScraperClient.parseCsv(SAMPLE_CSV);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.title).toBe("Joe's Coffee");
      expect(rows[0]!.phone).toBe('+15125551234');
      expect(rows[0]!.emails).toBe('joe@joescoffee.com');
      expect(rows[0]!.place_id).toBe('ChIJ123');
      expect(rows[1]!.title).toBe('Tea House');
      expect(rows[1]!.website).toBe('https://teahouse.com');
    });

    it('handles quoted fields with embedded commas', () => {
      const csv = 'title,address\n"Joe\'s Place","123 Main St, Austin, TX"';
      const rows = GoogleMapsScraperClient.parseCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.address).toBe('123 Main St, Austin, TX');
    });

    it('returns empty array for header-only CSV', () => {
      const rows = GoogleMapsScraperClient.parseCsv('title,address');
      expect(rows).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(GoogleMapsScraperClient.parseCsv('')).toEqual([]);
    });

    it('handles escaped quotes in quoted fields', () => {
      const csv = 'title,about\n"Joe""s ""Best"" Coffee","Great ""place"""';
      const rows = GoogleMapsScraperClient.parseCsv(csv);
      expect(rows[0]!.title).toBe('Joe"s "Best" Coffee');
      expect(rows[0]!.about).toBe('Great "place"');
    });
  });

  describe('createJob', () => {
    it('sends POST and returns the job id', async () => {
      const fetchFn = mockFetch([{ ok: true, status: 201, body: { id: 'test-uuid-123' } }]);
      const client = new GoogleMapsScraperClient({ fetchImpl: fetchFn as unknown as typeof fetch, env: makeEnv() });

      const id = await client.createJob({ keywords: ['dentist'], lat: '30.2', lon: '-97.7', max_time: 60 });
      expect(id).toBe('test-uuid-123');
      expect(fetchFn).toHaveBeenCalledWith(
        'http://scraper.test:8080/api/v1/jobs',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws PROVIDER_UNAVAILABLE on 500', async () => {
      const fetchFn = mockFetch([{ ok: false, status: 500, body: null, text: 'Internal error' }]);
      const client = new GoogleMapsScraperClient({ fetchImpl: fetchFn as unknown as typeof fetch, env: makeEnv() });

      await expect(client.createJob({ keywords: ['test'], lat: '0', lon: '0', max_time: 60 }))
        .rejects.toThrow(ScraperError);
      try {
        await client.createJob({ keywords: ['test'], lat: '0', lon: '0', max_time: 60 });
      } catch (e) {
        expect((e as ScraperError).code).toBe('PROVIDER_UNAVAILABLE');
      }
    });

    it('throws PROVIDER_UNAVAILABLE on network error', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const client = new GoogleMapsScraperClient({ fetchImpl: fetchFn as unknown as typeof fetch, env: makeEnv() });

      try {
        await client.createJob({ keywords: ['test'], lat: '0', lon: '0', max_time: 60 });
      } catch (e) {
        expect(e).toBeInstanceOf(ScraperError);
        expect((e as ScraperError).code).toBe('PROVIDER_UNAVAILABLE');
      }
    });
  });

  describe('waitForCompletion', () => {
    it('polls until status is ok', async () => {
      const fetchFn = mockFetch([
        { ok: true, status: 200, body: { id: 'j1', Status: 'pending' } },
        { ok: true, status: 200, body: { id: 'j1', Status: 'working' } },
        { ok: true, status: 200, body: { id: 'j1', Status: 'ok' } },
      ]);
      const client = new GoogleMapsScraperClient({ fetchImpl: fetchFn as unknown as typeof fetch, env: makeEnv() });

      const status = await client.waitForCompletion('j1');
      expect(status.Status).toBe('ok');
      expect(fetchFn).toHaveBeenCalledTimes(3);
    });

    it('throws SCRAPER_JOB_FAILED on status failed', async () => {
      const fetchFn = mockFetch([
        { ok: true, status: 200, body: { id: 'j1', Status: 'failed' } },
      ]);
      const client = new GoogleMapsScraperClient({ fetchImpl: fetchFn as unknown as typeof fetch, env: makeEnv() });

      try {
        await client.waitForCompletion('j1');
      } catch (e) {
        expect(e).toBeInstanceOf(ScraperError);
        expect((e as ScraperError).code).toBe('SCRAPER_JOB_FAILED');
      }
    });

    it('throws TIMEOUT after max poll attempts', async () => {
      const fetchFn = mockFetch([
        { ok: true, status: 200, body: { id: 'j1', Status: 'working' } },
      ]);
      const client = new GoogleMapsScraperClient({
        fetchImpl: fetchFn as unknown as typeof fetch,
        env: makeEnv({ GOOGLE_MAPS_SCRAPER_MAX_POLL_ATTEMPTS: 2, GOOGLE_MAPS_SCRAPER_POLL_INTERVAL_MS: 10 } as Partial<Env>),
      });

      try {
        await client.waitForCompletion('j1');
      } catch (e) {
        expect(e).toBeInstanceOf(ScraperError);
        expect((e as ScraperError).code).toBe('TIMEOUT');
      }
    });

    it('throws CANCELLED when signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const fetchFn = mockFetch([{ ok: true, status: 200, body: { id: 'j1', Status: 'working' } }]);
      const client = new GoogleMapsScraperClient({ fetchImpl: fetchFn as unknown as typeof fetch, env: makeEnv() });

      try {
        await client.waitForCompletion('j1', controller.signal);
      } catch (e) {
        expect(e).toBeInstanceOf(ScraperError);
        expect((e as ScraperError).code).toBe('CANCELLED');
      }
    });
  });

  describe('downloadResults', () => {
    it('fetches and parses CSV from download endpoint', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(SAMPLE_CSV),
      });
      const client = new GoogleMapsScraperClient({ fetchImpl: fetchFn as unknown as typeof fetch, env: makeEnv() });

      const rows = await client.downloadResults('j1');
      expect(rows).toHaveLength(2);
      expect(fetchFn).toHaveBeenCalledWith(
        'http://scraper.test:8080/api/v1/jobs/j1/download',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('healthCheck', () => {
    it('returns READY when scraper responds OK', async () => {
      const fetchFn = mockFetch([{ ok: true, status: 200, body: [] }]);
      const client = new GoogleMapsScraperClient({ fetchImpl: fetchFn as unknown as typeof fetch, env: makeEnv() });

      const health = await client.healthCheck();
      expect(health.status).toBe('READY');
    });

    it('returns UNAVAILABLE on network error', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const client = new GoogleMapsScraperClient({ fetchImpl: fetchFn as unknown as typeof fetch, env: makeEnv() });

      const health = await client.healthCheck();
      expect(health.status).toBe('UNAVAILABLE');
      expect(health.details[0]).toContain('ECONNREFUSED');
    });

    it('returns UNAVAILABLE on non-OK status', async () => {
      const fetchFn = mockFetch([{ ok: false, status: 503, body: null }]);
      const client = new GoogleMapsScraperClient({ fetchImpl: fetchFn as unknown as typeof fetch, env: makeEnv() });

      const health = await client.healthCheck();
      expect(health.status).toBe('UNAVAILABLE');
    });
  });
});

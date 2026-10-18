import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NominatimGeocoder, GeocodingError } from './geocode.js';

function mockFetch(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

describe('NominatimGeocoder', () => {
  let geocoder: NominatimGeocoder;
  let fetchFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchFn = mockFetch([
      { lat: '30.2672', lon: '-97.7431', display_name: 'Austin, Travis County, Texas, United States' },
    ]);
    geocoder = new NominatimGeocoder({ fetchImpl: fetchFn as unknown as typeof fetch, baseUrl: 'https://nominatim.test' });
  });

  it('returns lat/lon from Nominatim response', async () => {
    const result = await geocoder.geocode({ city: 'Austin', state: 'Texas', country: 'United States' });
    expect(result.lat).toBe('30.2672');
    expect(result.lon).toBe('-97.7431');
    expect(result.displayName).toContain('Austin');
  });

  it('sends correct query parameters', async () => {
    await geocoder.geocode({ city: 'Austin', state: 'Texas', country: 'United States' });
    const url = new URL(fetchFn.mock.calls[0]![0] as string);
    expect(url.searchParams.get('city')).toBe('Austin');
    expect(url.searchParams.get('state')).toBe('Texas');
    expect(url.searchParams.get('country')).toBe('United States');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('limit')).toBe('1');
  });

  it('throws GeocodingError when no results', async () => {
    fetchFn = mockFetch([]);
    geocoder = new NominatimGeocoder({ fetchImpl: fetchFn as unknown as typeof fetch, baseUrl: 'https://nominatim.test' });
    await expect(geocoder.geocode({ city: 'Nonexistent' }))
      .rejects.toThrow(GeocodingError);
  });

  it('throws GeocodingError when no location params provided', async () => {
    await expect(geocoder.geocode({})).rejects.toThrow(GeocodingError);
  });

  it('throws GeocodingError on network failure', async () => {
    fetchFn = vi.fn().mockRejectedValue(new Error('Network down'));
    geocoder = new NominatimGeocoder({ fetchImpl: fetchFn as unknown as typeof fetch, baseUrl: 'https://nominatim.test' });
    await expect(geocoder.geocode({ city: 'Austin' }))
      .rejects.toThrow(GeocodingError);
  });

  it('throws GeocodingError on non-OK HTTP status', async () => {
    fetchFn = mockFetch(null, 429);
    geocoder = new NominatimGeocoder({ fetchImpl: fetchFn as unknown as typeof fetch, baseUrl: 'https://nominatim.test' });
    await expect(geocoder.geocode({ city: 'Austin' }))
      .rejects.toThrow(GeocodingError);
  });

  it('caches repeated queries', async () => {
    await geocoder.geocode({ city: 'Austin', country: 'United States' });
    await geocoder.geocode({ city: 'Austin', country: 'United States' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('cache key is case-insensitive', async () => {
    await geocoder.geocode({ city: 'Austin', country: 'United States' });
    await geocoder.geocode({ city: 'AUSTIN', country: 'UNITED STATES' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

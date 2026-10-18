export interface GeocoderOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export interface GeocodingResult {
  lat: string;
  lon: string;
  displayName: string;
}

export class GeocodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeocodingError';
  }
}

const MAX_CACHE_SIZE = 500;
const MIN_REQUEST_GAP_MS = 1_100;

export class NominatimGeocoder {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly cache = new Map<string, GeocodingResult>();
  private lastRequestAt = 0;

  constructor(options: GeocoderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? 'https://nominatim.openstreetmap.org';
  }

  async geocode(params: {
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  }): Promise<GeocodingResult> {
    if (!params.city && !params.state && !params.country && !params.postalCode) {
      throw new GeocodingError('At least one of city, state, country, or postalCode is required for geocoding');
    }

    const key = this.cacheKey(params);
    const cached = this.cache.get(key);
    if (cached) return cached;

    await this.throttle();

    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    if (params.city) url.searchParams.set('city', params.city);
    if (params.state) url.searchParams.set('state', params.state);
    if (params.country) url.searchParams.set('country', params.country);
    if (params.postalCode) url.searchParams.set('postalcode', params.postalCode);

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        headers: {
          'User-Agent': 'SignalForge/1.0 (lead-discovery geocoder)',
          Accept: 'application/json',
        },
      });
    } catch (err) {
      throw new GeocodingError(
        `Nominatim request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      throw new GeocodingError(`Nominatim returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    if (data.length === 0) {
      const parts = [params.city, params.state, params.country].filter(Boolean).join(', ');
      throw new GeocodingError(`No geocoding results for: ${parts}`);
    }

    const result: GeocodingResult = {
      lat: data[0]!.lat,
      lon: data[0]!.lon,
      displayName: data[0]!.display_name,
    };

    if (this.cache.size >= MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value as string;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, result);

    return result;
  }

  private cacheKey(params: {
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  }): string {
    return [
      params.city?.toLowerCase().trim(),
      params.state?.toLowerCase().trim(),
      params.country?.toLowerCase().trim(),
      params.postalCode?.trim(),
    ].join('|');
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < MIN_REQUEST_GAP_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_GAP_MS - elapsed));
    }
    this.lastRequestAt = Date.now();
  }
}

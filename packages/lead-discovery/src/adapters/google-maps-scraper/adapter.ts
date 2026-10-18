import type { DiscoverySourceType } from '@signalforge/database';
import type { Env } from '@signalforge/config';
import { getEnv } from '@signalforge/config';

import type {
  AdapterContext,
  LeadSearchParams,
  LeadSearchResult,
  LeadSourceAdapter,
  RawDiscoveredLead,
} from '../../types.js';
import { GoogleMapsScraperClient, type ScraperResultRow } from './client.js';
import { NominatimGeocoder } from './geocode.js';
import { parseAddress } from './address-parser.js';

export interface GoogleMapsScraperAdapterOptions {
  client?: GoogleMapsScraperClient;
  geocoder?: NominatimGeocoder;
  env?: Env | (() => Env);
}

export class GoogleMapsScraperAdapter implements LeadSourceAdapter {
  readonly source: DiscoverySourceType = 'GOOGLE_MAPS_SCRAPER';
  readonly displayName = 'Google Maps (self-hosted scraper)';
  readonly billable = false;

  private readonly client: GoogleMapsScraperClient;
  private readonly geocoder: NominatimGeocoder;
  private readonly envSource: Env | (() => Env);

  constructor(options: GoogleMapsScraperAdapterOptions = {}) {
    this.client = options.client ?? new GoogleMapsScraperClient();
    this.geocoder = options.geocoder ?? new NominatimGeocoder();
    this.envSource = options.env ?? getEnv;
  }

  isConfigured(): boolean {
    try {
      const env = typeof this.envSource === 'function' ? this.envSource() : this.envSource;
      return Boolean(env.GOOGLE_MAPS_SCRAPER_ENABLED);
    } catch {
      return false;
    }
  }

  async search(
    params: LeadSearchParams,
    context: AdapterContext,
  ): Promise<LeadSearchResult> {
    const warnings: string[] = [];
    const appliedFilters: string[] = [];

    const keywords = this.buildKeywords(params);
    if (keywords.length === 0) {
      return {
        leads: [],
        appliedFilters: [],
        requestsUsed: 0,
        warnings: ['No keywords could be derived from the search parameters'],
      };
    }

    const geo = await this.geocoder.geocode({
      city: params.city,
      state: params.state,
      country: params.country,
      postalCode: params.postalCode,
    });
    appliedFilters.push('city', 'state', 'country');

    const env = typeof this.envSource === 'function' ? this.envSource() : this.envSource;
    const scraperJobId = await this.client.createJob(
      {
        name: keywords.join(', '),
        keywords,
        lat: geo.lat,
        lon: geo.lon,
        max_time: env.GOOGLE_MAPS_SCRAPER_MAX_TIME,
        depth: env.GOOGLE_MAPS_SCRAPER_DEPTH,
        lang: 'en',
        email: true,
        radius: params.radiusMeters,
      },
      context.signal,
    );

    try {
      await this.client.waitForCompletion(scraperJobId, context.signal);

      const rows = await this.client.downloadResults(scraperJobId, context.signal);

      const leads = rows
        .slice(0, params.maxResults)
        .map((row) => this.mapRowToLead(row, params));

      appliedFilters.push('maxResults', 'keywords');
      if (params.radiusMeters) appliedFilters.push('radiusMeters');

      if (rows.length > params.maxResults) {
        warnings.push(
          `Scraper returned ${rows.length} results; capped at ${params.maxResults}`,
        );
      }

      return {
        leads,
        appliedFilters,
        requestsUsed: 1,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } finally {
      try {
        await this.client.deleteJob(scraperJobId);
      } catch {
        console.info(
          JSON.stringify({
            event: 'scraper_cleanup_failed',
            scraperJobId,
            jobId: context.jobId,
            timestamp: new Date().toISOString(),
          }),
        );
      }
    }
  }

  private buildKeywords(params: LeadSearchParams): string[] {
    const parts: string[] = [];
    if (params.keywords?.length) parts.push(...params.keywords);
    if (params.industry) parts.push(params.industry);
    if (params.category) parts.push(params.category);
    return parts;
  }

  private mapRowToLead(
    row: ScraperResultRow,
    params: LeadSearchParams,
  ): RawDiscoveredLead {
    const address = parseAddress(row.complete_address || row.address);
    const firstEmail =
      (row.emails || '')
        .split(/[,;\s]+/)
        .map((e) => e.trim())
        .find((e) => e.includes('@')) ?? null;

    return {
      company: row.title || null,
      firstName: null,
      lastName: null,
      fullName: row.owner || null,
      jobTitle: row.owner ? 'Owner' : null,
      email: firstEmail,
      phone: row.phone || null,
      website: row.website || null,
      industry: row.category || null,
      country: address.country ?? params.country ?? null,
      countryCode: params.countryCode ?? null,
      state: address.state ?? params.state ?? null,
      city: address.city ?? params.city ?? null,
      postalCode: address.postalCode ?? params.postalCode ?? null,
      employeeCount: null,
      sourceId: row.place_id || row.cid || null,
      sourceUrl: row.link || null,
      emailSource: firstEmail ? 'SOURCE_PROVIDED' : null,
      metadata: {
        reviewRating: row.review_rating ? parseFloat(row.review_rating) : null,
        reviewCount: row.review_count ? parseInt(row.review_count, 10) : null,
        latitude: row.latitude || null,
        longitude: row.longitude || null,
        priceRange: row.price_range || null,
        timezone: row.timezone || null,
        openHours: row.open_hours || null,
        googleMapsLink: row.link || null,
        category: row.category || null,
      },
    };
  }
}

export const googleMapsScraperAdapter = new GoogleMapsScraperAdapter();

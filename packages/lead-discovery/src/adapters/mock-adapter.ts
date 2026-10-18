/// Deterministic fake discovery source.
///
/// Exists so the whole pipeline — search, normalize, dedupe, qualify, promote,
/// enroll — can be developed, demoed and tested without a paid provider or a
/// live API key. Results are generated from the search parameters, so a search
/// for dentists in Austin returns plausible Austin dentists.
///
/// These records are obviously synthetic (example.com domains, 555 numbers) and
/// the adapter is only selectable when LEAD_DISCOVERY_MODE=mock, so they cannot
/// quietly end up in a production workspace.

import type { AdapterContext, LeadSearchParams, LeadSearchResult, LeadSourceAdapter, RawDiscoveredLead } from '../types.js';

const COMPANY_PREFIXES = [
  'Riverside', 'Summit', 'Bluebird', 'Northgate', 'Cedar Park', 'Lakeview',
  'Ironwood', 'Silverleaf', 'Redstone', 'Harborview', 'Fairmount', 'Oakridge',
];

const COMPANY_SUFFIXES = ['Group', 'Partners', 'Studio', 'Collective', 'Works', 'Co'];

const FIRST_NAMES = ['Jordan', 'Riley', 'Avery', 'Casey', 'Morgan', 'Quinn', 'Rowan', 'Emerson'];
const LAST_NAMES = ['Whitfield', 'Nakamura', 'Okonkwo', 'Bergstrom', 'Halvorsen', 'Castellanos'];
const TITLES = ['Founder', 'CEO', 'Managing Director', 'Owner', 'Operations Lead'];

/// Small deterministic hash so the same query always yields the same businesses.
function seededIndex(seed: string, salt: number, modulo: number): number {
  let hash = 2166136261;
  const input = `${seed}:${salt}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % modulo;
}

export class MockAdapter implements LeadSourceAdapter {
  readonly source = 'MOCK' as const;
  readonly displayName = 'Mock source (development)';
  readonly billable = false;

  isConfigured(): boolean {
    return true;
  }

  async search(params: LeadSearchParams, context: AdapterContext): Promise<LeadSearchResult> {
    const seed = [
      params.industry ?? '',
      params.city ?? '',
      params.state ?? '',
      params.countryCode ?? params.country ?? '',
      (params.keywords ?? []).join(','),
      context.workspaceId,
    ].join('|');

    const count = Math.min(params.maxResults, 100);
    const industry = params.industry ?? 'Professional Services';
    const leads: RawDiscoveredLead[] = [];

    for (let i = 0; i < count; i += 1) {
      const prefix = COMPANY_PREFIXES[seededIndex(seed, i, COMPANY_PREFIXES.length)] ?? 'Riverside';
      const suffix = COMPANY_SUFFIXES[seededIndex(seed, i + 500, COMPANY_SUFFIXES.length)] ?? 'Group';
      const company = `${prefix} ${industry} ${suffix}`;
      const slug = `${prefix}${suffix}`.toLowerCase().replace(/[^a-z0-9]/g, '');

      // Deliberately imperfect coverage: roughly a quarter of records have no
      // website and a third no email, which is what real sources look like and
      // what the enrichment stages need to cope with.
      const hasWebsite = seededIndex(seed, i + 11, 4) !== 0;
      const hasEmail = seededIndex(seed, i + 23, 3) !== 0;
      const hasPerson = seededIndex(seed, i + 31, 2) === 0;

      const firstName = hasPerson ? FIRST_NAMES[seededIndex(seed, i + 41, FIRST_NAMES.length)] ?? null : null;
      const lastName = hasPerson ? LAST_NAMES[seededIndex(seed, i + 53, LAST_NAMES.length)] ?? null : null;

      leads.push({
        company,
        firstName,
        lastName,
        jobTitle: hasPerson ? TITLES[seededIndex(seed, i + 61, TITLES.length)] ?? null : null,
        email: hasEmail ? `info@${slug}.example.com` : null,
        phone: `+1512555${String(1000 + seededIndex(seed, i + 71, 8999)).slice(0, 4)}`,
        website: hasWebsite ? `https://www.${slug}.example.com` : null,
        industry,
        country: params.country ?? 'United States',
        countryCode: params.countryCode ?? 'US',
        state: params.state ?? 'Texas',
        city: params.city ?? 'Austin',
        postalCode: null,
        employeeCount: ['1-10', '11-50', '51-200'][seededIndex(seed, i + 83, 3)] ?? null,
        sourceId: `mock-${slug}-${i}`,
        sourceUrl: hasWebsite ? `https://www.${slug}.example.com` : null,
        emailSource: hasEmail ? 'SOURCE_PROVIDED' : null,
        metadata: { synthetic: true },
      });
    }

    return {
      leads,
      appliedFilters: ['industry', 'city', 'state', 'countryCode', 'maxResults'],
      requestsUsed: 0,
      warnings: ['Mock source — these businesses are synthetic and must not be contacted.'],
    };
  }
}

export const mockAdapter = new MockAdapter();

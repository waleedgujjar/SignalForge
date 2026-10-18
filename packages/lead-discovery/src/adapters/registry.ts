/// Registry of discovery sources.
///
/// The registry is the single place that decides which sources exist, whether
/// each is configured, and whether it can bill the workspace. Adding a source
/// later means adding an adapter here — nothing else in the engine changes.
///
/// Sources without an authorized integration (Yelp, Clutch, Yellow Pages) are
/// deliberately declared but NOT implemented. They surface in settings as
/// "Not configured" so the architecture is ready for a future licensed API.
/// No scraping adapter is shipped for them.

import type { DiscoverySourceType } from '@signalforge/database';

import { AdapterNotAvailableError, AdapterNotConfiguredError } from '../types.js';
import type { LeadSourceAdapter } from '../types.js';
import { csvAdapter, xlsxAdapter } from './file-adapter.js';
import { googleMapsScraperAdapter } from './google-maps-scraper/index.js';
import { mockAdapter } from './mock-adapter.js';

export interface SourceDescriptor {
  source: DiscoverySourceType;
  displayName: string;
  /// An adapter exists and can run.
  implemented: boolean;
  /// Credentials/config present, so it can run right now.
  configured: boolean;
  /// The provider may charge for a search.
  billable: boolean;
  /// Requires an uploaded file rather than a query.
  fileBased: boolean;
  note?: string;
}

const ADAPTERS = new Map<DiscoverySourceType, LeadSourceAdapter>([
  ['CSV', csvAdapter],
  ['XLSX', xlsxAdapter],
  ['MOCK', mockAdapter],
  ['GOOGLE_MAPS_SCRAPER', googleMapsScraperAdapter],
]);

/// Sources we intend to support but cannot legitimately implement yet.
const PLANNED: Array<{ source: DiscoverySourceType; displayName: string; note: string }> = [
  { source: 'YELP', displayName: 'Yelp', note: 'Requires an authorized Yelp Fusion API agreement' },
  { source: 'CLUTCH', displayName: 'Clutch', note: 'No public API available' },
  { source: 'YELLOW_PAGES', displayName: 'Yellow Pages', note: 'No public API available' },
];

export const FILE_BASED_SOURCES: DiscoverySourceType[] = ['CSV', 'XLSX'];

export function isFileBased(source: DiscoverySourceType): boolean {
  return FILE_BASED_SOURCES.includes(source);
}

export function registerAdapter(adapter: LeadSourceAdapter): void {
  ADAPTERS.set(adapter.source, adapter);
}

export function getAdapter(source: DiscoverySourceType): LeadSourceAdapter {
  const adapter = ADAPTERS.get(source);
  if (!adapter) throw new AdapterNotAvailableError(source);
  if (!adapter.isConfigured()) throw new AdapterNotConfiguredError(source);
  return adapter;
}

export function hasAdapter(source: DiscoverySourceType): boolean {
  return ADAPTERS.has(source);
}

/// Everything the settings screen needs to render the source list.
export function listSources(): SourceDescriptor[] {
  const implemented: SourceDescriptor[] = [...ADAPTERS.values()].map((adapter) => ({
    source: adapter.source,
    displayName: adapter.displayName,
    implemented: true,
    configured: adapter.isConfigured(),
    billable: adapter.billable,
    fileBased: isFileBased(adapter.source),
  }));

  const planned: SourceDescriptor[] = PLANNED.filter((entry) => !ADAPTERS.has(entry.source)).map((entry) => ({
    source: entry.source,
    displayName: entry.displayName,
    implemented: false,
    configured: false,
    billable: false,
    fileBased: false,
    note: entry.note,
  }));

  return [...implemented, ...planned];
}

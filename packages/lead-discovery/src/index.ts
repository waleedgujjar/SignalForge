export type {
  AdapterContext,
  LeadSearchParams,
  LeadSearchResult,
  LeadSourceAdapter,
  RawDiscoveredLead,
} from './types.js';
export {
  AdapterNotAvailableError,
  AdapterNotConfiguredError,
  DiscoveryJobNotFoundError,
  InvalidDiscoveryRequestError,
} from './types.js';

export {
  hasUsableIdentity,
  hasImportableRowData,
  normalizeCompany,
  normalizeCountryCode,
  normalizeDomain,
  normalizeEmail,
  normalizeLead,
  normalizePhone,
  normalizeStateName,
  normalizeWebsite,
  isValidEmail,
  isInvalidOwnerName,
  isPlaceholderEmail,
  generatePlaceholderEmail,
  resolveLeadName,
  getLeadDisplayName,
  titleCase,
  type NormalizedLead,
  type ResolvedName,
} from './normalization.js';

export {
  addToIndex,
  createDedupIndex,
  dedupeBatch,
  findDuplicate,
  similarity,
  sourceKeyOf,
  toDedupEntry,
  type DedupEntry,
  type DedupIndex,
  type DedupMatch,
  type DedupOutcome,
  type MatchTier,
} from './dedup.js';

export {
  deriveAiOpportunity,
  loadIcpProfile,
  qualifyLead,
  QUALIFICATION_VERSION,
  type QualificationOutcome,
  type QualificationSignalCode,
  type QualificationSignalEntry,
  type QualificationSignals,
  type ResolvedIcpProfile,
} from './qualification.js';

export { requalifyLeads, type RequalifyInput, type RequalifyResult } from './requalify.js';

export { FileAdapter, csvAdapter, mapRow, mimeTypeForSource, xlsxAdapter } from './adapters/file-adapter.js';
export {
  GoogleMapsScraperAdapter,
  googleMapsScraperAdapter,
  GoogleMapsScraperClient,
  ScraperError,
  NominatimGeocoder,
  GeocodingError,
  parseAddress,
  type ScraperResultRow,
  type ParsedAddress,
} from './adapters/google-maps-scraper/index.js';
export { MockAdapter, mockAdapter } from './adapters/mock-adapter.js';
export {
  FILE_BASED_SOURCES,
  getAdapter,
  hasAdapter,
  isFileBased,
  listSources,
  registerAdapter,
  type SourceDescriptor,
} from './adapters/registry.js';

export { logDiscoveryActivity, listDiscoveryActivity } from './activity.js';
export { promoteDiscoveredLeads, type PromotionResult } from './promotion.js';
export {
  enqueueWebsiteAnalysisForLead,
  enqueueWebsiteAnalysisForLeads,
  closeWebsiteAnalysisQueue,
} from './enqueue-website-analysis.js';
export {
  MAX_DISCOVERY_RESULTS,
  MAX_EMAIL_VERIFY_CONCURRENCY,
  loadDedupCandidates,
  mapWithConcurrency,
  passesRequirements,
  runDiscoveryJob,
  type RunDiscoveryResult,
} from './pipeline.js';

export {
  DISCOVERED_LEAD_EXPORT_COLUMNS,
  escapeCsvValue,
  toCsv,
  toXlsx,
  type DiscoveredLeadExportRow,
  type ExportColumn,
} from './export.js';
export {
  processImportRows,
  computeFieldStats,
  toPreviewRows,
  mergeLeadFields,
  executeImportRows,
  persistLeadBatch,
  formatMappingsResponse,
  type ProcessedImportRow,
  type ImportFieldStats,
  type PreviewImportRow,
  type ProcessRowsResult,
  type ImportExecutionSummary,
  type ExecuteImportOptions,
  type PersistBatchResult,
} from './import-processor.js';

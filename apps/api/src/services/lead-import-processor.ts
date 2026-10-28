// The lead-import processing logic lives in @signalforge/lead-discovery so it can
// be shared by the API (preview + synchronous imports) and the background
// import-worker. This module re-exports it to keep existing import paths stable.
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
} from '@signalforge/lead-discovery';

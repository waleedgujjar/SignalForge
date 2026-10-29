/// Normalize browser-reported MIME types for CSV/XLS/XLSX imports.
/// Windows often sends `application/vnd.ms-excel` or empty string for `.csv` files,
/// so that MIME type only means "legacy .xls" when the filename actually ends in .xls.
export const XLS_MIME = 'application/vnd.ms-excel';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function resolveImportMimeType(mimeType: string | undefined, filename?: string): string {
  const ext = filename?.toLowerCase() ?? '';
  const normalized = (mimeType ?? '').trim().toLowerCase();

  if (ext.endsWith('.xls')) {
    return XLS_MIME;
  }
  if (ext.endsWith('.xlsx')) {
    return XLSX_MIME;
  }

  if (
    ext.endsWith('.csv') ||
    normalized === 'text/csv' ||
    normalized === 'application/csv' ||
    normalized === 'text/plain' ||
    normalized === XLS_MIME // Windows quirk: sent for .csv files (non-.xls names)
  ) {
    return 'text/csv';
  }

  if (normalized === XLSX_MIME || normalized === 'application/vnd.google-apps.spreadsheet') {
    return normalized;
  }

  return mimeType?.trim() || 'text/csv';
}

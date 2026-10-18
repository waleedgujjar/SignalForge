/// Normalize browser-reported MIME types for CSV/XLSX imports.
/// Windows often sends `application/vnd.ms-excel` or empty string for `.csv` files.
export function resolveImportMimeType(mimeType: string | undefined, filename?: string): string {
  const ext = filename?.toLowerCase() ?? '';
  const normalized = (mimeType ?? '').trim().toLowerCase();

  if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }

  if (
    ext.endsWith('.csv') ||
    normalized === 'text/csv' ||
    normalized === 'application/csv' ||
    normalized === 'text/plain' ||
    normalized === 'application/vnd.ms-excel'
  ) {
    return 'text/csv';
  }

  if (
    normalized === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    normalized === 'application/vnd.google-apps.spreadsheet'
  ) {
    return normalized;
  }

  return mimeType?.trim() || 'text/csv';
}

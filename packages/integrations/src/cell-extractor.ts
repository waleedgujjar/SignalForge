import type ExcelJS from 'exceljs';

/**
 * Safely extract display text from an ExcelJS cell value.
 * Handles hyperlinks, rich text, formulas, dates, and formula-injection strings.
 */
export function extractCellText(cell: ExcelJS.Cell): string {
  const val = cell.value;

  if (val === null || val === undefined) {
    return typeof cell.text === 'string' ? cell.text.trim() : cell.text != null ? String(cell.text).trim() : '';
  }

  if (typeof val === 'string') {
    return sanitizeCellString(val);
  }

  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val);
  }

  if (val instanceof Date) {
    return val.toISOString();
  }

  if (typeof val === 'object') {
    const obj = val as unknown as Record<string, unknown>;

    // Hyperlink: { text: '...', hyperlink: '...' }
    if (typeof obj.hyperlink === 'string') {
      const link = obj.hyperlink as string;
      const text = typeof obj.text === 'string' ? obj.text : typeof cell.text === 'string' ? cell.text : cell.text != null ? String(cell.text) : '';
      if (text.trim()) return sanitizeCellString(text);
      return sanitizeCellString(link.replace(/^mailto:/i, ''));
    }

    // Rich text: { richText: [{ text: '...' }, ...] }
    if (Array.isArray(obj.richText)) {
      const combined = (obj.richText as Array<{ text?: string }>)
        .map((part) => part.text ?? '')
        .join('');
      return sanitizeCellString(combined);
    }

    // Formula: { formula: '...', result: ... }
    if ('result' in obj && obj.result !== null && obj.result !== undefined) {
      return extractCellText({ ...cell, value: obj.result } as ExcelJS.Cell);
    }

    // Shared string / text property
    if (typeof obj.text === 'string') {
      return sanitizeCellString(obj.text);
    }
  }

  const fallback = typeof cell.text === 'string' ? cell.text.trim() : cell.text != null ? String(cell.text).trim() : '';
  if (fallback) return sanitizeCellString(fallback);

  return '';
}

function sanitizeCellString(value: string): string {
  const trimmed = value.trim();
  // Prevent formula injection when re-exported or displayed
  if (trimmed.startsWith('=') || trimmed.startsWith('+') || trimmed.startsWith('-') || trimmed.startsWith('@')) {
    return trimmed.slice(1).trim();
  }
  return trimmed;
}

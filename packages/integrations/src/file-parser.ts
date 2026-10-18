import { parse } from 'csv-parse';
import ExcelJS from 'exceljs';
import type { Readable } from 'node:stream';
import type { ParsedFileResult } from './types.js';
import { MAX_ROWS_PER_FILE } from './types.js';
import { resolveImportMimeType } from './mime.js';
import { extractCellText } from './cell-extractor.js';

interface ParseOptions {
  previewOnly?: boolean;
  maxRows?: number;
}

export async function parseFileStream(
  stream: Readable,
  mimeType: string,
  options: ParseOptions & { filename?: string } = {},
): Promise<ParsedFileResult> {
  const maxRows = options.maxRows ?? (options.previewOnly ? 100 : MAX_ROWS_PER_FILE);
  const resolved = resolveImportMimeType(mimeType, options.filename);

  if (resolved === 'text/csv') {
    return parseCSVStream(stream, maxRows);
  }

  if (
    resolved === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    resolved === 'application/vnd.google-apps.spreadsheet'
  ) {
    return parseXLSXStream(stream, maxRows);
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}

async function parseCSVStream(
  stream: Readable,
  maxRows: number,
): Promise<ParsedFileResult> {
  return new Promise((resolve, reject) => {
    const rows: Record<string, string>[] = [];
    let headers: string[] = [];
    let totalRowCount = 0;

    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    parser.on('readable', () => {
      let record: Record<string, string>;
      while ((record = parser.read()) !== null) {
        totalRowCount++;
        if (rows.length < maxRows) {
          rows.push(record);
        }
        if (headers.length === 0) {
          headers = Object.keys(record);
        }
      }
    });

    parser.on('error', (err) => reject(err));
    parser.on('end', () => resolve({ headers, rows, totalRowCount }));

    stream.pipe(parser);
  });
}

async function parseXLSXStream(
  stream: Readable,
  maxRows: number,
): Promise<ParsedFileResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(stream);

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount === 0) {
    throw new Error('XLSX file has no data');
  }

  const headers: string[] = [];
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = extractCellText(cell);
    headers[colNumber - 1] = text || `Column ${colNumber}`;
  });

  const rows: Record<string, string>[] = [];
  const totalRowCount = worksheet.rowCount - 1;

  for (let i = 2; i <= worksheet.rowCount && rows.length < maxRows; i++) {
    const row = worksheet.getRow(i);
    const obj: Record<string, string> = {};
    let hasValue = false;

    headers.forEach((header, idx) => {
      const cell = row.getCell(idx + 1);
      const text = extractCellText(cell);
      if (text) {
        obj[header] = text;
        hasValue = true;
      } else {
        obj[header] = '';
      }
    });

    if (hasValue) {
      rows.push(obj);
    }
  }

  return { headers, rows, totalRowCount };
}

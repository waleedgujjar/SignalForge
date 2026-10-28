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

/**
 * Thrown for files we cannot parse (bad delimiter/quotes, not a real workbook,
 * empty, etc.). Import routes map this to a 400 so a malformed upload is a clear
 * client error instead of an unhandled 500.
 */
export class FileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileParseError';
  }
}

const CSV_DELIMITERS = [',', '\t', ';', '|'];

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

/**
 * Pick the delimiter that appears most on the first non-empty line. Exports that
 * use tabs or semicolons are common; assuming a comma turns the whole row into a
 * single column and then chokes on the first quote.
 */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  let best = ',';
  let bestCount = 0;
  for (const delimiter of CSV_DELIMITERS) {
    const count = firstLine.split(delimiter).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = delimiter;
    }
  }
  return best;
}

export async function parseFileStream(
  stream: Readable,
  mimeType: string,
  options: ParseOptions & { filename?: string } = {},
): Promise<ParsedFileResult> {
  const maxRows = options.maxRows ?? (options.previewOnly ? 100 : MAX_ROWS_PER_FILE);
  const resolved = resolveImportMimeType(mimeType, options.filename);
  const buffer = await streamToBuffer(stream);

  if (resolved === 'text/csv') {
    return parseDelimitedBuffer(buffer, maxRows);
  }

  if (
    resolved === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    resolved === 'application/vnd.google-apps.spreadsheet'
  ) {
    return parseXLSXBuffer(buffer, maxRows);
  }

  throw new FileParseError(`Unsupported file type: ${mimeType}`);
}

function parseDelimitedBuffer(buffer: Buffer, maxRows: number): Promise<ParsedFileResult> {
  const text = buffer.toString('utf8');
  if (text.trim() === '') {
    return Promise.resolve({ headers: [], rows: [], totalRowCount: 0 });
  }
  const delimiter = detectDelimiter(text);

  return new Promise((resolve, reject) => {
    const rows: Record<string, string>[] = [];
    let headers: string[] = [];
    let totalRowCount = 0;

    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      delimiter,
      // Tolerate stray quotes and ragged rows instead of aborting the whole file.
      relax_quotes: true,
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

    parser.on('error', (err) =>
      reject(new FileParseError(`Could not parse the CSV file: ${err.message}`)),
    );
    parser.on('end', () => resolve({ headers, rows, totalRowCount }));

    parser.write(text);
    parser.end();
  });
}

async function parseXLSXBuffer(buffer: Buffer, maxRows: number): Promise<ParsedFileResult> {
  // A real .xlsx is a ZIP archive and begins with the "PK" local-file signature.
  const isZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;

  if (!isZip) {
    // Frequently a CSV/TSV (or an old binary .xls) saved with an .xlsx extension.
    // If it reads as text, parse it as delimited data; otherwise fail clearly.
    const text = buffer.toString('utf8');
    const printableRatio =
      text.length === 0
        ? 0
        : text.replace(/[^\t\n\r\x20-\x7e]/g, '').length / text.length;
    if (printableRatio > 0.85 && text.includes('\n')) {
      return parseDelimitedBuffer(buffer, maxRows);
    }
    throw new FileParseError(
      'This file is not a valid .xlsx workbook. If it is an older .xls file, open it in Excel and save it as .xlsx or .csv, then re-upload.',
    );
  }

  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs ships its own (older, non-generic) Buffer typing; cast to its exact
    // expected parameter type to bridge the @types/node Buffer-generic skew.
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new FileParseError(
      'The Excel file could not be read. Re-save it as .xlsx (or export to .csv) and try again.',
    );
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount === 0) {
    throw new FileParseError('The spreadsheet has no data rows.');
  }

  const headers: string[] = [];
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const cellText = extractCellText(cell);
    headers[colNumber - 1] = cellText || `Column ${colNumber}`;
  });

  const rows: Record<string, string>[] = [];
  const totalRowCount = worksheet.rowCount - 1;

  for (let i = 2; i <= worksheet.rowCount && rows.length < maxRows; i++) {
    const row = worksheet.getRow(i);
    const obj: Record<string, string> = {};
    let hasValue = false;

    headers.forEach((header, idx) => {
      const cell = row.getCell(idx + 1);
      const cellText = extractCellText(cell);
      if (cellText) {
        obj[header] = cellText;
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

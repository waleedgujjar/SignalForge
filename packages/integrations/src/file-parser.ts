import { parse } from 'csv-parse';
import ExcelJS from 'exceljs';
import * as SheetJS from 'xlsx';
import { createReadStream } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import type { ParsedFileResult } from './types.js';
import { MAX_ROWS_PER_FILE } from './types.js';
import { resolveImportMimeType, XLS_MIME, XLSX_MIME } from './mime.js';
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

  if (resolved === XLS_MIME) {
    // Extension says legacy .xls, but sniff the real format: files are often
    // mislabeled (a zip is really .xlsx; plain text is really CSV/TSV).
    if (isOleBuffer(buffer)) return parseXLSBuffer(buffer, maxRows);
    return parseXLSXBuffer(buffer, maxRows);
  }

  if (resolved === XLSX_MIME || resolved === 'application/vnd.google-apps.spreadsheet') {
    return parseXLSXBuffer(buffer, maxRows);
  }

  throw new FileParseError(`Unsupported file type: ${mimeType}`);
}

// Legacy binary .xls files are OLE compound documents (magic D0 CF 11 E0).
function isOleBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  );
}

const XLS_MAX_BYTES = 30 * 1024 * 1024;

/** Parse a legacy binary .xls workbook (first sheet) via SheetJS. */
function parseXLSBuffer(buffer: Buffer, maxRows: number): ParsedFileResult {
  if (buffer.length > XLS_MAX_BYTES) {
    throw new FileParseError(
      'Legacy .xls files over 30 MB are not supported. Save the file as .xlsx or .csv and try again.',
    );
  }
  let workbook: SheetJS.WorkBook;
  try {
    workbook = SheetJS.read(buffer, { type: 'buffer' });
  } catch {
    throw new FileParseError(
      'The .xls file could not be read. Open it in Excel and save it as .xlsx or .csv, then re-upload.',
    );
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) {
    throw new FileParseError('The spreadsheet has no worksheets.');
  }

  const matrix = SheetJS.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });
  if (matrix.length === 0) {
    return { headers: [], rows: [], totalRowCount: 0 };
  }

  const headers = (matrix[0] ?? []).map(
    (h, i) => String(h ?? '').trim() || `Column ${i + 1}`,
  );
  const rows: Record<string, string>[] = [];
  let totalRowCount = 0;

  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? [];
    const obj: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header, c) => {
      const value = cells[c];
      const text = value === null || value === undefined ? '' : String(value).trim();
      obj[header] = text;
      if (text) hasValue = true;
    });
    if (!hasValue) continue;
    totalRowCount++;
    if (rows.length < maxRows) {
      rows.push(obj);
    }
  }

  return { headers, rows, totalRowCount };
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
    // An old binary .xls saved with an .xlsx extension — parse it as .xls.
    if (isOleBuffer(buffer)) {
      return parseXLSBuffer(buffer, maxRows);
    }
    // Frequently a CSV/TSV saved with an .xlsx extension.
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
      'This file is not a valid Excel workbook. Save it as .xlsx or .csv and try again.',
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

// ─── Streaming parsers (for large background imports) ────────────────────────
// These never hold the whole file in memory: rows are delivered to onBatch in
// bounded batches, and awaiting onBatch applies backpressure to the source.

export interface StreamBatchHandlers {
  onHeaders?: (headers: string[]) => void | Promise<void>;
  onBatch: (rows: Record<string, string>[]) => Promise<void>;
  batchSize?: number;
  maxRows?: number;
  /** Stop reading once maxRows is reached (for sampling/preview). */
  stopAtMaxRows?: boolean;
}

async function readFileHead(filePath: string, bytes: number): Promise<Buffer> {
  const fd = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fd.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fd.close();
  }
}

async function isZipFile(filePath: string): Promise<boolean> {
  const head = await readFileHead(filePath, 4);
  return head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b;
}

async function isOleFile(filePath: string): Promise<boolean> {
  return isOleBuffer(await readFileHead(filePath, 8));
}

async function detectDelimiterFromFile(filePath: string): Promise<string> {
  const head = (await readFileHead(filePath, 65536)).toString('utf8');
  return detectDelimiter(head);
}

/**
 * Legacy .xls cannot be streamed (OLE container); parse buffered — capped at
 * 30 MB — and deliver rows through the same batch interface.
 */
async function streamParseXLSFile(
  filePath: string,
  handlers: StreamBatchHandlers,
  batchSize: number,
  maxRows: number,
): Promise<{ headers: string[]; totalRowCount: number }> {
  const buffer = await readFile(filePath);
  const parsed = parseXLSBuffer(buffer, maxRows);
  if (parsed.headers.length > 0) {
    await handlers.onHeaders?.(parsed.headers);
  }
  for (let i = 0; i < parsed.rows.length; i += batchSize) {
    await handlers.onBatch(parsed.rows.slice(i, i + batchSize));
    if (handlers.stopAtMaxRows && i + batchSize >= maxRows) break;
  }
  return { headers: parsed.headers, totalRowCount: parsed.totalRowCount };
}

export async function streamParseFile(
  filePath: string,
  mimeType: string,
  handlers: StreamBatchHandlers,
  filename?: string,
): Promise<{ headers: string[]; totalRowCount: number }> {
  const resolved = resolveImportMimeType(mimeType, filename);
  const batchSize = handlers.batchSize ?? 1000;
  const maxRows = handlers.maxRows ?? Number.MAX_SAFE_INTEGER;

  if (resolved === 'text/csv') {
    return streamParseDelimitedFile(filePath, handlers, batchSize, maxRows);
  }
  if (resolved === XLS_MIME) {
    // Sniff the real format: .xls names often hide a zip (.xlsx) or plain text.
    if (await isOleFile(filePath)) {
      return streamParseXLSFile(filePath, handlers, batchSize, maxRows);
    }
    if (await isZipFile(filePath)) {
      return streamParseXLSXFile(filePath, handlers, batchSize, maxRows);
    }
    return streamParseDelimitedFile(filePath, handlers, batchSize, maxRows);
  }
  if (resolved === XLSX_MIME || resolved === 'application/vnd.google-apps.spreadsheet') {
    if (!(await isZipFile(filePath))) {
      // An old binary .xls with an .xlsx name, or a renamed CSV/TSV.
      if (await isOleFile(filePath)) {
        return streamParseXLSFile(filePath, handlers, batchSize, maxRows);
      }
      return streamParseDelimitedFile(filePath, handlers, batchSize, maxRows);
    }
    return streamParseXLSXFile(filePath, handlers, batchSize, maxRows);
  }
  throw new FileParseError(`Unsupported file type: ${mimeType}`);
}

async function streamParseDelimitedFile(
  filePath: string,
  handlers: StreamBatchHandlers,
  batchSize: number,
  maxRows: number,
): Promise<{ headers: string[]; totalRowCount: number }> {
  const delimiter = await detectDelimiterFromFile(filePath);
  const parser = parse({
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    delimiter,
    relax_quotes: true,
    relax_column_count: true,
  });

  let headers: string[] = [];
  let totalRowCount = 0;
  let batch: Record<string, string>[] = [];

  const source = createReadStream(filePath);
  source.on('error', (err) => parser.destroy(err));
  source.pipe(parser);

  try {
    for await (const record of parser as AsyncIterable<Record<string, string>>) {
      if (headers.length === 0) {
        headers = Object.keys(record);
        await handlers.onHeaders?.(headers);
      }
      totalRowCount++;
      if (totalRowCount <= maxRows) {
        batch.push(record);
        if (batch.length >= batchSize) {
          await handlers.onBatch(batch);
          batch = [];
        }
      }
      if (handlers.stopAtMaxRows && totalRowCount >= maxRows) {
        source.destroy();
        break;
      }
    }
  } catch (err) {
    throw new FileParseError(`Could not parse the file: ${(err as Error).message}`);
  }

  if (batch.length > 0) {
    await handlers.onBatch(batch);
  }
  return { headers, totalRowCount };
}

async function streamParseXLSXFile(
  filePath: string,
  handlers: StreamBatchHandlers,
  batchSize: number,
  maxRows: number,
): Promise<{ headers: string[]; totalRowCount: number }> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {});
  let headers: string[] = [];
  let totalRowCount = 0;
  let batch: Record<string, string>[] = [];
  let sawWorksheet = false;

  try {
    for await (const worksheet of reader) {
      sawWorksheet = true;
      for await (const row of worksheet) {
        if (row.number === 1) {
          const hs: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell, col) => {
            hs[col - 1] = extractCellText(cell) || `Column ${col}`;
          });
          headers = hs;
          await handlers.onHeaders?.(headers);
          continue;
        }
        if (headers.length === 0) continue;

        const obj: Record<string, string> = {};
        let hasValue = false;
        for (let i = 0; i < headers.length; i++) {
          const text = extractCellText(row.getCell(i + 1));
          obj[headers[i]!] = text ?? '';
          if (text) hasValue = true;
        }
        if (!hasValue) continue;

        totalRowCount++;
        if (totalRowCount <= maxRows) {
          batch.push(obj);
          if (batch.length >= batchSize) {
            await handlers.onBatch(batch);
            batch = [];
          }
        }
        if (handlers.stopAtMaxRows && totalRowCount >= maxRows) break;
      }
      break; // first worksheet only
    }
  } catch (err) {
    throw new FileParseError(`Could not parse the Excel file: ${(err as Error).message}`);
  }

  if (!sawWorksheet) {
    throw new FileParseError('The spreadsheet has no worksheets.');
  }
  if (batch.length > 0) {
    await handlers.onBatch(batch);
  }
  return { headers, totalRowCount };
}

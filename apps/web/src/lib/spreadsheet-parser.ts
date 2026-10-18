import * as XLSX from 'xlsx';

export interface ParsedSpreadsheet {
  headers: string[];
  rows: Record<string, string>[];
}

const EXCEL_EXTENSIONS = new Set(['xlsx', 'xls']);
const CSV_EXTENSIONS = new Set(['csv']);

function isExcelFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (EXCEL_EXTENSIONS.has(ext)) return true;
  return (
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.type === 'application/vnd.ms-excel'
  );
}

function isCsvFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (CSV_EXTENSIONS.has(ext)) return true;
  return file.type === 'text/csv' || file.type === 'application/csv';
}

function looksLikeExcelZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function parseCSV(text: string): ParsedSpreadsheet {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]!);
  const rows = lines.slice(1).map((line) => {
    const values = parseLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] ?? '';
    });
    return obj;
  });

  return { headers, rows };
}

export function parseExcel(buffer: ArrayBuffer): ParsedSpreadsheet {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { headers: [], rows: [] };

  const raw = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  if (raw.length < 2) return { headers: [], rows: [] };

  const headerRow = raw[0] ?? [];
  const headers = headerRow.map((value, index) => {
    const label = String(value ?? '').trim();
    return label || `Column ${index + 1}`;
  });

  const rows = raw.slice(1).flatMap((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, index) => {
      obj[header] = String(row[index] ?? '').trim();
    });
    const hasValue = Object.values(obj).some((value) => value.length > 0);
    return hasValue ? [obj] : [];
  });

  return { headers, rows };
}

export function isSupportedSpreadsheet(file: File): boolean {
  return isCsvFile(file) || isExcelFile(file);
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedSpreadsheet> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (isExcelFile(file) || looksLikeExcelZip(bytes)) {
    return parseExcel(buffer);
  }

  const text = new TextDecoder('utf-8').decode(buffer);
  return parseCSV(text);
}

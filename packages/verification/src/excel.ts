import ExcelJS from 'exceljs';

export interface VerificationExportRow {
  [key: string]: unknown;
  email_verification_status?: string;
  email_risk_score?: number | null;
  email_confidence_score?: number | null;
  email_verification_reason?: string | null;
  email_is_disposable?: boolean | null;
  email_is_role?: boolean | null;
  email_is_catch_all?: boolean | null;
}

export const VERIFICATION_EXPORT_COLUMNS = [
  'email_verification_status',
  'email_risk_score',
  'email_confidence_score',
  'email_verification_reason',
  'email_is_disposable',
  'email_is_role',
  'email_is_catch_all',
] as const;

export async function appendVerificationColumnsToXlsx(
  originalBuffer: Buffer,
  rows: VerificationExportRow[],
  originalHeaders: string[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(originalBuffer as unknown as ExcelJS.Buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('Spreadsheet has no worksheets');
  }

  const headerRow = sheet.getRow(1);
  const rawValues = headerRow.values;
  const existingHeaders = originalHeaders.length
    ? originalHeaders
    : Array.isArray(rawValues)
      ? rawValues.slice(1).map((value) => String(value ?? ''))
      : [];

  let colOffset = existingHeaders.length + 1;
  for (const column of VERIFICATION_EXPORT_COLUMNS) {
    sheet.getCell(1, colOffset).value = column;
    sheet.getCell(1, colOffset).font = { bold: true };
    colOffset += 1;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const excelRow = sheet.getRow(i + 2);
    let col = existingHeaders.length + 1;
    for (const column of VERIFICATION_EXPORT_COLUMNS) {
      const value = row[column];
      excelRow.getCell(col).value = value === undefined ? null : (value as ExcelJS.CellValue);
      col += 1;
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function buildVerificationResultsXlsx(
  rows: VerificationExportRow[],
  originalHeaders: string[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Verification Results');
  const headers = [...originalHeaders, ...VERIFICATION_EXPORT_COLUMNS];
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow([
      ...originalHeaders.map((header) => row[header] ?? null),
      ...VERIFICATION_EXPORT_COLUMNS.map((column) => row[column] ?? null),
    ]);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

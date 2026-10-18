/// Server-side CSV and XLSX writing.
///
/// The repo had three hand-rolled CSV writers and no XLSX writer at all
/// (ExcelJS was only ever used for reading). This is a single typed writer for
/// discovery results that other modules can adopt later.

import ExcelJS from 'exceljs';

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export function escapeCsvValue(value: unknown): string {
  if (value == null) return '';
  const str = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function toCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const header = columns.map((column) => escapeCsvValue(column.header)).join(',');
  const body = rows.map((row) => columns.map((column) => escapeCsvValue(column.value(row))).join(','));
  return [header, ...body].join('\n');
}

export async function toXlsx<T>(rows: T[], columns: ExportColumn<T>[], sheetName = 'Export'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.addRow(columns.map((column) => column.header));
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow(
      columns.map((column) => {
        const value = column.value(row);
        // ExcelJS renders undefined as the string "undefined"; null is blank.
        return value === undefined ? null : (value as ExcelJS.CellValue);
      }),
    );
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export interface DiscoveredLeadExportRow {
  company: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  email: string | null;
  emailStatus: string | null;
  emailSource: string | null;
  phone: string | null;
  website: string | null;
  normalizedDomain: string | null;
  industry: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  employeeCount: string | null;
  source: string;
  sourceUrl: string | null;
  icpFitScore: number | null;
  websiteScore: number | null;
  aiOpportunity: string | null;
  qualified: boolean;
  qualifyReason: string | null;
  isDuplicate: boolean;
  createdAt: Date;
}

export const DISCOVERED_LEAD_EXPORT_COLUMNS: ExportColumn<DiscoveredLeadExportRow>[] = [
  { header: 'Company', value: (r) => r.company },
  { header: 'First Name', value: (r) => r.firstName },
  { header: 'Last Name', value: (r) => r.lastName },
  { header: 'Job Title', value: (r) => r.jobTitle },
  { header: 'Email', value: (r) => r.email },
  { header: 'Email Status', value: (r) => r.emailStatus },
  // Kept adjacent to Email so an inferred address is never mistaken for a
  // verified one when the file is opened in a spreadsheet.
  { header: 'Email Source', value: (r) => r.emailSource },
  { header: 'Phone', value: (r) => r.phone },
  { header: 'Website', value: (r) => r.website },
  { header: 'Domain', value: (r) => r.normalizedDomain },
  { header: 'Industry', value: (r) => r.industry },
  { header: 'Country', value: (r) => r.country },
  { header: 'State', value: (r) => r.state },
  { header: 'City', value: (r) => r.city },
  { header: 'Employee Count', value: (r) => r.employeeCount },
  { header: 'Source', value: (r) => r.source },
  { header: 'Source URL', value: (r) => r.sourceUrl },
  { header: 'ICP Score', value: (r) => r.icpFitScore },
  { header: 'Website Score', value: (r) => r.websiteScore },
  { header: 'AI Opportunity', value: (r) => r.aiOpportunity },
  { header: 'Qualified', value: (r) => (r.qualified ? 'Yes' : 'No') },
  { header: 'Qualification', value: (r) => r.qualifyReason },
  { header: 'Duplicate', value: (r) => (r.isDuplicate ? 'Yes' : 'No') },
  { header: 'Created At', value: (r) => r.createdAt },
];

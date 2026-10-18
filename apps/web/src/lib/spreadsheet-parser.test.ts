import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { parseCSV, parseExcel, parseSpreadsheetFile } from './spreadsheet-parser';

describe('spreadsheet-parser', () => {
  it('parses CSV text', () => {
    const parsed = parseCSV('email,firstName\na@example.com,Ada\n');
    expect(parsed.headers).toEqual(['email', 'firstName']);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toEqual({ email: 'a@example.com', firstName: 'Ada' });
  });

  it('parses Excel buffer', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['email', 'company'],
      ['b@example.com', 'Acme'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Leads');
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

    const parsed = parseExcel(buffer);
    expect(parsed.headers).toEqual(['email', 'company']);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toEqual({ email: 'b@example.com', company: 'Acme' });
  });

  it('parses uploaded Excel files', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['email'],
      ['c@example.com'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Leads');
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const file = new File([buffer], 'leads.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const parsed = await parseSpreadsheetFile(file);
    expect(parsed.headers).toEqual(['email']);
    expect(parsed.rows[0]?.email).toBe('c@example.com');
  });
});

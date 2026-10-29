import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import * as SheetJS from 'xlsx';
import { parseFileStream, FileParseError } from './file-parser.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const streamOf = (text: string) => Readable.from(Buffer.from(text, 'utf8'));

describe('parseFileStream — CSV/TSV', () => {
  it('auto-detects a tab delimiter (the real-world export case)', async () => {
    const tsv = 'Name\tEmail\tCompany\nAlice\talice@example.com\tAcme\n';
    const result = await parseFileStream(streamOf(tsv), 'text/csv');
    expect(result.headers).toEqual(['Name', 'Email', 'Company']);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ Name: 'Alice', Email: 'alice@example.com', Company: 'Acme' });
  });

  it('still parses a standard comma CSV', async () => {
    const csv = 'Name,Email\nBob,bob@example.com\n';
    const result = await parseFileStream(streamOf(csv), 'text/csv');
    expect(result.headers).toEqual(['Name', 'Email']);
    expect(result.rows[0]).toMatchObject({ Name: 'Bob', Email: 'bob@example.com' });
  });

  it('tolerates stray quotes instead of throwing INVALID_OPENING_QUOTE', async () => {
    const tsv = 'Name\tTitle\nTom\tTom "The Best"\n';
    const result = await parseFileStream(streamOf(tsv), 'text/csv');
    expect(result.rows).toHaveLength(1);
  });

  it('returns an empty result for a blank file', async () => {
    const result = await parseFileStream(streamOf('   '), 'text/csv');
    expect(result.rows).toHaveLength(0);
    expect(result.totalRowCount).toBe(0);
  });
});

describe('parseFileStream — XLSX', () => {
  it('falls back to delimited parsing when an .xlsx upload is actually text', async () => {
    const tsv = 'Name\tEmail\nDana\tdana@example.com\n';
    const result = await parseFileStream(streamOf(tsv), XLSX_MIME, { filename: 'leads.xlsx' });
    expect(result.rows[0]).toMatchObject({ Name: 'Dana', Email: 'dana@example.com' });
  });

  it('raises a FileParseError (not a crash) for a non-spreadsheet binary posing as .xlsx', async () => {
    // PNG magic: not a zip, not an OLE document, not text.
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x01]);
    await expect(
      parseFileStream(Readable.from(binary), XLSX_MIME, { filename: 'image.xlsx' }),
    ).rejects.toBeInstanceOf(FileParseError);
  });
});

describe('parseFileStream — legacy .xls', () => {
  const makeXls = (): Buffer => {
    const ws = SheetJS.utils.aoa_to_sheet([
      ['Name', 'Email', 'Company'],
      ['Eve', 'eve@example.com', 'Eve Co'],
      ['Frank', 'frank@example.com', 'Frank LLC'],
    ]);
    const wb = SheetJS.utils.book_new();
    SheetJS.utils.book_append_sheet(wb, ws, 'Sheet1');
    return SheetJS.write(wb, { type: 'buffer', bookType: 'xls' }) as Buffer;
  };

  it('parses a real binary .xls workbook', async () => {
    const result = await parseFileStream(Readable.from(makeXls()), 'application/vnd.ms-excel', {
      filename: 'legacy.xls',
    });
    expect(result.headers).toEqual(['Name', 'Email', 'Company']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ Name: 'Eve', Email: 'eve@example.com', Company: 'Eve Co' });
  });

  it('parses a binary .xls even when named .xlsx', async () => {
    const result = await parseFileStream(Readable.from(makeXls()), XLSX_MIME, {
      filename: 'mislabeled.xlsx',
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toMatchObject({ Name: 'Frank', Email: 'frank@example.com' });
  });

  it('routes an .xls-named text file to the delimited parser', async () => {
    const csv = 'Name,Email\nGina,gina@example.com\n';
    const result = await parseFileStream(streamOf(csv), 'application/vnd.ms-excel', {
      filename: 'export.xls',
    });
    expect(result.rows[0]).toMatchObject({ Name: 'Gina', Email: 'gina@example.com' });
  });
});

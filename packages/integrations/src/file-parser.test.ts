import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
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

  it('raises a FileParseError (not a crash) for a binary non-zip posing as .xlsx', async () => {
    const oleMagic = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x01, 0x02, 0x03]);
    await expect(
      parseFileStream(Readable.from(oleMagic), XLSX_MIME, { filename: 'old.xlsx' }),
    ).rejects.toBeInstanceOf(FileParseError);
  });
});

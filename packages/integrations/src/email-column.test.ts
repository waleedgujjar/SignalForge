import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import * as SheetJS from 'xlsx';
import { parseFileStream } from './file-parser.js';
import { detectColumnMappings } from './column-detector.js';
import { detectEmailColumns, extractEmailsFromRows, normalizeEmailHeader, parseEmailCell } from './email-column.js';

const MAPS = 'https://www.google.com/maps/place/blackbelt+company+-+hvac+services+in+san+antonio+tx/@29.66927,-98.4,17z';

async function parseXlsx(rows: (string | null)[][]) {
  const wb = SheetJS.utils.book_new();
  SheetJS.utils.book_append_sheet(wb, SheetJS.utils.aoa_to_sheet(rows), 'Sheet1');
  const buf = SheetJS.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return parseFileStream(Readable.from(buf), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', {
    filename: 'leads.xlsx',
  });
}

async function parseCsv(text: string) {
  return parseFileStream(Readable.from(Buffer.from(text, 'utf8')), 'text/csv', { filename: 'leads.csv' });
}

describe('parseEmailCell', () => {
  it.each([
    ['waleed@example.com', 'waleed@example.com'],
    ['  Contact@Company.com  ', 'contact@company.com'],
    ['mailto:info@acme.io', 'info@acme.io'],
    ['Jane Doe <jane@acme.io>', 'jane@acme.io'],
    ['sales@acme.io; ops@acme.io', 'sales@acme.io'],
  ])('accepts %s', (cell, email) => {
    expect(parseEmailCell(cell)).toEqual({ status: 'valid', email });
  });

  it.each([
    MAPS,
    'https://google.com/maps/place/company',
    'https://company.com',
    'www.company.com',
    'company.com',
    'invalid-email',
    'user@localhost',
    'name@company',
    'tx/@29.66927',
  ])('rejects %s', (cell) => {
    expect(parseEmailCell(cell).status).toBe('invalid');
  });

  it('treats blank cells as empty', () => {
    expect(parseEmailCell('   ')).toEqual({ status: 'empty' });
    expect(parseEmailCell(undefined)).toEqual({ status: 'empty' });
  });
});

describe('header normalization', () => {
  it.each(['Gmail', 'gmail', 'GMAIL', ' G-Mail ', 'Email Address', 'email_address', 'EmailAddress', 'E-mail', 'Business Email', 'Email ID'])(
    'recognizes "%s"',
    (header) => {
      const { candidates } = detectEmailColumns([header], [{ [header]: 'a@acme.io' }]);
      expect(candidates[0]?.header).toBe(header);
      expect(candidates[0]?.reason).toBe('header');
    },
  );

  it('normalizes spelling variants to one key', () => {
    expect(normalizeEmailHeader('E-mail_Address')).toBe('email address');
    expect(normalizeEmailHeader('  GMAIL ')).toBe('gmail');
  });
});

describe('Test A: Gmail column next to Website and Google Maps', () => {
  it('extracts from Gmail and never from the URL columns (xlsx)', async () => {
    const parsed = await parseXlsx([
      ['Company', 'Website', 'Google Maps', 'Gmail'],
      ['Company A', 'https://company-a.com', MAPS, 'contact@company-a.com'],
      ['Company B', 'https://company-b.com', 'https://google.com/maps/place/b/@1.2,3.4', 'info@company-b.com'],
    ]);
    const detection = detectEmailColumns(parsed.headers, parsed.rows);
    expect(detection.selected).toBe('Gmail');
    expect(detection.ambiguous).toBe(false);
    // URL columns are not even candidates.
    expect(detection.candidates.map((c) => c.header)).toEqual(['Gmail']);
    const extraction = extractEmailsFromRows(parsed.rows, 'Gmail');
    expect(extraction.emails).toEqual(['contact@company-a.com', 'info@company-b.com']);
  });

  it('the lead importer maps Gmail to email too', () => {
    const mappings = detectColumnMappings(['Company', 'Website', 'Google Maps', 'Gmail']);
    expect(mappings.find((m) => m.leadField === 'email')?.csvColumn).toBe('Gmail');
  });
});

describe('Test B: standard Email column', () => {
  it('extracts the Email column', async () => {
    const parsed = await parseCsv('Company,Email,Website\nCompany A,contact@company-a.com,https://company-a.com\n');
    const detection = detectEmailColumns(parsed.headers, parsed.rows);
    expect(detection.selected).toBe('Email');
    expect(extractEmailsFromRows(parsed.rows, 'Email').emails).toEqual(['contact@company-a.com']);
  });
});

describe('Test C: several email columns', () => {
  it('follows the priority (Business Email before Gmail) and lists both', async () => {
    const parsed = await parseCsv('Company,Gmail,Business Email\nCompany A,personal@example.com,business@example.com\n');
    const detection = detectEmailColumns(parsed.headers, parsed.rows);
    expect(detection.selected).toBe('Business Email');
    expect(detection.candidates.map((c) => c.header)).toEqual(['Business Email', 'Gmail']);
    expect(detection.ambiguous).toBe(false);
  });

  it('flags equally strong columns as ambiguous instead of choosing silently', async () => {
    const parsed = await parseCsv('Owner Email,Manager Email\na@x.com,b@x.com\n');
    const detection = detectEmailColumns(parsed.headers, parsed.rows);
    expect(detection.ambiguous).toBe(true);
    expect(detection.candidates).toHaveLength(2);
  });

  it('fills an empty cell from the next email column', async () => {
    const parsed = await parseCsv('Email,Gmail\n,backup@example.com\nmain@example.com,other@example.com\n');
    const extraction = extractEmailsFromRows(parsed.rows, 'Email', ['Gmail']);
    expect(extraction.emails).toEqual(['backup@example.com', 'main@example.com']);
    expect(extraction.fallbackRows).toBe(1);
  });
});

describe('Test D: invalid data', () => {
  it('rejects the URL, skips the empty value and the invalid email', async () => {
    const parsed = await parseCsv(
      `Company,Gmail,Website\nCompany A,${MAPS.replace(/,/g, '%2C')},https://company-a.com\nCompany B,,https://company-b.com\nCompany C,invalid-email,https://company-c.com\nCompany D,ok@company-d.com,https://company-d.com\n`,
    );
    const extraction = extractEmailsFromRows(parsed.rows, 'Gmail');
    expect(extraction.emails).toEqual(['ok@company-d.com']);
    expect(extraction).toMatchObject({ validRows: 1, invalidRows: 2, emptyRows: 1 });
    expect(extraction.invalidSamples[0]).toContain('google.com/maps');
  });

  it('finds no email column when a file has only URLs and names', async () => {
    const parsed = await parseCsv(`Company,Google Maps,Website\nA,${MAPS.replace(/,/g, '%2C')},https://a.com\n`);
    expect(detectEmailColumns(parsed.headers, parsed.rows)).toMatchObject({ selected: null, candidates: [] });
  });
});

describe('content-based detection', () => {
  it('uses an unlabeled column only when most of its values are real emails', async () => {
    const parsed = await parseCsv('Name,Col B,Maps\nA,a@x.com,https://maps.google.com/?q=a@1,2\nB,b@x.com,https://maps.google.com/?q=b@3,4\n');
    const detection = detectEmailColumns(parsed.headers, parsed.rows);
    expect(detection.selected).toBe('Col B');
    expect(detection.candidates.map((c) => c.reason)).toEqual(['content']);
  });

  it('does not treat a "Contact" column of names or phones as email', async () => {
    const parsed = await parseCsv('Contact,Email\nJohn Smith,john@x.com\n555-1234,jane@x.com\n');
    expect(detectEmailColumns(parsed.headers, parsed.rows).candidates.map((c) => c.header)).toEqual(['Email']);
  });
});

describe('volume and duplicates', () => {
  it('handles a large file with duplicates and gaps', () => {
    const rows = Array.from({ length: 50_000 }, (_, i) => ({
      Gmail: i % 10 === 0 ? '' : `user${i % 20_000}@example.com`,
      Maps: `https://www.google.com/maps/place/x/@${i},1`,
    }));
    const detection = detectEmailColumns(['Maps', 'Gmail'], rows);
    expect(detection.selected).toBe('Gmail');
    const extraction = extractEmailsFromRows(rows, 'Gmail');
    expect(extraction.emptyRows).toBe(5_000);
    expect(extraction.validRows).toBe(45_000);
    expect(extraction.emails.length + extraction.duplicateEmails).toBe(45_000);
    expect(extraction.emails.every((e) => /^user\d+@example\.com$/.test(e))).toBe(true);
  });
});

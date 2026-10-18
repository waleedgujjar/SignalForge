import { describe, expect, it } from 'vitest';
import type ExcelJS from 'exceljs';

import { extractCellText } from './cell-extractor.js';

function makeCell(value: unknown, text?: string): ExcelJS.Cell {
  return { value, text } as ExcelJS.Cell;
}

describe('extractCellText', () => {
  it('returns plain strings', () => {
    expect(extractCellText(makeCell('hello@example.com'))).toBe('hello@example.com');
  });

  it('returns numbers as strings', () => {
    expect(extractCellText(makeCell(7135551234))).toBe('7135551234');
  });

  it('extracts hyperlink text', () => {
    expect(extractCellText(makeCell({
      text: 'john@example.com',
      hyperlink: 'mailto:john@example.com',
    }))).toBe('john@example.com');
  });

  it('extracts hyperlink URL when text is missing', () => {
    expect(extractCellText(makeCell({
      hyperlink: 'https://example.com',
    }))).toBe('https://example.com');
  });

  it('combines rich text parts', () => {
    expect(extractCellText(makeCell({
      richText: [{ text: 'John ' }, { text: 'Smith' }],
    }))).toBe('John Smith');
  });

  it('uses formula result', () => {
    expect(extractCellText(makeCell({
      formula: 'A1&"@example.com"',
      result: 'john@example.com',
    }))).toBe('john@example.com');
  });

  it('strips formula injection prefix', () => {
    expect(extractCellText(makeCell('=CMD("calc")'))).toBe('CMD("calc")');
    expect(extractCellText(makeCell('+1234567890'))).toBe('1234567890');
  });

  it('returns empty string for null values', () => {
    expect(extractCellText(makeCell(null))).toBe('');
  });

  it('returns booleans as strings', () => {
    expect(extractCellText(makeCell(true))).toBe('true');
    expect(extractCellText(makeCell(false))).toBe('false');
  });

  it('returns dates as ISO strings', () => {
    const date = new Date('2024-01-15');
    expect(extractCellText(makeCell(date, '1/15/2024'))).toBe('2024-01-15T00:00:00.000Z');
  });

  it('falls back to cell.text when value is null', () => {
    expect(extractCellText(makeCell(null, '42'))).toBe('42');
  });
});

import { describe, expect, it } from 'vitest';
import { resolveImportMimeType } from './mime.js';

describe('resolveImportMimeType', () => {
  it('resolves .csv extension to text/csv regardless of mime type', () => {
    expect(resolveImportMimeType('application/vnd.ms-excel', 'data.csv')).toBe('text/csv');
    expect(resolveImportMimeType('', 'data.csv')).toBe('text/csv');
    expect(resolveImportMimeType(undefined, 'data.csv')).toBe('text/csv');
  });

  it('resolves .xlsx to openxmlformats sheet type', () => {
    const expected = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    expect(resolveImportMimeType('', 'report.xlsx')).toBe(expected);
    expect(resolveImportMimeType(undefined, 'report.xlsx')).toBe(expected);
  });

  it('resolves .xls to openxmlformats sheet type', () => {
    const expected = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    expect(resolveImportMimeType('application/vnd.ms-excel', 'old.xls')).toBe(expected);
  });

  it('resolves text/csv mime type', () => {
    expect(resolveImportMimeType('text/csv')).toBe('text/csv');
  });

  it('resolves application/csv mime type', () => {
    expect(resolveImportMimeType('application/csv')).toBe('text/csv');
  });

  it('resolves text/plain to text/csv', () => {
    expect(resolveImportMimeType('text/plain')).toBe('text/csv');
  });

  it('resolves application/vnd.ms-excel to text/csv when no xlsx extension', () => {
    expect(resolveImportMimeType('application/vnd.ms-excel')).toBe('text/csv');
  });

  it('passes through openxmlformats sheet type', () => {
    const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    expect(resolveImportMimeType(type)).toBe(type);
  });

  it('passes through google sheets type', () => {
    const type = 'application/vnd.google-apps.spreadsheet';
    expect(resolveImportMimeType(type)).toBe(type);
  });

  it('defaults to text/csv for unknown or empty mime type', () => {
    expect(resolveImportMimeType('')).toBe('text/csv');
    expect(resolveImportMimeType(undefined)).toBe('text/csv');
  });

  it('returns unknown mime type unchanged', () => {
    expect(resolveImportMimeType('application/json')).toBe('application/json');
  });

  it('is case-insensitive for extension matching', () => {
    const expected = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    expect(resolveImportMimeType('', 'DATA.XLSX')).toBe(expected);
    expect(resolveImportMimeType('', 'file.CSV')).toBe('text/csv');
  });
});

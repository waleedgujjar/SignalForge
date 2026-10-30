import { describe, expect, it } from 'vitest';

import { sanitizeEnv } from './api';

/**
 * Guards against the exact production bug that caused Smart Import to 404 and
 * Large Lead Data to time out: Vercel's env-var CLI persisted a UTF-8 BOM
 * (U+FEFF) at the start of NEXT_PUBLIC_API_ORIGIN after it was piped in from
 * PowerShell stdin, which made `${API_ORIGIN}${path}` fail URL parsing and
 * get resolved against the Vercel domain instead of the API origin.
 */
describe('sanitizeEnv', () => {
  it('returns an empty string for undefined', () => {
    expect(sanitizeEnv(undefined)).toBe('');
  });

  it('passes a clean value through unchanged', () => {
    expect(sanitizeEnv('https://api.example.com')).toBe('https://api.example.com');
  });

  it('strips a leading UTF-8 BOM (the bug that was in production)', () => {
    expect(sanitizeEnv('﻿https://api.example.com')).toBe('https://api.example.com');
  });

  it('strips BOM and whitespace at both ends', () => {
    expect(sanitizeEnv('  ﻿https://api.example.com/  \n')).toBe('https://api.example.com/');
  });

  it('leaves inner whitespace alone (would never be a valid URL anyway)', () => {
    expect(sanitizeEnv('https://api example.com')).toBe('https://api example.com');
  });

  it('handles empty string', () => {
    expect(sanitizeEnv('')).toBe('');
  });
});

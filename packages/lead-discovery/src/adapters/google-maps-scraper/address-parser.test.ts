import { describe, it, expect } from 'vitest';
import { parseAddress } from './address-parser.js';

describe('parseAddress', () => {
  it('parses a full US address', () => {
    const result = parseAddress('123 Main St, Austin, TX 78701, United States');
    expect(result.city).toBe('Austin');
    expect(result.state).toBe('TX');
    expect(result.postalCode).toBe('78701');
    expect(result.country).toBe('United States');
  });

  it('parses address without street number', () => {
    const result = parseAddress('Austin, TX 78701, United States');
    expect(result.city).toBe('Austin');
    expect(result.state).toBe('TX');
    expect(result.postalCode).toBe('78701');
    expect(result.country).toBe('United States');
  });

  it('parses city + state only', () => {
    const result = parseAddress('Austin, TX');
    expect(result.city).toBe('Austin');
    expect(result.state).toBe('TX');
    expect(result.country).toBeNull();
  });

  it('parses city + country', () => {
    const result = parseAddress('Toronto, Canada');
    expect(result.city).toBe('Toronto');
    expect(result.country).toBe('Canada');
  });

  it('handles address with ZIP+4 format', () => {
    const result = parseAddress('456 Oak Ave, Portland, OR 97201-1234, United States');
    expect(result.postalCode).toBe('97201-1234');
    expect(result.city).toBe('Portland');
  });

  it('returns all nulls for empty input', () => {
    expect(parseAddress(null)).toEqual({ city: null, state: null, country: null, postalCode: null });
    expect(parseAddress(undefined)).toEqual({ city: null, state: null, country: null, postalCode: null });
    expect(parseAddress('')).toEqual({ city: null, state: null, country: null, postalCode: null });
  });

  it('handles single-segment input', () => {
    const result = parseAddress('Austin');
    expect(result.city).toBe('Austin');
    expect(result.state).toBeNull();
    expect(result.country).toBeNull();
  });

  it('recognizes a standalone country', () => {
    const result = parseAddress('United States');
    expect(result.country).toBe('United States');
    expect(result.city).toBeNull();
  });

  it('handles international address', () => {
    const result = parseAddress('10 Downing St, London, SW1A 2AA, United Kingdom');
    expect(result.city).toBe('London');
    expect(result.country).toBe('United Kingdom');
  });
});

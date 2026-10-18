import { describe, expect, it } from 'vitest';
import { parseSpintax, validateSpintax } from './spintax-parser.js';

describe('SpintaxParser', () => {
  it('parses simple spintax deterministically', () => {
    const result = parseSpintax('{Hi|Hello|Hey} there', {
      deterministic: true,
      seed: 0,
    });
    expect(result.valid).toBe(true);
    expect(['Hi there', 'Hello there', 'Hey there']).toContain(result.text);
  });

  it('detects malformed spintax', () => {
    const result = validateSpintax('{Hi|Hello');
    expect(result.valid).toBe(false);
  });

  it('handles nested spintax', () => {
    const result = parseSpintax('{Hi {there|friend}|Hello}', { deterministic: true, seed: 1 });
    expect(result.valid).toBe(true);
    expect(result.text.length).toBeGreaterThan(0);
  });
});

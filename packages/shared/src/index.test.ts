import { describe, expect, it } from 'vitest';
import { ok, err } from './index.js';

describe('Result helpers', () => {
  it('creates ok results', () => {
    const result = ok('value');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('value');
    }
  });

  it('creates err results', () => {
    const result = err(new Error('failed'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('failed');
    }
  });
});

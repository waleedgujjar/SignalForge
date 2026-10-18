import { describe, expect, it } from 'vitest';
import { delayToDays, syncDelayDays } from './delays.js';

describe('Sequence delay helpers', () => {
  it('converts minutes to fractional days', () => {
    expect(delayToDays(1440, 'MINUTES')).toBe(1);
  });

  it('converts hours to fractional days', () => {
    expect(delayToDays(24, 'HOURS')).toBe(1);
  });

  it('syncs delay days for worker compatibility', () => {
    expect(syncDelayDays(12, 'HOURS')).toBe(1);
    expect(syncDelayDays(0, 'DAYS')).toBe(0);
  });
});

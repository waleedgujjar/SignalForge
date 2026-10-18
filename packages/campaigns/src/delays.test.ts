import { describe, expect, it } from 'vitest';
import { delayToDays, syncDelayDays } from './delays.js';

describe('delayToDays', () => {
  it('converts minutes to days', () => {
    expect(delayToDays(1440, 'MINUTES')).toBe(1);
    expect(delayToDays(720, 'MINUTES')).toBe(0.5);
    expect(delayToDays(0, 'MINUTES')).toBe(0);
  });

  it('converts hours to days', () => {
    expect(delayToDays(24, 'HOURS')).toBe(1);
    expect(delayToDays(48, 'HOURS')).toBe(2);
    expect(delayToDays(12, 'HOURS')).toBe(0.5);
    expect(delayToDays(0, 'HOURS')).toBe(0);
  });

  it('passes through days unchanged', () => {
    expect(delayToDays(1, 'DAYS')).toBe(1);
    expect(delayToDays(7, 'DAYS')).toBe(7);
    expect(delayToDays(0, 'DAYS')).toBe(0);
  });
});

describe('syncDelayDays', () => {
  it('rounds fractional days to nearest integer', () => {
    expect(syncDelayDays(12, 'HOURS')).toBe(1);
    expect(syncDelayDays(36, 'HOURS')).toBe(2);
  });

  it('clamps negative to zero', () => {
    expect(syncDelayDays(-5, 'DAYS')).toBe(0);
    expect(syncDelayDays(-100, 'MINUTES')).toBe(0);
  });

  it('returns zero for zero delay', () => {
    expect(syncDelayDays(0, 'DAYS')).toBe(0);
    expect(syncDelayDays(0, 'HOURS')).toBe(0);
    expect(syncDelayDays(0, 'MINUTES')).toBe(0);
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('@signalforge/campaigns', () => ({
  delayToDays: (amount: number, unit: string) => {
    switch (unit) {
      case 'MINUTES': return amount / (24 * 60);
      case 'HOURS': return amount / 24;
      case 'DAYS': return amount;
      default: return amount;
    }
  },
}));

import { calculateResumeAt } from './delay.js';

describe('calculateResumeAt', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  describe('without business hours', () => {
    it('adds minutes correctly', () => {
      const result = calculateResumeAt(now, 30, 'MINUTES');
      expect(result.getTime()).toBe(now.getTime() + 30 * 60 * 1000);
    });

    it('adds hours correctly', () => {
      const result = calculateResumeAt(now, 5, 'HOURS');
      expect(result.getTime()).toBe(now.getTime() + 5 * 60 * 60 * 1000);
    });

    it('adds days correctly', () => {
      const result = calculateResumeAt(now, 3, 'DAYS');
      expect(result.getTime()).toBe(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    });

    it('handles zero amount', () => {
      const result = calculateResumeAt(now, 0, 'HOURS');
      expect(result.getTime()).toBe(now.getTime());
    });

    it('defaults to DAYS for unknown unit', () => {
      const result = calculateResumeAt(now, 2, 'UNKNOWN_UNIT' as 'DAYS');
      expect(result.getTime()).toBe(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    });
  });

  describe('with business hours', () => {
    it('uses delayToDays conversion', () => {
      const result = calculateResumeAt(now, 2, 'DAYS', true);
      expect(result.getTime()).toBe(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    });

    it('converts hours via delayToDays', () => {
      const result = calculateResumeAt(now, 24, 'HOURS', true);
      // 24 hours = 1 day via mock delayToDays
      expect(result.getTime()).toBe(now.getTime() + 1 * 24 * 60 * 60 * 1000);
    });

    it('converts minutes via delayToDays', () => {
      const result = calculateResumeAt(now, 1440, 'MINUTES', true);
      // 1440 minutes = 1 day via mock delayToDays
      expect(result.getTime()).toBe(now.getTime() + 1 * 24 * 60 * 60 * 1000);
    });
  });
});

import { describe, expect, it } from 'vitest';

import {
  SOURCE_LABELS,
  sourceLabel,
  formatDuration,
  SIGNAL_STATUS_ICON,
} from './discovery-display';

describe('sourceLabel', () => {
  it('maps known source codes to friendly labels', () => {
    expect(sourceLabel('CSV')).toBe('CSV Import');
    expect(sourceLabel('XLSX')).toBe('XLSX Import');
    expect(sourceLabel('GOOGLE_MAPS_SCRAPER')).toBe('Google Maps');
    expect(sourceLabel('MOCK')).toBe('Test Data');
    expect(sourceLabel('MANUAL')).toBe('Manual');
    expect(sourceLabel('YELP')).toBe('Yelp');
    expect(sourceLabel('CLUTCH')).toBe('Clutch');
    expect(sourceLabel('YELLOW_PAGES')).toBe('Yellow Pages');
  });

  it('passes unknown source codes through unchanged', () => {
    expect(sourceLabel('SOME_FUTURE_SOURCE')).toBe('SOME_FUTURE_SOURCE');
    expect(sourceLabel('')).toBe('');
  });

  it('has a label for every entry in SOURCE_LABELS', () => {
    for (const [code, label] of Object.entries(SOURCE_LABELS)) {
      expect(sourceLabel(code)).toBe(label);
    }
  });
});

describe('formatDuration', () => {
  const base = '2026-01-01T12:00:00.000Z';

  it('formats sub-second durations', () => {
    expect(formatDuration(base, '2026-01-01T12:00:00.500Z')).toBe('<1s');
    expect(formatDuration(base, '2026-01-01T12:00:00.999Z')).toBe('<1s');
  });

  it('formats seconds only', () => {
    expect(formatDuration(base, '2026-01-01T12:00:05.000Z')).toBe('5s');
    expect(formatDuration(base, '2026-01-01T12:00:59.000Z')).toBe('59s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(base, '2026-01-01T12:01:30.000Z')).toBe('1m 30s');
    expect(formatDuration(base, '2026-01-01T12:05:00.000Z')).toBe('5m');
    expect(formatDuration(base, '2026-01-01T12:59:59.000Z')).toBe('59m 59s');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(base, '2026-01-01T13:00:00.000Z')).toBe('1h');
    expect(formatDuration(base, '2026-01-01T13:30:00.000Z')).toBe('1h 30m');
    expect(formatDuration(base, '2026-01-01T14:15:45.000Z')).toBe('2h 15m');
  });

  it('formats exactly one minute', () => {
    expect(formatDuration(base, '2026-01-01T12:01:00.000Z')).toBe('1m');
  });

  it('handles zero duration', () => {
    expect(formatDuration(base, base)).toBe('<1s');
  });
});

describe('SIGNAL_STATUS_ICON', () => {
  it('provides icons for all three statuses', () => {
    expect(SIGNAL_STATUS_ICON.passed).toBe('✓');
    expect(SIGNAL_STATUS_ICON.failed).toBe('✗');
    expect(SIGNAL_STATUS_ICON.unknown).toBe('?');
  });

  it('has exactly three entries', () => {
    expect(Object.keys(SIGNAL_STATUS_ICON)).toHaveLength(3);
  });
});

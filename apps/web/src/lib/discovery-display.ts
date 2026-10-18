export const SOURCE_LABELS: Record<string, string> = {
  CSV: 'CSV Import',
  XLSX: 'XLSX Import',
  GOOGLE_MAPS_SCRAPER: 'Google Maps',
  MOCK: 'Test Data',
  MANUAL: 'Manual',
  YELP: 'Yelp',
  CLUTCH: 'Clutch',
  YELLOW_PAGES: 'Yellow Pages',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return '<1s';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

export const SIGNAL_STATUS_ICON: Record<string, string> = {
  passed: '✓',
  failed: '✗',
  unknown: '?',
};

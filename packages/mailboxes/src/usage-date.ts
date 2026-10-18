const DEFAULT_TIMEZONE = 'UTC';

export function computeUsageDate(now: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(now);
  } catch {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(now);
  }
}

export function toUsageDate(dateString: string): Date {
  return new Date(`${dateString}T00:00:00Z`);
}

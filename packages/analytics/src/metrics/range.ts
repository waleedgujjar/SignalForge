import type { AnalyticsPeriod, AnalyticsRange } from '../types.js';

/// Longest window a single request may scan. Wider ranges are rejected rather
/// than silently truncated so a user never reads a partial period as complete.
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 86_400_000;

export class AnalyticsRangeError extends Error {}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function endOfUtcDay(date: Date): Date {
  return new Date(startOfUtcDay(date).getTime() + DAY_MS - 1);
}

export interface ResolveRangeInput {
  period?: AnalyticsPeriod;
  startDate?: string | Date;
  endDate?: string | Date;
  now?: Date;
}

/**
 * Turns a preset or explicit custom window into UTC day boundaries.
 *
 * Everything downstream (snapshots, charts, exports) is bucketed by UTC day, so
 * ranges always snap to whole days. Rolling presets end at "now" rather than
 * end-of-day, otherwise today's chart would show a trailing empty stretch.
 */
export function resolveAnalyticsRange(input: ResolveRangeInput = {}): AnalyticsRange {
  const now = input.now ?? new Date();
  const period = input.period ?? '7d';

  if (period === 'custom') {
    return resolveCustomRange(input.startDate, input.endDate, now);
  }

  const todayStart = startOfUtcDay(now);
  switch (period) {
    case 'today':
      return withDays({ from: todayStart, to: now, period });
    case 'yesterday': {
      const from = new Date(todayStart.getTime() - DAY_MS);
      return withDays({ from, to: endOfUtcDay(from), period });
    }
    case '30d':
      return withDays({ from: new Date(todayStart.getTime() - 29 * DAY_MS), to: now, period });
    case '90d':
      return withDays({ from: new Date(todayStart.getTime() - 89 * DAY_MS), to: now, period });
    case '7d':
    default:
      return withDays({ from: new Date(todayStart.getTime() - 6 * DAY_MS), to: now, period: '7d' });
  }
}

function resolveCustomRange(
  startDate: string | Date | undefined,
  endDate: string | Date | undefined,
  now: Date,
): AnalyticsRange {
  if (!startDate || !endDate) {
    throw new AnalyticsRangeError('Custom ranges require both startDate and endDate.');
  }

  const from = startOfUtcDay(toDate(startDate, 'startDate'));
  const rawTo = endOfUtcDay(toDate(endDate, 'endDate'));

  if (from.getTime() > rawTo.getTime()) {
    throw new AnalyticsRangeError('startDate must be on or before endDate.');
  }

  const days = Math.round((rawTo.getTime() + 1 - from.getTime()) / DAY_MS);
  if (days > MAX_RANGE_DAYS) {
    throw new AnalyticsRangeError(`Date range cannot exceed ${MAX_RANGE_DAYS} days.`);
  }

  // Never report future data as measured; clamp an end date past now.
  const to = rawTo.getTime() > now.getTime() ? now : rawTo;
  return { from, to, period: 'custom', days };
}

function toDate(value: string | Date, field: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AnalyticsRangeError(`${field} is not a valid date.`);
  }
  return date;
}

function withDays(range: Omit<AnalyticsRange, 'days'>): AnalyticsRange {
  const days = Math.max(
    1,
    Math.round((endOfUtcDay(range.to).getTime() + 1 - startOfUtcDay(range.from).getTime()) / DAY_MS),
  );
  return { ...range, days };
}

/// The equally sized window immediately before `range`, used for KPI deltas.
export function previousRange(range: AnalyticsRange): { from: Date; to: Date } {
  const span = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - span - 1),
    to: new Date(range.from.getTime() - 1),
  };
}

/// Inclusive list of UTC day boundaries covered by the range, for chart buckets.
export function eachUtcDay(range: { from: Date; to: Date }): Date[] {
  const days: Date[] = [];
  let cursor = startOfUtcDay(range.from);
  const last = startOfUtcDay(range.to);
  while (cursor.getTime() <= last.getTime()) {
    days.push(cursor);
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return days;
}

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

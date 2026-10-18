import { DateTime } from 'luxon';
import type { WarmupScheduleConfig } from './types.js';

const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_START = '09:00';
const DEFAULT_END = '17:00';

interface ParsedTime {
  hour: number;
  minute: number;
}

function parseTime(value: string | undefined, fallback: string): ParsedTime {
  const source = value ?? fallback;
  const match = /^(\d{2}):(\d{2})$/.exec(source);
  if (!match) return parseTime(fallback, fallback);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function toLocal(now: Date, timezone: string): DateTime {
  const dt = DateTime.fromJSDate(now, { zone: timezone });
  return dt.isValid ? dt : DateTime.fromJSDate(now, { zone: DEFAULT_TIMEZONE });
}

function luxonWeekdayToJs(weekday: number): number {
  return weekday % 7;
}

function isWithinWindow(dt: DateTime, start: ParsedTime, end: ParsedTime): boolean {
  const startMin = start.hour * 60 + start.minute;
  const endMin = end.hour * 60 + end.minute;
  const nowMin = dt.hour * 60 + dt.minute;
  if (startMin <= endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;
}

export function isWithinWarmupWindow(
  now: Date,
  config: WarmupScheduleConfig,
): boolean {
  const local = toLocal(now, config.timezone || DEFAULT_TIMEZONE);
  const day = luxonWeekdayToJs(local.weekday);
  if (!config.weekdays.includes(day)) return false;
  return isWithinWindow(
    local,
    parseTime(config.windowStart, DEFAULT_START),
    parseTime(config.windowEnd, DEFAULT_END),
  );
}

export function computeUsageDate(now: Date, timezone: string): string {
  const dt = DateTime.fromJSDate(now, { zone: timezone || DEFAULT_TIMEZONE });
  const valid = dt.isValid ? dt : DateTime.fromJSDate(now, { zone: DEFAULT_TIMEZONE });
  return valid.toFormat('yyyy-LL-dd');
}

export function toUsageDate(dateString: string): Date {
  return new Date(`${dateString}T00:00:00.000Z`);
}

/**
 * Distribute N warmup send slots evenly across the sending window on the
 * given local date. Returns an array of UTC Date objects. If the window is
 * closed on that weekday, returns an empty array (caller must pick the next
 * eligible day).
 */
export function distributeSlots(
  count: number,
  localDate: DateTime,
  config: WarmupScheduleConfig,
): Date[] {
  if (count <= 0) return [];
  const day = luxonWeekdayToJs(localDate.weekday);
  if (!config.weekdays.includes(day)) return [];

  const start = parseTime(config.windowStart, DEFAULT_START);
  const end = parseTime(config.windowEnd, DEFAULT_END);
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  if (endMinutes <= startMinutes) return [];

  const windowMinutes = endMinutes - startMinutes;
  const spacing = count === 1 ? windowMinutes / 2 : windowMinutes / (count + 1);
  const slots: Date[] = [];
  for (let i = 0; i < count; i += 1) {
    const offset = spacing * (i + 1);
    const slotLocal = localDate.set({
      hour: start.hour,
      minute: start.minute,
      second: 0,
      millisecond: 0,
    }).plus({ minutes: offset });
    slots.push(slotLocal.toUTC().toJSDate());
  }
  return slots;
}

/**
 * Convenience wrapper that returns the local DateTime for a given usageDate
 * and timezone (start-of-day in the given zone).
 */
export function usageDateStart(usageDate: string, timezone: string): DateTime {
  return DateTime.fromISO(usageDate, { zone: timezone || DEFAULT_TIMEZONE }).startOf('day');
}

import { DateTime } from 'luxon';
import type { NextSendResult, SendingScheduleConfig } from './types.js';

const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_DAYS = [1, 2, 3, 4, 5];
const DEFAULT_START = '09:00';
const DEFAULT_END = '17:00';
const DEFAULT_MIN_DELAY = 2;
const DEFAULT_MAX_DELAY = 5;
const MAX_LOOKAHEAD_DAYS = 14;

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

function normalizedConfig(config: SendingScheduleConfig | null | undefined): Required<SendingScheduleConfig> {
  const c = config ?? {};
  const start = parseTime(c.startTime, DEFAULT_START);
  const end = parseTime(c.endTime, DEFAULT_END);
  const startTime = `${String(start.hour).padStart(2, '0')}:${String(start.minute).padStart(2, '0')}`;
  const endTime = `${String(end.hour).padStart(2, '0')}:${String(end.minute).padStart(2, '0')}`;
  return {
    timezone: c.timezone && c.timezone.trim() !== '' ? c.timezone : DEFAULT_TIMEZONE,
    days: c.days && c.days.length > 0 ? [...new Set(c.days)] : DEFAULT_DAYS,
    startTime,
    endTime,
    minDelayMinutes: c.minDelayMinutes ?? DEFAULT_MIN_DELAY,
    maxDelayMinutes: c.maxDelayMinutes ?? DEFAULT_MAX_DELAY,
  };
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

  if (startMin <= endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  return nowMin >= startMin || nowMin < endMin;
}

export function isWithinSendingWindow(
  now: Date,
  config: SendingScheduleConfig | null | undefined,
): boolean {
  const cfg = normalizedConfig(config);
  const local = toLocal(now, cfg.timezone);
  const day = luxonWeekdayToJs(local.weekday);
  if (!cfg.days.includes(day)) return false;
  return isWithinWindow(local, parseTime(cfg.startTime, DEFAULT_START), parseTime(cfg.endTime, DEFAULT_END));
}

function nextWindowStart(
  from: DateTime,
  cfg: Required<SendingScheduleConfig>,
): DateTime {
  const start = parseTime(cfg.startTime, DEFAULT_START);
  const end = parseTime(cfg.endTime, DEFAULT_END);

  for (let offset = 0; offset < MAX_LOOKAHEAD_DAYS; offset += 1) {
    const candidateDay = from.plus({ days: offset });
    const day = luxonWeekdayToJs(candidateDay.weekday);
    if (!cfg.days.includes(day)) continue;

    const windowStart = candidateDay.set({ hour: start.hour, minute: start.minute, second: 0, millisecond: 0 });
    const windowEnd = candidateDay.set({ hour: end.hour, minute: end.minute, second: 0, millisecond: 0 });

    if (offset === 0 && from >= windowStart && from < windowEnd) {
      return from;
    }
    if (from < windowStart) {
      return windowStart;
    }
  }
  return from;
}

function isWithinSendingWindowLocal(
  dt: DateTime,
  cfg: Required<SendingScheduleConfig>,
): boolean {
  const day = luxonWeekdayToJs(dt.weekday);
  if (!cfg.days.includes(day)) return false;
  return isWithinWindow(dt, parseTime(cfg.startTime, DEFAULT_START), parseTime(cfg.endTime, DEFAULT_END));
}

function randomDelayMinutes(cfg: Required<SendingScheduleConfig>, rng: () => number): number {
  const min = Math.max(0, cfg.minDelayMinutes);
  const max = Math.max(min, cfg.maxDelayMinutes);
  if (max === min) return min;
  const span = max - min;
  return min + rng() * span;
}

export interface CalculateSendTimeInput {
  now: Date;
  baseDelayDays?: number;
  extraDelayMinutes?: number;
  config?: SendingScheduleConfig | null;
  rng?: () => number;
}

export function calculateNextSendTime(input: CalculateSendTimeInput): NextSendResult {
  const cfg = normalizedConfig(input.config);
  const rng = input.rng ?? Math.random;
  const startLocal = toLocal(input.now, cfg.timezone);

  const baseDelayMs = (input.baseDelayDays ?? 0) * 24 * 60 * 60 * 1000;
  const extraMinutes = input.extraDelayMinutes ?? randomDelayMinutes(cfg, rng);
  const requested = startLocal
    .plus({ milliseconds: baseDelayMs })
    .plus({ minutes: extraMinutes });

  if (isWithinSendingWindowLocal(requested, cfg)) {
    return {
      scheduledAt: requested.toUTC().toJSDate(),
      withinWindow: true,
    };
  }

  const next = nextWindowStart(requested, cfg);
  const delayed = next.plus({ minutes: randomDelayMinutes(cfg, rng) });
  return {
    scheduledAt: delayed.toUTC().toJSDate(),
    withinWindow: false,
    reason: 'OUTSIDE_WINDOW',
  };
}

export function calculateNextValidSlot(
  now: Date,
  config: SendingScheduleConfig | null | undefined,
): Date {
  const cfg = normalizedConfig(config);
  const local = toLocal(now, cfg.timezone);
  if (isWithinSendingWindowLocal(local, cfg)) {
    return local.toUTC().toJSDate();
  }
  return nextWindowStart(local, cfg).toUTC().toJSDate();
}

export function computeCampaignUsageDate(now: Date, timezone: string | undefined): string {
  const zone = timezone && timezone.trim() !== '' ? timezone : DEFAULT_TIMEZONE;
  const dt = DateTime.fromJSDate(now, { zone });
  const valid = dt.isValid ? dt : DateTime.fromJSDate(now, { zone: DEFAULT_TIMEZONE });
  return valid.toFormat('yyyy-LL-dd');
}

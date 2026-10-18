export interface RampComputeInput {
  startingDailyLimit: number;
  maximumDailyLimit: number;
  rampStep: number;
  rampIntervalHours: number;
  startDate: Date | null;
  lastProgressionAt: Date | null;
  now: Date;
  pausedHours?: number;
  holdRamp?: boolean;
}

export interface RampComputeResult {
  currentLimit: number;
  shouldProgress: boolean;
  nextProgressionAt: Date | null;
}

/**
 * Pure function that computes the current daily warmup limit given a starting
 * point, step, cap, and elapsed periods since startDate. When `holdRamp` is
 * true (e.g. because health is degraded), the limit does not increase even if
 * an interval has elapsed. When paused, callers subtract paused time by
 * passing pausedHours.
 */
export function computeCurrentLimit(input: RampComputeInput): RampComputeResult {
  const {
    startingDailyLimit,
    maximumDailyLimit,
    rampStep,
    rampIntervalHours,
    startDate,
    lastProgressionAt,
    now,
    pausedHours = 0,
    holdRamp = false,
  } = input;

  const cap = Math.max(startingDailyLimit, maximumDailyLimit);
  if (!startDate) {
    return { currentLimit: startingDailyLimit, shouldProgress: false, nextProgressionAt: null };
  }

  const anchor = lastProgressionAt ?? startDate;
  const elapsedMs = Math.max(0, now.getTime() - anchor.getTime());
  const pausedMs = Math.max(0, pausedHours * 60 * 60_000);
  const effectiveHours = Math.max(0, elapsedMs / (60 * 60_000) - pausedHours);

  const totalElapsedHours = (now.getTime() - startDate.getTime()) / (60 * 60_000);
  const totalNetHours = Math.max(0, totalElapsedHours - pausedHours);
  const periodsCompleted = Math.floor(totalNetHours / rampIntervalHours);
  const targetLimit = Math.min(cap, startingDailyLimit + periodsCompleted * rampStep);

  const shouldProgress = !holdRamp && effectiveHours >= rampIntervalHours && targetLimit < cap;
  const nextProgressionAt = new Date(anchor.getTime() + rampIntervalHours * 60 * 60_000 + pausedMs);

  return {
    currentLimit: Math.max(startingDailyLimit, Math.min(targetLimit, cap)),
    shouldProgress,
    nextProgressionAt,
  };
}

/**
 * Returns the next daily limit after a progression event, capped at maximum.
 */
export function advanceLimit(
  currentLimit: number,
  rampStep: number,
  maximumDailyLimit: number,
): number {
  return Math.min(maximumDailyLimit, currentLimit + rampStep);
}

/**
 * True when the current limit has reached (or exceeded) the maximum limit.
 */
export function isWarmupComplete(currentLimit: number, maximumDailyLimit: number): boolean {
  return currentLimit >= maximumDailyLimit;
}

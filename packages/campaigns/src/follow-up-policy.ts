import type { DelayUnit } from './delays.js';

/** Maximum follow-up steps allowed (excluding initial email). */
export const MAX_FOLLOW_UPS = 5;

/** Maximum total steps: 1 initial + 5 follow-ups. */
export const MAX_SEQUENCE_STEPS = MAX_FOLLOW_UPS + 1;

/** Default delay in days for follow-ups 1–5 after the prior step. */
export const DEFAULT_FOLLOW_UP_DELAYS_DAYS = [2, 3, 4, 5, 7] as const;

/** Minimum delay values by unit (production safety). */
export const MIN_DELAY_BY_UNIT: Record<DelayUnit, number> = {
  MINUTES: 30,
  HOURS: 1,
  DAYS: 1,
};

export function isInitialStep(order: number): boolean {
  return order === 0;
}

export function isFollowUpStep(order: number): boolean {
  return order > 0;
}

export function countFollowUpSteps(steps: { order: number; enabled?: boolean }[]): number {
  return steps.filter((s) => s.order > 0 && s.enabled !== false).length;
}

export function validateDelayAmount(amount: number, unit: DelayUnit): string | null {
  const min = MIN_DELAY_BY_UNIT[unit];
  if (amount < min) {
    return `Delay must be at least ${min} ${unit.toLowerCase()}`;
  }
  return null;
}

export function getDefaultFollowUpDelayDays(followUpIndex: number): number {
  const idx = Math.max(0, Math.min(followUpIndex, DEFAULT_FOLLOW_UP_DELAYS_DAYS.length - 1));
  return DEFAULT_FOLLOW_UP_DELAYS_DAYS[idx]!;
}

export function clampMaxFollowUps(value: number): number {
  return Math.max(1, Math.min(MAX_FOLLOW_UPS, Math.floor(value)));
}

export interface FollowUpSeedStep {
  order: number;
  subjectTemplate: string;
  bodyTemplate: string;
  delayAmount: number;
  delayUnit: DelayUnit;
  enabled: boolean;
}

export function buildDefaultFollowUpSteps(count: number): FollowUpSeedStep[] {
  const followUpCount = clampMaxFollowUps(count);
  const steps: FollowUpSeedStep[] = [
    {
      order: 0,
      subjectTemplate: 'Hi {{first_name|there}}',
      bodyTemplate: 'Quick note about {{company}}.',
      delayAmount: 0,
      delayUnit: 'DAYS',
      enabled: true,
    },
  ];

  for (let i = 0; i < followUpCount; i += 1) {
    steps.push({
      order: i + 1,
      subjectTemplate: `Following up — {{company}}`,
      bodyTemplate: `Hi {{first_name|there}},\n\nJust wanted to follow up on my previous email.\n\nBest,`,
      delayAmount: getDefaultFollowUpDelayDays(i),
      delayUnit: 'DAYS',
      enabled: true,
    });
  }

  return steps;
}

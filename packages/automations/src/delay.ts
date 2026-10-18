import { delayToDays, type DelayUnit } from '@signalforge/campaigns';

export function calculateResumeAt(
  now: Date,
  amount: number,
  unit: DelayUnit,
  useBusinessHours?: boolean,
): Date {
  if (useBusinessHours) {
    const days = delayToDays(amount, unit);
    const ms = days * 24 * 60 * 60 * 1000;
    return new Date(now.getTime() + ms);
  }

  switch (unit) {
    case 'MINUTES':
      return new Date(now.getTime() + amount * 60 * 1000);
    case 'HOURS':
      return new Date(now.getTime() + amount * 60 * 60 * 1000);
    case 'DAYS':
    default:
      return new Date(now.getTime() + amount * 24 * 60 * 60 * 1000);
  }
}

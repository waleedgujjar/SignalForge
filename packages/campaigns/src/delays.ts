export type DelayUnit = 'MINUTES' | 'HOURS' | 'DAYS';

export function delayToDays(amount: number, unit: DelayUnit): number {
  switch (unit) {
    case 'MINUTES':
      return amount / (60 * 24);
    case 'HOURS':
      return amount / 24;
    case 'DAYS':
    default:
      return amount;
  }
}

export function syncDelayDays(amount: number, unit: DelayUnit): number {
  return Math.max(0, Math.round(delayToDays(amount, unit)));
}

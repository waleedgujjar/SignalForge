export const MAX_STEPS_PER_EXECUTION = 100;
export const MAX_EXECUTION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_NODE_RETRIES = 3;

export function isExecutionExpired(startedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - startedAt.getTime() > MAX_EXECUTION_DURATION_MS;
}

export function hasExceededStepLimit(stepCount: number): boolean {
  return stepCount >= MAX_STEPS_PER_EXECUTION;
}

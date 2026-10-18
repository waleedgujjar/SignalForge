export function createRequestTimeout(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export const AI_TIMEOUT_MS = 60_000;
export const AI_HEAVY_TIMEOUT_MS = 90_000;

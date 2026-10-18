export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function createSessionExpiry(): Date {
  return new Date(Date.now() + SESSION_DURATION_MS);
}

export function isSessionValid(expiresAt: Date): boolean {
  return expiresAt.getTime() > Date.now();
}

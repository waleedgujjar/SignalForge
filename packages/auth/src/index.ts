export {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashToken,
} from './password.js';

export type { AuthSession, SessionRecord } from './password.js';

export { createSessionExpiry, isSessionValid, SESSION_DURATION_MS } from './session.js';

export {
  hasPermission,
  hasMinimumRole,
  canManageMembers,
  isReadOnly,
} from './permissions.js';

export type {
  MemberRole,
  AuthenticatedUser,
  WorkspaceSummary,
  PermissionAction,
} from './types.js';

export { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from './types.js';

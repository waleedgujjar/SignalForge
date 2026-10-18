export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string | null;
  workspaceId?: string;
  role?: MemberRole;
  sessionId: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: MemberRole;
}

export type PermissionAction =
  | 'workspace:read'
  | 'workspace:update'
  | 'workspace:delete'
  | 'workspace:manage_members'
  | 'resource:read'
  | 'resource:write'
  | 'resource:delete';

export const SESSION_COOKIE_NAME = 'sf_session';
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

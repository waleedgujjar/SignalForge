import type { MemberRole, PermissionAction } from './types.js';

const ROLE_PERMISSIONS: Record<MemberRole, PermissionAction[]> = {
  OWNER: [
    'workspace:read',
    'workspace:update',
    'workspace:delete',
    'workspace:manage_members',
    'resource:read',
    'resource:write',
    'resource:delete',
  ],
  ADMIN: [
    'workspace:read',
    'workspace:update',
    'workspace:manage_members',
    'resource:read',
    'resource:write',
    'resource:delete',
  ],
  MEMBER: ['workspace:read', 'resource:read', 'resource:write'],
  VIEWER: ['workspace:read', 'resource:read'],
};

const ROLE_RANK: Record<MemberRole, number> = {
  VIEWER: 1,
  MEMBER: 2,
  ADMIN: 3,
  OWNER: 4,
};

export function hasPermission(role: MemberRole, action: PermissionAction): boolean {
  return ROLE_PERMISSIONS[role].includes(action);
}

export function hasMinimumRole(role: MemberRole, minimum: MemberRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function canManageMembers(role: MemberRole): boolean {
  return hasPermission(role, 'workspace:manage_members');
}

export function isReadOnly(role: MemberRole): boolean {
  return role === 'VIEWER';
}

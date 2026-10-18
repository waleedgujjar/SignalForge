import { describe, expect, it } from 'vitest';
import { hasPermission, hasMinimumRole, isReadOnly } from './permissions.js';

describe('permissions', () => {
  it('grants OWNER full workspace permissions', () => {
    expect(hasPermission('OWNER', 'workspace:delete')).toBe(true);
    expect(hasPermission('OWNER', 'workspace:manage_members')).toBe(true);
  });

  it('restricts VIEWER to read-only', () => {
    expect(isReadOnly('VIEWER')).toBe(true);
    expect(hasPermission('VIEWER', 'resource:write')).toBe(false);
    expect(hasPermission('VIEWER', 'resource:read')).toBe(true);
  });

  it('compares role hierarchy', () => {
    expect(hasMinimumRole('ADMIN', 'MEMBER')).toBe(true);
    expect(hasMinimumRole('MEMBER', 'ADMIN')).toBe(false);
  });
});

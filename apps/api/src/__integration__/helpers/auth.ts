import { randomUUID } from 'node:crypto';
import { hashToken } from '@signalforge/auth';
import { stores, type MockUser, type MockSession, type MockWorkspace, type MockWorkspaceMember } from './mock-db.js';

export interface TestUserContext {
  userId: string;
  workspaceId: string;
  sessionToken: string;
  tokenHash: string;
  user: MockUser;
  workspace: MockWorkspace;
  member: MockWorkspaceMember;
  session: MockSession;
}

export function createTestUser(opts?: {
  email?: string;
  name?: string;
  role?: string;
  workspaceName?: string;
  workspaceSlug?: string;
}): TestUserContext {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const memberId = randomUUID();
  const sessionToken = randomUUID();
  const tokenHash = hashToken(sessionToken);

  const now = new Date();

  const user: MockUser = {
    id: userId,
    email: opts?.email ?? `user-${userId.slice(0, 8)}@test.signalforge`,
    passwordHash: '$scrypt$test-hash',
    name: opts?.name ?? 'Test User',
    emailVerifiedAt: now,
    onboardingCompletedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const workspace: MockWorkspace = {
    id: workspaceId,
    name: opts?.workspaceName ?? 'Test Workspace',
    slug: opts?.workspaceSlug ?? `ws-${workspaceId.slice(0, 8)}`,
    timezone: 'UTC',
    createdAt: now,
    updatedAt: now,
  };

  const member: MockWorkspaceMember = {
    id: memberId,
    workspaceId,
    userId,
    role: opts?.role ?? 'ADMIN',
    createdAt: now,
  };

  const session: MockSession = {
    id: randomUUID(),
    userId,
    tokenHash,
    activeWorkspaceId: workspaceId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: now,
  };

  stores.users.set(userId, user);
  stores.workspaces.set(workspaceId, workspace);
  stores.workspaceMembers.set(memberId, member);
  stores.sessions.set(session.id, session);

  return { userId, workspaceId, sessionToken, tokenHash, user, workspace, member, session };
}

export function addMember(
  workspaceId: string,
  opts?: { role?: string; email?: string; name?: string },
): TestUserContext {
  const userId = randomUUID();
  const memberId = randomUUID();
  const sessionToken = randomUUID();
  const tokenHash = hashToken(sessionToken);
  const now = new Date();

  const user: MockUser = {
    id: userId,
    email: opts?.email ?? `member-${userId.slice(0, 8)}@test.signalforge`,
    passwordHash: '$scrypt$test-hash',
    name: opts?.name ?? 'Team Member',
    emailVerifiedAt: now,
    onboardingCompletedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const member: MockWorkspaceMember = {
    id: memberId,
    workspaceId,
    userId,
    role: opts?.role ?? 'MEMBER',
    createdAt: now,
  };

  const session: MockSession = {
    id: randomUUID(),
    userId,
    tokenHash,
    activeWorkspaceId: workspaceId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: now,
  };

  stores.users.set(userId, user);
  stores.workspaceMembers.set(memberId, member);
  stores.sessions.set(session.id, session);

  const workspace = stores.workspaces.get(workspaceId)!;

  return { userId, workspaceId, sessionToken, tokenHash, user, workspace, member, session };
}

export function as(token: string): { cookies: { sf_session: string } } {
  return { cookies: { sf_session: token } };
}

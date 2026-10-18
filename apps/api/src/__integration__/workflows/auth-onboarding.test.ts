import { describe, expect, it, beforeEach } from 'vitest';
import { hashToken } from '@signalforge/auth';
import { createTestUser, addMember, as } from '../helpers/auth.js';
import { stores } from '../helpers/mock-db.js';

const VALID_PASSWORD = 'StrongPass1';

let app: Awaited<ReturnType<typeof import('../../app.js').buildApp>>;

beforeEach(async () => {
  const { buildApp } = await import('../../app.js');
  app = await buildApp();
});

describe('Workflow A: Auth & Onboarding', () => {
  describe('signup', () => {
    it('creates user, session, and returns needsOnboarding=true', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          email: 'newuser@test.signalforge',
          password: VALID_PASSWORD,
          confirmPassword: VALID_PASSWORD,
          name: 'New User',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user.email).toBe('newuser@test.signalforge');
      expect(body.user.name).toBe('New User');
      expect(body.needsOnboarding).toBe(true);
      expect(body.workspaces).toEqual([]);

      expect(res.cookies.some((c: { name: string }) => c.name === 'sf_session')).toBe(true);

      const createdUser = [...stores.users.values()].find(
        (u) => u.email === 'newuser@test.signalforge',
      );
      expect(createdUser).toBeDefined();
      expect(stores.sessions.size).toBeGreaterThanOrEqual(1);
    });

    it('rejects duplicate email without leaking user existence', async () => {
      createTestUser({ email: 'existing@test.signalforge' });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          email: 'existing@test.signalforge',
          password: VALID_PASSWORD,
          confirmPassword: VALID_PASSWORD,
          name: 'Duplicate',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('Unable to create account');
      expect(body).not.toHaveProperty('user');
    });
  });

  describe('login', () => {
    it('authenticates with correct credentials and returns session', async () => {
      await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          email: 'loginuser@test.signalforge',
          password: VALID_PASSWORD,
          confirmPassword: VALID_PASSWORD,
          name: 'Login User',
        },
      });

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'loginuser@test.signalforge',
          password: VALID_PASSWORD,
        },
      });

      expect(loginRes.statusCode).toBe(200);
      const body = loginRes.json();
      expect(body.user.email).toBe('loginuser@test.signalforge');
      expect(loginRes.cookies.some((c: { name: string }) => c.name === 'sf_session')).toBe(true);
    });

    it('rejects incorrect password with 401', async () => {
      await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          email: 'wrongpass@test.signalforge',
          password: VALID_PASSWORD,
          confirmPassword: VALID_PASSWORD,
          name: 'WrongPass User',
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'wrongpass@test.signalforge',
          password: 'WrongPassword1',
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('Invalid credentials');
    });
  });

  describe('session', () => {
    it('resolves session from cookie and returns user context', async () => {
      const ctx = createTestUser({ email: 'session@test.signalforge' });

      const res = await app.inject({
        method: 'GET',
        url: '/auth/session',
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user.id).toBe(ctx.userId);
      expect(body.user.email).toBe('session@test.signalforge');
      expect(body.workspace).toBeTruthy();
      expect(body.workspace.id).toBe(ctx.workspaceId);
    });

    it('returns 401 for invalid session token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/session',
        ...as('nonexistent-token'),
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('logout', () => {
    it('invalidates session and subsequent session check returns 401', async () => {
      const ctx = createTestUser({ email: 'logout@test.signalforge' });

      const logoutRes = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        ...as(ctx.sessionToken),
      });
      expect(logoutRes.statusCode).toBe(200);

      const sessionsBefore = [...stores.sessions.values()].filter(
        (s) => s.tokenHash === hashToken(ctx.sessionToken),
      );
      expect(sessionsBefore.length).toBe(0);

      const sessionRes = await app.inject({
        method: 'GET',
        url: '/auth/session',
        ...as(ctx.sessionToken),
      });
      expect(sessionRes.statusCode).toBe(401);
    });
  });

  describe('RBAC basics', () => {
    it('MEMBER cannot access ADMIN-only routes', async () => {
      const admin = createTestUser({ email: 'admin@test.signalforge', role: 'ADMIN' });
      const member = addMember(admin.workspaceId, {
        role: 'MEMBER',
        email: 'member@test.signalforge',
      });

      const memberRes = await app.inject({
        method: 'PUT',
        url: '/lead-discovery/sources',
        payload: { sources: [] },
        ...as(member.sessionToken),
      });
      expect(memberRes.statusCode).toBe(403);

      const adminRes = await app.inject({
        method: 'GET',
        url: '/leads',
        query: { page: '1', pageSize: '10' },
        ...as(admin.sessionToken),
      });
      expect(adminRes.statusCode).toBe(200);
    });

    it('unauthenticated request returns 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/leads',
        query: { page: '1', pageSize: '10' },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});

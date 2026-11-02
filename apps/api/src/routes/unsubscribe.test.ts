import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const db = vi.hoisted(() => ({
  updates: [] as unknown[],
  suppressions: [] as unknown[],
}));

vi.mock('@signalforge/config', () => ({
  loadEnv: () => ({ SESSION_SECRET: 'test-session-secret-with-minimum-length', API_URL: 'https://api.test' }),
}));
vi.mock('@signalforge/database', () => ({
  prisma: {
    lead: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'lead_1' ? { id: 'lead_1', workspaceId: 'ws_1', email: 'Jane@Acme.com' } : null,
      ),
      update: vi.fn((args: unknown) => {
        db.updates.push(args);
        return args;
      }),
    },
    suppression: {
      upsert: vi.fn((args: unknown) => {
        db.suppressions.push(args);
        return args;
      }),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  const { unsubscribeRoutes } = await import('./unsubscribe.js');
  const { generateUnsubscribeToken } = await import('../unsubscribe-token.js');
  token = generateUnsubscribeToken('camp_1', 'lead_1');
  app = Fastify();
  await app.register(unsubscribeRoutes, { prefix: '/unsubscribe' });
  await app.ready();
});

beforeEach(() => {
  db.updates = [];
  db.suppressions = [];
});

describe('unsubscribe', () => {
  it('accepts the RFC 8058 one-click POST that Gmail and Yahoo send', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/unsubscribe?token=${encodeURIComponent(token)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(db.updates).toHaveLength(1);
    expect(db.suppressions[0]).toMatchObject({ create: { value: 'jane@acme.com', reason: 'UNSUBSCRIBED' } });
  });

  it('only shows a confirmation page on GET, so link scanners cannot unsubscribe anyone', async () => {
    const res = await app.inject({ method: 'GET', url: `/unsubscribe?token=${encodeURIComponent(token)}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<form method="post"');
    expect(db.updates).toHaveLength(0);
    expect(db.suppressions).toHaveLength(0);
  });

  it('unsubscribes from the confirmation form and answers with a page', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/unsubscribe?token=${encodeURIComponent(token)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
      payload: '',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('You have been unsubscribed');
    expect(db.updates).toHaveLength(1);
  });

  it('rejects a tampered token', async () => {
    const res = await app.inject({ method: 'POST', url: '/unsubscribe?token=abc.def' });
    expect(res.statusCode).toBe(400);
    expect(db.updates).toHaveLength(0);
  });
});

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createTestUser, as } from '../helpers/auth.js';
import { makeLead as _makeLead } from '../helpers/factories.js';

let app: Awaited<ReturnType<typeof import('../../app.js').buildApp>>;

beforeEach(async () => {
  const { buildApp } = await import('../../app.js');
  app = await buildApp();
});

describe('Cross-Cutting: Error Handling', () => {
  it('returns 400 with issues on Zod validation failure', async () => {
    const ctx = createTestUser({ email: 'err@zod.test' });

    const res = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: {},
      ...as(ctx.sessionToken),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.issues).toBeDefined();
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('returns 400 for invalid campaign step schema', async () => {
    const ctx = createTestUser({ email: 'err@step.test' });

    const res = await app.inject({
      method: 'POST',
      url: '/campaigns/camp-fake/steps',
      payload: { subject: 'wrong field', body: 'also wrong' },
      ...as(ctx.sessionToken),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Validation failed');
  });

  it('returns 404 for non-existent lead', async () => {
    const ctx = createTestUser({ email: 'err@404.test' });

    const res = await app.inject({
      method: 'GET',
      url: '/leads/nonexistent-id',
      ...as(ctx.sessionToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for non-existent campaign', async () => {
    const ctx = createTestUser({ email: 'err@404camp.test' });

    const res = await app.inject({
      method: 'GET',
      url: '/campaigns/nonexistent-id',
      ...as(ctx.sessionToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for non-existent workflow (service throws)', async () => {
    const ctx = createTestUser({ email: 'err@404wf.test' });

    const { workflowService } = await import('@signalforge/automations');
    (workflowService.getById as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Workflow not found'),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/automations/nonexistent',
      ...as(ctx.sessionToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Workflow not found');
  });

  it('returns 400 for invalid suppression type', async () => {
    const ctx = createTestUser({ email: 'err@supptype.test' });

    const res = await app.inject({
      method: 'POST',
      url: '/suppressions',
      payload: { type: 'INVALID_TYPE', value: 'test@example.com' },
      ...as(ctx.sessionToken),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Validation failed');
  });

  it('returns 400 for campaign stop without confirmed: true', async () => {
    const ctx = createTestUser({ email: 'err@stop.test' });

    const res = await app.inject({
      method: 'POST',
      url: '/campaigns/camp-fake/stop',
      payload: {},
      ...as(ctx.sessionToken),
    });
    expect(res.statusCode).toBe(400);
  });
});

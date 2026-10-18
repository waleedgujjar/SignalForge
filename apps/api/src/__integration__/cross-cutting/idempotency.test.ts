import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createTestUser, as } from '../helpers/auth.js';
import { makeLead, makeCampaign, makeDiscoveryJob } from '../helpers/factories.js';

let app: Awaited<ReturnType<typeof import('../../app.js').buildApp>>;

beforeEach(async () => {
  const { buildApp } = await import('../../app.js');
  app = await buildApp();
});

describe('Cross-Cutting: Idempotency', () => {
  it('duplicate suppression upsert updates without creating a second record', async () => {
    const ctx = createTestUser({ email: 'idem@supp.test' });

    const first = await app.inject({
      method: 'POST',
      url: '/suppressions',
      payload: { type: 'EMAIL', value: 'dup@example.com', reason: 'MANUAL' },
      ...as(ctx.sessionToken),
    });
    expect(first.statusCode).toBe(201);
    const firstId = first.json().id;

    const second = await app.inject({
      method: 'POST',
      url: '/suppressions',
      payload: { type: 'EMAIL', value: 'dup@example.com', reason: 'BOUNCED' },
      ...as(ctx.sessionToken),
    });
    expect(second.statusCode).toBe(201);
    const secondBody = second.json();
    expect(secondBody.id).toBe(firstId);
    expect(secondBody.reason).toBe('BOUNCED');
  });

  it('duplicate lead creation produces separate records (no upsert)', async () => {
    const ctx = createTestUser({ email: 'idem@lead.test' });

    const first = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: { email: 'same@example.com', firstName: 'A', lastName: 'B' },
      ...as(ctx.sessionToken),
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: { email: 'same@example.com', firstName: 'C', lastName: 'D' },
      ...as(ctx.sessionToken),
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().id).not.toBe(first.json().id);
  });

  it('duplicate tag assignment does not error', async () => {
    const ctx = createTestUser({ email: 'idem@tag.test' });
    const lead = makeLead(ctx.workspaceId, { email: 'tagged@test.com' });

    const { stores } = await import('../helpers/mock-db.js');
    const tagId = `tag-${Date.now()}`;
    stores.tags.set(tagId, {
      id: tagId,
      workspaceId: ctx.workspaceId,
      name: 'Hot',
      color: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const first = await app.inject({
      method: 'POST',
      url: `/leads/${lead.id}/tags`,
      payload: { tagIds: [tagId] },
      ...as(ctx.sessionToken),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().added).toBe(1);

    // Route returns tags.length (found tags), not actual insert count.
    // Prisma's skipDuplicates prevents real duplicates; the route succeeds either way.
    const second = await app.inject({
      method: 'POST',
      url: `/leads/${lead.id}/tags`,
      payload: { tagIds: [tagId] },
      ...as(ctx.sessionToken),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().added).toBe(1);
  });

  it('duplicate campaign enrollment is skipped', async () => {
    const ctx = createTestUser({ email: 'idem@enroll.test' });
    const lead = makeLead(ctx.workspaceId, { email: 'enrollee@test.com' });
    const camp = makeCampaign(ctx.workspaceId, { name: 'Enroll Camp', status: 'ACTIVE' });

    const { campaignLeadService } = await import('@signalforge/campaigns');
    (campaignLeadService.enrollLeads as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ enrolled: 1, skipped: 0 })
      .mockResolvedValueOnce({ enrolled: 0, skipped: 1 });

    const first = await app.inject({
      method: 'POST',
      url: `/campaigns/${camp.id}/leads`,
      payload: { leadIds: [lead.id] },
      ...as(ctx.sessionToken),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().enrolled).toBe(1);

    const second = await app.inject({
      method: 'POST',
      url: `/campaigns/${camp.id}/leads`,
      payload: { leadIds: [lead.id] },
      ...as(ctx.sessionToken),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().skipped).toBe(1);
  });

  it('cancelling an already-cancelled discovery job returns 409', async () => {
    const ctx = createTestUser({ email: 'idem@cancel.test' });
    const job = makeDiscoveryJob(ctx.workspaceId, {
      source: 'GOOGLE_MAPS_SCRAPER',
      status: 'CANCELLED',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/lead-discovery/jobs/${job.id}/cancel`,
      ...as(ctx.sessionToken),
    });
    expect(res.statusCode).toBe(409);
  });
});

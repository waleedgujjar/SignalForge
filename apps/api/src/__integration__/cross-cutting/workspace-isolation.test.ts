import { describe, expect, it, beforeEach } from 'vitest';
import { createTestUser, as } from '../helpers/auth.js';
import { makeLead, makeCampaign, makeTag, makeList, makeDiscoveryJob } from '../helpers/factories.js';

let app: Awaited<ReturnType<typeof import('../../app.js').buildApp>>;

beforeEach(async () => {
  const { buildApp } = await import('../../app.js');
  app = await buildApp();
});

describe('Cross-Cutting: Workspace Isolation', () => {
  it('leads are invisible across workspaces', async () => {
    const userA = createTestUser({ email: 'a@iso.test' });
    const userB = createTestUser({ email: 'b@iso.test' });

    makeLead(userA.workspaceId, { email: 'private@a.com' });

    const listRes = await app.inject({
      method: 'GET',
      url: '/leads',
      query: { page: '1', limit: '50' },
      ...as(userB.sessionToken),
    });
    expect(listRes.json().data.length).toBe(0);
  });

  it('lead by ID returns 404 for wrong workspace', async () => {
    const userA = createTestUser({ email: 'a@iso2.test' });
    const userB = createTestUser({ email: 'b@iso2.test' });
    const lead = makeLead(userA.workspaceId, { email: 'secret@a.com' });

    const res = await app.inject({
      method: 'GET',
      url: `/leads/${lead.id}`,
      ...as(userB.sessionToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('campaigns are invisible across workspaces', async () => {
    const userA = createTestUser({ email: 'a@iso3.test' });
    const userB = createTestUser({ email: 'b@iso3.test' });

    makeCampaign(userA.workspaceId, { name: 'Secret Camp' });

    const listRes = await app.inject({
      method: 'GET',
      url: '/campaigns',
      query: { page: '1', limit: '50' },
      ...as(userB.sessionToken),
    });
    expect(listRes.json().data.length).toBe(0);
  });

  it('campaign by ID returns 404 for wrong workspace', async () => {
    const userA = createTestUser({ email: 'a@iso4.test' });
    const userB = createTestUser({ email: 'b@iso4.test' });
    const camp = makeCampaign(userA.workspaceId, { name: 'Private' });

    const res = await app.inject({
      method: 'GET',
      url: `/campaigns/${camp.id}`,
      ...as(userB.sessionToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('discovery jobs are invisible across workspaces', async () => {
    const userA = createTestUser({ email: 'a@iso5.test' });
    const userB = createTestUser({ email: 'b@iso5.test' });

    makeDiscoveryJob(userA.workspaceId, { source: 'GOOGLE_MAPS_SCRAPER' });

    const listRes = await app.inject({
      method: 'GET',
      url: '/lead-discovery/jobs',
      query: { page: '1', limit: '50' },
      ...as(userB.sessionToken),
    });
    expect(listRes.json().data.length).toBe(0);
  });

  it('tags are invisible across workspaces', async () => {
    const userA = createTestUser({ email: 'a@iso6.test' });
    const userB = createTestUser({ email: 'b@iso6.test' });

    makeTag(userA.workspaceId, { name: 'Secret Tag' });

    const res = await app.inject({
      method: 'GET',
      url: '/leads/tags',
      ...as(userB.sessionToken),
    });
    expect(res.json().length).toBe(0);
  });

  it('lists are invisible across workspaces', async () => {
    const userA = createTestUser({ email: 'a@iso7.test' });
    const userB = createTestUser({ email: 'b@iso7.test' });

    makeList(userA.workspaceId, { name: 'Secret List' });

    const res = await app.inject({
      method: 'GET',
      url: '/leads/lists',
      ...as(userB.sessionToken),
    });
    expect(res.json().length).toBe(0);
  });
});

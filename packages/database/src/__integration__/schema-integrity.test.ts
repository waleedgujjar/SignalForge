import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const TEST_DB_URL =
  process.env.DATABASE_URL ??
  'postgresql://signalforge:signalforge@localhost:5435/signalforge_test';

let pool: Pool;
let prisma: PrismaClient;

const createdIds: { table: string; id: string }[] = [];

function track(table: string, id: string) {
  createdIds.push({ table, id });
}

beforeAll(async () => {
  pool = new Pool({ connectionString: TEST_DB_URL });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
});

afterEach(async () => {
  // Clean up in reverse order to respect FK constraints
  for (const { table, id } of createdIds.reverse()) {
    try {
      await pool.query(`DELETE FROM "${table}" WHERE id = $1`, [id]);
    } catch {
      // Already deleted via cascade
    }
  }
  createdIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

async function createUser(email: string) {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: '$test$hash',
      name: 'Test User',
    },
  });
  track('User', user.id);
  return user;
}

async function createWorkspace(name: string) {
  const ws = await prisma.workspace.create({
    data: { name, slug: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` },
  });
  track('Workspace', ws.id);
  return ws;
}

async function createMember(workspaceId: string, userId: string, role = 'MEMBER' as const) {
  const m = await prisma.workspaceMember.create({
    data: { workspaceId, userId, role },
  });
  track('WorkspaceMember', m.id);
  return m;
}

describe('Schema Integrity (Real PostgreSQL)', () => {
  it('enforces unique email constraint on User', async () => {
    await createUser('unique-email-test@schema.test');

    await expect(
      prisma.user.create({
        data: { email: 'unique-email-test@schema.test', passwordHash: '$h', name: 'Dup' },
      }),
    ).rejects.toThrow();
  });

  it('enforces unique (workspaceId, userId) on WorkspaceMember', async () => {
    const user = await createUser('wm-unique@schema.test');
    const ws = await createWorkspace('WM Unique Test');
    await createMember(ws.id, user.id, 'MEMBER');

    await expect(
      prisma.workspaceMember.create({
        data: { workspaceId: ws.id, userId: user.id, role: 'ADMIN' },
      }),
    ).rejects.toThrow();
  });

  it('cascades Session delete when User is deleted', async () => {
    const user = await createUser('cascade-session@schema.test');
    const ws = await createWorkspace('Cascade Session WS');

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: `hash-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3600_000),
        activeWorkspaceId: ws.id,
      },
    });
    track('Session', session.id);

    // Delete user — session should cascade
    await prisma.user.delete({ where: { id: user.id } });
    createdIds.splice(
      createdIds.findIndex((r) => r.table === 'User' && r.id === user.id),
      1,
    );

    const found = await prisma.session.findUnique({ where: { id: session.id } });
    expect(found).toBeNull();
  });

  it('enforces Lead FK to Workspace', async () => {
    await expect(
      prisma.lead.create({
        data: {
          workspaceId: 'nonexistent-ws-id',
          email: 'orphan@schema.test',
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces unique (workspaceId, type, value) on Suppression', async () => {
    const ws = await createWorkspace('Supp Unique WS');

    const supp = await prisma.suppression.create({
      data: { workspaceId: ws.id, type: 'EMAIL', value: 'dup@supp.test', reason: 'MANUAL', source: 'USER' },
    });
    track('Suppression', supp.id);

    await expect(
      prisma.suppression.create({
        data: { workspaceId: ws.id, type: 'EMAIL', value: 'dup@supp.test', reason: 'MANUAL', source: 'USER' },
      }),
    ).rejects.toThrow();
  });

  it('enforces unique (leadId, tagId) on LeadTag', async () => {
    const user = await createUser('leadtag-unique@schema.test');
    const ws = await createWorkspace('LeadTag Unique WS');
    await createMember(ws.id, user.id);

    const lead = await prisma.lead.create({
      data: { workspaceId: ws.id, email: 'tagged@schema.test' },
    });
    track('Lead', lead.id);

    const tag = await prisma.tag.create({
      data: { workspaceId: ws.id, name: 'Schema Tag' },
    });
    track('Tag', tag.id);

    const lt = await prisma.leadTag.create({
      data: { leadId: lead.id, tagId: tag.id },
    });
    track('LeadTag', lt.id);

    await expect(
      prisma.leadTag.create({ data: { leadId: lead.id, tagId: tag.id } }),
    ).rejects.toThrow();
  });

  it('enforces unique (workspaceId, idempotencyKey) on WorkflowEvent', async () => {
    const ws = await createWorkspace('WFE Unique WS');

    const ev1 = await prisma.workflowEvent.create({
      data: {
        workspaceId: ws.id,
        eventType: 'LEAD_CREATED',
        idempotencyKey: 'idem-key-1',
      },
    });
    track('WorkflowEvent', ev1.id);

    await expect(
      prisma.workflowEvent.create({
        data: {
          workspaceId: ws.id,
          eventType: 'LEAD_IMPORTED',
          idempotencyKey: 'idem-key-1',
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces unique (campaignId, leadId) on CampaignLead', async () => {
    const ws = await createWorkspace('CL Unique WS');

    const lead = await prisma.lead.create({
      data: { workspaceId: ws.id, email: 'cl-unique@schema.test' },
    });
    track('Lead', lead.id);

    const campaign = await prisma.campaign.create({
      data: { workspaceId: ws.id, name: 'CL Unique Camp', status: 'DRAFT' },
    });
    track('Campaign', campaign.id);

    const cl = await prisma.campaignLead.create({
      data: { campaignId: campaign.id, leadId: lead.id, status: 'PENDING' },
    });
    track('CampaignLead', cl.id);

    await expect(
      prisma.campaignLead.create({
        data: { campaignId: campaign.id, leadId: lead.id, status: 'PENDING' },
      }),
    ).rejects.toThrow();
  });

  it('cascades Lead delete when Workspace is deleted', async () => {
    const ws = await createWorkspace('Cascade Lead WS');

    const lead = await prisma.lead.create({
      data: { workspaceId: ws.id, email: 'cascade-lead@schema.test' },
    });
    track('Lead', lead.id);

    await prisma.workspace.delete({ where: { id: ws.id } });
    createdIds.splice(
      createdIds.findIndex((r) => r.table === 'Workspace' && r.id === ws.id),
      1,
    );

    const found = await prisma.lead.findUnique({ where: { id: lead.id } });
    expect(found).toBeNull();
  });

  it('cascades Campaign delete when Workspace is deleted', async () => {
    const ws = await createWorkspace('Cascade Camp WS');

    const campaign = await prisma.campaign.create({
      data: { workspaceId: ws.id, name: 'Cascade Camp', status: 'DRAFT' },
    });
    track('Campaign', campaign.id);

    await prisma.workspace.delete({ where: { id: ws.id } });
    createdIds.splice(
      createdIds.findIndex((r) => r.table === 'Workspace' && r.id === ws.id),
      1,
    );

    const found = await prisma.campaign.findUnique({ where: { id: campaign.id } });
    expect(found).toBeNull();
  });

  it('suppression upsert updates reason on duplicate key', async () => {
    const ws = await createWorkspace('Supp Upsert WS');

    const supp = await prisma.suppression.upsert({
      where: {
        workspaceId_type_value: { workspaceId: ws.id, type: 'DOMAIN', value: 'upsert.test' },
      },
      create: {
        workspaceId: ws.id,
        type: 'DOMAIN',
        value: 'upsert.test',
        reason: 'MANUAL',
        source: 'USER',
      },
      update: { reason: 'BOUNCED' },
    });
    track('Suppression', supp.id);
    expect(supp.reason).toBe('MANUAL');

    const updated = await prisma.suppression.upsert({
      where: {
        workspaceId_type_value: { workspaceId: ws.id, type: 'DOMAIN', value: 'upsert.test' },
      },
      create: {
        workspaceId: ws.id,
        type: 'DOMAIN',
        value: 'upsert.test',
        reason: 'MANUAL',
        source: 'USER',
      },
      update: { reason: 'BOUNCED' },
    });
    expect(updated.id).toBe(supp.id);
    expect(updated.reason).toBe('BOUNCED');
  });
});

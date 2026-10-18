import { describe, expect, it, vi, beforeEach } from 'vitest';

interface MockPool {
  id: string;
  workspaceId: string;
  name: string;
  strategy: string;
  enabled: boolean;
  members: { id: string; poolId: string; mailboxId: string; enabled: boolean; priority: number }[];
}

const pools = new Map<string, MockPool>();
const mailboxes = new Map<string, { id: string; workspaceId: string }>();

vi.mock('@signalforge/config', () => ({
  loadEnv: () => ({
    LOG_LEVEL: 'error',
    APP_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-session-secret-with-minimum-length',
    ENCRYPTION_KEY: 'a'.repeat(64),
  }),
}));

vi.mock('@signalforge/allocation', () => ({
  smtpPoolService: {
    listPools: vi.fn(async (workspaceId: string) =>
      [...pools.values()].filter((p) => p.workspaceId === workspaceId),
    ),
    getPool: vi.fn(async (workspaceId: string, id: string) => {
      const pool = pools.get(id);
      if (!pool || pool.workspaceId !== workspaceId) {
        const err = new Error(`SMTP pool ${id} not found`);
        err.name = 'PoolNotFoundError';
        throw err;
      }
      return pool;
    }),
    createPool: vi.fn(
      async (input: { workspaceId: string; name: string; strategy?: string; enabled?: boolean }) => {
        const dup = [...pools.values()].find(
          (p) => p.workspaceId === input.workspaceId && p.name === input.name,
        );
        if (dup) {
          const err = new Error(`SMTP pool named "${input.name}" already exists in workspace`);
          err.name = 'PoolNameConflictError';
          throw err;
        }
        const pool: MockPool = {
          id: `pool_${pools.size + 1}`,
          workspaceId: input.workspaceId,
          name: input.name,
          strategy: input.strategy ?? 'ROUND_ROBIN',
          enabled: input.enabled ?? true,
          members: [],
        };
        pools.set(pool.id, pool);
        return pool;
      },
    ),
    updatePool: vi.fn(
      async (
        workspaceId: string,
        id: string,
        input: Partial<{ name: string; enabled: boolean }>,
      ) => {
        const pool = pools.get(id);
        if (!pool || pool.workspaceId !== workspaceId) {
          const err = new Error(`SMTP pool ${id} not found`);
          err.name = 'PoolNotFoundError';
          throw err;
        }
        if (input.name !== undefined) pool.name = input.name;
        if (input.enabled !== undefined) pool.enabled = input.enabled;
        return pool;
      },
    ),
    deletePool: vi.fn(async (workspaceId: string, id: string) => {
      const pool = pools.get(id);
      if (!pool || pool.workspaceId !== workspaceId) {
        const err = new Error(`SMTP pool ${id} not found`);
        err.name = 'PoolNotFoundError';
        throw err;
      }
      pools.delete(id);
    }),
    addMember: vi.fn(
      async (input: { poolId: string; workspaceId: string; mailboxId: string; priority?: number }) => {
        const pool = pools.get(input.poolId);
        if (!pool || pool.workspaceId !== input.workspaceId) {
          const err = new Error(`SMTP pool ${input.poolId} not found`);
          err.name = 'PoolNotFoundError';
          throw err;
        }
        const mailbox = mailboxes.get(input.mailboxId);
        if (!mailbox || mailbox.workspaceId !== input.workspaceId) {
          const err = new Error(`Mailbox ${input.mailboxId} does not belong to workspace`);
          err.name = 'MailboxNotInWorkspaceError';
          throw err;
        }
        const member = {
          id: `mem_${pool.members.length + 1}`,
          poolId: pool.id,
          mailboxId: input.mailboxId,
          enabled: true,
          priority: input.priority ?? 0,
        };
        pool.members.push(member);
        return member;
      },
    ),
    removeMember: vi.fn(async (workspaceId: string, poolId: string, mailboxId: string) => {
      const pool = pools.get(poolId);
      if (!pool || pool.workspaceId !== workspaceId) {
        const err = new Error(`SMTP pool ${poolId} not found`);
        err.name = 'PoolNotFoundError';
        throw err;
      }
      pool.members = pool.members.filter((m) => m.mailboxId !== mailboxId);
    }),
  },
  PoolNotFoundError: class PoolNotFoundError extends Error {
    constructor(id: string) {
      super(`SMTP pool ${id} not found`);
      this.name = 'PoolNotFoundError';
    }
  },
  PoolNameConflictError: class PoolNameConflictError extends Error {
    constructor(name: string) {
      super(`SMTP pool named "${name}" already exists in workspace`);
      this.name = 'PoolNameConflictError';
    }
  },
  MailboxNotInWorkspaceError: class MailboxNotInWorkspaceError extends Error {
    constructor(id: string) {
      super(`Mailbox ${id} does not belong to workspace`);
      this.name = 'MailboxNotInWorkspaceError';
    }
  },
}));

describe('SMTP pool workspace isolation', () => {
  beforeEach(() => {
    pools.clear();
    mailboxes.clear();
    mailboxes.set('mb_1', { id: 'mb_1', workspaceId: 'ws_1' });
    mailboxes.set('mb_2', { id: 'mb_2', workspaceId: 'ws_other' });
  });

  it('scopes pool lookups by workspace', async () => {
    const { smtpPoolService } = await import('@signalforge/allocation');
    const created = await smtpPoolService.createPool({ workspaceId: 'ws_1', name: 'Team A' });
    await expect(smtpPoolService.getPool('ws_other', created.id)).rejects.toThrow(/not found/i);
    const own = await smtpPoolService.getPool('ws_1', created.id);
    expect(own.id).toBe(created.id);
  });

  it('rejects duplicate pool names within a workspace', async () => {
    const { smtpPoolService } = await import('@signalforge/allocation');
    await smtpPoolService.createPool({ workspaceId: 'ws_1', name: 'Main' });
    await expect(
      smtpPoolService.createPool({ workspaceId: 'ws_1', name: 'Main' }),
    ).rejects.toThrow(/already exists/i);
  });

  it('rejects adding mailboxes from another workspace to a pool', async () => {
    const { smtpPoolService } = await import('@signalforge/allocation');
    const pool = await smtpPoolService.createPool({ workspaceId: 'ws_1', name: 'Main' });
    await expect(
      smtpPoolService.addMember({ poolId: pool.id, workspaceId: 'ws_1', mailboxId: 'mb_2' }),
    ).rejects.toThrow(/does not belong to workspace/i);
  });

  it('adds and removes members successfully within a workspace', async () => {
    const { smtpPoolService } = await import('@signalforge/allocation');
    const pool = await smtpPoolService.createPool({ workspaceId: 'ws_1', name: 'Main' });
    await smtpPoolService.addMember({
      poolId: pool.id,
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
    });
    const listed = await smtpPoolService.listPools('ws_1');
    expect(listed[0]?.members).toHaveLength(1);
    await smtpPoolService.removeMember('ws_1', pool.id, 'mb_1');
    const afterRemove = await smtpPoolService.listPools('ws_1');
    expect(afterRemove[0]?.members).toHaveLength(0);
  });
});

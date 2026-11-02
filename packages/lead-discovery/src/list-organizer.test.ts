import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    leadList: { findFirst: vi.fn(), create: vi.fn() },
    leadListMember: { createMany: vi.fn() },
  },
}));
vi.mock('@signalforge/database', () => ({ prisma }));

import {
  LOCAL_BUSINESS_LIST_NAME,
  ensureLocalBusinessList,
  addLeadsToList,
  organizeAsLocalBusiness,
} from './list-organizer.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensureLocalBusinessList', () => {
  it('returns the existing list without creating a new one', async () => {
    prisma.leadList.findFirst.mockResolvedValueOnce({ id: 'list-1' });
    const id = await ensureLocalBusinessList('ws-1');
    expect(id).toBe('list-1');
    expect(prisma.leadList.create).not.toHaveBeenCalled();
    expect(prisma.leadList.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'ws-1', name: LOCAL_BUSINESS_LIST_NAME } }),
    );
  });

  it('creates the list when it does not exist yet', async () => {
    prisma.leadList.findFirst.mockResolvedValueOnce(null);
    prisma.leadList.create.mockResolvedValueOnce({ id: 'list-new' });
    const id = await ensureLocalBusinessList('ws-1');
    expect(id).toBe('list-new');
  });

  it('recovers from a unique-constraint race by fetching the winner', async () => {
    prisma.leadList.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'list-winner' });
    prisma.leadList.create.mockRejectedValueOnce(new Error('Unique constraint failed'));
    const id = await ensureLocalBusinessList('ws-1');
    expect(id).toBe('list-winner');
  });
});

describe('addLeadsToList', () => {
  it('is a no-op for an empty array', async () => {
    await addLeadsToList('list-1', []);
    expect(prisma.leadListMember.createMany).not.toHaveBeenCalled();
  });

  it('adds members, skipping duplicates', async () => {
    await addLeadsToList('list-1', ['a', 'b']);
    expect(prisma.leadListMember.createMany).toHaveBeenCalledWith({
      data: [
        { listId: 'list-1', leadId: 'a' },
        { listId: 'list-1', leadId: 'b' },
      ],
      skipDuplicates: true,
    });
  });
});

describe('organizeAsLocalBusiness', () => {
  it('resolves the list and adds the leads', async () => {
    prisma.leadList.findFirst.mockResolvedValueOnce({ id: 'list-1' });
    await organizeAsLocalBusiness('ws-1', ['a']);
    expect(prisma.leadListMember.createMany).toHaveBeenCalledWith({
      data: [{ listId: 'list-1', leadId: 'a' }],
      skipDuplicates: true,
    });
  });

  it('never throws — a failure to organize must not fail the import', async () => {
    prisma.leadList.findFirst.mockRejectedValueOnce(new Error('db down'));
    prisma.leadList.create.mockRejectedValueOnce(new Error('db down'));
    await expect(organizeAsLocalBusiness('ws-1', ['a'])).resolves.toBeUndefined();
  });
});

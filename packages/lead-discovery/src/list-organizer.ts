/// Keeping imported local-business leads organized in one place.
///
/// Every import path adds its leads to the workspace's "Local Businesses" lead
/// list, so they can be filtered and managed separately from leads added by
/// other means. The list is an ordinary LeadList, so the existing list filter,
/// bulk actions and campaign selection all work on it unchanged.

import { prisma } from '@signalforge/database';

export const LOCAL_BUSINESS_LIST_NAME = 'Local Businesses';

/** Get-or-create the workspace's "Local Businesses" list, returning its id. */
export async function ensureLocalBusinessList(workspaceId: string): Promise<string> {
  const existing = await prisma.leadList.findFirst({
    where: { workspaceId, name: LOCAL_BUSINESS_LIST_NAME },
    select: { id: true },
  });
  if (existing) return existing.id;
  try {
    const created = await prisma.leadList.create({
      data: { workspaceId, name: LOCAL_BUSINESS_LIST_NAME, description: 'Imported local business leads' },
      select: { id: true },
    });
    return created.id;
  } catch {
    // Lost the race on the unique (workspaceId, name) index — fetch the winner.
    const winner = await prisma.leadList.findFirst({
      where: { workspaceId, name: LOCAL_BUSINESS_LIST_NAME },
      select: { id: true },
    });
    if (winner) return winner.id;
    throw new Error('Could not resolve the Local Businesses list');
  }
}

/** Adds leads to a list, ignoring ones already in it. No-op for an empty array. */
export async function addLeadsToList(listId: string, leadIds: string[]): Promise<void> {
  if (leadIds.length === 0) return;
  await prisma.leadListMember.createMany({
    data: leadIds.map((leadId) => ({ listId, leadId })),
    skipDuplicates: true,
  });
}

/**
 * Best-effort "put these leads in the Local Businesses list". Resolves the list
 * and adds the leads; any failure is swallowed so it can never fail an import
 * that otherwise succeeded.
 */
export async function organizeAsLocalBusiness(workspaceId: string, leadIds: string[]): Promise<void> {
  if (leadIds.length === 0) return;
  try {
    const listId = await ensureLocalBusinessList(workspaceId);
    await addLeadsToList(listId, leadIds);
  } catch {
    // Non-fatal: the leads are still imported and categorized.
  }
}

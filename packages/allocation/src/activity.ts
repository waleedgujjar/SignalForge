import { prisma } from '@signalforge/database';
import type { AllocationOutcome, RotationStrategy } from './types.js';

export interface AllocationHistoryEntry {
  workspaceId: string;
  sendingJobId: string;
  campaignId: string;
  mailboxId: string | null;
  poolId: string | null;
  strategy: RotationStrategy;
  outcome: AllocationOutcome;
  reason?: string;
}

export async function logAllocation(entry: AllocationHistoryEntry): Promise<void> {
  await prisma.mailboxAllocationHistory.create({
    data: {
      workspaceId: entry.workspaceId,
      sendingJobId: entry.sendingJobId,
      campaignId: entry.campaignId,
      mailboxId: entry.mailboxId,
      poolId: entry.poolId,
      strategy: entry.strategy,
      outcome: entry.outcome,
      reason: entry.reason ?? null,
    },
  });
}

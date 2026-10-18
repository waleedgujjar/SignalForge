import { prisma } from '@signalforge/database';

const STUCK_THRESHOLD_MS = 10 * 60 * 1000;

export async function recoverStuckDiscoveryJobs(now: Date = new Date()): Promise<number> {
  const threshold = new Date(now.getTime() - STUCK_THRESHOLD_MS);
  const stuck = await prisma.leadDiscoveryJob.findMany({
    where: { status: 'RUNNING', updatedAt: { lt: threshold } },
    select: { id: true },
    take: 50,
  });

  if (stuck.length === 0) return 0;

  const result = await prisma.leadDiscoveryJob.updateMany({
    where: { id: { in: stuck.map((j) => j.id) }, status: 'RUNNING' },
    data: { status: 'FAILED', error: 'Recovered: stuck in RUNNING state' },
  });

  return result.count;
}

export async function recoverStuckVerificationJobs(now: Date = new Date()): Promise<number> {
  const threshold = new Date(now.getTime() - STUCK_THRESHOLD_MS);
  const stuck = await prisma.emailVerificationJob.findMany({
    where: { status: 'RUNNING', updatedAt: { lt: threshold } },
    select: { id: true },
    take: 50,
  });

  if (stuck.length === 0) return 0;

  const result = await prisma.emailVerificationJob.updateMany({
    where: { id: { in: stuck.map((j) => j.id) }, status: 'RUNNING' },
    data: { status: 'FAILED', error: 'Recovered: stuck in RUNNING state' },
  });

  return result.count;
}

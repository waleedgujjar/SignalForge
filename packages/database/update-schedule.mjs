import { PrismaClient } from './src/generated/prisma/client.js';

const prisma = new PrismaClient();
const now = new Date();
const result = await prisma.sendingJob.updateMany({
  where: { campaignId: 'cmvcu5y7m000kcwhozhni2spk', status: 'SCHEDULED' },
  data: { scheduledAt: now }
});
console.log('Updated', result.count, 'jobs to scheduledAt:', now.toISOString());
await prisma.$disconnect();

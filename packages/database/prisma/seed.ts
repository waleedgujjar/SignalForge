import { config } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { hashPassword } from '@signalforge/auth';
import { PrismaClient } from '../src/generated/prisma/client.js';

config({ path: resolve(process.cwd(), '../../.env') });
config({ path: resolve(process.cwd(), '.env') });

export const ADMIN_SEED = {
  email: 'admin@signalforge.local',
  password: 'SignalForge1!',
  name: 'SignalForge Admin',
  workspaceName: 'SignalForge Admin',
  workspaceSlug: 'signalforge-admin',
} as const;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const existing = await prisma.user.findUnique({
      where: { email: ADMIN_SEED.email },
    });

    if (existing) {
      console.log(`Admin user already exists: ${ADMIN_SEED.email}`);
      return;
    }

    const user = await prisma.user.create({
      data: {
        email: ADMIN_SEED.email,
        passwordHash: hashPassword(ADMIN_SEED.password),
        name: ADMIN_SEED.name,
        emailVerifiedAt: new Date(),
        onboardingCompletedAt: new Date(),
      },
    });

    await prisma.workspace.create({
      data: {
        name: ADMIN_SEED.workspaceName,
        slug: ADMIN_SEED.workspaceSlug,
        onboardingMeta: { primaryUseCase: 'SALES_OUTREACH', seeded: true },
        members: {
          create: {
            userId: user.id,
            role: 'OWNER',
          },
        },
      },
    });

    console.log('Created admin account');
    console.log(`Email: ${ADMIN_SEED.email}`);
    console.log('Password: [see ADMIN_SEED in seed.ts]');
    console.log(`Workspace: ${ADMIN_SEED.workspaceName}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

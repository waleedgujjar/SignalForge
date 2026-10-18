import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/database/src/generated/prisma/client.js';
import { createHash, randomBytes } from 'node:crypto';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://signalforge:signalforge@localhost:5435/signalforge_perf?schema=public';

const pool = new Pool({ connectionString: DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(`${salt}:${password}`).digest('hex');
  return `sha256:${salt}:${hash}`;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const BATCH_SIZE = 500;
const LEAD_COUNT = 5000;
const CAMPAIGN_COUNT = 3;
const CAMPAIGN_LEADS_PER_CAMPAIGN = 3334;
const DELIVERY_EVENT_COUNT = 20000;
const CONVERSATION_COUNT = 500;
const ENRICHMENT_COUNT = 200;
const MAILBOX_COUNT = 5;

const STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'NURTURING', 'CONVERTED', 'LOST'] as const;
const SOURCES = ['IMPORT', 'MANUAL', 'DISCOVERY', 'API'] as const;
const INDUSTRIES = ['Technology', 'Healthcare', 'Finance', 'Manufacturing', 'Education', 'Retail', 'Energy', 'Real Estate'];
const COUNTRIES = ['US', 'UK', 'CA', 'DE', 'FR', 'AU', 'JP', 'BR'];
const FIRST_NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Hank', 'Ivy', 'Jack', 'Karen', 'Leo', 'Mia', 'Nate', 'Olivia'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
const COMPANIES = ['Acme Corp', 'Globex Inc', 'Initech', 'Umbrella Co', 'Cyberdyne', 'Stark Industries', 'Wayne Enterprises', 'Oscorp', 'LexCorp', 'Wonka Industries'];
const EVENT_TYPES = ['SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED'] as const;
const CAMPAIGN_LEAD_STATUSES = ['PENDING', 'ACTIVE', 'COMPLETED', 'STOPPED', 'REPLIED'] as const;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function padId(prefix: string, n: number, width = 4): string {
  return `${prefix}${String(n).padStart(width, '0')}`;
}

async function seed() {
  console.log('Seeding performance test data...');
  const start = Date.now();

  // 1. Workspace
  console.log('  Creating workspace...');
  const workspace = await prisma.workspace.create({
    data: {
      id: 'perf-ws-001',
      name: 'Performance Test Workspace',
      slug: `perf-test-${Date.now()}`,
    },
  });

  // 2. User + Session
  console.log('  Creating user + session...');
  const rawToken = randomBytes(32).toString('hex');
  const user = await prisma.user.create({
    data: {
      id: 'perf-user-001',
      email: 'perftest@signalforge.test',
      passwordHash: hashPassword('PerfTest123!@#Secure'),
      name: 'Perf Tester',
    },
  });

  await prisma.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role: 'ADMIN',
    },
  });

  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawToken),
      activeWorkspaceId: workspace.id,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  console.log(`  Session token for k6: ${rawToken}`);

  // 3. Mailboxes
  console.log(`  Creating ${MAILBOX_COUNT} mailboxes...`);
  await prisma.mailbox.createMany({
    data: Array.from({ length: MAILBOX_COUNT }, (_, i) => ({
      id: padId('perf-mailbox-', i + 1, 3),
      workspaceId: workspace.id,
      email: `sender${i + 1}@perftest.signalforge.test`,
      name: `Sender ${i + 1}`,
      provider: 'SMTP' as const,
      smtpHost: 'localhost',
      smtpPort: 1025,
      smtpUser: `sender${i + 1}`,
      smtpPass: 'encrypted:test',
      dailyLimit: 100,
      status: 'CONNECTED' as const,
    })),
  });

  // 4. Leads
  console.log(`  Creating ${LEAD_COUNT} leads...`);
  for (let batch = 0; batch < LEAD_COUNT; batch += BATCH_SIZE) {
    const size = Math.min(BATCH_SIZE, LEAD_COUNT - batch);
    await prisma.lead.createMany({
      data: Array.from({ length: size }, (_, i) => {
        const idx = batch + i + 1;
        const firstName = pick(FIRST_NAMES);
        const lastName = pick(LAST_NAMES);
        const company = pick(COMPANIES);
        const domain = company.toLowerCase().replace(/\s+/g, '') + '.com';
        return {
          id: padId('perf-lead-', idx),
          workspaceId: workspace.id,
          email: `lead${idx}@${domain}`,
          firstName,
          lastName,
          fullName: `${firstName} ${lastName}`,
          company,
          companyDomain: domain,
          title: `${pick(['CEO', 'CTO', 'VP', 'Director', 'Manager'])}`,
          phone: `+1${String(2000000000 + idx)}`,
          industry: pick(INDUSTRIES),
          country: pick(COUNTRIES),
          website: `https://${domain}`,
          status: pick(STATUSES),
          source: pick(SOURCES),
        };
      }),
    });
    process.stdout.write(`    ${Math.min(batch + BATCH_SIZE, LEAD_COUNT)}/${LEAD_COUNT}\r`);
  }
  console.log('');

  // 5. Campaigns
  console.log(`  Creating ${CAMPAIGN_COUNT} campaigns...`);
  for (let i = 1; i <= CAMPAIGN_COUNT; i++) {
    await prisma.campaign.create({
      data: {
        id: padId('perf-camp-', i, 3),
        workspaceId: workspace.id,
        name: `Perf Campaign ${i}`,
        status: 'ACTIVE',
        steps: {
          create: [
            {
              order: 1,
              type: 'EMAIL',
              subjectTemplate: `Subject for campaign ${i}`,
              bodyTemplate: `<p>Hello {{firstName}}, this is campaign ${i}</p>`,
              delayDays: 0,
            },
            {
              order: 2,
              type: 'EMAIL',
              subjectTemplate: `Follow up ${i}`,
              bodyTemplate: `<p>Following up on our previous email</p>`,
              delayDays: 3,
            },
          ],
        },
      },
    });
  }

  // 6. Campaign Leads
  console.log(`  Creating ${CAMPAIGN_COUNT * CAMPAIGN_LEADS_PER_CAMPAIGN} campaign lead enrollments...`);
  for (let c = 1; c <= CAMPAIGN_COUNT; c++) {
    const campaignId = padId('perf-camp-', c, 3);
    for (let batch = 0; batch < CAMPAIGN_LEADS_PER_CAMPAIGN; batch += BATCH_SIZE) {
      const size = Math.min(BATCH_SIZE, CAMPAIGN_LEADS_PER_CAMPAIGN - batch);
      await prisma.campaignLead.createMany({
        data: Array.from({ length: size }, (_, i) => {
          const leadIdx = batch + i + 1;
          return {
            campaignId,
            leadId: padId('perf-lead-', leadIdx),
            status: pick(CAMPAIGN_LEAD_STATUSES),
            currentStepOrder: Math.random() > 0.5 ? 1 : 2,
          };
        }),
        skipDuplicates: true,
      });
      process.stdout.write(`    Campaign ${c}: ${Math.min(batch + BATCH_SIZE, CAMPAIGN_LEADS_PER_CAMPAIGN)}/${CAMPAIGN_LEADS_PER_CAMPAIGN}\r`);
    }
    console.log('');
  }

  // 7. Email Delivery Events
  console.log(`  Creating ${DELIVERY_EVENT_COUNT} delivery events...`);
  const now = Date.now();
  for (let batch = 0; batch < DELIVERY_EVENT_COUNT; batch += BATCH_SIZE) {
    const size = Math.min(BATCH_SIZE, DELIVERY_EVENT_COUNT - batch);
    await prisma.emailDeliveryEvent.createMany({
      data: Array.from({ length: size }, (_, i) => {
        const idx = batch + i + 1;
        const daysAgo = Math.floor(Math.random() * 90);
        return {
          workspaceId: workspace.id,
          campaignId: padId('perf-camp-', ((idx % CAMPAIGN_COUNT) + 1), 3),
          eventType: pick(EVENT_TYPES),
          occurredAt: new Date(now - daysAgo * 24 * 60 * 60 * 1000),
          bounceType: null,
          rawPayload: {},
        };
      }),
    });
    process.stdout.write(`    ${Math.min(batch + BATCH_SIZE, DELIVERY_EVENT_COUNT)}/${DELIVERY_EVENT_COUNT}\r`);
  }
  console.log('');

  // 8. Conversations
  console.log(`  Creating ${CONVERSATION_COUNT} conversations...`);
  for (let batch = 0; batch < CONVERSATION_COUNT; batch += BATCH_SIZE) {
    const size = Math.min(BATCH_SIZE, CONVERSATION_COUNT - batch);
    await prisma.conversation.createMany({
      data: Array.from({ length: size }, (_, i) => {
        const idx = batch + i + 1;
        const campaignLeadIdx = idx;
        return {
          workspaceId: workspace.id,
          leadId: padId('perf-lead-', idx),
          campaignId: padId('perf-camp-', ((idx % CAMPAIGN_COUNT) + 1), 3),
          classification: pick(['INTERESTED', 'NOT_INTERESTED', 'OUT_OF_OFFICE', 'UNSUBSCRIBE', 'OTHER'] as const),
        };
      }),
    });
    process.stdout.write(`    ${Math.min(batch + BATCH_SIZE, CONVERSATION_COUNT)}/${CONVERSATION_COUNT}\r`);
  }
  console.log('');

  // 9. Lead Enrichments
  console.log(`  Creating ${ENRICHMENT_COUNT} enrichments...`);
  await prisma.leadEnrichment.createMany({
    data: Array.from({ length: ENRICHMENT_COUNT }, (_, i) => ({
      workspaceId: workspace.id,
      leadId: padId('perf-lead-', i + 1),
      provider: 'MANUAL' as const,
      companyProfile: {
        name: pick(COMPANIES),
        size: pick(['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+']),
        industry: pick(INDUSTRIES),
        founded: 2000 + Math.floor(Math.random() * 24),
        revenue: `$${Math.floor(Math.random() * 100)}M`,
      },
    })),
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('');
  console.log(`=== Seed complete in ${elapsed}s ===`);
  console.log(`  Workspace: ${workspace.id}`);
  console.log(`  User: ${user.email}`);
  console.log(`  Leads: ${LEAD_COUNT}`);
  console.log(`  Campaign enrollments: ${CAMPAIGN_COUNT * CAMPAIGN_LEADS_PER_CAMPAIGN}`);
  console.log(`  Delivery events: ${DELIVERY_EVENT_COUNT}`);
  console.log(`  Conversations: ${CONVERSATION_COUNT}`);
  console.log(`  Enrichments: ${ENRICHMENT_COUNT}`);
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

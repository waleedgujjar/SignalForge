# Database

## Package

Database access is centralized in `@signalforge/database` (`packages/database`).

- Prisma ORM
- PostgreSQL 16
- Single shared client for API and workers

## M0 schema

M0 initializes Prisma with datasource configuration only. No product models yet.

Connection URLs are configured in [`prisma.config.ts`](../packages/database/prisma.config.ts) (Prisma 7). The schema file defines provider only.

Health checks use:

```sql
SELECT 1
```

## Planned entities (M1+)

Initial product schema will include:

- User, Workspace, WorkspaceMember, Role
- Domain, Mailbox, MailboxCredential
- Company, Contact, Lead, LeadList, LeadTag
- ICP, LeadScore, LeadResearch
- Campaign, CampaignStep, CampaignLead
- Email, EmailThread, EmailEvent
- Suppression, Unsubscribe, Bounce
- WarmupProfile, WarmupEvent, MailboxHealth, DomainHealth
- SendingPolicy, RateLimit
- AIJob, AIUsage
- Notification, AuditLog, OAuthAccount, Integration

## Migrations

```bash
pnpm db:generate
pnpm db:migrate
```

Local database via Docker Compose:

```bash
docker compose up -d
```

## Decisions

See [ADR-005](decisions/005-prisma-in-shared-package.md).

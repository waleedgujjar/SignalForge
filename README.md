# SignalForge

**Turn the right signals into sales conversations.**

AI outbound sales and intelligence platform — production monorepo foundation (M0.01).

## Stack

- **Frontend:** Next.js, TypeScript, Tailwind CSS, shadcn/ui
- **API:** Fastify, TypeScript
- **Database:** PostgreSQL, Prisma
- **Queues:** Redis, BullMQ
- **Monorepo:** pnpm, Turborepo

## Getting started

### Prerequisites

- Node.js 22+
- pnpm 10+
- Docker Desktop (or Docker Engine + Compose)

### Setup

```bash
pnpm install
copy .env.example .env   # Windows
# or: cp .env.example .env

docker compose up -d
pnpm db:generate
pnpm dev
```

### URLs

| Service | URL |
|---------|-----|
| Web | http://localhost:3000 |
| API | http://localhost:4000 |
| API health | http://localhost:4000/health |
| API DB health | http://localhost:4000/health/db |
| API Redis health | http://localhost:4000/health/redis |

Optional Mailpit (local email testing):

```bash
docker compose --profile mailpit up -d
# UI: http://localhost:8025
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in dev mode |
| `pnpm build` | Build all packages and apps |
| `pnpm lint` | Lint entire monorepo |
| `pnpm typecheck` | TypeScript check |
| `pnpm test` | Run tests |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:migrate` | Run Prisma migrations |

## Repository structure

```
apps/web              Next.js frontend
apps/api              Fastify API
workers/email-worker  BullMQ worker (M0 heartbeat)
packages/*            Shared libraries
docs/                 Architecture documentation
```

## Documentation

- [Architecture](docs/architecture.md)
- [Product PRD](docs/product/AI_Outbound_Sales_OS_PRD_v1.1.pdf)

## Environment variables

See [.env.example](.env.example).

Required for local development:

- `DATABASE_URL`
- `REDIS_URL`
- `SESSION_SECRET` (min 32 chars)
- `ENCRYPTION_KEY` (min 32 chars)
- `APP_URL`, `API_URL`
- `AI_PROVIDER=mock`

## License

Proprietary — All rights reserved.

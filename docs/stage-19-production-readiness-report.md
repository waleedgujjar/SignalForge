# Stage 19: Production Hardening & Deployment Readiness — Final Report

## Executive Summary

Stage 19 prepared SignalForge for a controlled production release on a Hostinger VPS. The application is now fully containerized with Docker multi-stage builds, orchestrated via Docker Compose, fronted by an nginx reverse proxy, backed by automated database backup/restore scripts, and documented with operational runbooks. No production deployment was performed.

**Release recommendation**: Ready for production deployment once the blockers listed below are resolved.

## Deployment Architecture

```
Internet → nginx:80/443
             ├─ /          → web:3000   (Next.js standalone)
             ├─ /api/      → api:4000   (Fastify)
             └─ /health    → api:4000   (unauthenticated)

Internal:
  api ──→ postgres:5432, redis:6379
  14 workers ──→ postgres:5432, redis:6379
  google-maps-scraper (optional profile)
```

All services run in Docker containers on a single VPS, connected via a bridge network (`signalforge-net`). PostgreSQL and Redis are internal-only (no host port exposure).

## Changes Implemented

### Code Hardening

| File | Change | Risk | Verification |
|------|--------|------|-------------|
| `packages/config/src/index.ts` | Fixed `z.coerce.boolean()` bug — `"false"` string was coerced to `true` for `EMAIL_VERIFICATION_ENABLED` and `EMAIL_VERIFICATION_SMTP_ENABLED`. Replaced with existing `strictBooleanFlag()` helper. | Low — uses tested helper | typecheck + existing tests |
| `apps/api/src/server.ts` | Added graceful shutdown (SIGTERM/SIGINT → `app.close()` with 30s timeout) and startup dependency checks (DB + Redis with exponential backoff, production-only retries) | Low — additive | typecheck |
| `apps/web/next.config.ts` | Added `output: 'standalone'` for Docker deployment | Low — build config only | build succeeds |

### Containerization

| File | Purpose |
|------|---------|
| `.dockerignore` | Excludes secrets, dev artifacts, and node_modules from Docker context |
| `apps/api/Dockerfile` | Multi-stage build: deps → build → runtime. node:22-alpine, non-root user, healthcheck |
| `apps/web/Dockerfile` | Multi-stage build for Next.js standalone. NEXT_PUBLIC_API_URL as build arg |
| `workers/Dockerfile` | Single image for all 14 workers. CMD overridden per container in compose |

### Orchestration & Infrastructure

| File | Purpose |
|------|---------|
| `docker-compose.prod.yml` | Production orchestration: postgres, redis, api, web, nginx, 14 workers, optional scraper |
| `infrastructure/nginx/nginx.conf` | Main nginx config: gzip, rate limiting, client body size |
| `infrastructure/nginx/conf.d/default.conf` | Routing, security headers, proxy config, TLS placeholder |
| `infrastructure/nginx/README.md` | Full documentation of nginx configuration |

### Backup & Recovery

| File | Purpose |
|------|---------|
| `infrastructure/backup/backup-db.sh` | pg_dump via Docker, gzip, timestamped, configurable retention |
| `infrastructure/backup/restore-db.sh` | Stop app → restore → restart → verify health |
| `infrastructure/backup/README.md` | Cron setup, manual backup, restore procedure, RPO/RTO |

### Environment & Configuration

| File | Purpose |
|------|---------|
| `.env.production.example` | Complete production template with all Zod-validated vars, Docker hostnames, secret generation commands |
| `.env.example` | Added missing `PG_POOL_MAX`, `RATE_LIMIT_MAX`, `NEXT_PUBLIC_API_URL` |
| `.gitignore` | Added `.env.production.example` exception |

### CI/CD

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | Added security audit step, container-build job (main branch only) |
| `.github/workflows/deploy.yml` | Manual deployment workflow stub with placeholder steps |

### Operational Runbooks

| File | Purpose |
|------|---------|
| `docs/runbooks/deployment.md` | VPS setup, first deployment, subsequent updates, rollback |
| `docs/runbooks/operations.md` | 9 failure scenarios with diagnosis and resolution |
| `docs/runbooks/monitoring.md` | Health endpoints, cron polling, log inspection, resource monitoring |

## Production Readiness Matrix

| Area | Status | Notes |
|------|--------|-------|
| Containerization | Ready | Multi-stage Dockerfiles for all services |
| Orchestration | Ready | docker-compose.prod.yml with health checks and depends_on |
| Reverse Proxy | Ready | nginx with routing, security headers, rate limiting |
| TLS/HTTPS | Blocker | Commented-out config; requires domain + certbot on VPS |
| Graceful Shutdown | Ready | API (Fastify close) + all 14 workers (existing BullMQ shutdown) |
| Startup Checks | Ready | DB + Redis verified before accepting traffic |
| Database Backup | Ready | Automated script with retention; cron documented |
| Off-site Backup | Blocker | Scripts store locally only; rsync/rclone documented |
| CI Quality Gate | Ready | lint + typecheck + test + build + security audit + container build |
| CD Pipeline | Partial | Stub workflow; requires VPS secrets in GitHub |
| Health Checks | Ready | 5 endpoints (/health, /health/db, /health/redis, /health/queues, /health/ai) |
| Operational Docs | Ready | Deployment, operations, and monitoring runbooks |
| Environment Config | Ready | Production template with all variables documented |
| Security Headers | Ready | X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy |
| Non-root Containers | Ready | All app containers run as `node` user (UID 1000) |
| Secret Management | Partial | .env.production file; no vault integration |
| Log Aggregation | Deferred | JSON logs available; no centralized collection |
| Metrics/Alerting | Deferred | Cron health checks documented; no Prometheus/Grafana |
| DNS | Blocker | Requires domain configuration pointing to VPS |
| VPS Access | Blocker | Requires Hostinger VPS provisioned with Docker |

## Test Evidence

| Check | Result |
|-------|--------|
| `pnpm typecheck` | 63/63 tasks passed |
| `pnpm lint` | 62/63 passed (4 pre-existing unused-import errors in integration test files — not introduced by Stage 19) |
| `pnpm test` | All test suites pass (transient Turborepo ordering issue resolved on rerun) |
| `pnpm build` | All packages build successfully |

Pre-existing lint issues (not related to Stage 19):
- `apps/api/src/__integration__/cross-cutting/error-handling.test.ts` — unused `makeLead`
- `apps/api/src/__integration__/cross-cutting/idempotency.test.ts` — unused `makeSuppression`
- `apps/api/src/__integration__/cross-cutting/rbac.test.ts` — unused `makeLead`
- `apps/api/src/__integration__/workflows/lead-lifecycle.test.ts` — unused `addMember`

## Critical Blockers for Production Release

1. **TLS Certificate** — nginx HTTPS server block is prepared but commented out. Requires: domain name, DNS A record pointing to VPS IP, certbot certificate generation on VPS.

2. **DNS Configuration** — `APP_URL` in `.env.production` needs a real domain. Cannot be completed without domain purchase/configuration.

3. **VPS Provisioning** — Hostinger VPS must be provisioned with Docker Engine, Docker Compose, and SSH access. Deployment runbook documents the full setup process.

4. **Off-site Backups** — Backup scripts store locally on the VPS. A VPS failure loses both data and backups. Recommended: rsync to a remote server or rclone to cloud storage (documented in backup README).

5. **GitHub Secrets** — CD workflow requires `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, and `DEPLOY_PATH` configured in GitHub repository settings.

## Files Created/Modified

**New files (16)**:
`.dockerignore`, `apps/api/Dockerfile`, `apps/web/Dockerfile`, `workers/Dockerfile`, `docker-compose.prod.yml`, `infrastructure/nginx/nginx.conf`, `infrastructure/nginx/conf.d/default.conf`, `infrastructure/backup/backup-db.sh`, `infrastructure/backup/restore-db.sh`, `infrastructure/backup/README.md`, `.env.production.example`, `.github/workflows/deploy.yml`, `docs/runbooks/deployment.md`, `docs/runbooks/operations.md`, `docs/runbooks/monitoring.md`, `docs/stage-19-production-readiness-report.md`

**Modified files (6)**:
`packages/config/src/index.ts`, `apps/api/src/server.ts`, `apps/web/next.config.ts`, `.env.example`, `.gitignore`, `.github/workflows/ci.yml`, `infrastructure/nginx/README.md`

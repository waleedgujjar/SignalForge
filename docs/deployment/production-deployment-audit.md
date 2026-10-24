# SignalForge — Production Deployment Audit Report

**Date:** 2026-10-18
**Target:** Hostinger VPS (IP 2.25.122.205, Ubuntu 26.04, 4GB RAM)
**Frontend:** Vercel (Next.js 15)
**Backend:** Docker Compose on shared VPS (Caddy + 3 existing sites)

---

## 1. Repository Architecture and Service Inventory

### Monorepo Structure

| Layer | Technology | Location |
|-------|-----------|----------|
| Build | pnpm workspaces + Turborepo | Root `pnpm-workspace.yaml` |
| API | Fastify 4 + TypeScript | `apps/api/` |
| Frontend | Next.js 15 + React | `apps/web/` |
| Database ORM | Prisma (84 models, 28 migrations) | `packages/database/` |
| Queue System | BullMQ + Redis | `packages/queue/` |
| Auth | Cookie-based sessions (scrypt + SHA-256) | `packages/auth/` |

### Docker Services (docker-compose.prod.yml)

| Service | Image | Memory Limit | Purpose |
|---------|-------|-------------|---------|
| postgres | postgres:16-alpine | 1,024 MB | Primary database |
| redis | redis:7-alpine | 512 MB | Queue broker + cache |
| api | signalforge-api:latest (custom) | 512 MB | Fastify API server (port 4000) |
| nginx | nginx:1.27-alpine | 64 MB | Reverse proxy + rate limiting |
| email-worker | signalforge-workers:latest | 128 MB | Sends campaign emails |
| scheduler-worker | " | 128 MB | 30s tick, 5min recovery, 6hr cleanup |
| campaign-enrollment-worker | " | 128 MB | Bulk lead enrollment |
| workflow-worker | " | 128 MB | Automation workflow execution |
| verification-worker | " | 128 MB | Email verification (DNS/SMTP) |
| warmup-worker | " | 128 MB | Mailbox warmup sends |
| inbound-worker | " | 128 MB | IMAP inbox sync |
| inbox-reply-worker | " | 128 MB | Reply queue processing |
| deliverability-worker | " | 128 MB | Health scoring + alerts |
| analytics-worker | " | 128 MB | Analytics aggregation |
| enrichment-worker | " | 128 MB | Lead enrichment (AI-powered) |
| website-worker | " | 128 MB | Website intelligence crawl + AI |
| lead-discovery-worker | " | 128 MB | Lead discovery pipeline |
| lead-research-worker | " | 128 MB | LinkedIn/web research |
| google-maps-scraper | gosom/google-maps-scraper:v1.15.0 | 256 MB | **Optional** (profile: scraper) |

**Total: 17 services + 1 optional = ~3,776 MB (without scraper), ~4,032 MB (with scraper)**

### Shared Packages (25 total)

`ai`, `allocation`, `analytics`, `auth`, `automations`, `campaigns`, `config`, `database`, `deliverability`, `email`, `eslint-config`, `inbound`, `inbox`, `integrations`, `lead-discovery`, `lead-research`, `mailboxes`, `queue`, `sending`, `shared`, `typescript-config`, `validation`, `verification`, `warmup`, `website-scanner`

### Docker Images Built

1. **signalforge-api:latest** — 3-stage build (deps → build → runtime), node:22-alpine, `USER node`, `EXPOSE 4000`, health check via wget to `/health`
2. **signalforge-workers:latest** — 3-stage build, single shared image, CMD overridden per service in compose

### BullMQ Queues (23 total)

`email-send`, `email-verify`, `email-verification-batch`, `lead-enrichment`, `website-analysis`, `lead-discovery`, `lead-research`, `campaign-enrollment`, `workflow-execution`, `workflow-event`, `warmup-send`, `inbound-sync`, `inbox-reply`, `analytics-snapshot`, `deliverability-check`, `deliverability-alert`, `import-processing`, `email-classification`, `lead-scoring`, `suppression-check`, `sending-dispatch`, `follow-up-seed`, `smart-import`

---

## 2. All API Integrations and Implementation Status

### Fully Implemented (Production Ready)

| Integration | Package | How It Works |
|-------------|---------|-------------|
| **SMTP (campaign emails)** | `@signalforge/email` | User-configured mailboxes with encrypted passwords. SMTP rotation, pool allocation, warmup. Sends real emails through 17-step pipeline. |
| **SMTP (system emails)** | `apps/api/src/lib/system-email.ts` | Password resets + email verification. Uses env-configured SMTP. Gracefully skips if not configured. |
| **IMAP (inbound sync)** | `@signalforge/inbound` | Mailbox inbox sync + AI email classification. Connection testing. |
| **Google OAuth** | `@signalforge/integrations` | Full OAuth2 flow for Google Drive. HMAC-signed state with 10-min expiry. Token encryption at rest. |
| **Google Drive API** | `@signalforge/integrations` | Folder/file listing, file download, lead import from sheets. |
| **AI / LLM** | `@signalforge/ai` | OpenAI SDK format. Configurable provider (mock/openai). Reply composition, deliverability analysis, analytics analysis, email classification. Advisory only — never modifies sending. |
| **Email verification** | `@signalforge/verification` | Real DNS MX + SMTP verification. Batch processing via BullMQ. |
| **DNS health checks** | Node.js `dns/promises` | SPF/DKIM/DMARC/MX lookups for domain health. |

### Feature-Flagged (Disabled by Default)

| Integration | Flag | Default | Notes |
|-------------|------|---------|-------|
| **LinkedIn research** | `LINKEDIN_RESEARCH_ENABLED` | `false` | Returns 501 when disabled. Actual calls in worker. |
| **Web research** | `WEB_RESEARCH_ENABLED` | `false` | Uses Jina Reader for web scraping. |
| **Google Maps scraper** | `GOOGLE_MAPS_SCRAPER_ENABLED` | `false` | Self-hosted gosom/google-maps-scraper. Requires `--profile scraper`. |

### Not Implemented / Placeholder

| Item | Status |
|------|--------|
| **GitHub Actions deploy.yml** | Placeholder — all steps `exit 1` |
| **Stripe/payment webhooks** | Not present. No payment integration. |
| **SNS/SQS/external webhooks** | Not present. |

### Unauthenticated Endpoints (12 total)

`GET /`, `GET /health/`, `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/session`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/verify-email`, `GET /integrations/callback` (HMAC-signed state), `GET /unsubscribe` (HMAC token), `POST /unsubscribe` (HMAC token)

### Total API Endpoints: ~190+ across 25 route files

---

## 3. FreeLLMAPI Deployment Requirements

**Implementation**: Standard OpenAI SDK (`new OpenAI({apiKey, baseURL})`). Provider is swappable via env vars.

**Required env vars for FreeLLMAPI:**
```
AI_PROVIDER=openai
OPENAI_BASE_URL=https://your-freellmapi-endpoint/v1
OPENAI_API_KEY=<your-freellmapi-key>
OPENAI_MODEL=auto
```

**No separate deployment needed.** FreeLLMAPI is an external service. SignalForge connects to it as a client. The `OPENAI_BASE_URL` env var points to any OpenAI-compatible endpoint (FreeLLMAPI, OpenRouter, etc.).

**OpenRouter compatibility headers**: Already included — `HTTP-Referer` and `X-Title` headers are set in `packages/ai/src/openai-provider.ts`.

**Without AI configured**: `AI_PROVIDER=mock` (the default) provides fully functional deterministic results for all AI methods. The application works completely without a real AI provider.

**AI usage in the application** (advisory only — never modifies sending behavior):
- Reply composition (inbox)
- Deliverability analysis
- Analytics insights
- Email classification during inbox sync
- Lead enrichment ICP scoring (in worker)
- Website intelligence analysis (in worker)

---

## 4. Google Places/Maps Deployment Requirements

**Implementation**: Self-hosted `gosom/google-maps-scraper` container. **No Google API key needed.**

**How it works:**
- Container runs a headless browser scraper behind a REST API
- SignalForge communicates via `POST /api/v1/jobs` to create scraper jobs, polls status, downloads CSV results
- Behind Docker Compose `scraper` profile — only starts when explicitly requested

**Required env vars:**
```
GOOGLE_MAPS_SCRAPER_ENABLED=true
GOOGLE_MAPS_SCRAPER_URL=http://google-maps-scraper:8080
GOOGLE_MAPS_SCRAPER_MAX_TIME=120
GOOGLE_MAPS_SCRAPER_DEPTH=1
```

**Version note**: dev compose uses `v1.18.1`, prod compose uses `v1.15.0`. Recommend updating prod to match dev.

**Memory**: 256 MB limit. Total with scraper: ~4,032 MB. **Not recommended for 4GB VPS with 3 existing sites.** Enable only if you upgrade to 8GB RAM.

**To deploy without scraper**: Simply don't add `--profile scraper` to docker compose commands. The feature is fully isolated.

---

## 5. Required Environment Variables (Names Only)

### Must Set (6 required by schema validation)

| Variable | Notes |
|----------|-------|
| `APP_URL` | Vercel frontend URL |
| `API_URL` | Internal: `http://api:4000` |
| `DATABASE_URL` | Contains password |
| `REDIS_URL` | Contains password |
| `SESSION_SECRET` | Min 32 chars |
| `ENCRYPTION_KEY` | Min 32 chars |

### Must Set (infrastructure secrets)

| Variable | Notes |
|----------|-------|
| `POSTGRES_USER` | Default: `signalforge` |
| `POSTGRES_PASSWORD` | Generate with `openssl rand -base64 32` |
| `POSTGRES_DB` | Default: `signalforge` |
| `REDIS_PASSWORD` | Must match password in `REDIS_URL` |

### Should Set (operational)

| Variable | Default | Notes |
|----------|---------|-------|
| `NODE_ENV` | — | Set to `production` |
| `LOG_LEVEL` | `info` | Set to `warn` for production |
| `RATE_LIMIT_MAX` | `200` | Per-minute global rate limit |
| `PG_POOL_MAX` | `25` | Postgres connection pool |

### Optional (feature-dependent)

| Category | Variables |
|----------|----------|
| AI | `AI_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` |
| Microsoft OAuth | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` |
| System SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME` |
| Google Maps | `GOOGLE_MAPS_SCRAPER_ENABLED`, `GOOGLE_MAPS_SCRAPER_URL` |
| LinkedIn | `LINKEDIN_RESEARCH_ENABLED` + provider vars |
| Web Research | `WEB_RESEARCH_ENABLED` + related vars |
| Email Verification | `EMAIL_VERIFICATION_ENABLED`, `EMAIL_VERIFICATION_SMTP_ENABLED`, etc. |
| Email Discovery | `EMAIL_DISCOVERY_ENABLED` + related vars |
| Frontend | `NEXT_PUBLIC_API_URL` (build-time, set to `/api`) |

**Total: 6 required + 4 infrastructure + 4 operational + ~44 optional = ~58 variables**

See `.env.production.example` for the complete template with defaults and documentation.

---

## 6. Missing Credentials or Manual Setup

### You Must Provide Before Deployment

| Credential | Where to Get It | Used By |
|-----------|----------------|---------|
| **Domain name** (e.g., `signalforge.yourdomain.com`) | Domain registrar | DNS A record → VPS IP |
| **API subdomain** (e.g., `api.signalforge.yourdomain.com`) | Domain registrar | Caddy reverse proxy |
| **Vercel account** | vercel.com | Frontend hosting |
| **SMTP credentials** for system emails | Your email provider | Password resets, email verification |
| **Google OAuth credentials** (optional) | Google Cloud Console | Google Drive integration |
| **FreeLLMAPI key** (optional) | Your FreeLLMAPI instance | AI features |

### Generated at Deploy Time (Do NOT Share)

| Secret | Generation Command |
|--------|-------------------|
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `ENCRYPTION_KEY` | `openssl rand -base64 48` |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` |
| `REDIS_PASSWORD` | `openssl rand -base64 32` |

### Manual Setup Steps After Deployment

1. **DNS**: Create A record for API subdomain → VPS IP (2.25.122.205)
2. **Caddy**: Add reverse proxy block for SignalForge API (see Section 8)
3. **Vercel**: Connect GitHub repo, set 3 env vars (`API_URL`, `APP_URL`, `NEXT_PUBLIC_API_URL`)
4. **First user**: Sign up via the frontend, or use seed command
5. **Mailbox**: Add at least one SMTP mailbox in the app to send emails
6. **Google OAuth** (optional): Create OAuth2 credentials in Google Cloud Console, set redirect URI to `https://api.yourdomain.com/integrations/callback`

---

## 7. Proposed Isolated Docker Architecture

### CRITICAL ISSUE: Port Conflict

**Current state**: `docker-compose.prod.yml` nginx exposes ports `80:80` and `443:443` to the host.
**Problem**: Caddy already binds ports 80 and 443 on this VPS for the 3 existing websites.
**Result**: Docker will fail to start, or will steal ports from Caddy, taking down existing sites.

### Proposed Architecture

```
Internet
    │
    ▼
┌───────────────────────────────────────────────────────┐
│  Caddy (host, ports 80/443)                           │
│  ├── view-igstory.com      → /opt/ig-viewer           │
│  ├── in-downloader.com     → /opt/in-downloader        │
│  ├── thesavefrom.com       → /opt/thesavefrom          │
│  └── api.yourdomain.com    → localhost:4080 (NEW)      │
└───────────────────────────────────────────────────────┘
    │
    ▼ (localhost:4080)
┌───────────────────────────────────────────────────────┐
│  SignalForge Docker Network (signalforge-net)          │
│                                                       │
│  nginx:4080 ──► api:4000 ──► postgres:5432            │
│                    │                                   │
│                    ├──► redis:6379                      │
│                    │                                   │
│                 14 workers (BullMQ)                     │
└───────────────────────────────────────────────────────┘
```

### Key Changes

1. **nginx ports**: Change from `80:80` / `443:443` to `4080:80` (internal only)
2. **Remove TLS from nginx**: Caddy handles TLS termination
3. **Caddy snippet**: Reverse proxy `api.yourdomain.com` → `localhost:4080`
4. **Isolation**: SignalForge runs on its own Docker bridge network, no port conflicts
5. **Location**: `/opt/signalforge` (parallel to existing sites)

### Memory Budget on 4GB VPS

| Component | Memory |
|-----------|--------|
| Existing sites (3 containers + Caddy) | ~500-800 MB (estimated) |
| OS + system processes | ~300-500 MB |
| **Available for SignalForge** | **~2,700-3,200 MB** |
| **SignalForge total** | **~3,776 MB** |
| **Deficit** | **~576-1,076 MB** |

**Recommendation**: On a 4GB VPS with 3 existing sites, you must either:

**Option A** — Disable non-essential workers (saves ~768 MB):
- Disable: warmup-worker, lead-research-worker, lead-discovery-worker, website-worker, analytics-worker, enrichment-worker
- Keep: email-worker, scheduler-worker, campaign-enrollment-worker, workflow-worker, verification-worker, inbound-worker, inbox-reply-worker, deliverability-worker
- Total: ~3,008 MB (fits with ~200 MB headroom)

**Option B** — Upgrade VPS to 8GB RAM (recommended for full feature set)

---

## 8. Files That Need to Be Created or Changed

### Files to CHANGE

#### 1. `docker-compose.prod.yml` — Remove host port 80/443

```yaml
# CHANGE THIS:
  nginx:
    ports:
      - '80:80'      # CONFLICTS WITH CADDY
      - '443:443'    # CONFLICTS WITH CADDY

# TO THIS:
  nginx:
    ports:
      - '4080:80'    # Internal only, Caddy proxies to here
    # Remove 443 — Caddy handles TLS
```

Also remove the `certbot_webroot` volume (Caddy handles ACME challenges):
```yaml
# REMOVE from volumes:
  certbot_webroot:

# REMOVE from nginx volumes:
  - certbot_webroot:/var/www/certbot:ro
  # - /etc/letsencrypt:/etc/letsencrypt:ro
```

#### 2. `infrastructure/nginx/conf.d/default.conf` — Remove TLS block and certbot

Remove the commented-out HTTPS server block entirely. Remove the ACME challenge location. The HTTP server block stays as-is (nginx handles rate limiting and proxying within Docker).

### Files to CREATE

#### 3. `infrastructure/caddy/signalforge.caddyfile` (new)

```caddyfile
api.yourdomain.com {
    reverse_proxy localhost:4080
}
```

This snippet gets appended to or included from the host Caddy config. Caddy automatically provisions TLS via Let's Encrypt.

#### 4. `infrastructure/docker-compose.prod.lean.yml` (new, optional)

A lean compose override that disables non-essential workers for 4GB VPS deployments. Not strictly needed — you can also comment out services in the main file.

### Files That Are READY (No Changes Needed)

| File | Status |
|------|--------|
| `apps/api/Dockerfile` | Production-ready (3-stage, USER node, healthcheck) |
| `workers/Dockerfile` | Production-ready (3-stage, shared image) |
| `vercel.json` | Ready for Vercel deployment |
| `.env.production.example` | Complete template with all variables |
| `.gitignore` | Properly excludes `.env`, `.claude/`, debug artifacts |
| `packages/config/src/index.ts` | Schema validation with sensible defaults |

---

## 9. Database Backup and Migration Strategy

### Migrations

- **28 Prisma migrations** exist in `packages/database/prisma/migrations/`
- Migration command: `docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy --schema packages/database/prisma/schema.prisma`
- This runs all pending migrations in order. It is idempotent (safe to re-run).
- Prisma tracks applied migrations in the `_prisma_migrations` table.

### Pre-Migration Backup

```bash
# Before any migration, backup the database
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U signalforge signalforge | gzip > /opt/signalforge/backups/pre-migration-$(date +%Y%m%d-%H%M%S).sql.gz
```

### Daily Automated Backup

```bash
# Add to crontab (run as root or docker-capable user)
0 3 * * * docker compose -f /opt/signalforge/docker-compose.prod.yml exec -T postgres pg_dump -U signalforge signalforge | gzip > /opt/signalforge/backups/daily-$(date +\%Y\%m\%d).sql.gz

# Keep 7 days of backups
10 3 * * * find /opt/signalforge/backups/ -name "daily-*.sql.gz" -mtime +7 -delete
```

### Restore from Backup

```bash
# Stop all workers first to prevent queue processing during restore
docker compose -f docker-compose.prod.yml stop email-worker scheduler-worker campaign-enrollment-worker workflow-worker verification-worker warmup-worker inbound-worker inbox-reply-worker deliverability-worker analytics-worker enrichment-worker website-worker lead-discovery-worker lead-research-worker

# Restore
gunzip < /opt/signalforge/backups/daily-YYYYMMDD.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U signalforge signalforge

# Restart workers
docker compose -f docker-compose.prod.yml start
```

### Redis Persistence

Redis is configured with `--appendonly yes` in docker-compose.prod.yml. Queue state survives Redis restarts. Data stored in `redis_data` named volume.

---

## 10. Exact Deployment and Rollback Commands (For Approval)

### First-Time Deployment Sequence

**Step 1 — Prepare VPS directory**
```bash
sudo mkdir -p /opt/signalforge/backups
sudo chown $USER:$USER /opt/signalforge
cd /opt/signalforge
git clone https://github.com/waleedgujjar/SignalForge.git .
```

**Step 2 — Create production environment file**
```bash
cp .env.production.example .env.production
# Edit .env.production — fill in all generated secrets and configuration
nano .env.production
```

**Step 3 — Apply docker-compose.prod.yml port fix** (see Section 8, Item 1)
```bash
# Change nginx ports from 80:80/443:443 to 4080:80
nano docker-compose.prod.yml
```

**Step 4 — Build and start services**
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

**Step 5 — Run database migrations**
```bash
docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
```

**Step 6 — Verify all containers are healthy**
```bash
docker compose -f docker-compose.prod.yml ps
curl http://localhost:4080/health
```

**Step 7 — Add SignalForge to Caddy** (on the host, NOT inside Docker)
```bash
# Add to existing Caddyfile (location depends on your Caddy setup)
# Typical: /etc/caddy/Caddyfile or a conf.d include
sudo nano /etc/caddy/Caddyfile

# Append:
# api.yourdomain.com {
#     reverse_proxy localhost:4080
# }

# Reload Caddy (does NOT restart existing sites)
sudo systemctl reload caddy
```

**Step 8 — Verify external access**
```bash
curl https://api.yourdomain.com/health
# Expected: {"status":"ok","service":"signalforge-api","version":"1.0.0"}
```

### Vercel Frontend Deployment

```bash
# In Vercel dashboard:
# 1. Import GitHub repo (waleedgujjar/SignalForge)
# 2. Set environment variables:
#    API_URL = https://api.yourdomain.com (server-side)
#    APP_URL = https://yourdomain.com (server-side)
#    NEXT_PUBLIC_API_URL = /api (public)
# 3. Deploy
```

### Update Deployment

```bash
cd /opt/signalforge

# Backup database first
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U signalforge signalforge | gzip > backups/pre-update-$(date +%Y%m%d-%H%M%S).sql.gz

# Pull latest code
git pull origin main

# Rebuild and restart
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# Run any new migrations
docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy --schema packages/database/prisma/schema.prisma

# Verify
docker compose -f docker-compose.prod.yml ps
curl http://localhost:4080/health
```

### Rollback

```bash
cd /opt/signalforge

# Roll back to previous commit
git log --oneline -5   # Find the good commit
git checkout <good-commit-hash>

# Rebuild
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# If migration needs rollback:
docker compose -f docker-compose.prod.yml exec api npx prisma migrate resolve --rolled-back <migration-name>

# Or restore database from backup:
gunzip < backups/pre-update-YYYYMMDD-HHMMSS.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U signalforge signalforge
```

### Stop Everything (Emergency)

```bash
cd /opt/signalforge
docker compose -f docker-compose.prod.yml down
# Data persists in named volumes (postgres_data, redis_data)
# Existing sites on VPS are UNAFFECTED
```

### Complete Teardown (Removes Data)

```bash
cd /opt/signalforge
docker compose -f docker-compose.prod.yml down -v  # -v removes volumes = DATA LOSS
# Remove Caddy config block, then: sudo systemctl reload caddy
```

---

## 11. Risks and Mitigation

### CRITICAL Risks

| # | Risk | Impact | Mitigation |
|---|------|--------|-----------|
| 1 | **Port 80/443 conflict** | Deploying as-is will steal ports from Caddy, taking down view-igstory.com, in-downloader.com, thesavefrom.com | **MUST** change nginx ports to `4080:80` before deploying. See Section 8. |
| 2 | **Memory exhaustion on 4GB VPS** | All 17 services + 3 existing sites = ~4,576 MB on a 4GB VPS. OOM killer will start terminating containers. | Disable 6 non-essential workers (Option A in Section 7) or upgrade to 8GB. |
| 3 | **No automated TLS** (current config) | nginx config expects manual certbot + certificate mounting | Caddy handles TLS automatically. Remove certbot from the architecture entirely. |

### HIGH Risks

| # | Risk | Impact | Mitigation |
|---|------|--------|-----------|
| 4 | **Disk space** | Docker images (2 custom + postgres + redis + nginx) + database growth | Monitor disk usage. Set up daily backup rotation (keep 7 days). |
| 5 | **No monitoring** | No alerting on container crashes, OOM, disk full | Set up uptime monitoring on `/health` endpoint. Add log rotation. |
| 6 | **deploy.yml is placeholder** | All CI/CD steps `exit 1`. No automated deployment pipeline. | Manual deployment via SSH for now. Build CI/CD later. |

### MEDIUM Risks

| # | Risk | Impact | Mitigation |
|---|------|--------|-----------|
| 7 | **Google Maps scraper version mismatch** | dev: v1.18.1, prod: v1.15.0. May have different API behavior. | Update prod to v1.18.1 if enabling scraper. |
| 8 | **Redis maxmemory 384MB in 512MB container** | If BullMQ queue backlogs build up, Redis evicts keys (allkeys-lru policy). Could lose in-flight jobs. | Monitor Redis memory. Consider `noeviction` policy if queue reliability is critical. |
| 9 | **Single-node deployment** | No redundancy. If VPS goes down, everything is offline. | Acceptable for early-stage. Consider multi-node later. |

### Acceptance Tests (Run After Deployment)

```bash
# 1. API health
curl -f https://api.yourdomain.com/health
# Expected: {"status":"ok"}

# 2. Database connectivity (requires auth)
# Sign up via frontend, then use session to test:
curl -f https://api.yourdomain.com/health/db -b "sf_session=<token>"
# Expected: {"status":"ok","latencyMs":<number>}

# 3. Redis connectivity (requires auth)
curl -f https://api.yourdomain.com/health/redis -b "sf_session=<token>"
# Expected: {"status":"ok","latencyMs":<number>}

# 4. Frontend loads
curl -f -I https://yourdomain.com
# Expected: 200

# 5. Auth flow
curl -s -X POST https://api.yourdomain.com/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"TestPass123!","firstName":"Test","lastName":"User"}'
# Expected: 200 with set-cookie header

# 6. Container health
docker compose -f docker-compose.prod.yml ps
# Expected: All containers STATUS "Up" + "(healthy)"

# 7. No error logs
docker compose -f docker-compose.prod.yml logs --tail 20 api
docker compose -f docker-compose.prod.yml logs --tail 20 email-worker
# Expected: No ERROR lines

# 8. Existing sites still working
curl -f -I https://view-igstory.com/
curl -f -I https://in-downloader.com/
curl -f -I https://thesavefrom.com/
# Expected: All return 200
```

---

## Summary of Required Actions Before Deployment

| Priority | Action | Who |
|----------|--------|-----|
| **BLOCKER** | Change nginx ports in docker-compose.prod.yml (80→4080, remove 443) | I will prepare this change for your approval |
| **BLOCKER** | Choose domain/subdomain for API | You |
| **BLOCKER** | Generate 4 secrets (SESSION_SECRET, ENCRYPTION_KEY, POSTGRES_PASSWORD, REDIS_PASSWORD) | You, on VPS |
| **BLOCKER** | Create `.env.production` from template | You, on VPS |
| **CRITICAL** | Decide: disable 6 workers (4GB VPS) or upgrade to 8GB | You |
| **HIGH** | Create DNS A record for API subdomain → 2.25.122.205 | You |
| **HIGH** | Add Caddy reverse proxy block | You, on VPS |
| **HIGH** | Connect GitHub repo to Vercel + set 3 env vars | You |
| **MEDIUM** | Set up SMTP for system emails (password resets) | You |
| **MEDIUM** | Set up daily database backup cron | You, on VPS |
| **OPTIONAL** | Configure FreeLLMAPI / OpenRouter for AI features | You |
| **OPTIONAL** | Configure Google OAuth for Drive integration | You |

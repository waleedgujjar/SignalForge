# SignalForge — VPS Deployment Steps

Copy-paste commands for deploying SignalForge on your Hostinger VPS (2.25.122.205).
Run each phase in order. Verify before proceeding to the next.

**Server:** 15 GB RAM, 4 CPUs, 193 GB disk, Ubuntu 26.04, Docker 29.7.2
**Architecture:** Caddy runs inside a Docker container (ig-viewer project) on the `ig-viewer_web` network. All web-facing apps join that network so Caddy can reverse-proxy to them.

**Prerequisites:**
- SSH access to the VPS
- DNS A record: `api.websiterankerrs.tech` → `2.25.122.205`
- GitHub repo pushed: `https://github.com/waleedgujjar/SignalForge`
- Vercel frontend deployed: `https://signal-forge-tan.vercel.app`

---

## Phase 0 — Measure Current Resources

```bash
free -h
docker stats --no-stream
df -h
```

Write down: available RAM, existing container memory usage, free disk.
Existing sites use ~977 MB total. SignalForge default profile adds ~1,400-1,800 MB actual.

---

## Phase 1 — Clone and Configure

```bash
sudo mkdir -p /opt/signalforge
sudo chown $USER:$USER /opt/signalforge
git clone https://github.com/waleedgujjar/SignalForge.git /opt/signalforge
cd /opt/signalforge
mkdir -p backups
```

Generate secrets:

```bash
echo "SESSION_SECRET=$(openssl rand -base64 48)"
echo "ENCRYPTION_KEY=$(openssl rand -base64 48)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)"
echo "REDIS_PASSWORD=$(openssl rand -base64 32)"
```

Save the output. Create the env file:

```bash
cp .env.production.example .env.production
nano .env.production
```

Fill in these values in `.env.production`:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `LOG_LEVEL` | `warn` |
| `APP_URL` | `https://signal-forge-tan.vercel.app` |
| `API_URL` | `http://api:4000` |
| `DATABASE_URL` | `postgresql://signalforge:YOUR_POSTGRES_PASSWORD@postgres:5432/signalforge?schema=public` |
| `POSTGRES_USER` | `signalforge` |
| `POSTGRES_PASSWORD` | (paste the generated value) |
| `POSTGRES_DB` | `signalforge` |
| `REDIS_URL` | `redis://:YOUR_REDIS_PASSWORD@redis:6379` |
| `REDIS_PASSWORD` | (paste the generated value) |
| `SESSION_SECRET` | (paste the generated value) |
| `ENCRYPTION_KEY` | (paste the generated value) |
| `AI_PROVIDER` | `mock` (change to `openai` later if using FreeLLMAPI) |
| `RATE_LIMIT_MAX` | `200` |

**Important:** The passwords in `DATABASE_URL` and `REDIS_URL` must match `POSTGRES_PASSWORD` and `REDIS_PASSWORD` exactly.

---

## Phase 2 — Build Docker Images

```bash
cd /opt/signalforge
docker compose -f docker-compose.prod.yml --env-file .env.production build
```

This builds 2 images (API + workers). Takes 5-15 minutes depending on VPS CPU.
No containers are started. No ports are bound. Existing sites are unaffected.

Verify images were built:

```bash
docker images | grep signalforge
```

Expected: `signalforge-api` and `signalforge-workers` images listed.

---

## Phase 3 — Start Database and Redis

```bash
cd /opt/signalforge
docker compose -f docker-compose.prod.yml --env-file .env.production up -d postgres redis
```

Wait for healthy status:

```bash
docker compose -f docker-compose.prod.yml ps
```

Both should show `(healthy)`. Then run migrations:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
```

Expected: "X migrations applied" (28 migrations on first run).

---

## Phase 4 — Start API and Nginx

```bash
cd /opt/signalforge
docker compose -f docker-compose.prod.yml --env-file .env.production up -d api nginx
```

Verify API is running via the loopback debug port:

```bash
curl http://127.0.0.1:4080/health
```

Expected: `{"status":"ok","service":"signalforge-api","version":"1.0.0"}`

Verify nginx joined the Caddy network:

```bash
docker inspect signalforge-nginx --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```

Expected output includes both `signalforge-net` and `ig-viewer_web`.

---

## Phase 5 — Configure Caddy (HIGH RISK — affects all sites during reload)

**Only do this after Phase 4 works.**

First, verify your DNS A record is pointing to the VPS:

```bash
dig api.websiterankerrs.tech +short
# Expected: 2.25.122.205
```

Edit the shared Caddyfile (used by ig-viewer, in-downloader, thesavefrom):

```bash
nano /opt/ig-viewer/Caddyfile
```

Append this block at the end:

```caddyfile
# ---- api.websiterankerrs.tech (SignalForge API) ----
api.websiterankerrs.tech {
	reverse_proxy signalforge-nginx:80
}
```

Reload Caddy inside the container (graceful — existing sites stay up):

```bash
docker exec ig-viewer-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

Verify:

```bash
# SignalForge API works over HTTPS
curl https://api.websiterankerrs.tech/health
# Expected: {"status":"ok","service":"signalforge-api","version":"1.0.0"}

# Existing sites still work
curl -I https://view-igstory.com/
curl -I https://in-downloader.com/
curl -I https://thesavefrom.com/
# Expected: All return 200
```

If any existing site is down, immediately remove the SignalForge block and reload:

```bash
nano /opt/ig-viewer/Caddyfile   # Remove the api.websiterankerrs.tech block
docker exec ig-viewer-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

---

## Phase 6 — Start Workers

```bash
cd /opt/signalforge
docker compose -f docker-compose.prod.yml --env-file .env.production up -d \
  scheduler-worker email-worker campaign-enrollment-worker \
  verification-worker lead-discovery-worker inbound-worker
```

Verify all services are running:

```bash
docker compose -f docker-compose.prod.yml ps
```

Expected: 10 services running (postgres, redis, api, nginx, 6 workers).

Check for errors:

```bash
docker compose -f docker-compose.prod.yml logs --tail 5 scheduler-worker
docker compose -f docker-compose.prod.yml logs --tail 5 email-worker
```

Check memory:

```bash
docker stats --no-stream
free -h
```

---

## Phase 7 — Configure Vercel Frontend

The frontend should already be deployed at `https://signal-forge-tan.vercel.app`.

1. Go to Vercel project **Settings → General → Root Directory** and set it to `apps/web`
2. Set environment variables in **Settings → Environment Variables**:

| Variable | Value | Scope |
|----------|-------|-------|
| `API_URL` | `https://api.websiterankerrs.tech` | Server-side (Production) |
| `APP_URL` | `https://signal-forge-tan.vercel.app` | Server-side (Production) |
| `NEXT_PUBLIC_API_URL` | `/api` | All (Production) |

3. Redeploy from the Vercel dashboard

After deployment, verify the VPS `.env.production` has the correct `APP_URL`:

```bash
cd /opt/signalforge
grep APP_URL .env.production
# Should show: APP_URL=https://signal-forge-tan.vercel.app
```

If you need to update it:

```bash
nano .env.production
# Set APP_URL=https://signal-forge-tan.vercel.app
docker compose -f docker-compose.prod.yml --env-file .env.production up -d api
```

---

## Phase 8 — Smoke Tests

```bash
# API health
curl -f https://api.websiterankerrs.tech/health

# Frontend loads
curl -f -I https://signal-forge-tan.vercel.app

# Sign up test
curl -s -X POST https://api.websiterankerrs.tech/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@signalforge.local","password":"YourStrongPass123!","firstName":"Admin","lastName":"User"}'

# Container health
docker compose -f docker-compose.prod.yml ps

# Memory usage
docker stats --no-stream
free -h

# Existing sites
curl -f -I https://view-igstory.com/
curl -f -I https://in-downloader.com/
curl -f -I https://thesavefrom.com/
```

---

## Phase 9 — Set Up Daily Backups

```bash
# Create backup script
cat > /opt/signalforge/backups/backup.sh << 'SCRIPT'
#!/bin/bash
docker compose -f /opt/signalforge/docker-compose.prod.yml exec -T postgres pg_dump -U signalforge signalforge | gzip > /opt/signalforge/backups/daily-$(date +%Y%m%d).sql.gz
find /opt/signalforge/backups/ -name "daily-*.sql.gz" -mtime +7 -delete
SCRIPT

chmod +x /opt/signalforge/backups/backup.sh

# Add to crontab (runs at 3 AM daily)
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/signalforge/backups/backup.sh") | crontab -
```

---

## Emergency Rollback

If anything goes wrong at any phase:

```bash
# Stop all SignalForge containers (data preserved in volumes)
cd /opt/signalforge
docker compose -f docker-compose.prod.yml down

# Remove Caddy block if added
nano /opt/ig-viewer/Caddyfile   # Remove the api.websiterankerrs.tech block
docker exec ig-viewer-caddy-1 caddy reload --config /etc/caddy/Caddyfile

# Verify existing sites
curl -I https://view-igstory.com/
curl -I https://in-downloader.com/
curl -I https://thesavefrom.com/
```

---

## Enabling Deferred Workers

With 15 GB RAM, you can enable all deferred workers immediately if desired:

```bash
# Start all deferred workers (adds ~896 MB limit / ~400-500 MB actual)
cd /opt/signalforge
docker compose -f docker-compose.prod.yml --env-file .env.production --profile deferred up -d

# Or start individual deferred workers:
docker compose -f docker-compose.prod.yml --env-file .env.production up -d workflow-worker
docker compose -f docker-compose.prod.yml --env-file .env.production up -d enrichment-worker
docker compose -f docker-compose.prod.yml --env-file .env.production up -d analytics-worker
```

### What each deferred worker adds:

| Worker | Feature Unlocked |
|--------|-----------------|
| `workflow-worker` | Multi-step automations (if/then branches, delays) |
| `warmup-worker` | Automatic mailbox warmup |
| `inbox-reply-worker` | Reply from inbox UI |
| `deliverability-worker` | Dashboard analytics, domain health alerts |
| `analytics-worker` | Daily analytics rollup |
| `enrichment-worker` | AI-powered ICP scoring, personalization variables |
| `website-worker` | Website intelligence analysis |
| `lead-research-worker` | LinkedIn/web research |

### Google Maps scraper:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production --profile scraper up -d
```

---

## Service Summary

| Service | Status | Memory Limit |
|---------|--------|----------:|
| postgres | **Active** | 1,024 MB |
| redis | **Active** | 512 MB |
| api | **Active** | 512 MB |
| nginx | **Active** | 64 MB |
| scheduler-worker | **Active** | 128 MB |
| email-worker | **Active** | 128 MB |
| campaign-enrollment-worker | **Active** | 128 MB |
| verification-worker | **Active** | 128 MB |
| lead-discovery-worker | **Active** | 128 MB |
| inbound-worker | **Active** | 128 MB |
| **Total (limits)** | | **2,880 MB** |
| **Total (estimated actual)** | | **~1,400-1,800 MB** |

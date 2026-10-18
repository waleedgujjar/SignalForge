# SignalForge — Production Deployment Guide

## Architecture Overview

```
                    ┌─────────────┐
    Users ──────────│   Vercel    │ (Next.js 15 frontend)
                    │  /api/* ────│──── rewrites ────┐
                    └─────────────┘                  │
                                                     ▼
                    ┌─────────────────────────────────────┐
                    │         Hostinger VPS (Docker)       │
                    │  ┌───────┐   ┌─────┐   ┌────────┐  │
                    │  │ nginx │──▶│ API │──▶│Postgres│  │
                    │  │  :443 │   │:4000│   │ :5432  │  │
                    │  └───────┘   └──┬──┘   └────────┘  │
                    │                 │                    │
                    │         ┌───────┴───────┐           │
                    │         │    Redis      │           │
                    │         │    :6379      │           │
                    │         └───────────────┘           │
                    │  ┌──────────────────────────────┐   │
                    │  │  Workers (14 BullMQ queues)   │   │
                    │  └──────────────────────────────┘   │
                    └─────────────────────────────────────┘
```

---

## Part 1: Backend on Hostinger VPS

### 1.1 Prerequisites

- Hostinger VPS with at least 4GB RAM (8GB recommended)
- Ubuntu 22.04+ or Debian 12+
- Docker Engine 24+ and Docker Compose v2
- Domain with DNS A record pointing to VPS IP (e.g., `api.yourdomain.com`)

### 1.2 Initial VPS Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Docker Compose plugin (if not included)
sudo apt install docker-compose-plugin -y

# Verify
docker --version
docker compose version
```

### 1.3 Clone and Configure

```bash
# Clone repository
git clone <your-repo-url> /opt/signalforge
cd /opt/signalforge

# Create production environment file
cp .env.production.example .env.production

# Edit with your values
nano .env.production
```

**Critical values to set in `.env.production`:**

| Variable | Example | Notes |
|----------|---------|-------|
| `APP_URL` | `https://yourdomain.com` | Your Vercel frontend URL |
| `API_URL` | `http://api:4000` | Internal Docker network |
| `DATABASE_URL` | `postgresql://signalforge:STRONG_PASS@postgres:5432/signalforge?schema=public` | |
| `POSTGRES_PASSWORD` | (generate) | `openssl rand -base64 32` |
| `REDIS_URL` | `redis://:STRONG_PASS@redis:6379` | |
| `REDIS_PASSWORD` | (generate) | Must match REDIS_URL |
| `SESSION_SECRET` | (generate) | `openssl rand -base64 48` — min 32 chars |
| `ENCRYPTION_KEY` | (generate) | `openssl rand -base64 48` — min 32 chars |

### 1.4 TLS/HTTPS Setup

```bash
# Install certbot
sudo apt install certbot -y

# Get initial certificate (nginx must be stopped or use webroot)
sudo certbot certonly --standalone -d api.yourdomain.com

# Certificates will be at:
#   /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem
#   /etc/letsencrypt/live/api.yourdomain.com/privkey.pem
```

Update `infrastructure/nginx/conf.d/default.conf` — uncomment the HTTPS server block and set your domain.

Mount certificates in `docker-compose.prod.yml` nginx service:
```yaml
volumes:
  - /etc/letsencrypt:/etc/letsencrypt:ro
```

### 1.5 Deploy

```bash
cd /opt/signalforge

# Build and start all services
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# Run database migrations
docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy

# Verify
docker compose -f docker-compose.prod.yml ps
curl -k https://api.yourdomain.com/health
```

### 1.6 Auto-Renew TLS

```bash
# Add to crontab
echo "0 3 * * * certbot renew --webroot -w /var/www/certbot --quiet && docker compose -f /opt/signalforge/docker-compose.prod.yml restart nginx" | sudo tee -a /var/spool/cron/crontabs/root
```

---

## Part 2: Frontend on Vercel

### 2.1 Prerequisites

- Vercel account
- GitHub repository with the SignalForge code

### 2.2 Vercel Project Setup

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Vercel auto-detects the monorepo structure via `vercel.json`

### 2.3 Environment Variables in Vercel

Set these in **Vercel → Project → Settings → Environment Variables**:

| Variable | Value | Type |
|----------|-------|------|
| `API_URL` | `https://api.yourdomain.com` | Server-side (not public) |
| `APP_URL` | `https://yourdomain.com` | Server-side |
| `NEXT_PUBLIC_API_URL` | `/api` | Public (build-time) |

**How it works:** The Next.js `rewrites()` in `next.config.ts` proxies all `/api/*` requests server-side to `API_URL`. This means:
- Browser sends requests to `/api/health` (same origin)
- Vercel's server-side Next.js rewrites it to `https://api.yourdomain.com/health`
- Session cookies work because the browser sees a same-origin request

### 2.4 Deploy

```bash
# Vercel deploys automatically on git push, or manually:
npx vercel --prod
```

### 2.5 Verify

1. Visit `https://yourdomain.com` — should see login page
2. Open DevTools → Network → verify `/api/health` returns 200
3. Log in with seed credentials
4. Verify all navigation works

---

## Part 3: Post-Deployment Verification

### Smoke Tests

```bash
# API health
curl https://api.yourdomain.com/health

# Login (from server)
curl -X POST https://api.yourdomain.com/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@signalforge.local","password":"SignalForge1!"}'

# Frontend accessible
curl -I https://yourdomain.com
```

### Monitor

- **Docker logs:** `docker compose -f docker-compose.prod.yml logs -f api`
- **Worker status:** `docker compose -f docker-compose.prod.yml logs -f email-worker`
- **Redis:** `docker compose -f docker-compose.prod.yml exec redis redis-cli info memory`
- **Postgres:** `docker compose -f docker-compose.prod.yml exec postgres pg_isready`

---

## Part 4: Maintenance

### Updates

```bash
cd /opt/signalforge
git pull origin main
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy
```

### Backup

```bash
# Database backup
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U signalforge signalforge | gzip > backup-$(date +%Y%m%d).sql.gz
```

### Rollback

```bash
git checkout <previous-tag>
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

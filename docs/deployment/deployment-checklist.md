# SignalForge — Deployment Checklist

## Pre-Deployment

### Secrets & Configuration
- [ ] Generate `SESSION_SECRET` (min 32 chars): `openssl rand -base64 48`
- [ ] Generate `ENCRYPTION_KEY` (min 32 chars): `openssl rand -base64 48`
- [ ] Generate `POSTGRES_PASSWORD`: `openssl rand -base64 32`
- [ ] Generate `REDIS_PASSWORD`: `openssl rand -base64 32`
- [ ] Copy `.env.production.example` → `.env.production`
- [ ] Replace all `<CHANGE_ME>` values
- [ ] Set `APP_URL` to your Vercel frontend domain
- [ ] Set `AI_PROVIDER` and API keys if using AI features
- [ ] Configure system SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM_EMAIL) for password resets

### DNS
- [ ] A record for `api.yourdomain.com` → VPS IP address
- [ ] A/CNAME for `yourdomain.com` → Vercel (auto-configured when adding domain in Vercel)

### VPS Preparation
- [ ] Docker Engine 24+ installed
- [ ] Docker Compose v2 installed
- [ ] At least 4GB RAM available
- [ ] Firewall allows ports 80, 443
- [ ] SSH access configured

---

## Backend Deployment (Hostinger VPS)

### First Deployment
- [ ] Clone repo to `/opt/signalforge`
- [ ] Place `.env.production` in repo root
- [ ] Run `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`
- [ ] Wait for all containers to be healthy: `docker compose -f docker-compose.prod.yml ps`
- [ ] Run database migrations: `docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy`
- [ ] Seed database if needed: `docker compose -f docker-compose.prod.yml exec api npx prisma db seed`

### TLS/HTTPS
- [ ] Install certbot: `sudo apt install certbot -y`
- [ ] Obtain certificate: `sudo certbot certonly --standalone -d api.yourdomain.com`
- [ ] Mount certificates in nginx (update docker-compose volumes)
- [ ] Uncomment HTTPS server block in nginx config
- [ ] Restart nginx: `docker compose -f docker-compose.prod.yml restart nginx`
- [ ] Set up auto-renewal cron job

### Verify Backend
- [ ] `curl https://api.yourdomain.com/health` returns `{"status":"ok"}`
- [ ] `docker compose -f docker-compose.prod.yml logs api --tail 50` — no errors
- [ ] `docker compose -f docker-compose.prod.yml logs email-worker --tail 50` — no errors
- [ ] `docker compose -f docker-compose.prod.yml exec redis redis-cli ping` — returns PONG

---

## Frontend Deployment (Vercel)

### Vercel Setup
- [ ] Create new project from GitHub repo
- [ ] Vercel auto-detects `vercel.json` configuration
- [ ] Set environment variables:
  - `API_URL` = `https://api.yourdomain.com` (server-side)
  - `APP_URL` = `https://yourdomain.com` (server-side)
  - `NEXT_PUBLIC_API_URL` = `/api` (public)
- [ ] Add custom domain `yourdomain.com` in Vercel project settings
- [ ] Deploy (automatic on push, or `npx vercel --prod`)

### Verify Frontend
- [ ] `https://yourdomain.com` loads login page
- [ ] Browser DevTools → Network → `/api/health` returns 200
- [ ] Login with seed credentials works
- [ ] Session cookie `sf_session` is set (httpOnly, secure, sameSite=lax)
- [ ] Navigation between all modules works

---

## Post-Deployment Smoke Tests

### Authentication
- [ ] Sign up creates account and redirects to onboarding
- [ ] Login sets session cookie
- [ ] Logout clears session cookie
- [ ] Protected pages redirect to login when not authenticated
- [ ] Password reset flow sends email (if SMTP configured)

### Core Features
- [ ] Create workspace
- [ ] Create campaign with email steps
- [ ] Import leads via CSV/XLSX
- [ ] Enroll leads in campaign
- [ ] Verify email addresses
- [ ] View analytics dashboard
- [ ] Add/configure mailbox

### Email
- [ ] Campaign email sends with correct List-Unsubscribe headers
- [ ] Unsubscribe link in email works (marks lead as UNSUBSCRIBED)
- [ ] SMTP rotation distributes across mailboxes

---

## Rollback Plan

### Backend
```bash
cd /opt/signalforge
git checkout <previous-known-good-commit>
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### Frontend
- Vercel: Redeploy previous commit from Vercel dashboard → Deployments → "..." → Promote to Production
- Or: `git revert` and push

### Database
- If migration failed: `docker compose exec api npx prisma migrate resolve --rolled-back <migration-name>`
- Restore from backup: `gunzip < backup.sql.gz | docker compose exec -T postgres psql -U signalforge signalforge`

---

## Monitoring Setup (Recommended)

- [ ] Set up log aggregation (Docker logging driver → CloudWatch/Grafana Loki)
- [ ] Set up uptime monitoring for `https://api.yourdomain.com/health`
- [ ] Set up disk space alerts (Docker images and Postgres data grow over time)
- [ ] Set up memory alerts (container OOM kills)
- [ ] Configure daily database backups with retention policy

# Deployment Runbook

## Prerequisites

- Hostinger VPS with Ubuntu 22.04+ (or equivalent)
- SSH access with key-based authentication
- Docker Engine 24+ and Docker Compose v2 installed
- Domain pointing to VPS IP (for TLS)
- Git installed on VPS

## VPS Initial Setup

### 1. System Packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw
```

### 2. Docker Installation

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in for group change to take effect
```

### 3. Firewall

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

### 4. Deploy User (optional, recommended)

```bash
sudo adduser deploy
sudo usermod -aG docker deploy
# Copy SSH key to deploy user
sudo mkdir -p /home/deploy/.ssh
sudo cp ~/.ssh/authorized_keys /home/deploy/.ssh/
sudo chown -R deploy:deploy /home/deploy/.ssh
```

## First Deployment

### 1. Clone Repository

```bash
cd /opt
sudo mkdir signalforge && sudo chown deploy:deploy signalforge
git clone <repo-url> signalforge
cd signalforge
```

### 2. Configure Environment

```bash
cp .env.production.example .env.production
```

Edit `.env.production` and fill in all `<CHANGE_ME>` values:

```bash
# Generate secrets
openssl rand -base64 48  # Use for SESSION_SECRET
openssl rand -base64 48  # Use for ENCRYPTION_KEY
openssl rand -base64 32  # Use for POSTGRES_PASSWORD
openssl rand -base64 32  # Use for REDIS_PASSWORD
```

Set `APP_URL` to your domain (e.g. `https://yourdomain.com`).

Ensure `DATABASE_URL` and `REDIS_URL` use the same passwords you set for `POSTGRES_PASSWORD` and `REDIS_PASSWORD`.

### 3. Build Images

```bash
docker compose -f docker-compose.prod.yml build
```

### 4. Start Data Services First

```bash
docker compose -f docker-compose.prod.yml up -d postgres redis
# Wait for healthy status
docker compose -f docker-compose.prod.yml ps
```

### 5. Run Database Migrations

```bash
docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy
```

### 6. Start All Services

```bash
docker compose -f docker-compose.prod.yml up -d
```

### 7. Verify

```bash
# Check all containers are running
docker compose -f docker-compose.prod.yml ps

# Health check
curl http://localhost/health

# Check logs for errors
docker compose -f docker-compose.prod.yml logs --tail=50 api
docker compose -f docker-compose.prod.yml logs --tail=50 web
docker compose -f docker-compose.prod.yml logs --tail=50 nginx
```

### 8. TLS Setup (Let's Encrypt)

```bash
# Install certbot
sudo apt install -y certbot

# Stop nginx temporarily
docker compose -f docker-compose.prod.yml stop nginx

# Obtain certificate
sudo certbot certonly --standalone -d yourdomain.com

# Update nginx config to enable HTTPS server block
# Edit infrastructure/nginx/conf.d/default.conf — uncomment the HTTPS block
# Update certificate paths to match /etc/letsencrypt/live/yourdomain.com/

# Mount certs into nginx container (add to docker-compose.prod.yml nginx volumes):
#   - /etc/letsencrypt:/etc/letsencrypt:ro

# Restart nginx
docker compose -f docker-compose.prod.yml up -d nginx
```

### 9. Setup Backups

```bash
chmod +x infrastructure/backup/backup-db.sh
chmod +x infrastructure/backup/restore-db.sh

# Add cron job (daily at 2 AM)
crontab -e
# 0 2 * * * /opt/signalforge/infrastructure/backup/backup-db.sh >> /var/log/signalforge-backup.log 2>&1

# Create backup directory
mkdir -p /opt/signalforge/backups
```

## Subsequent Deployments

### Standard Update

```bash
cd /opt/signalforge

# Pull latest code
git pull origin main

# Rebuild images
docker compose -f docker-compose.prod.yml build

# Run migrations (if any)
docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy

# Restart services (rolling)
docker compose -f docker-compose.prod.yml up -d --remove-orphans
```

### Quick Restart (no code changes)

```bash
docker compose -f docker-compose.prod.yml restart api web
docker compose -f docker-compose.prod.yml restart email-worker lead-scoring-worker
# ... restart other workers as needed
```

### Verify After Update

```bash
# Health check
curl http://localhost/health

# Check for errors in last 5 minutes of logs
docker compose -f docker-compose.prod.yml logs --since 5m api web

# Verify workers are processing
curl -H "Cookie: sf_session=..." http://localhost/api/health/queues
```

## Rollback Procedure

### Application Rollback

```bash
cd /opt/signalforge

# Check git history for the last known good commit
git log --oneline -10

# Revert to previous commit
git checkout <commit-hash>

# Rebuild and restart
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

### Database Rollback

If a migration caused issues:

```bash
# Restore from backup
./infrastructure/backup/restore-db.sh /opt/signalforge/backups/<backup-file>.sql.gz

# Then roll back the application code as above
```

## Environment Variable Changes

When adding or modifying environment variables:

1. Update `.env.production` on the VPS
2. Restart affected services:
   ```bash
   docker compose -f docker-compose.prod.yml up -d api web
   ```
3. Workers read env at startup — restart them too if the variable affects workers

Never edit `.env.production.example` on the VPS — that file is a template tracked in git.

# Operations Runbook

## Failure Scenarios

### 1. Application Unavailable

**Symptoms**: `curl http://localhost/health` fails, users cannot access the app.

**Diagnosis**:

```bash
# Check container status
docker compose -f docker-compose.prod.yml ps

# Check nginx
docker compose -f docker-compose.prod.yml logs --tail=30 nginx

# Check API
docker compose -f docker-compose.prod.yml logs --tail=30 api

# Check web
docker compose -f docker-compose.prod.yml logs --tail=30 web
```

**Resolution**:

```bash
# If containers are stopped, restart
docker compose -f docker-compose.prod.yml up -d

# If a specific service is crash-looping, check its logs then restart
docker compose -f docker-compose.prod.yml restart api

# If nginx config is bad
docker compose -f docker-compose.prod.yml exec nginx nginx -t
docker compose -f docker-compose.prod.yml restart nginx
```

---

### 2. Database Unavailable

**Symptoms**: API returns 500 errors, `/health` reports database unhealthy.

**Diagnosis**:

```bash
# Check postgres container
docker compose -f docker-compose.prod.yml ps postgres
docker compose -f docker-compose.prod.yml logs --tail=50 postgres

# Check disk space (postgres may stop if disk is full)
df -h

# Test connection from API container
docker compose -f docker-compose.prod.yml exec api node -e "
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.connect().then(() => { console.log('OK'); c.end(); }).catch(e => console.error(e.message));
"
```

**Resolution**:

```bash
# Restart postgres
docker compose -f docker-compose.prod.yml restart postgres

# Wait for health check, then restart API
sleep 10
docker compose -f docker-compose.prod.yml restart api

# If data is corrupted, restore from backup
./infrastructure/backup/restore-db.sh /opt/signalforge/backups/<latest>.sql.gz
```

---

### 3. Queue Backlog

**Symptoms**: Jobs pile up, lead processing stalls, emails not sending.

**Diagnosis**:

```bash
# Check queue health via API (requires auth)
curl -H "Cookie: sf_session=..." http://localhost/api/health/queues

# Check worker logs
docker compose -f docker-compose.prod.yml logs --tail=50 email-worker
docker compose -f docker-compose.prod.yml logs --tail=50 lead-scoring-worker

# Check Redis
docker compose -f docker-compose.prod.yml exec redis redis-cli INFO clients
docker compose -f docker-compose.prod.yml exec redis redis-cli DBSIZE
```

**Resolution**:

```bash
# Restart stuck workers
docker compose -f docker-compose.prod.yml restart email-worker lead-scoring-worker

# If Redis memory is high, check for stale jobs
docker compose -f docker-compose.prod.yml exec redis redis-cli INFO memory

# Restart Redis if necessary (queued jobs will be re-fetched from persistence)
docker compose -f docker-compose.prod.yml restart redis
```

---

### 4. Google Maps Scraper Unavailable

**Symptoms**: Lead discovery jobs for Google Maps sources fail.

**Diagnosis**:

```bash
# Check if scraper container is running (only if profile is active)
docker compose -f docker-compose.prod.yml --profile scraper ps

# Check scraper logs
docker compose -f docker-compose.prod.yml --profile scraper logs google-maps-scraper
```

**Resolution**:

```bash
# Restart the scraper
docker compose -f docker-compose.prod.yml --profile scraper restart google-maps-scraper

# Jobs using the scraper will retry automatically via BullMQ
# If the scraper is not needed, disable GOOGLE_MAPS_SCRAPER_ENABLED in .env.production
```

---

### 5. AI Provider Unavailable

**Symptoms**: Lead scoring, research, or qualification jobs fail with AI errors.

**Diagnosis**:

```bash
# Check API logs for AI errors
docker compose -f docker-compose.prod.yml logs --tail=50 api | grep -i "openai\|ai_provider\|model"

# Verify configuration
docker compose -f docker-compose.prod.yml exec api node -e "console.log(process.env.AI_PROVIDER, process.env.OPENAI_BASE_URL)"
```

**Resolution**:

- If the external AI provider is down: wait for recovery; jobs will retry.
- To switch to mock mode temporarily: set `AI_PROVIDER=mock` in `.env.production` and restart API + workers.
- Verify API key hasn't expired if using a real provider.

---

### 6. Email Infrastructure Failure

**Symptoms**: Email verification or sending jobs fail.

**Diagnosis**:

```bash
# Check email worker logs
docker compose -f docker-compose.prod.yml logs --tail=50 email-worker

# Check for SMTP connectivity issues in logs
docker compose -f docker-compose.prod.yml logs email-worker | grep -i "smtp\|timeout\|refused"
```

**Resolution**:

```bash
# Restart email worker
docker compose -f docker-compose.prod.yml restart email-worker

# If SMTP provider is down, jobs will retry via BullMQ backoff
# To pause email sending, set EMAIL_VERIFICATION_SMTP_ENABLED=false and restart
```

**Duplicate prevention**: BullMQ jobs are idempotent by job ID. Restarting workers does not re-send completed emails.

---

### 7. Disk Space

**Symptoms**: Services fail to write, database stops, containers won't start.

**Diagnosis**:

```bash
df -h
du -sh /var/lib/docker/
du -sh /opt/signalforge/backups/
```

**Resolution**:

```bash
# Remove unused Docker resources
docker system prune -f
docker image prune -a -f

# Reduce backup retention
./infrastructure/backup/backup-db.sh /opt/signalforge/backups 3

# Vacuum the database
docker compose -f docker-compose.prod.yml exec postgres psql -U signalforge -c "VACUUM FULL;"
```

---

### 8. Memory Pressure

**Symptoms**: OOM kills in `dmesg`, containers restarting unexpectedly.

**Diagnosis**:

```bash
# Check container resource usage
docker stats --no-stream

# Check system memory
free -h

# Check for OOM kills
dmesg | grep -i "oom\|killed"
```

**Resolution**:

```bash
# Identify the memory-hungry container from docker stats
# Restart it
docker compose -f docker-compose.prod.yml restart <service>

# If persistent, add memory limits in docker-compose.prod.yml:
#   deploy:
#     resources:
#       limits:
#         memory: 512M
```

---

### 9. Backup and Recovery

**Manual backup**:

```bash
./infrastructure/backup/backup-db.sh
ls -la /opt/signalforge/backups/
```

**Restore** (see also `infrastructure/backup/README.md`):

```bash
# List available backups
ls -lt /opt/signalforge/backups/

# Restore (stops app, restores, restarts)
./infrastructure/backup/restore-db.sh /opt/signalforge/backups/<file>.sql.gz

# Verify
curl http://localhost/health
```

## Service Management

### Stop All Services

```bash
docker compose -f docker-compose.prod.yml down
```

### Start All Services

```bash
docker compose -f docker-compose.prod.yml up -d
```

### View Logs (follow mode)

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f --tail=50

# Specific service
docker compose -f docker-compose.prod.yml logs -f --tail=50 api
```

### Restart a Single Service

```bash
docker compose -f docker-compose.prod.yml restart api
```

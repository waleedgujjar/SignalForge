# Monitoring Guide

## Health Endpoints

| Endpoint | Auth Required | What It Checks |
|----------|---------------|----------------|
| `GET /health` | No | API process alive |
| `GET /api/health/db` | Yes | PostgreSQL connectivity + latency |
| `GET /api/health/redis` | Yes | Redis connectivity + latency |
| `GET /api/health/queues` | Yes | BullMQ queue depths + worker status |
| `GET /api/health/ai` | Yes | AI provider reachability |

## Automated Health Polling

### Basic Uptime Check (cron)

```bash
# Add to crontab — check every 5 minutes
*/5 * * * * curl -sf http://localhost/health > /dev/null || echo "$(date) SignalForge DOWN" >> /var/log/signalforge-health.log
```

### Comprehensive Health Script

```bash
#!/bin/bash
# Save as /opt/signalforge/infrastructure/check-health.sh

API_URL="http://localhost"

# Public health endpoint
if ! curl -sf "$API_URL/health" > /dev/null 2>&1; then
  echo "$(date) CRITICAL: API health check failed" >> /var/log/signalforge-health.log
  # Add alerting here (email, webhook, etc.)
fi

# Check all containers are running
UNHEALTHY=$(docker compose -f /opt/signalforge/docker-compose.prod.yml ps --format json | grep -v '"running"' | grep -v '"healthy"' || true)
if [ -n "$UNHEALTHY" ]; then
  echo "$(date) WARNING: Unhealthy containers detected" >> /var/log/signalforge-health.log
  echo "$UNHEALTHY" >> /var/log/signalforge-health.log
fi
```

## Container Health

### Check Status

```bash
docker compose -f docker-compose.prod.yml ps
```

Expected output: all services show `Up` with `(healthy)` for postgres, redis, api, and web.

### Resource Usage

```bash
# Snapshot
docker stats --no-stream

# Live monitoring
docker stats
```

Key metrics to watch:
- **MEM USAGE**: API should be under 512MB, workers under 256MB each
- **CPU %**: Sustained >80% on any container warrants investigation
- **NET I/O**: Baseline varies; spikes during bulk operations are normal

## Log Inspection

### Recent Errors

```bash
# API errors
docker compose -f docker-compose.prod.yml logs --tail=100 api | grep -i "error\|fatal\|exception"

# All worker errors
for w in email-worker lead-scoring-worker lead-qualification-worker website-scanner-worker \
         enrichment-worker export-worker lead-research-worker web-research-worker \
         email-discovery-worker lead-discovery-worker google-maps-worker \
         ai-analysis-worker lead-verification-worker campaign-worker; do
  echo "=== $w ==="
  docker compose -f docker-compose.prod.yml logs --tail=20 "$w" 2>/dev/null | grep -i "error" || echo "(no errors)"
done
```

### Structured Log Parsing

API logs are JSON-formatted in production. Parse with `jq`:

```bash
docker compose -f docker-compose.prod.yml logs --tail=100 api --no-log-prefix | jq -r 'select(.level >= 50) | "\(.time) \(.msg)"' 2>/dev/null
```

## Queue Monitoring

### Queue Depths

The `/api/health/queues` endpoint returns queue status including waiting, active, completed, and failed job counts. Monitor for:

- **Waiting jobs increasing** over time → workers may be stuck or too slow
- **Failed jobs increasing** → check worker logs for error details
- **Active jobs stuck at a constant number** → workers may be hung

### Redis Memory

```bash
docker compose -f docker-compose.prod.yml exec redis redis-cli INFO memory | grep used_memory_human
```

If Redis memory grows beyond 256MB, investigate stale jobs or data accumulation.

## Disk Usage

```bash
# Overall
df -h

# Docker storage
docker system df

# Backup directory
du -sh /opt/signalforge/backups/

# Database volume
docker system df -v | grep signalforge
```

**Thresholds**:
- Disk >80% full: clean up Docker images and reduce backup retention
- Disk >90% full: immediate action — prune, vacuum, archive backups

## System Resources

```bash
# Memory
free -h

# CPU load
uptime

# Top processes
top -bn1 | head -20
```

## Alerting (Recommendations)

The current setup has no external alerting. Recommended additions:

1. **UptimeRobot or similar** — free tier monitors `/health` endpoint from outside the VPS, sends email/SMS on downtime.

2. **Webhook on failure** — modify the health check cron script to POST to a Slack/Discord webhook on failure.

3. **Log aggregation** — for multi-VPS or when log volume grows:
   - Loki + Grafana (lightweight, Docker-native)
   - Or centralized syslog

4. **Metrics** (future consideration):
   - OpenTelemetry SDK integration
   - Prometheus + Grafana stack
   - Node.js `prom-client` for custom metrics (request latency, queue depth, error rate)

These are documented here as future enhancements. The cron-based health checks and manual log inspection cover initial production needs.

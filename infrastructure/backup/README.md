# Backup & Recovery

## Scope

| Data | Backup Method | Recovery |
|------|---------------|----------|
| PostgreSQL (all tables) | `backup-db.sh` (pg_dump + gzip) | `restore-db.sh` |
| Redis (queue state) | Docker volume persistence | Volume survives restarts; jobs are retryable |
| File uploads | In-memory only (no disk storage) | Not applicable |
| Generated exports | On-demand regeneration | Re-export from database |

## Automated Backup

### Setup (cron)

```bash
chmod +x infrastructure/backup/backup-db.sh
chmod +x infrastructure/backup/restore-db.sh

# Run daily at 2 AM, keep 7 days of backups
crontab -e
0 2 * * * /opt/signalforge/infrastructure/backup/backup-db.sh >> /var/log/signalforge-backup.log 2>&1
```

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `$1` (arg) | `/opt/signalforge/backups` | Backup directory |
| `$2` (arg) | `7` | Retention days |
| `COMPOSE_FILE` | `docker-compose.prod.yml` | Docker compose file |
| `COMPOSE_DIR` | Auto-detected | Repository root |
| `POSTGRES_USER` | `signalforge` | Database user |
| `POSTGRES_DB` | `signalforge` | Database name |

### Manual Backup

```bash
cd /opt/signalforge
./infrastructure/backup/backup-db.sh
```

## Restore Procedure

1. Identify the backup to restore:
   ```bash
   ls -la /opt/signalforge/backups/
   ```

2. Run the restore script (stops app, restores, restarts):
   ```bash
   ./infrastructure/backup/restore-db.sh /opt/signalforge/backups/signalforge-db-20261009-020000.sql.gz
   ```

3. Verify the application is healthy:
   ```bash
   curl http://localhost/health
   curl -H "Cookie: sf_session=..." http://localhost/api/health/db
   ```

## Recovery Objectives (Proposed)

| Metric | Value | Notes |
|--------|-------|-------|
| RPO (Recovery Point Objective) | 24 hours | Daily backup schedule |
| RTO (Recovery Time Objective) | 30 minutes | Restore script + verification |

These are initial proposals. Adjust based on business requirements.

## Off-Site Backup (Recommended)

The backup scripts store files locally. For disaster recovery, copy backups off-site:

```bash
# rsync to a remote server
rsync -avz /opt/signalforge/backups/ user@backup-server:/backups/signalforge/

# Or use rclone for cloud storage
rclone sync /opt/signalforge/backups/ remote:signalforge-backups/
```

Add to cron after the backup job:

```
15 2 * * * rsync -avz /opt/signalforge/backups/ user@backup-server:/backups/signalforge/
```

## Limitations

- Backups are stored locally by default — a VPS failure loses both data and backups
- Redis state is not backed up (queue jobs are transient and retryable)
- No point-in-time recovery (full dump only, not WAL archiving)
- Restore overwrites the entire database — no table-level restore

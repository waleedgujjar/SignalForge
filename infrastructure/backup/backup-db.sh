#!/usr/bin/env bash
set -euo pipefail

# SignalForge PostgreSQL Backup Script
# Usage: ./backup-db.sh [backup_dir] [retention_days]
# Cron:  0 2 * * * /opt/signalforge/infrastructure/backup/backup-db.sh >> /var/log/signalforge-backup.log 2>&1

BACKUP_DIR="${1:-/opt/signalforge/backups}"
RETENTION_DAYS="${2:-7}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/signalforge-db-${TIMESTAMP}.sql.gz"

echo "[$(date -Iseconds)] Starting database backup..."

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

# Run pg_dump inside the postgres container
docker compose -f "${COMPOSE_DIR}/${COMPOSE_FILE}" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-signalforge}" "${POSTGRES_DB:-signalforge}" \
  --no-owner --no-acl \
  | gzip > "${BACKUP_FILE}"

# Validate backup is non-empty
BACKUP_SIZE=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}" 2>/dev/null || echo "0")
if [ "${BACKUP_SIZE}" -lt 100 ]; then
  echo "[$(date -Iseconds)] ERROR: Backup file is suspiciously small (${BACKUP_SIZE} bytes). Aborting cleanup."
  exit 1
fi

echo "[$(date -Iseconds)] Backup complete: ${BACKUP_FILE} (${BACKUP_SIZE} bytes)"

# Clean up old backups
DELETED_COUNT=0
if [ "${RETENTION_DAYS}" -gt 0 ]; then
  while IFS= read -r old_file; do
    rm -f "${old_file}"
    DELETED_COUNT=$((DELETED_COUNT + 1))
  done < <(find "${BACKUP_DIR}" -name "signalforge-db-*.sql.gz" -mtime +${RETENTION_DAYS} -type f 2>/dev/null)
fi

echo "[$(date -Iseconds)] Cleanup: removed ${DELETED_COUNT} backups older than ${RETENTION_DAYS} days"
echo "[$(date -Iseconds)] Backup completed successfully"

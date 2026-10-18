#!/usr/bin/env bash
set -euo pipefail

# SignalForge PostgreSQL Restore Script
# Usage: ./restore-db.sh <backup_file.sql.gz>
# WARNING: This will overwrite the current database contents.

BACKUP_FILE="${1:?Usage: $0 <backup_file.sql.gz>}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "ERROR: Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

echo "========================================"
echo "  SignalForge Database Restore"
echo "========================================"
echo "Backup file: ${BACKUP_FILE}"
echo "Compose file: ${COMPOSE_DIR}/${COMPOSE_FILE}"
echo ""
echo "WARNING: This will stop application services and overwrite the database."
echo "Press Ctrl+C to cancel, or Enter to continue..."
read -r

echo "[$(date -Iseconds)] Stopping application services..."
docker compose -f "${COMPOSE_DIR}/${COMPOSE_FILE}" stop \
  api web \
  email-worker scheduler-worker campaign-enrollment-worker workflow-worker \
  verification-worker warmup-worker inbound-worker inbox-reply-worker \
  deliverability-worker analytics-worker enrichment-worker website-worker \
  lead-discovery-worker lead-research-worker \
  2>/dev/null || true

echo "[$(date -Iseconds)] Restoring database from backup..."
gunzip -c "${BACKUP_FILE}" | docker compose -f "${COMPOSE_DIR}/${COMPOSE_FILE}" exec -T postgres \
  psql -U "${POSTGRES_USER:-signalforge}" -d "${POSTGRES_DB:-signalforge}" --quiet

echo "[$(date -Iseconds)] Restarting application services..."
docker compose -f "${COMPOSE_DIR}/${COMPOSE_FILE}" start \
  api web \
  email-worker scheduler-worker campaign-enrollment-worker workflow-worker \
  verification-worker warmup-worker inbound-worker inbox-reply-worker \
  deliverability-worker analytics-worker enrichment-worker website-worker \
  lead-discovery-worker lead-research-worker

echo "[$(date -Iseconds)] Verifying API health..."
sleep 5
if docker compose -f "${COMPOSE_DIR}/${COMPOSE_FILE}" exec -T api wget --no-verbose --tries=3 --spider http://localhost:4000/health 2>/dev/null; then
  echo "[$(date -Iseconds)] Restore completed successfully — API is healthy"
else
  echo "[$(date -Iseconds)] WARNING: API health check failed after restore. Check logs:"
  echo "  docker compose -f ${COMPOSE_FILE} logs api --tail 50"
fi

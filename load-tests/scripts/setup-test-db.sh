#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOAD_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5435}"
PG_USER="${PG_USER:-signalforge}"
PG_PASS="${PG_PASS:-signalforge}"
DB_NAME="${DB_NAME:-signalforge_perf}"

export PGPASSWORD="$PG_PASS"

echo "=== Stage 18: Performance Test Database Setup ==="
echo ""

# 1. Create the perf test database (drop if exists)
echo "[1/4] Creating database '$DB_NAME'..."
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME';" 2>/dev/null || true
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c \
  "DROP DATABASE IF EXISTS $DB_NAME;" 2>/dev/null
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c \
  "CREATE DATABASE $DB_NAME;"
echo "  Database '$DB_NAME' created."

# 2. Run Prisma migrations
echo ""
echo "[2/4] Running Prisma migrations..."
export DATABASE_URL="postgresql://$PG_USER:$PG_PASS@$PG_HOST:$PG_PORT/$DB_NAME?schema=public"
cd "$ROOT_DIR"
pnpm --filter @signalforge/database db:migrate:deploy
echo "  Migrations applied."

# 3. Seed performance test data
echo ""
echo "[3/4] Seeding performance test data..."
cd "$LOAD_DIR"
npx tsx scripts/seed-perf-data.ts
echo "  Seed data inserted."

# 4. Verify
echo ""
echo "[4/4] Verifying..."
LEAD_COUNT=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$DB_NAME" -t -c "SELECT count(*) FROM \"Lead\";")
EVENT_COUNT=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$DB_NAME" -t -c "SELECT count(*) FROM \"EmailDeliveryEvent\";")
echo "  Leads: $LEAD_COUNT"
echo "  Delivery Events: $EVENT_COUNT"
echo ""
echo "=== Setup complete ==="
echo "Start the API with:  cd $ROOT_DIR && env \$(cat $LOAD_DIR/.env.perf | grep -v '^#' | xargs) pnpm --filter @signalforge/api dev"

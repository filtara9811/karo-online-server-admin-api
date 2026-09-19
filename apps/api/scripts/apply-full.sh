#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQL_DIR="$(cd "$ROOT/../../supabase" && pwd)"
unset PGHOST PGHOSTADDR PGPORT PGUSER PGPASSWORD PGDATABASE || true
set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a
export PGCONNECT_TIMEOUT=20
export PGSSLMODE=require
psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f "$SQL_DIR/full-schema.sql"
psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO karoonline; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO karoonline; GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO karoonline;"
psql "$DATABASE_URL" -c "select count(*) as tables from information_schema.tables where table_schema='public';"
echo "full schema applied"

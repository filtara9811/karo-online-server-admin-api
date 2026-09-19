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

psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f "$SQL_DIR/do-rls.sql"
echo "rls disabled"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "select count(*) as categories from public.categories; select count(*) as vendors from public.vendors; select count(*) as items from public.catalog_items; select count(*) as mappings from public.vendor_item_mappings;"

cd "$ROOT"
npx tsx -e "import { seedBootstrapAdmin } from './src/lib/seed-admin.ts'; await seedBootstrapAdmin();"
echo "finish ok"

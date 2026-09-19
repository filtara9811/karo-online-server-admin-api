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

ADMIN_URI="${DATABASE_ADMIN_URL:-}"
APP_URI="${DATABASE_URL:-}"
if [[ -z "$ADMIN_URI" || -z "$APP_URI" ]]; then
  echo "DATABASE_ADMIN_URL and DATABASE_URL are required"
  exit 1
fi

echo "granting karoonline on public"
psql "$ADMIN_URI" -v ON_ERROR_STOP=1 <<'SQL'
GRANT CONNECT ON DATABASE karoonline TO karoonline;
GRANT USAGE, CREATE ON SCHEMA public TO karoonline;
ALTER SCHEMA public OWNER TO karoonline;
GRANT ALL ON ALL TABLES IN SCHEMA public TO karoonline;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO karoonline;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO karoonline;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO karoonline;
SQL

echo "applying do-init + bootstrap as doadmin"
psql "$ADMIN_URI" -v ON_ERROR_STOP=1 -f "$SQL_DIR/do-init.sql"
psql "$ADMIN_URI" -v ON_ERROR_STOP=1 -f "$SQL_DIR/bootstrap.sql"

echo "re-granting new tables"
psql "$ADMIN_URI" -v ON_ERROR_STOP=1 <<'SQL'
GRANT USAGE, CREATE ON SCHEMA public TO karoonline;
GRANT ALL ON ALL TABLES IN SCHEMA public TO karoonline;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO karoonline;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO karoonline;
SQL

echo "verify as app user"
psql "$APP_URI" -v ON_ERROR_STOP=1 -c "select count(*) as categories from public.categories; select count(*) as vendors from public.vendors; select count(*) as items from public.catalog_items;"
echo "done"

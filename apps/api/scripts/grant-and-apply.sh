#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQL_DIR="$(cd "$ROOT/../../supabase" && pwd)"
unset PGHOST PGHOSTADDR PGPORT PGUSER PGPASSWORD PGDATABASE || true
set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

APP_URI="$DATABASE_URL"
ADMIN_URI="${APP_URI/karoonline:/doadmin:}"

echo "trying doadmin grant"
if psql "$ADMIN_URI" -v ON_ERROR_STOP=1 <<'SQL'
GRANT ALL ON DATABASE karoonline TO karoonline;
GRANT ALL ON SCHEMA public TO karoonline;
ALTER SCHEMA public OWNER TO karoonline;
ALTER DATABASE karoonline OWNER TO karoonline;
SQL
then
  echo "grants ok"
else
  echo "doadmin grant failed — need the doadmin connection string"
  exit 2
fi

psql "$APP_URI" -v ON_ERROR_STOP=1 -f "$SQL_DIR/do-init.sql"
psql "$APP_URI" -v ON_ERROR_STOP=1 -f "$SQL_DIR/bootstrap.sql"
psql "$APP_URI" -c "select count(*) as categories from public.categories; select count(*) as vendors from public.vendors;"
echo "seeded"

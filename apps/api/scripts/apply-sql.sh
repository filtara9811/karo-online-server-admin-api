#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQL="$(cd "$ROOT/../../supabase" && pwd)/bootstrap.sql"
set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

if [[ "${SUPABASE_URL:-}" == *lxwttwccbtxdpnrzadgj* ]]; then
  echo "refusing to touch the old Lovable project"
  exit 1
fi

export PGPASSWORD="${SUPABASE_DB_PASSWORD:?missing SUPABASE_DB_PASSWORD}"
export PGCONNECT_TIMEOUT=20
REF="vnznexcljflhqethnjlh"
USER="postgres.${REF}"

try_psql() {
  local uri="$1"
  local label="$2"
  echo "trying ${label}"
  if psql "$uri" -v ON_ERROR_STOP=1 -f "$SQL" >/tmp/karo-bootstrap.out 2>/tmp/karo-bootstrap.err; then
    echo "applied via ${label}"
    grep -E 'CREATE|INSERT|ALTER|CREATE FUNCTION|NOTICE' /tmp/karo-bootstrap.out | tail -n 40
    return 0
  fi
  echo "failed ${label}: $(tr '\n' ' ' < /tmp/karo-bootstrap.err | tail -c 240)"
  return 1
}

try_psql "${DATABASE_URL}" "direct" && exit 0

for host in \
  "aws-0-ap-south-1.pooler.supabase.com" \
  "aws-1-ap-south-1.pooler.supabase.com" \
  "aws-0-ap-southeast-1.pooler.supabase.com" \
  "aws-0-us-east-1.pooler.supabase.com" \
  "aws-0-eu-central-1.pooler.supabase.com" \
  "aws-0-eu-west-1.pooler.supabase.com"
do
  try_psql "postgresql://${USER}:${PGPASSWORD}@${host}:5432/postgres" "session ${host}" && exit 0
  try_psql "postgresql://${USER}:${PGPASSWORD}@${host}:6543/postgres" "transaction ${host}" && exit 0
done

echo "could not connect"
exit 1

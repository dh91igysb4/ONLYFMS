#!/usr/bin/env bash
# DB 테스트 하네스 (Ruling R1).
# 임시 Postgres 16 클러스터 → supabase/tests/shim.sql(테스트 전용 Supabase 호환)
# → supabase/migrations/*.sql(이름순) → pg_prove supabase/tests/*.test.sql.
# Docker가 있는 머신에서는 `npx supabase test db`가 같은 역할을 한다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DB=postgres
SUPERUSER=postgres

TMP="$(mktemp -d "${TMPDIR:-/tmp}/onlyfms-dbtest.XXXXXX")"
DATA="$TMP/data"
SOCK="$TMP/sock"
mkdir -p "$SOCK"

# Postgres는 root로 실행할 수 없다 → root면 postgres 사용자로 서버를 띄운다.
if [ "$(id -u)" = "0" ]; then
  chown -R postgres:postgres "$TMP"
  chmod 755 "$TMP"
  as_pg() { runuser -u postgres -- "$@"; }
else
  as_pg() { "$@"; }
fi

cleanup() {
  as_pg "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

PORT="${DB_TEST_PORT:-$(( 20000 + RANDOM % 20000 ))}"

as_pg "$PGBIN/initdb" -D "$DATA" -U "$SUPERUSER" --auth=trust -E UTF8 --locale=C.UTF-8 >"$TMP/initdb.log" 2>&1 \
  || { cat "$TMP/initdb.log"; exit 1; }
as_pg "$PGBIN/pg_ctl" -D "$DATA" -l "$TMP/server.log" -w \
  -o "-k $SOCK -p $PORT -c listen_addresses='' -c fsync=off" start >/dev/null \
  || { cat "$TMP/server.log"; exit 1; }

export PGHOST="$SOCK" PGPORT="$PORT" PGUSER="$SUPERUSER" PGDATABASE="$DB"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

echo "== shim"
"${PSQL[@]}" -f "$ROOT/supabase/tests/shim.sql"

shopt -s nullglob
for m in "$ROOT"/supabase/migrations/*.sql; do
  echo "== migration $(basename "$m")"
  "${PSQL[@]}" -f "$m"
done

tests=("$ROOT"/supabase/tests/*.test.sql)
if [ ${#tests[@]} -eq 0 ]; then
  echo "no DB tests"
  exit 0
fi

echo "== tests"
pg_prove --host "$SOCK" --port "$PORT" --username "$SUPERUSER" --dbname "$DB" "${tests[@]}"

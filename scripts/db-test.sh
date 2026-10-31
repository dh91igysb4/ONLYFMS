#!/usr/bin/env bash
# DB 테스트 하네스 (Ruling R1).
# 임시 Postgres 16 클러스터 → supabase/tests/shim.sql(테스트 전용 Supabase 호환)
# → supabase/migrations/*.sql(이름순) → pg_prove supabase/tests/*.test.sql.
# Docker가 있는 머신에서는 `npx supabase test db`가 같은 역할을 한다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=db-lib.sh
. "$ROOT/scripts/db-lib.sh"

TMP=""
trap 'db_stop' EXIT
db_start
db_migrate

tests=("$ROOT"/supabase/tests/*.test.sql)
if [ ${#tests[@]} -eq 0 ]; then
  echo "no DB tests"
  exit 0
fi

echo "== tests"
pg_prove --host "$SOCK" --port "$PORT" --username "$SUPERUSER" --dbname "$DB" "${tests[@]}"

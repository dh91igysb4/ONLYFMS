#!/usr/bin/env bash
# DB 테스트 하네스 (Ruling R1).
# 임시 Postgres 16 클러스터 → supabase/tests/shim.sql(테스트 전용 Supabase 호환)
# → supabase/migrations/*.sql(이름순) → 축구 픽스처 적재 → pg_prove supabase/tests/*.test.sql → 축구 적재 검사.
# Docker가 있는 머신에서는 `npx supabase test db`가 같은 역할을 한다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=db-lib.sh
. "$ROOT/scripts/db-lib.sh"

TMP=""
trap 'db_stop' EXIT
db_start
db_migrate

# 축구 데이터 픽스처를 적재해 둔다 (11_football 등 pgTAP가 쓴다. 각 테스트는 롤백하므로 그대로 남는다)
echo "== football fixtures"
DATABASE_URL="$TEST_DB_URL" bash "$ROOT/scripts/football/load.sh" "$ROOT/supabase/tests/fixtures/football" >/dev/null

tests=("$ROOT"/supabase/tests/*.test.sql)
if [ ${#tests[@]} -eq 0 ]; then
  echo "no DB tests"
  exit 0
fi

echo "== tests"
pg_prove --host "$SOCK" --port "$PORT" --username "$SUPERUSER" --dbname "$DB" "${tests[@]}"

echo "== football load"
TEST_DB_URL="$TEST_DB_URL" bash "$ROOT/scripts/football/load-test.sh"

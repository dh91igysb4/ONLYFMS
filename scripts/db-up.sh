#!/usr/bin/env bash
# 마이그레이션까지 적용한 임시 Postgres를 띄워 둔다. 마지막 두 줄로 접속 정보를 출력한다:
#   TEST_DB_URL=postgres://postgres@127.0.0.1:<port>/postgres
#   DB_DIR=<임시 폴더>   ← scripts/db-down.sh <DB_DIR> 로 끈다
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=db-lib.sh
. "$ROOT/scripts/db-lib.sh"
TMP=""
db_start
if ! db_migrate >"$TMP/migrate.log" 2>&1; then
  cat "$TMP/migrate.log" >&2
  db_stop
  exit 1
fi
echo "TEST_DB_URL=$TEST_DB_URL"
echo "DB_DIR=$TMP"

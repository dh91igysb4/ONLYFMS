#!/usr/bin/env bash
# scripts/db-up.sh가 띄운 임시 Postgres를 끄고 지운다. 인자: DB_DIR
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=db-lib.sh
. "$ROOT/scripts/db-lib.sh"
TMP="${1:?usage: db-down.sh <DB_DIR>}"
case "$TMP" in */onlyfms-dbtest.*) ;; *) echo "not a db-up dir: $TMP" >&2; exit 1 ;; esac
db_stop

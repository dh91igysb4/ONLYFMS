#!/usr/bin/env bash
# Edge Function 통합 테스트 (Ruling R4): 임시 Postgres를 띄우고 deno test로 handler.test.ts를 돌린 뒤 끈다.
# DENO가 없으면 PATH의 deno → npx deno 순으로 찾는다.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -z "${DENO:-}" ]; then
  if command -v deno >/dev/null 2>&1; then DENO=deno; else DENO="npx --yes deno"; fi
fi
out="$(bash "$ROOT/scripts/db-up.sh")"
DB_DIR="$(printf '%s\n' "$out" | sed -n 's/^DB_DIR=//p')"
TEST_DB_URL="$(printf '%s\n' "$out" | sed -n 's/^TEST_DB_URL=//p')"
trap 'bash "$ROOT/scripts/db-down.sh" "$DB_DIR"' EXIT
cd "$ROOT"
TEST_DB_URL="$TEST_DB_URL" $DENO test --allow-all --config supabase/functions/play/deno.json \
  supabase/functions/play/ "$@"

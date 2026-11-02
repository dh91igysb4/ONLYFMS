#!/usr/bin/env bash
# 축구 CSV를 DB의 football_* 테이블에 한 트랜잭션으로 적재한다 (설계 docs/superpowers/specs/2026-11-01-football-data-layer-design.md §7).
#   DATABASE_URL='postgres://…' npm run football:load            # data/football/
#   DATABASE_URL='postgres://…' npm run football:load -- <dir>    # 다른 폴더 (테스트 픽스처 등)
# 원격 DATABASE_URL은 비밀값이다. 커밋하지 않는다. psql이 필요하다.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIR="${1:-$ROOT/data/football}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL이 필요합니다 (Supabase 대시보드 → Connect의 연결 문자열, 로컬은 scripts/db-up.sh의 TEST_DB_URL)" >&2
  exit 2
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "psql이 없습니다. PostgreSQL 클라이언트를 설치하세요" >&2
  exit 2
fi
if [ ! -f "$DIR/players.csv" ]; then
  echo "CSV가 없습니다: $DIR (먼저 npm run football:fetch)" >&2
  exit 2
fi
DIR="$(cd "$DIR" && pwd)"

# 데이터셋 버전 = 그 폴더의 마지막 커밋 해시 앞 7자리, 커밋 안 된 변경이 있으면 -dirty
version=unknown
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  version="$(git -C "$ROOT" log -1 --format=%h --abbrev=7 -- "$DIR" 2>/dev/null || true)"
  [ -n "$version" ] || version=uncommitted
  if [ -n "$(git -C "$ROOT" status --porcelain -- "$DIR" 2>/dev/null)" ]; then version="$version-dirty"; fi
fi

echo "축구 데이터 적재: $DIR (데이터셋 $version)"
# \copy는 상대 경로를 쓰므로 CSV 폴더에서 실행한다
cd "$DIR"
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -v version="$version" -f "$ROOT/scripts/football/load.sql"

#!/usr/bin/env bash
# 적재 스크립트 검사 (설계 2026-11-01 §9.2, 계획 Task 4). scripts/db-test.sh가 마이그레이션 뒤 임시 DB로 부른다.
#   TEST_DB_URL=postgres://… bash scripts/football/load-test.sh
# 픽스처(supabase/tests/fixtures/football)를 기준으로 멱등, 폐기·복구, 실패 시 원상태 유지를 본다.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIX="$ROOT/supabase/tests/fixtures/football"
LOAD="$ROOT/scripts/football/load.sh"
: "${TEST_DB_URL:?TEST_DB_URL이 필요합니다}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/football-load-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

fails=0
pass() { echo "ok - $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }
q() { psql "$TEST_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 -c "$1"; }
load() { DATABASE_URL="$TEST_DB_URL" bash "$LOAD" "$@" >"$WORK/load.log" 2>&1; }

# 테이블별 내용 해시 (honours의 identity id는 다시 넣을 때마다 바뀌므로 뺀다)
snapshot() {
  q "select string_agg(t || '=' || h, ' ' order by t) from (
    select 'nations' t, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) h from public.football_nations x
    union all select 'competitions', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.football_competitions x
    union all select 'teams', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.football_teams x
    union all select 'players', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.football_players x
    union all select 'team_competitions', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.football_team_competitions x
    union all select 'aliases', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.football_aliases x
    union all select 'external_ids', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.football_external_ids x
    union all select 'spells', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.football_spells x
    union all select 'caps', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.football_caps x
    union all select 'honours', md5(coalesce(string_agg(x::text, '|' order by x::text), ''))
      from (select honour, season, team_id, player_id from public.football_honours) x
  ) s"
}

# 픽스처 사본을 만들어 고친다: copy <이름>
copy() { rm -rf "$WORK/$1"; cp -r "$FIX" "$WORK/$1"; echo "$WORK/$1"; }

# 1. 적재와 멱등
if load "$FIX"; then pass 'load_fixtures'; else fail 'load_fixtures'; cat "$WORK/load.log"; exit 1; fi
S1="$(snapshot)"
# 해시 질의가 실패해 빈 값끼리 비교하는 일이 없게, 10개 테이블 해시가 다 있는지 먼저 본다
[ "$(printf '%s' "$S1" | grep -oE '[a-z_]+=[0-9a-f]{32}' | wc -l)" = 10 ] && pass 'snapshot_has_10_tables' || { fail 'snapshot_has_10_tables'; exit 1; }
[ "$(q "select count(*) from public.football_players where not retired")" = 5 ] && pass 'players_loaded' || fail 'players_loaded'
[ "$(q "select count(*) from public.football_spells")" = 4 ] && pass 'spells_loaded' || fail 'spells_loaded'
[ "$(q "select birth_date || '/' || birth_precision from public.football_players where id = 'x-kim-minsu-1995'")" = '1995/year' ] \
  && pass 'year_precision_kept' || fail 'year_precision_kept'
[ "$(q "select (colors -> 0 ->> 'hex') from public.football_teams where id = 'Q18741'")" = '#FFFFFF' ] && pass 'colors_jsonb' || fail 'colors_jsonb'
[ "$(q "select coalesce(name_ko, 'NULL') from public.football_players where id = 'x-john-doe-1988'")" = 'NULL' ] \
  && pass 'empty_to_null' || fail 'empty_to_null'
[ -n "$(q "select value from public.football_meta where key = 'dataset_version'")" ] && pass 'meta_dataset_version' || fail 'meta_dataset_version'
[ -n "$(q "select value from public.football_meta where key = 'loaded_at'")" ] && pass 'meta_loaded_at' || fail 'meta_loaded_at'
load "$FIX" || fail 'reload_fixtures'
[ "$(snapshot)" = "$S1" ] && pass 'idempotent' || fail 'idempotent'

# 2. CSV에서 사라진 선수는 retired, 행은 남고 관계 행은 교체된다
D="$(copy minus-mbappe)"
for f in players aliases external_ids spells; do grep -v 'Q21621995' "$FIX/$f.csv" >"$D/$f.csv"; done
if load "$D"; then pass 'load_without_player'; else fail 'load_without_player'; cat "$WORK/load.log"; fi
[ "$(q "select retired from public.football_players where id = 'Q21621995'")" = t ] && pass 'missing_player_retired' || fail 'missing_player_retired'
[ "$(q "select count(*) from public.football_spells where player_id = 'Q21621995'")" = 0 ] && pass 'relations_replaced' || fail 'relations_replaced'
[ "$(q "select count(*) from public.football_aliases where entity_id = 'Q21621995'")" = 0 ] && pass 'aliases_replaced' || fail 'aliases_replaced'
[ "$(q "select count(*) from public.football_players where not retired")" = 4 ] && pass 'others_untouched' || fail 'others_untouched'

# 3. 다시 나타나면 복구된다
load "$FIX" || fail 'reload_after_retire'
[ "$(q "select retired from public.football_players where id = 'Q21621995'")" = f ] && pass 'reappeared_player_unretired' || fail 'reappeared_player_unretired'
[ "$(snapshot)" = "$S1" ] && pass 'back_to_original' || fail 'back_to_original'

# 4. 형식이 틀리면 실패하고 DB는 그대로
D="$(copy bad-int)"
sed -i 's/,184,/,abc,/' "$D/players.csv"
grep -q ',abc,' "$D/players.csv" || fail 'bad_int_fixture_edit'
if load "$D"; then fail 'bad_int_rejected'; else pass 'bad_int_rejected'; fi
[ "$(snapshot)" = "$S1" ] && pass 'bad_int_db_unchanged' || fail 'bad_int_db_unchanged'

D="$(copy bad-fk)"
sed -i 's/^Q21621995,Q8682,/Q21621995,Q404,/' "$D/spells.csv"
if load "$D"; then fail 'bad_fk_rejected'; else pass 'bad_fk_rejected'; fi
[ "$(snapshot)" = "$S1" ] && pass 'bad_fk_db_unchanged' || fail 'bad_fk_db_unchanged'

D="$(copy bad-header)"
sed -i '1s/,name_en,/,nm,/' "$D/teams.csv"
if load "$D"; then fail 'bad_header_rejected'; else pass 'bad_header_rejected'; fi
grep -q 'mismatch' "$WORK/load.log" && pass 'bad_header_message' || fail 'bad_header_message'
[ "$(snapshot)" = "$S1" ] && pass 'bad_header_db_unchanged' || fail 'bad_header_db_unchanged'

D="$(copy no-name)"
sed -i 's/^x-john-doe-1988,,John Doe,/x-john-doe-1988,,,/' "$D/players.csv"
if load "$D"; then fail 'empty_required_rejected'; else pass 'empty_required_rejected'; fi
[ "$(snapshot)" = "$S1" ] && pass 'empty_required_db_unchanged' || fail 'empty_required_db_unchanged'

# 5. 인자·환경 오류
if DATABASE_URL= bash "$LOAD" "$FIX" >/dev/null 2>&1; then fail 'requires_database_url'; else pass 'requires_database_url'; fi
if DATABASE_URL="$TEST_DB_URL" bash "$LOAD" "$WORK/nowhere" >/dev/null 2>&1; then fail 'requires_csv_dir'; else pass 'requires_csv_dir'; fi

if [ "$fails" -eq 0 ]; then echo 'load-test: PASS'; else echo "load-test: FAIL ($fails)"; exit 1; fi

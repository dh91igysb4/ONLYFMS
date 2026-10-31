# DB 테스트 공용 함수 (Ruling R1). source해서 쓴다.
# db_start: 임시 Postgres 16 클러스터를 띄운다(유닉스 소켓 + 127.0.0.1:$PORT).
# db_migrate: shim.sql → migrations/*.sql(이름순).
# db_stop: 서버를 멈추고 임시 폴더를 지운다.
# 사용 변수: ROOT, TMP(생략하면 새로 만든다), PORT(생략하면 무작위)

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DB=postgres
SUPERUSER=postgres

db_start() {
  TMP="${TMP:-$(mktemp -d "${TMPDIR:-/tmp}/onlyfms-dbtest.XXXXXX")}"
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
  PORT="${PORT:-${DB_TEST_PORT:-$(( 20000 + RANDOM % 20000 ))}}"
  as_pg "$PGBIN/initdb" -D "$DATA" -U "$SUPERUSER" --auth=trust -E UTF8 --locale=C.UTF-8 >"$TMP/initdb.log" 2>&1 \
    || { cat "$TMP/initdb.log"; return 1; }
  as_pg "$PGBIN/pg_ctl" -D "$DATA" -l "$TMP/server.log" -w \
    -o "-k $SOCK -p $PORT -c listen_addresses=127.0.0.1 -c fsync=off" start >/dev/null \
    || { cat "$TMP/server.log"; return 1; }
  export PGHOST="$SOCK" PGPORT="$PORT" PGUSER="$SUPERUSER" PGDATABASE="$DB"
  # 소유자(슈퍼유저) 연결 = Supabase의 서비스/소유자 연결처럼 RLS를 우회한다
  TEST_DB_URL="postgres://$SUPERUSER@127.0.0.1:$PORT/$DB"
}

db_migrate() {
  local PSQL=(psql -X -q -v ON_ERROR_STOP=1)
  echo "== shim"
  "${PSQL[@]}" -f "$ROOT/supabase/tests/shim.sql"
  shopt -s nullglob
  local m
  for m in "$ROOT"/supabase/migrations/*.sql; do
    echo "== migration $(basename "$m")"
    "${PSQL[@]}" -f "$m"
  done
}

db_stop() {
  local data="$TMP/data"
  if [ "$(id -u)" = "0" ]; then
    runuser -u postgres -- "$PGBIN/pg_ctl" -D "$data" -m immediate stop >/dev/null 2>&1 || true
  else
    "$PGBIN/pg_ctl" -D "$data" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
}

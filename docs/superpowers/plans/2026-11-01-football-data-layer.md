# 축구 데이터 계층 (1차) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 위키데이터에서 11개 리그(프리미어리그 15시즌, 나머지 10시즌)와 레전드 수동 명단의 선수·팀·경력 데이터를 CSV로 수집하고, 그 CSV를 Supabase `football_*` 테이블에 멱등하게 적재하며, 승인 사용자가 선수·팀을 한글·영문·악센트 없는 표기로 검색할 수 있게 한다.

**Architecture:** `data/football/*.csv`(git)가 원본이다. 수집기(`scripts/football/fetch-wikidata.ts`, 순수 부분 `wikidata.ts`)가 CSV를 쓰고, 적재기(`scripts/football/load.sh` + `load.sql`, psql)가 한 트랜잭션으로 DB에 넣는다. 엔터티는 `retired`로 폐기하고, 관계 테이블은 통째로 교체한다. 검색은 별칭 테이블의 정규화 열(`football_norm`)에 trigram 인덱스와 부분 일치를 함께 쓰는 SQL 함수다.

**Tech Stack:** Node 22(`.ts` 직접 실행) + Vitest, Postgres 16(로컬 테스트)·Supabase Postgres(`pg_trgm`, `unaccent`, RLS, pgTAP), bash + psql.

**Spec:** `docs/superpowers/specs/2026-11-01-football-data-layer-design.md` (선행: `docs/superpowers/specs/2026-10-31-football-data-design.md` §1~§4.3). `CLAUDE.md`를 먼저 읽는다.

## Global Constraints

- 엔터티 ID는 위키데이터 QID이며 바꾸거나 재사용하지 않는다. 엔터티(국가·대회·팀·선수) 행은 지우지 않고 `retired = true`로 둔다.
- `scripts/football/wikidata.ts`는 순수 함수만(입출력 없음). 네트워크·파일 입출력은 `fetch-wikidata.ts`만 한다. 상대 import는 `.ts` 확장자를 붙인다.
- CSV는 UTF-8, 헤더 있음, RFC 4180, 기본 키 순 정렬(`cmp`, 코드 포인트 비교). 열 구성은 설계 §5.2와 정확히 같다. 수집기가 만든 파일은 손으로 고치지 않고 `manual/`로 보정한다.
- DB 변경은 `npx supabase@2 migration new football`로 만든 새 파일로만 한다. 기존 마이그레이션은 고치지 않는다. 이름이 `20261101020200_yacht_public.sql`보다 뒤인지 확인한다(CLAUDE.md 주의 사항).
- 새 테이블·함수는 `anon`·`authenticated`의 기본 권한을 회수한 뒤 필요한 것만 grant한다. 승인 확인은 기존 `public.is_approved()`, `public._require_approved()`(예외 메시지 `forbidden`)를 쓴다.
- 확장은 `create extension if not exists … with schema extensions`. 정규화 함수는 `extensions.unaccent('extensions.unaccent'::regdictionary, …)` 2인자 형식을 `immutable`로 감싼다.
- 원격 `DATABASE_URL`, API 키 같은 비밀값은 커밋하지 않는다.
- 이 클라우드 환경은 `query.wikidata.org`가 막혀 있다(403). 네트워크가 필요한 단계(Task 1 Step 1, Task 6)는 사람이 로컬 PC에서 하거나, 환경의 Allowed domains에 그 도메인을 추가한 뒤 한다. 네트워크 결과를 지어내지 않는다.
- `npm run db:test`에는 `pgtap` 확장이 필요하다. 없으면 `apt-get install -y postgresql-16-pgtap`으로 설치한다(이 클라우드 컨테이너에서 확인함).
- 커밋 메시지는 `type: 내용`(한국어 가능)과 세션 트레일러. 푸시 전에 `npm test && npm run typecheck && npm run build`, DB를 바꾼 Task는 `npm run db:test`까지 돌린다.

## Review Focus

1. 적재 중간에 실패해도(형식이 틀린 CSV, FK 위반) DB가 적재 전 상태 그대로 남는다. Task 4 `load-test.sh`로 고정한다.
2. CSV에서 사라진 선수는 `retired = true`가 되고 행은 남는다. 다시 나타나면 `retired = false`로 돌아온다. 관계 행(경력 등)은 CSV 내용과 정확히 같아진다. Task 4.
3. `football_search` 응답에는 경력·소속·생일 전체가 없다(생년만). 비승인 사용자는 `forbidden`, 익명 사용자는 실행 권한이 없다. Task 5.
4. 짧은 한글 이름(`흥민`)과 띄어쓰기·하이픈·악센트가 다른 영문 입력(`son heung min`, `mbappe`)이 같은 선수를 찾는다. Task 5.
5. 2013년에 프리미어리그, 지금은 챔피언십인 팀의 수집 창 시작이 2012다(리그별 창 중 가장 이른 것). Task 1 `teamStarts` 테스트.
6. `data/football/`에 실데이터가 없을 때 `npm test`가 실패하지 않고 실데이터 검사만 건너뛴다. Task 2.

---

### Task 1: 수집기 — 리그별 시즌 창, K리그1, 레전드 명단

**Files:**
- Modify: `scripts/football/leagues.ts`, `scripts/football/wikidata.ts`, `scripts/football/fetch-wikidata.ts`, `scripts/football/wikidata.test.ts`
- Create: `data/football/manual/legends.csv` (헤더 `player_id,note`만)

**Interfaces:**
- `League`에 `seasons: number`(수집 시즌 수), `teams: number`(정규 시즌 참가팀 수) 추가. 프리미어리그 `seasons: 15, teams: 20`, 나머지 `seasons: 10`. 리그별 `teams`: 챔피언십 24, 라리가 20, 세리에 A 20, 분데스리가 18, 리그 1 18, 프리메이라리가 18, 벨기에 16, 에레디비시 18, 쉬페르리그 19(시즌마다 다르므로 최근 값, 경고 기준일 뿐), K리그1 12.
- `wikidata.ts`에 추가하거나 바꾸는 함수:
  - `currentSeason(now: Date): number`: 7월(월 인덱스 6) 이후면 올해, 아니면 작년. `fetch-wikidata.ts`의 기존 계산을 옮긴다.
  - `seasonWindows(leagues: readonly League[], to: number, override?: number): Map<string, { from: number; to: number }>`: `from = to − (override ?? l.seasons) + 1`
  - `qSeasons(windows: ReadonlyMap<string, {from,to}>): string`: `VALUES (?league ?from ?to) { (wd:Q9448 2012 2026) … }`, `FILTER(YEAR(?start) >= ?from && YEAR(?start) <= ?to)`. 나머지 패턴은 기존과 같다.
  - `teamStarts(teamComps: readonly TeamCompetition[], leagueClubs: readonly { league: string; team: string }[], windows): Map<string, number>`: 팀별로 창 안의 참가 기록이 있는 리그들과 `P118` 리그들의 `from` 중 최솟값(설계 §3.3의 2). 창 밖 기록만 있는 팀은 제외.
  - `coverage(teamComps, leagues, windows)`: 리그마다 자기 창의 시즌별 팀 수를 내고, 0이거나 `league.teams`보다 적은 칸에 경고 표시를 한다. 반환 `{ league, from, counts }[]`.
  - `mergeLegends(found: readonly string[], legends: readonly Row[]): { ids: string[]; added: string[] }`: QID 형식(`^Q\d+$`)이 아닌 값은 버리고, 정렬된 합집합을 만든다.
  - `qOccupation(players)`: 레전드가 축구 선수(`P106 = Q937857`)인지 확인하는 질의. 결과에 없는 레전드는 경고 후 제외한다.
- `fetch-wikidata.ts` 인자: `--to`, `--seasons N`(모든 리그 덮어쓰기), `--leagues`, `--limit-teams`, `--out`, `--cache`, `--no-cache`. `--from`은 없앤다(넘기면 "`--seasons`를 쓰세요" 오류). 선수 찾기는 `teamStarts`를 시작 연도별로 묶어 `qPlayersAtTeams(chunk, start, to)`를 호출한다. 3단계 뒤에 `manual/legends.csv`를 병합하고 직업을 확인한다.

- [x] **Step 1: K리그1 QID 확인 (네트워크 필요, 사람 또는 허용된 환경)** — *2026-11-02: 사람이 질의 결과를 전달 → `Q2386334`(K리그1, 시즌 37개). 옛 'K리그' Q482403(시즌 9개)은 쓰지 않음. `leagues.ts`에 추가* — `query.wikidata.org`에서 아래 질의를 돌려 현재 리그 항목과 시즌 항목(`P3450`)이 붙은 항목을 확인한다. 옛 이름 항목(K리그 클래식)이 따로 있으면 시즌이 어느 쪽에 붙는지 본다. 확인한 QID를 이 계획과 설계 §3.1 표에 적는다. 네트워크가 없으면 여기서 멈추고 사람에게 이 질의 결과를 요청한다(QID를 추측하지 않는다).
  ```sparql
  SELECT ?league ?leagueLabel (COUNT(?season) AS ?n) WHERE {
    ?league wdt:P31/wdt:P279* wd:Q15991303 ; wdt:P17 wd:Q884 .
    OPTIONAL { ?season wdt:P3450 ?league }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "ko,en". }
  } GROUP BY ?league ?leagueLabel ORDER BY DESC(?n)
  ```
- [x] **Step 2: 테스트 추가** (`wikidata.test.ts`)
  - `currentSeason`: 2026-06-30 → 2025, 2026-07-01 → 2026, 2026-11-01 → 2026
  - `seasonWindows`: 프리미어리그 15 → `{2012, 2026}`, 라리가 → `{2017, 2026}`, `override = 3` → 모두 `{2024, 2026}`
  - `qSeasons`: 리그별 VALUES 줄에 각자의 창이 들어감
  - `teamStarts`: EPL 2013과 챔피언십 2024 기록이 있는 팀 → 2012, 챔피언십만 → 2017, `P118`로만 잡힌 EPL 클럽 → 2012, 창 밖(EPL 2010) 기록만 있는 팀은 제외
  - `coverage`: K리그1 12팀 시즌은 경고 없음, 프리미어리그 19팀 시즌은 경고, 리그별 `counts` 길이가 창 길이(15·10)
  - `mergeLegends`: 중복·비QID 제거, `added`는 새로 더해진 것만
  - `qOccupation` 문장에 `Q937857`과 입력 QID가 들어감
- [x] **Step 3: 실패 확인** — `npx vitest run scripts/football/wikidata.test.ts`
- [x] **Step 4: 구현** — `leagues.ts`(Step 1의 K리그1 포함), `wikidata.ts`, `fetch-wikidata.ts`. 끝 출력에 "레전드 n명 추가, 제외 m명(축구 선수 아님)"을 보탠다. `legends.csv`는 헤더만 만든다.
- [x] **Step 5: 통과 확인** — `npx vitest run scripts/football && npm run typecheck`. 네트워크가 되는 환경이면 시험 수집 `npm run football:fetch -- --leagues Q9448 --limit-teams 5 --out /tmp/fb`가 끝나는지 확인한다(결과는 커밋하지 않음).
- [ ] **Step 6: 커밋** — `feat: 축구 수집기 리그별 시즌 창·K리그1·레전드 명단`

---

### Task 2: CSV 검사와 테스트 픽스처

**Files:**
- Create: `scripts/football/schema.ts` (파일별 열·기본 키·참조 규칙을 데이터로 정의, 순수)
- Create: `scripts/football/data.test.ts`
- Create: `supabase/tests/fixtures/football/{competitions,nations,teams,team_competitions,players,aliases,external_ids,spells,caps,honours}.csv`
- Modify: `scripts/football/fetch-wikidata.ts` (쓰기 열 목록을 `schema.ts`에서 가져와 한 곳에서 관리)

**Interfaces:**
- `schema.ts`
  - `export const FILES: Record<FileName, { columns: string[]; key: string[]; order: string[] }>`: 설계 §5.2 표 그대로. `key`는 중복 금지(DB 기본 키), `order`는 파일 안 행 순서(리뷰용, 예: 경력은 `player_id, start_date, source_ref`, 시즌 참가팀은 `competition_id, season, team_id`). 수집기가 쓰던 순서를 그대로 옮겼고, 대회만 `leagues.ts` 순서 대신 id 순으로 바꿨다.
  - `export function sortRows(file, rows)`: `order` 순 정렬 사본. 수집기가 CSV를 쓸 때 쓴다.
  - `export function checkDataset(dataset: { files: Record<FileName, Row[]>; headers: Record<FileName, string[]> }, legends?: Row[]): string[]`: 오류 메시지(`파일:줄: 내용`) 목록을 돌려준다(빈 배열이면 통과). 검사 항목은 설계 §9.1 전부(헤더 일치, 기본 키 중복·정렬, 참조, 날짜·정밀도, enum, popularity 범위, colors JSON 배열, 레전드 반영)에 더해 ID 형식(`Q숫자` 또는 `x-소문자`), 필수 이름(`name_en`), 우승·개인상 행 모양.
  - 수집기는 CSV를 다 쓴 뒤 같은 `checkDataset`을 돌려 오류를 출력하고 종료 코드 1로 끝낸다(파일은 남김).
- 픽스처 내용(최소, 테스트가 이름으로 참조):
  - 국가: 대한민국 Q884, 잉글랜드 Q21, 프랑스 Q142, 스페인 Q29
  - 대회: 프리미어리그 Q9448, 라리가 Q324867
  - 팀: 토트넘 Q18741(club), 함부르크 Q13416(club, nation Q183이면 독일 Q183도 국가에 추가), 레알 마드리드 Q8682(club), 대한민국 대표팀(national, 실제 QID를 쓰거나 `x-kor-nt` 형식), 폐기 확인용 `x-old-fc`(club)
  - 선수: 손흥민 Q439722(`name_ko 손흥민`, `name_en Son Heung-min`, 별칭 `Sonny`), 킬리안 음바페 Q21621995(`Kylian Mbappé`), 동명이인 2명(`name_en` 같고 생년 다름, `x-` ID), 생일 정밀도 `year`인 선수 1명, 한글 이름 없는 선수 1명
  - 경력: 손흥민 함부르크(임대 아님)→레버쿠젠 생략 가능→토트넘, 음바페 레알 마드리드. `source_ref`는 `fx-1`, `fx-2` …
  - 국가대표, 우승(`Q9448` 시즌 하나), 개인상(`award:Q166177` 등) 각 1행 이상
- `data.test.ts`
  - `fixtures pass`: 픽스처가 `checkDataset` 통과
  - 규칙별 실패 케이스: 픽스처를 메모리에서 바꿔 각 규칙이 정확한 오류를 내는지(헤더 열 순서 바뀜, PK 중복, 정렬 깨짐, 없는 선수 참조, `caps.team_id`가 club, 날짜 `2020-13-01`, 정밀도 `year`인데 날짜가 `YYYY-MM-DD`, `position = ST`, `popularity = 101`, `colors = "red"`, 레전드 누락)
  - `real data`: `data/football/players.csv`가 있으면 실데이터 전체 검사, 없으면 `test.skip`

- [x] **Step 1: 픽스처 CSV 작성** (실제 QID는 위키데이터를 볼 수 없으면 `x-` ID로 대신한다. 테스트는 ID가 아니라 이름으로 검사한다)
- [x] **Step 2: `data.test.ts` 작성 → 실패 확인** — `npx vitest run scripts/football/data.test.ts`
- [x] **Step 3: `schema.ts` 구현, 수집기가 `FILES` 열 목록을 쓰도록 바꿈**
- [x] **Step 4: 통과 확인** — `npx vitest run scripts/football && npm run typecheck`
- [x] **Step 5: 커밋** — `test: 축구 CSV 형식·참조 검사와 테스트 픽스처`

---

### Task 3: DB 스키마·RLS·정규화 함수

**Files:**
- Create: `supabase/migrations/20261102061500_football.sql` (`npx supabase@2 migration new football`)
- Create: `supabase/tests/11_football.test.sql` (스키마·권한 부분, 검색은 Task 5에서 더함)

**Interfaces:**
- 확장 `pg_trgm`, `unaccent` (schema `extensions`)
- 함수 `public.football_norm(x text) returns text language sql immutable parallel safe set search_path = ''`: `regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, x)), '[[:space:]\-.''’·]', '', 'g')`. `null` 입력은 `null`.
- 테이블은 설계 §6.2·§6.3 그대로이다. 날짜 text 열의 check는 `~ '^\d{4}(-\d{2}-\d{2})?$'`이고, `date_precision`·`birth_precision`과 길이가 맞는지도 check로 묶는다(`year` ↔ 4자, `day` ↔ 10자).
- 인덱스는 설계 §6.4. `football_aliases.alias_norm`은 `gin (alias_norm extensions.gin_trgm_ops)`.
- 권한: 모든 `football_*`에 `alter table … enable row level security`, `revoke all … from anon, authenticated`, `grant select … to authenticated`, 정책 `football_<t>_select for select to authenticated using (public.is_approved())`. `football_norm`은 `authenticated`에 execute 권한.

- [x] **Step 1: `11_football.test.sql` 작성** (기존 `07_duel.test.sql`의 사용자 생성·역할 전환 방식을 따른다)
  - `tables_exist`: 11개 테이블
  - `rls_enabled`: 모두 `relrowsecurity`
  - `approved_reads`: 테스트 안에서 소유자로 국가·선수 1행씩 넣고, 승인 사용자로 select하면 보이고 대기 사용자는 0행
  - `anon_denied`: anon의 select는 권한 오류
  - `no_writes`: 승인 사용자의 insert·update·delete는 권한 오류(테이블 3개 이상 표본)
  - `norm_examples`: `Son Heung-min` → `sonheungmin`, `Mbappé` → `mbappe`, `손 흥민` → `손흥민`, `Ødegaard` → `odegaard`, `O'Shea` → `oshea`
  - `alias_norm_generated`: 별칭을 넣으면 `alias_norm`이 채워짐
  - `date_checks`: `birth_precision = 'year'`에 `1992-07-08`을 넣으면 check 위반, `honours`에 같은 (honour, season, null, player) 두 번이면 unique 위반
- [x] **Step 2: 실패 확인** — `npm run db:test`
- [x] **Step 3: 마이그레이션 구현** — 이름이 `20261101020200_yacht_public.sql`보다 뒤인지 확인한다.
- [x] **Step 4: 통과 확인** — `npm run db:test` 전체 PASS
- [x] **Step 5: 커밋** — `feat: football_* 스키마·RLS·이름 정규화 함수`

---

### Task 4: 적재 스크립트 (`npm run football:load`)

**Files:**
- Create: `scripts/football/load.sh`, `scripts/football/load.sql`, `scripts/football/load-test.sh`
- Modify: `package.json` (`"football:load": "bash scripts/football/load.sh"`), `scripts/db-test.sh` (마이그레이션 뒤 픽스처 적재, pg_prove 뒤 `load-test.sh`)

**Interfaces:**
- `load.sh [dir]`: 기본 `data/football`. `DATABASE_URL`이 없으면 오류로 끝낸다. 데이터셋 버전은 `git log -1 --format=%h -- "$dir"`, `git status --porcelain -- "$dir"`가 비어 있지 않으면 `-dirty`, git 밖이면 `unknown`. `cd "$dir"` 뒤 `psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -v version="$v" -f "$ROOT/scripts/football/load.sql"`을 실행한다(`\copy`는 상대 경로).
- `load.sql`: `begin;` → 파일별 `create temp table s_<t> (<열> text, …) on commit drop;` + `\copy s_<t> from '<t>.csv' with (format csv, header match)` → 엔터티 upsert(국가 → 대회 → 팀 → 선수, `nullif(x,'')::int` 등 형 변환, `retired = false`) → `update … set retired = true where id not in (select id from s_<t>)` → 관계 테이블 `delete` 후 `insert … select` (선수 → 팀 FK 순서) → `football_meta` upsert(`dataset_version = :'version'`, `loaded_at = now()::text`) → 테이블별 `count(*)`와 폐기 수 출력 → `commit;`
- `header match`(PG15+)로 CSV 열 이름이 다르면 실패한다.
- `load-test.sh`(db-test 안에서 이미 뜬 임시 DB의 `TEST_DB_URL`을 쓴다)
  1. 픽스처를 적재한 직후 상태에서 테이블별 행 수와 내용 해시(`md5(string_agg(t::text, '|' order by …))`)를 저장 → 다시 적재 → 같아야 함
  2. 픽스처를 임시 폴더에 복사해 선수 한 명 행과 그 선수의 경력·별칭·국가대표 행을 지움 → 적재 → 그 선수 `retired = true`, 행은 남음, 그 선수의 경력 0행
  3. 원래 픽스처를 다시 적재 → 그 선수 `retired = false`, 경력 복구
  4. `players.csv`의 `height_cm`에 `abc`를 넣은 사본 → 적재 실패(종료 코드 ≠ 0), 해시가 3번 상태와 같음
  5. 열 이름을 바꾼 `teams.csv` 사본 → 실패
  각 검사 실패 시 `FAIL: <이름>`을 출력하고 종료 코드 1, 모두 통과하면 `load-test: PASS`.
- `db-test.sh` 순서: `db_start` → `db_migrate` → `DATABASE_URL=$TEST_DB_URL bash scripts/football/load.sh supabase/tests/fixtures/football` → `pg_prove` → `TEST_DB_URL=… bash scripts/football/load-test.sh`. pgTAP 테스트는 각자 롤백하므로 픽스처는 그대로 남는다.

- [x] **Step 1: `load-test.sh` 작성 → `db-test.sh`에 연결 → 실패 확인** (`npm run db:test` → load.sh 없음)
- [x] **Step 2: `load.sh`·`load.sql` 구현**
- [x] **Step 3: 통과 확인** — `npm run db:test` (pgTAP PASS, `load-test: PASS`)
- [x] **Step 4: Task 3의 `approved_reads`를 픽스처 기준으로 단순화할 수 있으면 정리** (선택) — *하지 않음: 11_football은 자기 x-t3-* 행으로 검사해 픽스처와 독립적이라 그대로 둠*
- [x] **Step 5: 커밋** — `feat: 축구 CSV 적재 스크립트(멱등·폐기 처리·한 트랜잭션)`

---

### Task 5: 검색 RPC `football_search`

**Files:**
- Create: `supabase/migrations/20261102062215_football_search.sql`
- Create: `supabase/tests/12_football_search.test.sql` (검색 테스트는 별도 파일로 둠)
- Modify: `supabase/migrations/20261102061500_football.sql` (RLS 정책을 `(select public.is_approved())`로, 머지 전이라 같은 파일 수정)

**Interfaces:**
- `public.football_search(p_q text, p_kind text, p_lim int default 10) returns table(id text, kind text, name_ko text, name_en text, nation_id text, position text, birth_year int, team_kind text)`
  - *구현 중 변경 (2026-11-02)*: 인자 `p_` 접두사(반환 열 `kind`와 이름 충돌), `security definer`(RLS 아래서는 trigram 인덱스를 못 씀), 후보 찾기를 `_football_match_long`(3글자 이상, `enable_seqscan = off`)·`_football_match_short`(1~2글자, 순차 스캔)로 분리. 승인 확인은 `is_approved()`로 직접(`_require_approved()`는 authenticated 실행 권한 없음). 설계 §8 갱신.
  - `language plpgsql stable security definer set search_path = public, extensions`
  - 승인 아니면 `forbidden` → `p_kind not in ('player','team')`면 `raise exception using errcode = 'P0001', message = 'bad_kind'`
  - `n := football_norm(q)`. 비었으면 빈 결과. `lim := greatest(1, least(coalesce(lim,10), 20))`
  - 후보: `football_aliases a where a.alias_norm like '%'||n||'%' or a.alias_norm % n`(`%` 연산자는 `extensions.%`, 유사도 기준은 `set_limit` 대신 `similarity(a.alias_norm, n) >= 0.3` 조건으로 명시)
  - 엔터티별 점수 `max(case when alias_norm = n then 3 when alias_norm like n||'%' then 2 when alias_norm like '%'||n||'%' then 1 else 0 end)`, `max(similarity(...))`
  - 선수: `football_players p join … where not p.retired`, 정렬 점수 desc, 유사도 desc, `popularity` desc, `id`. `birth_year = left(birth_date,4)::int`
  - 팀: `football_teams t where not t.retired`, 정렬 점수 desc, 유사도 desc, `name_en`, `id`
  - `n`에 `%`·`_`가 들어 있으면 `like` 전에 이스케이프한다.
- 권한: `revoke all on function … from public, anon; grant execute … to authenticated`

- [x] **Step 1: pgTAP 추가** (픽스처가 적재된 상태를 전제)
  - `search_ko_full`: `손흥민` → 첫 결과 손흥민
  - `search_ko_partial`: `흥민` → 손흥민 포함
  - `search_en_variants`: `son heung min`, `Son Heung-min`, `sonny` → 손흥민
  - `search_accent`: `mbappe` → `Kylian Mbappé`
  - `search_homonyms`: 동명이인 두 명 모두 나오고 `birth_year`가 다름, 순서는 `popularity`
  - `search_team`: `tottenham`(또는 픽스처 별칭) → `team_kind = 'club'`, 선수 검색에는 안 나옴
  - `search_retired_excluded`: 폐기 엔터티(`x-old-fc`를 테스트 안에서 `retired = true`로 바꿈)는 안 나옴
  - `search_lim`: `lim = 100` → 최대 20, `lim = 0` → 1
  - `search_empty`: `'  - '` → 0행
  - `search_bad_kind`: `throws_ok … 'bad_kind'`
  - `search_forbidden`: 대기 사용자 → `forbidden`
  - `search_anon_denied`: anon 실행 권한 없음
  - `search_columns`: 반환 열 이름이 정확히 8개(경력·소속·생일 열 없음)
  - `search_like_escape`: `%`만 넣으면 전체가 나오지 않음
- [x] **Step 2: 실패 확인** — `npm run db:test`
- [x] **Step 3: 구현**
- [x] **Step 4: 통과 확인** — `npm run db:test`, 그리고 `explain`으로 별칭 1만 행을 넣었을 때 trigram 인덱스가 쓰이는지 한 번 확인한다(테스트에는 넣지 않음, PR 설명에 결과 기록).
  - 측정(별칭 6만 행, 승인 사용자, 2026-11-02): 처음 구현은 RLS 정책의 행마다 `is_approved()` 호출과 RLS 아래 인덱스 불가로 250~570ms. 정책을 `(select …)`로, 함수를 정의자로, 1~2글자 경로를 분리한 뒤 `sonheung` 8~10ms, `흥민` 7ms, `손` 7ms, `선수 123` 44ms. 모든 별칭이 `Player`로 시작하는 합성 데이터의 `player 1a`는 100ms(후보 수천 개, 실제 이름에서는 드묾).
- [x] **Step 5: 커밋** — `feat: 선수·팀 검색 RPC football_search`

---

### Task 6: 첫 실데이터 수집과 데이터 PR (네트워크 필요, 사람 주도)

**Files:**
- Create: `data/football/*.csv` (수집기 출력)
- Modify: `data/football/manual/team_competitions.csv`, `data/football/manual/names_ko.csv`, `data/football/manual/legends.csv` (필요한 만큼)
- Modify: 설계 §7.4 (실제 용량)

- [x] **Step 1: 전체 수집** — 로컬 PC 또는 위키데이터가 허용된 환경에서 `npm run football:fetch` (40분~1시간 예상). 중간에 끊기면 다시 돌린다(캐시로 이어 감).
- [ ] **Step 2: 커버리지 표 확인** — 경고 칸(특히 K리그1, 2026 시즌)을 위키백과 등에서 확인해 `manual/team_competitions.csv`에 채우고 다시 수집한다(캐시가 있어 빠름).
  - *2026-11-02 첫 수집 결과*: 라리가·리그 1만 빈칸 없음. 위키데이터 P1923이 빈 시즌이 많다: 프리미어리그 25/26~, 분데스리가 26/27, 세리에 A 23/24~, 에레디비시 21/22~, 챔피언십 20/21~, 프리메이라리가·쉬페르리그 대부분, 벨기에 거의 전부, K리그1 전 시즌(3~7팀).
  - K리그1 2017~2025는 `manual/team_competitions.csv`로 채움(108행, 2026은 승강 결과 확인 후). 상주 상무 Q484536(~2020), 김천 상무 Q104099625(2021~).
  - 나머지 리그의 빈 시즌은 수가 많아 손으로 채우기 어렵다. openfootball(퍼블릭 도메인, 원 설계 §4.3) football.json이 en.1·en.2·de.1·es.1·it.1·fr.1·nl.1·pt.1(18/19~)을 2026/27까지, europe 저장소가 쉬페르리그를 텍스트로 가진다(벨기에 일부, K리그 없음). 출처 추가 여부는 사람이 정한다.
  - *2026-11-03*: openfootball 추가로 결정(설계 §3.5). `npm run football:openfootball -- --merge`로 반영. 다음 `football:fetch` 때 함께 합쳐진다.
- [ ] **Step 3: 레전드 첫 명단** — *2026-11-02 변경: 발롱도르 후보 381명(설계 §3.4).* `npm run football:legends`로 `legends.csv`를 만들고, 확인 필요·못 찾음을 `ballon_dor_nominees.csv`의 `player_id`로 정한 뒤 다시 돌린다. 그다음 다시 수집한다.
- [ ] **Step 4: 검사** — `npm test` (실데이터 `checkDataset` 통과). 오류가 나면 수집기 버그는 Task 1 코드로, 데이터 문제는 `manual/`로 고친다.
- [x] **Step 5: 로컬 적재 확인** — `npm run db:test`의 임시 DB 대신 `bash scripts/db-up.sh`로 띄운 DB에 `DATABASE_URL=… npm run football:load`를 실행해 행 수와 소요 시간을 기록한 뒤 `db-down.sh`
- [x] **Step 6: 용량 기록** — 파일별 크기·행 수, DB 크기(`pg_total_relation_size`)를 설계 §7.4에 적는다. `spells.csv`가 50MB를 넘으면 멈추고 사람과 범위를 다시 정한다.
- [ ] **Step 7: 커밋** — `chore: 축구 데이터 첫 수집 (11개 리그, 데이터셋 <해시>)`

---

### Task 7: 문서와 배포 절차

**Files:**
- Modify: `docs/deploy-checklist.md`, `CLAUDE.md`, `data/football/README.md`

- [ ] **Step 1: `docs/deploy-checklist.md`**
  - §2의 "`0001`~`0005`" 문구를 "아직 원격에 없는 `supabase/migrations/` 전부(`npx supabase@2 migration list`로 확인)"로 고친다.
  - "축구 데이터" 절 추가: ① `npx -y supabase@2 db push` (football 마이그레이션) ② psql 설치 확인 후 `DATABASE_URL='<대시보드 → Connect → Session pooler 연결 문자열>' npm run football:load` ③ SQL 편집기에서 `select * from football_meta;`와 `select count(*) from football_players;` ④ 승인 계정으로 브라우저 콘솔에서 `supabase.rpc('football_search', { p_q: '손흥민', p_kind: 'player' })`가 결과를 돌려주는지 ⑤ 문제가 생기면 출력 전문을 보고
- [ ] **Step 2: `CLAUDE.md`**
  - 설계 목록에 `docs/superpowers/specs/2026-11-01-football-data-layer-design.md`
  - 폴더 규칙에 `data/football/`(원본 CSV, 수집기 출력은 손으로 고치지 않음, 보정은 `manual/`), `scripts/football/`
  - "축구 데이터 갱신" 절: `football:fetch` → 커버리지·`manual/` 보정 → `npm test` → 데이터 PR → 머지 후 원격 `football:load`(배포 체크리스트 "축구 데이터" 절). 이적 시장 뒤 갱신. 클라우드 환경은 위키데이터가 막혀 있다는 주의.
  - 개발 환경에 `npm run football:load`(`DATABASE_URL` 필요)
- [ ] **Step 3: `data/football/README.md`** — 리그 11개와 리그별 시즌 수, `--seasons`(기존 `--from` 대체), `manual/legends.csv`, 적재 방법, 프록시·클라우드 네트워크 주의
- [ ] **Step 4: 전체 검증** — `npm test && npm run typecheck && npm run build && npm run db:test && npm run fn:test`
- [ ] **Step 5: 커밋** — `docs: 축구 데이터 적재·갱신 절차`

---

## 순서와 의존

- Task 1 → (Task 2, Task 3 병행 가능) → Task 4(픽스처·스키마 필요) → Task 5 → Task 7. Task 6은 Task 1·2가 끝난 뒤 언제든 할 수 있지만, 머지는 Task 4 뒤에 한다(적재 확인 단계 때문).
- Task 1 Step 1(K리그1 QID)과 Task 6은 네트워크가 필요하다. 네트워크가 없으면 Task 1의 K리그1 항목만 빼고 나머지를 진행한 뒤, QID를 받아 한 줄을 추가한다.
- PR은 코드(Task 1~5, 7)와 데이터(Task 6)를 나누는 것을 권장한다. 데이터 PR은 diff가 커서 코드 리뷰를 가린다.

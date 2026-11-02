# ONLYFMS 축구 데이터 계층 설계 (1차: 위키데이터 → CSV → DB → 검색)

- 작성일: 2026-11-01
- 상태: 검토 대기
- 범위: 여러 게임이 함께 쓰는 축구 데이터의 **수집 범위, CSV 원본, Supabase `football_*` 스키마·RLS, 적재 스크립트, 선수·팀 검색 RPC, 테스트, 배포·갱신 절차**. 게임 문제 생성·공유 풀·설정별 은행·은행 자유 플레이는 다루지 않는다(§12).
- 선행 문서: [축구 데이터 계층 설계](2026-10-31-football-data-design.md) (이하 "원 설계"), [ONLYFMS 플랫폼 설계](2026-10-31-onlyfms-platform-design.md)
- 원 설계와의 관계: 원 설계의 §4(데이터 원본), §5 단계 1(DB 스키마), §6.1(검색 RPC), §8(적재·갱신), §9 중 데이터 부분, §10의 1~2번을 **이 문서가 대체**한다. 원 설계의 §1~§3(목표·결정·게임 유형), §4.2(식별자), §4.3(출처·라이선스 원칙)은 그대로 유효하다. §6.2~§6.4, §7, 단계 2·3은 첫 새 게임 설계 때 다시 다룬다.
- 기준 코드: `scripts/football/` (PR #23 위키데이터 수집 스크립트)

## 1. 목표와 성공 기준

공통 축구 데이터의 첫 판을 만들어 DB에 올리고, 승인 사용자가 선수·팀을 이름으로 찾을 수 있게 한다. 이 위에 다음 단계(Box2Box 등 첫 새 게임)가 문제 생성기와 화면을 붙인다.

1. `npm run football:fetch` 한 번으로 §3 범위의 선수·팀·국가·경력·국가대표·수상 데이터가 `data/football/*.csv`로 나오고, 이 CSV가 git에 커밋된 원본이다.
2. `npm run football:load`가 CSV를 로컬·원격 DB의 `football_*` 테이블에 한 트랜잭션으로 넣는다. 두 번 돌려도 결과가 같다(멱등).
3. 승인 사용자는 `football_search`로 한글·영문·악센트 없는 표기 어느 것으로도 선수·팀을 찾는다. 결과에 정답 단서(경력 등)는 없다.
4. 비승인·익명 사용자는 `football_*`를 읽을 수 없고, 누구도 API로 쓸 수 없다.
5. CSV의 형식·참조 무결성은 `npm test`가, 스키마·RLS·검색·적재는 `npm run db:test`가 검사한다.
6. Supabase 무료 등급(DB 500MB) 안에서 운영한다.

## 2. 결정 요약 (2026-11-01)

| 항목 | 결정 | 원 설계와 차이 |
|---|---|---|
| 대상 리그 | 유럽 10개 + K리그1 = **11개** (§3.1) | 원 설계는 5대 리그 + K리그1 |
| 시즌 범위 | **프리미어리그 최근 15시즌, 나머지 최근 10시즌** (§3.2) | 원 설계는 "현역 + 최근 20년 은퇴" |
| 레전드 | 범위 밖 선수는 **수동 명단**으로 추가 (§3.4) | 원 설계는 미정 |
| 출처 | **위키데이터만** (+ 직접 입력). API-Football은 다음 단계 | 원 설계 단계 1은 API-Football 현재 스쿼드 포함 |
| 후알야 출처 전환 | 이번 범위 밖. FotMob 절차 유지 | — |
| 문서 범위 | 데이터 계층만 | 원 설계는 플랫폼 변경·생성기까지 |

## 3. 수집 범위

### 3.1 대상 리그

`scripts/football/leagues.ts`의 `LEAGUES`. `id`는 위키데이터 QID이며 `football_competitions.id`로 그대로 쓴다(영구 고정).

| 리그 | QID | 나라 | 단계 | 시즌 수 |
|---|---|---|---|---|
| 프리미어리그 | Q9448 | 잉글랜드 Q21 | 1 | **15** |
| EFL 챔피언십 | Q19510 | 잉글랜드 Q21 | 2 | 10 |
| 라리가 | Q324867 | 스페인 Q29 | 1 | 10 |
| 세리에 A | Q15804 | 이탈리아 Q38 | 1 | 10 |
| 분데스리가 | Q82595 | 독일 Q183 | 1 | 10 |
| 리그 1 | Q13394 | 프랑스 Q142 | 1 | 10 |
| 프리메이라리가 | Q182994 | 포르투갈 Q45 | 1 | 10 |
| 벨기에 프로리그 | Q216022 | 벨기에 Q31 | 1 | 10 |
| 에레디비시 | Q167541 | 네덜란드 Q55 | 1 | 10 |
| 쉬페르리그 | Q485568 | 튀르키예 Q43 | 1 | 10 |
| **K리그1 (추가)** | 구현 때 확인 | 대한민국 Q884 | 1 | 10 |

- K리그1의 QID는 구현 첫 단계에서 위키데이터에서 확인해 적는다. 리그 항목이 옛 이름(K리그 클래식)과 따로 있으면 **현재 리그 항목** 하나만 쓰고, 시즌 항목이 어느 쪽에 붙어 있는지(`P3450`) 확인한다.
- K리그는 위키데이터의 시즌별 참가팀(`P1923`)이 비어 있을 가능성이 높다. 수집 끝의 커버리지 표에서 빈 칸을 `manual/team_competitions.csv`로 채운다(§5.3). K리그1은 12팀이라 커버리지 표의 "16팀 미만(`!`)" 경고 기준을 리그별 팀 수로 바꾼다(§4).

### 3.2 시즌 범위

- 시즌은 시작 연도 정수(`2025` = 2025/26). **현재 시즌**은 오늘이 7월 이후면 올해, 아니면 작년이다(기존 규칙 유지). 2026-11-01 기준 현재 시즌은 2026.
- 리그마다 `seasons` 값을 둔다. 리그 l의 수집 창은 `[현재 − l.seasons + 1, 현재]`이다.
  - 프리미어리그: 2012~2026 (15시즌)
  - 나머지: 2017~2026 (10시즌)
- 단일 연도로 시즌을 치르는 K리그(3~11월)도 "그해에 시작한 시즌 = 그 연도"라 같은 규칙으로 맞는다. 다만 7월 이전에는 K리그의 그해 시즌이 이미 진행 중인데도 현재 시즌이 작년으로 잡힌다. 수집은 이적 시장 뒤(여름·겨울)에 하므로 겨울(1~2월) 수집에서만 K리그 새 시즌이 빠질 수 있고, 아직 개막 전이라 문제 되지 않는다.
- CLI의 `--to`(현재 시즌 대신), `--seasons N`(모든 리그를 N시즌으로), `--leagues`, `--limit-teams`는 시험용으로 유지한다. 기존 `--from`은 리그별 창과 맞지 않아 `--seasons`로 바꾼다.

### 3.3 선수 선정

1. 리그별 창 안의 시즌 참가팀(위키데이터 `P1923` + `manual/team_competitions.csv`)과, 지금 그 리그 소속으로 적힌 클럽(`P118`)을 **대상 팀**으로 모은다.
2. 팀마다 **수집 창 시작 연도**를 정한다. 창 안에서 그 팀이 참가한 리그들과 지금 소속(`P118`)으로 적힌 리그들의 창 시작 중 가장 이른 해이다. 예: 2013년에 프리미어리그, 지금은 챔피언십인 팀은 2012부터. 승격해 지금 `P118`이 프리미어리그인데 참가 기록이 아직 챔피언십뿐인 팀도 2012부터. 창 밖 참가 기록만 있는 팀은 대상이 아니다.
3. 같은 시작 연도의 팀끼리 묶어 "기간 `[시작년 7월 1일, 현재+1년 6월 30일]`에 그 팀에 있었던 선수"를 찾는다(기존 `qPlayersAtTeams`). 날짜가 하나도 없는 경력 구간은 판별할 수 없어 뺀다. 종료일이 빠진 오래된 구간을 거르려고 시작년에 40세 이하였던 선수만 받는다(기존 규칙).
4. 팀의 창은 리그 참가 시즌만이 아니라 **창 전체**에 적용된다. 예를 들어 2015년에만 프리미어리그에 있었던 팀은 2012~2026 사이 그 팀에 있던 선수를 모두 받는다(2부 시절 선수 포함). 질의를 단순하게 두는 대가이고, 선수가 조금 늘어날 뿐 틀린 데이터는 아니다.
5. 선정된 선수는 **창 밖 구간까지 전체 경력**을 받는다(Career Path에 필요). 경력에 나오는 팀은 대상 리그 밖이어도 `teams.csv`에 들어간다.

### 3.4 레전드 수동 명단

- `data/football/manual/legends.csv` (`player_id,note`): §3.3 범위 밖이지만 넣고 싶은 선수의 위키데이터 QID와 메모(예: `Q1487,티에리 앙리`).
- 수집기는 §3.3에서 찾은 선수에 이 명단을 더한 뒤 같은 방법으로 경력·정보·수상·별칭을 받는다. 명단에 있는데 직업이 축구 선수(`P106 = Q937857`)가 아니면 경고만 하고 뺀다.
- 레전드 경력에 나오는 옛 시즌의 리그 참가 기록(`team_competitions`)은 수집 창 밖이라 생기지 않는다. "프리미어리그에서 뛴 선수" 같은 조건은 창 안에서만 정확하다는 점을 §11에 한계로 적는다.
- 명단을 어떻게 고를지(누가 레전드인가)는 데이터 PR 리뷰에서 정한다. 첫 판은 비워 두거나 소수로 시작한다.

## 4. 수집 스크립트 변경 (`scripts/football/`)

기존 구조(순수 부분 `wikidata.ts` + 입출력 `fetch-wikidata.ts`, 응답 캐시, 시간 초과 묶음 분할)를 유지하고 다음만 바꾼다.

| 파일 | 변경 |
|---|---|
| `leagues.ts` | `League`에 `seasons: number`와 `teams: number`(정규 시즌 참가팀 수, 커버리지 경고 기준) 추가. K리그1 항목 추가. 프리미어리그 `seasons: 15`, 나머지 10 |
| `wikidata.ts` | `seasonWindows(leagues, current)` 리그별 창 계산, `teamStarts(teamComps, leagueClubs, leagues, current)` 팀별 창 시작(§3.3의 2), `qSeasons`를 리그별 창(`VALUES (?league ?from)`)으로, `coverage`가 리그별 창과 `teams` 기준으로 경고 |
| `fetch-wikidata.ts` | 인자 `--seasons`(기존 `--from` 대체), 팀을 시작 연도별로 묶어 선수 찾기, `manual/legends.csv` 병합, 레전드 직업 확인 경고 |
| `wikidata.test.ts` | 위 순수 함수 테스트 추가 |

- 네트워크: 수집기는 Node 내장 `fetch`를 쓴다. 회사·클라우드 프록시 뒤에서 돌리려면 Node 22의 `NODE_USE_ENV_PROXY=1`을 쓸 수 있는지 구현 때 확인하고 README에 적는다. ONLYFMS 클라우드 개발 환경은 현재 네트워크 정책이 `query.wikidata.org`를 막고 있으므로 **수집은 로컬 PC에서 하거나 환경의 허용 도메인에 추가한 뒤** 한다.
- 수집 결과의 열 구성은 지금 스크립트가 쓰는 그대로이다(§5.2).

## 5. CSV 원본 (`data/football/`)

### 5.1 원칙

- UTF-8, 헤더 있음, 쉼표 구분, RFC 4180 따옴표. 빈 값은 빈 칸. 파일마다 기본 키 순(코드 포인트 비교)으로 정렬한다(`toCsv`·`cmp`, 기존).
- 날짜는 `YYYY-MM-DD`. 일 단위를 모르면 `YYYY`만 쓰고 정밀도 열(`birth_precision`, `date_precision`)을 `year`로 둔다.
- **git에 커밋한다.** 데이터 변경은 PR로 리뷰한다. 첫 수집 후 파일 크기를 확인하고, `spells.csv`가 50MB를 넘으면 범위·저장 방식을 다시 정한다(예상은 §7.4).
- 수집기가 쓰는 파일은 손으로 고치지 않는다. 보정은 `manual/`에만 하고 다시 수집해 반영한다.
- 데이터셋 버전 = `data/football/` 디렉터리의 마지막 커밋 해시 앞 7자리. 적재할 때 `football_meta`에 기록한다. 커밋되지 않은 변경이 있으면 `-dirty`를 붙인다.

### 5.2 파일과 열 (수집기 출력)

| 파일 | 열 | 기본 키 | 비고 |
|---|---|---|---|
| `competitions.csv` | id, name_ko, name_en, kind, nation_id, tier | id | `leagues.ts`에서. 지금은 `kind = league`만 |
| `nations.csv` | id, name_ko, name_en, iso2, confederation | id | `iso2`는 소문자. ISO 3166-1이 없으면 3166-2(`gb-eng`). `confederation`은 비어 있음 |
| `teams.csv` | id, kind, name_ko, name_en, short_name, nation_id, colors, founded, retired | id | `kind`는 `club`/`national`. 유스·2군·여자 팀 제외. `colors`는 JSON 문자열 |
| `team_competitions.csv` | team_id, competition_id, season | 세 열 | 위키데이터 + `manual/` 합집합 |
| `players.csv` | id, name_ko, name_en, birth_date, birth_precision, nation_id, position, position_detail, foot, height_cm, shirt_number, popularity, retired | id | `shirt_number`는 비어 있음. `popularity`는 위키 문서 수(sitelinks) 백분위 0~100 |
| `aliases.csv` | entity_id, alias, lang | entity_id, alias | 대표 이름(한·영)도 포함. `lang`은 `ko`/`en` |
| `external_ids.csv` | entity_id, source, external_id | source, external_id | 지금은 `transfermarkt`(위키데이터 P2446)만 |
| `spells.csv` | player_id, team_id, start_date, end_date, date_precision, loan, apps, goals, source_ref | source_ref | **`source_ref`는 위키데이터 경력 진술 ID**(예: `Q11571-1A2B…`). 클럽 구간만 |
| `caps.csv` | player_id, team_id, caps, goals, first_year, last_year | player_id, team_id | 성인 국가대표만 |
| `honours.csv` | honour, season, team_id, player_id | 네 열 | 리그 우승은 `honour = 리그 QID`·`team_id`, 개인상은 `award:<QID>`·`player_id` |

- 원 설계 §5의 `football_spells.id bigint identity`는 CSV에 없어 적재 때 행을 맞출 방법이 없으므로, **`source_ref`를 기본 키로** 쓴다. 나중에 직접 입력 구간이 생기면 `manual:<이름>` 형식으로 붙인다.
- `retired` 열은 수집기가 항상 `false`로 쓴다. 폐기는 적재 때 "CSV에서 사라진 엔터티"로 처리한다(§7.2).

### 5.3 직접 입력 (`manual/`)

| 파일 | 열 | 용도 |
|---|---|---|
| `names_ko.csv` | entity_id, name_ko | 한글 표시 이름 덮어쓰기 (기존) |
| `team_competitions.csv` | team_id, competition_id, season | 위키데이터에 빠진 시즌 참가팀 (기존) |
| `legends.csv` | player_id, note | 범위 밖 레전드 (신규, §3.4) |

## 6. DB 스키마 (`npx supabase@2 migration new football`)

### 6.1 공통 규칙

- 테이블 이름은 `football_` 접두사. 열 값 제한은 Postgres enum 대신 `check` 제약으로 둔다(값 추가가 마이그레이션 한 줄로 끝남).
- RLS를 켜고 `anon`·`authenticated`의 기본 권한을 회수한 뒤 `authenticated`에 `select`만 준다. 정책은 `using (public.is_approved())`. 쓰기 정책은 없다. 적재는 소유자 연결(RLS 우회)로만 한다.
- 데이터는 공개 지식이고 출제 예정 문제가 들어 있지 않아 승인 사용자에게 전부 읽기를 연다(원 설계 §5와 같음).
- 확장: `pg_trgm`, `unaccent`를 `extensions` 스키마에 만든다(`create extension if not exists … with schema extensions`).

### 6.2 엔터티 테이블 (폐기 방식: `retired`)

**football_nations**: `id text pk`, `name_ko text`, `name_en text not null`, `iso2 text`, `confederation text`, `retired boolean not null default false`

**football_competitions**: `id text pk`, `name_ko text not null`, `name_en text not null`, `kind text not null check (kind in ('league','cup','continental','international'))`, `nation_id text references football_nations`, `tier int`, `retired boolean not null default false`

**football_teams**: `id text pk`, `kind text not null check (kind in ('club','national'))`, `name_ko text`, `name_en text not null`, `short_name text`, `nation_id text references football_nations`, `colors jsonb`, `founded int`, `retired boolean not null default false`

**football_players**: `id text pk`, `name_ko text`, `name_en text not null`, `birth_date text`, `birth_precision text check (birth_precision in ('day','year'))`, `nation_id text references football_nations`, `position text check (position in ('GK','DF','MF','FW'))`, `position_detail text`, `foot text check (foot in ('left','right','both'))`, `height_cm int`, `shirt_number int`, `popularity int not null default 0 check (popularity between 0 and 100)`, `retired boolean not null default false`

- `birth_date`는 정밀도가 `year`면 `YYYY`만 들어가므로 `date`가 아니라 `text`(`YYYY` 또는 `YYYY-MM-DD`, 형식은 check 정규식)로 둔다. `spells`의 날짜도 같다.
- `name_ko`는 위키데이터에 한국어 라벨이 없으면 비어 있을 수 있다(화면은 `name_en`으로 대신 표시).
- `nation_id`가 비어 있는 선수·팀이 있을 수 있어 nullable이다.

### 6.3 관계 테이블 (폐기 방식: 통째 교체)

**football_team_competitions**: `team_id text references football_teams`, `competition_id text references football_competitions`, `season int`, pk 세 열

**football_aliases**: `entity_id text not null`, `alias text not null`, `lang text`, `alias_norm text generated always as (public.football_norm(alias)) stored`, pk `(entity_id, alias)`. `entity_id`는 선수·팀 어느 쪽이든 될 수 있어 FK를 걸지 않고, CSV 검사(§9.1)가 존재를 확인한다.

**football_external_ids**: `entity_id text not null`, `source text not null`, `external_id text not null`, pk `(source, external_id)`

**football_spells**: `source_ref text pk`, `player_id text not null references football_players`, `team_id text not null references football_teams`, `start_date text not null`, `end_date text`, `date_precision text not null check (… in ('day','year'))`, `loan boolean not null`, `apps int`, `goals int`

**football_caps**: `player_id text references football_players`, `team_id text references football_teams`, `caps int`, `goals int`, `first_year int`, `last_year int`, pk `(player_id, team_id)`

**football_honours**: `id bigint generated always as identity pk`, `honour text not null`, `season int not null`, `team_id text references football_teams`, `player_id text references football_players`, `unique nulls not distinct (honour, season, team_id, player_id)`

**football_meta**: `key text pk`, `value text not null`. 키는 `dataset_version`, `loaded_at`.

### 6.4 인덱스

- `football_aliases (alias_norm)`에 trigram GIN(`gin_trgm_ops`). 검색은 별칭 테이블만 훑는다(대표 이름도 별칭에 들어 있음).
- `football_spells (player_id)`, `(team_id)`, `football_team_competitions (competition_id, season)`, `football_honours (player_id)`, `(team_id)`. 다음 단계 질의(경력·교집합)용.

### 6.5 이름 정규화 함수

`public.football_norm(text) returns text immutable`:
`lower(extensions.unaccent('extensions.unaccent'::regdictionary, x))`에서 공백·하이픈·마침표·아포스트로피·가운뎃점(`\s - . ' ’ ·`)을 지운다.

- 예: `Son Heung-min` → `sonheungmin`, `Mbappé` → `mbappe`, `손 흥민` → `손흥민`.
- `unaccent()`는 사전을 찾는 방식 때문에 `stable`이라 생성 열·인덱스에 바로 쓸 수 없다. 사전을 명시한 2인자 형식을 감싸 `immutable`로 선언한다(널리 쓰는 방식).

## 7. 적재 (`npm run football:load`)

### 7.1 실행

```bash
DATABASE_URL='postgres://…' npm run football:load            # data/football/
DATABASE_URL='postgres://…' npm run football:load -- <dir>    # 다른 폴더 (테스트 픽스처)
```

- `scripts/football/load.sh`(bash + `psql`)와 `scripts/football/load.sql`. `psql`이 설치된 머신이어야 한다(원격 적재도 같음).
- 원격 `DATABASE_URL`은 Supabase 대시보드의 연결 문자열(세션 풀러 권장)이며 비밀값이라 커밋하지 않는다.

### 7.2 동작 (한 트랜잭션)

1. CSV마다 임시 테이블(모든 열 `text`)을 만들고 `\copy … csv header`로 넣는다. 열 이름이 §5.2와 다르면 실패한다.
2. 엔터티(국가 → 대회 → 팀 → 선수 순): `insert … on conflict (id) do update`로 넣고, CSV에 있는 행은 `retired = false`, **CSV에 없는 기존 행은 `retired = true`**로 둔다. 엔터티는 지우지 않는다(이미 출제된 문제가 ID를 들고 있을 수 있음, 원 설계 §4.2).
3. 관계 테이블: `delete` 후 CSV 내용을 `insert`한다. 관계 행은 문제가 참조하지 않으므로(문제는 고정본) 통째 교체가 가장 단순하고 정확하다.
4. 빈 칸은 `null`로, 숫자·불리언 열은 형 변환한다. 형식이 틀리면 트랜잭션 전체가 실패하고 DB는 그대로 남는다.
5. `football_meta`에 `dataset_version`과 `loaded_at = now()`를 쓴다.
6. 끝나면 테이블별 행 수와 폐기된 엔터티 수를 출력한다.

### 7.3 갱신 주기와 순서

- 이적 시장(여름·겨울) 뒤에 한 번씩 한다. 이미 출제된 문제는 고정본이라 영향이 없다.
- 순서: `football:fetch` → 커버리지 표 확인·`manual/` 보정 → 다시 수집 → `npm test` → 데이터 PR → 머지 후 원격 `football:load`.

### 7.4 용량 예상

- 대상 팀은 11개 리그 × 창 안 시즌 참가팀으로 약 400~500개, 선수는 2만~3만 명, 경력은 15만~25만 행으로 예상한다.
- CSV 합계 약 20~30MB, DB는 인덱스 포함 100MB 안쪽으로 무료 등급 한도(500MB) 안이다. 첫 수집 후 실제 값을 이 절에 적는다.

## 8. 검색 RPC

`public.football_search(q text, kind text, lim int default 10)`

- `security invoker`. 승인 사용자가 아니면 `forbidden` 예외(기존 `_require_approved()`, 리더보드 RPC와 같음). `authenticated`에만 실행 권한.
- `kind`는 `player` 또는 `team`(그 밖이면 `bad_kind` 예외). `lim`은 1~20으로 자른다. `football_norm(q)`가 빈 문자열이면 빈 결과.
- 일치 규칙: 별칭의 `alias_norm`과 정규화한 입력 `n`을 비교해 엔터티별로 가장 좋은 점수를 쓴다.
  - 3: 완전 일치, 2: 앞부분 일치, 1: 부분 일치(`like '%n%'`), 0: trigram 유사도 0.3 이상
  - 한글 두세 글자 이름은 trigram 유사도가 낮게 나와서(예: `손흥민`과 `흥민`은 0.17) 부분 일치를 함께 쓴다.
- 정렬: 점수 내림차순 → 유사도 → 선수는 `popularity` 내림차순, 팀은 `name_en` → `id`.
- `retired` 엔터티는 뺀다. 팀은 `club`과 `national` 모두 나온다.
- 반환 열: `id, kind, name_ko, name_en, nation_id, position, birth_year, team_kind`
  - 선수: `position`, `birth_year`(생년만, 생일 전체는 주지 않음), `team_kind`는 null
  - 팀: `team_kind`, 나머지는 null
  - 동명이인을 구분할 최소 정보만 주고 경력·소속은 주지 않는다(원 설계 §6.1).
- 공통 입력 컴포넌트(`EntityPicker`)는 첫 게임 설계에서 만든다(§12).

## 9. 검증과 테스트

### 9.1 CSV 검사 (`npm test`, Vitest)

`scripts/football/data.test.ts`가 `data/football/`(있을 때)와 테스트 픽스처 폴더를 같은 규칙으로 검사한다. CSV가 아직 없으면 실데이터 검사는 건너뛴다.

- 파일별 헤더가 §5.2와 정확히 같다.
- 기본 키 중복 없음, 기본 키 순 정렬.
- 참조: `spells.player_id`·`caps.player_id`·`honours.player_id` → players, `spells.team_id`는 `kind = club`인 팀, `caps.team_id`는 `kind = national`인 팀, `team_competitions` → teams·competitions, `aliases.entity_id` → players ∪ teams, `nation_id` → nations.
- 값 형식: 날짜 정규식과 정밀도 일치, enum 값, `popularity` 0~100, `colors`는 JSON 배열.
- `manual/legends.csv`의 QID가 `players.csv`에 있다(수집이 반영됐는지 확인).

### 9.2 DB (`npm run db:test`)

- 픽스처: `supabase/tests/fixtures/football/*.csv` (선수 10명 안팎: 한글·영문·악센트 이름, 동명이인, 폐기 대상 포함)
- `scripts/db-test.sh`가 마이그레이션 뒤 `football:load`로 픽스처를 적재하고 pgTAP를 돌린다.
- `supabase/tests/11_football.test.sql` (pgTAP)
  - 승인 사용자는 `football_*`를 읽고, 대기·익명 사용자는 0행 또는 권한 오류
  - `authenticated`의 insert·update·delete는 모두 거부
  - `football_search`: `손흥민`·`흥민`·`son heung min`·`Son Heung-min`이 같은 선수를 찾음, `mbappe`가 `Mbappé`를 찾음, `retired` 제외, `kind`·`lim` 처리, 반환 열에 경력 정보 없음, 비승인 `forbidden`
  - `football_norm` 예시값
- 적재 검사(`scripts/football/load-test.sh`, `db:test`에 포함)
  - 같은 픽스처를 두 번 적재해 테이블별 행 수와 내용 해시가 같음(멱등)
  - 선수 하나를 뺀 픽스처를 적재하면 그 선수가 `retired = true`가 되고 행은 남음, 관계 행은 교체됨
  - 형식이 틀린 CSV는 실패하고 이전 데이터가 그대로임

### 9.3 수집기 (`npm test`)

기존 `wikidata.test.ts`에 §4의 함수(리그별 창, 팀별 창 시작, 리그별 커버리지 경고, 레전드 병합) 테스트를 더한다. 실제 네트워크 호출은 테스트하지 않는다.

## 10. 배포와 문서

- `docs/deploy-checklist.md`에 "축구 데이터" 절을 추가한다: ① `db push`(football 마이그레이션) ② 원격 `DATABASE_URL`로 `npm run football:load` ③ SQL 편집기에서 `select * from football_meta;`와 행 수 확인 ④ 승인 계정으로 `football_search` 호출 확인. 같은 김에 §2의 "0001~0005" 문구를 현재 상태로 고친다.
- `CLAUDE.md`에 "축구 데이터 갱신" 절(§7.3 순서)과 이 설계 문서 경로를 추가한다.
- `data/football/README.md`에 리그별 시즌 수, `legends.csv`, `--seasons`, 적재 방법, 클라우드 환경 네트워크 주의를 반영한다.
- 아직 이 데이터를 쓰는 화면이나 게임이 없으므로 숨김·공개 단계는 없다. 머지 후 원격 적재만 하면 된다.

## 11. 알려진 한계

- **인지도(`popularity`)**: 전 세계 위키 문서 수 기준이라 K리그 선수가 낮게 나온다. 국내 친구들 기준 체감과 다를 수 있다. 문제 생성 단계에서 리그별 하한이나 수동 보정(후알야 `EASY_IN/OUT`과 비슷한 방식)을 검토한다.
- **리그 참가 기록**: 수집 창 안에서만 있다. 레전드의 옛 시즌, 창 밖 시즌의 "어느 리그에서 뛰었나" 조건은 판정할 수 없다.
- **경력 누락**: 날짜 없는 구간은 빠진다. 위키데이터에 없는 이적은 직접 입력이나 다음 단계 API-Football로 보완한다.
- **국적**: 성인 대표팀 출전 → 종목 국적 → 시민권 순이라 이중 국적 선수가 틀릴 수 있다(`manual/` 보정 대상, 필요해지면 `manual/nations.csv`를 추가).
- **비어 있는 열**: `shirt_number`, `confederation`, 대부분의 `foot`. 클럽 색 비율은 균등 분할이다.
- **수상 이름**: `honours`는 개인상의 QID만 들고 있고 상 이름 테이블이 없다. 화면에 상 이름이 필요한 게임에서 추가한다.
- **한글 이름 표기**: 위키데이터 한국어 라벨을 그대로 쓰고, 없거나 어색하면 `manual/names_ko.csv`로 고친다. 표기 기준(외래어 표기법 vs 중계 관행)은 정하지 않고 리뷰에서 그때그때 판단한다. 검색은 별칭으로 여러 표기를 받는다.

## 12. 범위 밖 (다음 단계)

- API-Football 수집기(현재 스쿼드·등번호, 시즌 기록)와 `restricted/` 데이터
- 후알야 출처 전환(FotMob → 공통 데이터)
- 원 설계 §6.2~§6.4 플랫폼 변경(공유 풀, 설정별 은행, 은행 자유 플레이)
- 원 설계 §7 문제 생성(`src/shared/football.ts`, `generate.ts`, `puzzles:gen`)과 `EntityPicker`
- 단계 2(경기·라인업), 단계 3(시즌 기록)
- 데이터 편집 관리자 화면(CSV + PR로 대신)

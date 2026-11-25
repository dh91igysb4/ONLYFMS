# 축구 데이터 1987년 확장 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수집기가 1987년 이후 대상 리그 모든 클럽의 선수와, 대상 리그·전신 대회의 1987년 이후 시즌 참가팀을 받게 한다.

**Architecture:** 리그 설정(`leagues.ts`)에 전신 대회 시기(`eras`)와 시즌별 정원을 두고, 대회별 수집 창을 계산하는 함수 하나(`competitionWindows`)가 시즌 질의·커버리지·팀 시작 연도에 쓰인다. 선수 선정은 팀 시작 연도를 `--history-from`(기본 1987)까지 당기는 순수 함수 하나로 바꾼다. 시기별 나라·단계는 새 CSV·테이블 `competition_eras`로 내보낸다. 시즌 소속 계산에는 옛 선수의 열린 경력을 닫는 규칙을 더한다.

**Tech Stack:** Node 22.18+(`.ts` 직접 실행, 타입 제거만 됨: enum·namespace 금지), Vitest, Postgres 16 + pgTAP(`npm run db:test`), Supabase 마이그레이션.

**Spec:** `docs/superpowers/specs/2026-11-25-football-history-clubs-design.md` (바탕: `docs/superpowers/specs/2026-11-01-football-data-layer-design.md`)

## Global Constraints

- 역사 시작 연도 기본값 `1987`(시즌 시작 연도). `--history-from off`면 지금과 똑같이 동작한다.
- 대회 `id`는 위키데이터 QID 그대로, 바꾸지 않는다. 전신 대회도 자기 QID로 `competitions.csv`에 들어간다.
- 원본 경력(`spells.csv`, `football_spells`)의 날짜는 바꾸지 않는다. 열린 경력 규칙은 시즌 소속(파생값)에만 적용한다.
- 위키백과 근거는 시즌 참가팀 직접 입력(`manual/team_competitions.csv`)에만 허용, 새 줄에 `source_url`. 경력 직접 입력에는 허용하지 않는다.
- 상대 import는 `.ts` 확장자를 붙인다.
- 새 마이그레이션은 `npx supabase@2 migration new football_competition_eras`로 만든다(직접 번호 금지).
- 커밋은 `type: 내용`(feat/fix/chore/docs/test), 작업 브랜치 `feat/football-history` → PR. 푸시 전 `npm test && npm run typecheck && npm run build`, DB를 건드린 커밋은 `npm run db:test`도.
- 위키데이터는 클라우드·Claude 셸에서 막혀 있다. 위키데이터가 필요한 실행(`football:fetch`, `football:eras`)은 사용자가 Windows PowerShell에서 돌린다. 코드 작업은 위키데이터 없이 테스트로 끝나야 한다.

## Review Focus

1. **한 QID가 시기마다 단계가 다른 대회** (풋볼리그 1부: ~1991 1부, 1992~2003 2부) → `competition_eras`에 같은 `competition_id`로 두 줄, 키는 `(competition_id, from_season)`. Task 2·4에서 테스트.
2. **`--history-from off` 회귀** → 창·팀 시작 연도·대회 목록이 지금 코드 결과와 같아야 한다. Task 2·3에서 테스트.
3. **리그와 전신 대회의 시기가 겹치거나 빈 해가 있음** → 같은 해 같은 팀이 두 대회에 들어가면 안 된다. `eras` 검사 테스트(Task 2).
4. **직접 입력한 참가팀이 `teams.csv`에 없음** → CSV 검사 오류 메시지가 `manual/history_clubs.csv`에 넣으라고 알려 준다. Task 4.
5. **생일 없는 옛 선수의 열린 경력** → 지금처럼 오늘까지 열린다(규칙 미적용). Task 5에서 테스트.

---

### Task 1: 전신 대회 찾기 스크립트 `football:eras`

사용자가 Windows에서 한 번 돌려 출력을 붙여 주면, 그걸로 Task 2의 `eras`와 정원 값을 채운다(데이터 단계 D1).

**Files:**
- Create: `scripts/football/eras.ts` (순수: 질의 문자열, 결과 정리)
- Create: `scripts/football/find-eras.ts` (실행: 질의 → 표 출력)
- Test: `scripts/football/eras.test.ts`
- Modify: `package.json` (`"football:eras": "node scripts/football/find-eras.ts"`)

**Interfaces:**
- Produces: `qLineage(ids: readonly string[]): string`, `qSeasonYears(ids: readonly string[]): string`, `summarizeSeasons(rows: Row[]): Map<string, { first: number; last: number; count: number; withTeams: number }>`

- [ ] **Step 1: 테스트** — `qLineage(['Q9448'])`가 `VALUES ?c { wd:Q9448 }`, `P155`, `P156`, `P1365`, `P1366`을 포함한다. `qSeasonYears(['Q9448'])`가 `wdt:P3450`, `P1923` 개수(`COUNT(?team)`)를 묻는다. `summarizeSeasons([{c:'Q1',year:'1990',teams:'20'},{c:'Q1',year:'1992',teams:'0'}])` → `Q1: {first:1990,last:1992,count:2,withTeams:1}`.
- [ ] **Step 2: `npx vitest run scripts/football/eras.test.ts`** — FAIL(모듈 없음).
- [ ] **Step 3: 구현.** `find-eras.ts`는 `LEAGUES` id에서 시작해 이전 대회(`P155`/`P1365`)를 1987년 이전에 닿거나 3단계까지 따라가고, 각 QID의 라벨(en), 시즌 연도 범위, 참가팀이 있는 시즌 수를 표로 찍는다. 질의는 기존 `wdqs.ts`의 `query`(캐시 `.cache/wikidata`)를 쓴다.
- [ ] **Step 4: 테스트 PASS.**
- [ ] **Step 5: 커밋** `feat: 전신 대회 찾기 스크립트(football:eras)`

### Task 2: 대회 시기와 대회별 수집 창

**Files:**
- Modify: `scripts/football/leagues.ts`
- Modify: `scripts/football/wikidata.ts` (`competitionWindows`, `coverage`, `qSeasons` 호출부)
- Test: `scripts/football/wikidata.test.ts`, Create `scripts/football/leagues.test.ts`

**Interfaces:**
- Produces:
  - `type TeamCount = number | readonly (readonly [fromSeason: number, n: number])[]`
  - `type Era = { id: string; name_ko: string; name_en: string; from: number; to: number; tier: number; teams: TeamCount }`
  - `League`에 `since?: number`(이 QID의 첫 시즌, 없으면 제한 없음), `eras?: readonly Era[]`(전신, 오래된 순), `teams: TeamCount`로 바꿈
  - `export const HISTORY_FROM = 1987`
  - `teamsAt(t: TeamCount, season: number): number`
  - `competitionWindows(leagues: readonly League[], to: number, opts: { override?: number; historyFrom: number | null }): Map<string, Window>` — `historyFrom === null`이면 `seasonWindows(leagues, to, opts.override)`와 같다. 아니면 리그 QID 창은 `[max(historyFrom, since ?? historyFrom), to]`, 각 era 창은 `[max(era.from, historyFrom), era.to]`(끝이 시작보다 앞이면 빠짐).
  - `competitionList(leagues): { id, name_ko, name_en, kind: 'league', nation_id, tier }[]` — 리그 + 전신(중복 QID는 한 줄, tier는 가장 최근 시기 값)
  - `competitionEras(leagues, windows: ReadonlyMap<string, Window>): { competition_id, from_season, to_season, nation_id, tier }[]` — 리그 한 줄(`from_season = since ?? windows.get(id).from`, `to_season = ''` 진행 중) + era마다 한 줄(`era.from`~`era.to` 그대로, 1987 이전이어도 됨)
  - `coverage(teamComps, leagues, windows)`는 리그와 era를 모두 행으로 내고, 정원은 `teamsAt(teams, season)`

- [ ] **Step 1: 테스트**
  - `competitionWindows(LEAGUES, 2026, { historyFrom: null })`가 `seasonWindows(LEAGUES, 2026)`와 같다.
  - 리그 `{ id:'L', since:1992, eras:[{id:'E', from:1888, to:1991, ...}] }`, `historyFrom 1987`, `to 2026` → `L: 1992~2026`, `E: 1987~1991`.
  - `teamsAt([[1987,16],[1988,18],[2004,20]], 1990) === 18`, `teamsAt(20, 1990) === 20`.
  - `competitionEras`에 같은 QID가 두 시기(단계 1, 단계 2)로 들어간 픽스처 → 두 줄, tier 1·2.
  - `leagues.test.ts`: 실제 `LEAGUES`의 각 리그에서 era와 리그 시기가 겹치지 않고(`era.to < 다음 시기 from`), era 끝 다음 해가 다음 시기 시작이다(빈 해 없음). 1987 이후만 검사.
- [ ] **Step 2: FAIL 확인** `npx vitest run scripts/football/wikidata.test.ts scripts/football/leagues.test.ts`
- [ ] **Step 3: 구현.** `LEAGUES`의 `eras`는 이 단계에서 비워 둔다(D1 뒤 채움). `teams`는 기존 숫자 그대로.
- [ ] **Step 4: PASS 확인** (같은 명령)
- [ ] **Step 5: 커밋** `feat: 리그 전신 대회 시기와 대회별 수집 창`

### Task 3: 역사 시작 연도와 수집기 연결

**Files:**
- Modify: `scripts/football/wikidata.ts` (`historyStarts`)
- Modify: `scripts/football/fetch-wikidata.ts`
- Test: `scripts/football/wikidata.test.ts`

**Interfaces:**
- Consumes: Task 2의 `competitionWindows`, `competitionList`, `competitionEras`, `HISTORY_FROM`
- Produces: `historyStarts(starts: ReadonlyMap<string, number>, historyClubs: readonly Row[], from: number | null): { starts: Map<string, number>; added: string[]; invalid: string[] }` — `from === null`이면 `starts` 그대로. 아니면 모든 팀을 `min(기존, from)`, `history_clubs.csv` 줄(`team_id, from, note`; `from` 비면 인자 `from`)을 같은 규칙으로 병합, QID 아닌 값은 `invalid`, 새로 들어온 팀은 `added`. 키는 QID 순.

- [ ] **Step 1: 테스트**
  - `historyStarts(new Map([['Q1',2017],['Q2',2012]]), [], null)` → 그대로.
  - 같은 입력, `from 1987` → 둘 다 1987.
  - `historyClubs [{team_id:'Q3',from:'1990'},{team_id:'Q1',from:''},{team_id:'x',from:''}]`, `from 1987` → `Q3: 1990`(added), `Q1: 1987`, `invalid ['x']`.
- [ ] **Step 2: FAIL 확인**
- [ ] **Step 3: 구현 `historyStarts`.**
- [ ] **Step 4: `fetch-wikidata.ts` 연결.**
  - 인자 `--history-from <연도|off>`(기본 `HISTORY_FROM`). `windows`를 `competitionWindows(leagues, to, { override, historyFrom })`로.
  - 참가팀 필터 `leagueIds`를 `competitionList(o.leagues)`의 id 집합으로.
  - `teamStarts` 다음에 `historyStarts(starts, readManual(o.input, 'history_clubs.csv'), historyFrom)`.
  - 출력: `competitions`는 `competitionList`, 새 파일 `competition_eras`는 `competitionEras`.
  - 로그: 역사 클럽 추가 수, `invalid`, 시작 연도별 찾은 선수 수, `buildSpells`의 `dropped`(날짜 없어 버린 경력) 수.
  - 머리말 사용법 주석에 `--history-from` 추가.
- [ ] **Step 5: PASS 확인** `npx vitest run scripts/football` + `npm run typecheck`
- [ ] **Step 6: 커밋** `feat: 수집기 --history-from(기본 1987)과 옛 클럽 목록`

### Task 4: `competition_eras` CSV·테이블·적재, 직접 입력 열

**Files:**
- Modify: `scripts/football/schema.ts` (`FILE_NAMES`, `FILES`, `checkDataset`)
- Create: `data/football/competition_eras.csv` (머리줄 + 지금 리그 11줄, `competitionEras(LEAGUES, competitionWindows(LEAGUES, 2026, { historyFrom: 1987 }))` 결과), `data/football/manual/history_clubs.csv` (머리줄 `team_id,from,note`만)
- Modify: `data/football/manual/team_competitions.csv` 머리줄에 `source_url` 추가
- Create: `supabase/migrations/<timestamp>_football_competition_eras.sql`
- Modify: `scripts/football/load.sql`, `scripts/football/load-test.sh`(픽스처)
- Test: `scripts/football/data.test.ts`, Create `supabase/tests/<다음 번호>_football_eras.test.sql`

**Interfaces:**
- Consumes: Task 2의 `competitionEras` 행 모양
- Produces: 파일 `competition_eras` `{ columns: ['competition_id','from_season','to_season','nation_id','tier'], key: ['competition_id','from_season'], order: ['competition_id','from_season'] }`; 테이블 `public.football_competition_eras(competition_id text not null references football_competitions, from_season int, to_season int, nation_id text references football_nations, tier int not null, primary key (competition_id, from_season))`, `from_season int not null`, `to_season`은 null = 진행 중.

- [ ] **Step 1: 테스트(CSV 검사)**
  - `competition_eras`: `competition_id`가 `competitions`에 있음, `nation_id`가 `nations`에 있음, `from_season` 필수 연도, `to_season` 비거나 `>= from_season`.
  - 같은 대회의 시기끼리 겹치면 오류.
  - `manual/history_clubs.csv`: `team_id` QID, `from` 비거나 1950~현재, 중복 없음.
  - `team_competitions`의 팀이 `teams`에 없을 때 오류 문구에 `manual/history_clubs.csv`가 들어 있다.
  - `manual/team_competitions.csv`에 `source_url` 열이 있어도 병합 결과(`mergeTeamComps`)는 세 열만.
- [ ] **Step 2: FAIL 확인** `npx vitest run scripts/football/data.test.ts`
- [ ] **Step 3: `schema.ts` 구현과 CSV 두 파일 생성.**
- [ ] **Step 4: PASS 확인**
- [ ] **Step 5: 마이그레이션.** `npx supabase@2 migration new football_competition_eras`. 테이블(위 모양), `football_team_competitions`와 같은 방식의 읽기 권한(`grant select ... to authenticated`, 정책 `using ((select public.is_approved()))`, RLS 켬).
- [ ] **Step 6: 적재.** `load.sql`에 `s_competition_eras` 임시 테이블·`\copy`·통째 교체(`delete` 후 `insert`)를 `football_team_competitions`와 같은 자리·순서로. `load-test.sh` 픽스처에 한 줄 추가.
- [ ] **Step 7: DB 테스트.** 새 pgTAP 파일: 테이블·PK 존재, 미승인 사용자 0행·승인 사용자 읽기, 같은 대회 두 시기(tier 1·2) 삽입 가능.
- [ ] **Step 8: `npm run db:test`와 `bash scripts/football/load-test.sh`** — 새 파일 PASS. (main에 있는 지갑 테스트 32개 실패는 이 작업과 무관하니 그대로 두고 PR 설명에 적는다.)
- [ ] **Step 9: 커밋** `feat: 대회 시기 테이블(football_competition_eras)과 적재`

### Task 5: 옛 선수의 열린 경력 닫기 (시즌 소속)

**Files:**
- Modify: `scripts/football/seasons.ts` (`playerIntervals`, `deriveMemberships`)
- Modify: `scripts/football/derive-seasons.ts` (players.csv의 생일 전달)
- Test: `scripts/football/seasons.test.ts`

**Interfaces:**
- Produces: `deriveMemberships(spells, teamNation, opts: { from: number; to: number; today: string; birth?: ReadonlyMap<string, string> })`, `playerIntervals(spells, calOf, today, birth?: string)`

규칙: 뒤 경력이 없어 오늘까지 열릴 구간에서, `birth`가 있고 `today` 기준 만 40세를 넘었으면 끝을 `max(구간 시작 + 1년, (생년 + 38)-06-30)`로 하고 `estimated = true`. 생일이 연도만이면(`YYYY`) 그해 1월 1일로 본다.

- [ ] **Step 1: 테스트**
  - `은퇴 선수형`: 1965년생, 1996-07-01 시작·끝 없음, today 2026-11-25 → 소속은 2002 시즌까지(2003-06-30 종료), 2012~2026 없음, estimated.
  - `생일 없음`: 같은 경력, `birth` 없음 → 지금처럼 2026 시즌까지.
  - `40세 이하`: 1990년생, 2024 시작·끝 없음 → 2026 시즌까지.
  - `시작이 38세 이후`: 1960년생, 2000-07-01 시작 → 2001-07-01까지(시작 + 1년).
- [ ] **Step 2: FAIL 확인** `npx vitest run scripts/football/seasons.test.ts`
- [ ] **Step 3: 구현** 두 함수 + `derive-seasons.ts`가 `players.csv`의 `birth_date`로 `birth` 맵을 만든다.
- [ ] **Step 4: PASS 확인** (기존 시즌 소속 테스트 포함)
- [ ] **Step 5: 커밋** `fix: 옛 선수의 열린 경력을 시즌 소속에서 닫기`

### Task 6: 문서와 PR

**Files:**
- Modify: `data/football/README.md` (`--history-from`, `football:eras`, `history_clubs.csv`, `source_url`, Windows 실행 순서)
- Modify: `docs/superpowers/specs/2026-11-01-football-data-layer-design.md` (§3.2·§3.3·§5.3·§6·§11, 새 설계 링크)
- Add: 설계 문서 `docs/superpowers/specs/2026-11-25-football-history-clubs-design.md`, 이 계획

- [ ] **Step 1: 문서 수정.** README의 Windows 실행 순서는 아래 D1~D3 명령을 그대로 적는다.
- [ ] **Step 2: `npm test && npm run typecheck && npm run build`** 통과(지갑·낚시 쪽 기존 실패는 목록만 PR에 적음).
- [ ] **Step 3: 커밋** `docs: 축구 데이터 1987년 확장 설계·사용법`
- [ ] **Step 4: 푸시와 PR** (`feat/football-history` → main). 설명에 MJ 참고 사항(수집기 변경 요약)과 남은 데이터 단계(D1~D5).

---

## 데이터 단계 (코드 머지 뒤, 위키데이터 필요)

사용자 Windows PC에서 PowerShell. 처음 한 번: Git·Node 22.18+ 확인(`git --version`, `node -v`), `git clone https://github.com/dh91igysb4/onlyfms`(위치 자유), `cd onlyfms`, `npm install`.

- **D1 전신 대회:** `git pull; npm run football:eras` → 출력을 Claude에게. Claude가 `leagues.ts`의 `since`·`eras`·시즌별 `teams`를 채워 PR(정원은 영어 위키백과 리그 문서 기준).
- **D2 시험 수집:** `git pull; npm run football:fetch -- --leagues Q9448` → 끝 로그(시즌별 참가팀 표, 선수 수, 걸린 시간)를 Claude에게. 전체 시간 추정.
- **D3 본 수집:** 새 브랜치 `data/history-1987`에서 `npm run football:fetch; npm run football:seasons; npm test` → `git add data/football; git commit -m "chore: 축구 데이터 1987년부터 수집"; git push -u origin data/history-1987`. 몇 시간 걸릴 수 있다. 끊기면 같은 명령을 다시 돌리면 캐시로 이어진다.
- **D4 빈 시즌 입력(Claude):** 커버리지 표의 `--`·`!` 칸을 위키백과 시즌 문서로 `manual/team_competitions.csv`에 넣고(`source_url`), 선수 없는 클럽은 `manual/history_clubs.csv`에. `npm run football:openfootball -- --merge`로 반영. 새 클럽이 있으면 사용자가 D3 명령을 한 번 더.
- **D5 마무리:** 켜고 끈 비교(설계 §3.4: 2017~2026 팀별 시즌 소속 ±2명), 표본 칸(설계 §3.6), PR 머지 → `npx supabase@2 db push` → `DATABASE_URL='…' npm run football:load` → Claude가 Supabase 커넥터로 행 수·`football_meta` 확인.

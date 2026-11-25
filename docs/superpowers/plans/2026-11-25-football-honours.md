# 축구 우승·수상·대표팀 엔트리·감독 수집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 티키타카토 칸 조건(우승 횟수, 대표팀 대회, 개인상, 감독, 월드컵 결승 득점)을 1987년 이후로 판정할 수 있게 별도 수집기 `fetch-honours.ts`와 적재 경로를 만든다.

**Architecture:** 순수 모듈 셋(`wikitext.ts` 파싱, `honourParsers.ts` 문서 종류별 추출, `honours.ts` 계산)과 네트워크 CLI(`fetch-honours.ts`, MediaWiki 클라이언트 `wikipedia.ts`, 기존 `wdqs.ts`)로 나눈다. CLI는 `honour_catalog.csv` 설정을 읽어 `honours_extra.csv`·`managers.csv`·`manager_spells.csv`를 쓰고, `load.sql`이 기존 `honours.csv`와 함께 적재한다.

**Tech Stack:** Node(TS 직접 실행, `node scripts/football/*.ts`), vitest, PostgreSQL/Supabase 마이그레이션, Wikidata SPARQL, MediaWiki Action API.

**Spec:** `docs/superpowers/specs/2026-11-25-football-honours-design.md`

## Global Constraints

- 시즌 번호: 가을–봄 리그는 시작 연도, 한 해 리그·대표팀 대회는 그 해. 대표팀 대회는 대회 이름의 연도(유로 2020 → 2020).
- 개인상 시즌: 리그 시즌 상(리그 득점왕, 유러피언 골든슈)은 시즌 시작 연도, 한 해 상(발롱도르, FIFA 올해의 선수, 월드컵 개인상)은 시상 연도.
- 수집 시작 기본 1987(`HISTORY_FROM`).
- 우리 `players.csv`·`teams.csv`에 없는 QID는 버리고, 상·대회별로 버린 수를 출력한다.
- 위키백과 호출: User-Agent 명시, 429면 `Retry-After`만큼 대기, 응답 캐시(git 제외).
- 위키백과 문서 하나가 실패해도 그 카탈로그 줄만 비고 수집은 계속된다("문서 없음"/"파싱 실패" 출력).
- 기존 `honours.csv`는 이 수집기가 건드리지 않는다.
- 상대 import는 `.ts` 확장자. 비밀값 커밋 금지. DB 변경은 `npx supabase@2 migration new`로 만든 마이그레이션으로만.
- 커밋 메시지 `type: 내용`, 끝에 세션 attribution 두 줄.
- 푸시 전 `npm test && npm run typecheck && npm run build`.

## Review Focus

1. 위키백과 표의 공동 수상·동점 득점왕(한 해 두 명 이상) → 둘 다 행이 나와야 한다. (Task 2 테스트 `award_ties`)
2. 링크가 리다이렉트이거나 동음이의 문서(예: "Ronaldo")일 때 → 리다이렉트를 따라 QID를 찾고, QID가 우리 DB에 없으면 버린 수에 센다(엉뚱한 선수로 붙지 않는다). (Task 6 테스트 `qids_follow_redirects`)
3. 미시상 연도(발롱도르 2020)나 표의 "Not awarded" 행 → 행이 없어야 한다. (Task 2 `award_skip_not_awarded`)
4. 정보상자 감독 기간의 `present`, `–` 대신 `-`, 대행 표기 `(caretaker)` → 진행 중은 현재 시즌까지, 대행도 포함. (Task 2 `infobox_present_and_caretaker`)
5. 같은 상이 기존 위키데이터 수상 행과 시즌이 1년 다르게 겹침 → 적재 후 그 상은 새 수집 행만 남는다. (Task 5 DB 테스트)

---

### Task 1: 시즌 소속을 1987년부터 계산

**Files:**
- Modify: `scripts/football/derive-seasons.ts` (기본 `from`)
- Modify: `data/football/season_memberships.csv` (다시 생성)
- Modify: `data/football/README.md` (기본값 설명이 있으면)

**Interfaces:**
- Produces: `season_memberships.csv`가 1987~현재 시즌을 담는다(열 `player_id,season,team_id,primary,days,estimated` 그대로).

- [ ] **Step 1:** `derive-seasons.ts`의 기본 `from`을 `HISTORY_FROM`(`leagues.ts`에서 import)으로 바꾸고 머리 주석의 `--from 2012`를 `--from 1987`로 고친다.
- [ ] **Step 2:** Run: `npm run football:seasons -- --as-of 2026-11-25`
  Expected: `시즌 1987~2026, …` 출력, `cut -d, -f2 data/football/season_memberships.csv | sort -u | head -2`가 `1987`부터.
- [ ] **Step 3:** Run: `npm test -- scripts/football` — Expected: PASS(시즌 소속 실데이터 검사 포함).
- [ ] **Step 4:** Commit `fix: 시즌 소속을 1987년부터 계산`.

### Task 2: 위키텍스트 파싱과 문서 종류별 추출 (순수)

**Files:**
- Create: `scripts/football/wikitext.ts`, `scripts/football/honourParsers.ts`
- Create: `scripts/football/fixtures/wikitext/{ballon_dor,pl_golden_boot,coppa_italia_finals,wc2014_squads,wenger}.txt`
- Test: `scripts/football/honourParsers.test.ts`

**Interfaces:**
- Produces (`wikitext.ts`): `stripComments(t: string): string`, `templates(t: string, name: RegExp): string[]`(중괄호 짝 맞춘 블록), `wikiLinks(t: string): string[]`(링크 대상 제목, `|` 앞, 첫 글자 대문자화, `_`→공백), `tables(t: string): string[][][]`(표 → 행 → 칸 원문, `rowspan`은 아래 행에 같은 칸을 복제).
- Produces (`honourParsers.ts`):
  - `type Hit = { season: number; link: string }`
  - `parseAwardList(t: string, opts: { from: number; seasonCol: 'start' | 'year' }): Hit[]` — 수상자 표에서 시즌 칸과 선수 링크. `2004–05`/`2004–2005`는 `start`면 2004. 한 칸에 선수 둘이면 둘 다.
  - `parseFinals(t: string, opts: { from: number; seasonCol: 'start' | 'year' }): Hit[]` — 역대 결승/우승 표에서 시즌과 우승팀 링크.
  - `parseSquads(t: string): { team: string; players: string[] }[]` — 엔트리 문서의 나라 절(`==== Germany ====` 등 제목, 절 안 `{{nat fs player|…|name=[[…]]}}` 또는 표의 선수 링크). `team`은 절 제목.
  - `parseManagerInfobox(t: string): { club: string; from: number; to: number | null; caretaker: boolean }[]` — `{{Infobox football biography}}`의 `manageryearsN`·`managerclubsN`. `present`/빈 끝은 `null`.

- [ ] **Step 1:** 실제 문서를 받아 픽스처로 축약 저장한다(이 단계만 네트워크): `Ballon d'Or`의 수상자 표(1987~2025 포함), `Premier League Golden Boot`, `Coppa Italia`의 결승 표, `2014 FIFA World Cup squads`의 독일·아르헨티나 절, `Arsène Wenger` 정보상자. 문서 제목이 다르면 실제 제목을 쓰고 테스트 주석에 적는다.
- [ ] **Step 2: Write failing tests** (`honourParsers.test.ts`):

```ts
test('award_list_ballon_dor', () => {
  const h = parseAwardList(fx('ballon_dor'), { from: 1987, seasonCol: 'year' })
  expect(h.find((x) => x.season === 1995)?.link).toBe('George Weah')
  expect(h.filter((x) => x.season >= 1987 && x.season <= 2025)).toHaveLength(38)
})
test('award_skip_not_awarded', () => {
  expect(parseAwardList(fx('ballon_dor'), { from: 1987, seasonCol: 'year' }).some((x) => x.season === 2020)).toBe(false)
})
test('award_ties', () => {
  // PL 골든부트 2018–19는 살라·마네·오바메양 공동
  const h = parseAwardList(fx('pl_golden_boot'), { from: 1992, seasonCol: 'start' }).filter((x) => x.season === 2018)
  expect(h.map((x) => x.link).sort()).toEqual(['Mohamed Salah', 'Pierre-Emerick Aubameyang', 'Sadio Mané'])
})
test('finals_coppa_italia', () => {
  const h = parseFinals(fx('coppa_italia_finals'), { from: 1987, seasonCol: 'start' })
  expect(h.find((x) => x.season === 2005)?.link).toBe('Inter Milan')
  expect(new Set(h.map((x) => x.season)).size).toBe(h.length) // 시즌당 하나
})
test('squads_wc2014', () => {
  const g = parseSquads(fx('wc2014_squads')).find((s) => s.team === 'Germany')!
  expect(g.players).toHaveLength(23)
  expect(g.players).toContain('Manuel Neuer')
})
test('infobox_wenger', () => {
  expect(parseManagerInfobox(fx('wenger'))).toContainEqual({ club: 'Arsenal F.C.', from: 1996, to: 2018, caretaker: false })
})
test('infobox_present_and_caretaker', () => {
  const t = '{{Infobox football biography\n| manageryears1 = 2019-\n| managerclubs1 = [[Arsenal F.C.|Arsenal]]\n| manageryears2 = 2019\n| managerclubs2 = [[Arsenal F.C.]] (caretaker)\n}}'
  expect(parseManagerInfobox(t)).toEqual([
    { club: 'Arsenal F.C.', from: 2019, to: null, caretaker: false },
    { club: 'Arsenal F.C.', from: 2019, to: 2019, caretaker: true },
  ])
})
```
(링크 기대값은 픽스처의 실제 링크 대상에 맞춰 고친다. 예: 문서가 `[[Inter Milan|Internazionale]]`이면 `Inter Milan`.)
- [ ] **Step 3:** Run `npx vitest run scripts/football/honourParsers.test.ts` — Expected: FAIL(모듈 없음).
- [ ] **Step 4:** `wikitext.ts`·`honourParsers.ts` 구현.
- [ ] **Step 5:** 같은 명령 — Expected: PASS.
- [ ] **Step 6:** Commit `feat: 위키백과 우승·수상·엔트리·감독 파서`.

### Task 3: 선수 우승·대표팀 우승·감독 시즌 계산 (순수)

**Files:**
- Create: `scripts/football/honours.ts`
- Test: `scripts/football/honours.test.ts`

**Interfaces:**
- Consumes: `Membership`, `Calendar`, `calendarOf` (`seasons.ts`), `Honour` (`wikidata.ts`: `{ honour, season, team_id, player_id }`, 모두 string).
- Produces:
  - `playerTitles(teamWins: readonly Honour[], memberships: readonly Membership[], clubIds: ReadonlySet<string>): Honour[]` — §3.1. `teamWins`는 `player_id === ''`인 팀 우승. 한 시즌 클럽 소속(`clubIds`에 있는 팀)이 둘 이상인 선수의 그 시즌은 건너뛴다.
  - `nationalTitles(squads: readonly Honour[], winners: readonly Honour[]): Honour[]` — `squad:<C>` 행 중 같은 시즌 `C` 우승팀(`team_id`)의 엔트리 전원에게 `honour = C` 행.
  - `managerSeasons(from: number, to: number | null, cal: Calendar, current: number): { from_season: number; to_season: number }` — §3.5.

- [ ] **Step 1: Write failing tests:**

```ts
const m = (player_id: string, season: string, team_id: string) => ({ player_id, season, team_id, primary: 'true', days: '300', estimated: 'true' })
const win = (honour: string, season: string, team_id: string) => ({ honour, season, team_id, player_id: '' })
const clubs = new Set(['Tche', 'Tars', 'Tmu'])
test('title_single_club', () => {
  expect(playerTitles([win('Q9448', '2004', 'Tche')], [m('P1', '2004', 'Tche')], clubs))
    .toEqual([{ honour: 'Q9448', season: '2004', team_id: 'Tche', player_id: 'P1' }])
})
test('title_two_clubs_same_season_excluded', () => {
  expect(playerTitles([win('Q9448', '2004', 'Tche')], [m('P1', '2004', 'Tche'), m('P1', '2004', 'Tars')], clubs)).toEqual([])
})
test('title_national_row_not_counted', () => {
  expect(playerTitles([win('Q9448', '2004', 'Tche')], [m('P1', '2004', 'Tche'), m('P1', '2004', 'Tnat')], clubs)).toHaveLength(1)
})
test('title_no_win_no_row', () => {
  expect(playerTitles([win('Q9448', '2004', 'Tars')], [m('P1', '2004', 'Tche')], clubs)).toEqual([])
})
test('national_titles_from_winner_squad', () => {
  const sq = [{ honour: 'squad:Q19317', season: '2014', team_id: 'Tger', player_id: 'P1' }, { honour: 'squad:Q19317', season: '2014', team_id: 'Targ', player_id: 'P2' }]
  expect(nationalTitles(sq, [win('Q19317', '2014', 'Tger')])).toEqual([{ honour: 'Q19317', season: '2014', team_id: 'Tger', player_id: 'P1' }])
})
test('manager_seasons', () => {
  expect(managerSeasons(1996, 2018, 'split', 2026)).toEqual({ from_season: 1996, to_season: 2017 })
  expect(managerSeasons(1986, 2013, 'split', 2026)).toEqual({ from_season: 1986, to_season: 2012 })
  expect(managerSeasons(2005, 2010, 'year', 2026)).toEqual({ from_season: 2005, to_season: 2010 })
  expect(managerSeasons(2019, 2019, 'split', 2026)).toEqual({ from_season: 2019, to_season: 2019 })
  expect(managerSeasons(2019, null, 'split', 2026)).toEqual({ from_season: 2019, to_season: 2026 })
})
```
- [ ] **Step 2:** Run `npx vitest run scripts/football/honours.test.ts` — Expected: FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 같은 명령 — Expected: PASS.
- [ ] **Step 5:** Commit `feat: 선수 우승·감독 시즌 계산`.

### Task 4: 새 CSV 형식·검사, 카탈로그와 직접 입력 파일

**Files:**
- Modify: `scripts/football/schema.ts` (`FILE_NAMES`, `FILES`, `checkDataset` 규칙)
- Create: `data/football/honour_catalog.csv`, `data/football/honours_extra.csv`(헤더만), `data/football/managers.csv`(헤더만), `data/football/manager_spells.csv`(헤더만), `data/football/manual/world_cup_final_scorers.csv`
- Create: `supabase/tests/fixtures/football/{honour_catalog,honours_extra,managers,manager_spells}.csv`
- Test: `scripts/football/data.test.ts`

**Interfaces:**
- Produces (`FILES` 항목):
  - `honour_catalog`: columns `id,kind,name_en,name_ko,nation_id,source,page,from`, key `id`, order `kind,id`. `kind ∈ league|cup|continental|international|award|manager`, `source ∈ existing|wikidata|wikipedia|manual`, `name_ko` 필수, `from` 연도.
  - `honours_extra`: 열·키·정렬은 `honours`와 같다. `honour`는 카탈로그 id, `award:<id>`, `squad:<id>`, `final_goal:<id>` 중 하나이고 그 id가 카탈로그에 있어야 한다. `team_id`·`player_id` 참조 검사.
  - `managers`: `id,name_en`, key `id`. id가 카탈로그 `kind=manager`에 있어야 한다.
  - `manager_spells`: `manager_id,team_id,from_season,to_season,source_url`, key `manager_id,team_id,from_season`, `from_season ≤ to_season`.
- 카탈로그 첫 판: 스펙 §3.2의 줄 전부. `league` 줄은 `source=existing`(기존 리그 QID: Q9448 등 `competitions.csv`의 13개). 월드컵 id `Q19317`. `page`는 Task 7에서 채우므로 이 단계에서는 비어 있어도 된다. 감독 줄은 스펙 §3.5 목록(QID는 위키데이터에서 찾아 적는다).
- `world_cup_final_scorers.csv`: `season,player_id,team_id,source_url`. 1990~2022 결승 득점자(자책골 제외, 승부차기 제외). QID를 `players.csv`에 없으면 그 줄은 빼고 주석 없이 README에 적는다.

- [ ] **Step 1: Write failing tests** in `data.test.ts`: `fixtures_pass`가 새 파일 포함 통과, 그리고

```ts
test('extra_honour_unknown_catalog', () => {
  expect(check((d) => { d.files.honours_extra[0].honour = 'award:Q999999' })).toContainEqual(expect.stringMatching(/^honours_extra:2: honour award:Q999999 카탈로그에 없음/))
})
test('manager_spell_order', () => {
  expect(check((d) => { const r = d.files.manager_spells[0]; r.from_season = '2010'; r.to_season = '2009' })).toContainEqual(expect.stringMatching(/^manager_spells:2: /))
})
test('catalog_kind', () => {
  expect(check((d) => { d.files.honour_catalog[0].kind = 'trophy' })).toContainEqual(expect.stringMatching(/^honour_catalog:2: kind trophy 허용 안 됨/))
})
```
픽스처는 기존 픽스처의 선수(손흥민 `Q439722`)·팀을 써서 각 파일 1~3행.
- [ ] **Step 2:** Run `npx vitest run scripts/football/data.test.ts` — Expected: FAIL.
- [ ] **Step 3:** `schema.ts`·CSV 파일 작성.
- [ ] **Step 4:** 같은 명령 — Expected: PASS(실데이터 검사도: 새 실데이터 파일은 헤더만이거나 카탈로그·결승 득점자뿐).
- [ ] **Step 5:** Commit `feat: 우승·수상·감독 CSV 형식과 카탈로그`.

### Task 5: 마이그레이션과 적재

**Files:**
- Create: `supabase/migrations/<timestamp>_football_honours.sql` (`npx supabase@2 migration new football_honours`)
- Modify: `scripts/football/load.sql`, `scripts/football/load-test.sh`
- Test: `supabase/tests/24_football_honours.test.sql`

**Interfaces:**
- Produces 테이블:
  - `football_honour_catalog(id text pk, kind text check(...), name_en text not null, name_ko text not null, nation_id text references football_nations, source text not null, page text, from_season int not null)`
  - `football_managers(id text pk, name_en text not null)`
  - `football_manager_spells(manager_id text references football_managers, team_id text references football_teams, from_season int not null, to_season int not null, source_url text, primary key(manager_id, team_id, from_season), check(from_season <= to_season))`
  - 권한: 기존 football 테이블과 같은 RLS·grant(승인 사용자 select만).
- `load.sql`: `honour_catalog.csv`·`managers.csv`·`manager_spells.csv`·`honours_extra.csv`를 임시 테이블로 읽는다. 카탈로그는 통째 교체(감독 테이블보다 먼저). 우승 넣기는: `s_honours`에서 `honour = 'award:' || 카탈로그(kind='award').id`인 행을 빼고, `s_honours_extra`와 합쳐 `distinct`로 넣는다. 결과 표에 세 테이블 행 수를 더한다.

- [ ] **Step 1: Write failing DB test** `24_football_honours.test.sql`(기존 `22_football_eras.test.sql` 형식): 픽스처 적재 뒤
  - 세 테이블에 픽스처 행 수만큼 있다.
  - 픽스처 `honours.csv`에 `award:<카탈로그 상>` 2004 행, `honours_extra.csv`에 같은 상 2005 행을 넣어 두고 → 적재 후 그 상은 2005 행 하나만.
  - 카탈로그 밖 `award:` 행은 남는다.
  - 비승인 사용자는 세 테이블을 못 읽는다.
- [ ] **Step 2:** Run `npm run db:test` — Expected: 새 테스트 FAIL.
- [ ] **Step 3:** 마이그레이션·`load.sql`·`load-test.sh`(새 테이블 해시 추가) 작성.
- [ ] **Step 4:** Run `npm run db:test && bash scripts/football/load-test.sh` — Expected: PASS.
- [ ] **Step 5:** Commit `feat: 우승·수상·감독 테이블과 적재`.

### Task 6: 수집기 CLI

**Files:**
- Create: `scripts/football/wikipedia.ts`, `scripts/football/fetch-honours.ts`
- Modify: `package.json` (`"football:honours": "node scripts/football/fetch-honours.ts"`), `.gitignore`(캐시 폴더 `data/football/.cache-honours/`가 아니면 기존 캐시 규칙 확인)
- Test: `scripts/football/wikipedia.test.ts`

**Interfaces:**
- Consumes: Task 2 파서, Task 3 계산, Task 4 `FILES`·`sortRows`, `wdqs.ts` `query(sparql, cache)`, `parseCsv`/`toCsv`.
- Produces (`wikipedia.ts`): `wikitext(title: string, cache: Cache): Promise<{ title: string; text: string } | null>`(리다이렉트 따라감, 없으면 null), `titlesToQids(titles: readonly string[], cache: Cache, fetcher?: typeof fetch): Promise<Map<string, string>>`(Action API `prop=pageprops&redirects=1`, 50개씩, 원래 제목 → QID), 429 재시도.
- `fetch-honours.ts` 동작:
  1. 카탈로그를 kind별로 처리. `cup`·`continental`: 위키데이터 시즌 항목(`?s wdt:P3450 <id>; wdt:P1346 ?w`, 시즌 연도는 `P580`/`P582`/`P585`에서 달력 규칙으로), 빠진 시즌만 `page`를 `parseFinals`. `international`: 대회 이름 연도별 `page` 틀(`{year} FIFA World Cup squads`)을 `parseSquads`, 우승팀은 위키데이터 같은 쿼리. `award`: `parseAwardList`. `manager`: 감독 본인 문서 `parseManagerInfobox` → 클럽·대표팀 링크 QID → 우리 `teams.csv`에 있는 팀만 `managerSeasons`(대표팀은 `year` 달력, 클럽은 `calendarOf(nation_id)`). `managers.csv`는 카탈로그 `kind=manager` 줄의 `id,name_en`.
  2. 팀 우승(기존 `honours.csv`의 리그 행 + 1의 컵·대륙) → `playerTitles`(Task 1 시즌 소속, `teams.csv` `kind=club`). 대표팀 → `nationalTitles`. 결승 득점자 → `final_goal:Q19317`.
  3. 대표팀 엔트리 절 제목(나라 이름) → 우리 대표팀 QID는 `teams.csv`의 `kind=national` 이름으로 찾고, 못 찾으면 고정 표(`NATIONAL_FIX`, 예: `Republic of Ireland`)를 둔다.
  4. 출력: 카탈로그 줄마다 `<name_en>: 행 N, 버린 선수 M, 문서 없음/파싱 실패`. 끝에 파일 세 개를 `sortRows` 순으로 쓴다.
  옵션: `--only <카탈로그 id,…>`, `--refresh`(캐시 무시), `--dir`.

- [ ] **Step 1: Write failing test** `wikipedia.test.ts` (가짜 `fetcher`로 네트워크 없이):

```ts
test('qids_follow_redirects', async () => {
  const fetcher = fakeFetch({ query: { redirects: [{ from: 'Ronaldo (Brazilian footballer)', to: 'Ronaldo (footballer, born 1976)' }],
    pages: { '1': { title: 'Ronaldo (footballer, born 1976)', pageprops: { wikibase_item: 'Q529207' } } } } })
  expect((await titlesToQids(['Ronaldo (Brazilian footballer)'], null, fetcher)).get('Ronaldo (Brazilian footballer)')).toBe('Q529207')
})
test('qids_missing_page', async () => {
  const fetcher = fakeFetch({ query: { pages: { '-1': { title: 'Nobody', missing: '' } } } })
  expect((await titlesToQids(['Nobody'], null, fetcher)).has('Nobody')).toBe(false)
})
```
- [ ] **Step 2:** Run `npx vitest run scripts/football/wikipedia.test.ts` — Expected: FAIL.
- [ ] **Step 3:** `wikipedia.ts`·`fetch-honours.ts`·npm 스크립트 구현.
- [ ] **Step 4:** Run 테스트 PASS, 그리고 `npm run football:honours -- --only Q166177` (발롱도르) — Expected: `Ballon d'Or: 행 3x, 버린 선수 n` 출력, `honours_extra.csv`에 `award:Q166177` 행.
- [ ] **Step 5:** `npm run typecheck` PASS. Commit `feat: 우승·수상·감독 수집기`.

### Task 7: 본 수집, 점검, 데이터 커밋

**Files:**
- Modify: `data/football/honour_catalog.csv`(`page` 채우기), `honours_extra.csv`, `managers.csv`, `manager_spells.csv`, `data/football/README.md`(수집 명령·순서: `football:fetch` → `football:seasons` → `football:honours`)
- Modify: 스펙 §3.2 목록과 실제가 달라지면 스펙에 기록

- [ ] **Step 1:** 카탈로그 각 줄의 위키백과 문서 제목을 찾아 `page`에 적는다(대표팀 엔트리는 `{year}` 틀).
- [ ] **Step 2:** Run `npm run football:honours 2>&1 | tee /tmp/honours.log` — Expected: 끝까지 돌고 "문서 없음/파싱 실패" 줄 목록이 나온다. 각 실패는 `page` 수정이나 파서 수정(파서면 Task 2 방식으로 테스트 먼저)으로 고치고 해당 줄만 `--only`로 다시 돈다.
- [ ] **Step 3: 점검** (결과를 PR 본문에 적는다):
  - 발롱도르 1987~2025 = 38행.
  - 2014 월드컵 독일 엔트리 23명 중 DB 연결 수.
  - 앙리×벵거, 긱스×퍼거슨, 라울×델 보스케: `manager_spells`와 시즌 소속으로 겹침 확인(작은 스크립트나 SQL).
  - 2004–05 첼시 PL 우승 행에 램파드·테리가 있고, 그 시즌 클럽이 둘인 선수는 없음.
  - 코파 이탈리아 1987~2025 팀 우승이 시즌마다 하나.
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run build` — Expected: PASS.
- [ ] **Step 5:** Commit `chore: 우승·수상·감독 데이터 수집 결과`. PR을 연다(본문에 점검 결과). 운영 `db push`·`football:load`는 사용자 확인 뒤.

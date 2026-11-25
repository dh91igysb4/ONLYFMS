# 티키타카토 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 축구 DB를 쓰는 1대1 대전 게임 티키타카토(원작 규칙 + 스틸 5/6, 턴 넘기기, 무승부 제안, 막힌 판)를 숨김 상태로 추가한다.

**Architecture:** 오프라인 생성기(`scripts/tiki-taka-toe/`)가 축구 CSV로 조건별 선수 집합과 테마별 문제 은행을 만들어 DB(`ttt_*`)에 적재한다. 대전 플랫폼에 일반 기능 "판 준비 RPC"(manifest `duel.prepare`)를 더해, 대국 시작 때 `ttt_pick_puzzle`이 고른 판과 칸별 정답을 순수 로직 `init`에 넘긴다. 정답은 대국 상태에만 있고 `view`는 끝나기 전 숨긴다.

**Tech Stack:** React/Vite, Supabase(Postgres·RLS·RPC), Deno Edge Function `duel`, Node TS 스크립트, vitest, pgTAP(`npm run db:test`), `deno test`(`npm run fn:test`).

**Spec:** `docs/superpowers/specs/2026-11-26-tiki-taka-toe-design.md`

## Global Constraints

- 게임 id `tiki-taka-toe`, 처음엔 `hidden: true`. 마이그레이션에 `game_modes` (false,false,false)와 `hidden_games` 행.
- manifest `duel: { turnSeconds: { choices: [15, 30, 60, 120, 180], default: 30 }, sameScreen: true, prepare: 'ttt_pick_puzzle' }`, 옵션 `theme` = `eng`·`esp`·`ita`·`ger`·`eur`(기본 `eur`).
- 스틸: 좌석 0(선공) 5번, 좌석 1(후공) 6번. 선공 좌석은 플랫폼이 이미 무작위로 정한다(`joinerFirst`).
- 막힌 판: 연속 6턴 칸 주인 변화 없음 → 칸 많은 쪽 승, 같으면 무승부.
- 판 규칙: 칸 정답 3~150명, 칸마다 인지도 50 이상 정답 2명 이상, 머리칸 6개 중 클럽 3~4개, 한 축에 같은 종류 셋 금지, 판 안 조건 중복 금지, 같은 머리칸 6개 판 중복 금지, 테마마다 1,000판.
- 시즌 판정(팀 동료·감독)은 그 시즌 클럽 소속이 둘 이상인 선수의 그 시즌을 세지 않는다. 클럽·리그 경력은 한 시즌이라도 소속이면 인정.
- "PL" 조건은 1992년 이후 `Q9448`만. "잉글랜드 1부"는 `Q754839`(1부 시기 1987~91) + `Q9448`.
- `logic.ts`는 순수 함수, 상대 import `.ts`. 플랫폼 코드에 게임별 분기 금지(RPC 이름은 manifest 값).
- 화면 문구 한국어, 모바일 우선, 색은 theme.css·palettes 토큰만.
- 커밋 `type: 내용` + 세션 attribution. 푸시 전 `npm test && npm run typecheck && npm run build`.

## Review Focus

1. 같은 선수를 다른 칸에 다시 내는 것(맞게 놓였던 선수) → 거절(`error`), 차례 그대로. (Task 2 `reuse_rejected`)
2. 스틸 0에서 상대 칸 선택, 내 칸 재선택, 범위 밖 칸 → 거절이고 스틸·차례 불변. (Task 2 `invalid_moves`)
3. 무승부 제안이 없는데 `acceptDraw` → 거절. 거절 직후 제안자가 바로 또 제안 → 거절. (Task 2 `draw_offer_rules`)
4. 판 준비 RPC가 실패하거나 테마에 판이 없을 때 → 대국은 시작되지 않고 409 `prepare_failed`, 판돈은 트랜잭션과 함께 되돌림. (Task 1 `prepare_failure_rolls_back`)
5. 한 화면 대전에서 `prepare` RPC 결과를 기다리는 동안·실패 시 → "판을 준비하고 있어요"/"판을 불러오지 못했어요, 다시 시도" 표시. (Task 1 `local_prepare_states`)

---

### Task 1: 대전 플랫폼 "판 준비 RPC"

**Files:**
- Modify: `src/games/types.ts` (Manifest `duel.prepare?: string`, `DuelLogic.init(rng, options, prepared?: unknown)`)
- Modify: `supabase/functions/duel/handler.ts` (join 경로의 `logic.init` 직전)
- Modify: `src/platform/duel/DuelLocalPage.tsx`
- Modify: `src/games/registry.test.ts` (prepare 이름 형식 `^[a-z_]+$`)
- Test: `supabase/functions/duel/handler.test.ts`, `src/platform/duel/DuelLocalPage.test.tsx`

**Interfaces:**
- Produces: `Manifest.duel.prepare?: string`; `DuelLogic.init(rng: () => number, options: Record<string, string>, prepared?: unknown): State`. 서버는 `select public.<prepare>(${options}::jsonb) as p`의 `p`를 넘긴다. RPC 결과가 null이거나 오류면 409 `prepare_failed`(같은 트랜잭션이라 판돈 이동도 롤백).
- 한 화면: `supabase.rpc(prepare, { p_options: options })` → `data`를 `init`에.

- [ ] **Step 1: Write failing tests**
  - `handler.test.ts` `prepare_passed_to_init`: 테스트 레지스트리에 `prepare: 'test_prepare'`인 가짜 대전 게임(그 `init`이 `prepared`를 상태에 저장)을 넣고, 테스트 DB에 `create function public.test_prepare(p jsonb) returns jsonb language sql as $$ select jsonb_build_object('theme', p->>'theme') $$`를 만든 뒤 create→join → 상태에 `{ theme: '<옵션값>' }`.
  - `prepare_failure_rolls_back`: RPC가 null을 돌려주면 join이 409 `prepare_failed`, 대국은 `waiting`, 참가자 판돈 장부 행 없음.
  - `yacht_unchanged`: prepare 없는 요트 join이 그대로 200.
  - `DuelLocalPage.test.tsx` `local_prepare_states`: prepare 있는 테스트 게임에서 rpc 대기 중 "판을 준비하고 있어요", 실패 시 "판을 불러오지 못했어요"와 "다시 시도" 버튼, 성공 시 보드가 `prepared`로 그려짐.
  - `registry.test.ts`: 대전 manifest `prepare`가 있으면 `/^[a-z_]+$/`.
- [ ] **Step 2:** Run `npm run fn:test` and `npx vitest run src/platform/duel src/games/registry.test.ts` — Expected: 새 테스트 FAIL.
- [ ] **Step 3:** 구현. 서버는 이름을 정규식으로 다시 확인한 뒤 `tx.unsafe`로 함수 이름만 끼우고 옵션은 파라미터로 넘긴다.
- [ ] **Step 4:** 같은 명령 — Expected: PASS(기존 요트·대전 테스트 포함).
- [ ] **Step 5:** Commit `feat: 대전 판 준비 RPC(manifest duel.prepare)`.

### Task 2: 게임 로직과 manifest

**Files:**
- Create: `src/games/tiki-taka-toe/manifest.ts`, `src/games/tiki-taka-toe/logic.ts`, `src/games/tiki-taka-toe/logic.test.ts`

**Interfaces:**
- Consumes: Task 1 `init(rng, options, prepared)`.
- Produces (`logic.ts`):
  - `type Header = { id: string; kind: string; label: string }`
  - `type Prepared = { puzzle_id: string; rows: Header[]; cols: Header[]; answers: string[][]; examples: string[][] }` (칸 순서 행 우선 0..8)
  - `type Action = { type: 'guess'; cell: number; playerId: string; name: string; offerDraw?: true } | { type: 'pass'; offerDraw?: true } | { type: 'acceptDraw' }`
  - `type Last = { seat: Seat; type: 'guess' | 'pass' | 'acceptDraw'; cell?: number; name?: string; correct?: boolean; steal?: boolean; offeredDraw?: boolean }`
  - `type View = { rows: Header[]; cols: Header[]; cells: { owner: Seat | null; name: string | null }[]; steals: [number, number]; toMove: Seat; drawOffer: Seat | null; canOffer: [boolean, boolean]; last: Last | null; quiet: number; examples: string[][] | null }`
  - `logic: DuelLogic<State, Action, View>`, `version: 1`. `toMove` 좌석 0 먼저. `turnNo` = 행동 수. `timeoutAction` = `{ type: 'pass' }`.
- `manifest`: Global Constraints 값, `name: '티키타카토'`, `description: '가로·세로 조건을 모두 만족하는 선수로 3칸 한 줄을 먼저 만든다'`.

- [ ] **Step 1: Write failing tests** (`logic.test.ts`, 고정 `Prepared` 픽스처: 칸 k 정답 `['P'+k, 'S'+k, 'X']`)
  - `correct_claims_and_passes_turn`: 좌석 0이 칸 0에 P0 → 칸 0 주인 0, 차례 1, last.correct true.
  - `wrong_passes_turn`: 칸 0에 P5 → 칸 비어 있음, 차례 1, last.correct false.
  - `reuse_rejected`: 좌석 0이 X를 칸 0에 맞게 놓음 → 좌석 1이 X를 칸 1에 → `error`, 차례 그대로(좌석 1). 틀린 답으로 냈던 선수는 다시 낼 수 있음.
  - `steal_counts`: 좌석 1이 좌석 0의 칸에 맞는 다른 선수 → 칸 주인 1, 좌석 1 스틸 6→5. 틀려도 5→4. 좌석 0 스틸 시작 5.
  - `invalid_moves`: 스틸 0에서 상대 칸, 내 칸, 칸 9 → 모두 `error`, 상태 불변.
  - `line_wins`: 좌석 0이 0·1·2를 차지 → `result` over, winner 0. 대각선 2·4·6도.
  - `full_board_draw`: 줄 없이 9칸 다 차면 무승부(스틸 남아 있어도).
  - `stalemate_six_quiet_turns`: 칸 주인 변화 없는 행동 6번 → over, 칸 많은 쪽 승; 같으면 무승부. 5번이면 계속.
  - `draw_offer_rules`: 좌석 0이 pass+offerDraw → 좌석 1 `acceptDraw` → 무승부. 제안 없을 때 `acceptDraw` → error. 좌석 1이 다른 행동(거절) → 좌석 0의 다음 행동에 offerDraw 붙이면 error, 그다음 행동부터 다시 가능.
  - `view_hides_answers_until_over`: 진행 중 `view.examples` null이고 JSON에 정답 id 없음; 끝나면 `examples`가 Prepared.examples.
  - `timeout_is_pass`: `timeoutAction` → pass, apply 후 차례 넘어감.
- [ ] **Step 2:** Run `npx vitest run src/games/tiki-taka-toe` — Expected: FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 같은 명령 — Expected: PASS.
- [ ] **Step 5:** Commit `feat: 티키타카토 로직`.

### Task 3: 조건별 선수 집합 (생성기 1)

**Files:**
- Create: `scripts/tiki-taka-toe/conditions.ts`, `scripts/tiki-taka-toe/conditions.test.ts`
- Create: `data/football/manual/nation_continents.csv` (`nation_id,continent` — `europe|south_america|north_america|africa|asia|oceania`; 위키데이터 P30으로 한 번 만들어 커밋)

**Interfaces:**
- Produces:
  - `type Condition = { id: string; kind: 'club'|'nation'|'continent'|'league'|'teammate'|'title'|'squad'|'award'|'manager'|'final_goal'; label_ko: string; label_en: string; ref: string; themes: Theme[] }`, `type Theme = 'eng'|'esp'|'ita'|'ger'|'eur'`
  - `buildConditions(d: FootballData): { conditions: Condition[]; players: Map<string, Set<string>> }` — `FootballData`는 `players, teams, nations, competitions, competition_eras, team_competitions, season_memberships, honours(+honours_extra 합친 것, load.sql과 같은 규칙), honour_catalog, manager_spells, nation_continents` CSV 행.
  - `readFootballData(dir: string): FootballData`.
- id 규칙: `club:<QID>`, `nation:<QID>`, `continent:<name>`, `league:<QID>`, `league:eng-top`, `teammate:<QID>`, `title:<QID>:<N>`(N=1 또는 3, 리그만 3), `title:eng-top:<N>`, `squad:<QID>`, `award:<id>`, `manager:<QID>`, `final_goal:Q19317`.
- 라벨 예: `아스널`, `프랑스`, `남미`, `세리에 A`, `잉글랜드 1부`, `즐라탄과 뛴 선수`, `PL 3회 이상 우승`, `UCL 우승`, `월드컵 출전`, `발롱도르`, `벵거 감독`, `월드컵 결승 득점`.
- 테마: 클럽은 그 리그 1부(`team_competitions` × 1부 시기) 클럽만 해당 테마 + `eur`(대상 유럽 9개 리그). 리그·득점왕·리그 우승은 그 리그 테마 + `eur`. 나머지는 모든 테마.
- 팀 동료 기준 선수: 인지도 100인 선수 중 시즌 소속 시즌 수가 많은 순 상위 150명(내 결정, 조정 가능).

- [ ] **Step 1: Write failing tests** (작은 인메모리 `FootballData`)
  - `club_any_season`: 1987+ 소속 한 시즌 → 포함, 1986만 → 제외.
  - `league_via_team_competitions`: 그 시즌 그 리그 참가 팀 소속 → 포함.
  - `teammate_same_season_single_club`: 같은 시즌 같은 클럽 → 포함, 한쪽이 그 시즌 클럽 둘 → 제외, 기준 선수 본인 제외.
  - `manager_club_and_national`: 재임 시즌 ∩ 소속(시즌 클럽 하나) → 포함; 대표팀 재임 중 `squad:` 엔트리 → 포함; 재임 밖 → 제외.
  - `title_threshold`: 리그 우승 행 3개 → `title:Q9448:3` 포함, 2개 → 제외.
  - `eng_top_combines_eras`: `Q754839` 1990 우승 + `Q9448` 1995·1996 우승 → `title:eng-top:3` 포함, `title:Q9448:3` 제외.
  - `continent_from_table`: 국적 브라질 → `continent:south_america`.
  - `club_themes`: 세리에 A 1부 클럽은 `ita`·`eur`, `eng`에는 없음.
- [ ] **Step 2:** Run `npx vitest run scripts/tiki-taka-toe/conditions.test.ts` — Expected: FAIL.
- [ ] **Step 3:** 구현 + `nation_continents.csv` 작성(모든 `nations.csv` id가 들어 있어야 함 — 테스트 `continent_table_complete`로 실데이터 확인).
- [ ] **Step 4:** 같은 명령 — Expected: PASS.
- [ ] **Step 5:** Commit `feat: 티키타카토 조건별 선수 집합`.

### Task 4: 판 고르기와 생성 명령 (생성기 2)

**Files:**
- Create: `scripts/tiki-taka-toe/puzzles.ts`, `scripts/tiki-taka-toe/puzzles.test.ts`, `scripts/tiki-taka-toe/generate.ts`
- Modify: `package.json` (`"ttt:generate": "node scripts/tiki-taka-toe/generate.ts"`)
- Create: `data/tiki-taka-toe/{conditions,condition_players,puzzles}.csv` (생성 결과)

**Interfaces:**
- Consumes: Task 3 `buildConditions`, `readFootballData`, `Condition`, `Theme`.
- Produces:
  - `type Puzzle = { id: string; theme: Theme; rows: [string, string, string]; cols: [string, string, string] }`
  - `type PuzzleRules = { minAnswers: 3; maxAnswers: 150; minKnown: 2; knownPopularity: 50; clubs: [3, 4] }` (`DEFAULT_RULES`)
  - `validPuzzle(p: Puzzle, sets: Map<string, Set<string>>, kinds: Map<string, string>, popularity: Map<string, number>, rules?: PuzzleRules): boolean`
  - `generatePuzzles(theme: Theme, n: number, conditions: Condition[], sets, popularity, seed: number): Puzzle[]` — 결정적(시드 고정). 같은 머리칸 6개(순서 무관 행/열 집합) 중복 없음.
- CSV: `conditions.csv` `id,kind,label_ko,label_en,ref`, `condition_players.csv` `condition_id,player_id`(판에 쓰인 조건만), `puzzles.csv` `id,theme,r1,r2,r3,c1,c2,c3`(id = `<theme>-<0001>`).

- [ ] **Step 1: Write failing tests**
  - `rejects_small_and_large_cells`: 칸 정답 2명 또는 151명이면 false, 3·150이면 true.
  - `rejects_unknown_only`: 인지도 50 이상 정답이 1명뿐인 칸 → false.
  - `club_count_and_axis_kinds`: 클럽 2개·5개 → false, 한 축 국적 셋 → false.
  - `no_duplicate_condition`: 같은 조건 두 번 → false.
  - `deterministic_and_unique`: 같은 시드 두 번 → 같은 결과, 결과 안 머리칸 집합 중복 없음, 모두 `validPuzzle`.
- [ ] **Step 2:** Run `npx vitest run scripts/tiki-taka-toe/puzzles.test.ts` — Expected: FAIL.
- [ ] **Step 3:** 구현. 생성은 클럽 3~4개를 테마 클럽에서 고르고 나머지를 다른 종류에서 뽑아 행/열에 나눈 뒤 `validPuzzle` 통과할 때까지 반복(테마당 시도 상한, 못 채우면 만든 만큼 쓰고 출력에 알림).
- [ ] **Step 4:** 테스트 PASS. Run `npm run ttt:generate` — Expected: 테마별 `판 1000`(또는 부족 알림), 칸 정답 수 분포(최소·중앙·최대) 출력.
- [ ] **Step 5:** Commit `feat: 티키타카토 문제 생성기와 문제 은행`.

### Task 5: DB 테이블·RPC·적재

**Files:**
- Create: `supabase/migrations/<ts>_tiki_taka_toe.sql` (`npx supabase@2 migration new tiki_taka_toe`)
- Create: `scripts/tiki-taka-toe/load.sh`, `scripts/tiki-taka-toe/load.sql`; Modify `package.json` (`"ttt:load"`)
- Create: `supabase/tests/fixtures/tiki-taka-toe/*.csv`(축구 픽스처 선수만 쓰는 작은 판 1개)
- Test: `supabase/tests/25_tiki_taka_toe.test.sql`; Modify `scripts/db-test.sh`(축구 픽스처 다음에 ttt 픽스처 적재)

**Interfaces:**
- Produces: `ttt_conditions(id pk, kind, label_ko, label_en, ref)`, `ttt_condition_players(condition_id references ttt_conditions, player_id references football_players, pk(condition_id, player_id))`, `ttt_puzzles(id pk, theme check in (...), r1..c3 references ttt_conditions)`, 세 테이블 RLS on·클라이언트 권한 없음. `ttt_pick_puzzle(p_options jsonb) returns jsonb` security definer, 승인 사용자만(`is_approved()`), 반환은 Task 2 `Prepared` 모양(`examples`는 칸별 인지도 순 상위 5명 `coalesce(name_ko, name_en)`). 테마 없거나 판 없으면 null.
- `game_modes` ('tiki-taka-toe', false, false, false), `hidden_games` ('tiki-taka-toe').

- [ ] **Step 1: Write failing DB test**: 픽스처 적재 뒤 승인 사용자 `ttt_pick_puzzle('{"theme":"eur"}')` → rows·cols 3개씩, answers 9개, 각 칸 정답이 `ttt_condition_players` 교집합과 같음; 없는 테마 → null; 비승인 사용자 → 권한 오류; `ttt_puzzles` 직접 select → 0행/권한 오류.
- [ ] **Step 2:** Run `npm run db:test` — Expected: FAIL.
- [ ] **Step 3:** 마이그레이션·적재 스크립트(한 트랜잭션 통째 교체, 축구 `load.sh` 방식) 작성.
- [ ] **Step 4:** Run `npm run db:test` — Expected: PASS.
- [ ] **Step 5:** Commit `feat: 티키타카토 테이블·판 고르기 RPC·적재`.

### Task 6: 화면과 등록

**Files:**
- Create: `src/games/tiki-taka-toe/Game.tsx`, `src/games/tiki-taka-toe/Game.test.tsx`, `src/games/tiki-taka-toe/ttt.css`(토큰만)
- Modify: `src/games/index.ts`(`duels`), `src/games/ui.ts`(`getDuelComponent`)

**Interfaces:**
- Consumes: Task 2 `View`, `Action`; `DuelGameProps`; `football_search(p_q, 'player', 8)` RPC.

- [ ] **Step 1: Write failing tests** (`Game.test.tsx`, supabase rpc 목)
  - `renders_headers_and_cells`: 머리칸 라벨 6개와 칸 9개, 칸 주인 이름.
  - `pick_cell_search_submit`: 빈 칸 누름 → 검색 입력 → 자동완성 결과 고름 → `onAction({ type: 'guess', cell, playerId, name })`.
  - `steal_label_and_block`: 상대 칸은 "스틸(남은 n번)", 스틸 0이면 누를 수 없음, 내 칸은 누를 수 없음.
  - `skip_and_draw_controls`: "턴 넘기기" → `{type:'pass'}`; 무승부 제안 체크 후 행동 → `offerDraw: true`; 상대 제안 시 "무승부 수락" → `{type:'acceptDraw'}`; `canOffer`가 false면 체크 비활성.
  - `examples_after_end`: `finished`이면 칸마다 정답 예시 이름.
  - `last_move_line`: last가 틀린 답이면 "○○ → 틀림" 문구.
- [ ] **Step 2:** Run `npx vitest run src/games/tiki-taka-toe src/games/registry.test.ts src/games/ui.test.ts` — Expected: FAIL.
- [ ] **Step 3:** 구현·등록.
- [ ] **Step 4:** 같은 명령 — Expected: PASS(등록부 테스트 포함: `game_modes`·`hidden_games` 마이그레이션 일치).
- [ ] **Step 5:** Commit `feat: 티키타카토 화면과 등록`.

### Task 7: 실데이터 점검·문서·PR

**Files:**
- Modify: `CLAUDE.md`(폴더 규칙·대전 게임 절차에 `duel.prepare`, 티키타카토 데이터 갱신 순서 `football:honours → ttt:generate → ttt:load`), `data/football/README.md`(한 줄 안내)

- [ ] **Step 1:** 로컬 DB(`scripts/db-up.sh`)에 `football:load` → `ttt:load` → 각 테마 `ttt_pick_puzzle` 5판씩 뽑아 칸 정답 상위 5명을 출력해 PR 본문에 붙인다(사용자 축잘알 확인용).
- [ ] **Step 2:** Run `npm test && npm run typecheck && npm run build && npm run db:test && npm run fn:test` — Expected: 모두 PASS.
- [ ] **Step 3:** Commit `docs: 티키타카토 절차`, PR(숨김). 운영 반영(마이그레이션·`ttt:load`·`duel` 함수 배포)은 머지 뒤 사용자 확인 후.

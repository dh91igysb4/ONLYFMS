# 1대1 대전 플랫폼 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실시간 턴제 1대1 대전(대국 생성·참가·턴·시간 초과·서버 판정·Elo·전적)과 첫 게임 요트 다이스, 같은 화면 모드를 붙인다.

**Architecture:** 대전 게임은 `src/games/<id>/`에 `DuelLogic`(순수 함수)으로 두고 별도 등록부 `duels`에 올린다. 새 Edge Function `duel`이 행 잠금 트랜잭션 안에서 판정·저장하고, 커밋 뒤 Supabase Realtime 브로드캐스트로 "바뀜" 신호만 보낸다. 화면은 신호·5초 폴링으로 `view`를 다시 받는다. Elo·전적·순위는 SQL 함수다.

**Tech Stack:** Vite 5 + React 18 + TS, Vitest + Testing Library, Supabase Postgres(RLS, definer 함수, pgTAP), Deno 2 Edge Function(`npm:postgres`, `npm:@supabase/supabase-js`), Supabase Realtime broadcast.

**Spec:** `docs/superpowers/specs/2026-11-01-duel-platform-design.md` (선행: `docs/superpowers/specs/2026-10-31-onlyfms-platform-design.md`). `CLAUDE.md`를 먼저 읽는다.

## Global Constraints

- 화면 문구는 모두 한국어, 모바일 우선, `src/app/theme.css`의 짙은 보라 단일 테마.
- 플랫폼 코드에 게임 id 분기 금지. 대전/솔로는 `manifest.category`와 등록부(`games` / `duels`)로만 나눈다.
- `logic.ts`·`types.ts`·`src/shared/*`는 순수 함수, 외부 의존 없음, 상대 import는 `.ts` 확장자. React·DOM을 import하지 않는다(Deno가 가져감).
- Edge Function import는 상대 경로 또는 `npm:` 지정자만(jsr, deno.land 금지).
- DB 변경은 새 마이그레이션 파일로만. 0001~0007은 운영에 적용됨 — 고치지 않는다. 대전 마이그레이션 번호는 실행 시점의 **다음 빈 번호**(이 문서에서는 `NNNN`으로 표기, 작성 당시 0008. main 병합 후 실제 번호는 `0011_yacht.sql`·`0012_duel.sql`).
- 정의자 함수는 `security definer set search_path = public`, 오류는 `raise exception using errcode = 'P0001', message = '<code>'`, 새 테이블·함수는 기본 권한 회수 후 필요한 것만 grant(0001~0005 패턴).
- 시각은 서버 시계만 쓴다. 브라우저 시각은 남은 시간 표시에만 쓰고, `src/lib/serverTime.ts`로 보정한다.
- `duel_matches.state`는 브라우저가 어떤 경로로도 읽을 수 없다. 브라우저에는 `logic.view` 결과만 간다.
- Elo: 시작 1000, `E = 1/(1+10^((Rb−Ra)/400))`, `Δ = round(K × (S − E))`, K = `rated_games < 10`이면 40 아니면 20. 랭크 5판 미만은 순위에서 빼고 "배치 중".
- 시간 초과: 게임의 `timeoutAction`을 턴이 넘어갈 때까지 서버가 반복 적용, 좌석별 연속 초과 2회면 상대 승(`end_reason = 'timeout'`). 시간 초과로 넘어간 턴의 새 마감 = 이전 마감 + `turn_seconds`.
- 무효: 어느 한쪽이라도 첫 행동 전에 대국이 끝나거나, 진행 중 대국의 `logic_version`이 현재와 다르면 `status = 'void'`, Elo·전적 미반영.
- 대기 대국: 1인당 동시 3개, 10분 무참가 시 자동 무효.
- 요트 턴 시간 선택지 [30, 60, 90], 기본 60.
- 커밋 메시지 `type: 내용`(한국어 가능) + 세션 트레일러. 푸시 전 `npm test && npm run typecheck && npm run build`, 해당 시 `npm run db:test`, `npm run fn:test`.
- 비밀값 커밋 금지.

## Review Focus

1. 마감 순간 두 사람의 화면이 동시에 `tick`/`move`를 보냄 → 하나만 적용되고 다른 쪽은 409 + 최신 상태(중복 적용·이중 시간 초과 없음). Task 4 테스트로 고정.
2. 같은 대국을 두 탭에서 열고 둘 다 행동 → `expected_action_no`로 두 번째가 409 `stale` + 최신 상태. Task 4.
3. 브라우저 시계가 빨라 마감 전에 `tick`을 보냄 → 서버가 409 `not_due` + 최신 상태, 화면은 마감까지 다시 보내지 않는다(요청 폭주 없음). Task 4(서버), Task 5(화면).
4. 이미 시작했거나 끝난 대국의 초대 링크를 연 제3자 → 오류 화면이 아니라 "이미 시작된 대국이에요"와 대전 탭 링크. 자기 대국 링크를 열면 그 대국 화면으로 이동. Task 5.
5. Realtime 연결 실패(구독 오류·끊김) → 5초 폴링만으로 대국이 끝까지 진행된다. Task 5(폴링이 신호와 독립적으로 도는지 테스트).

---

### Task 1: 대전 계약 타입과 등록부

**Files:**
- Modify: `src/games/types.ts` (타입 추가)
- Modify: `src/games/index.ts` (`duels`, `getDuel`)
- Modify: `src/games/registry.test.ts`
- Modify: `supabase/functions/play/handler.ts` 확인만(대전 게임은 `games`에 없으므로 `play`가 404를 낸다 — 테스트로 고정)

**Interfaces:**
- Produces (in `src/games/types.ts`):
  - `type Seat = 0 | 1`
  - `type DuelResult = { over: false } | { over: true; winner: Seat | null; scores?: [number, number] }`
  - `interface DuelLogic<State, Action, View> { version: number; init(rng: () => number, options: Record<string, string>): State; toMove(state: State): Seat; apply(state: State, seat: Seat, action: Action, rng: () => number): { state: State } | { error: string }; timeoutAction(state: State): Action; turnNo(state: State): number; result(state: State): DuelResult; view(state: State, viewer: Seat | null): View }`
  - `Manifest`에 선택 필드 `category?: 'solo' | 'duel'`, `duel?: { turnSeconds: { choices: number[]; default: number }; sameScreen: boolean }`
  - `type DuelModule = { manifest: Manifest; logic: DuelLogic<any, any, any> }`
- Produces (in `src/games/index.ts`): `export const duels: DuelModule[]` (이 Task에서는 빈 배열), `export function getDuel(id: string): DuelModule | undefined`

- [ ] **Step 1: 등록부 테스트 추가** (`registry.test.ts`)
  - `test('duel modules: category duel, all solo modes off, turnSeconds default in choices, ids unique across games and duels')`: `duels`마다 `manifest.category === 'duel'`, `modes`가 모두 false, `duel.turnSeconds.choices`에 `default` 포함, `games`와 `duels`의 id 합집합에 중복 없음.
  - `test('solo modules have no duel category')`: `games`마다 `manifest.category ?? 'solo'`가 `'solo'`.
  - 기존 `game_modes`·`hidden_games` 마이그레이션 일치 테스트가 `games`와 `duels`를 **둘 다** 대상으로 하도록 바꾼다(대전 게임도 `game_modes` 행이 (false,false,false)로 있어야 함).
- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run src/games/registry.test.ts` → `duels` import 실패.
- [ ] **Step 3: 타입과 `duels`/`getDuel` 구현** (빈 배열).
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/registry.test.ts && npm run typecheck`.
- [ ] **Step 5: 커밋** — `feat: 대전 게임 계약(DuelLogic)과 등록부`

---

### Task 2: 요트 다이스 로직

**Files:**
- Create: `src/games/yacht/manifest.ts`, `src/games/yacht/scoring.ts`, `src/games/yacht/logic.ts`
- Test: `src/games/yacht/scoring.test.ts`, `src/games/yacht/logic.test.ts`
- Modify: `src/games/index.ts` (`duels`에 한 줄)

**Interfaces:**
- Consumes: Task 1의 `DuelLogic`, `Seat`, `DuelResult`, `Manifest`.
- Produces (`scoring.ts`):
  - `type Category = 'aces'|'twos'|'threes'|'fours'|'fives'|'sixes'|'choice'|'threeKind'|'fourKind'|'fullHouse'|'smallStraight'|'largeStraight'|'yacht'` 그리고 `CATEGORIES: Category[]`(이 순서 = 표 순서 = 동점 시 우선순위)
  - `type Sheet = Partial<Record<Category, number>>`
  - `rawScore(dice: number[], c: Category): number` — 조커 없는 기본 점수
  - `allowed(dice: number[], sheet: Sheet): Category[]` — 조커 규칙을 반영해 지금 적을 수 있는 칸
  - `scoreFor(dice: number[], c: Category, sheet: Sheet): number` — 조커면 아래 칸 만점(fullHouse 25, smallStraight 30, largeStraight 40, 3·4 of a kind·choice는 합)
  - `yachtBonus(dice: number[], sheet: Sheet): number` — 이번 기록으로 생기는 +100(Yacht 칸이 50이고 5개 같을 때만)
  - `total(sheet: Sheet, bonus: number): number` — 위 칸 합 + (위 칸 합 ≥ 63이면 35) + 아래 칸 합 + bonus
- Produces (`logic.ts`):
  - `type YState = { sheets: [Sheet, Sheet]; bonus: [number, number]; seat: Seat; dice: number[]; rolls: number }` (`rolls` = 이번 턴 굴린 횟수 0~3, `dice` 길이 5 또는 굴리기 전 빈 배열)
  - `type YAction = { type: 'roll'; keep: number[] } | { type: 'score'; category: Category }`
  - `export const logic: DuelLogic<YState, YAction, YState>` (version 1; `view`는 상태 그대로), `init`은 `seat: 0` 시작(선공 좌석 결정은 서버가 `players` 순서로 함)
  - `turnNo(state)` = 두 시트의 채운 칸 수 합(0~26)
- manifest: id `yacht`, name `요트 다이스`, description `주사위 5개로 13칸을 채워 더 높은 점수를 낸다`, `hidden: true`, `category: 'duel'`, `modes` 모두 false, `puzzleSource: 'generate'`, `options: []`, `duel: { turnSeconds: { choices: [30, 60, 90], default: 60 }, sameScreen: true }`.

- [ ] **Step 1: `scoring.test.ts` 작성** — 값은 스펙 §8 그대로.
  - `rawScore`: `[1,1,1,2,3]` aces 3; `[2,2,2,5,5]` threeKind 16, fourKind 0, fullHouse 25; `[4,4,4,4,1]` fourKind 17, threeKind 17; `[1,2,3,4,6]` smallStraight 30, largeStraight 0; `[2,3,4,5,6]` largeStraight 40, smallStraight 30; `[6,6,6,6,6]` yacht 50, fullHouse 0(조커 없이), choice 30; `[3,3,3,3,3]` fullHouse 0.
  - `total`: 위 칸 합 62 → 보너스 없음, 63 → +35; bonus 200 포함.
  - 조커(`[5,5,5,5,5]`, sheet.yacht = 50):
    - fives 비어 있음 → `allowed` = `['fives']`만, `yachtBonus` = 100
    - fives 참 → `allowed`는 비어 있는 아래 칸 전부, `scoreFor(…,'largeStraight')` = 40, `'fullHouse'` 25, `'smallStraight'` 30, `'choice'` 25
    - fives 참 + 아래 칸 모두 참 → `allowed` = 비어 있는 위 칸, `scoreFor` = 0
    - sheet.yacht = 0이면 배치 규칙은 같고 `yachtBonus` = 0
  - Yacht 칸이 비어 있을 때 `[5,5,5,5,5]` → 조커 아님, `allowed`는 빈 칸 전부, `scoreFor(…,'yacht')` = 50.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/yacht`.
- [ ] **Step 3: `scoring.ts` 구현**.
- [ ] **Step 4: `logic.test.ts` 작성** (고정 rng `seeded(n)`은 who-are-ya 테스트의 mulberry32를 복사)
  - `roll_rules`: 첫 행동이 `score`면 오류; `roll` 3번 뒤 4번째 `roll` 오류; `keep` 위치의 눈이 굴린 뒤에도 같음; 첫 굴림의 `keep`이 비어 있지 않으면 오류; keep에 범위 밖·중복 인덱스 오류.
  - `turn_flow`: `score` 뒤 `seat`가 바뀌고 `dice=[]`, `rolls=0`; 차례 아닌 좌석의 행동은 오류; 이미 찬 칸·`allowed`에 없는 칸 오류.
  - `same_seed_same_dice`: 같은 시드·같은 행동열 → 같은 주사위.
  - `game_end`: 26번 `score` 뒤 `result.over`; 총점 큰 쪽 승, 같으면 `winner: null`; `scores`가 `total` 값과 같음; 끝난 뒤 행동 오류.
  - `timeout_action`: 안 굴린 상태 → `{roll, keep: []}`; 굴린 상태 → `{score: 최고점 칸}`; 동점이면 `CATEGORIES` 순서상 앞 칸; 조커 상황에서는 `allowed` 안에서만 고름; `timeoutAction`을 적용하고 다시 부르기를 반복하면 2번 안에 턴이 넘어감(rng를 매번 새로 줘도 항상 합법).
  - `turn_no`: 시작 0, 칸 하나 채우면 1.
- [ ] **Step 5: 실패 확인 → `logic.ts`, `manifest.ts` 구현, `index.ts`의 `duels`에 등록 → 통과 확인** — `npx vitest run src/games && npm run typecheck`.
- [ ] **Step 6: 커밋** — `feat: 요트 다이스 규칙과 점수`

---

### Task 3: 대전 DB (테이블·권한·Elo·목록·통계)

**Files:**
- Create: `supabase/migrations/NNNN_duel.sql`
- Test: `supabase/tests/07_duel.test.sql` (pgTAP, 기존 테스트 형식·`shim.sql` 사용)

**Interfaces:**
- Consumes: `profiles`, `is_approved()`, `is_admin()`, `_new_invite_code()`(0003), `hidden_games`, `game_modes`.
- Produces (테이블, 스펙 §5 컬럼 그대로): `duel_matches`, `duel_moves`, `duel_ratings`, `duel_rating_changes`. enum `duel_status('waiting','active','finished','void')`, `duel_end_reason('normal','resign','timeout','void')`, `duel_visibility('public','invite')`.
- Produces (함수; Edge Function이 `service`로 쓰는 것은 `authenticated`에 grant하지 않음):
  - `_duel_apply_elo(p_match uuid) returns void` — 랭크·`finished`·winner/무승부일 때만 두 사람 `duel_ratings` upsert(없으면 1000), `rated_games`·승무패 +1, `duel_rating_changes` 두 행. 친선·무효는 아무것도 안 함. 두 번 불러도 한 번만 반영(이미 `duel_rating_changes` 있으면 무시).
  - `duel_list() returns jsonb` — `{ lobby: [...공개 waiting...], mine: [...내 waiting/active...], recent: [...내 최근 종료 10개...], due: [uuid...] }`. 호출 시 10분 지난 `waiting`을 `void`로 바꾼다. `due`는 내가 참가자이고 `active`이며 `turn_deadline < now()`인 대국 id. 각 항목: `id, game_id, rated, visibility, turn_seconds, status, players[{id,handle,rating}], created_by_handle, created_at, winner, end_reason, final_scores`. `state`는 넣지 않는다. 숨김 게임은 관리자만.
  - `duel_invite_code(p_match uuid) returns text` — 만든 사람만.
  - `lb_duel(p_game text) returns table(handle text, rating int, rated_games int, wins int, draws int, losses int, placed boolean)` — `placed = rated_games >= 5`, rating 내림차순.
  - `duel_stats(p_handle text, p_game text) returns jsonb` — `{ rating, rated: {w,d,l,rate}, all: {w,d,l,rate}, recent: [최근 20판: id, opponent_handle, result('win'|'draw'|'loss'), rated, ended_at, my_score, opp_score] }`. `p_game` null이면 게임별 배열.
  - `duel_h2h(p_handle_a text, p_handle_b text, p_game text) returns jsonb` — `{ games: [{game_id, a_wins, draws, b_wins}], recent: [최근 20판] }`.
- `game_modes`에 `('yacht', false, false, false)`, `hidden_games`에 `'yacht'`.
- 권한: `duel_matches`는 `state` 제외 컬럼만 `select` grant, RLS는 "참가자, 만든 사람, 또는 공개 waiting"만. `duel_moves`는 RLS "대국 종료 후 참가자". 쓰기는 브라우저에 모두 불허(Edge Function은 DB 직접 연결로 씀). `duel_ratings`·`duel_rating_changes`는 승인 사용자 읽기.

- [ ] **Step 1: `07_duel.test.sql` 작성** — 케이스(이름 그대로 `is`/`throws_ok`/`ok` 메시지에 사용):
  - `state_not_readable`: authenticated로 `select state from duel_matches` → 권한 오류.
  - `rls_hides_others_invite_match`: 남의 invite 대국은 안 보임, 공개 waiting은 보임.
  - `moves_hidden_until_finished`: 진행 중 대국의 `duel_moves`는 참가자도 0행, 종료 후 참가자 보임, 제3자 0행.
  - `no_browser_writes`: authenticated의 insert/update `duel_matches` 거부.
  - `elo_win`: 1000 vs 1000 랭크 승 → 1020 / 980 (K 40, E 0.5).
  - `elo_draw_unequal`: 1200(rated_games 10) vs 1000(rated_games 0) 무승부 → Δ = round(20×(0.5−0.7597)) = −5 → 1195, round(40×(0.5−0.2403)) = 10 → 1010.
  - `elo_k_switch`: rated_games 9 → K 40, 10 → K 20.
  - `elo_idempotent`: `_duel_apply_elo` 두 번 → 한 번만 반영.
  - `friendly_and_void_unrated`: 친선 승·무효 대국은 `duel_ratings` 변화 없음, 친선은 `duel_stats.all`에 포함·`rated`에 미포함, 무효는 둘 다 미포함.
  - `list_autovoids_stale_waiting`: 11분 지난 waiting → `duel_list()` 후 `void`.
  - `list_due`: 마감 지난 내 active 대국 id가 `due`에 있음.
  - `lb_placed`: 4판 사용자는 `placed = false`, 5판은 true, 순서는 rating 내림차순.
  - `h2h_counts`: A가 B를 2승 1무 1패 → `a_wins 2, draws 1, b_wins 1`.
  - `hidden_game_excluded`: yacht 숨김 상태에서 비관리자 `duel_list`·`lb_duel('yacht')`에 안 나옴, 관리자는 보임.
  - `invite_code_owner_only`.
- [ ] **Step 2: 실패 확인** — `npm run db:test` → 06 실패.
- [ ] **Step 3: 마이그레이션 구현.**
- [ ] **Step 4: 통과 확인** — `npm run db:test` 전체 PASS, `npx vitest run src/games/registry.test.ts` PASS(yacht 숨김·game_modes 일치).
- [ ] **Step 5: 커밋** — `feat: 대전 테이블·Elo·전적 함수`

---

### Task 4: Edge Function `duel`

**Files:**
- Create: `supabase/functions/duel/index.ts`, `handler.ts`, `deno.json`(play와 같은 imports), `handler.test.ts`
- Modify: `supabase/config.toml` (`[functions.duel] verify_jwt = false`), `scripts/fn-test.sh`(play와 duel 두 디렉터리를 모두 돌린다)
- 재사용: `../_shared/db.ts`(`createSql`, `txOn`, `Sql`, `Tx` — 상대 import), `../../../src/shared/rng.ts`, `../../../src/games/index.ts`

**Interfaces:**
- Consumes: Task 1 `getDuel`, `DuelLogic`; Task 3 테이블과 `_duel_apply_elo`.
- Produces:
  - `export type DuelDeps = { sql: Sql; now: () => number; getUserId(req: Request): Promise<string | null>; secret: string; broadcast(matchId: string, payload: { action_no: number; status: string }): Promise<void>; registry?: { getDuel(id: string): DuelModule | undefined } }`
  - `export async function handle(req: Request, deps: DuelDeps): Promise<Response>`
  - 응답 `DuelView = { match_id, game_id, options, rated, visibility, status, turn_seconds, players: { id, handle, rating }[], my_seat: 0|1|null, to_move: 0|1|null, action_no, turn_deadline: string|null, server_now: number, view: unknown, winner: 0|1|null, end_reason: string|null, final_scores: [number,number]|null, rating_change?: { before: number; after: number } }`
  - 요청 `{ action: 'create', game_id, options, rated, visibility, turn_seconds }` → `{ match_id, invite_code|null }`; `'join'`(match_id 또는 code), `'cancel'`, `'view'`, `'move'`(match_id, expected_action_no, payload), `'tick'`, `'resign'` → `DuelView`.
  - 오류 코드: 401 `unauthorized`; 403 `not_approved`, `not_player`; 404 `unknown_game`, `not_found`; 409 `not_your_turn`, `stale`, `finished`, `not_waiting`, `full`, `own_match`, `too_many_waiting`, `not_due`, `version_changed`; 400 `invalid_action`. 409에는 가능하면 `view: DuelView`를 같이 싣는다.
- 핵심 규칙:
  - 난수: `rngFromSeed(await hmacSeed(secret, \`duel:${matchId}:${actionNo}\`))`, `actionNo`는 적용 직전 `action_no`. 선공 결정은 `actionNo = -1` 시드의 첫 값 < 0.5면 참가자가 선공.
  - `move`: 잠금 → 상태 `active` 아니면 409 `finished`/`not_waiting` → 로직 버전 다르면 void 처리 후 409 `version_changed` → 마감 지났으면 먼저 시간 초과 처리(아래)를 하고 409 `stale` → 좌석 확인 409 `not_your_turn` → `expected_action_no` 불일치 409 `stale` → `apply`(예외는 로그 후 400) → `duel_moves` 기록, `moved[seat] = true`, `turnNo`가 바뀌었으면 `timeouts[seat] = 0`, 새 마감 = now + turn_seconds → `result.over`면 `finished`/`normal`, `final_scores`, `_duel_apply_elo` → 커밋 → `broadcast`.
  - `tick`: 잠금 → 마감 안 지났으면 409 `not_due` + view → 지난 턴마다: `timeoutAction` 적용 후 다시 부르기를 `turnNo`가 바뀔 때까지(최대 8회, 매번 `rng(action_no)`) 반복(`auto = true`), `timeouts[seat] += 1`, 2면 상대 승 `timeout` 종료, 아니면 새 마감 = 이전 마감 + turn_seconds; 새 마감도 지났으면 반복.
  - 종료 시 무효 판정: `moved`에 false가 있으면 `void`(Elo 안 부름). 기권(`resign`)·시간 초과 종료 모두 적용.
  - 브로드캐스트 실패는 로그만, 응답은 정상.
  - `index.ts`: `broadcast`는 `fetch(\`${SUPABASE_URL}/realtime/v1/api/broadcast\`, { method: 'POST', headers: { apikey: KEY, authorization: \`Bearer ${KEY}\`, 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ topic: \`duel:${id}\`, event: 'update', payload }] }) })`. `KEY`는 `SUPABASE_SERVICE_ROLE_KEY`, 없으면 `SUPABASE_SECRET_KEYS`(JSON 사전의 `default` 또는 첫 값). 어느 키가 받아들여지는지는 배포 체크리스트에서 원격 확인(Task 8).

- [ ] **Step 1: `handler.test.ts` 작성** (play의 handler.test.ts 패턴: `TEST_DB_URL`, 가짜 `getUserId`, 고정 `now`, 가짜 `broadcast`가 호출 기록). 테스트용 레지스트리에 요트를 쓰되, 결정적 짧은 판이 필요하면 테스트 안에 2턴짜리 가짜 `DuelLogic`(`coin`)을 정의해 쓴다.
  - `create_join_play_to_end_updates_elo` (가짜 coin, 랭크) → 종료 view의 `rating_change` 1000→1020 / 1000→980, `broadcast` 매 행동마다 호출.
  - `yacht_full_game_through_handler`: 26턴을 각 턴 `roll`→`score(allowed[0])`로 끝까지, `final_scores`가 로직 `total`과 같음.
  - `not_your_turn_409`, `stale_expected_action_no_409_with_view`.
  - `concurrent_tick_and_move_at_deadline`: 마감 직후 `tick`과 `move`를 `Promise.all`로 → 정확히 하나만 적용(`action_no` 증가량이 한 턴 분량), 다른 하나는 409.
  - `early_tick_not_due`: 마감 전 `tick` → 409 `not_due` + view, 상태 변화 없음.
  - `timeout_once_auto_moves_then_twice_forfeits`: 한 번 → `auto` 행동 기록·차례 넘어감·`timeouts=[1,0]`; 그 사람이 다시 초과 → `finished`, `timeout`, 상대 승, Elo 반영.
  - `chained_timeouts_when_both_absent`: 마감 + 3×turn_seconds 뒤 `tick` 한 번 → 연쇄 처리로 종료.
  - `resign_before_first_move_is_void`: 참가 직후 기권 → `void`, Elo 변화 없음.
  - `join_rules`: 자기 대국 409 `own_match`, 꽉 찬 대국 409 `full`(제3자), 같은 사람이 다시 join하면 그 대국 view(멱등), 코드로 join.
  - `waiting_limit_3`: 4번째 create 409 `too_many_waiting`.
  - `version_change_voids_active`: 레지스트리의 버전을 올린 뒤 `move` → 409 `version_changed`, `void`.
  - `state_never_in_response`: 모든 응답 JSON에 `sheets` 등 상태 키가 `view` 밖에 없음(=`view`만 포함). (요트는 view=상태지만 키가 `view` 안에만 있어야 함)
  - `unapproved_403`, `unknown_game_404`, `play_rejects_duel_game`: `play` 핸들러에 `{action:'daily', game_id:'yacht'}` → 404.
- [ ] **Step 2: 실패 확인** — `DENO=… npm run fn:test`.
- [ ] **Step 3: `handler.ts`, `index.ts`, `deno.json`, config, `fn-test.sh` 구현.**
- [ ] **Step 4: 통과 확인** — `npm run fn:test` 전체 PASS, `cd supabase/functions/duel && deno check index.ts`.
- [ ] **Step 5: 커밋** — `feat: duel Edge Function (대국 생성·참가·수·시간 초과·기권)`

---

### Task 5: 대전 탭·대국 화면 (플랫폼)

**Files:**
- Modify: `src/lib/api.ts` (`duel()`, `DuelView` 타입, 오류 문구)
- Create: `src/platform/duel/data.ts` (`useDuelMatch` 훅), `DuelHomePage.tsx`, `DuelMatchPage.tsx`, `DuelJoinPage.tsx`, 테스트 `DuelHomePage.test.tsx`, `DuelMatchPage.test.tsx`
- Modify: `src/games/ui.ts` (`DuelGameProps`, `getDuelComponent`), `src/app/routes.tsx`, `src/platform/layout/Layout.tsx`(네비 "대전")

**Interfaces:**
- Consumes: Task 4 요청·응답·오류 코드, Task 3 `duel_list()`, `duel_invite_code()`.
- Produces:
  - `api.ts`: `export async function duel(body: Record<string, unknown>): Promise<DuelView>` (`play()`와 같은 방식, 경로 `/functions/v1/duel`, 409 본문의 `view`를 `ApiError.body`로 전달). 문구: `not_your_turn` "상대 차례예요", `stale` "화면을 새로 맞췄어요", `full` "이미 시작된 대국이에요", `own_match` "내가 만든 대국이에요", `too_many_waiting` "기다리는 대국은 3개까지 만들 수 있어요", `not_due`(표시 안 함), `version_changed` "규칙이 바뀌어 이 대국은 무효가 됐어요".
  - `ui.ts`: `export type DuelGameProps = { view: unknown; mySeat: 0 | 1 | null; toMove: 0 | 1 | null; finished: boolean; busy: boolean; error: string | null; onAction(action: unknown): void; names: [string, string] }`, `getDuelComponent(id): ComponentType<DuelGameProps> | undefined`.
  - `data.ts`: `useDuelMatch(id: string): { view: DuelView | null; error: string | null; busy: boolean; act(payload: unknown): void; resign(): void }` — 마운트 시 `view`; `supabase.channel(\`duel:${id}\`).on('broadcast', { event: 'update' }, …)` 수신 시 `view`; 신호와 무관한 5초 `setInterval` `view`; 남은 시간 ≤ 0이고 이 마감으로 아직 `tick`을 안 보냈으면 `tick` 한 번(같은 `turn_deadline`에는 다시 안 보냄, 409 `not_due`면 그 마감까지 대기); 409에 `view`가 있으면 그걸로 교체; 언마운트 시 채널·타이머 정리.
- 라우트: `/duel`(DuelHomePage), `/duel/:id`(DuelMatchPage), `/duel/join/:code`(DuelJoinPage), `/duel/local/:game`(Task 6). 모두 `RequireApproved` 아래(초대 링크는 기존 redirect 유지 동작 그대로).

- [ ] **Step 1: 테스트 작성** (`vi.mock('../../lib/api.ts')`, 가짜 채널, 가짜 타이머)
  - `home_create_form`: 게임 선택(대전 게임만, 숨김은 관리자만), 랭크/친선, 공개/초대, 턴 시간 선택지 = manifest `choices`, 기본 = `default`; 만들기 → `duel({action:'create', …})` 후 `/duel/:id` 이동.
  - `home_lists`: `duel_list` 결과의 lobby·mine·recent 표시, `due`의 각 id에 `duel({action:'tick'})` 호출, 대기실 5초 폴링.
  - `match_my_turn_only`: `to_move !== my_seat`면 게임 컴포넌트 `onAction`이 호출돼도 요청 안 보냄, 헤더에 "상대 차례".
  - `match_tick_once_per_deadline`: 마감 경과 → `tick` 1회, 같은 마감에서 시간이 더 흘러도 추가 호출 없음; 409 `not_due` 응답 뒤에도 추가 호출 없음.
  - `match_polls_without_realtime`: 채널 구독이 오류를 내도 5초마다 `view` 호출.
  - `match_resign_two_step`: 첫 클릭 "한 번 더 누르면 기권", 두 번째에 `resign`; 3초 뒤 첫 상태로 복귀.
  - `match_result`: `finished`면 승패·점수·`rating_change`(예: "1000 → 1020") 표시, 재대결 버튼 → 같은 설정으로 `create`(visibility invite) 후 새 대국으로 이동.
  - `match_waiting_invite`: `waiting`이고 내가 만든 대국 → 초대 링크 복사 버튼(`duel_invite_code`), 취소 버튼.
  - `join_page_states`: `join` 성공 → `/duel/:id` 이동; 409 `full` → "이미 시작된 대국이에요" + 대전 탭 링크; 409 `own_match` → 그 대국으로 이동.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/platform/duel`.
- [ ] **Step 3: 구현.** 게임 컴포넌트가 아직 없을 때(Task 6 전)는 `getDuelComponent`가 undefined → "준비 중인 게임이에요".
- [ ] **Step 4: 통과 확인** — `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: 커밋** — `feat: 대전 탭과 대국 화면`

---

### Task 6: 요트 화면과 같은 화면 모드

**Files:**
- Create: `src/games/yacht/Game.tsx`, `src/games/yacht/yacht.css`(클래스 접두사 `yacht-`), `src/games/yacht/Game.test.tsx`
- Create: `src/platform/duel/DuelLocalPage.tsx`, `DuelLocalPage.test.tsx`
- Modify: `src/games/ui.ts`(`yacht` 등록), `src/platform/duel/DuelHomePage.tsx`(같은 화면 시작 버튼: `manifest.duel.sameScreen`인 게임만)

**Interfaces:**
- Consumes: Task 2 `logic`, `YState`, `YAction`, `allowed`, `scoreFor`, `total`, `CATEGORIES`; Task 5 `DuelGameProps`.
- Produces: `Game: ComponentType<DuelGameProps>`; `DuelLocalPage`는 `/duel/local/:game`에서 `getDuel(game).logic`을 `Math.random`으로 직접 돌리고 같은 `getDuelComponent(game)`를 `mySeat = toMove`로 그린다. 서버 호출·기록 없음.
- 화면 내용: 두 사람 점수표(13칸 + 위 칸 소계·보너스 + 추가 Yacht 보너스 + 총점), 현재 주사위 5개(탭해서 고정 토글, 고정은 테두리), "굴리기 (n/3)" 버튼, 내 차례이고 굴린 뒤면 `allowed` 칸만 눌러서 기록(칸에 `scoreFor` 미리보기), 칸 이름 한국어(에이스~식스, 초이스, 3 오브 어 카인드, 4 오브 어 카인드, 풀 하우스, 스몰 스트레이트, 라지 스트레이트, 요트).

- [ ] **Step 1: 테스트 작성**
  - `dice_keep_toggle_and_roll`: 주사위 두 개 탭 → 굴리기 → `onAction({type:'roll', keep:[i,j]})`.
  - `score_preview_and_allowed_only`: 굴린 뒤 `allowed` 칸만 활성, 미리보기 숫자 = `scoreFor`, 클릭 → `{type:'score', category}`.
  - `not_my_turn_disabled`: `toMove !== mySeat`면 버튼 모두 비활성.
  - `totals_shown`: 위 칸 63 이상이면 보너스 35 표시, 총점 = `total`.
  - `local_full_game`: `DuelLocalPage`에서 26턴을 끝까지(테스트용 `Math.random` 고정) → 결과 화면, `duel`·`rpc` 호출 0회.
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — `npx vitest run src/games/yacht src/platform/duel && npm run typecheck && npm run build`. 390px 폭에서 가로 스크롤이 없는지 Playwright로 한 번 확인(스크린샷은 커밋하지 않음).
- [ ] **Step 3: 커밋** — `feat: 요트 다이스 화면과 같은 화면 모드`

---

### Task 7: 리더보드 대전 탭과 프로필 전적

**Files:**
- Modify: `src/platform/leaderboard/LeaderboardPage.tsx`(+test), `src/platform/profile/ProfilePage.tsx`(+test)

**Interfaces:**
- Consumes: Task 3 `lb_duel`, `duel_stats`, `duel_h2h`; Task 1 `duels`.
- Produces: 리더보드 "대전" 탭(대전 게임 선택 → 순위표: 순위·아이디·레이팅·판수·승률, 아래 "배치 중" 목록). 프로필 "대전" 섹션(게임별 레이팅·랭크 승무패·승률, "랭크만/전체" 토글, 최근 대국 20개), 상대 선택(드롭다운: 나와 대국한 적 있는 사람) → 상대 전적(게임별 승·무·패, 최근 20판). 남의 프로필이면 상대 전적 기본값이 "나 vs 이 사람".
- 승률 표기: `w / (w + d + l)`를 백분율 정수, 판수 0이면 "–".

- [ ] **Step 1: 테스트 작성**
  - `leaderboard_duel_tab`: `lb_duel` 결과에서 `placed`만 순위, 나머지는 "배치 중"; 숨김 대전 게임은 비관리자 선택지에 없음.
  - `profile_duel_stats_toggle`: "랭크만" ↔ "전체" 전환 시 숫자 바뀜, 승률 0판 "–".
  - `profile_h2h_default_me_vs_them`: 남의 프로필 → `duel_h2h(me, them, null)` 호출, 결과 표시.
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — `npm test && npm run typecheck`.
- [ ] **Step 3: 커밋** — `feat: 대전 순위와 상대 전적`

---

### Task 8: 문서와 배포 절차

**Files:**
- Modify: `docs/deploy-checklist.md`, `CLAUDE.md`, `README.md`(대전 한 줄)

- [ ] **Step 1: `docs/deploy-checklist.md`에 "대전 배포" 절 추가**
  - `npx supabase@2 db push`(NNNN_duel), `npx supabase@2 functions deploy duel --no-verify-jwt`.
  - 브로드캐스트 키 확인: 미리보기에서 두 계정으로 대국 → 한쪽이 굴리면 다른 쪽 화면이 2초 안에 바뀌는지. 5초 간격으로만 바뀌면 함수 로그에서 broadcast 오류 확인, 키 문제면 오류 전문 보고.
  - 수동 확인: 폰 두 대 랭크 한 판(레이팅 변화), 친선 한 판(레이팅 불변·전적 반영), 한쪽 창 닫고 두 번 시간 초과 → 기권패, 참가 직후 기권 → 무효, 초대 링크·대기실 각각, 같은 화면 한 판.
- [ ] **Step 2: `CLAUDE.md`** — 폴더 규칙에 `supabase/functions/duel/`, "게임 추가 절차"에 대전 게임 줄(`category: 'duel'`, `DuelLogic`, `duels` 등록, `ui.ts`의 `getDuelComponent`, `game_modes` (false,false,false) + `hidden_games` 행), 개발 환경의 `fn:test`가 두 함수를 돈다는 것.
- [ ] **Step 3: 전체 검증** — `npm test && npm run typecheck && npm run build && npm run db:test && npm run fn:test`, `deno check`(play, duel).
- [ ] **Step 4: 커밋** — `docs: 대전 배포 절차와 게임 추가 규칙`

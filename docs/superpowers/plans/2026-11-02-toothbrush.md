# 양치 시뮬레이터 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자유 플레이 전용 1인 게임 `toothbrush`(60초 양치, 지운 플라그 비율로 점수)를 추가하고, 이를 위한 플랫폼 공통 변경(출제 시드·행동 로그 저장, 자유 플레이 최고 점수 정렬)을 넣는다.

**Architecture:** 게임 판정은 `src/games/toothbrush/`의 순수·결정론 로직(정수 연산)이고, 화면은 캔버스 + 60Hz 샘플러가 50ms마다 행동을 보낸다. 플랫폼은 `LocalRunner`가 시드로 출제하고 성공한 행동을 모아 `free_play_logs`에 별도 대기열로 저장한다. 리더보드는 `best_score` 열과 manifest의 `freeDefaultSort`로 게임별 기본 정렬을 정한다.

**Tech Stack:** React 18, TypeScript 5.6, Vite 5, Vitest 2 + Testing Library(jsdom), Supabase(Postgres 16, pgTAP via `npm run db:test`).

**Spec:** `docs/superpowers/specs/2026-11-01-toothbrush-design.md` — 각 작업은 스펙의 해당 절을 함께 읽는다. 수치는 스펙이 정본이다.

## Global Constraints

- 저장소 규칙은 `CLAUDE.md`를 따른다: 화면 문구는 한국어, 모바일 우선, 색은 `theme.css`·`src/app/palettes.ts` 토큰만(양치 캔버스 내부는 예외로 추가).
- 플랫폼 코드(`src/platform/**`)에 게임별 분기 금지. 차이는 manifest·등록부로.
- `src/games/toothbrush/*.ts`(화면 제외)는 순수 함수, 외부 의존 없음, 상대 import에 `.ts` 확장자 명시(Deno 호환).
- 로직 판정·채점: 정수 연산과 `Math.floor`·비교만. `sqrt`·초월함수·부동소수 누적·`Math.random`·`Date`·`ctx` 금지. 해시는 `Math.imul`, `>>> 0`.
- `logic.version = 1`(첫 공개 전이라 조정해도 1 유지, 공개 뒤 바꾸면 올림).
- 마이그레이션은 `npx supabase@2 migration new <이름>`으로 생성. 번호 직접 붙이지 않음.
- 커밋 메시지 `type: 내용`(한국어 가능) + 끝에:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T7oyVst9VqsEcuu1BTABEu
  ```
- 작업 브랜치 `claude/toothbrush-game`. 각 작업 끝에 `npm test`(관련 파일), 마지막 작업에서 `npm test && npm run typecheck && npm run build && npm run db:test` 전체.

## Review Focus

1. **두 번째 손가락(멀티터치)**: 문지르는 중 다른 손가락이 닿아도 칫솔이 그쪽으로 순간이동하면 안 된다. 처음 누른 `pointerId`만 따른다. → Task 6 테스트 `ignores_second_pointer`.
2. **포인터 취소·캔버스 밖으로 나감**: `pointercancel`(브라우저 제스처)이나 누른 채 캔버스를 벗어났다가 손을 뗀 경우 접촉이 끝나야 한다(계속 닦이면 안 됨). `setPointerCapture`로 캔버스 밖 이동은 가장자리 고정, `pointerup`/`pointercancel`이 오면 접촉 끝. → Task 6 테스트 `pointercancel_ends_contact`.
3. **회전·창 크기 변경**: 게임 중 화면 크기가 바뀌어도 좌표 변환은 매 이벤트의 `getBoundingClientRect()`를 쓴다(처음 값 캐시 금지). → Task 6 테스트 `maps_with_current_rect_after_resize`.
4. **화면 이탈(언마운트)**: 게임 중 다른 페이지로 가거나 "새 판"을 누르면 rAF·타이머가 정리되고 그 뒤 `onAction`이 불리지 않는다. → Task 6 테스트 `no_actions_after_unmount`.
5. **끝난 뒤 입력**: `finished`가 되면 샘플링을 멈추고 행동을 보내지 않는다(로직 오류 문구가 결과 화면에 뜨면 안 됨). → Task 6 테스트 `stops_after_finish`.

---

## 파일 구조

```
src/games/toothbrush/
  constants.ts        상수 (스펙 §3.2·§3.7)
  mask.ts             치아 마스크 (§3.2)
  mask.test.ts
  generate.ts         플라그 배치·puzzleKey (§3.4)
  generate.test.ts
  logic.ts            GameLogic: apply·score·publicState (§3.1·§3.3·§3.5·§3.6)
  logic.test.ts
  bots.ts             밸런스 테스트용 봇 (테스트 전용 import)
  balance.test.ts     (§7 밸런스)
  sampler.ts          60Hz 샘플러·보간·분할 (§4, 순수, DOM 없음)
  sampler.test.ts
  manifest.ts
  Game.tsx            캔버스 화면 (§4)
  Game.test.tsx
  toothbrush.css
src/games/types.ts            Manifest.freeDefaultSort 추가
src/games/index.ts, ui.ts     등록
src/platform/games/seed.ts    출제 시드 (§5.2)
src/platform/games/PlayRunner.tsx   LocalRunner ref 상태·시드·로그 (§5.2·§5.3)
src/platform/games/freeQueue.ts     pendingIds() 추가
src/platform/games/freeLogQueue.ts  로그 대기열 (§5.3)
src/platform/leaderboard/LeaderboardPage.tsx  best 정렬 (§5.1)
supabase/migrations/<ts>_toothbrush.sql
supabase/migrations/<ts>_free_play_logs.sql
supabase/migrations/<ts>_free_best_score.sql
supabase/tests/08_free_play_logs.test.sql
supabase/tests/09_free_best_score.test.sql
```

---

### Task 1: 상수와 치아 마스크

**Files:**
- Create: `src/games/toothbrush/constants.ts`, `src/games/toothbrush/mask.ts`
- Test: `src/games/toothbrush/mask.test.ts`

**Interfaces:**
- Produces (`constants.ts`): `W = 48`, `H = 32`, `CELL = 10`, `LW = 480`, `LH = 320`, `ZONE_COUNT = 6`, `TOTAL_TICKS = 3600`, `SWITCH_TICKS = 30`, `R = 3`, `MAX_THICK = 255`, `BASE = 20`, `BLOB_ADD = 60`, `BLOBS = 6`, `BLOB_R_MIN = 3`, `BLOB_R_SPAN = 4`, `ZONE_TOTAL: readonly number[] = [60000, 60000, 45000, 60000, 60000, 45000]`, `SLOW_D2 = 4`, `FAST_D2 = 144`, `DEC_SLOW = 1`, `DEC_OPT = 4`, `DEC_FAST = 1`, `ZONE_LABELS: readonly string[] = ['위 바깥', '위 안쪽', '위 씹는 면', '아래 바깥', '아래 안쪽', '아래 씹는 면']`.
- Produces (`mask.ts`): `TOOTH_WIDTHS = [4,4,3,3,3,3,3,3,3,3,3,3,4,4]`; `toothCells(zone: number): readonly number[]`(행 우선 오름차순 칸 번호, 모듈 로드 시 한 번 계산해 고정); `isTooth(zone: number, i: number): boolean`; `gumRows(zone: number): readonly [number, number] | null`(0·1 → `[0, 5]`, 3·4 → `[28, 31]`, 2·5 → `null`); `toothRows(zone): readonly [number, number]`(바깥·안쪽 `[6, 27]`, 씹는 면 `[8, 23]`); `toothOf(zone, i): number`(칸이 속한 치아 번호 0~13, 아니면 -1, 화면이 치아 경계를 그릴 때 씀).

- [ ] **Step 1: 실패하는 테스트** `mask.test.ts`
  - `tooth_cell_counts`: 구역 0,1,3,4 → `toothCells(z).length === 956`, 2,5 → `680`.
  - `columns_0_and_47_empty`: 모든 구역에서 `i % 48 === 0 || i % 48 === 47`인 칸은 치아 아님.
  - `corners_removed`: 구역 0의 첫 치아(열 1~4, 행 6~27): `(1,6)`, `(4,6)`, `(1,27)`, `(4,27)`은 치아 아님, `(2,6)`·`(1,7)`은 치아.
  - `rows_outside_tooth_band_empty`: 구역 2의 행 7·24 칸은 모두 치아 아님.
  - `zone_total_within_capacity`: 모든 z에서 `0 ≤ ZONE_TOTAL[z] ≤ toothCells(z).length × MAX_THICK`.
  - `cells_sorted_unique`: 각 구역 목록이 엄격히 오름차순.
- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run src/games/toothbrush/mask.test.ts` → 모듈 없음으로 FAIL.
- [ ] **Step 3: 구현** — 스펙 §3.2 규칙 그대로(치아 i의 열 범위는 1부터 너비 누적, 직사각형에서 네 모서리 칸 제외).
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS.
- [ ] **Step 5: 커밋** — `feat: 양치 상수·치아 마스크`

### Task 2: 플라그 배치 생성과 puzzleKey

**Files:**
- Create: `src/games/toothbrush/generate.ts`
- Test: `src/games/toothbrush/generate.test.ts`

**Interfaces:**
- Consumes: Task 1 전부.
- Produces: `type Puzzle = { zones: number[][] }`(6 × 1536); `generatePuzzle(rng: () => number): Puzzle`; `puzzleKey(p: Puzzle): string`(소문자 16진 8자).

- [ ] **Step 1: 실패하는 테스트** (`rngFromSeed`는 `src/shared/rng.ts`, 시드는 `new Uint8Array(16).fill(k)` 꼴)
  - `exact_zone_totals_1000_seeds`: 시드 1,000개(시드 k의 첫 4바이트에 k를 빅엔디안으로 넣고 나머지 0이 아닌 고정값)마다 모든 z에서 `sum(zones[z]) === ZONE_TOTAL[z]`, 치아 아닌 칸 = 0, 모든 칸 `0 ≤ v ≤ 255`, 정수.
  - `deterministic`: 같은 시드 두 번 → `toEqual`.
  - `different_seeds_differ`: 시드 두 개 → `puzzleKey` 다름.
  - `base_layer_present`: 생성 뒤 모든 치아 칸 > 0인 시드가 대부분(1,000개 중 ≥ 990)이다. 총량 맞추기에서 빼는 경우가 있어 전부는 아닐 수 있으니 비율로 확인.
  - `puzzle_key_snapshot`: 시드 `fill(7)`의 `puzzleKey`를 `toMatchInlineSnapshot()`으로 고정(첫 실행에서 기록).
  - `rng_call_order`: 호출 횟수를 세는 rng로 감싸 `generatePuzzle` 한 번에 정확히 `6 × BLOBS × 2 = 72`번 부르는지.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/toothbrush/generate.test.ts`.
- [ ] **Step 3: 구현** — 스펙 §3.4의 1→2→3 순서. 덩어리마다 중심 `cells[⌊rng() × cells.length⌋]`, 반지름 `BLOB_R_MIN + ⌊rng() × BLOB_R_SPAN⌋`. 총량 맞추기는 아래 알고리즘(칸별 1씩 순환과 결과가 같은 일괄 버전):

  ```ts
  // diff = ZONE_TOTAL[z] - sum, cells = toothCells(z)
  while (diff > 0) {            // 더하기: 한 바퀴에 MAX_THICK 미만인 칸마다 1
    for (const i of cells) { if (diff === 0) break; if (a[i] < MAX_THICK) { a[i]++; diff-- } }
  }
  while (diff < 0) {            // 빼기: 한 바퀴에 0 초과인 칸마다 1
    for (const i of cells) { if (diff === 0) break; if (a[i] > 0) { a[i]--; diff++ } }
  }
  ```
  `puzzleKey`: FNV-1a 32비트(`h = 0x811c9dc5`, 값마다 `h ^= v & 0xff; h = Math.imul(h, 0x01000193)`, 끝에 `>>> 0`, `padStart(8,'0')`). 값이 255 이하이므로 칸당 1바이트.
- [ ] **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat: 양치 플라그 층화 생성`

### Task 3: 게임 로직 (apply·score·publicState)

**Files:**
- Create: `src/games/toothbrush/logic.ts`
- Test: `src/games/toothbrush/logic.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 2(`Puzzle`, `generatePuzzle`, `puzzleKey`), `GameLogic`·`Ctx`·`PlatformAction`(`src/games/types.ts`).
- Produces:
  ```ts
  export type BrushAction = { type: 'b'; s: number[] }
  export type ZoneAction = { type: 'z'; zone: number }
  export type Action = BrushAction | ZoneAction
  export type State = { zones: number[][]; zone: number; ticks: number; cooldown: number;
    prev: [number, number] | null; gumTicks: number; switches: number; removed: number }
  export type PublicState = { zones: number[][]; zone: number; ticksLeft: number; cooldown: number;
    gumTicks: number; started: boolean; cleanByZone: number[] }
  export const MAX_SAMPLES = 30
  export const logic: GameLogic<Puzzle, Action, State, PublicState>  // version: 1
  ```
  `pickPuzzle(rng, _options) = generatePuzzle(rng)`, `initState`는 퍼즐 배열을 복사, `reveal = () => null`, `actionCount = s.switches`, `isFinished = s.ticks >= TOTAL_TICKS`. 오류 문구(한국어): 샘플 형식 `'잘못된 입력이에요'`, 전환 `'옮길 수 없는 구역이에요'`, 끝난 뒤 `'이미 끝났어요'`, 시작 전 전환 `'먼저 닦기 시작하세요'`.

- [ ] **Step 1: 실패하는 테스트** — 테스트 도우미: 고정 퍼즐(모든 치아 칸 두께를 직접 정한 `Puzzle`)과 `const run = (s, a) => { const r = logic.apply(p, s, a, ctx); if ('error' in r) throw new Error(r.error); return r.state }`. 좌표는 칸 중심 `x = cx*10+5`.
  - `opt_band_removes_4_per_cell`: 구역 0 치아 한가운데에서 `(x,y)` → `(x+3,y)`(d²=9) 두 샘플. 두 번째 틱에 칫솔 29칸이 각 4씩(두께 충분하면) 줄고 `removed` 증가량 = 첫 틱(느림, 각 1) + 둘째 틱(각 4)의 실제 감소 합.
  - `fast_band_counts_gum`: d² = 144 → 칸당 1, `gumTicks` +1; d² = 143 → 최적, 잇몸 0.
  - `slow_band_boundary`: d² = 3 → 1, d² = 4 → 4.
  - `no_contact_resets_prev`: `(x,y), (-1,-1), (x+20,y)` → 셋째 틱 `d² = 0` 취급(느림, 잇몸 없음).
  - `cooldown_updates_prev_without_cleaning`: 전환 직후 30틱 동안 두께 불변, `gumTicks` 불변(빠르게 움직여도), `cooldown` 30→0. 31번째 틱부터 닦임. 대기 마지막 틱에서 갱신된 `prev` 기준으로 31번째 틱의 d²가 계산됨.
  - `clips_at_grid_edge`: 칸 (0,0) 중심 문지르기에서 예외 없음, 격자 밖 칸 무시.
  - `never_negative`: 두께 2인 칸에 최적 틱 → 0, `removed` +2.
  - `finishes_at_3600_and_ignores_extra`: 30샘플 행동 120개 → `ticks === 3600`, `isFinished`. 그 상태에 다시 행동 → `'이미 끝났어요'`. 남은 틱 10일 때 30샘플 행동 → `ticks === 3600`(앞 10개만 적용, 나머지 감소 없음).
  - `full_clean_does_not_end_early`: 모든 칸 0인 퍼즐에서 1틱 → `isFinished === false`.
  - `give_up_ends`: `{type:'give_up'}` → `ticks === 3600`.
  - `zone_switch_rules`: 시작 전(`ticks === 0`) 전환 → `'먼저 닦기 시작하세요'`; 같은 구역·`-1`·`6`·`1.5` → `'옮길 수 없는 구역이에요'`; 정상 전환 → `zone`, `switches + 1`, `cooldown 30`, `prev null`, `ticks` 불변.
  - `invalid_brush_actions`: `s: []`, 31샘플(62값), 길이 3, `x = 480`, `y = -2`, `(−1, 5)`, `2.5`, 문자열 값 → 모두 `'잘못된 입력이에요'`이고 입력 상태가 그대로(`toEqual` 원본 복사본).
  - `apply_does_not_mutate_input`: `structuredClone`한 원본과 비교.
  - `score_formula`: `removed`·`gumTicks`를 직접 넣은 상태로 `score`. `TOTAL`은 상수에서 계산해 쓴다(Task 4에서 바뀔 수 있음). `removed = TOTAL, gum = 0` → 10. `removed = TOTAL / 2` → 5. 반올림 경계: 4.95가 5.0이 되는 최소 `removed = ⌈(49.5 × TOTAL − ⌊TOTAL/2⌋) / 100⌉`를 식으로 구해 그 값 → 5.0, 1 작으면 → 4.9(TOTAL 330000이면 163350 → 5.0, 163349 → 4.9). `gum = 59` 감점 0, `gum = 60` 감점 0.1. `removed = 0, gum = 600` → 0(음수 자르기).
  - `clean_by_zone_floors`: 한 구역 남은 양 1 → 99(100 아님).
  - `public_state_shape`: `started`, `ticksLeft = 3600 − ticks`.
  - `deterministic_replay`: 같은 퍼즐, 무작위 시드로 만든 행동 300개를 두 번 적용 → 같은 상태.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/toothbrush/logic.test.ts`.
- [ ] **Step 3: 구현** — 틱 처리는 스펙 §3.5의 1~5 순서 그대로. 한 행동에서 구역 배열은 한 번만 복사(`zones` 바깥 배열 얕은 복사 + 현재 구역 배열 `slice()`). 칫솔 오프셋 29개는 모듈 상수로 미리 계산.
- [ ] **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat: 양치 게임 로직`

### Task 4: 밸런스 봇과 상수 조정

**Files:**
- Create: `src/games/toothbrush/bots.ts`, `src/games/toothbrush/balance.test.ts`
- Modify (필요할 때만): `src/games/toothbrush/constants.ts`

**Interfaces:**
- Consumes: `logic`, `generatePuzzle`, `rngFromSeed`, 상수.
- Produces: `playBot(kind: 'aim' | 'sweep' | 'scribble' | 'still', seed: Uint8Array): number`(최종 점수). 봇은 30샘플 행동과 전환 행동을 만들어 `logic.apply`로 끝까지 진행한다(봇 난수는 `rngFromSeed(seed)`와 별도의 고정 시드 rng).

- [ ] **Step 1: 테스트 작성** `balance.test.ts` — 시드 20개(시드 k = `fill(k + 1)`):
  - `aim_bot_strong_but_not_perfect`: 평균 `8.0 ≤ avg ≤ 9.5`, 20판 모두 `< 10`.
  - `sweep_below_aim`: `avg(sweep) ≤ avg(aim) − 0.5`.
  - `scribble_low`: 평균 ≤ 3.0.
  - `still_low`: 평균 ≤ 1.0.
  - 테스트 타임아웃 60초(`test(..., 60_000)`).
- [ ] **Step 2: 봇 구현** (`bots.ts`, 스펙 §7 정의 그대로)
  - 공통: 칫솔 이동 속도는 틱당 6단위(d² = 36, 최적 구간). 목표점을 향해 한 틱에 최대 6단위씩 정수로 이동(x·y축 각각 `±min(3, |차이|)`로 근사해 d² ≤ 18, 0이면 목표 근처 짧은 왕복 ±3).
  - 조준(`aim`): 구역마다 남은 시간 ÷ 남은 구역 수 만큼 머문다. 30틱마다 "칫솔 원 29칸의 남은 두께 합이 가장 큰 치아 칸"을 목표로 다시 고른다. 배분 시간이 끝나면 다음 구역. 6구역을 돈 뒤 시간이 남으면 `cleanByZone`이 가장 낮은 구역으로 돌아간다.
  - 왕복(`sweep`): 구역마다 600틱. 치아 행 범위를 칫솔 지름(7칸) 간격 줄로 나눠 좌우 지그재그.
  - 낙서(`scribble`): 구역 0에서만, 매 틱 x를 ±25(d² ≥ 625, 빠름) 왕복, y는 30틱마다 무작위.
  - 가만히(`still`): 구역 0 한가운데를 계속 누름.
- [ ] **Step 3: 실행** — `npx vitest run src/games/toothbrush/balance.test.ts`. 각 봇 평균을 `console.log`로 출력해 기록.
- [ ] **Step 4: 조정** — 실패하면 스펙 §3.7 규칙대로 `ZONE_TOTAL`(조준 봇이 만점에 가까우면 올리고, 너무 낮으면 내림. 용량비 `400200 / TOTAL`이 1.1~1.4 범위)만 먼저 바꾼다. 그래도 안 되면 `DEC_OPT`(3~5)를 조정한다. 바뀐 값은 스펙 §3.7과 Task 3 `score_formula`의 `TOTAL` 기대값에도 반영한다. `generate.test.ts` 스냅샷도 갱신한다. 봇 기대 범위 자체는 바꾸지 않는다. 조정해도 안 맞으면 멈추고 보고한다.
- [ ] **Step 5: 통과 확인 후 커밋** — `test: 양치 밸런스 봇` (상수가 바뀌었으면 `feat: 양치 밸런스 조정` 별도 커밋, 스펙 수정 포함).

### Task 5: 샘플러 (60Hz 누산·보간·분할)

**Files:**
- Create: `src/games/toothbrush/sampler.ts`
- Test: `src/games/toothbrush/sampler.test.ts`

**Interfaces:**
- Consumes: `LW`, `LH`, `MAX_SAMPLES`(Task 3에서 export).
- Produces:
  ```ts
  export const TICK_MS = 1000 / 60
  export const GAP_MS = 250
  export class Sampler {
    started: boolean            // 처음 down 뒤 true
    down(x: number, y: number): void   // 논리 정수 좌표
    move(x: number, y: number): void
    up(): void
    frame(now: number): void    // rAF 시각(ms). started 전에는 기준 시각만 갱신
    take(): number[]            // 지난 take 이후 샘플(평탄 배열), 비움
  }
  export function chunk(flat: number[], max = MAX_SAMPLES): number[][]
  ```

- [ ] **Step 1: 실패하는 테스트**
  - `no_samples_before_first_down`: `frame(0..1000)` → `take()` 빈 배열, `started === false`.
  - `sixty_per_second`: `down` 후 `frame`을 16.6ms 간격으로 1초 → 샘플 수 60(±0, 누산기는 남은 시간을 이월).
  - `frame_rate_independent`: 같은 손동작(0→300 x를 1초에 선형 이동)을 30Hz와 120Hz `frame`으로 재생 → 두 `take()` 결과가 같다(같은 개수, 각 샘플 좌표 차 ≤ 1).
  - `interpolates_integer`: 직전 내보낸 위치 (0,0), 현재 (10,0), 이번 프레임 샘플 2개 → `[5,0, 10,0]`.
  - `up_emits_no_contact`: `up()` 뒤 프레임 샘플 → `-1,-1`.
  - `gap_drops_and_breaks`: 접촉 중 `frame(t)` 다음 `frame(t + 400)` → 그 프레임에서 샘플은 `(-1,-1)` 하나뿐, 다음 프레임부터 정상.
  - `chunk_splits`: 70샘플(140값) → 30·30·10샘플.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — 보간 `x_i = x0 + Math.floor((x1 - x0) * i / n)`, i = 1..n. 기준 위치는 마지막으로 내보낸 샘플 위치(접촉 끊김 뒤 첫 샘플은 보간 없이 현재 위치).
- [ ] **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat: 양치 입력 샘플러`

### Task 6: 매니페스트·화면·등록

**Files:**
- Modify: `src/games/types.ts`(`Manifest`에 `freeDefaultSort?: 'wins' | 'rate' | 'plays' | 'best'` 추가, 주석 한 줄)
- Create: `src/games/toothbrush/manifest.ts`(스펙 §2 그대로), `src/games/toothbrush/Game.tsx`, `src/games/toothbrush/toothbrush.css`
- Modify: `src/games/index.ts`(`games`에 추가), `src/games/ui.ts`(`components`에 `toothbrush: ToothbrushGame`)
- Create: `supabase/migrations/<ts>_toothbrush.sql`(`npx supabase@2 migration new toothbrush`): 스펙 §6의 두 insert 문장 그대로, 머리 주석은 `20261101020000_yacht.sql` 형식.
- Modify: `CLAUDE.md` 금지 사항 색 예외 → `(후알야 카드 내부·킷 색, 양치 캔버스 내부 색 예외)`.
- Test: `src/games/toothbrush/Game.test.tsx`; 기존 `src/games/registry.test.ts`가 통과해야 함.

**Interfaces:**
- Consumes: `GameProps`(`src/games/ui.ts`), `PublicState`·`MAX_SAMPLES`(Task 3), `Sampler`·`chunk`(Task 5), 마스크·상수(Task 1).
- Produces: `export function Game(props: GameProps): JSX.Element`. 버튼 접근성 이름은 구역 버튼 `'<ZONE_LABELS[z]> <cleanByZone[z]>%'`, 캔버스 `aria-label="양치 화면"`, 남은 시간 텍스트 `'남은 시간 N초'`(올림), 잇몸 `'잇몸 손상 N초'`, 결과 제목 `'양치 끝'`, 시작 전 안내 `'화면을 눌러 양치를 시작하세요'`.

- [ ] **Step 1: 실패하는 테스트** `Game.test.tsx` — `requestAnimationFrame`·`performance.now`는 `vi.useFakeTimers({ toFake: ['requestAnimationFrame','cancelAnimationFrame','performance','setInterval','clearInterval'] })`. jsdom에는 `PointerEvent`가 없어 `fireEvent.pointerDown`의 `clientX`·`pointerId`가 빠질 수 있으니, 테스트 설정에서 `MouseEvent`를 상속한 최소 `PointerEvent` 폴리필을 이 테스트 파일 안에 둔다. 캔버스 `getContext`는 jsdom에서 null이므로 Game은 null을 견뎌야 하고, 테스트는 `getBoundingClientRect`를 `{left:0, top:0, width:480, height:320}`으로 모킹. 공개 상태는 고정 퍼즐로 `logic.publicState(logic.initState(…))`.
  - `renders_and_zone_buttons_disabled_before_start`: 6개 버튼 비활성, 안내 문구 보임.
  - `pointer_down_starts_and_sends_chunks`: `pointerdown(100,100)` → 타이머 100ms 진행 → `onAction`이 `{type:'b'}`로 불리고, 각 `s.length ≤ 60`이며 짝수, 합계 샘플 ≈ 6(±1).
  - `zone_button_sends_switch`: `started: true` 공개 상태로 다시 렌더 → 구역 2 버튼 클릭 → `{type:'z', zone:2}`.
  - Review Focus 1~5: `ignores_second_pointer`(pointerId 1로 down, pointerId 2로 (400,300) move → 보낸 샘플에 400 없음), `pointercancel_ends_contact`(cancel 뒤 샘플 `-1,-1`), `maps_with_current_rect_after_resize`(rect를 `{width:240,height:160}`으로 바꾼 뒤 (120,80) move → 샘플 (240,160)), `no_actions_after_unmount`(unmount 뒤 타이머 진행 → 추가 호출 없음), `stops_after_finish`(`finished: true`로 다시 렌더 → 이후 호출 없음, 결과 제목·점수 보임).
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/toothbrush/Game.test.tsx`.
- [ ] **Step 3: 구현** — 스펙 §4. rAF 루프에서 `sampler.frame(performance.now())`, `setInterval(50ms)`에서 `chunk(sampler.take())`마다 `onAction`. 포인터는 `setPointerCapture`, 좌표 `Math.min(LW-1, Math.max(0, Math.floor((clientX - rect.left) * LW / rect.width)))`. 그리기는 `useEffect`에서 `publicState.zones[zone]`로 캔버스 전체를 다시 그림(1536칸, 충분히 빠름). 캔버스 내부 색은 CSS 변수가 아닌 상수(치아 `#f4f1ea`, 플라그 `rgba(214,190,60,α)`, 잇몸 `#d77a7a`), 바깥 UI는 토큰.
- [ ] **Step 4: 통과 확인** — `Game.test.tsx`와 `src/games/registry.test.ts` PASS.
- [ ] **Step 5: 커밋** — `feat: 양치 시뮬레이터 화면·등록 (숨김)`

### Task 7: LocalRunner 시드·순차 상태·행동 기록

**Files:**
- Create: `src/platform/games/seed.ts`
- Modify: `src/platform/games/PlayRunner.tsx`(`LocalRunner`만)
- Test: `src/platform/games/PlayRunner.test.tsx`(기존 `local_mode_submits_free_play_on_finish` 수정 + 새 테스트)

**Interfaces:**
- Produces: `newSeed(): Uint8Array`(16바이트), `seedHex(seed: Uint8Array): string`(소문자 32자). `LocalRunner` 내부에 `stateRef`, `actionsRef: unknown[]`, `seedRef: Uint8Array` — Task 9가 제출 지점에서 `{ seed: seedHex(seedRef.current), actions: actionsRef.current }`를 쓴다.

- [ ] **Step 1: 테스트 수정·추가**
  - 파일 위쪽 `vi.mock('./seed.ts', () => ({ newSeed: () => new Uint8Array(16).fill(3), seedHex: … 실제 구현 위임 }))`(실제 `seedHex`는 `vi.importActual`).
  - `local_mode_submits_free_play_on_finish`: `Math.random` 스파이 제거. 정답은 테스트 안에서 `testGuess.logic.pickPuzzle(rngFromSeed(new Uint8Array(16).fill(3)), { range: '100' })`로 계산해 그 값을 추측.
  - `local_mode_applies_sync_actions_in_order`: test-guess 화면을 거치지 않고, `withTestGameUi`로 등록한 테스트 화면이 `onAction`을 동기로 두 번 부르는 버튼(테스트 파일 안에 작은 컴포넌트를 `vi.mock('../../games/ui.ts')`로 끼움)을 누르면 두 추측이 모두 반영됨(남은 기회 8 → 6).
  - `seed_hex_format`(seed.ts 단위 테스트, `seed.test.ts`): 길이 32, `/^[0-9a-f]+$/`.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/platform/games`.
- [ ] **Step 3: 구현** — `pickPuzzle(rngFromSeed(seed), options)`; `onAction`은 `stateRef.current`에 적용, 성공하면 `actionsRef.current.push(action)`, `stateRef.current = r.state`, `setState(r.state)`. `finished`·`score`는 렌더 때 `stateRef.current` 기준.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/platform` PASS(기존 테스트 전부).
- [ ] **Step 5: 커밋** — `feat: 자유 플레이 시드 출제·행동 순차 적용`

### Task 8: `free_play_logs` 테이블과 RLS

**Files:**
- Create: `supabase/migrations/<ts>_free_play_logs.sql`(`npx supabase@2 migration new free_play_logs`)
- Test: `supabase/tests/08_free_play_logs.test.sql`

**Interfaces:**
- Produces: 테이블 `public.free_play_logs(client_id, user_id, seed, actions, created_at)`, 함수 `public._owns_free_play(uuid) returns boolean`(security definer, `set search_path = public`). 스펙 §5.3의 제약·정책·권한 그대로.

- [ ] **Step 1: 실패하는 DB 테스트** — `04_leaderboards.test.sql`의 픽스처 방식(사용자 insert, `set local role authenticated; set local request.jwt.claims = :'U1'`)을 따른다. 승인 사용자 U1·U2, 미승인 PU, 관리자 ADM. 숨김 게임 `test-guess` 행 추가. 단언:
  - U1이 자기 `free_plays` 행의 로그 insert 성공.
  - U1이 U2 행의 `client_id`로 insert → 실패(`throws_ok`, 42501).
  - U1이 없는 `client_id` → 실패(42501, 도우미가 false).
  - 미승인 PU 자기 행 → 실패.
  - 숨김 게임(`test-guess`) 본인 행에 대한 로그 insert 성공(`free_plays` select RLS에 막히지 않음).
  - `seed`가 31자·대문자 → 23514; `actions`가 객체 → 23514; 300KB 배열 → 23514.
  - U2는 U1 로그 select 0행, ADM은 1행 이상, U1 본인 1행.
  - U1 update·delete → 0행 영향 또는 권한 오류(`throws_ok` 42501).
  - `anon`은 select 권한 없음.
  - `free_plays` 행 삭제 시 로그도 삭제(cascade).
- [ ] **Step 2: 실패 확인** — `npm run db:test` → 새 파일 FAIL.
- [ ] **Step 3: 마이그레이션 작성** — 스펙 §5.3. 끝에 `revoke`/`grant` 블록은 0002 형식.
- [ ] **Step 4: 통과 확인** — `npm run db:test` 전체 PASS.
- [ ] **Step 5: 커밋** — `feat: 자유 플레이 행동 로그 테이블`

### Task 9: 로그 대기열과 LocalRunner 연결

**Files:**
- Modify: `src/platform/games/freeQueue.ts`(`export function pendingIds(): Set<string>` — 현재 대기 중인 `client_id`들; `useFreeQueueFlush`가 점수 대기열 flush 뒤 `flushLogs()` 호출, 온라인 복귀 때도 같은 순서)
- Create: `src/platform/games/freeLogQueue.ts`
- Modify: `src/platform/games/PlayRunner.tsx`(제출 지점)
- Test: `src/platform/games/freeLogQueue.test.ts`, `PlayRunner.test.tsx`

**Interfaces:**
- Consumes: Task 7의 `seedRef`·`actionsRef`, `seedHex`; Task 8 테이블.
- Produces:
  ```ts
  export type FreeLogRow = { client_id: string; user_id: string; seed: string; actions: unknown[]; attempts: number }
  export const MAX_LOG_QUEUE = 10
  export const LOG_KEY = 'onlyfms:freeLogQueue'
  export function submitLog(row: Omit<FreeLogRow, 'attempts'>, after: Promise<void>): Promise<void>
  export function flushLogs(): Promise<void>
  export function resetFreeLogQueue(): void
  ```
  `freeQueue.submit`이 Promise를 돌려주는 것은 기존 그대로 이용한다.

- [ ] **Step 1: 실패하는 테스트** `freeLogQueue.test.ts`(supabase 모킹은 `freeQueue.test.ts` 방식, upsert 대상 테이블 이름 확인)
  - `sends_after_score_row`: `after`가 끝나기 전에는 upsert 안 함, 끝난 뒤 `free_play_logs`로 upsert(`{ onConflict: 'client_id', ignoreDuplicates: true }`), 행에 `attempts` 없음.
  - `skips_while_score_pending`: `pendingIds`가 그 id를 포함하면 건너뛰고 대기열에 남음.
  - `fk_error_three_strikes`: `{ code: '23503' }` 세 번 → 세 번째 뒤 제거, 두 번째까지는 남고 `attempts` 증가.
  - `drops_on_rls_or_check`: `42501`, `23514` → 즉시 제거.
  - `keeps_on_network_error`: upsert가 throw → 남음.
  - `max_10`: 12건 → 오래된 2건 버림.
  - `storage_failure_isolated`: `localStorage.setItem`이 던지게 만든 뒤 `submitLog` → 예외 없음, `freeQueue`의 저장 동작 영향 없음(별도 키).
  - `PlayRunner.test.tsx` `local_mode_submits_log_with_seed_and_actions`: 끝났을 때 `submitLog`(모킹)가 `{ client_id: 점수 행과 같은 id, seed: '03'.repeat(16), actions: [추측 행동] }`과 Promise로 불림.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — 저장·메모리 이중화는 `freeQueue.ts`의 `load/save/read/write` 패턴을 따르되 별도 키. `LocalRunner` 제출부: `const p = freeQueue.submit({...}); void freeLogQueue.submitLog({ client_id, user_id, seed: seedHex(seedRef.current), actions: actionsRef.current }, p)`.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/platform` PASS.
- [ ] **Step 5: 커밋** — `feat: 자유 플레이 행동 로그 대기열`

### Task 10: 자유 플레이 최고 점수 (DB + 리더보드 화면)

**Files:**
- Create: `supabase/migrations/<ts>_free_best_score.sql`(`npx supabase@2 migration new free_best_score`)
- Test: `supabase/tests/09_free_best_score.test.sql`
- Modify: `src/platform/leaderboard/LeaderboardPage.tsx`
- Test: `src/platform/leaderboard/LeaderboardPage.test.tsx`

**Interfaces:**
- Consumes: `Manifest.freeDefaultSort`(Task 6).
- Produces: `lb_free(text)` 반환 끝 열 `best_score numeric`.

- [ ] **Step 1: 실패하는 DB 테스트** — `test-guess` free_plays 몇 행(U1: 3.0, 7.5, 5.0 / U2: 9.0)으로:
  - `lb_free('test-guess')`에서 U1 `best_score = 7.5`, U2 `9.0`; 기존 열(`plays`, `wins`, `avg_score`) 값과 서버 정렬 유지.
  - `lb_free(null)`도 `best_score` 열이 있음.
  - `user_stats` 결과의 `free_by_game` 키 집합이 `{game_id, plays, wins, win_rate, best_streak}` 그대로.
  - `anon`은 `lb_free` 실행 불가, `authenticated`는 `_free_stats` 직접 실행 불가.
- [ ] **Step 2: 실패 확인** — `npm run db:test`.
- [ ] **Step 3: 마이그레이션** — 스펙 §5.1: 두 함수 drop 후 0004 정의를 그대로 복사해 `best_score`(`round(max(f.score), 1)`)만 끝에 추가, revoke/grant 재적용.
- [ ] **Step 4: DB 통과 확인.**
- [ ] **Step 5: 화면 테스트** `LeaderboardPage.test.tsx` — `free()` 픽스처에 `best_score` 인자 추가(기본값 0으로 기존 호출 유지). 운영 등록부에 `toothbrush`가 있으므로 그 id를 쓴다(관리자 프로필로 렌더해 숨김 게임이 보이게).
  - 기존 `free_tab_sort_toggle`, `streak_hidden_in_total_view` 그대로 PASS.
  - `toothbrush_defaults_to_best_sort`: 게임 선택 `toothbrush` → 정렬 값 `'best'`, 순서가 `best_score` 내림차순, '최고' 열 머리글 보임.
  - `who_are_ya_keeps_wins_sort`: 게임 선택 `who-are-ya` → `'wins'`, '최고' 열은 보이지만 기준 열 아님.
  - `best_hidden_in_total_view`: '전체 합계'에서 '최고' 열과 `best` 선택지 없음. `toothbrush`에서 전체 합계로 돌아가면 정렬이 `'wins'`.
- [ ] **Step 6: 구현** — 스펙 §5.1 목록 그대로. 정렬 초기화는 `setGame`과 함께 `setSort(defaultSortFor(id))`(`getGame(id)?.manifest.freeDefaultSort ?? 'wins'`, 빈 id면 `'wins'`).
- [ ] **Step 7: 통과 확인** — `npx vitest run src/platform/leaderboard` PASS.
- [ ] **Step 8: 커밋** — `feat: 자유 플레이 최고 점수 정렬`

### Task 11: 문서·전체 검증·PR

**Files:**
- Modify: `docs/deploy-checklist.md`(DB push에 마이그레이션 3개 적용, `play` 재배포 불필요 한 줄), `CLAUDE.md`(폴더 규칙에 `freeLogQueue.ts`·`free_play_logs` 한 줄, 게임 추가 절차에 "`freeDefaultSort`로 자유 플레이 기본 정렬 지정 가능" 한 줄)

- [ ] **Step 1: 문서 수정.**
- [ ] **Step 2: 전체 검증** — `npm test && npm run typecheck && npm run build && npm run db:test` → 모두 통과(실패 0).
- [ ] **Step 3: 커밋·푸시** — `docs: 양치 시뮬레이터 배포 메모`, `git fetch origin main && git rebase origin/main`(충돌 시 멈추고 보고), `git push`.
- [ ] **Step 4: PR 생성** — 대상 `main`, 제목 `feat: 양치 시뮬레이터 (숨김) + 자유 플레이 로그·최고 점수`. 본문: 요약, 플랫폼 공통 변경 목록(공동 개발자 확인 요청), 밸런스 봇 결과 수치, 배포 순서(DB push → Vercel), 끝에 세션 링크 줄.

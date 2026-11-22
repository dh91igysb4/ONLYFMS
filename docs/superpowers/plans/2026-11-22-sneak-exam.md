# 몰래 수능(sneak-exam) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수능 시험장에서 감독관 몰래 커닝 도구로 답을 알아내는 고정 1인칭 3D 잠입 게임 '몰래 수능'을 자유 플레이 점수 게임으로 추가한다.

**Architecture:** 정수 전용 순수 시뮬(`sim.ts` + `proctor.ts`)을 `logic.ts`가 감싸 플랫폼 `GameLogic` 계약을 따른다. 판의 모든 무작위(문제·정답·감독관 성향·순찰)는 시드에서 나온다. 화면(`Game.tsx`)은 같은 시뮬을 로컬로 돌려 그리고, 명령이 있을 때 즉시·없으면 30틱마다 플랫폼에 보낸다. Three.js 장면은 `render/`에만 있고 동적 import로 별도 청크가 된다. 볼 런(`src/games/ball-run/`)이 같은 구조의 본보기다.

**Tech Stack:** React 18 + Vite + TypeScript, vitest + Testing Library(jsdom), Three.js 0.187(이미 의존성), Supabase 마이그레이션.

**Spec:** `docs/superpowers/specs/2026-11-22-sneak-exam-design.md` — 각 태스크 전에 해당 절을 읽는다. 수치가 이 계획과 다르면 이 계획이 우선한다(계획이 더 구체적이다).

## Global Constraints

- 저장소 규칙은 `CLAUDE.md`가 우선한다. 화면 문구는 모두 한국어, 모바일 우선.
- `src/games/sneak-exam/`에서 `render/`, `Game.tsx`, `*.css`를 뺀 파일은 외부 의존 없음, 상대 import에 `.ts` 확장자 명시(Deno 호환). `three`는 `render/scene.ts`에서만 import.
- 시뮬 상태 값은 모두 정수. 시뮬·감독관 코드에서 `Math.sin/cos/sqrt/pow/random`, `Date` 금지. 나눗셈은 `Math.floor(a / b)`. 난수는 `rng.ts`만.
- 플랫폼 코드(`src/platform/`)는 바꾸지 않는다. 게임별 분기 금지.
- 레퍼런스 게임의 이름·문구·문제를 쓰지 않는다. 실제 수능 기출 문구도 쓰지 않는다.
- 색: 3D 장면 내부만 자유, HUD·버튼은 `theme.css`·`palettes.ts` 토큰만.
- 새 마이그레이션 파일 이름은 `$(date -u +%Y%m%d%H%M%S)_<이름>.sql`. 번호 직접 붙이지 않음.
- 커밋 메시지: `type: 내용`(feat/fix/chore/docs/test, 한국어), 끝에 두 줄
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01T7oyVtKG6pnDM5tZ8KAEkt`. 커밋 저자: `git -c user.name="용승주" -c user.email="sjyong0403@gmail.com" commit …`.
- 각 태스크 끝에서 관련 `npx vitest run <파일>`과 `npm run typecheck`가 통과해야 커밋.
- 브랜치 `feat/sneak-exam`(이미 존재). main 직접 커밋 금지. 푸시는 마지막 태스크에서만.

## Review Focus

1. **탭 숨김 후 복귀**: 숨김 동안 틱이 없고, 복귀 직후 몰아서 따라잡지 않는다. → Task 7 `does not catch up after the tab was hidden`.
2. **로직이 거부할 명령을 화면이 보냄**: 다른 도구가 켜져 있거나 숨기는 중에 도구 버튼을 눌러도 `onAction`이 불리지 않는다(거부되면 로컬과 플랫폼 상태가 어긋난다). → Task 7 `sends nothing for a tool press the logic would reject`.
3. **종료 순간과 겹친 입력**: 시간 종료·적발 뒤 버튼을 눌러도 `onAction`이 더 불리지 않고, 틱 묶음이 종료를 넘으면 뒤 명령은 버려지되 오류가 아니다. → Task 4 `drops the command when the batch crosses the end`, Task 7 `sends nothing after the game ended`.
4. **이어 하기**: 숨기는 중·도구 켜진 중간 상태의 `publicState`로 마운트해도 그 상태에서 이어진다. → Task 7 `resumes from a mid-game public state`.
5. **판 도중 이탈(언마운트)**: 이후 `onAction` 없음, rAF·리스너·장면 `dispose`. → Task 7 `stops and disposes on unmount`.

---

### Task 1: 상수·난수·문제 은행·시험 구성

**Files:**
- Create: `src/games/sneak-exam/constants.ts`, `rng.ts`, `questions.ts`, `exam.ts`
- Test: `src/games/sneak-exam/rng.test.ts`, `questions.test.ts`, `exam.test.ts`

**Interfaces (Produces):**

```ts
// constants.ts — 아래 값을 그대로 쓴다
export const TICK_HZ = 60
export const TOTAL_TICKS = 7200
export const N_Q = 8
export const N_CHOICE = 5
export const PROG_MAX = 3600
export const SUSP_MAX = 10000
export const SUSP_DECAY = 5
export const SUSP_WATCH = 6000
export const ME_X = 900
export const ME_Z = 1000
export const COL_X = [-2700, -900, 900, 2700] as const
export const ROW_Z = [1000, 2400, 3800, 5200, 6600] as const
export const AISLE_X = [-3600, -1800, 0, 1800, 3600] as const
export const WATCH_AISLE_X = [0, 1800] as const
export const FRONT_Z = 8200
export const NEAR2 = 1500 * 1500
export const MID2 = 3500 * 3500
export type ToolSpec = { name: string; rate: number; stow: number; seen: readonly [number, number, number]; blind: readonly [number, number, number] } // [near, mid, far]
export const TOOLS: readonly (ToolSpec | null)[] = [
  null,
  { name: '스마트 안경', rate: 6, stow: 0, seen: [60, 10, 0], blind: [0, 0, 0] },
  { name: '무선 이어폰', rate: 12, stow: 20, seen: [120, 20, 0], blind: [120, 20, 0] },
  { name: '휴대폰', rate: 30, stow: 40, seen: [250, 80, 15], blind: [40, 0, 0] },
]
export type ProctorSpec = {
  name: string; hint: string; speed: number; farMul: number; glassesFar: number
  wWatch: number; wDoze: number; wPatrol: number
  watchT: readonly [number, number]; dozeT: readonly [number, number]; lookT: readonly [number, number]
  relookOf: number   // look이 끝났을 때 1/relookOf 확률로 같은 통로의 다른 줄을 한 번 더 본다. 0이면 안 함
}
export const PROCTORS: readonly ProctorSpec[] = [
  { name: '순찰형', hint: '쉬지 않고 통로를 돈다', speed: 25, farMul: 1, glassesFar: 0, wWatch: 1, wDoze: 0, wPatrol: 6, watchT: [60, 120], dozeT: [0, 0], lookT: [40, 90], relookOf: 3 },
  { name: '매의 눈', hint: '멀리서도 잘 본다', speed: 20, farMul: 2, glassesFar: 5, wWatch: 6, wDoze: 0, wPatrol: 2, watchT: [180, 360], dozeT: [0, 0], lookT: [90, 180], relookOf: 0 },
  { name: '졸음형', hint: '자주 졸지만 언제 깰지 모른다', speed: 15, farMul: 1, glassesFar: 0, wWatch: 2, wDoze: 5, wPatrol: 1, watchT: [60, 180], dozeT: [60, 240], lookT: [60, 120], relookOf: 0 },
]
export const START_GRACE = 120      // 시작 직후 감독관이 앞에 서 있는 틱
export const SCORE_BASE = 100
export const BONUS_MAX = 100
export const SCORE_MAX = 1600
export const MAX_ACTION_TICKS = 120
export const SEND_TICKS = 30
export const MAX_CATCHUP = 5

// rng.ts
export function nextRng(r: number): number            // (Math.imul(r, 1664525) + 1013904223) >>> 0
export function rngInt(r: number, n: number): number   // Math.floor((r >>> 8) * n / 16777216), 0..n-1
export function seedInt(seed: string, salt: number): number // 32자리 16진수 시드를 8자리씩 4개로 XOR한 뒤 Math.imul(x ^ salt, 2654435761) >>> 0

// questions.ts
export type Question = { id: number; text: string; choices: readonly [string, string, string, string, string] }
export const QUESTIONS: readonly Question[]   // 30개 이상, id는 0부터 연속

// exam.ts
export type Exam = { questionIds: number[]; answers: number[]; proctorType: 0 | 1 | 2; rng0: number }
export function getExam(seed: string): Exam   // seed별 캐시(최근 8개). salt: 문제 1, 정답 2, 성향 3, 순찰 4
```

- [ ] **Step 1: 실패하는 테스트 작성**

`rng.test.ts`: `nextRng`가 항상 0..2^32-1 정수; `rngInt(r, 5)`가 1만 번 굴려 0..4만 나오고 다섯 값이 모두 나옴; `seedInt('0'.repeat(32), 1) !== seedInt('0'.repeat(32), 2)`; 같은 입력은 같은 출력.

`questions.test.ts`: `QUESTIONS.length >= 30`; `QUESTIONS[i].id === i`; 모든 문제의 선택지 5개가 서로 다르고 빈 문자열 없음; 문구 중복 없음.

`exam.test.ts`: `getExam(s).questionIds`는 길이 8·중복 없음·모두 `QUESTIONS` 범위 안; `answers`는 길이 8·각 0..4; 같은 시드는 `toEqual`; 시드 100개에서 `proctorType` 세 값이 모두 나옴; `rng0`는 정수.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/sneak-exam` → 모듈 없음으로 FAIL.

- [ ] **Step 3: 구현**

`questions.ts`의 문제는 설계 §5 말투(수능 문제 말투의 답을 알 수 없는 농담)로 30개를 새로 쓴다. 설계의 예시 3개를 포함해도 된다. 특정 실존 인물·브랜드·정치·비하 소재는 쓰지 않는다. `getExam`의 문제 고르기는 부분 피셔-예이츠(앞 8개)로 한다.

- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/sneak-exam && npm run typecheck`

- [ ] **Step 5: 커밋** — `feat: 몰래 수능 상수·난수·문제 은행`

---

### Task 2: 감독관 상태 기계

**Files:**
- Create: `src/games/sneak-exam/proctor.ts`
- Test: `src/games/sneak-exam/proctor.test.ts`

**Interfaces:**
- Consumes: Task 1의 `constants.ts`, `rng.ts`.
- Produces:

```ts
export type Face = 0 | 1 | 2 | 3   // 0: −z(학생 쪽), 1: +z(칠판 쪽), 2: −x, 3: +x
export type Proctor = { x: number; z: number; face: Face; mode: 'front' | 'walk' | 'look'; dozing: boolean; timer: number; tx: number; tz: number; relooked: boolean }
export function initProctor(): Proctor   // { x: 0, z: FRONT_Z, face: 0, mode: 'front', dozing: false, timer: START_GRACE, tx: 0, tz: FRONT_Z, relooked: false }
export function stepProctor(p: Proctor, rng: number, type: 0 | 1 | 2, susp: number): { p: Proctor; rng: number }
```

규칙(설계 §3.6을 이렇게 확정한다):

- `walk`: 한 틱에 `speed`만큼, 남은 거리가 더 짧으면 그만큼만. 경로는 `x === tx`이면 z를 `tz` 쪽으로, 아니고 `z === FRONT_Z`이면 x를 `tx` 쪽으로, 아니면 z를 `FRONT_Z` 쪽으로. `face`는 이번 틱에 움직인 방향. 도착하면: `tz === FRONT_Z`이면 `mode: 'front'`, `face: 0`, `dozing: false`, `timer: 30`. 아니면 `mode: 'look'`, `timer`는 `lookT` 범위에서 뽑고, `face`는 `susp >= SUSP_WATCH`이거나 x가 `WATCH_AISLE_X`에 들고 `tz === ROW_Z[0]`이면 내 쪽(`x < ME_X`이면 3, 아니면 2), 그 밖에는 2·3 중 무작위.
- `front`·`look`: `timer`를 1 줄인다. 0이 되면 결정한다.
  - `susp >= SUSP_WATCH`: `tx`는 `WATCH_AISLE_X` 중 무작위, `tz = ROW_Z[0]`, `mode: 'walk'`, `dozing: false`, `relooked: false`. 이미 그 자리의 `look`이면 `timer`만 `lookT`에서 다시 뽑는다.
  - `look`이 끝남: `relookOf > 0`이고 `relooked`가 false이고 `rngInt(r, relookOf) === 0`이면 같은 x의 다른 `ROW_Z`로 걸어가 한 번 더 본다(`relooked: true`). 아니면 `tx`는 `AISLE_X` 중 무작위, `tz = FRONT_Z`로 걷는다.
  - `front`가 끝남: `wWatch:wDoze:wPatrol` 가중치로 뽑는다. watch → `face: 0`, `dozing: false`, `timer`는 `watchT`. doze → `dozing: true`, `timer`는 `dozeT`. patrol → `tx`는 `AISLE_X` 중 무작위, `tz`는 `ROW_Z` 중 무작위, `mode: 'walk'`, `relooked: false`.
- 범위 `[a, b]`에서 뽑기는 `a + rngInt(r, b - a + 1)`. 난수를 쓸 때마다 `r = nextRng(r)` 뒤에 쓴다. 난수를 안 쓴 틱에는 `rng`를 그대로 돌려준다.
- 입력 객체를 바꾸지 않고 새 객체를 돌려준다.

- [ ] **Step 1: 실패하는 테스트 작성** (`proctor.test.ts`)

- `stays on the graph`: 성향 3개 × 시드 20개 × 7200틱. 매 틱 `x ∈ AISLE_X || z === FRONT_Z`, `ROW_Z[0] <= z <= FRONT_Z`, 모든 수 필드가 `Number.isInteger`.
- `stops in aisles only at row centers`: `mode === 'look'`이면 `x ∈ AISLE_X`이고 `z ∈ ROW_Z`.
- `faces the way it walks`: `walk` 중 위치가 바뀐 틱에 `face`가 이동 방향과 일치.
- `moves at the type speed`: `walk` 중 한 틱 이동량 ≤ `PROCTORS[type].speed`, 도착 틱이 아니면 정확히 `speed`.
- `only the drowsy type dozes`: 7200틱 × 시드 20개에서 type 0·1은 `dozing`이 한 번도 true가 아니고 type 2는 true인 틱이 있다.
- `heads to my aisle when suspicion is high`: `susp = SUSP_WATCH`로 계속 굴리면 600틱 안에 `mode === 'look'`, `x ∈ WATCH_AISLE_X`, `z === ROW_Z[0]`, `face`가 내 쪽(x=0이면 3, x=1800이면 2)인 틱이 온다. 성향 3개 모두.
- `is deterministic`: 같은 `(rng, type)`으로 두 번 돌린 1000틱 궤적이 `toEqual`.
- `does not mutate its input`: `Object.freeze`한 `p`로 호출해도 예외 없음.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/sneak-exam/proctor.test.ts`
- [ ] **Step 3: `stepProctor`·`initProctor` 구현**
- [ ] **Step 4: 통과 확인** — 위 명령 + `npm run typecheck`
- [ ] **Step 5: 커밋** — `feat: 몰래 수능 감독관 상태 기계`

---

### Task 3: 시뮬

**Files:**
- Create: `src/games/sneak-exam/sim.ts`
- Test: `src/games/sneak-exam/sim.test.ts`

**Interfaces:**
- Consumes: Task 1 `constants.ts`·`exam.ts`(`Exam`), Task 2 `Proctor`·`initProctor`·`stepProctor`.
- Produces:

```ts
export type Cmd = ['t', number] | ['q', number] | ['m', number, number] | ['x']
export type End = null | 'submit' | 'timeout' | 'caught' | 'give_up'
export type SimState = {
  tick: number; rng: number; proctor: Proctor; susp: number
  tool: 0 | 1 | 2 | 3; stow: number; q: number
  prog: number[]; marks: number[]; end: End
}
export function initSim(exam: Exam): SimState   // tick 0, rng exam.rng0, susp 0, tool 0, stow 0, q 0, prog 8×0, marks 8×−1, end null
export function zoneOf(x: number, z: number): 0 | 1 | 2      // 0 near, 1 mid, 2 far — (x, z)에서 내 자리까지
export function sees(p: Proctor): boolean
export function gainOf(s: SimState, type: 0 | 1 | 2): number // 이 상태에서 한 틱 의심도 증가
export function step(s: SimState, exam: Exam): SimState      // 한 틱. end가 있으면 s를 그대로 돌려준다
export function parseCmd(c: unknown): Cmd | null             // 형식·범위 검증
export function canApply(s: SimState, cmd: Cmd): boolean
export function applyCmd(s: SimState, cmd: Cmd): SimState    // canApply가 true일 때만 부른다
```

규칙:

- `sees`: `dozing`이면 false. `px = ME_X − p.x`, `pz = ME_Z − p.z`. face 0이면 `along = −pz`, `side = px`; 1이면 `along = pz`, `side = px`; 2이면 `along = −px`, `side = pz`; 3이면 `along = px`, `side = pz`. `along > 0 && Math.abs(side) <= 2 * along`.
- `gainOf`: `tool === 0`이거나 `dozing`이면 0. 구역 z = `zoneOf(proctor)`. `sees`이면 `TOOLS[tool].seen[z]`, 아니면 `TOOLS[tool].blind[z]`. 보는 far이면 `PROCTORS[type].farMul`을 곱하고, 안경(tool 1)이고 보는 far이면 `PROCTORS[type].glassesFar`를 쓴다(곱하지 않는다).
- `step` 순서: ① `tick + 1` ② `stepProctor(proctor, rng, exam.proctorType, susp)` ③ 새 감독관 위치로 `gainOf` → `g > 0`이면 `susp = min(SUSP_MAX, susp + g)`, 아니면 `susp = max(0, susp − SUSP_DECAY)` ④ `susp === SUSP_MAX`이면 `end: 'caught'`로 돌려준다 ⑤ `tool !== 0 && stow === 0 && prog[q] < PROG_MAX`이면 `prog[q] = min(PROG_MAX, prog[q] + rate)` ⑥ `stow > 0`이면 1 줄이고 0이 되면 `tool = 0` ⑦ `tick >= TOTAL_TICKS`이면 `end: 'timeout'`.
- 명령: `['t', k]` k는 0..3. `k === 0`: 도구가 켜져 있고 숨기는 중이 아니면 `stow = TOOLS[tool].stow`(0이면 즉시 `tool = 0`); 도구가 없거나 이미 숨기는 중이면 아무 변화 없이 유효. `k !== 0`: `tool === 0`일 때만 유효(`tool = k`), 같은 도구가 이미 켜져 있고 숨기는 중이 아니면 변화 없이 유효, 그 밖(다른 도구가 켜짐·숨기는 중)은 `canApply` false. `['q', i]` i는 0..7. `['m', i, v]` i는 0..7, v는 −1..4. `['x']`는 `end: 'submit'`. `end !== null`이면 모든 명령이 `canApply` false.
- 입력을 바꾸지 않는다(`prog`·`marks`는 새 배열).

- [ ] **Step 1: 실패하는 테스트 작성** (`sim.test.ts`). 감독관 위치를 직접 넣은 상태를 만들어 검사한다(`{ ...initSim(exam), proctor: { ...initProctor(), x, z, face, mode: 'look', timer: 9999 } }`).

- `zone boundaries`: `zoneOf(0, 1000) === 0`(900mm), `zoneOf(0, 2400) === 1`(약 1664mm), `zoneOf(900, 2500) === 0`(1500mm 경계 포함), `zoneOf(900, 4500) === 1`(3500mm 경계 포함), `zoneOf(900, 4501) === 2`, `zoneOf(0, 8200) === 2`.
- `sight cone`: (0, 8200) face 0 → true; face 1 → false; (0, 2400) face 0 → true; (0, 1000) face 0 → false(along 0); (0, 1000) face 3 → true; (1800, 1000) face 2 → true; (1800, 1000) face 3 → false; dozing이면 항상 false.
- `gain table`: 도구 3개 × (보는 near, 보는 mid, 보는 far, 안 보는 near, 안 보는 mid) = 설계 §3.4 표의 15개 값. 매의 눈(type 1) 보는 far: 안경 5, 휴대폰 30. 조는 중이면 모두 0.
- `suspicion rises and decays`: 보는 near에서 휴대폰 켜고 한 틱 → 250; 도구 없이 한 틱 → 245; 0 아래로 안 내려감.
- `caught at max`: 보는 near 휴대폰 40틱 → `end === 'caught'`, `susp === 10000`, 이후 `step`은 같은 객체를 돌려준다.
- `progress per tool`: far·안 봄 상태에서 안경 600틱·이어폰 300틱·휴대폰 120틱에 각각 `prog[q] === 3600`, 그보다 1틱 적으면 미만. 넘어서도 3600.
- `progress persists`: 휴대폰 60틱 → 문제 바꿈 → 돌아오면 `prog[0] === 1800`.
- `stowing`: 휴대폰 켠 채 `['t', 0]` → `stow === 40`, 그 뒤 40틱 동안 `prog` 불변·`gainOf > 0`(보는 near), 40틱째에 `tool === 0`. 안경은 `['t', 0]` 즉시 `tool === 0`.
- `tool switching rules`: 휴대폰 켠 상태에서 `canApply(['t', 1]) === false`; 숨기는 중 `canApply(['t', 3]) === false`; 도구 없을 때 `canApply(['t', 2]) === true`.
- `timeout`: 아무것도 안 하고 7200틱 → `end === 'timeout'`, `tick === 7200`.
- `parseCmd`: `['t', 4]`, `['q', 8]`, `['m', 0, 5]`, `['m', 0]`, `['x', 1]`, `'x'`, `['t', 1.5]`, `null` → null. 유효한 네 종류는 그대로.
- `integers only`: 무작위 명령을 섞어 7200틱 돌리며 모든 수 필드 `Number.isInteger`.
- `idle never raises suspicion`: 시드 30개, 도구 없이 끝까지 → `susp`가 늘 0.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/sneak-exam/sim.test.ts`
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 위 명령 + `npm run typecheck`
- [ ] **Step 5: 커밋** — `feat: 몰래 수능 시뮬`

---

### Task 4: 로직·매니페스트·등록·마이그레이션

**Files:**
- Create: `src/games/sneak-exam/manifest.ts`, `logic.ts`, `logic.test.ts`
- Create: `supabase/migrations/<UTC 타임스탬프>_sneak_exam.sql`
- Modify: `src/games/index.ts`(등록부 한 줄), `CLAUDE.md`(금지 사항의 색 예외에 "몰래 수능 3D 장면 내부 색" 추가)

**Interfaces:**
- Consumes: Task 1 `getExam`, Task 3 `sim.ts` 전부.
- Produces:

```ts
// manifest.ts
{ id: 'sneak-exam', name: '몰래 수능', description: '감독관 몰래 답을 알아내 답안지를 채운다', hidden: true,
  modes: { daily: false, contest: false, free: true }, puzzleSource: 'generate', dailyTimeLimitSec: null,
  options: [], freeStats: 'score', scoreMax: 1600, scoreDecimals: 0 }

// logic.ts
export type Puzzle = { seed: string }
export type State = { seed: string; sim: SimState }
export type Action = { type: 's'; n: number; c?: Cmd }
export type PublicState = { seed: string; sim: SimState; known: number[] }  // known[i] = prog[i] === PROG_MAX ? 정답 : −1
export type Reveal = { answers: number[]; proctorType: 0 | 1 | 2 }
export function scoreOf(sim: SimState, exam: Exam): number
export function correctCount(sim: SimState, exam: Exam): number
export const logic: GameLogic<Puzzle, Action, State, PublicState>   // version: 1
```

규칙:

- `pickPuzzle`·`puzzleKey`는 볼 런(`src/games/ball-run/logic.ts`)과 같은 32자리 16진수 시드.
- `apply`: `end !== null`이면 `{ error: 'finished' }`. `give_up` → `end: 'give_up'`. `'s'`: `n`이 0..`MAX_ACTION_TICKS` 정수가 아니거나, `c`가 있는데 `parseCmd`가 null이면 `{ error: 'invalid_input' }`. n틱을 돌리다 `end`가 생기면 멈추고 `c`는 버린다(오류 아님). 끝나지 않았는데 `canApply`가 false이면 `{ error: 'invalid_input' }`이고 상태는 바뀌지 않는다(틱도 진행하지 않는다).
- `scoreOf`: `end === 'caught'`이면 0. `correct × (SCORE_BASE + bonus)`, `bonus`는 `end === 'submit'`일 때만 `Math.floor((TOTAL_TICKS − tick) × BONUS_MAX / TOTAL_TICKS)`, 그 밖에는 0.
- `actionCount` = `sim.tick`. `isFinished` = `sim.end !== null`. `reveal(puzzle)` = `Reveal`.
- 마이그레이션 내용(볼 런 마이그레이션 `20261106194028_ball_run.sql`의 형식과 주석 말투를 따른다):

```sql
insert into game_modes (game_id, daily, contest, free, score_max) values ('sneak-exam', false, false, true, 1600);
insert into hidden_games (game_id) values ('sneak-exam');
```

- [ ] **Step 1: 실패하는 테스트 작성** (`logic.test.ts`)

- `pickPuzzle seed format`: `/^[0-9a-f]{32}$/`.
- `validates actions`: `{type:'s', n:-1}`, `n:121`, `n:1.5`, `{type:'s', n:0, c:['t',9]}`, `{type:'z'}` → `{ error: 'invalid_input' }`.
- `rejected command leaves state untouched`: 휴대폰 켠 뒤 `{type:'s', n:10, c:['t',1]}` → error, 그 뒤 상태의 `tick`이 그대로.
- `drops the command when the batch crosses the end`: `tick`이 7150인 상태에 `{type:'s', n:100, c:['m',0,1]}` → `{ state }`, `end === 'timeout'`, `marks[0] === -1`.
- `rejects actions after the end`: 제출 뒤 어떤 행동도 `{ error: 'finished' }`.
- `score: guessing`: 정답 8개를 모두 마킹하고 0틱에 제출 → 1600. 정답 3개만 마킹하고 0틱에 제출 → 600.
- `score: time bonus`: 정답 8개 마킹, 4800틱에 제출 → `8 × (100 + 33) = 1064`.
- `score: timeout has no bonus`: 정답 5개 마킹 후 시간 종료 → 500. 진행 중·`give_up`도 `정답 수 × 100`.
- `score: caught is zero`: 정답 8개 마킹 뒤 적발 → 0.
- `publicState hides unrevealed answers`: 시작 상태의 `known`은 모두 −1. 한 문제를 다 푼 뒤 그 칸만 정답.
- `determinism`: 같은 시드에 같은 행동 열 → 최종 상태 `toEqual`. 같은 틱·명령을 `n`을 다르게 쪼개 보내도(예: 30+30 대 60) 같은 최종 상태.
- `registry`: `getGame('sneak-exam')`이 이 모듈.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/sneak-exam/logic.test.ts`
- [ ] **Step 3: 구현 + 등록부·마이그레이션·CLAUDE.md**
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games && npm run typecheck` (`registry.test.ts`가 마이그레이션과 `hidden`·`scoreMax` 일치를 검사한다)
- [ ] **Step 5: 커밋** — `feat: 몰래 수능 로직·등록·마이그레이션`

---

### Task 5: 봇과 밸런스

**Files:**
- Create: `src/games/sneak-exam/bots.ts`, `balance.test.ts`
- Modify(필요할 때만): `src/games/sneak-exam/constants.ts`의 `TOOLS`·`PROCTORS`·`SUSP_*` 수치, 그리고 그 수치를 박아 둔 `sim.test.ts`·설계 문서 §3.4~3.6 표

**Interfaces:**
- Consumes: Task 3 `sim.ts`, Task 4 `correctCount`·`scoreOf`.
- Produces:

```ts
export type Bot = (s: SimState, exam: Exam, known: number[]) => Cmd | null   // 틱마다 불린다. null이면 명령 없음
export const idleBot: Bot
export const recklessBot: Bot   // 0틱에 휴대폰을 켜고, 문제가 풀리면 정답을 마킹하고 다음 문제로, 다 풀면 제출. 끄지 않는다
export const carefulBot: Bot    // 지금 상태에서 gainOf가 0이 되는 도구 중 가장 빠른 것을 쓴다. 없으면 susp < 2000일 때에 한해 증가 10 이하인 도구를 쓰고, 그것도 없으면 끈다(바꿀 때는 끄고 숨기기가 끝난 뒤 켠다). 마킹·문제 넘기기·제출은 recklessBot과 같다
export const glassesBot: Bot    // 안경만 쓴다. 감독관이 near이면 끈다
export function runBot(seed: string, bot: Bot): { sim: SimState; score: number; correct: number }
```

- [ ] **Step 1: 실패하는 테스트 작성** (`balance.test.ts`, 시드는 `i.toString(16).padStart(32, '0')`의 i = 1..200)

- `idle bot is never suspected`: 모든 시드에서 `susp === 0`으로 `timeout`.
- `reckless bot is usually caught`: 적발 비율 ≥ 0.9.
- `careful bot`: 적발 비율 ≤ 0.05, 평균 정답 수 ≥ 6, 성향별 평균 정답 수 ≥ 5.
- `glasses only is safe but slow`: 적발 비율 ≤ 0.05, 평균 점수가 `carefulBot` 평균 점수보다 낮다.
- `guess-all is not competitive`: 0틱에 모두 0번으로 마킹하고 제출한 평균 점수가 `carefulBot` 평균 점수의 절반보다 낮다.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/sneak-exam/balance.test.ts`
- [ ] **Step 3: 봇 구현**
- [ ] **Step 4: 통과할 때까지 수치 조정.** 조정 범위는 `TOOLS`의 `seen`·`blind`·`rate`·`stow`, `PROCTORS`의 가중치·시간 범위·`speed`, `SUSP_DECAY`·`SUSP_WATCH`. 테스트의 문턱값과 `TOTAL_TICKS`·점수 공식·교실 좌표는 바꾸지 않는다. 수치를 바꾸면 `sim.test.ts`의 기대값과 설계 문서 표를 같이 고친다. 문턱값을 못 맞추면 어떤 수치로 어디까지 갔는지 보고하고 멈춘다(문턱을 낮춰 통과시키지 않는다).
- [ ] **Step 5: 통과 확인** — `npx vitest run src/games/sneak-exam && npm run typecheck`
- [ ] **Step 6: 커밋** — `test: 몰래 수능 봇·밸런스`

---

### Task 6: 3D 장면

**Files:**
- Create: `src/games/sneak-exam/render/view.ts`, `render/view.test.ts`, `render/scene.ts`

**Interfaces:**
- Consumes: Task 1 `constants.ts`, Task 3 `SimState`.
- Produces:

```ts
// view.ts (순수, three 없음)
export const CAM = { x: ME_X, y: 1150, z: ME_Z, fovY: 60 } as const   // mm, 도
export function offscreenSide(x: number, z: number, aspect: number): -1 | 0 | 1
// 카메라는 (CAM.x, CAM.z)에서 +z를 본다. dz = z − CAM.z, dx = x − CAM.x.
// dz <= 200이면 dx 부호(0이면 −1). 아니면 |dx| > dz × tan(fovY/2) × aspect일 때 dx 부호, 그 밖에는 0. 화면 오른쪽 = +x.

// scene.ts
export type SceneHandle = {
  resize(width: number, height: number, dpr: number): void
  render(prev: SimState, cur: SimState, alpha: number, nowMs: number): void   // alpha: 틱 사이 보간 0..1
  dispose(): void
}
export function createScene(canvas: HTMLCanvasElement): SceneHandle   // WebGL을 못 만들면 throw
```

- [ ] **Step 1: 실패하는 테스트 작성** (`view.test.ts`): `offscreenSide(0, 1000, 9/16) === -1`, `offscreenSide(1800, 1000, 9/16) === 1`, `offscreenSide(0, 8200, 9/16) === 0`, `offscreenSide(900, 5000, 9/16) === 0`, `offscreenSide(-3600, 2400, 9/16) === -1`, `offscreenSide(3600, 8200, 16/9) === 0`.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/sneak-exam/render`
- [ ] **Step 3: `view.ts` 구현, 통과 확인**
- [ ] **Step 4: `scene.ts` 구현**

`src/games/ball-run/render/scene.ts`의 렌더러 생성·`resize`·`dispose` 방식을 따른다(`devicePixelRatio` 최대 2). 설계 §6을 읽고 만든다.

- 좌표 대응: 시뮬 (x, z) → three (x, y, −z), 단위는 m(÷1000). 그래야 +x가 화면 오른쪽이다. 카메라는 `CAM` 위치에서 칠판 쪽(three −z)을 약간 내려다본다(책상 위 답안지가 화면 아래에 걸리게).
- 교실: 바닥, 세 벽, 칠판, 창문(왼쪽 벽), 교탁, 책상·의자 20개(`COL_X` × `ROW_Z`, 내 자리 포함), 내 자리를 뺀 19자리에 앉은 학생(박스 조합, 옷 색 몇 가지). 내 책상 위에 답안지 판.
- 답안지: `CanvasTexture`로 8행 × 5칸을 그리고 `cur.marks`가 바뀔 때만 다시 그린다.
- 감독관: 박스 조합 인물(검은 정장). `prev`·`cur`의 x·z를 `alpha`로 선형 보간. 몸은 `face` 방향을 본다(방향 전환은 화면에서만 부드럽게 보간). `mode === 'walk'`이면 다리가 `nowMs` 기준으로 흔들리고, `dozing`이면 고개를 숙인다.
- 도구 표시: 휴대폰이 켜져 있으면 책상 아래쪽에 작은 빛(점광원 + 발광 판). 안경·이어폰 표시는 HUD(Task 7)가 맡는다.
- 적발(`cur.end === 'caught'`): 감독관을 카메라 바로 앞으로 0.6초에 걸쳐 옮겨 화면을 가린다(시뮬 위치와 무관한 화면 연출).
- `dispose`: renderer·geometry·material·texture 모두 해제.

- [ ] **Step 5: 확인** — `npm run typecheck && npm run build` (장면은 Task 7의 화면 테스트에서 mock된다. 눈으로 보는 확인은 Task 8)
- [ ] **Step 6: 커밋** — `feat: 몰래 수능 3D 장면`

---

### Task 7: 화면

**Files:**
- Create: `src/games/sneak-exam/Game.tsx`, `sneak-exam.css`, `Game.test.tsx`
- Modify: `src/games/ui.ts`(화면 등록 한 줄)

**Interfaces:**
- Consumes: `GameProps`(`src/games/ui.ts`), Task 4 `logic`·`PublicState`·`Action`·`scoreOf`·`correctCount`, Task 3 `step`·`canApply`·`applyCmd`, Task 1 `getExam`·`QUESTIONS`·`TOOLS`·`PROCTORS`, Task 6 `createScene`(동적 import)·`offscreenSide`.
- Produces: `export function Game(props: GameProps)`.

구조는 `src/games/ball-run/Game.tsx`를 본보기로 한다: 마운트 때 `publicState.sim`으로 로컬 시뮬 시작, rAF 고정 틱 누산기(한 프레임 최대 `MAX_CATCHUP`틱), 장면 동적 import(`loading`·`no-webgl`·`load-failed` 단계와 문구), 탭 숨김·일시정지 중 틱 정지와 복귀 시 누산기 초기화, 개발 모드에서 플랫폼 상태와 로컬 상태 비교 `console.warn`.

이 게임에서 다른 점:

- 보내기: 로컬에서 진행한 틱 수 `pending`을 센다. 명령이 생기면 `canApply`를 먼저 확인하고, 유효할 때만 `onAction({ type: 's', n: pending, c })`를 보내고 로컬에 `applyCmd`한다. 명령 없이 `pending >= SEND_TICKS`이면 `onAction({ type: 's', n: pending })`. 로컬 시뮬이 끝나면 남은 `pending`을 즉시 보낸다. 끝난 뒤에는 아무것도 보내지 않는다.
- 정답 표시는 `publicState.known`이 아니라 로컬 진행도로 판단한다: `cur.prog[i] === PROG_MAX`인 문제만 `getExam(seed).answers[i]`를 보여 준다(플랫폼 상태는 최대 30틱 늦다).
- 화면 요소(설계 §6의 배치). 테스트가 쓰는 이름을 그대로 붙인다.
  - 의심도 막대 `role="progressbar"` `aria-label="의심도"` `aria-valuenow`(0..100 정수), 남은 시간 `data-testid="se-time"`("m:ss"), 일시정지 버튼 `aria-label="일시정지"`.
  - 문제: 이전·다음 버튼(`aria-label="이전 문제"`·`"다음 문제"`), "문제 N / 8", 문구, 선택지 5개. 풀린 문제는 정답 선택지에 `data-known="true"`.
  - 풀이 진행 막대 `aria-label="풀이 진행"`.
  - 도구 버튼 3개(`TOOLS[k].name`이 접근성 이름). 켜진 도구는 `aria-pressed="true"`. 같은 버튼을 다시 누르면 `['t', 0]`. 다른 도구가 켜져 있거나 숨기는 중이면 나머지 버튼은 `disabled`. 숨기는 중에는 그 버튼에 "숨기는 중" 표시.
  - 마킹 버튼 5개(`aria-label="1번 마킹"`…`"5번 마킹"`), 현재 문제의 마킹은 `aria-pressed="true"`, 같은 번호를 다시 누르면 `['m', q, -1]`.
  - 제출 버튼 "제출". 한 번 누르면 "정말 제출할까요?" 확인으로 바뀌고 다시 눌러야 `['x']`.
  - 감독관이 시야 밖이면 `data-testid="se-edge"`에 `data-side="left" | "right"`(`offscreenSide`에 캔버스 가로세로비를 넣어 계산). 시야 안이면 렌더하지 않는다.
  - 안경이 켜져 있으면 캔버스 래퍼에 `data-glasses="true"`(테두리 효과), 이어폰이 켜져 있으면 귀 아이콘 표시.
- 시작 전 오버레이: 규칙 세 줄, 도구 표(이름·풀이 시간·한 줄 위험 설명), "오늘의 감독관: {PROCTORS[type].name} — {hint}", "시작" 버튼. 시작을 누르기 전에는 틱이 없다. 이어 하기(`sim.tick > 0`)로 마운트하면 오버레이 대신 일시정지 상태("계속하려면 누르기")로 연다.
- 결과(`finished` 또는 로컬 `end`): 종료 사유 문구(`submit` "제출했어요", `timeout` "시간이 끝났어요", `caught` "{도구 이름} 적발! 0점 처리", `give_up` "포기했어요"), 점수, 정답 수 "N / 8", 시간 보너스, 문제별 정오(내 마킹·정답). 적발이면 장면의 가림 연출이 끝난 뒤(0.8초) 보여 준다.
- PC 키: 1·2·3 도구, ←/→ 문제, Q·W·E·R·T 마킹, Enter 제출(확인 포함), Space 일시정지.
- 모바일 세로 우선. 캔버스는 화면 폭, 높이는 남는 공간. 버튼은 최소 44px. `touch-action: manipulation`.

- [ ] **Step 1: 실패하는 테스트 작성** (`Game.test.tsx`). `./render/scene.ts`를 `vi.mock`으로 가짜 `createScene`(`resize`·`render`·`dispose`가 `vi.fn()`)으로 바꾸고, `src/games/ball-run/Game.test.tsx`의 가짜 타이머·rAF 진행 방식을 따른다. 시드는 고정 문자열을 쓰고 `publicState`는 `logic.publicState(logic.initState({ seed }, ctx))`로 만든다.

- `shows the proctor type before start and does not tick`: 시작 전 "오늘의 감독관"과 성향 이름이 보이고, 1초를 진행해도 `onAction`이 안 불린다.
- `sends a heartbeat every 30 ticks`: 시작 뒤 0.5초 → `onAction({ type: 's', n: 30 })` 한 번.
- `sends a tool command with elapsed ticks`: 시작 뒤 10틱 진행, "휴대폰" 클릭 → `onAction({ type: 's', n: 10, c: ['t', 3] })`, 버튼 `aria-pressed="true"`.
- `toggles a tool off with the same button`: 다시 클릭 → `c: ['t', 0]`, "숨기는 중" 표시.
- `sends nothing for a tool press the logic would reject`: 휴대폰 켠 뒤 "스마트 안경" 버튼은 `disabled`이고, 강제로 `fireEvent.click`해도 `onAction` 호출 수가 그대로.
- `reveals the answer when solved`: 휴대폰 켜고 120틱 → 정답 선택지에 `data-known="true"`, 그 전에는 없음.
- `marks and unmarks`: "3번 마킹" 클릭 → `c: ['m', 0, 2]`; 다시 클릭 → `c: ['m', 0, -1]`.
- `question navigation`: "다음 문제" → `c: ['q', 1]`, "문제 2 / 8" 표시. 첫 문제에서 "이전 문제"는 `disabled`.
- `submit needs a confirmation`: "제출" 한 번 → `['x']` 없음, 확인 문구 표시. 한 번 더 → `c: ['x']`.
- `sends nothing after the game ended`: 제출 뒤 도구·마킹 버튼을 눌러도, 시간을 더 진행해도 `onAction` 호출 수가 그대로.
- `pauses`: 일시정지 뒤 1초 → `onAction` 없음. 계속 → 다시 진행.
- `does not catch up after the tab was hidden`: `visibilityState`를 hidden으로 바꾸고 5초 뒤 visible → 복귀 직후 한 프레임에서 보낸 `n` 합이 `MAX_CATCHUP` 이하.
- `never sends a batch over 120 ticks`: 한 프레임을 3초로 건너뛰어도 모든 호출의 `n <= 120`.
- `resumes from a mid-game public state`: 휴대폰을 켜고 숨기는 중(`stow: 20`)이며 `tick: 600`인 상태로 마운트 → 일시정지 상태로 열리고, 계속하면 20틱 뒤 휴대폰 버튼이 `aria-pressed="false"`.
- `shows the edge indicator when the proctor is beside me`: 감독관이 (0, 1000)인 상태로 마운트 → `se-edge`의 `data-side="left"`. (0, 8200)이면 `se-edge` 없음.
- `shows the result with the reason`: 적발 상태로 마운트(`finished: true`, `score: 0`) → "휴대폰 적발"과 "0점" 표시.
- `stops and disposes on unmount`: 언마운트 뒤 시간을 진행해도 `onAction` 없음, `dispose`가 한 번 불림.
- `shows a fallback without WebGL`: `createScene`이 throw → "이 기기에서는 3D 화면을 지원하지 않아요".

- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/sneak-exam/Game.test.tsx`
- [ ] **Step 3: `Game.tsx`·`sneak-exam.css` 구현, `ui.ts` 등록**
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/sneak-exam && npm run typecheck && npm run build`
- [ ] **Step 5: 커밋** — `feat: 몰래 수능 화면`

---

### Task 8: 전체 확인·눈으로 보기·푸시

**Files:** 없음(고칠 게 나오면 해당 파일).

- [ ] **Step 1: 전체 검사** — `npm test && npm run typecheck && npm run build`. 모두 통과해야 한다.
- [ ] **Step 2: 눈으로 보기.** `npm run dev`를 띄우고 헤드리스 브라우저(Playwright가 설치돼 있으면 그것, 없으면 `npx playwright install chromium`)로 게임 화면을 390×844 뷰포트에서 연다. 로그인 없이 화면을 볼 방법이 없으면 `Game`만 띄우는 임시 하네스 페이지를 만들어 쓰고 커밋하지 않는다. 캡처할 것: 시작 전 오버레이, 플레이 중(감독관이 앞에 있을 때), 감독관이 옆 통로에 왔을 때(가장자리 표시), 휴대폰 켠 상태, 적발 결과. 캡처를 직접 보고 확인한다: 교실·학생·감독관이 보이는가, 감독관의 몸 방향이 읽히는가, HUD 글자가 잘리거나 겹치지 않는가, 버튼이 한 화면에 들어오는가. 문제가 있으면 고치고 다시 캡처한다. WebGL이 헤드리스에서 안 뜨면 `--use-gl=swiftshader`(또는 `--enable-unsafe-swiftshader`)로 띄운다. 그래도 안 되면 못 봤다고 보고한다(봤다고 쓰지 않는다).
- [ ] **Step 3: 커밋**(고친 게 있으면) — `fix: 몰래 수능 화면 다듬기`
- [ ] **Step 4: 푸시** — `git -c push.negotiate=true push -u origin feat/sneak-exam`

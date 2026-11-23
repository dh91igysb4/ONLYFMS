# 네온 라이더 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 예전 버전 Rider(Ketchapp) 무한 모드의 손맛을 재현한 자유 플레이 점수 게임 `neon-rider`를 onlyfms에 바로 공개 상태로 추가한다.

**Architecture:** 볼 런과 같은 구조다. 순수 정수 시뮬(`sim.ts`)이 판정과 화면의 단일 기준이고, `logic.ts`가 이를 `GameLogic`으로 감싼다. 차는 바퀴 질점 두 개를 막대로 이은 Verlet 모델, 지형은 시드로 이어붙인 템플릿의 선분 목록이다. 화면은 캔버스 2D.

**Tech Stack:** TypeScript, React 18, Vite, Vitest, Supabase 마이그레이션. 새 npm 의존 없음.

**Spec:** `docs/superpowers/specs/2026-11-23-neon-rider-design.md` (실행자는 이 계획과 함께 읽는다. 볼 런 코드 `src/games/ball-run/`가 구조의 본보기다.)

## Global Constraints

- `render.ts`·`Game.tsx`를 뺀 `src/games/neon-rider/*.ts`는 외부 의존 없는 순수 TS. 상대 import에 `.ts` 확장자 명시(Deno 호환).
- 시뮬 상태는 모두 정수. 허용 연산: `+ - *`, `Math.floor(a / b)`, 비교, `Math.abs/min/max`, `trig.ts`의 함수. `Math.sin/cos/tan/atan2/sqrt/pow/hypot`와 부동소수 리터럴 금지. 중간값 < 2^50.
- 단위: 길이 1u = 1/16 mm, 시간 1틱 = 1/60 s, 각도 한 바퀴 = 4096. y는 위가 +.
- 조정 수치는 전부 `constants.ts`에만 둔다. 다른 파일에 숫자 상수를 새로 만들지 않는다.
- 원작의 이름·로고·차량 그림·문구를 그대로 쓰지 않는다. 녹화 영상과 그 프레임은 저장소에 넣지 않는다.
- 화면 문구는 한국어. 예외는 캔버스 안의 착지 감탄 문구(영어 소문자)뿐.
- 색: 캔버스 내부만 직접 지정, 그 밖은 `theme.css` 토큰.
- `hidden: false`로 머지한다(사용자 결정, 숨김 우선 절차의 예외). `hidden_games` 행을 넣지 않는다. `logic.version`은 1로 시작.
- 커밋 메시지 `type: 내용`. 푸시 전 `npm test && npm run typecheck && npm run build`.
- 손맛이 기준이다. 녹화 측정이 설계 5장의 규칙과 어긋나면 규칙을 고치고 설계 문서에 반영한다(설계 §10). 실패 조건(설계 §2)과 결정성은 못 바꾼다.

## Review Focus

1. 공중에서 탭을 숨겼다 돌아옴 → 틱이 멈췄다가 같은 상태에서 이어져야 하고, 숨긴 동안 누름이 풀려 있어야 한다(Task 9).
2. 손가락이 화면 밖으로 나가거나 `pointercancel`, 두 번째 손가락 → 누름 상태가 붙어 버리면 안 된다(Task 9).
3. 잘못된 행동(`d`가 배열 아님, 음수, 합 0 또는 120 초과, 소수) → `{ error }`를 돌려주고 상태는 그대로(Task 6).
4. 아주 긴 판(30분, 점수 수백) → 코스 캐시와 상태 크기가 한도 안이고 틱 시간이 늘지 않아야 한다(Task 4, Task 5).
5. 느린 기기(프레임당 5틱 한도) → 끊기는 대신 느려지고, 판정은 틱 수로만 정해져 결과가 같아야 한다(Task 9).

---

### Task 1: 정수 삼각함수 (`trig.ts`)

**Files:** Create `src/games/neon-rider/trig.ts`, `src/games/neon-rider/trig.test.ts`

**Interfaces — Produces:**
```ts
export const TURN = 4096
export const TRIG_ONE = 16384
export function sinT(a: number): number   // a는 임의의 정수(음수·TURN 초과 허용), 결과 [-16384, 16384]
export function cosT(a: number): number
export function isqrt(n: number): number  // 0 ≤ n < 2^52 정수의 floor 제곱근
export function atan2T(dy: number, dx: number): number // [0, TURN) 정수. (0,0)이면 0
export function angDiff(a: number, b: number): number  // a - b를 (-TURN/2, TURN/2]로 접은 값
```

- [ ] **Step 1: 실패하는 테스트 작성** — `sinT(0)=0`, `sinT(1024)=16384`, `sinT(-1024)=-16384`, `cosT(2048)=-16384`, `sinT(a+4096)=sinT(a)`; 모든 a∈[0,4096)에서 `|sinT(a) - round(16384*Math.sin(2πa/4096))| ≤ 1`(테스트 안에서는 `Math.sin` 사용 가능); `isqrt`는 0, 1, 15→3, 16→4, `2**52-1`, 무작위 1000개에서 `r*r ≤ n < (r+1)*(r+1)`; `atan2T(0,1)=0`, `(1,0)=1024`, `(0,-1)=2048`, `(-1,0)=3072`, 무작위 방향에서 `Math.atan2` 기준 오차 ≤ 1; `angDiff(10, 4090)=16`.
- [ ] **Step 2: `npx vitest run src/games/neon-rider/trig.test.ts`** → FAIL(모듈 없음)
- [ ] **Step 3: 구현.** 사인표는 1/4바퀴 1025개 정수 리터럴 배열로 파일에 넣는다(런타임에 `Math.sin`으로 만들지 않는다. 표는 일회용 스크립트로 생성해 붙인다). `atan2T`는 8분면으로 접은 뒤 표에서 `dy*cos ≤ dx*sin` 교차 곱 비교로 이진 탐색한다. `isqrt`는 정수 뉴턴법.
- [ ] **Step 4: 같은 명령** → PASS
- [ ] **Step 5: Commit** `feat: neon-rider 정수 삼각함수`

### Task 2: 녹화 측정과 상수 (`constants.ts`)

**Files:** Create `src/games/neon-rider/constants.ts`, `src/games/neon-rider/constants.test.ts`, `docs/superpowers/specs/2026-11-23-neon-rider-measurements.md`

녹화: `/mnt/user-data/uploads/2시간동안_게임만했더니___.mp4`(1920×1080, 60fps, 게임 영역은 x 100~900). 세션에 없으면 사용자에게 다시 올려 달라고 하고, 그동안 아래 초기값으로 진행한다.

**Interfaces — Produces** (초기값. 측정 뒤 값만 바꾸고 이름은 유지):
```ts
export const TICK_HZ = 60
export const MM = 16                      // 1 mm = 16u
export const WHEELBASE = 1400 * MM
export const WHEEL_R = 300 * MM
export const HEAD_OFFSET = 450 * MM       // 두 바퀴 중점에서 차 윗방향
export const HEAD_R = 250 * MM
export const G = 10                       // u/틱² (측정으로 교체)
export const DRIVE_ACC = 12
export const WHEELIE_ACC = 3
export const V_MAX = 3200                 // u/틱 (= 12 m/s)
export const BOOST_V = 4200
export const V_TERMINAL = 4500
export const SUBSTEPS = 1                 // (V_TERMINAL / SUBSTEPS) < WHEEL_R 이어야 한다
export const SPIN_ACC = 6                 // 공중 회전용 바퀴 접선 가속
export const SPIN_MAX = 68                // 각속도 상한, TURN 단위/틱 (≈ 1바퀴/초)
export const AIR_SPIN_DAMP = 8            // 뗐을 때 틱마다 각속도를 1/8씩 줄임
export const ROLL_DRAG = 1
export const RESTITUTION_PCT = 20
export const FRICTION_PCT = 2
export const CONSTRAINT_ITERS = 4
export const COLLIDE_WINDOW = 40          // 선분 수
export const FALL_DEPTH = 6000 * MM
export const LAND_GRACE = 12
export const PERFECT_TOL = 170            // ≈ 15°
export const PERFECT_MULT = 2
export const SCORE_MAX = 9999
export const SEG_LEN = 250 * MM           // 호를 선분화하는 목표 길이
export const REST_LEN = 9000 * MM
export const START_LEN = 12000 * MM
export const TIER_WEIGHTS: readonly { from: number; w: readonly [number, number, number, number] }[] =
  [{ from: 0, w: [1, 0, 0, 0] }, { from: 4, w: [3, 2, 0, 0] }, { from: 12, w: [2, 3, 2, 0] }, { from: 30, w: [1, 2, 3, 2] }]
export const SEND_TICKS = 30
export const MAX_ACTION_TICKS = 120
export const MAX_RUNS = 64
export const VIEW_CARS = 8                // 화면 폭 = 차 길이 × 8
```

- [ ] **Step 1: 측정.** 연속 구간(77~102초, 103~133초, 222~237초)을 `ffmpeg -vf "crop=800:1080:100:0"`으로 60fps 프레임으로 뽑아 스크래치 폴더(저장소 밖)에 둔다. 차 길이를 단위로 다음을 잰다: 점프 포물선에서 중력, 평지에서 정지→최고 속도까지 가속 곡선과 최고 속도, 부스터 직후 속도, 누르고 있을 때 공중 각속도와 뗐을 때 감쇠, 착지 반발, 땅에서 누를 때 앞이 들리는 정도, 화면 대비 차 크기와 차의 화면 위치. 측정 문서에 값·근거 시각·불확실도를 표로 적는다(프레임 이미지는 넣지 않는다).
- [ ] **Step 2: 상수 테스트 작성** — 모든 export 숫자가 `Number.isInteger`; `Math.floor(V_TERMINAL / SUBSTEPS) < WHEEL_R`; `BOOST_V > V_MAX`; `HEAD_OFFSET - HEAD_R > 0`; `TIER_WEIGHTS`의 `from`이 오름차순이고 첫 항목이 0.
- [ ] **Step 3: 실행** → FAIL
- [ ] **Step 4: `constants.ts` 작성.** 위 이름에 측정값을 u·틱 단위로 환산해 넣고 각 줄에 근거 주석(측정 문서 항목)을 단다. 못 잰 값은 초기값을 두고 "미측정"이라고 적는다.
- [ ] **Step 5: 실행** → PASS. **Commit** `feat: neon-rider 상수와 녹화 측정`

### Task 3: 템플릿과 선분 (`pieces.ts`)

**Files:** Create `src/games/neon-rider/pieces.ts`, `src/games/neon-rider/pieces.test.ts`

**Interfaces — Consumes:** Task 1 `sinT, cosT`, Task 2 `SEG_LEN, MM`.
**Produces:**
```ts
export type Seg = { x0: number; y0: number; x1: number; y1: number; boost: boolean }
export type Prim =
  | { t: 'line'; dx: number; dy: number }
  | { t: 'arc'; r: number; a0: number; a1: number }   // 현재 점에서 시작. a0→a1(TURN 단위), a1>a0이면 반시계
  | { t: 'gap'; dx: number; dy: number }               // 길 없이 펜만 이동
  | { t: 'boost'; len: number }                        // 수평 부스터 직선
  | { t: 'gem'; dx: number; dy: number }               // 현재 점 기준 위치에 보석 하나(펜은 그대로)
export type Template = { id: string; tier: 1 | 2 | 3 | 4; prims: readonly Prim[] }
export type Built = { segs: Seg[]; gems: { x: number; y: number }[]; endX: number; endY: number; minY: number }
export const TEMPLATES: readonly Template[]
export function buildTemplate(t: Template): Built      // 원점 (0,0)에서 시작
```
이 작업에서는 템플릿 3개만 넣는다: `hill`(완만한 언덕, tier 1), `ramp`(오르막 끝 낭떠러지 + 착지 평지, tier 1), `bowl`(반원 그릇 + 보석 4개, tier 1). 나머지는 Task 7.

- [ ] **Step 1: 테스트** — `buildTemplate`: `line` 하나는 선분 1개; 반지름 r의 반원 `arc`는 선분 수 ≥ `πr/SEG_LEN`의 floor이고 모든 끝점이 중심에서 r±2u; 연속 선분은 끝점이 이어진다(`gap` 뒤 제외); `boost` 선분만 `boost: true`; 모든 좌표 정수; `minY`가 선분 최저 y; 모든 `TEMPLATES`가 **첫 선분과 마지막 선분이 수평이고 길이 ≥ 1 m**, `endX > 0`, id 중복 없음.
- [ ] **Step 2: 실행** → FAIL
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 실행** → PASS. **Step 5: Commit** `feat: neon-rider 템플릿 선분화`

### Task 4: 코스 (`course.ts`)

**Files:** Create `src/games/neon-rider/course.ts`, `src/games/neon-rider/course.test.ts`

**Interfaces — Consumes:** Task 3 전부, Task 2 `REST_LEN, START_LEN, TIER_WEIGHTS`.
**Produces:**
```ts
export type Section = { index: number; templateId: string; startX: number; endX: number; firstSeg: number; lastSeg: number; minY: number }
export type Gem = { id: number; x: number; y: number }
export type Course = {
  seg(i: number): Seg                 // 필요하면 i까지 생성
  section(k: number): Section         // 필요하면 k까지 생성
  gemsBetween(segFrom: number, segTo: number): readonly Gem[]
}
export function getCourse(seed: string): Course             // seed별 캐시(최근 4개)
export function courseOf(templateIds: readonly string[]): Course  // 테스트·봇 전용: 주어진 순서로 반복
```
구성: 길이 `START_LEN`의 시작 평지(구간 아님) 뒤로 [`REST_LEN` 평지 + 템플릿]을 반복한다. 구간 k의 `startX`는 그 평지의 시작, `endX`는 템플릿 끝. 난수는 `ball-run/course.ts`와 같은 방식(seed → sfc32, 정수 출력만). 티어는 `TIER_WEIGHTS`에서 `from ≤ k`인 마지막 항목의 가중치로 뽑고, 그 티어 안에서 최근 3개와 다른 템플릿을 고른다(후보가 없으면 제한을 푼다).

- [ ] **Step 1: 테스트** — 같은 seed면 구간 0~49의 `templateId`가 같고 다른 seed면 다르다; 선분은 `gap`이 아닌 한 이어지고 구간 경계에서 높이가 이어진다; 구간 0~3은 tier 1만; 템플릿이 4개 이상인 티어에서는 연속 4개 안에 같은 id 없음; `courseOf(['hill','ramp'])`는 hill, ramp, hill, …; `section(k).firstSeg ≤ lastSeg`이고 k에 대해 단조 증가; **Review Focus 4:** `section(600)`까지 생성해도 `seg(i)` 조회가 배열 접근 수준이고(생성 뒤 `seg` 10만 회가 50ms 미만), `getCourse`를 서로 다른 seed로 6번 부른 뒤 캐시 크기 ≤ 4.
- [ ] **Step 2~5:** FAIL 확인 → 구현 → PASS → **Commit** `feat: neon-rider 코스 생성`

### Task 5: 시뮬 (`sim.ts`)

**Files:** Create `src/games/neon-rider/sim.ts`, `src/games/neon-rider/sim.test.ts`

**Interfaces — Consumes:** Task 1, 2, 4.
**Produces:**
```ts
export type Wheel = { x: number; y: number; px: number; py: number; ground: boolean }  // px,py는 직전 위치(Verlet)
export type SimState = {
  tick: number
  rear: Wheel
  front: Wheel
  progress: number                     // 마지막으로 닿은 선분 번호
  nextSection: number                  // 아직 안 지난 첫 구간 번호
  sectionScore: number
  flipScore: number
  airAngle: number | null              // 공중 구간의 부호 있는 누적 회전(TURN 단위). 접지 중이면 null
  pending: null | { flips: number; perfect: boolean; grace: number }
  lastAward: null | { tick: number; flips: number; perfect: boolean; points: number }
  gems: number
  takenGems: number[]                  // 현재 충돌 창 안에서 주운 보석 id만 유지(창을 벗어난 것은 버린다)
  dead: null | 'crash' | 'fall' | 'give_up'
}
export function initSim(course: Course): SimState               // 시작 평지 위 정지 상태
export function initSimAt(course: Course, x: number, vx: number): SimState  // 테스트·봇 전용: x의 지면 위, 수평 속도 vx
export function step(s: SimState, hold: boolean, course: Course): SimState  // 순수 함수, 새 객체 반환
export function scoreOf(s: SimState): number                    // min(SCORE_MAX, sectionScore + flipScore)
export function bodyAngle(s: SimState): number                  // atan2T(front - rear), 화면용
```
한 틱의 순서(설계 §5.2~5.6): ① 입력 힘(접지+누름: 뒷바퀴 접선 `DRIVE_ACC`와 앞바퀴 들림 `WHEELIE_ACC`, 속도 `V_MAX`까지 / 둘 다 공중+누름: 반시계 회전 가속, `SPIN_MAX`까지 / 공중+뗌: 각속도 `AIR_SPIN_DAMP` 감쇠 / 접지+뗌: `ROLL_DRAG`) ② 중력과 Verlet 적분(`SUBSTEPS`회로 나눔, 속도는 `V_TERMINAL`로 자름) ③ 막대 제약 `CONSTRAINT_ITERS`회와 바퀴-선분 충돌(진행 번호 ±`COLLIDE_WINDOW`의 선분만, 반발·마찰 적용, 부스터 선분에 닿으면 접선 속도를 `BOOST_V` 이상으로) ④ `progress` 갱신 ⑤ 머리 판정점 충돌 → `crash`, 차 중심이 현재 구간 `minY - FALL_DEPTH` 아래 → `fall` ⑥ 공중 구간·착지·지급(설계 §5.6의 정의 그대로) ⑦ 구간 통과(+1)와 보석 줍기 ⑧ `tick + 1`. `dead`면 입력 상태를 그대로 돌려준다.

- [ ] **Step 1: 테스트 (코스는 `courseOf`와 테스트용 단일 템플릿으로 만든다)**
  - 결정성: 같은 입력 열 600틱 → `JSON.stringify` 동일. 모든 필드 정수(재귀 검사).
  - 평지에서 600틱 누름 → 속도가 단조 증가해 `V_MAX`±5%에 수렴, 죽지 않음. 300틱 뗌 → 감속.
  - 앞 들림: 평지에 정지한 상태에서 누르면 60틱 안에 앞바퀴가 뒷바퀴보다 높아지는 틱이 있다(`WHEELIE_ACC > 0`일 때).
  - 막대 길이: 임의 입력 2000틱 동안 `|거리 - WHEELBASE| ≤ WHEELBASE/50`.
  - 관통 없음: `ramp`·`bowl`·평지에서 임의 입력 2000틱(20개 시드) 동안, 죽지 않은 틱에는 두 바퀴 중심이 닿은 선분의 아래쪽으로 `WHEEL_R` 넘게 들어가지 않는다.
  - `ramp`에서 계속 누름 → 공중에서 `airAngle`이 증가(반시계). 공중에서 떼면 30틱 뒤 각속도가 절반 미만.
  - 뒤집힌 착지(`initSimAt` 뒤 상태를 180° 돌려 떨어뜨림) → `crash`. 바퀴로 착지 → 생존.
  - 공중제비: 테스트용 높은 낭떠러지에서 1바퀴 돌고 착지 → `flipScore` 1 또는 2, `lastAward.flips === 1`; 지급은 첫 접촉 뒤 `LAND_GRACE`틱 이내; 착지 직후 죽으면 `flipScore` 0.
  - 퍼펙트: 착지 각도 오차 0으로 만든 상태 → `points === flips * PERFECT_MULT`; 오차 `PERFECT_TOL + 50` → `points === flips`.
  - 앞으로 도는 1바퀴(각도 −TURN)도 `flips === 1`.
  - 구간 통과: `hill` 하나를 지나면 `sectionScore === 1`, `nextSection === 1`.
  - 부스터: 떼고 부스터 선분을 지나도 직후 속도 ≥ `BOOST_V`×0.95.
  - 보석: `bowl`의 보석 위를 지나면 `gems` 증가, 같은 보석은 한 번만.
  - 되굴러옴: 쿼터파이프(테스트용)에서 속도 부족으로 되돌아와도 바닥을 뚫지 않고 `progress`가 감소.
  - `give_up` 이후와 사망 이후 `step`은 같은 객체 내용을 돌려준다.
  - **Review Focus 4:** 20000틱 뒤 `takenGems.length ≤ 64`, `JSON.stringify(state).length < 2000`.
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3: 구현.** 한 파일이 400줄을 넘으면 충돌 계산을 `collide.ts`(`collideWheel(w, segs…)`, `hitsCircle(x, y, r, segs…)`)로 뺀다.
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat: neon-rider 시뮬레이션`

### Task 6: 입력·로직·등록 (`input.ts`, `logic.ts`, `manifest.ts`, 등록부, 마이그레이션)

**Files:**
- Create: `src/games/neon-rider/input.ts`, `input.test.ts`, `logic.ts`, `logic.test.ts`, `manifest.ts`, `supabase/migrations/<UTC 시각>_neon_rider.sql`
- Modify: `src/games/index.ts`(games에 한 줄), `supabase/tests/11_free_score_max.test.sql`(검사 추가, `plan` 수 갱신), `CLAUDE.md:70`(색 예외에 "네온 라이더 캔버스 내부 색", 문구 예외에 "네온 라이더 착지 감탄 문구")

**Interfaces — Produces:**
```ts
// input.ts
export function encodeHold(bits: readonly boolean[]): number[]  // [뗌 길이, 누름 길이, 뗌 길이, …], 첫 값은 0일 수 있다
export function decodeHold(d: unknown): boolean[] | null         // 정수 ≥ 0, 길이 1~MAX_RUNS, 합 1~MAX_ACTION_TICKS, 첫 값 외 0 금지
// logic.ts
export type Puzzle = { seed: string }
export type State = { seed: string; sim: SimState }
export type Action = { type: 'i'; d: number[] }
export const logic: GameLogic<Puzzle, Action, State, State>      // version: 1
```
`logic`은 `ball-run/logic.ts`와 같은 형태(`pickPuzzle`은 128비트 hex seed, `score = scoreOf`, `actionCount = tick`, `reveal = null`). `manifest`는 설계 §4.3 그대로. 마이그레이션은 `game_modes` 한 줄(`score_max 9999`)과 머리말 주석. `hidden_games` 행은 넣지 않는다. `npx supabase@2 migration new neon_rider`가 네트워크로 안 되면 파일 이름을 현재 UTC `YYYYMMDDHHMMSS_neon_rider.sql`로 직접 만든다.

- [ ] **Step 1: 테스트** — `decodeHold(encodeHold(bits))`가 무작위 비트열(길이 1~120)에서 원본과 같다; **Review Focus 3:** `decodeHold`가 `null`, `'x'`, `[]`, `[0]`, `[-1, 3]`, `[1.5]`, `[0, 0, 5]`, `[121]`, 길이 65 배열에 `null`; `logic.apply`가 잘못된 `d`에 `{ error: 'invalid_input' }`이고 상태 객체가 그대로; `apply`로 30틱씩 20번 보낸 결과가 `step` 600번과 같다; `give_up` → `isFinished`; 끝난 뒤 `apply` → `{ error: 'finished' }`; `pickPuzzle` seed가 32자리 hex. DB 테스트: `neon-rider` 9999 저장 성공, 10000 거부.
- [ ] **Step 2:** `npx vitest run src/games/neon-rider src/games/registry.test.ts` → FAIL
- [ ] **Step 3:** 구현과 등록.
- [ ] **Step 4:** 같은 명령 → PASS(`registry.test.ts`가 `scoreMax`·`score_max`·hidden 일치를 검사). `npm run db:test`가 되는 환경이면 실행, 안 되면 PR 본문에 "DB 테스트 미실행"을 적는다.
- [ ] **Step 5: Commit** `feat: neon-rider 로직과 등록`

### Task 7: 템플릿 세트와 통과 게이트 (`bots.ts`, `balance.test.ts`)

**Files:** Create `src/games/neon-rider/bots.ts`, `src/games/neon-rider/balance.test.ts`; Modify `pieces.ts`(템플릿 추가)

**Interfaces — Consumes:** `initSimAt, step, courseOf, TEMPLATES`.
**Produces:**
```ts
export type Entry = 'rest' | 'fast'   // rest: 구간 시작점에 정지 / fast: V_MAX로 진입(앞 템플릿이 부스터로 끝나면 BOOST_V)
export function findPass(templateId: string, entry: Entry): { ok: true; holds: boolean[] } | { ok: false; diedAt: number }
```
봇은 6틱마다 누름/뗌을 정하는 탐색(깊이 우선 + 상태 해시 중복 제거, 탐색 한도 20만 스텝)으로 템플릿 끝 평지를 살아서 넘는 입력 열을 찾는다.

추가할 템플릿(설계 §6, 치수는 Task 2의 측정 문서 기준): tier 1 `waves`(연속 물결); tier 2 `spikes`(위 삼각 열, 밑변 ≈ 차 4대·높이 ≈ 차 2대), `quarter`(쿼터파이프), `scurve`(S자), `boostjump`(부스터 직선 + 점프대, 궤적에 보석 줄); tier 3 `loop`(루프), `steps`(계단식 낙하), `spikes2`(위·아래 삼각 교차); tier 4 `arcs`(끊어진 호 징검다리), `loop2`(연속 루프). `hill`, `ramp`, `bowl`과 합쳐 13개.

- [ ] **Step 1: 테스트** — `test.each(TEMPLATES)`: `findPass(id, 'rest').ok`와 `findPass(id, 'fast').ok`가 모두 true. 실패 메시지에 템플릿 id와 `diedAt`. 추가로 "아무것도 안 누르면 못 넘는 템플릿이 절반 이상"(조작이 의미 있는지), "계속 누르기만 해도 넘는 템플릿이 tier 3·4에는 없다"(난이도 구분).
- [ ] **Step 2:** FAIL(봇 없음)
- [ ] **Step 3:** 봇 구현 → 템플릿을 하나씩 추가하며 게이트 통과까지 치수 조정. 통과가 안 되는 원인이 물리 상수면 Task 2의 상수를 고치고 Task 5 테스트를 다시 돌린다.
- [ ] **Step 4:** `npx vitest run src/games/neon-rider` → 전부 PASS(게이트 테스트 전체 60초 이내)
- [ ] **Step 5: Commit** `feat: neon-rider 템플릿 13종과 통과 게이트`

### Task 8: 그리기 (`render.ts`)

**Files:** Create `src/games/neon-rider/render.ts`, `src/games/neon-rider/render.test.ts`

**Interfaces — Produces:**
```ts
export type Camera = { x: number; y: number; scale: number }   // scale: px / u
export function cameraFor(prev: SimState, cur: SimState, alpha: number, widthPx: number, heightPx: number, last: Camera | null): Camera
export function praiseFor(flips: number, perfect: boolean, tick: number): string
export type Renderer = {
  resize(widthPx: number, heightPx: number, dpr: number): void
  render(prev: SimState, cur: SimState, alpha: number, course: Course, nowMs: number): void
  dispose(): void
}
export function createRenderer(canvas: HTMLCanvasElement): Renderer
```
그리는 것(설계 §7, 녹화의 예전 화면): 위→아래로 어두워지는 보라 배경, 0.3배로 따라 움직이는 어두운 실루엣 층, 분홍 네온 길(굵고 옅은 선 + 가늘고 밝은 선, `shadowBlur` 금지), 노란 부스터 화살표, 노란 보석 점, 새로 그린 노란 차(차체 선 + 바퀴 2개), 위 가운데 가는 큰 점수와 대기 중인 "+N", 오른쪽 위 보석 수, 착지 때 차 옆 "+N"과 한쪽의 감탄 문구(0.8초), 보석·사망 입자. 카메라는 차를 왼쪽 25%·세로 55%에 두고 `scale = widthPx / (VIEW_CARS × WHEELBASE × 10/7)`, 세로는 지수 평활. 화면에 보이는 선분만 그린다. 입자 난수는 화면 전용 `Math.random` 사용 가능.

`praiseFor`의 문구는 새로 짓는다(원작 문구 금지): 1바퀴 `nice!`, `clean!` / 2바퀴 `double!`, `so smooth!` / 3바퀴 `triple!` / 4바퀴 이상 `unreal!`, `dizzy yet?` / 퍼펙트면 앞에 `perfect ` 를 붙인다. `tick`으로 후보 중 하나를 고른다.

- [ ] **Step 1: 테스트** — `cameraFor`: 차가 화면 x의 25%±1px에 온다, `alpha` 0→1에서 위치가 선형 보간, 폭 360과 1280에서 화면에 차 길이 8대가 들어간다; `praiseFor(1,false,0)`가 위 목록 안, `praiseFor(2,true,0)`가 `perfect `로 시작, 모든 반환값이 소문자 ASCII; `createRenderer`에 가짜 2D 컨텍스트(호출 기록)를 주고 `render` 1회 → 예외 없음, `shadowBlur` 대입 없음, `dispose` 뒤 `render`는 아무것도 안 그림.
- [ ] **Step 2~4:** FAIL → 구현 → PASS
- [ ] **Step 5: Commit** `feat: neon-rider 캔버스 그리기`

### Task 9: 화면 (`Game.tsx`)

**Files:** Create `src/games/neon-rider/Game.tsx`, `Game.test.tsx`, `neon-rider.css`; Modify `src/games/ui.ts`(등록 한 줄)

**Interfaces — Consumes:** `GameProps`(`src/games/ui.ts`), Task 4~8. **Produces:** `export function Game(props: GameProps)`.

`ball-run/Game.tsx`의 구조를 따른다: 마운트 때 `publicState`(`State`)로 로컬 시뮬 시작, 고정 간격 누산기(프레임당 최대 5틱), `SEND_TICKS`마다와 사망 틱에 `onAction({ type: 'i', d: encodeHold(pending) })`, 개발 모드에서 플랫폼 상태와 로컬 기록 비교. 다른 점: 입력은 누름 1비트(포인터 누름 또는 스페이스), 첫 누름 전에는 "눌러서 시작" 안내와 정지, 렌더러는 동적 import 없이 직접 사용. HUD 문구는 한국어("눌러서 시작", "일시정지").

- [ ] **Step 1: 테스트** (`ball-run/Game.test.tsx`의 방식: 가짜 타이머·rAF·캔버스 컨텍스트)
  - 마운트 → 캔버스와 "눌러서 시작" 표시, 틱 진행 없음.
  - `pointerdown` 뒤 30틱 진행 → `onAction`이 `{ type: 'i', d }`로 1회, `decodeHold(d)`가 길이 30이고 전부 true.
  - **Review Focus 2:** `pointerdown` → `pointercancel` 뒤 30틱 → 전부 false. `pointerdown`(id 1) → `pointerdown`(id 2) → `pointerup`(id 2) → 여전히 누름, `pointerup`(id 1) → 뗌. `pointerleave`와 창 `blur`도 뗌.
  - **Review Focus 1:** 진행 중 `visibilitychange`(hidden) → 대기 입력이 즉시 전송되고 이후 rAF가 와도 틱이 안 늘어남. visible 복귀 뒤 누름이 풀려 있고 틱이 이어진다.
  - **Review Focus 5:** rAF 간격 500ms 한 번 → 진행 틱 ≤ 5.
  - 스페이스 keydown/keyup이 누름/뗌(반복 keydown 무시, `preventDefault`로 스크롤 방지).
  - `finished`가 true가 되면 입력을 무시하고 `onAction`을 더 부르지 않는다.
  - 언마운트 → rAF 취소, 리스너 제거, `dispose` 호출.
- [ ] **Step 2~4:** FAIL → 구현 → PASS
- [ ] **Step 5: Commit** `feat: neon-rider 게임 화면`

### Task 10: 전체 확인과 PR

- [ ] **Step 1:** `npm test && npm run typecheck && npm run build` → 전부 통과. 메인 번들 크기가 이전 대비 크게 늘지 않았는지 빌드 출력으로 확인(새 의존 없음).
- [ ] **Step 2: 화면 확인.** `npm run dev`를 띄우거나, 안 되면 `Game`을 가짜 props로 그리는 임시 HTML 하네스(저장소에 넣지 않음)를 headless Chrome으로 360×640과 1280×800에서 열어 스크린샷: 시작 화면, 점프 중, 착지 "+N", 사망. 차 크기·위치를 측정 문서의 녹화 수치와 비교하고 어긋나면 `VIEW_CARS`·카메라를 고친다.
- [ ] **Step 3: 손맛 대조.** 봇의 통과 입력으로 `ramp`·`spikes`·`boostjump`를 돌려 점프 거리(차 길이 단위)·체공 시간·공중 1바퀴 시간을 출력하고 측정 문서의 값과 ±15% 안인지 본다. 벗어나면 상수를 고치고 Task 5·7 테스트를 다시 통과시킨다. 결과 표를 측정 문서 끝에 붙인다.
- [ ] **Step 4:** 설계 문서에 구현 중 바뀐 규칙을 반영하고 `docs: neon-rider 설계 갱신`으로 커밋.
- [ ] **Step 5:** 브랜치 `feat/neon-rider` 푸시, PR 생성(`gh api repos/dh91igysb4/onlyfms/pulls -f head=feat/neon-rider -f base=main -F body=@<file>`). 본문에 배포 순서(DB push → Vercel), 머지 즉시 공개된다는 점, 사용자가 실제 휴대폰에서 볼 것(가속감, 회전 속도, 착지 판정, 60Hz 유지), 미측정 상수 목록을 적는다.

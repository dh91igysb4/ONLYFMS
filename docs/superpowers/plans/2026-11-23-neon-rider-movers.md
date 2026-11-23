# 네온 라이더 움직이는 장애물 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네온 라이더에 위험물(닿으면 죽음), 각본대로 움직이는 올라타는 길, 넘어지는 블록을 넣고, 영상·위키 기반 템플릿으로 배치한다.

**Architecture:** 모든 움직임은 부분 틱 시각(또는 밟힌 시각부터의 경과)의 정수 함수(`motion.ts`)다. 위험물은 매 이동 단계마다 차의 판정 도형(바퀴 둘, 차체 판정원, 차대 캡슐)과 겹치는지만 본다(`hazards.ts`). 움직이는 길과 블록 변은 이동 단계마다 월드 선분으로 만들어 기존 후보 목록에 넣고, 이전 자세의 같은 선분을 함께 넘겨 상대 위치·상대 속도로 기존 `collideWheel`이 푼다. 블록은 차와 같은 정수 Verlet 상자(`blocks.ts`)다.

**Tech Stack:** TypeScript, React 18, Vitest. 새 의존 없음.

**Spec:** `docs/superpowers/specs/2026-11-23-neon-rider-hazards-design.md` (본 설계 `2026-11-23-neon-rider-design.md`와 함께 읽는다)

## Global Constraints

- 시뮬 코드는 정수만 쓴다. 허용: `+ - *`, `Math.floor(a / b)`, 비교, `Math.abs/min/max`, `trig.ts` 함수. 금지: `Math.sin/cos/tan/atan2/sqrt/pow/hypot`, 부동소수 리터럴. 중간값 < 2^50.
- 단위: 길이 u(1 mm = 16 u), 각도 TURN = 4096, 시간 틱(1/60 s). 부분 틱 T = tick × SUBSTEPS + k + 1(이동 단계 k, 0부터).
- 조정 수치는 `constants.ts`에, 템플릿 치수는 `pieces.ts`에 둔다. 상대 import에는 `.ts`를 붙인다.
- 화면 문구는 한국어. 색은 캔버스 내부 예외만 쓴다: 위험물 빨강(`#ff3355` 계열), 움직이는 길 노랑, 초록 회전 고리 초록, 블록 흰 윤곽. `shadowBlur` 금지.
- 사망 사유는 늘리지 않는다(위험물·끼임 = `'crash'`).
- 봇 기반 테스트(`balance.test.ts`, `gate/*.gate.test.ts`)는 `describe.skip` 그대로 둔다. 새 봇 테스트를 만들지 않는다.
- 끝에서 `logic.version` 3 → 4.
- 녹화 `/mnt/user-data/uploads/2시간동안_게임만했더니___.mp4`(`crop=800:1080:100:0`만), 위키 PDF `/mnt/user-data/uploads/56cb3ab2-Rider_-_____.pdf`. 프레임·이미지는 커밋하지 않는다.
- 커밋: `git -c user.name=Claude -c user.email=noreply@anthropic.com commit`, 메시지 `type: 내용`, 끝에 두 줄
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01T7oyVpUh2JAiP5VbZHGE6T`. `git add`는 경로로. 푸시하지 않는다. git stash는 건드리지 않는다.

## Review Focus

1. 차가 서 있는 평지 쪽으로 회전하는 길이나 블록이 밀고 들어오면, 바퀴가 지면을 뚫지 않고 끼임으로 `crash`여야 한다(Task 5).
2. 끝난(상태에서 버린) 움직이는 길로 차가 되굴러가면, 마지막 키 자세의 길이 그대로 있어야 한다. 사라지거나 처음 자세로 돌아가면 안 된다(Task 5).
3. 구간 경계를 넘어 뻗은 위험물·길(큰 날, 왕복 범위)도 판정되어야 한다(Task 3).
4. 블록 여러 개가 깨어 있는 긴 판에서 상태 JSON이 6,000자를 넘지 않고, 틱 시간이 늘지 않아야 한다(Task 6).
5. 화면에 그린 위험물 위치와 판정 위치가 같은 함수에서 나와야 한다(보간 시각을 부분 틱으로 반올림). 판정에서 걸린 시각의 그림에서 도형이 겹쳐 보여야 한다(Task 7).

---

### Task 1: 움직임 함수와 상수 (`motion.ts`)

**Files:** Create `src/games/neon-rider/motion.ts`, `motion.test.ts`. Modify `constants.ts`(새 상수), `constants.test.ts`.

**Interfaces — Produces:**
```ts
export type Pose = { dx: number; dy: number; a: number } // 기준 위치에서 옮긴 양(u), 기준점 둘레 회전(TURN)
export type Key = { t: number; dx: number; dy: number; a: number } // t: 시작부터 틱, 오름차순, 첫 키 t = 0
export type Motion =
  | { k: 'none' }
  | { k: 'rotate'; a0: number; w: number } // w: TURN/틱, 정수, 음수 = 시계 방향
  | { k: 'swing'; ax: number; ay: number; period: number; phase: number } // 틱
  | { k: 'pop'; period: number; phase: number; hide: number; rise: number; up: number; fall: number; height: number } // 틱, height u. hide+rise+up+fall = period
  | { k: 'keys'; keys: readonly Key[] }
  | { k: 'fall'; w: number } // 떨어지며 도는 각속도 TURN/틱
export function subtick(tick: number, k: number): number // tick*SUBSTEPS + k + 1
export function poseAt(m: Motion, T: number, T0: number | null): Pose
// time 계열(none/rotate/swing/pop)은 T만 쓴다. keys/fall은 경과 e = T − T0. T0 = null이거나 e ≤ 0이면 첫 자세(keys[0], fall은 0).
// pop은 { dx: 0, dy: extension, a: 0 }을 돌려준다(extension 0 = 숨음). 막대 위쪽 끝에만 적용(Task 2).
export function applyPose(p: Pose, pivotX: number, pivotY: number, x: number, y: number): { x: number; y: number }
// 기준점 둘레로 p.a 회전(cosT/sinT, TRIG_ONE 나눗셈은 Math.floor) 뒤 (p.dx, p.dy) 이동
export function motionDone(m: Motion, T: number, T0: number | null): boolean // keys: 마지막 키를 지남, 그 밖: false (fall 끝은 Task 5가 높이로 정함)
export function maxReach(m: Motion): { dx0: number; dy0: number; dx1: number; dy1: number; turns: boolean } // 움직임 전체의 이동 범위와 회전 여부(상자 계산용)
```
- 부분 틱 환산 규칙: rotate a = a0 + floor(w × T / SUBSTEPS). swing/pop은 주기를 period × SUBSTEPS 부분 틱으로, 위상도 × SUBSTEPS. keys는 키 시각 × SUBSTEPS 사이를 선형 보간한다(floor). fall은 s = e일 때 dy = −floor(G × s² / (2 × SUBSTEPS²)), a = floor(w × s / SUBSTEPS).
- 새 상수(constants.ts, 값은 초기값이며 이름은 고정): `BODY_R = 110 * MM`(차 그림 차체 높이에 맞춰 Task 7에서 확인), `MOVER_MEMORY = 64`, `BLOCK_MASS = 2`(바퀴 하나 대비 정수 배), `BLOCK_CORNER_R = 60 * MM`, `BLOCK_WAKE = 30000 * MM`, `BLOCK_MEMORY = 32`, `CRUSH_DEPTH = Math.floor(WHEEL_R / 2)`. 정수 검사 테스트에 포함한다.

- [ ] **Step 1: 테스트** — `subtick(0,0) = 1`, `subtick(2,2) = 9`(SUBSTEPS 3); rotate: `poseAt({k:'rotate',a0:100,w:6}, subtick(10,2), null).a === 100 + 6*11`; swing: T=0 → (0,0), T=반주기 → (ax,ay), T=주기 → (0,0), 모든 값 정수, 주기성(T와 T+period·SUBSTEPS 같음); pop: 각 단계 경계에서 extension이 0 / 증가 / height / 감소이고 hide 동안 0; keys: T0=null → keys[0], 키 사이 중간 보간, 마지막 키 뒤 고정, `motionDone` true; fall: e=0 → 0, 단조 감소, e=60·SUBSTEPS에서 dy = −floor(G·(60·3)²/(2·9)); `applyPose` 90° 회전(1024)으로 (1,0)→(0,1)×스케일 근사(±1 u); 무작위 입력 1,000개에서 결과 정수. `maxReach`가 swing·keys의 범위를 덮는다.
- [ ] **Step 2:** `npx vitest run src/games/neon-rider/motion.test.ts src/games/neon-rider/constants.test.ts` → FAIL
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 같은 명령 → PASS
- [ ] **Step 5: Commit** `feat: 네온 라이더 움직임 함수와 상수`

### Task 2: 위험물 도형과 겹침 (`hazards.ts`)

**Files:** Create `src/games/neon-rider/hazards.ts`, `hazards.test.ts`.

**Interfaces — Consumes:** Task 1 `Motion, poseAt, applyPose, maxReach`; `trig.ts`; `collide.ts`의 `Box`.
**Produces:**
```ts
export type HazardShape =
  | { s: 'disc'; x: number; y: number; r: number }
  | { s: 'blades'; x: number; y: number; rIn: number; rOut: number; n: number; w: number } // w: 조각 폭 TURN, 조각 시작각은 pose.a + i·TURN/n
  | { s: 'bar'; x0: number; y0: number; x1: number; y1: number; r: number }
export type HazardLook = 'saw' | 'pacman' | 'blades' | 'ring' | 'spikes' | 'laser' | 'spear' | 'plain'
export type HazardDef = { shape: HazardShape; motion: Motion; look: HazardLook }
export type Hazard = HazardDef & { id: number } // 월드 좌표
export type Probe = {
  circles: readonly { x: number; y: number; r: number }[] // 바퀴 둘 + 차체 판정원
  capsule: { x0: number; y0: number; x1: number; y1: number; r: number } // 차대(두 바퀴 중심, BODY_R)
}
export function shapeAt(h: Hazard, T: number): HazardShape | null // 월드 도형. pop 숨음이면 null. blades의 회전은 shape의 a로 표현하지 않고 bladeArcs로 꺼낸다
export function bladeAngles(h: Hazard, T: number): number[] // blades 조각 시작각들
export function hazardHit(h: Hazard, T: number, p: Probe): boolean
export function hazardBox(h: Hazard): Box // 움직임 전체를 덮는 상자 (blades·rotate는 중심 ± rOut)
```
- 겹침: 원–원, 원–캡슐, 캡슐–캡슐(선분 최단 거리), 원·캡슐–부채꼴 고리(극좌표 + 곧은 변·끝 모서리 거리; 캡슐은 선분을 BODY_R 간격 이하로 나눈 점의 원으로 근사 가능). 오차 45 mm(= `Math.floor(WHEEL_R / 4)`) 안.
- pop은 막대 끝점 1(x1, y1)을 (0, extension)만큼 올린다. 막대는 바닥(x0,y0)에서 위로 솟는다.

- [ ] **Step 1: 테스트** — 원–원 경계: 거리 = r1+r2+1 → false, r1+r2−1 → true; 원–캡슐 중간·끝 캡; 캡슐–캡슐 평행·교차·끝 근접; 부채꼴: 조각 안 점 true, 조각 사이 빈 각 false, rIn 안쪽(rIn > 0) false, 바깥 rOut + c − 1 true; 회전 후(시각 바꿔) 같은 점의 결과가 바뀜; 오차 테스트: 경계에서 45 mm 밖은 false, 안은 true(여러 방향); **차대 테스트:** 두 바퀴 사이로 지나가는 세로 막대(r = 1 mm)에 대해 바퀴 원·차체 원은 안 겹치고 캡슐이 겹쳐 true; pop 숨음이면 `shapeAt` null이고 hit false; `hazardBox`가 swing 끝점·blades 전 원을 덮음.
- [ ] **Step 2:** `npx vitest run src/games/neon-rider/hazards.test.ts` → FAIL
- [ ] **Step 3:** 구현
- [ ] **Step 4:** PASS
- [ ] **Step 5: Commit** `feat: 네온 라이더 위험물 도형과 겹침 판정`

### Task 3: 템플릿·코스에 위험물·길·블록 싣기 (`pieces.ts`, `course.ts`, `movers.ts`·`blocks.ts` 타입)

**Files:** Modify `pieces.ts`, `pieces.test.ts`, `course.ts`, `course.test.ts`. Create `src/games/neon-rider/movers.ts`(타입·자세 함수만), `blocks.ts`(타입만).

**Interfaces — Consumes:** Task 1, Task 2 타입.
**Produces:**
```ts
// movers.ts
export type MoverStart = { k: 'time' } | { k: 'touch'; delay: number } | { k: 'pass'; x: number; delay: number } // delay 틱, pass.x는 템플릿 좌표(코스가 월드로 옮김)
export type MoverLook = 'yellow' | 'green'
export type MoverDef = { segs: readonly Seg[]; pivotX: number; pivotY: number; motion: Motion; start: MoverStart; look: MoverLook }
export type Mover = MoverDef & { id: number } // 월드 좌표
export function moverSegsAt(m: Mover, T: number, T0: number | null): Seg[] // 월드 선분
export function moverBox(m: Mover): Box // 움직임 전체(fall은 아래로 FALL_DEPTH까지)
// blocks.ts
export type BlockDef = { x: number; y: number; w: number; h: number; a: number } // x,y = 바닥 변 가운데, a = 처음 각도
export type Block = BlockDef & { id: number }
// pieces.ts
export type Prim = ... | { t: 'hazard'; dx: number; dy: number; h: HazardDef } | { t: 'mover'; dx: number; dy: number; m: MoverDef } | { t: 'block'; dx: number; dy: number; b: BlockDef }
// hazard·mover·block의 좌표는 (dx, dy)를 기준점으로 한 상대 좌표. 펜은 움직이지 않는다.
export type Built = { segs; gems; hazards: HazardDef[]; movers: MoverDef[]; blocks: BlockDef[]; endX; endY; minY } // 셋 다 템플릿 좌표
// course.ts — Course에 추가
hazardsNear(box: Box): readonly Hazard[]
moversNear(box: Box): readonly Mover[]
blocksNear(box: Box): readonly Block[]
moverById(id: number): Mover // 상태에 남은 id로 다시 찾기(Task 5)
```
- 구간을 만들 때 전역 id(위험물·길·블록 각각 증가)를 붙여 월드로 옮긴다. `trimFlats`의 앞쪽 x 이동은 셋에도 적용한다. `*Near`는 상자의 x1까지 구간을 만들어 가며, 항목의 움직임 상자(`hazardBox`/`moverBox`/블록 처음 상자 + `BLOCK_WAKE`는 아님)로 이웃 구간까지 찾는다(이진 탐색 + 양옆 확장).

- [ ] **Step 1: 테스트** — `buildTemplate`이 hazard/mover/block prim을 펜 기준으로 놓고 펜은 그대로; `trimFlats` 템플릿에서 셋이 보석과 같은 양만큼 x 이동; 코스 테스트용 템플릿(이 테스트 파일 안에서 정의)으로 `hazardsNear`가 같은 구간·다음 구간·**구간 끝을 넘어 뻗은 날(Review Focus 3)**을 돌려줌; 공중 비행 상자(진행 번호와 무관한 x)에서도 찾음; id가 시드에 대해 결정적이고 중복 없음; `moverById`가 같은 객체 내용; 기존 pieces·course 테스트 그대로 통과.
- [ ] **Step 2:** `npx vitest run src/games/neon-rider/pieces.test.ts src/games/neon-rider/course.test.ts` → FAIL
- [ ] **Step 3:** 구현
- [ ] **Step 4:** PASS
- [ ] **Step 5: Commit** `feat: 네온 라이더 템플릿·코스에 위험물·움직이는 길·블록 싣기`

### Task 4: 시뮬에 위험물 판정 넣기 (`sim.ts`)

**Files:** Modify `sim.ts`, `sim.test.ts`.

**Interfaces — Consumes:** Task 1~3. **Produces:** `step`이 이동 단계마다 근처 위험물(`course.hazardsNear(box)`)을 `hazardHit(h, subtick(s.tick, k), probe)`로 확인하고, 하나라도 맞으면 그 틱 결과를 `dead: 'crash'`로 끝낸다(지급 대기 중 공중제비는 지급 안 함, 기존 crashed 경로 재사용). probe = 바퀴 둘(WHEEL_R), 차체 판정원(HEAD_R), 차대 캡슐(두 바퀴 중심, BODY_R).
- [ ] **Step 1: 테스트**(테스트 파일 안의 템플릿으로)
  - 평지 위 제자리 톱니로 달려가면 `crash`.
  - 원형 배럴(rotate blades, 틈 있음): 시작 틱을 바꾼 두 경우에서 한 번은 살아 지나가고 한 번은 `crash`.
  - pop 창: 숨은 위상에 지나가면 살고, 솟은 위상이면 `crash`.
  - 두 바퀴 사이로 가는 레이저(가는 bar, 바퀴 높이 위·차체 판정원 아래)에서 `crash`(차대).
  - 위험물이 없는 지형에서 기존 결과와 같음(기존 테스트 통과).
  - 결정성: 같은 입력 600틱 두 번 → 같은 JSON.
- [ ] **Step 2~4:** FAIL → 구현 → `npx vitest run src/games/neon-rider` PASS
- [ ] **Step 5: Commit** `feat: 네온 라이더 위험물에 닿으면 죽음`

### Task 5: 움직이는 길 (`movers.ts`, `collide.ts`, `sim.ts`)

**Files:** Modify `movers.ts`, `collide.ts`, `sim.ts`, `sim.test.ts`, `logic.test.ts`(상태 모양). Create `movers.test.ts`.

**Interfaces — Consumes:** Task 1~3.
**Produces:**
- `Cand`에 선택 필드 `prev?: Seg`(같은 선분의 이전 이동 단계 자세)를 더한다. `collideWheel`은 `prev`가 있으면 바퀴 이전 위치를 이전 선분 기준 상대 좌표로 옮겨 지금 선분 기준으로 되돌린 점으로 어느 쪽에서 왔는지 판단하고, 접점의 선분 속도(지금 − 이전)를 뺀 상대 속도로 응답·마찰을 적용한 뒤 다시 더한다. `prev`가 없으면 지금과 똑같이 동작한다.
- 움직이는 길 Cand의 `i`는 음수(−1 − 길 id × 1000 − 선분 번호처럼 겹치지 않게)로 둬서 진행 번호를 바꾸지 않는다.
- `SimState`에 `movers: { id: number; t0: number }[]`(touch/pass 시작 틱, 진행 중인 것)와 `moversDone: number[]`(끝난 id, 최대 `MOVER_MEMORY`, 오래된 것부터 버림)를 더한다. 끝난 길은 마지막 키 자세로 고정해 판정·그림에 쓴다. `fall` 길은 코스 바닥보다 `FALL_DEPTH` 넘게 떨어지면 끝(이후 판정·그림 없음).
- 시작 조건: `touch`는 바퀴가 그 길 선분에 처음 닿은 틱 + delay = t0. `pass`는 차 중심 x가 pass.x를 넘은 틱 + delay. t0은 한 번만 정한다.
- 구동 최고 속도: 뒷바퀴가 움직이는 길에 닿아 있으면 `V_MAX` 상한을 그 길 접점 속도에 대한 상대 속도로 잰다.
- 끼임: 이동 단계 끝에 바퀴가 움직이는 선분(prev 있음)과 고정 선분에 동시에 `CRUSH_DEPTH` 넘게 파고들어 있으면 `crash`.
- 착지·퍼펙트: 움직이는 선분도 고정 선분과 같이 처리(닿은 순간 그 선분 각도).

- [ ] **Step 1: 테스트**
  - `movers.test.ts`: `moverSegsAt` 자세 적용, `moverBox`가 회전·swing·fall 범위를 덮음.
  - 수평 swing 길 위 정지한 차가 길과 함께 움직인다(10 틱 평균 상대 속도 < 바퀴 반지름/20).
  - 회전 고리 위에서 임의 입력 20 시드 × 600틱 동안 바퀴 중심이 그 선분을 뚫지 않는다(관통 검사 방식은 기존 집중 관통 테스트와 같다).
  - 빠르게 도는 길에서 차가 튕겨 나간다(공중에 뜸).
  - `touch` 길: 닿은 틱 + delay에 움직이기 시작하고 그 전에는 처음 자세.
  - 일회성 도로: 조각 셋 중 밟은 조각만 떨어지고, 같이 떨어지면 `fall`.
  - `pass` 길: x를 넘기 전 처음 자세, 넘은 뒤 delay 지나 움직임.
  - **Review Focus 2:** 끝난 keys 길이 `moversDone`으로 옮겨진 뒤 차가 되굴러와 다시 닿으면 마지막 키 자세의 선분에 닿는다.
  - **Review Focus 1:** 평지에 정지한 차 쪽으로 회전해 들어오는 막대 길이 바퀴를 지면 쪽으로 밀면 바퀴가 지면 아래로 가지 않고 `crash`.
  - 움직이는 길 위 착지에서 공중제비 1바퀴 지급(평평한 swing 길).
  - 움직이는 것이 없는 지형에서 기존 결과와 같음.
- [ ] **Step 2~4:** FAIL → 구현 → `npx vitest run src/games/neon-rider` PASS
- [ ] **Step 5: Commit** `feat: 네온 라이더 올라타는 움직이는 길`

### Task 6: 넘어지는 블록 (`blocks.ts`, `sim.ts`)

**Files:** Modify `blocks.ts`, `sim.ts`, `sim.test.ts`. Create `blocks.test.ts`.

**Interfaces — Consumes:** Task 1~5(움직이는 Cand의 `prev`).
**Produces:**
```ts
export type BlockState = { id: number; p: number[] } // 16 정수: 꼭짓점 4개 × (x, y, px, py), 반시계 순서, 0번 = 처음 자세의 왼쪽 아래
export function wakeBlock(b: Block): BlockState
export function blockSegs(bs: BlockState): { now: Seg[]; prev: Seg[] } // 네 변, 바퀴 충돌용(prev = 직전 이동 단계 자세)
export function blockBox(bs: BlockState): Box
```
- `SimState`에 `blocks: BlockState[]`, `blocksDone: number[]`(최대 `BLOCK_MEMORY`)를 더한다. 차 중심과 블록 처음 위치 거리가 `BLOCK_WAKE` 안이면 깨운다. 깨기 전에는 처음 자세의 고정 상자로 판정·그림.
- 매 이동 단계: 블록 Verlet 적분(중력, 이동 단계 분할은 차와 같음) → 막대 6개 제약 → 꼭짓점(`BLOCK_CORNER_R` 원)–지형·움직이는 길 충돌(`collideWheel` 재사용) → 블록–블록(꼭짓점이 다른 상자 안이면 가까운 변 밖으로, 같은 질량) → 바퀴·차체 판정원·차대 캡슐–블록 겹침을 `BLOCK_MASS` 비율로 나눠 양쪽을 민다.
- 바퀴가 블록 변에 닿으면 접지(블록 변 Cand에 `prev`를 붙여 Task 5 경로로). 차체 판정원·차대가 블록에 닿아도 죽지 않는다. 블록과 위험물은 서로 판정하지 않는다.
- 차 뒤로 `BLOCK_WAKE`보다 멀어지거나 코스 바닥 − `FALL_DEPTH` 아래로 떨어진 블록은 `blocksDone`으로 옮긴다.

- [ ] **Step 1: 테스트**
  - 평지에 혼자 선 블록은 600틱 뒤에도 서 있다(기울기 < 2°, 위치 변화 < 5 mm).
  - 차가 밀면 블록이 앞으로 움직이고, 키 큰 블록은 넘어진다(각도 > 45°).
  - 차체 판정원이 블록에 닿아도 `dead`는 null.
  - 블록 둘이 겹치지 않는다(꼭짓점이 상대 상자 안으로 1 mm 넘게 들어가지 않음).
  - 블록 위에 올라탄 바퀴는 접지로 치고 누르면 구동한다.
  - 결정성; 막대 길이 오차 < 2%.
  - **Review Focus 4:** 블록 8개가 한꺼번에 깨어 있는 템플릿 600틱 동안 `JSON.stringify(state).length ≤ 6000`, 20000틱 판에서 `blocksDone.length ≤ BLOCK_MEMORY`. 기존 2,000자 테스트는 6,000으로 고친다.
- [ ] **Step 2~4:** FAIL → 구현 → `npx vitest run src/games/neon-rider` PASS. `sim.ts`가 600줄을 넘으면 블록 단계를 `blocks.ts`로 옮긴다.
- [ ] **Step 5: Commit** `feat: 네온 라이더 넘어지는 블록`

### Task 7: 그리기 (`render.ts`)

**Files:** Modify `render.ts`, `render.test.ts`.

**Interfaces — Consumes:** Task 2 `shapeAt, bladeAngles`, Task 3 `*Near`, Task 5 `moverSegsAt`, Task 6 `BlockState`.
- 보간 시각: 부분 틱 Tr = prev.tick × SUBSTEPS + round(alpha × SUBSTEPS)(정수로). 위험물·time 길은 Tr로, touch/pass 길은 상태의 t0로, 블록은 prev·cur 꼭짓점 보간으로 그린다.
- 모양·색은 spec §8. 보이는 것만 그린다(`*Near`에 화면 상자). 차 그림의 차체 높이와 `BODY_R`이 맞는지 확인하고 필요하면 `BODY_R`을 고친다.
- [ ] **Step 1: 테스트**(가짜 컨텍스트) — 위험물·길·블록이 있는 코스에서 `render` 1회: 예외 없음, `shadowBlur` 대입 없음, 빨강·노랑·초록·흰색 strokeStyle/fillStyle이 각각 쓰임, 화면 밖 위험물은 그리지 않음. **Review Focus 5:** 판정에서 처음 `crash`가 난 틱 상태를 alpha = 1로 그렸을 때, 그 위험물의 그린 도형(가짜 컨텍스트 경로 좌표)이 차 판정 도형과 화면에서 겹친다.
- [ ] **Step 2~4:** FAIL → 구현 → PASS
- [ ] **Step 5: Commit** `feat: 네온 라이더 위험물·움직이는 길·블록 그리기`

### Task 8: 템플릿 — 위험물과 고정 지형

**Files:** Modify `pieces.ts`, `pieces.test.ts`.
- spec §9 표의 위험물 행과 고정 지형 행(톱니 제자리·왕복, 톱니 밭, 루프 안 빨간 호, 팩맨, 배럴형 바퀴, 원형 배럴, 환풍기, 창, `spikepit` 가시 바닥, 굽은 길, 스마일)을 녹화·위키 PDF를 직접 보고 만든다. tier는 표대로. 영상에서 톱니가 놓인 기존 템플릿에는 톱니를 더한다(tier 유지). 근거 시각·쪽수를 주석에 적는다.
- 설계 기준(spec §9): 시간 위험물은 `V_MAX` 도착 시 한 주기의 절반 이상 통과 가능. 빠른 날 조건(spec §5.2)을 지킨다.
- [ ] **Step 1: 테스트** — 모든 템플릿의 rotate 위험물·길에 대해 ω × rOut × 2π / TURN / SUBSTEPS < WHEEL_R(정수로: `Math.abs(w) * rOut * 25 < WHEEL_R * TURN * SUBSTEPS * 4`처럼 2π를 25/4 이상으로 잡아 보수적으로); tier별 개수·id 목록 갱신; 가시 바닥 막대 양 끝이 구덩이 벽 안쪽(옆 길 선분과 막대가 겹치지 않음).
- [ ] **Step 2~4:** FAIL → 템플릿 작성 → PASS
- [ ] **Step 5:** 스크립트 입력 몇 가지(계속 누름, 착지 전 뗌, 도착 위상 12가지)로 각 새 템플릿을 돌려 통과 비율을 기록(보고서용, 커밋 안 함).
- [ ] **Step 6: Commit** `feat: 네온 라이더 위험물 템플릿과 굽은 길·스마일`

### Task 9: 템플릿 — 움직이는 길과 블록

**Files:** Modify `pieces.ts`, `pieces.test.ts`.
- spec §9 표의 움직이는 길·블록 행(스위치 도로 + 레이저, 일회성 도로 2개, 원숭이 꼬리, 오메가 점프, `spikefloor` 24 m 가시 띠 + 노란 초승달(tier 3), `loop2` 연결 조각, 초록 회전 고리·C자 호, 노란 평지, 넘어지는 블록)을 녹화·위키를 보고 만든다. tier는 표대로.
- [ ] **Step 1: 테스트** — tier별 개수·id 갱신; 빠른 날 조건이 길에도 성립; `loop`·`loop2`의 입출구 색인 간격 테스트 유지.
- [ ] **Step 2~4:** FAIL → 작성 → PASS
- [ ] **Step 5:** Task 8 Step 5와 같은 기록.
- [ ] **Step 6: Commit** `feat: 네온 라이더 움직이는 길·블록 템플릿`

### Task 10: 버전·문서·전체 확인

**Files:** Modify `logic.ts`, `logic.test.ts`, `docs/superpowers/specs/2026-11-23-neon-rider-design.md`, `docs/superpowers/specs/2026-11-23-neon-rider-measurements.md`.
- [ ] **Step 1:** `logic.version` 4, 테스트 갱신.
- [ ] **Step 2:** 본 설계 §2·§5·§6·§7을 현재 모습으로 고치고(변경 기록이 아니라 현재 설명), 측정 문서 M1~M8에 구현 템플릿 id를 적는다.
- [ ] **Step 3:** `npm test`, `npm run test:gate`(전부 건너뜀, 종료 0), `npm run typecheck`, `npm run build` 모두 통과.
- [ ] **Step 4:** 기존 하니스(`/tmp/nr-v2/harness` 또는 `/tmp/nr-game-harness`)로 새 템플릿마다 360×640 장면을 그려 `/tmp/nr-v2/movers.jpg`로 묶고 눈으로 확인한다(커밋 안 함).
- [ ] **Step 5: Commit** `docs: 네온 라이더 움직이는 장애물 반영`

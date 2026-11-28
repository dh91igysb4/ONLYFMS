# 1대1 레이싱 1단계(혼자 달리기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 숨김 대전 게임 `duel-racer`를 등록하고, 관리자가 `/duel/practice/duel-racer`에서 3D 아케이드 차량으로 첫 코스를 혼자 달려 볼 수 있게 한다(손맛·점프·스턴트·니트로·HUD).

**Architecture:** 게임 폴더는 Deno가 읽는 순수 부분(`manifest.ts`·`logic.ts`)과 브라우저 전용 부분(`physics/`·`render/`·`RacerGame.tsx`)으로 나눈다. 물리는 Rapier 3D(WASM)를 고정 60Hz로 돌리고 렌더는 Three.js가 보간해 그린다. 플랫폼에는 "실시간 대전" 표시(`duel.realtime`), 실시간 화면 등록부, 연습 페이지를 더하고, 2단계 전까지 실시간 게임의 대국 만들기를 막는다.

**Tech Stack:** TypeScript, React 18, Three.js 0.187(기존), `@dimforge/rapier3d-compat` 0.21.0(새 의존성), Vitest, Deno(duel Edge Function).

**Spec:** `docs/superpowers/specs/2026-11-28-duel-racer-design.md` (§5 게임 설계, §7 플랫폼 연결, §9 단계 1)

**범위 밖:** 스펙 §9 단계 0(버리는 시험판, 계획 없이 따로 만든다)과 단계 2(온라인 대전, 시험판 결과를 본 뒤 별도 계획). 이 계획의 코드는 네트워크 구조와 무관해야 한다: 차량 물리는 "내 차 하나 + 정적 코스"만 알고, 상대 차 몸체는 2단계가 더한다.

## Global Constraints

- `src/games/duel-racer/manifest.ts`·`logic.ts`는 `src/games/index.ts`를 통해 Deno `duel` 함수에 번들된다. 이 두 파일은 `three`·`@dimforge/rapier3d-compat`·`physics/`·`render/`·React를 import하지 않는다. 상대 import는 `.ts` 확장자를 붙인다(`CLAUDE.md` 로직 버전 규칙).
- Rapier와 Three 레이스 코드는 레이스 화면에서만 동적 `import()`로 불러, 메인 번들에 들어가지 않는다(스펙 §10).
- 숨김 게임으로 시작: manifest `hidden: true`, 마이그레이션에 `game_modes` (false,false,false) 행과 `hidden_games` 행(`CLAUDE.md` 게임 추가 절차).
- 플랫폼 코드에서 게임 id로 분기하지 않는다. 실시간 여부는 manifest `duel.realtime`로만 가른다(스펙 §7).
- PC 전용: 터치 전용 기기에서는 "PC에서만 할 수 있어요"를 띄우고 레이스를 시작하지 않는다(스펙 §5.5).
- 화면 문구는 한국어. 물리 틱은 1/60초 고정(스펙 §5.1, §6.3).
- 단위: 미터·초·라디안. 화면 속도 표시는 km/h(= m/s × 3.6).
- 수치 시작값은 `src/games/duel-racer/constants.ts` 한 곳에 둔다. 아래 표의 값은 조율용 시작값이며, 테스트는 이 상수를 import해 비교한다(숫자를 테스트에 다시 적지 않는다).

| 상수 | 시작값 | 근거 |
|---|---|---|
| `TICK_HZ` | 60 | 스펙 §5.1 |
| `TOP_SPEED` | 50 (m/s, 180km/h) | 원작 녹화 최고속 180km/h |
| `NITRO_SPEED` | 62 (m/s) | 니트로만 최고속을 넘는다(§5.3) |
| `ACCEL_TIME` | 3.0 (s, 0→0.9·TOP_SPEED) | §5.1 "3초 안팎" |
| `CAR_MASS` | 1200 (kg) | |
| `CAR_HALF` | { x: 1.0, y: 0.6, z: 2.2 } (m) | 차 폭 2m |
| `ROAD_MIN_WIDTH` | 10 (m) | §5.4 차 3~4대 폭 |
| `DRIFT_REAR_GRIP` | 0.35 (평소 횡그립 대비) | §5.1 |
| `LANDING_ASSIST_MAX_DEG` | 45 | §5.1 착지 보정 |
| `STUCK_SECONDS` | 3 | §5.4 |
| `FALL_Y` | -30 (m) | 코스 밖 추락 |
| `NITRO_PER_AIR_SEC` | 0.08 | §5.3 |
| `NITRO_PER_FLIP` | 0.15 | §5.3 |
| `NITRO_CLEAN_LANDING` | 0.05 | §5.3 |
| `NITRO_PER_DRIFT_SEC` | 0.04 | §5.3 |
| `NITRO_BURN_PER_SEC` | 0.25 | 가득 찬 게이지 4초 |
| `RACE_SECONDS` | 180 | `duel.realtime.raceSeconds` |

## Review Focus

1. **Rapier WASM이나 WebGL을 못 만드는 브라우저** — 흰 화면 대신 한국어 오류("이 브라우저에서는 레이스를 열 수 없어요")와 나가기 버튼. → Task 8 테스트.
2. **창 포커스를 잃었는데 키가 눌린 채로 남음**(Alt+Tab) — 가속이 계속 눌린 상태가 되면 안 된다. `blur`·`visibilitychange`에서 모든 키를 뗀다. → Task 8 테스트.
3. **탭을 오래 숨겼다 돌아옴**(30초) — 밀린 틱을 몰아서 돌리되(스펙 §6.3) 화면이 얼지 않고 틱 수가 정확해야 한다. → Task 6 테스트(30초 = 1800틱).
4. **차가 코스 밖으로 떨어지거나 물리 값이 NaN** — `FALL_Y` 아래이거나 위치·속도가 유한하지 않으면 마지막 체크포인트로 복귀. → Task 6 테스트.
5. **게임 키가 페이지를 스크롤**(Space·방향키) — 레이스 화면에서 게임 키의 기본 동작을 막는다. → Task 8 테스트.

---

### Task 1: 게임 뼈대 등록

**Files:**
- Create: `src/games/duel-racer/manifest.ts`, `src/games/duel-racer/logic.ts`, `src/games/duel-racer/logic.test.ts`, `src/games/duel-racer/constants.ts`
- Create: `supabase/migrations/<timestamp>_duel_racer.sql` (`npx supabase@2 migration new duel_racer`)
- Modify: `src/games/index.ts` (`duels`에 한 줄), `src/games/types.ts` (`Manifest.duel`에 `realtime` 추가)
- Test: `src/games/registry.test.ts`(기존, 수정 없이 통과해야 함)

**Interfaces:**
- Produces:
  - `Manifest.duel.realtime?: { raceSeconds: number }` — 있으면 실시간 대전. 실시간 게임은 `turnSeconds`를 쓰지 않지만 타입 호환을 위해 `{ choices: [RACE_SECONDS], default: RACE_SECONDS }`로 채운다.
  - `logic: DuelLogic<RacerState, never, RacerState>`, `RacerState = { course: string }`. 2단계가 `report` 판정으로 바꾼다.
  - `constants.ts`의 상수 전부(위 표). `COURSE_IDS = ['neon-1'] as const`.

- [ ] **Step 1: 실패하는 테스트 작성** — `logic.test.ts`

```ts
test('init picks the first course', () => {
  expect(logic.init(() => 0, {})).toEqual({ course: 'neon-1' })
})
test('turn-based actions are refused', () => {
  const s = logic.init(() => 0, {})
  expect(logic.apply(s, 0, {} as never, () => 0)).toEqual({ error: 'realtime_only' })
  expect(logic.result(s)).toEqual({ over: false })
})
test('manifest marks a hidden realtime duel', () => {
  expect(manifest.category).toBe('duel')
  expect(manifest.hidden).toBe(true)
  expect(manifest.duel?.realtime).toEqual({ raceSeconds: RACE_SECONDS })
  expect(manifest.duel?.sameScreen).toBe(false)
  expect(manifest.modes).toEqual({ daily: false, contest: false, free: false })
})
```

- [ ] **Step 2: 실행해서 실패 확인** — `npx vitest run src/games/duel-racer/logic.test.ts` → FAIL(모듈 없음)
- [ ] **Step 3: 구현** — `constants.ts`(표 값), `manifest.ts`(`id: 'duel-racer'`, `name: '레이싱'`(이름 미정, 사용자가 정하면 바꾼다), `options: []`, `puzzleSource: 'generate'`, `dailyTimeLimitSec: null`), `logic.ts`(`version: 1`, `toMove` 0, `timeoutAction`은 `{} as never`, `turnNo` 0, `view`는 상태 그대로). `types.ts`에 `realtime` 필드와 주석. `index.ts` `duels`에 등록. 마이그레이션:

```sql
-- 1대1 레이싱(duel-racer). 솔로 모드는 모두 끔. 숨김으로 시작한다(관리자 확인 뒤 새 마이그레이션으로 공개).
insert into game_modes (game_id, daily, contest, free) values ('duel-racer', false, false, false);
insert into hidden_games (game_id) values ('duel-racer');
```

- [ ] **Step 4: 테스트 통과 확인** — `npx vitest run src/games/duel-racer src/games/registry.test.ts` → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(duel-racer): 숨김 실시간 대전 게임 뼈대 등록"`

---

### Task 2: 플랫폼 — 실시간 화면 등록부, 연습 페이지, 대국 만들기 막기

**Files:**
- Modify: `src/games/ui.ts` (`RealtimeGameProps`, `getRealtimeComponent`)
- Create: `src/platform/duel/DuelPracticePage.tsx`, `src/platform/duel/DuelPracticePage.test.tsx`, `src/platform/duel/pcOnly.ts`, `src/platform/duel/pcOnly.test.ts`
- Modify: `src/app/routes.tsx` (`/duel/practice/:game`, `/duel/:id`보다 먼저)
- Modify: `src/platform/duel/DuelHomePage.tsx`, `src/platform/duel/DuelHomePage.test.tsx`
- Modify: `supabase/functions/duel/handler.ts`, `supabase/functions/duel/handler.test.ts`
- Modify: `src/test-fixtures/duel.ts` (실시간 숨김 대전 픽스처 `withRealtimeDuel`, id `realtime-duel`)

**Interfaces:**
- Consumes: `Manifest.duel.realtime`(Task 1)
- Produces:
  - `export type RealtimeGameProps = { gameId: string; mode: 'practice'; onExit(): void }` (2단계가 `'match'` 모드를 더한다)
  - `getRealtimeComponent(id: string): ComponentType<RealtimeGameProps> | undefined` — 등록부 `realtimeComponents`. 이 태스크에서는 비어 있고 Task 8이 `duel-racer`를 등록한다.
  - `isPcCapable(env?: { coarse: boolean; fine: boolean }): boolean` — `matchMedia('(pointer: fine)')` 또는 `(any-pointer: fine)`이 참이면 true. 인자로 테스트 주입.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `pcOnly.test.ts`: `isPcCapable({ coarse: true, fine: false })` → false, `{ coarse: false, fine: true }` → true, `{ coarse: true, fine: true }`(터치 노트북) → true.
  - `DuelPracticePage.test.tsx`(픽스처 `withRealtimeDuel` + 화면 등록부를 `vi.mock`으로 가짜 컴포넌트 `<p>race</p>`):
    - 관리자 + PC → 가짜 컴포넌트가 보인다.
    - 관리자 아님 + 숨김 → "없는 게임" 문구(DuelLocalPage와 같은 문구), 컴포넌트 없음.
    - 터치 전용 → "PC에서만 할 수 있어요" 문구, 컴포넌트 없음.
    - `realtime`이 없는 대전(요트) 주소 → "없는 게임".
  - `DuelHomePage.test.tsx`:
    - 관리자에게 "혼자 연습" 패널이 보이고 `/duel/practice/realtime-duel` 링크가 있다.
    - 대국 만들기 게임 선택 목록에 실시간 게임이 없다.
  - `handler.test.ts`: 실시간 게임으로 `create` → 409 `realtime_unsupported`(관리자여도).
- [ ] **Step 2: 실행해서 실패 확인** — `npx vitest run src/platform/duel` → FAIL, `npm run fn:test` → 새 시험 FAIL
- [ ] **Step 3: 구현**
  - `DuelPracticePage`: `getDuel` → 숨김이면 관리자만 → `duel.realtime` 없으면 없는 게임 → `isPcCapable()` 거짓이면 PC 안내 → `getRealtimeComponent(game)`를 `mode="practice"`, `onExit`은 `/duel`로 이동. `useGameScreen(true)`(기존 훅)로 전체 화면 레이아웃.
  - `DuelHomePage`: 같은 화면 패널 옆에 `visible.filter((m) => m.duel?.realtime)` "혼자 연습" 패널(문구 "기록은 남지 않아요"). `CreateForm`에 넘기는 목록에서 실시간 게임을 뺀다.
  - `handler.ts` `create`: `game` 찾은 직후 `if (game.manifest.duel?.realtime) return err(409, 'realtime_unsupported')` — 2단계에서 지운다는 주석.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/platform/duel src/games` → PASS, `npm run fn:test` → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(duel): 실시간 대전 연습 페이지와 대국 만들기 막기"`

---

### Task 3: 코스 데이터와 도로 메시

**Files:**
- Create: `src/games/duel-racer/course/types.ts`, `src/games/duel-racer/course/neon1.ts`, `src/games/duel-racer/course/road.ts`, `src/games/duel-racer/course/course.test.ts`, `src/games/duel-racer/course/index.ts`

**Interfaces:**
- Produces:
  - `type Vec3 = { x: number; y: number; z: number }`
  - `type Course = { id: string; centerline: Vec3[] /* 2~6m 간격, 출발→도착 */; width: number[] /* 점마다 */; bank: number[] /* 점마다 롤(rad) */; boxes: CourseBox[]; checkpoints: number[] /* centerline 인덱스, 오름차순 */; finish: number /* 인덱스 */; start: { pos: Vec3; yaw: number } }`
  - `type CourseBox = { kind: 'ramp' | 'platform' | 'shortcut'; center: Vec3; half: Vec3; rot: { pitch: number; yaw: number; roll: number } }` — 점프대는 기울인 상자, 지름길은 `shortcut`(헤어핀 안쪽을 건너뛰는 점프대·착지대).
  - `buildRoad(course: Course): { positions: Float32Array; indices: Uint32Array; walls: { positions: Float32Array; indices: Uint32Array } }` — 도로 면과 양쪽 벽(높이 1.2m) 삼각형. 물리(트라이메시)와 렌더가 함께 쓴다.
  - `arcLength(course): number[]`(인덱스별 누적 거리), `progressAt(course, pos: Vec3, hint: number): { index: number; s: number }` — `hint` 근처(±40점)에서 가장 가까운 중심선 점. 그 점까지 거리가 그 점 도로 폭보다 멀면(지름길 착지 등) 중심선 전체에서 다시 찾는다.
  - `getCourse(id: string): Course`

- [ ] **Step 1: 실패하는 테스트 작성** — `course.test.ts`

```ts
const c = getCourse('neon-1')
test('road is wide enough for side-by-side contact', () => {
  for (const w of c.width) expect(w).toBeGreaterThanOrEqual(ROAD_MIN_WIDTH)
})
test('race length fits 70–90 s at 85% of top speed', () => {
  const len = arcLength(c).at(-1)!
  expect(len / (TOP_SPEED * 0.85)).toBeGreaterThanOrEqual(70)
  expect(len / (TOP_SPEED * 0.85)).toBeLessThanOrEqual(90)
})
test('has jumps and a shortcut', () => {
  expect(c.boxes.filter((b) => b.kind === 'ramp').length).toBeGreaterThanOrEqual(3)
  expect(c.boxes.filter((b) => b.kind === 'shortcut').length).toBeGreaterThanOrEqual(1)
})
test('checkpoints are ordered and end before finish', () => { /* 오름차순, 마지막 < finish, 간격 ≤ 400m */ })
test('buildRoad makes a closed strip with 2 triangles per segment', () => { /* indices.length === (n-1)*6, 모든 값 유한 */ })
test('progressAt finds the nearest index near the hint', () => { /* 중심선 점 k 위 2m → index k */ })
test('progressAt falls back to a global search far from the hint', () => { /* hint 0, 위치는 점 k(k > 200) 위 → index k */ })
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/duel-racer/course` → FAIL
- [ ] **Step 3: 구현** — `neon1.ts`는 손으로 만든 제어점(직선·곡선·헤어핀 1개, 높낮이 포함)을 Catmull-Rom으로 촘촘히 펴서 `centerline`을 만든다. 점프대 3개 이상(긴 직선 끝, 언덕 정상, 헤어핀 앞), 헤어핀 안쪽을 건너는 지름길 1개(점프대 + 착지대 `shortcut` 상자 2개). 넓은 직선 구간은 폭 14m, 나머지 10~12m.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(duel-racer): 첫 코스 neon-1과 도로 메시"`

---

### Task 4: 물리 세계와 아케이드 차량

**Files:**
- Modify: `package.json`(`npm i @dimforge/rapier3d-compat@0.21.0`)
- Create: `src/games/duel-racer/physics/rapier.ts`, `src/games/duel-racer/physics/world.ts`, `src/games/duel-racer/physics/car.ts`, `src/games/duel-racer/physics/controls.ts`, `src/games/duel-racer/physics/car.test.ts`, `src/games/duel-racer/course/testCourses.ts`

**Interfaces:**
- Consumes: `Course`, `buildRoad`, `getCourse`(Task 3), 상수(Task 1)
- Produces:
  - `type Controls = { throttle: number /* 0..1 */; brake: number /* 0..1 */; steer: number /* -1(왼)..1(오) */; handbrake: boolean; nitro: boolean; pitch: number; roll: number; yaw: number /* 공중 회전 -1..1 */ }`, `NO_CONTROLS`
  - `loadRapier(): Promise<typeof import('@dimforge/rapier3d-compat')>` — `init()`을 한 번만.
  - `createWorld(R, course: Course): PhysWorld` — 중력 -9.81, 도로·벽 트라이메시, 상자 콜라이더.
  - `createCar(w: PhysWorld, pose: { pos: Vec3; yaw: number }): Car`
  - `stepCar(car: Car, c: Controls, boost: boolean, dt: number): void` — Rapier 스텝 전에 힘을 건다. `boost`는 니트로 분사 중(Task 5가 정한다).
  - `carState(car: Car): CarState` — `{ pos: Vec3; quat: {x,y,z,w}; vel: Vec3; angVel: Vec3; speed: number /* 전진 성분 m/s */; grounded: boolean /* 바퀴 4개 중 2개 이상 접지 */; slipDeg: number /* 진행 방향과 차 앞 방향 각 */; up: Vec3 }`
  - `resetCar(car: Car, pose): void`
  - 테스트 코스 `flatCourse()`(1km 직선 평지, 폭 30m), `rampCourse()`(평지 + 점프대 하나 + 착지 평지)

- [ ] **Step 1: 실패하는 테스트 작성** — `car.test.ts`. 헬퍼 `run(car, world, controls, seconds)`는 1/60초씩 `stepCar` + `world.step()`.

```ts
test('reaches 90% of top speed within ACCEL_TIME', async () => { /* 전진 가속만 → ACCEL_TIME+0.5초 안에 speed ≥ 0.9·TOP_SPEED */ })
test('never exceeds TOP_SPEED without boost', async () => { /* 10초 가속 → speed ≤ TOP_SPEED·1.02 */ })
test('boost exceeds TOP_SPEED up to NITRO_SPEED', async () => { /* boost 5초 → TOP_SPEED < speed ≤ NITRO_SPEED·1.02 */ })
test('steering responds on the next tick', async () => { /* 30m/s에서 steer=1 한 틱 → angVel.y 부호가 오른쪽 회전 */ })
test('handbrake drifts and recovers', async () => { /* 40m/s, steer=1+handbrake 1초 → slipDeg > 15; 놓고 1초 → slipDeg < 5 */ })
test('does not roll over at full steer and top speed', async () => { /* 3초간 up.y > 0.7 유지 */ })
test('air controls rotate the car while airborne', async () => { /* rampCourse 점프 중 pitch=1 → 공중에서 피치 각속도 > 0 */ })
test('landing assist rights a tilted car', async () => { /* 30° 롤로 낙하 착지 → 0.5초 안 up.y > 0.95 */ })
test('no assist beyond LANDING_ASSIST_MAX_DEG', async () => { /* 120° 롤 착지 → 보정 없음(up.y < 0.5) */ })
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/duel-racer/physics` → FAIL
- [ ] **Step 3: 구현** — `DynamicRayCastVehicleController`(바퀴 4개, 서스펜션 레이) 위에 아케이드 보정:
  - 엔진 힘은 `TOP_SPEED`까지 `ACCEL_TIME`을 맞추는 곡선(속도가 오를수록 감소), 그 위로는 0. `boost` 중에는 `NITRO_SPEED`까지.
  - 조향각은 속도에 따라 줄인다(고속 안정). 횡그립은 컨트롤러 마찰 + 보정 횡력.
  - 핸드브레이크: 뒷바퀴 측면 마찰을 `DRIFT_REAR_GRIP`배로, 놓으면 0.3초에 걸쳐 복귀.
  - 무게중심을 차체 아래로 내리고, 지상에서는 롤 각속도를 감쇠.
  - 공중: `pitch/roll/yaw` 입력을 토크로. 접지 순간 `up`과 수직 사이 각이 `LANDING_ASSIST_MAX_DEG` 이하면 0.3초 동안 자세를 바로 세우는 토크.
- [ ] **Step 4: 통과 확인** → PASS. 각 테스트 수치가 맞지 않으면 테스트가 아니라 보정 계수를 고친다(상수 표 값은 시작값).
- [ ] **Step 5: 커밋** — `git commit -m "feat(duel-racer): Rapier 물리 세계와 아케이드 차량"`

---

### Task 5: 스턴트 판정과 니트로 게이지 (순수)

**Files:**
- Create: `src/games/duel-racer/stunt.ts`, `src/games/duel-racer/nitro.ts`, `src/games/duel-racer/stunt.test.ts`, `src/games/duel-racer/nitro.test.ts`

**Interfaces:**
- Consumes: `CarState`의 `grounded`, `angVel`, `quat`, `up`(Task 4) — 순수 함수라 필요한 값만 받는다.
- Produces:
  - `type AirTrack = { airborne: boolean; airTime: number; pitchAcc: number; rollAcc: number }`, `AIR_IDLE`
  - `trackAir(t: AirTrack, s: { grounded: boolean; localAngVel: Vec3; upY: number }, dt: number): { track: AirTrack; landed: null | { airTime: number; flips: number; clean: boolean } }` — 피치·롤 각각 누적 각의 절댓값 2π마다 1회전. 착지 때 `upY > cos(LANDING_ASSIST_MAX_DEG)`면 `clean`. 체공 0.3초 미만은 착지 사건 없음(턱 넘기 무시).
  - `type Nitro = { gauge: number /* 0..1 */; burning: boolean }`, `NITRO_START = { gauge: 0.3, burning: false }`
  - `stepNitro(n: Nitro, e: { want: boolean; airborne: boolean; drifting: boolean; landed: null | { airTime: number; flips: number; clean: boolean } }, dt: number): Nitro` — 쌓기: 체공 중 `NITRO_PER_AIR_SEC·dt`, 드리프트 중 `NITRO_PER_DRIFT_SEC·dt`, 착지 때 `flips·NITRO_PER_FLIP` + (clean이면 `NITRO_CLEAN_LANDING`). 쓰기: `want && gauge > 0`이면 `burning`, `gauge -= NITRO_BURN_PER_SEC·dt`. 0..1로 자른다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('one full pitch rotation counts one flip', () => { /* 2π+0.1 누적 후 착지 → flips 1 */ })
test('350 degrees is not a flip', () => { /* flips 0 */ })
test('pitch and roll flips add', () => { /* 각 1회전 → flips 2 */ })
test('short hops are ignored', () => { /* 체공 0.2초 → landed null */ })
test('clean landing needs upright car', () => { /* upY 0.95 → clean, upY 0.3 → not clean */ })
test('airtime, flips and clean landing fill the gauge', () => { /* 1초 체공 + 1회전 + clean → 0.3 + 0.08 + 0.15 + 0.05 */ })
test('burning drains at NITRO_BURN_PER_SEC and stops at empty', () => { /* gauge 0.1에서 1초 → 0, burning false */ })
test('gauge never exceeds 1', () => {})
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 위 시그니처대로.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(duel-racer): 스턴트 판정과 니트로 게이지"`

---

### Task 6: 레이스 세션 (고정 틱·체크포인트·복귀·도착)

**Files:**
- Create: `src/games/duel-racer/race.ts`, `src/games/duel-racer/race.test.ts`

**Interfaces:**
- Consumes: `loadRapier`, `createWorld`, `createCar`, `stepCar`, `carState`, `resetCar`, `Controls`(Task 4), `trackAir`, `stepNitro`(Task 5), `getCourse`, `progressAt`, `arcLength`(Task 3)
- Produces:
  - `createRace(R, courseId: string): Race`
  - `advance(race: Race, ms: number, controls: Controls): void` — 누적기에 더하고 1/60초마다 한 틱. 출발 전 카운트다운(`COUNTDOWN_TICKS = 180`) 동안은 차를 묶어 둔다. 틱마다: 니트로 → `stepCar` → `world.step()` → 스턴트 → 진행도 → 복귀 검사 → 도착 검사.
  - `requestReset(race: Race): void` — R 키. 다음 틱에 마지막 통과 체크포인트로.
  - `snapshot(race: Race): RaceSnapshot` — `{ tick: number /* 출발 뒤 틱, 카운트다운 중 음수 */; countdown: number | null /* 3,2,1 */; car: CarState; nitro: Nitro; progress: number /* 0..1 */; finishTicks: number | null; lastLanding: null | { flips: number; clean: boolean; tick: number } }`
  - `disposeRace(race: Race): void`

- [ ] **Step 1: 실패하는 테스트 작성** — 테스트용으로 `createRace`가 `Course` 객체도 받게 한다(`createRace(R, flatCourse())`).

```ts
test('tick count does not depend on frame chunking', async () => { /* advance 3×(1000/60) vs 1×50ms → 같은 tick */ })
test('car is held during countdown', async () => { /* 2초 가속 입력 → speed < 0.5, countdown 3→2→1 */ })
test('finishes a straight course and records finishTicks', async () => { /* flatCourse(finish 600m) 가속만 → finishTicks가 정수, 이후 tick 증가 없음 */ })
test('falling below FALL_Y respawns at last checkpoint', async () => {})
test('non-finite pose respawns', async () => { /* 차 속도를 NaN으로 → 다음 틱 복귀, 값 유한 */ })
test('stuck for STUCK_SECONDS respawns', async () => { /* 뒤집힌 채 정지 3초 → 복귀 */ })
test('requestReset returns to last checkpoint on next tick', async () => {})
test('30 s hidden tab catches up exactly', async () => { /* advance(30000) → tick 증가 1800, 호출 1회에 끝남 */ })
test('nitro fills from a jump in a race', async () => { /* rampCourse에서 점프 착지 → gauge > NITRO_START.gauge */ })
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 위 순서. 도착 뒤에는 `advance`가 차를 서서히 멈추게만 하고 틱을 세지 않는다. 진행도는 `progressAt`에 직전 인덱스를 `hint`로 준다(지름길로 멀리 건너뛰면 Task 3의 전체 검색이 잡는다). 체크포인트는 인덱스가 그 값을 지날 때만 갱신하고 뒤로는 줄지 않는다.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(duel-racer): 레이스 세션(고정 틱·복귀·도착)"`

---

### Task 7: 3D 장면

**Files:**
- Create: `src/games/duel-racer/render/scene.ts`, `src/games/duel-racer/render/camera.ts`, `src/games/duel-racer/render/camera.test.ts`, `src/games/duel-racer/render/city.ts`, `src/games/duel-racer/render/city.test.ts`

**Interfaces:**
- Consumes: `Course`, `buildRoad`(Task 3), `RaceSnapshot`(Task 6)
- Produces:
  - `chaseCamera(prev: CamPose | null, car: { pos: Vec3; quat; vel: Vec3 }, dt: number): CamPose` — `CamPose = { pos: Vec3; look: Vec3; fov: number }`. 차 뒤 7m·위 2.8m, 위치는 지수 평활(시정수 0.12초), 차가 공중에서 돌아도 카메라는 수평 유지(차 yaw만 따름), 속도에 따라 fov 65°→78°.
  - `cityBlocks(course: Course, seed: number): { center: Vec3; half: Vec3; glow: string }[]` — 도로에서 `width/2 + 6m` 밖에만 건물 상자. 결정적.
  - `createScene(canvas: HTMLCanvasElement, course: Course): Scene` — `{ draw(snap: RaceSnapshot, alpha: number): void; resize(w: number, h: number, dpr: number): void; dispose(): void }`. WebGL을 못 만들면 `Error('webgl')`를 던진다. 차는 상자 몸체 + 바퀴 4개 + 차 밑 네온 조명, `nitro.burning`이면 뒤 불꽃. 픽셀 비율 상한 2(볼 런 `MAX_DPR`과 같음).

- [ ] **Step 1: 실패하는 테스트 작성**
  - `camera.test.ts`: 정지한 차 뒤 7m·위 2.8m에 수렴, 차가 롤 180°여도 카메라 위쪽은 +y, 속도 0→50m/s에서 fov가 65→78로 단조 증가.
  - `city.test.ts`: 같은 seed → 같은 결과, 어떤 건물도 도로 중심선에서 `width/2 + 6` 안에 들어오지 않음.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `scene.ts`는 테스트하지 않는 얇은 그리기 계층(볼 런 `render/scene.ts` 구조를 따른다). 네온 밤 분위기: 어두운 배경, 건물 상자에 발광 띠, 도로 가장자리 노란·검정 경계.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(duel-racer): 추격 카메라와 네온 도시 장면"`

---

### Task 8: 연습 화면 (입력·HUD·카운트다운·결과) 등록

**Files:**
- Create: `src/games/duel-racer/input.ts`, `src/games/duel-racer/input.test.ts`, `src/games/duel-racer/RacerGame.tsx`, `src/games/duel-racer/RacerGame.test.tsx`, `src/games/duel-racer/racer.css`
- Modify: `src/games/ui.ts` (`realtimeComponents`에 `'duel-racer': RacerGame`)

**Interfaces:**
- Consumes: `RealtimeGameProps`, `getRealtimeComponent`(Task 2), `createRace`/`advance`/`snapshot`/`requestReset`/`disposeRace`(Task 6), `createScene`(Task 7), `Controls`(Task 4)
- Produces:
  - `GAME_KEYS: Set<string>`(`KeyboardEvent.code`), `controlsFrom(down: ReadonlySet<string>, airborne: boolean): Controls` — 키 배치(스펙 §5.5): `ArrowUp/KeyW` 가속, `ArrowDown/KeyS` 브레이크, `ArrowLeft/KeyA`·`ArrowRight/KeyD` 조향, `Space` 핸드브레이크, `ShiftLeft/ShiftRight` 니트로. 공중에서는 위·아래가 `pitch`, 왼·오가 `roll`(조향 0), `KeyQ/KeyE`가 `yaw`. `KeyR` 복귀, `Escape` 나가기는 `controlsFrom`이 아니라 화면이 처리.
  - `RacerGame: ComponentType<RealtimeGameProps>` — 마운트 때 `Promise.all([import('./race.ts'), import('./render/scene.ts'), import('./physics/rapier.ts')])`로 동적 로드.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `input.test.ts`: 지상 `ArrowUp` → throttle 1·pitch 0, 공중 `ArrowUp` → throttle 1·pitch 1, 공중 `ArrowLeft` → steer 0·roll -1, `KeyA`+`KeyD` 동시 → steer 0, `ShiftLeft` → nitro true.
  - `RacerGame.test.tsx`(`race.ts`·`render/scene.ts`·`physics/rapier.ts`를 `vi.mock`, 스냅숏을 테스트가 정함):
    - 불러오는 동안 "불러오는 중…", 로드 뒤 카운트다운 "3".
    - HUD: 스냅숏 `car.speed = 50` → "180" km/h, 니트로 `gauge 0.6` → 5칸 중 3칸 채움, 경과 시간 `tick 3600` → "01:00.00".
    - `finishTicks = 4260` → 결과 화면 "01:11.00", "다시 달리기" 누르면 새 레이스, 세션 최고 기록 표시.
    - `createScene`이 `Error('webgl')`를 던지거나 Rapier 로드가 실패하면 "이 브라우저에서는 레이스를 열 수 없어요" + 나가기 버튼(Review Focus 1).
    - `keydown ArrowUp` 뒤 `window` `blur` → 다음 `advance` 호출의 controls.throttle이 0(Review Focus 2).
    - 게임 키 `keydown`의 `defaultPrevented`가 true, 게임 키가 아닌 키는 false(Review Focus 5).
    - `Escape` → `onExit` 호출, `KeyR` → `requestReset` 호출.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `requestAnimationFrame` 루프에서 경과 ms로 `advance`, `scene.draw(snapshot, alpha)`. HUD(오른쪽 아래 속도·니트로 5칸, 오른쪽 위 시간, 왼쪽 세로 진행 막대, 착지 때 "1회전 · 깔끔한 착지" 같은 짧은 알림)는 React로 스냅숏을 4~10Hz로 갱신해 그린다(매 프레임 setState 금지). 언마운트 때 `disposeRace`·`scene.dispose`·리스너 해제. 시간 형식 `mm:ss.cc`.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/duel-racer src/platform/duel` → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(duel-racer): 연습 화면과 HUD"`

---

### Task 9: 전체 확인과 번들 분리 검증

**Files:** 없음(확인만). 문제가 있으면 해당 태스크 파일을 고친다.

- [ ] **Step 1:** `npm test && npm run typecheck && npm run fn:test` → 모두 PASS
- [ ] **Step 2:** `npm run build` → 성공. `grep -l "rapier" dist/assets/index-*.js`가 아무것도 출력하지 않는다(메인 번들에 Rapier 없음). Rapier는 별도 청크에 있다.
- [ ] **Step 3:** Deno 번들 확인 — `npm run fn:test`가 `duel` 함수를 import해 통과하면 `logic.ts`가 브라우저 전용 모듈을 끌어오지 않은 것이다. 추가로 `grep -rn "three\|rapier\|physics/\|render/" src/games/duel-racer/logic.ts src/games/duel-racer/manifest.ts`가 아무것도 출력하지 않는다.
- [ ] **Step 4:** 수동 확인(관리자 계정, 로컬 `npm run dev`): `/duel` → "혼자 연습" → 카운트다운 → 첫 코스 완주, 점프·1회전·니트로가 동작, R 복귀, Esc 나가기, 폰 크기 터치 에뮬레이션에서 "PC에서만 할 수 있어요".
- [ ] **Step 5:** `CLAUDE.md` "대전(1대1) 게임" 단락에 실시간 대전 한 단락 추가(manifest `duel.realtime`, `getRealtimeComponent`, `/duel/practice/:game`, 2단계 전까지 `create`가 `realtime_unsupported`), 커밋 `docs: 실시간 대전 규칙 추가`.

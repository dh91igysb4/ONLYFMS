# 부드러운 경계 1단계 (물가·물체 발밑) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 물가를 둥글게 그리고, 걷기 판정을 그린 물가선과 물체의 발밑 사각형에 맞춘다.

**Architecture:**
- 순수 모듈 `shore.ts`가 칸 데이터에서 매끄러운 물 정도 값(3차 B-스플라인, 칸 심지 보장)과 물체 발밑 사각형을 계산한다.
- 걷기(`walk.ts`), 그리기(`scene.ts`), 서 있는 칸(`map.ts`의 `standTile`)이 모두 이 값을 쓴다.
- 바탕 땅 분류(`Ground`)는 `scene.ts`에서 순수 모듈 `ground.ts`로 옮겨서 그리기와 걷기가 같은 분류를 쓴다.

**Tech Stack:** TypeScript, Vitest, Canvas 2D (`rect` = fillRect 기반).

**Spec:** `docs/superpowers/specs/2026-11-26-smooth-shore-design.md`

## Global Constraints
- 화면과 손맛만 바뀐다. `logic.ts`, `world` 함수, DB, `logic.version`은 바꾸지 않는다. 배포는 Vercel만 한다.
- `map.ts`는 서버 번들(`isle.ts` 경유)에 들어간다. 따라서 `map.ts`는 `shore.ts`, `ground.ts`, `sprites.ts`를 import하지 않는다. `shore.ts`와 `ground.ts`는 `map.ts`를 import해도 된다.
- 상대 import에는 `.ts` 확장자를 붙인다. 외부 의존을 더하지 않는다.
- 상수 값:
  - `SHORE_LINE` 0.5, `SHORE_BLOCK` 0.5, `WET_BAND` 0.56, `FOAM_BAND` 0.53, `SAND_BAND` 0.16
  - `CORE_R` 5px, `LAND_CORE_MAX` 0.45, `WATER_CORE_MIN` 0.55
- 매끄럽게 할 땅: `sand`, `grass`, `flower`, `path`, `snow`, `cave-floor`, `cave-mouth`
- 걸을 수 있는 젖은 칸(`WALKWET`): `pier`, `bridge`, `dock`, `boardwalk`, `deck`
- 고정 칸(매끄럽게 하지 않음): `hull`, `mast`, `falls`, `mud`, `ice`. 자기와 3×3 이웃 안에 `mud`나 `ice`가 있는 칸도 고정 칸이다.
- 물체 발밑(칸 안 px, 양 끝 포함):

  | 물체 | 발밑 |
  |---|---|
  | `tree` | x4–12, y3–10 |
  | `palm` | x5–12, y4–10 |
  | `deadtree` | x3–11, y2–8 |
  | `snowpine` | x5–10, y4–8 |
  | `reed` | x2–12, y4–9 |
  | `mast` | x3–11, y2–6. 단 `mast`는 고정 칸이라 칸 판정이 이긴다. 표에는 그림 기준으로만 둔다 |
  | `rock` | x1–14, y6–14 |
  | `bench` | x1–14, y6–14 |
  | `deco` | 그 칸 prop 스프라이트의 불투명 바깥 사각형. 위를 잘라 높이 최대 8px. prop이 없으면 칸 전체 |
  | `fence` 가로 | x0–15, y10–14 |
  | `fence` 세로 | x5–11, y0–15. 세로 판정은 `drawFence`와 같다(좌우에 울타리가 없고 위나 아래에 있음) |

- 캔버스 내부 색은 낚시 캔버스 예외에 든다. 새 색을 만들지 않고 기존 `C`의 색과 스프라이트 픽셀만 쓴다.

## Review Focus
1. **옛 저장 위치가 새 판정에서 막히는 경우.** 오목한 물가가 땅 칸을 파고들어서 생긴다. 마을로 튕기지 말고 그 칸(또는 `standTile`) 가운데에서 시작해야 한다. → Task 4의 `position` 시험.
2. **물때가 바뀌어 발밑이 물이 될 때.** 갇히지 않고 `standTile` 가운데로 옮겨져야 한다. → Task 4의 Game 호출부 변경과 기존 시험.
3. **물 위 바위, 늪 속 갈대·고사목**(땅이 물인 물체 칸). 발밑 바깥도 물로 그려지는 곳은 막혀야 한다. → Task 3의 `늪 갈대 칸` 시험.
4. **잠긴 문, 순간이동기 칸이 매끄러운 땅 칸 위에 있을 때.** 물 정도 값과 상관없이 막혀야 한다. → Task 3의 `잠긴 문` 시험.
5. **맵 가장자리 칸의 보간.** 맵 밖 칸 값은 가장 가까운 안쪽 칸 값을 쓴다. 가장자리 출구 칸에 설 수 있어야 한다. → Task 3의 모든 칸 시험(출구 도착 칸 포함)과 Task 2의 `가장자리` 시험.

---

### Task 1: 바탕 땅 분류를 `ground.ts`로 옮기기

**Files:**
- Create: `src/games/fishing/ground.ts`, `src/games/fishing/ground.test.ts`
- Modify: `src/games/fishing/scene.ts`. 237–300줄의 `Ground`, `WATER_GROUND`, `baseGround`, `ON_NEIGHBOUR_GROUND`, `rockGround`, `tallGround`, `computeGround`를 옮긴다.

**Interfaces:**
- Produces:
  - `export type Ground = 'water' | 'sand' | 'grass' | 'cave' | 'snow'`
  - `export const WATER_GROUND: ReadonlySet<TileKind>`
  - `export const ON_NEIGHBOUR_GROUND: ReadonlySet<TileKind>`
  - `export function computeGround(map: MapDef, tide: Tide): (Ground | null)[]` (행 우선)
  - `scene.ts`는 이것들을 import해서 쓴다. 동작은 바뀌지 않는다.

- [ ] **Step 1: 실패하는 시험 작성** — `ground.test.ts`
```ts
it('물 위 바위는 물, 풀밭 바위는 풀, 부두는 물, 절벽은 null', () => {
  const m = defineMap(TMP_FLAT, ['~~~,,', '~o~,o', '~#~,c'], {/* 기존 테스트의 최소 opts */})
  const g = computeGround(m, 'high'), at = (x: number, y: number) => g[y * m.w + x]
  expect(at(1, 1)).toBe('water'); expect(at(4, 1)).toBe('grass'); expect(at(1, 2)).toBe('water'); expect(at(4, 2)).toBeNull()
})
```
(`defineMap`의 필수 opts는 `map.test.ts`에 있는 최소 맵 예를 따른다.)

- [ ] **Step 2: 실행해서 실패 확인** — `npx vitest run src/games/fishing/ground.test.ts` → 모듈이 없어서 FAIL.
- [ ] **Step 3: 옮기기.** 코드를 그대로 옮기고 `scene.ts`에서는 import로 바꾼다.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/fishing/` → 전부 PASS(scene 시험 포함).
- [ ] **Step 5: 커밋** — `chore: 낚시 바탕 땅 분류를 ground.ts로`

---

### Task 2: `shore.ts` — 물 정도 값, 칸 종류, 발밑, 칸별 값표

**Files:**
- Create: `src/games/fishing/shore.ts`, `src/games/fishing/shore.test.ts`

**Interfaces:**
- Consumes:
  - `computeGround`, `Ground` (Task 1)
  - `tileAt`, `TILE`, `MapDef`, `Rect`, `TileKind` (`map.ts`)
  - `SPRITES` (`sprites.ts`, deco 발밑용)
- Produces:
  - 상수: `SHORE_LINE`, `SHORE_BLOCK`, `WET_BAND`, `FOAM_BAND`, `SAND_BAND`(값은 Global Constraints)
  - `export type ShoreClass = 'water' | 'land' | 'walkwet' | 'fixed'`
  - `export type ShoreField = { map: MapDef; tide: Tide; ground: readonly (Ground | null)[]; cls: readonly ShoreClass[]; val: Float32Array /* 칸 값 0·1, walkwet은 0 */ }`
  - `export function shoreField(map: MapDef, tide: Tide): ShoreField`
    - `WeakMap<MapDef, Map<Tide, ShoreField>>`로 캐시한다.
    - 물때가 없는 맵은 tide를 `'high'`로 본다.
  - `export function shoreClassAt(f: ShoreField, tx: number, ty: number): ShoreClass`. 맵 밖은 `'fixed'`.
  - `export function wetness(f: ShoreField, x: number, y: number): number`(월드 px)
  - `export function shoreBands(f: ShoreField, tx: number, ty: number): Float32Array | null`
    - 그 칸 256픽셀(행 우선, 픽셀 중심 x+0.5)의 `wetness`를 돌려준다.
    - 칸이 고정·walkwet이면 null을 돌려준다.
    - 모든 픽셀이 칸의 기본 띠와 같아도 null이다. 땅 칸이면 모두 `< SAND_BAND`, 물 칸이면 모두 `>= WET_BAND`.
  - `export function footprintAt(f: ShoreField, tx: number, ty: number): Rect | null`
    - 칸 안 px 사각형 `{tx: x0, ty: y0, w, h}`를 돌려준다. `Rect`를 px 단위로 재사용한다.
    - 물체 칸이 아니면 null이다.

**분류 규칙(스펙 4.1):**
- `cls`:
  - 고정 칸(Global Constraints) → `'fixed'`
  - `WALKWET` → `'walkwet'`
  - 그리기 땅이 `'water'` → `'water'`. 물 위 바위, 늪 갈대도 여기에 든다.
  - 그리기 땅이 null인 칸(절벽, 동굴 벽) → `'fixed'`(값 0). 걷기와 그리기를 칸 규칙 그대로 둔다.
  - 나머지 → `'land'`. 건물·실내 벽처럼 걸을 수 없는 땅 칸도 값 0의 `'land'`지만 걷기는 Task 3의 칸 판정이 막는다.
- **보간:** 점 (x,y)를 칸 단위 u = x/16 − 0.5, v = y/16 − 0.5로 바꾼다. i0 = ⌊u⌋−1 … i0+3의 4×4 칸 값에 균일 3차 B-스플라인 가중치를 곱한다.
  - 맵 밖 칸은 가장 가까운 안쪽 칸으로 자른다(clamp).
  - `walkwet` 칸 값은 점이 든 칸이 `'water'`면 1, 아니면 0이다.
  - `'fixed'` 칸 값은 그리기 땅이 물이면 1, 아니면 0이다. 밀물 진흙도 땅 기준(high면 물)이다.
- **심지:** 점이 든 칸 가운데에서 거리 `CORE_R` 이하이면 값을 조정한다.
  - `'land'` 칸: `min(v, 0.45)`
  - `'water'` 칸: `max(v, 0.55)`

- [ ] **Step 1: 실패하는 시험 작성** — `shore.test.ts`. 작은 맵을 `defineMap(TMP_FLAT, rows, opts)`로 만든다.
```ts
it('넓은 물 가운데 1, 넓은 땅 가운데 0', ...)                 // 5×5 물·5×5 풀 가운데 칸 중심: toBeCloseTo(1)/(0)
it('1칸 물길 가운데 0.6 이상, 1칸 땅 가운데 0.4 이하', ...)     // ',,~,,' 세로 반복 / '~~,~~'
it('1칸 섬·1칸 연못은 심지를 지킨다', ...)                       // 물 3×3 가운데 ',' → 중심 ≤ 0.45, 풀 3×3 가운데 '~' → 중심 ≥ 0.55
it('곧은 물가: 칸 경계에서 0.5, 물 쪽 > 0.5, 땅 쪽 < 0.5', ...)  // ',,,~~~' 반복, x=48±2
it('부두 옆 물 칸은 물, 부두 뿌리 앞 땅은 땅', ...)               // 모래줄 아래 '#' 세로, 양옆 '~': 부두 옆 물 칸 중심 ≥ 0.5, 부두 바로 위 모래 칸의 아래쪽 가운데 픽셀(y=15) < 0.5
it('진흙·얼음 이웃 칸은 고정', ...)                               // shoreClassAt === 'fixed', shoreBands === null
it('가장자리: 맵 밖은 안쪽 칸 값', ...)                           // 왼쪽 가장자리 땅 칸 x=0.5px 값 === 같은 칸 x=8 값과 같은 쪽(<0.5)
it('shoreBands: 물가 칸은 배열, 물가에서 먼 칸은 null', ...)
it('발밑: 나무 x4–12 y3–10, 바위 x1–14 y6–14, 세로 울타리 x5–11, 물체 아닌 칸 null', ...)
it('deco 발밑은 prop 스프라이트 불투명 영역 안이고 높이 ≤ 8', ...) // isleMap(...)에 꾸미기 하나 놓은 맵
it('모든 발밑 사각형은 그 스프라이트(아래 칸) 불투명 바깥 사각형 안', ...) // tree·palm·deadtree·snowpine·reed·mast·rock(tile-rock)·bench(workbench)
it('가장 큰 맵 모든 칸 shoreBands 계산 150ms 이하', ...)          // MAPS 중 w*h 최대, performance.now()
```
- [ ] **Step 2: 실행해서 실패 확인** — `npx vitest run src/games/fishing/shore.test.ts` → FAIL(모듈 없음).
- [ ] **Step 3: `shore.ts` 구현.** 위 Interfaces와 분류 규칙대로 만든다.
  - B-스플라인 가중치: t∈[0,1), w0=(1−t)³/6, w1=(3t³−6t²+4)/6, w2=(−3t³+3t²+3t+1)/6, w3=t³/6.
  - deco 발밑은 스프라이트 이름별로 한 번 계산해서 캐시한다.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS.
- [ ] **Step 5: 커밋** — `feat: 낚시 물가 물 정도 값·물체 발밑(shore.ts)`

---

### Task 3: 걷기 판정을 물가선·발밑에 맞추기 (`walk.ts`)

**Files:**
- Modify: `src/games/fishing/walk.ts` (`feetBlocked`)
- Test: `src/games/fishing/walk.test.ts`(시험 추가), `src/games/fishing/shoreWalk.test.ts`(새 파일, 모든 맵 시험)

**Interfaces:**
- Consumes: `shoreField`, `shoreClassAt`, `wetness`, `footprintAt`, `SHORE_BLOCK` (Task 2)
- Produces:
  - `feetBlocked(map, x, y, opened, dyn)`: 시그니처는 그대로다.
  - `export function pointBlocked(map: MapDef, x: number, y: number, opened: Opened, dyn?: MapDynamic): boolean`: 한 점 판정이다. 시험과 Task 5 비교에 쓴다.

**판정(스펙 4.4):**
1. 발 사각형이 걸친 칸은 꼭짓점 4개가 든 칸이다(`EDGE_EPS`는 지금처럼). 칸마다 아래를 본다.
   - 맵 밖, 또는 `isWalkable`이 아닌데 매끄러운 칸도 물체 칸도 아닌 칸 → 막힘. 고정 칸, walkwet 칸, 절벽 등이 여기에 든다.
   - 잠긴 문(`map.gates`)이나 순간이동기 사각형 안의 칸 → 막힘.
   - 물체 칸(`footprintAt` 값 있음) → 발 사각형과 발밑 사각형이 겹치면 막힘(열린 겹침, EPS).
2. 9점(꼭짓점 4, 변 가운데 4, 중심) 가운데 `'water'`나 `'land'` 칸에 든 점 → `wetness ≥ SHORE_BLOCK`이면 막힘.
   - 물체 칸도 `'land'`나 `'water'`로 분류되어 이 점 판정을 받는다.
   - 진흙, 얼음, 구멍은 고정 칸이라 1번의 `isWalkable`(dyn)로 판정한다.
3. `edgeHits`는 그대로다.

- [ ] **Step 1: 실패하는 시험 작성.**

  `walk.test.ts`:
```ts
it('볼록한 물 모서리: 물 칸 안이지만 땅으로 그려진 곳에 설 수 있다', ...)   // 풀 L자에 둘러싸인 물 칸의 모서리 쪽 3px 안쪽 점: feetBlocked false, 그 점 wetness < 0.5
it('오목한 물가: 땅 칸 안이지만 물로 그려진 곳은 막힌다', ...)            // 물 L자 안쪽 땅 칸 모서리: wetness ≥ 0.5인 점에 중심 → true
it('나무 칸 아래쪽(y11–15)에 설 수 있고 줄기에는 못 선다', ...)           // 나무 칸 (tx*16+8, ty*16+13) false, (tx*16+8, ty*16+7) true
it('부두: 모래에서 부두로, 부두에서 모래로 걸어서 오간다', ...)           // stepWalk 반복으로 부두 끝 칸 도달·복귀
it('늪 갈대 칸: 발밑 바깥이라도 물로 그려진 곳은 막힌다', ...)            // 늪 3×3 가운데 'R': 칸 아래쪽 가운데 true
it('잠긴 문 칸은 물 정도와 상관없이 막힌다', ...)                          // gates 있는 맵, opened 비어 있음
it('pointBlocked: 매끄러운 칸 점은 wetness ≥ 0.5와 같다', ...)
```

  `shoreWalk.test.ts`(모든 맵):
```ts
// 맵 목록: Object.values(MAPS) + 내 섬 두 모양 × cleared 0·8(isleMap(layout, c)) + homeMap 각 단계. 물때 맵은 'high'·'low' 둘 다
it('걸을 수 있는 칸 가운데마다 설 수 있다', ...)   // isWalkable(ALL_AREAS_OPEN, dyn)인 칸 → feetBlocked(center) false. 실패 시 맵 id·칸 좌표를 메시지에
it('출구 도착 칸·선착장 앞·고정물 앞·순간이동기 앞·섬 도착 칸에 설 수 있다', ...)
it('물가를 따라 걸어도 발 중심이 물로 그려진 곳에 들어가지 않는다', ...) // 물가 칸(3×3에 물) 가운데에서 8방향 stepWalk 60번(16ms): 매 걸음 pointBlocked(중심) false
```
- [ ] **Step 2: 실행해서 실패 확인** — `npx vitest run src/games/fishing/walk.test.ts src/games/fishing/shoreWalk.test.ts` → 볼록·나무·늪 시험이 FAIL.
- [ ] **Step 3: `feetBlocked`, `pointBlocked` 구현**(위 판정대로).
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/fishing/` → 전부 PASS.
  - 모든 칸 시험이 실패하면 칸 좌표를 본다. 심지·walkwet 규칙의 결함이면 Task 2를 고친다. `SHORE_BLOCK`은 0.52까지만 올릴 수 있다.
- [ ] **Step 5: 커밋** — `feat: 낚시 걷기 판정을 그린 물가선·물체 발밑에 맞춤`

---

### Task 4: 서 있는 칸 `standTile`과 호출부

**Files:**
- Modify:
  - `src/games/fishing/map.ts`: `standTile` 추가. `exitAt`, `interactionAt`, `castTarget`의 `tileOf(pos)`를 이것으로 바꾼다.
  - `src/games/fishing/Game.tsx`: 플레이어 위치로 칸을 구하는 `tileOf` 호출을 모두 바꾼다(344, 530, 846, 866, 893, 1017, 1041, 1261줄 부근).
  - `src/games/fishing/position.ts`: 38줄과 83줄을 바꾸고, `parse`가 막힌 위치를 칸 가운데로 맞추게 한다.
- Test: `map.test.ts`, `position.test.ts`

**Interfaces:**
- Produces: `export function standTile(map: MapDef, pos: Vec, dyn: MapDynamic = STATIC_DYNAMIC): { tx: number; ty: number }`
  - 발 중심 칸이 `tileWalkable`(rows 기준, dyn)이면 그 칸을 돌려준다.
  - 아니면 8이웃 가운데 걷는 칸 중, 발 중심에서 칸 사각형까지 거리가 최소인 칸을 돌려준다. 같으면 위·아래·왼쪽·오른쪽, 그다음 대각선 순서다.
  - 그런 칸이 없으면 `tileOf(pos)`를 돌려준다.
  - `map.ts` 안에서만 계산한다. shore를 import하지 않는다.
- 호출부 규칙:
  - `interactionAt`과 `castTarget`은 dyn을 넘긴다.
  - Game의 "칸 가운데로 옮기기"(866줄, `snapToTile`)는 `standTile` 칸 가운데로 옮긴다.
  - 접속 정보(1261줄)도 `standTile`을 쓴다.
  - 맵 데이터의 칸(spawn, entry 등)에 쓰는 `tileOf`는 그대로 둔다.

- [ ] **Step 1: 실패하는 시험 작성.**

  `map.test.ts`:
```ts
it('standTile: 걷는 칸이면 그 칸', ...)
it('standTile: 물 칸 안 둥근 땅이면 가장 가까운 걷는 이웃 칸', ...)   // 볼록 모서리 물 칸의 왼쪽 위 3px 점 → 왼쪽 칸(같은 거리면 위 칸 우선, 기대값을 그대로 적는다)
it('standTile: 나무 칸 아래쪽이면 아래 칸, 앞(위)을 보면 interactionAt이 그 나무 자원', ...) // 내 섬 자원 나무 칸
it('물 칸 안 땅에서 물을 보면 낚시', ...)                               // interactionAt → { kind: 'fish' }
it('castTarget은 standTile에서 센다', ...)
```

  `position.test.ts`:
```ts
it('저장 위치가 새 판정에서 막히면 그 칸(standTile) 가운데로 맞춘다', ...) // 오목한 물가 땅 칸 모서리 px 저장 → parse 결과 = 칸 가운데, area 유지
```
- [ ] **Step 2: 실행해서 실패 확인** — `npx vitest run src/games/fishing/map.test.ts src/games/fishing/position.test.ts` → FAIL.
- [ ] **Step 3: 구현과 호출부 교체.**
  - `position.ts`의 `parse`: 기존 분기 앞에 하나를 더한다. `feetBlocked`이고 `standTile` 칸 가운데가 막히지 않으면 그 가운데를 돌려준다.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/fishing/ && npm run typecheck` → PASS.
- [ ] **Step 5: 커밋** — `feat: 낚시 서 있는 칸(standTile)으로 상호작용·저장·출구 판정`

---

### Task 5: 물가 픽셀 그리기 (`scene.ts`) 및 문서

**Files:**
- Modify:
  - `src/games/fishing/scene.ts`: `drawTile`의 땅 그리기 단계, `MapGfx`에 `field: ShoreField` 추가
  - `CLAUDE.md`: 낚시 절에 한 줄
- Test: `src/games/fishing/scene.test.ts`

**Interfaces:**
- Consumes: `shoreField`, `shoreBands`, `shoreClassAt`, 띠 상수(Task 2), `pointBlocked`(Task 3, 시험만)
- Produces: 그리기만 바뀐다. 외부 인터페이스 변화는 없다.

**그리기 규칙(스펙 4.2):**
- `mapCache`가 `gfx.field = shoreField(map, t)`를 만든다.
- `drawTile`에서 `shoreBands(field, tx, ty)`가 배열이면, 땅 단계(물 스프라이트 + `drawShoreEdges`·`drawSnowEdges`·`drawGrassFringe`·`drawSedgeFringe`, 또는 땅 스프라이트)를 픽셀 그리기로 대신한다. 그 뒤 얹는 것(나무, 바위, 울타리, 꾸미기 등)은 그대로 그린다.
- 픽셀 색(값 v, 칸 안 px (i,j)):
  - `v ≥ WET_BAND`: 물 스프라이트 `${name}-${(k+tx+ty*3)%2}`의 (i,j) 픽셀.
    - `name`은 칸이 물이면 지금 규칙(늪 연잎 포함)을 따른다.
    - 칸이 땅이면 3×3에서 `'water'` 칸을 상하좌우 먼저, 대각선 다음 순서로 찾아 `waterSpriteAt`을 쓴다. 3×3에 없으면 5×5에서 찾고, 그래도 없으면 `'water'`다.
  - `SHORE_LINE ≤ v < WET_BAND`: 땅 종류에 따라 색을 고른다.
    - 땅이 모래·풀: `v < FOAM_BAND`이고 `foamOn(wx + wy, k)`이면 `C.foam`, 아니면 `C.sandWet`.
    - 땅이 눈: `v < FOAM_BAND`면 `C.snowShade`, 아니면 `C.snowLip`.
    - 땅이 동굴: 물 픽셀.
  - `SAND_BAND ≤ v < SHORE_LINE`: 땅이 모래·풀이면 `tile-sand` 픽셀. 눈·동굴은 그 땅의 기본 스프라이트 픽셀.
  - `v < SAND_BAND`: 칸의 땅 기본 스프라이트 픽셀.
    - 땅 칸이면 제 그림이다: `path`·`flower`는 `tile-path`·`tile-flower`, 풀은 `hash(tx,ty)%4`로 `tile-grass-alt`/`tile-grass`, 눈은 drift 규칙, 모래, 동굴.
    - 물 칸이면 3×3에서 가장 가까운 `'land'` 칸의 땅으로 정한다(상하좌우 먼저).
  - 물체 칸의 땅은 `computeGround` 값으로 정한다.
- 출력: 행마다 같은 색이 이어지는 구간을 `rect(ctx, x, y, len, 1, color)` 하나로 그린다.
- 스프라이트 픽셀 색: `SPRITES[name].palette[rows[j][i]]`. 투명('.')이면 그 칸의 모래색 스프라이트로 대신한다.

- [ ] **Step 1: 실패하는 시험 작성** — `scene.test.ts`. 기존 가짜 컨텍스트와 `getContext → null` 패턴(직접 그리기)을 쓴다.
```ts
it('물가 칸은 픽셀 띠로 그리고 직선 젖은 띠는 그리지 않는다', ...)
// 작은 호수 맵: 물가 칸에서 fillRect 색 집합에 물 스프라이트 색·sandWet·tile-sand 색이 모두 있고,
// drawShoreEdges의 TILE×2 sandWet 사각형이 없다
it('그린 색과 걷기 판정이 같다', ...)
// 모든 MAPS의 물가 칸에서 시드 고정 무작위 2000점:
// (shoreBands 값 ≥ 0.5) === pointBlocked(map, x, y, ALL_AREAS_OPEN). 물체 발밑 안 점은 뺀다
it('물가에서 먼 칸은 지금 그림 그대로', ...) // 풀 한가운데 칸: drawSprite('tile-grass…') 호출 그대로
```
- [ ] **Step 2: 실행해서 실패 확인** — `npx vitest run src/games/fishing/scene.test.ts` → 첫 시험 FAIL.
- [ ] **Step 3: 구현.** `CLAUDE.md` 낚시 데이터 갱신 절에 한 줄을 더한다: "새 물·땅 칸 종류나 키 큰 물체를 더하면 `shore.ts`의 분류와 발밑 표(`footprintAt`)도 함께 고친다(`shoreWalk.test.ts`가 모든 맵을 본다)".
- [ ] **Step 4: 통과 확인** — `npm test && npm run typecheck && npm run build` → 모두 성공.
- [ ] **Step 5: 커밋** — `feat: 낚시 물가를 픽셀 곡선으로 그림`

---

## 끝난 뒤
- 마지막 검토(fable 모델)와 수정을 한다.
- 번들 `~/Desktop/onlyfms/feat-smooth-shore.bundle`을 만들고 PR 명령을 드린다. 배포는 Vercel만 한다.
- 화면에서 직접 확인할 것: 호수(lake), 섬(island) 물가, 늪(swamp) 갈대, 마을 부두, 내 섬 나무 밑.

# 펨타듀 낚시 — 넓은 세계 3단계 (지역 해금 · 산 호수 · 동굴 · 섬) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 돈으로 여는 지역 세 곳을 넣는다. 강 북쪽 무너진 다리(산 호수), 숲 동굴 입구 돌무더기(동굴), 마을 선착장의 배(섬). 지역마다 맵과 어종(일반 20 + 전설 3)을 더해 전체 56종을 채운다.

**Architecture:** 맵에 `gates`(잠긴 동안 막히는 칸과 그 앞 상호작용)와 `docks`(배 타는 자리)를 더하고, 걸을 수 있는지는 "열린 지역 집합"을 함께 보고 정한다. 잠긴 문 그림은 정적 캐시가 아니라 매 프레임 월드 레이어에 그려서, 해금해도 캐시를 다시 만들지 않는다. 서버는 `unlockArea` 행동으로 골드를 받고 `areas`에 지역을 더한다(`logic.version` 7). 동굴은 실내라 비·눈과 밤 색조를 그리지 않는다.

**Tech Stack:** TypeScript, React 18, Canvas 2D, vitest, Deno(`world` 함수 테스트). 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-23-fishing-world-design.md` (§10의 3단계, §5.3, §8.1, §8.2)

## Global Constraints

- `clock.ts`·`data.ts`·`logic.ts`·`minigame.ts`·`map.ts`·`maps/*.ts`·`walk.ts`는 순수 모듈: React·DOM·`Date.now()`·`Math.random` 없음, 상대 import에 `.ts`.
- 플랫폼 코드(`src/platform/`, `src/app/`)와 DB는 바꾸지 않는다.
- 화면 문구 한국어, 모바일 우선. 캔버스 밖 색은 `theme.css` 토큰만. 그림은 전부 새로 그린 16px 픽셀 아트(`sprites.ts` 형식), 원작 그림·맵 금지.
- 해금 가격: 산 호수 5,000G, 동굴 15,000G, 섬 50,000G. 해금 지역은 `lake`·`cave`·`island`, 기본 지역(`village`·`river`·`forest`)은 늘 열림.
- 자리 id는 `data.ts` `AREAS`: lake `lake`, cave `cave1`/`cave2`/`cave3`(얕은 곳→깊은 곳), island `sea`/`lagoon`.
- 마을 상점·부두·`SPAWN`·부두 끝→문 앞 37칸 불변. 부두 끝의 낚시(부두 보너스)를 선착장이 빼앗지 않는다.
- 맵 크기 40×30 ~ 56×40칸. 정적 캐시는 현재 맵 하나만.
- `logic.version` 7 (이번 단계에서 한 번만 올림. 5 = 잠금, 6 = 장비라 main은 지금 6). 기존 33종의 값은 바꾸지 않는다.
- 커밋 `type: 내용`, 마지막 두 줄 트레일러(Co-Authored-By: <작성 모델 이름> <noreply@anthropic.com> / Claude-Session: https://claude.ai/code/session_01T7oyVpQAuQkbAiCkNHahWh). 경로 지정 스테이징, 푸시 금지.

## Review Focus

1. **안 연 지역으로 가는 길**: 지역을 열지 않았으면 무너진 다리·돌무더기 칸을 걸어서 지나갈 수 없고, 출구에도 닿지 않는다. 선착장에서 배를 타도 섬으로 가지 않는다(구매 창만 뜸). → Task 1, Task 3, Task 5
2. **저장 위치가 안 연 지역**: localStorage에 `{area:'lake'}`가 있는데 서버 view의 `areas`에 `lake`가 없으면(다른 기기, 세이브 문제) → 마을 `SPAWN`. 첫 view를 받기 전에는 그 자리를 쓰지 않는다. → Task 5
3. **돈이 모자람·이미 열림·모르는 지역**: `unlockArea`가 `not_enough_gold`/`already_open`/`bad_area`를 주고 상태는 그대로. 화면은 버튼을 막고 문구를 보여 준다. → Task 4, Task 5
4. **해금 직후**: 다리 앞에서 구매하면 화면을 다시 불러오지 않아도 바로 다리가 놓이고 걸어서 건널 수 있다(정적 캐시 재생성 없음). → Task 1, Task 5
5. **동굴 안 날씨**: 비 오는 날·밤에도 동굴 안에는 비·눈 입자와 밤 색조가 없다. HUD 시계는 그대로 보인다. → Task 1, Task 3

---

### Task 1: 문(gate)·선착장(dock)·타일 출구와 "열린 지역" 통행 판정

**Files:**
- Modify: `src/games/fishing/map.ts`, `src/games/fishing/walk.ts`, `src/games/fishing/scene.ts`, `src/games/fishing/sprites.ts`, `src/games/fishing/Game.tsx`(시그니처만)
- Test: `map.test.ts`, `walk.test.ts`, `scene.test.ts`, `sprites.test.ts`

**Interfaces:**
- Consumes: 2단계 `MapDef`, `Exit`, `exitAt`, `interactionAt`, `feetBlocked`, `stepWalk`
- Produces:
  ```ts
  export type Rect = { tx: number; ty: number; w: number; h: number }
  export type Gate = { area: AreaId; tiles: Rect; look: 'broken-bridge' | 'rubble'; front: { tx: number; ty: number; facing: Facing } }
  //   잠긴 동안 tiles는 못 걷고 look 그림이 덮인다. 열리면 rows의 원래 칸 그대로(다리 H, 길 = 등).
  //   front: 여기 서서 facing을 보면 { kind: 'gate', area } 상호작용.
  export type Dock = { front: { tx: number; ty: number; facing: Facing }; target: AreaId; entry: { tx: number; ty: number; facing: Facing }; boat: { tx: number; ty: number } }
  //   front에서 facing을 보면 { kind: 'dock', target }. boat는 배 그림 위치(물 위, 칸 좌표).
  export type Exit = 지금 형식 | { at: Rect; target: AreaId; entry: … }   // 맵 안쪽 칸 출구(동굴 입구)
  export type MapDef = { …; gates: readonly Gate[]; docks: readonly Dock[]; indoor: boolean }
  export type Interaction = … | { kind: 'gate'; area: AreaId } | { kind: 'dock'; target: AreaId }
  export type Opened = ReadonlySet<AreaId>
  export function isWalkable(map: MapDef, tx: number, ty: number, opened: Opened): boolean
  export function interactionAt(map: MapDef, pos: Vec, facing: Facing, opened: Opened): Interaction
  //   잠긴 문 앞 → gate, 선착장 앞 → dock(열림 여부와 무관; 화면이 열림 여부로 구매/출발을 가른다), 그 외 지금 규칙
  export function exitAt(map: MapDef, pos: Vec): Exit | null // at 출구도 판정
  // walk.ts
  export function feetBlocked(map: MapDef, x: number, y: number, opened: Opened): boolean
  export function stepWalk(map: MapDef, p: Player, input: MoveInput, dtMs: number, opened: Opened): Player
  // scene.ts: WorldScene에 opened: Opened. 잠긴 문은 매 프레임 월드 레이어(캐릭터보다 아래)에 look 스프라이트로 그린다. 선착장의 배(boat 스프라이트)도 월드 레이어. indoor 맵은 비·눈·밤 색조를 그리지 않는다.
  // sprites: 'gate-broken-bridge'(16×16, 끊긴 판자·밧줄), 'gate-rubble'(16×16, 쌓인 돌), 'boat'(32×16 작은 나룻배)
  ```
- `defineMap` opts에 `gates`, `docks`, `indoor`(기본 빈 배열·false). 잘못된 정의(문 칸이 맵 밖, 선착장 front가 못 걷는 칸)는 `defineMap`이 throw.
- 이 Task에서 Game.tsx는 `opened`로 `view.areas`의 집합(없으면 기본 지역)을 넘기기만 한다. 상호작용 처리는 Task 5.

- [ ] **Step 1: 실패하는 테스트 작성** (합성 `defineMap` 맵으로)
  - `isWalkable/feetBlocked: 문 칸은 opened에 그 지역이 없으면 false, 있으면 rows 원래 칸의 규칙대로`
  - `stepWalk: 잠긴 문을 향해 걸으면 문 앞에서 멈추고, 열린 집합으로는 지나간다`
  - `interactionAt: 잠긴 문 front에서 facing → {kind:'gate', area}; 열린 뒤 같은 자리 → gate 아님; 선착장 front → {kind:'dock', target}; 선착장 front가 아닌 부두 끝에서 물 → fish/pier 그대로`
  - `exitAt: at 출구 사각형 안 칸 → 그 출구, 밖 → null`
  - `defineMap: 문 칸이 맵 밖이면 throw, 선착장 front가 못 걷는 칸이면 throw`
  - `scene: 잠긴 문 칸에 gate 스프라이트가 그려지고 opened에 들면 안 그려진다(캐시 재생성 없이 — renderFrame 호출 수 불변); indoor 맵은 비 오는 밤 cond에서도 입자·전체 채우기(밤) 없음, HUD 시계는 있음` (Review Focus 4, 5)
  - `sprites: gate-broken-bridge, gate-rubble 16×16, boat 32×16 존재`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing` / Expected: FAIL
- [ ] **Step 3: 구현** — 기존 호출부(Game.tsx, position.ts, maps.test 등)를 새 시그니처로. 기존 맵 3장은 gates/docks 없음, indoor false라 동작 불변.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — 수정 파일 경로 지정 `git add` `&& git commit -m "feat: 낚시 맵 문·선착장·안쪽 출구와 열린 지역 통행 판정"`

---

### Task 2: 산 호수·동굴·섬 타일

**Files:**
- Modify: `src/games/fishing/map.ts`, `src/games/fishing/scene.ts`, `src/games/fishing/sprites.ts`
- Test: `map.test.ts`, `scene.test.ts`, `sprites.test.ts`

**Interfaces:**
- Produces: `TileKind`에 추가 — 글자와 성질:

| 글자 | kind | 걷기 | 물(낚시) | 그림 |
|---|---|---|---|---|
| `k` | lake | × | ○ | `lake-0/1` 차갑고 짙은 청록 |
| `_` | cave-floor | ○ | × | `tile-cave-floor` 어두운 돌바닥 |
| `W` | cave-wall | × | × | `tile-cave-wall` 바위벽 |
| `u` | cave-pool | × | ○ | `cave-pool-0/1` 검푸른 물 |
| `q` | crystal | × | ○ | `crystal-0/1` 빛나는 수정 웅덩이 |
| `L` | lava | × | ○ | `lava-0/1` 붉게 일렁이는 용암 |
| `E` | cave-mouth | ○ | × | `tile-cave-mouth` 절벽에 뚫린 어두운 입구 |
| `P` | palm | × | × | `tile-palm` 야자수(나무처럼 윗부분이 한 칸 위로, 캐릭터 앞뒤 정렬) |
| `l` | lagoon | × | ○ | `lagoon-0/1` 밝은 옥빛 |
| `K` | dock | ○ | × | `dock-plank` 선착장 판자(아래 바다) |

- `WATER_KINDS`에 lake·cave-pool·crystal·lava·lagoon 추가. 땅 분류: 물 종류는 'water' 땅(물가 규칙), cave-floor·cave-mouth는 새 'cave' 땅(풀 가장자리·모래 거품 없음), cave-wall은 땅 없음, palm은 모래 위.
- `spots` 키로 이 물 종류들을 쓸 수 있게 `MapDef.spots` 타입을 넓힌다.

- [ ] **Step 1: 실패하는 테스트 작성** — `isWalkable`(표대로), `WATER_KINDS` 포함, `spotFor`(합성 맵 spots {lake:'lake'}, {'cave-pool':'cave1', crystal:'cave2', lava:'cave3'}, {water:'sea', lagoon:'lagoon'}), `castTarget`이 lava·crystal 위로도 날아감, 스프라이트 존재·크기·0/1 쌍 다름, scene이 각 칸을 해당 스프라이트로 그림, 야자수 윗부분이 캐릭터보다 아래 줄이면 캐릭터 앞에 그려짐(나무와 같은 규칙).
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/map.test.ts src/games/fishing/scene.test.ts src/games/fishing/sprites.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `… && git commit -m "feat: 낚시 산 호수·동굴·섬 타일"`

---

### Task 3: 맵 — 산 호수·동굴·섬과 문·선착장 배치

**Files:**
- Create: `src/games/fishing/maps/lake.ts`, `maps/cave.ts`, `maps/island.ts`
- Modify: `maps/river.ts`(북쪽 무너진 다리 + 출구), `maps/forest.ts`(동굴 입구 돌무더기 + 안쪽 출구), `maps/village.ts`(선착장 + 배), `maps/index.ts`
- Test: `src/games/fishing/maps/maps.test.ts`, `map.test.ts`

**맵 구성** (모양은 구현 재량, 아래 조건 필수)
- 강: 북쪽 절벽 사이 골짜기에 다리 자리(`H` 칸들)를 두고 `gates: [{ area:'lake', look:'broken-bridge', … }]`. 다리 너머 북쪽 출구 → 산 호수. 
- 숲: 2단계에서 남겨 둔 절벽 동굴 자리에 `E`(입구) 칸과 `at` 출구 → 동굴, 입구 칸에 `gates: [{ area:'cave', look:'rubble' }]`.
- 마을: 해변 동쪽(부두와 떨어진 곳)에 `K` 선착장을 바다 쪽으로 두세 칸 내고 `docks: [{ target:'island', boat 위치, entry: 섬 선착장 앞 }]`. 부두·상점·37칸 불변.
- 산 호수(`lake`, 40×30~56×40): 산속 큰 호수(`k`), 바위·나무, 남쪽 출구 → 강. `spots: { lake: 'lake' }`.
- 동굴(`cave`, `indoor: true`): 입구(남쪽 또는 아래쪽 `at`/가장자리 출구 → 숲 입구 앞)에서 안으로 갈수록 cave1 웅덩이(`u`) → cave2 수정 웅덩이(`q`) → 가장 깊은 cave3 용암(`L`). `spots: { 'cave-pool':'cave1', crystal:'cave2', lava:'cave3' }`.
- 섬(`island`): 모래·야자수·옥빛 석호(`l`)와 바깥 바다(`~`), 섬 선착장 `K`과 `docks: [{ target:'village', entry: 마을 선착장 앞 }]`. 가장자리 출구 없음. `spots: { water:'sea', lagoon:'lagoon' }`.

- [ ] **Step 1: 실패하는 테스트 작성** (`maps.test.ts`를 6장 모두로 넓힘)
  - 기존 검사 전부(크기, 테두리, 출구 짝, 도착점, 상점 없음, 마을 불변)를 6장에 적용. 출구 짝은 at 출구도 포함, 선착장 짝(마을↔섬 서로 가리킴, entry가 상대 선착장 front 근처 걸을 수 있는 칸)
  - `연결(전부 열림): 각 맵 도착점에서 모든 출구·선착장 front·AREAS 모든 자리에 닿음`
  - `잠김: opened = 기본 지역만일 때 강에서 산 호수 출구 칸, 숲에서 동굴 출구 칸에 닿지 못한다(BFS)` (Review Focus 1)
  - `문 front: 잠긴 상태에서 걸어서 닿고, 그 자리 interactionAt이 gate`
  - `마을 선착장 front에 걸어서 닿고 dock 상호작용; 부두 끝에서 물을 보면 여전히 fish/pier`
  - `동굴은 indoor, 나머지는 아님`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/maps` / Expected: FAIL
- [ ] **Step 3: 구현** — 맵을 그리고 PNG로 렌더해 눈으로 확인(저장소 밖 스크립트). 보고서에 미리보기 경로.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `… && git commit -m "feat: 낚시 산 호수·동굴·섬 맵과 다리·돌무더기·선착장"`

---

### Task 4: 서버 `unlockArea`와 로직 버전 7

**Files:**
- Modify: `src/games/fishing/data.ts`, `src/games/fishing/logic.ts`
- Test: `src/games/fishing/logic.test.ts`, `src/games/fishing/data.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // data.ts
  export const UNLOCKS: Readonly<Partial<Record<AreaId, { price: number; name: string }>>>
  //   lake { 5000, '무너진 다리 수리' }, cave { 15000, '동굴 장비' }, island { 50000, '배' }
  // logic.ts
  export type Action = … | { type: 'unlockArea'; area: string }
  //   오류: bad_area(UNLOCKS에 없는 지역·모르는 id), already_open, not_enough_gold, busy(pending 있음)
  //   성공: gold -= price, areas에 area 추가. totalEarned는 그대로
  ```
- `logic.version` 7. `migrate`: v6 → 그대로(areas에 해금 지역이 들어 있으면 유지), v2~v5도 지금처럼(잠금 v5 미만 전설 자동 잠금, 장비 필드 기본값 포함).
- `cast`는 지금 규칙 그대로(열린 지역 + 어종 있음).

- [ ] **Step 1: 실패하는 테스트 작성**
  - `unlockArea lake: 골드 6000 → 1000, areas에 lake; 다시 → already_open; 골드 4999 → not_enough_gold(상태 불변); 'village' → bad_area; 'zzz' → bad_area; '__proto__' → bad_area; pending 있으면 busy` (Review Focus 3)
  - `version 7; v6 세이브(장비·잠금 포함, areas에 lake 포함) 그대로; v2·v4 세이브 지금처럼`
  - `UNLOCKS 키는 lake·cave·island, 가격 5000/15000/50000`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/logic.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck && npm run fn:test` / Expected: PASS
- [ ] **Step 5: 커밋** — `… && git commit -m "feat: 낚시 지역 해금 행동과 로직 버전 7"`

---

### Task 5: 화면 — 해금 창, 배 타기, 열린 지역 반영

**Files:**
- Modify: `src/games/fishing/Game.tsx`, `src/games/fishing/Menus.tsx`, `src/games/fishing/position.ts`, `src/games/fishing/fishing.css`
- 주의: main의 `BagPanel`은 이미 `onEquip`(장비)·`onLock`(잠금) props를 받는다. 해금 창은 별도 컴포넌트로 두고 가방 props는 건드리지 않는다. `Game.test`의 기존 BagPanel 사용도 그대로 둔다.
- Test: `src/games/fishing/Game.test.tsx`, `src/games/fishing/position.test.ts`

**Interfaces:**
- Consumes: Task 1 `Interaction` gate/dock, `Opened`; Task 4 `unlockArea`, `UNLOCKS`
- 동작:
  - 열린 지역 집합 = `view.areas`(첫 응답 전엔 기본 지역). 걷기·상호작용·장면에 넘긴다.
  - 잠긴 문 앞에서 행동 → `UnlockPanel`(이름, 가격, 보유 골드, "열기" 버튼; 모자라면 버튼 비활성 + "골드가 모자라요"). 구매 성공 → 패널 닫고 알림("산 호수 가는 다리를 고쳤어요" 등 지역별 문구), 바로 통행 가능.
  - 선착장 앞에서 행동: 대상 지역(섬)이 안 열렸으면 배 구매 `UnlockPanel`; 열렸으면 바로 전환(2단계 전환과 같은 페이드)으로 dock.entry에 도착. 섬 선착장 → 마을은 늘 가능.
  - 행동 버튼·스페이스 문구: 잠긴 문 앞 "살펴보기", 선착장 앞 "배 타기".
  - 위치 복원: 저장된 지역이 `view.areas`에 없으면 마을 `SPAWN`(첫 view를 받은 뒤 판정, 그 전엔 화면 대기). `loadPosition`은 그대로 두고 Game에서 검사.
  - 동굴 들어가면 지역 이름 알림(2단계 규칙 그대로).
- [ ] **Step 1: 실패하는 테스트 작성**
  - `잠긴 다리 앞에서 행동 → 해금 창(무너진 다리 수리 · 5,000 G); 골드 부족이면 버튼 비활성·문구` (Review Focus 3)
  - `열기 → world({type:'unlockArea', area:'lake'}) 호출, 응답 view.areas에 lake → 창 닫힘·알림, 다리 칸을 걸어서 지나 산 호수 출구로 넘어감` (Review Focus 4)
  - `서버 오류(not_enough_gold) → 창 유지, 오류 문구`
  - `마을 선착장, 섬 잠김 → 배 구매 창; 섬 열림 → 페이드 뒤 섬 맵 entry에 도착; 섬 선착장 → 마을` (Review Focus 1)
  - `저장 위치 {area:'lake'} + view.areas에 lake 없음 → 마을 SPAWN에서 시작; 있으면 그 자리` (Review Focus 2)
  - `동굴에서 cast 페이로드 {area:'cave', spot:'cave3'}` (용암 앞)
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing` / Expected: FAIL
- [ ] **Step 3: 구현** — 패널 색은 theme 토큰만, 버튼은 기존 상점 버튼 스타일.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `… && git commit -m "feat: 낚시 지역 해금 창과 배 타기"`

---

### Task 6: 산 호수·동굴·섬 물고기 그림 23종

**Files:**
- Modify: `src/games/fishing/sprites.ts`
- Test: `src/games/fishing/sprites.test.ts`

**Interfaces:**
- Produces: `fish-<id>` 16×16 23개 — Task 7 표의 id: `rainbow-trout`, `largemouth-bass`, `smelt`, `masu-salmon`, `skygazer`, `israeli-carp`, `sturgeon`, `silver-king-trout`, `blind-fish`, `cave-crayfish`, `crystal-fry`, `ember-carp`, `bat-catfish`, `lava-eel`, `fire-dragonfish`, `clownfish`, `butterflyfish`, `blue-damsel`, `lionfish`, `moray`, `stingray`, `mahi`, `rainbow-marlin`.

- [ ] **Step 1: 실패하는 테스트 작성** — 23개 존재·16×16·서로 다름·기존 33종과도 다름; 전설 3종(silver-king-trout, fire-dragonfish, rainbow-marlin)은 각각 가장 비슷한 일반종(rainbow-trout, ember-carp, mahi)과 다른 픽셀 ≥ 30
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/sprites.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 특징: 무지개송어(분홍 옆줄 반점), 큰입배스(큰 입 녹색 줄무늬), 빙어(작고 투명한 은빛), 산천어(파마크 무늬), 강준치(위로 휜 입, 은빛 길쭉), 향어(비늘 적은 큰 잉어), 철갑상어(뼈판 줄, 뾰족 주둥이, 김), 은빛 대왕송어(크고 은빛 광택·반짝임), 장님고기(창백한 분홍, 눈 없음), 돌가재어(가재처럼 집게), 수정치어(투명 하늘색·빛점), 불꽃잉어(주황·붉은 불꽃 지느러미), 박쥐메기(날개 같은 가슴지느러미), 용암장어(검붉은 긴 몸·빛나는 무늬), 화룡어(용 머리·불꽃·금빛), 흰동가리(주황·흰 띠 3개), 나비고기(노랑·검은 눈띠), 청줄돔(파랑 줄), 쏠배감펭(줄무늬 가시 지느러미), 곰치(긴 몸·벌린 입), 가오리(납작 마름모·긴 꼬리), 만새기(넓은 이마, 초록·노랑), 무지개 청새치(긴 부리·무지개 광택). 길쭉한 것(곰치·용암장어·철갑상어)은 한 덩어리로 이어진 몸. PNG로 렌더해 확인, 보고서에 경로.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing/sprites.test.ts` / Expected: PASS
- [ ] **Step 5: 커밋** — `… && git commit -m "feat: 낚시 산 호수·동굴·섬 물고기 그림 23종"`

---

### Task 7: 산 호수·동굴·섬 어종

**Files:**
- Modify: `src/games/fishing/data.ts`, `src/games/fishing/Menus.tsx`(`SPOT_NAMES`)
- Test: `src/games/fishing/data.test.ts`, `src/games/fishing/logic.test.ts`, `src/games/fishing/Game.test.tsx`

**Interfaces:**
- Produces: `SPECIES` 56종. `SPOT_NAMES`: lake 호수, cave1 얕은 웅덩이, cave2 수정 웅덩이, cave3 용암, sea 바다, lagoon 석호. (`logic.version`은 Task 4의 7 그대로)

**산 호수 (`area:'lake'`, 자리 하나라 spots 없음)**

| id | 이름 | 등급 | 기본가 | cm | 난이도 | minRod | 유형 | 계절 | 시간 | 날씨 |
|---|---|---|---|---|---|---|---|---|---|---|
| rainbow-trout | 무지개송어 | common | 60 | 25–60 | .35 | 1 | mixed | – | – | – |
| largemouth-bass | 큰입배스 | common | 70 | 25–55 | .4 | 1 | mixed | – | – | – |
| smelt | 빙어 | common | 30 | 8–15 | .3 | 1 | dart | 겨울 | – | – |
| masu-salmon | 산천어 | uncommon | 180 | 20–40 | .55 | 1 | dart | 가을·겨울 | 6–19 | – |
| skygazer | 강준치 | uncommon | 160 | 40–90 | .6 | 1 | smooth | 봄·여름 | – | rain |
| israeli-carp | 향어 | uncommon | 150 | 40–80 | .5 | 1 | smooth | – | 20–5 | – |
| sturgeon | 철갑상어 | rare | 700 | 80–160 | .85 | 2 | sinker | 여름·겨울 | 6–19 | – |
| silver-king-trout | 은빛 대왕송어 | legend | 4000 | 70–120 | .95 | 3 | dart | 가을 | 4–7 | – | + `legend: { power: 0.95 }` |

**동굴 (`area:'cave'`, 계절·시간·날씨 조건 없음)**

| id | 이름 | 등급 | 기본가 | cm | 난이도 | minRod | 유형 | 자리 |
|---|---|---|---|---|---|---|---|---|
| blind-fish | 장님고기 | common | 60 | 8–20 | .3 | 1 | mixed | cave1 |
| cave-crayfish | 돌가재어 | common | 70 | 10–25 | .35 | 1 | sinker | cave1 |
| crystal-fry | 수정치어 | common | 90 | 6–14 | .45 | 1 | dart | cave2 |
| bat-catfish | 박쥐메기 | uncommon | 220 | 30–70 | .65 | 1 | smooth | cave2 |
| ember-carp | 불꽃잉어 | common | 150 | 30–60 | .6 | 1 | mixed | cave3 |
| lava-eel | 용암장어 | rare | 900 | 60–120 | .9 | 3 | mixed | cave3 |
| fire-dragonfish | 화룡어 | legend | 6000 | 90–150 | .98 | 4 | dart | cave3 | + `legend: { power: 0.95 }` |

**섬 (`area:'island'`, 계절 조건 없음)**

| id | 이름 | 등급 | 기본가 | cm | 난이도 | minRod | 유형 | 자리 | 시간 | 날씨 |
|---|---|---|---|---|---|---|---|---|---|---|
| clownfish | 흰동가리 | common | 80 | 6–11 | .35 | 1 | mixed | lagoon | – | – |
| butterflyfish | 나비고기 | common | 90 | 10–20 | .35 | 1 | dart | lagoon | – | – |
| blue-damsel | 청줄돔 | common | 85 | 8–18 | .3 | 1 | smooth | sea | – | – |
| lionfish | 쏠배감펭 | uncommon | 260 | 20–38 | .6 | 1 | smooth | lagoon | 20–5 | – |
| moray | 곰치 | uncommon | 280 | 60–150 | .65 | 1 | sinker | sea | – | rain |
| stingray | 가오리 | rare | 650 | 50–120 | .8 | 2 | sinker | lagoon | – | – |
| mahi | 만새기 | rare | 750 | 60–140 | .82 | 2 | dart | sea | 6–19 | – |
| rainbow-marlin | 무지개 청새치 | legend | 8000 | 150–300 | .98 | 4 | dart | sea | 11–14 | sun | + `legend: { power: 0.95 }` |

- [ ] **Step 1: 실패하는 테스트 작성**
  - `data: 56종, id 유일, 기존 33종 값 불변(스냅숏 갱신은 새 23종만 추가), 모든 fish-<id> 스프라이트`
  - `보장(모든 어종 있는 지역 × 자리 × 계절 × 정각 × 날씨, rod 1 common ≥ 1)이 6개 지역 전부 포함 — SPECIES_AREAS 고정값 ['village','river','forest','lake','cave','island']`
  - `지역 규칙: 상시 common ≥ 2, 유형 ≥ 3, 전설 정확히 1; 밤 전용·비 전용 ≥ 1은 동굴 제외; 동굴 어종은 seasons·hours·weather 없음; 섬 어종은 seasons 없음`
  - `logic: lake가 열린 세이브에서 cast {area:'lake'} 정상, 안 열린 세이브에서 bad_area; cave {spot:'cave3'} → 불꽃잉어·용암장어(rod 3+)만; island lagoon/sea 각 자리 어종만`
  - `logic 전설: 화룡어 rod 4·power 0.95·cave3에서만; 무지개 청새치 sea·맑음·11~14시·rod 4; 은빛 대왕송어 가을 4~7시 rod 3`
  - `records dex 'n/56'`
  - `도감 탭 6개(지역 순서), 새 자리 이름 표시(예: 박쥐메기 '수정 웅덩이 · 사계절')`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck && npm run fn:test` / Expected: PASS
- [ ] **Step 5: 커밋** — `… && git commit -m "feat: 낚시 산 호수·동굴·섬 어종 23종"`

---

### Task 8: 배포 체크리스트와 전체 검증

**Files:**
- Modify: `docs/deploy-checklist.md`

- [ ] **Step 1: 체크리스트 추가** — 낚시 절 2단계 항목 뒤에 3단계: `logic.version` 7, `world` 재배포 직후 머지·Vercel(main 기준 한 번 더 배포), 새로고침 안내, v6으로 되돌리지 않기(옛 migrate·화면은 새 23종과 해금 지역을 모름). 수동 확인: 강 북쪽 다리 앞 해금 창·가격, 골드 부족 문구, 해금 뒤 바로 건너기, 산 호수 낚시, 숲 동굴 입구 해금·동굴 안 비·밤 효과 없음·용암에서 낚시, 마을 선착장 배 구매·섬 왕복, 섬 석호·바다 낚시, 다른 기기에서 안 연 지역 위치면 마을에서 시작, 도감 탭 6개, 동굴 전환 시 폰에서 끊김 없음.
- [ ] **Step 2: 전체 검증** — Run: `npm test && npm run typecheck && npm run build && npm run fn:test` / Expected: 모두 PASS
- [ ] **Step 3: 커밋** — `git add docs/deploy-checklist.md && git commit -m "docs: 낚시 3단계 배포 안내"`

# 펨타듀 낚시 — 넓은 세계 2단계 (맵 여러 장 · 강 · 숲) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 맵을 지역마다 한 장으로 일반화하고, 가장자리 출구로 마을 ↔ 강 ↔ 숲을 걸어서 오가게 한다. 강·숲 어종 15종 + 전설 2종을 넣고, 도감을 지역 탭으로 나눈다.

**Architecture:** `map.ts`의 전역 맵을 `MapDef` 값으로 바꾸고, 타일 함수·이동·위치 저장·장면 캐시가 현재 맵을 인자로 받는다. 맵 데이터는 `maps/{village,river,forest}.ts`, 등록부는 `maps/index.ts`. 출구 판정은 순수 함수, 전환(페이드·도착 지점·위치 저장)은 `Game.tsx`. 서버는 `data.ts`에 어종이 생긴 지역의 `cast`를 받고 `logic.version`이 4가 된다.

**Tech Stack:** TypeScript, React 18, Canvas 2D, vitest, Deno(`world` 함수 테스트). 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-23-fishing-world-design.md` (§10의 2단계, §5.3, §5.4, §8.1)

## Global Constraints

- `clock.ts`·`data.ts`·`logic.ts`·`minigame.ts`·`map.ts`·`maps/*.ts`·`walk.ts`는 순수 모듈: React·DOM·`Date.now()`·`Math.random` 없음, 상대 import에 `.ts`.
- 플랫폼 코드(`src/platform/`, `src/app/`)와 DB는 바꾸지 않는다.
- 화면 문구 한국어, 모바일 우선. 캔버스 밖 색은 `theme.css` 토큰만. 그림은 전부 새로 그린 16px 픽셀 아트(`sprites.ts` 형식), 원작 그림·맵 금지.
- 마을 맵의 상점 위치(`SHOP` tx 10, ty 2, 5×4, 문 tx 12)·`SPAWN`·부두는 그대로. 부두 끝 → 상점 문 앞 최단 경로 37칸 유지(`map.test.ts`).
- 지역 id `village`·`river`·`forest`(이번 단계에 맵이 있는 지역). 자리 id는 `data.ts` `AREAS`: village `pier`/`shore`, river `river`, forest `pond`/`waterfall`.
- 맵 크기 40×30 ~ 56×40칸. 정적 캐시는 현재 맵 하나만 유지.
- `logic.version` 4. 기존 16종의 값은 바꾸지 않는다.
- 상점은 마을에만 있다.
- 커밋 `type: 내용`, 마지막 두 줄 트레일러(Co-Authored-By: <작성 모델 이름> <noreply@anthropic.com> / Claude-Session: https://claude.ai/code/session_01T7oyVpQAuQkbAiCkNHahWh). 경로 지정 스테이징, 푸시 금지.

## Review Focus

1. **1단계 저장 위치**: localStorage에 `{pos, facing}`(지역 없음)만 있는 사람 → 마을 그 자리에서 시작한다. → Task 4
2. **출구 왕복 깜빡임**: 출구로 넘어간 직후 도착 지점에 서 있거나 한 걸음 뒤로 물러나도 바로 되돌아가지 않는다(도착 지점은 출구 판정 칸이 아니고, 출구 판정 칸과 1칸 이상 떨어져 있다). → Task 3, Task 4
3. **다리에서 던지기·폭포 웅덩이 옆 연못**: 강 다리 위에서 물을 보고 던지면 `river`(부두 보너스 없음), 숲 폭포 웅덩이 칸을 보면 `waterfall`, 연못 칸을 보면 `pond`. 찌는 물 종류가 바뀌어도 물이면 계속 날아간다. → Task 2
4. **강·숲에서 가방이 참**: 상점 상호작용은 마을 문 앞에서만 나온다. 숲·강 어디에서도 `shop`이 나오지 않는다. → Task 1, Task 3
5. **저장 위치가 막힌 칸이 됨**: 맵을 고쳐 저장된 강/숲 좌표가 벽이 되면 → 마을 `SPAWN`. 모르는 지역 id → 마을 `SPAWN`. → Task 4

---

### Task 1: `MapDef` 일반화 (동작은 그대로)

**Files:**
- Modify: `src/games/fishing/map.ts`, `src/games/fishing/walk.ts`, `src/games/fishing/position.ts`, `src/games/fishing/scene.ts`, `src/games/fishing/Game.tsx`
- Create: `src/games/fishing/maps/village.ts`
- Test: `src/games/fishing/map.test.ts`, `walk.test.ts`, `position.test.ts`, `scene.test.ts`, `Game.test.tsx` (시그니처만 갱신)

**Interfaces:**
- Produces:
  ```ts
  // map.ts
  export type MapDef = {
    id: AreaId                        // data.ts의 AreaId
    rows: readonly string[]
    w: number; h: number              // rows에서 계산
    shop: { tx: number; ty: number; w: number; h: number; doorTx: number } | null
    spawn: { pos: Vec; facing: Facing }
  }
  export function defineMap(id: AreaId, rows: readonly string[], opts?: {}): MapDef // opts는 Task 2(spots)·Task 3(exits)이 넓힌다. 행 길이 검사, w/h, 문 D가 있으면 shop 계산(지금 SHOP 계산 그대로), spawn = 문 앞(없으면 첫 걸을 수 있는 칸, Task 3에서 출구 도착점이 대신 쓰임)
  export function tileAt(map: MapDef, tx: number, ty: number): TileKind | null
  export function isWalkable(map: MapDef, tx: number, ty: number): boolean
  export function shopSpot(map: MapDef): { tx: number; ty: number } | null
  export function pierEnd(map: MapDef): { tx: number; ty: number } | null
  export function interactionAt(map: MapDef, pos: Vec, facing: Facing): Interaction
  export function castTarget(map: MapDef, pos: Vec, facing: Facing, power: number): Vec
  // walk.ts
  export function feetBlocked(map: MapDef, x: number, y: number): boolean
  export function stepWalk(map: MapDef, p: Player, input: MoveInput, dtMs: number): Player
  export function cameraFor(map: MapDef, target: Vec, view: { w: number; h: number }): Vec
  // maps/village.ts
  export const VILLAGE: MapDef  // 지금 MAP_ROWS 그대로
  // scene.ts: WorldScene에 map: MapDef 추가. 정적 캐시·땅 계산은 map.id별로 만들고, 다른 맵이 오면 이전 캐시를 버린다.
  // position.ts: loadPosition(userId, map: MapDef) — 이 Task에선 지금처럼 {pos, facing}만, 막힘 판정에 map 사용
  ```
- `Interaction`의 `spot` 타입은 `string`으로 넓힌다(Task 2에서 지역별 자리).
- 전역 `MAP_ROWS`·`MAP_W`·`MAP_H`·`SHOP`·`SHOP_SPOT`·`SPAWN`·`PIER_END`는 없앤다(테스트는 `VILLAGE`와 `shopSpot(VILLAGE)` 등으로).

- [ ] **Step 1: 테스트 갱신** — 기존 map/walk/position/scene/Game 테스트를 새 시그니처로 바꾸고(값·기대 결과는 그대로), 추가:
  - `defineMap: 행 길이가 다르면 throw, 문이 둘이면 throw, 문이 없으면 shop null`
  - `scene: 같은 map이면 캐시 재사용, 다른 map.id로 그리면 이전 캐시를 버리고 새로 만든다` (renderFrames 호출 수를 가짜 document로 셈 — 지금 scene.test의 캐시 테스트 방식 따름)
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing` / Expected: 타입·import 오류로 FAIL
- [ ] **Step 3: 구현** — 순수 이동. 계산식·상수·그리기 결과는 바꾸지 않는다.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS (기존 테스트 수 유지 + 새 테스트)
- [ ] **Step 5: 커밋** — `git add src/games/fishing/map.ts src/games/fishing/maps/village.ts src/games/fishing/walk.ts src/games/fishing/position.ts src/games/fishing/scene.ts src/games/fishing/Game.tsx` + 수정한 테스트 `&& git commit -m "refactor: 낚시 맵을 MapDef 값으로 일반화"`

---

### Task 2: 새 타일 종류와 지역별 낚시 자리

**Files:**
- Modify: `src/games/fishing/map.ts`, `src/games/fishing/scene.ts`, `src/games/fishing/sprites.ts`
- Test: `map.test.ts`, `scene.test.ts`, `sprites.test.ts`

**Interfaces:**
- Consumes: Task 1 `MapDef`, `defineMap`, `tileAt`
- Produces:
  ```ts
  export type TileKind = …기존 | 'river' | 'pond' | 'basin' | 'falls' | 'bridge' | 'cliff'
  // 글자: 'r' river(강물), 'p' pond(연못물), 'b' basin(폭포 웅덩이), 'w' falls(폭포), 'H' bridge(다리), 'c' cliff(절벽)
  export const WATER_KINDS: ReadonlySet<TileKind> // water, river, pond, basin
  export type MapDef = { …; spots: Partial<Record<'water'|'river'|'pond'|'basin', string>> } // 물 종류 → 자리 id
  // VILLAGE.spots = { water: 'shore' } (서 있는 칸이 pier면 'pier' — 지금 규칙 유지)
  export function spotFor(map: MapDef, standing: TileKind | null, front: TileKind | null): string | null
  ```
- 걸을 수 있음: 기존 + `bridge`. 못 걸음: `river`·`pond`·`basin`·`falls`·`cliff`.
- `interactionAt`: 앞이 `WATER_KINDS`이고 `spotFor`가 값을 주면 `{kind:'fish', spot}`. 앞이 `falls`·`cliff`면 null.
- `castTarget`: 앞 타일부터 `WATER_KINDS`가 아닌 칸에서 멈춘다(물 종류가 섞여도 계속).
- 장면: `river`·`pond`·`basin`은 땅 'water'로 취급(물가 거품·풀 가장자리 규칙 그대로), 칸 그림은 종류별 2장(`river-0/1`, `pond-0/1`, `basin-0/1`). `falls`는 2장(`falls-0/1`) 세로로 흘러내리는 물, `bridge`는 가로 판자(`bridge-plank`, 아래 강물이 깔림), `cliff`는 바위 절벽(`tile-cliff`). 강물은 바다보다 밝고 흐름 줄무늬, 연못물은 짙고 잔잔, 웅덩이는 거품 많게.

- [ ] **Step 1: 실패하는 테스트 작성** (작은 합성 `defineMap` 맵으로)
  - `spotFor: VILLAGE에서 부두 위 + 바다 → 'pier', 모래 + 바다 → 'shore'; spots {river:'river'} 맵에서 bridge + river → 'river'; spots {pond:'pond', basin:'waterfall'} 맵에서 풀 + basin → 'waterfall', 풀 + pond → 'pond'; spots에 없는 물 → null`
  - `interactionAt: 폭포(falls)·절벽을 보면 null, 다리 위에서 강을 보면 fish/river`
  - `castTarget: pond에서 시작해 basin으로 이어지면 계속, 풀에서 멈춤`
  - `isWalkable: bridge true, river/pond/basin/falls/cliff false`
  - `sprites: river-0/1, pond-0/1, basin-0/1, falls-0/1, bridge-plank, tile-cliff 존재, 16×16, 0/1 쌍은 서로 다름`
  - `scene: 합성 맵의 각 새 타일이 해당 스프라이트로 그려진다`(그리기 기록 방식, 지금 scene.test 따름)
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/map.test.ts src/games/fishing/scene.test.ts src/games/fishing/sprites.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git add src/games/fishing/map.ts src/games/fishing/scene.ts src/games/fishing/sprites.ts` + 테스트 `&& git commit -m "feat: 낚시 강·연못·폭포·다리·절벽 타일과 지역별 낚시 자리"`

---

### Task 3: 강·숲 맵, 출구, 맵 등록부

**Files:**
- Create: `src/games/fishing/maps/river.ts`, `src/games/fishing/maps/forest.ts`, `src/games/fishing/maps/index.ts`
- Modify: `src/games/fishing/maps/village.ts`(북쪽 출구), `src/games/fishing/map.ts`
- Test: `src/games/fishing/maps/maps.test.ts`(새 파일), `map.test.ts`

**Interfaces:**
- Consumes: Task 1·2
- Produces:
  ```ts
  // map.ts
  export type Exit = { edge: 'n' | 's' | 'e' | 'w'; from: number; to: number; target: AreaId; entry: { tx: number; ty: number; facing: Facing } }
  //   from..to: 가장자리를 따라 출구 칸 범위(포함). 출구 칸 = 그 가장자리 줄(행/열)의 범위 안 걸을 수 있는 칸.
  export type MapDef = { …; exits: readonly Exit[] }
  export function defineMap(id, rows, opts: { spots; exits?: Exit[] }): MapDef
  export function exitAt(map: MapDef, pos: Vec): Exit | null // 발 중앙이 있는 칸이 출구 칸이면 그 출구
  // maps/index.ts
  export const MAPS: Readonly<Partial<Record<AreaId, MapDef>>> // village, river, forest
  export function mapFor(area: AreaId): MapDef | null
  ```

**맵 구성** (모양은 구현 재량, 아래 조건은 지켜야 함)
- 마을: 위쪽 테두리 나무 사이로 길 하나를 열어 북쪽 출구 → 강. 상점·부두·`SPAWN`·최단 경로 37칸 불변.
- 강(`river`, 40×30~56×40): 가로로 흐르는 강, 강을 건너는 다리(`H`) 1개 이상. 남쪽 출구 → 마을, 서쪽 출구 → 숲. 북쪽은 막혀 있음(3단계에서 무너진 다리로 산 호수). 강가 여러 곳에서 낚시 가능. 나무·꽃·바위로 꾸밈. `spots: { river: 'river' }`.
- 숲(`forest`, 40×30~56×40): 나무가 빽빽하고, 연못(`p`) 하나와 북쪽 절벽(`c`)에서 떨어지는 폭포(`w`)·웅덩이(`b`). 동쪽 출구 → 강. 동굴 입구 자리는 절벽 한쪽에 남겨 두되 막혀 있음(3단계). `spots: { pond: 'pond', basin: 'waterfall' }`.
- 출구끼리 짝: A의 출구가 B를 가리키면 B에도 A를 가리키는 출구가 있고, 각 도착점은 상대 출구 바로 안쪽(출구 칸에서 1~2칸 안, 출구 칸이 아님).

- [ ] **Step 1: 실패하는 테스트 작성** (`maps.test.ts`, 모든 맵에 대해 반복)
  - `크기 범위, 행 길이 같음, 모르는 글자 없음`
  - `테두리: 출구 칸을 빼고 걸을 수 있는 칸이 없다`
  - `출구 짝: 모든 출구의 target 맵이 있고, 그 맵에 되돌아오는 출구가 있다`
  - `도착점: 걸을 수 있고, feetBlocked가 아니고, exitAt이 null이며, 같은 맵의 모든 출구 칸과 맨해튼 거리 ≥ 1` (Review Focus 2)
  - `연결: 각 맵에서 아무 도착점(마을은 SPAWN도)에서 BFS로 모든 출구 칸과, data.ts AREAS의 그 지역 모든 자리마다 그 자리를 주는 낚시 칸(서서 앞을 보면 spotFor가 그 자리)에 닿는다`
  - `상점: 마을만 shop이 있고, 강·숲의 어느 걸을 수 있는 칸·방향에서도 interactionAt이 shop을 주지 않는다` (Review Focus 4)
  - `마을: SHOP·SPAWN 불변, 부두 끝→문 앞 최단 경로 37칸` (map.test 기존 유지)
  - `exitAt: 출구 칸 중앙 → 그 출구, 출구 바로 안쪽 칸 → null`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/maps src/games/fishing/map.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 맵 문자열을 그리고 `MAPS`에 등록.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git add src/games/fishing/maps src/games/fishing/map.ts` + 테스트 `&& git commit -m "feat: 낚시 강·숲 맵과 지역 출구"`

---

### Task 4: 지역 전환 (화면)

**Files:**
- Modify: `src/games/fishing/Game.tsx`, `src/games/fishing/position.ts`, `src/games/fishing/scene.ts`(페이드), `src/games/fishing/fishing.css`(필요 시)
- Test: `src/games/fishing/position.test.ts`, `src/games/fishing/Game.test.tsx`, `src/games/fishing/scene.test.ts`

**Interfaces:**
- Consumes: Task 3 `MAPS`, `mapFor`, `exitAt`, `Exit`; data.ts `AREAS`(지역 이름)
- Produces:
  ```ts
  // position.ts
  export type SavedPosition = { area: AreaId; pos: Vec; facing: Facing }
  export function loadPosition(userId: string): SavedPosition | null
  //   area 없음(1단계 형식) → 'village'. 모르는 지역·맵 없음·그 맵에서 feetBlocked → null
  export function savePosition(userId: string, p: SavedPosition): void
  // scene.ts: WorldScene에 fade: number (0~1, 화면 전체 검정 채우기 알파; 0이면 그리지 않음)
  ```
- 흐름: 걷는 중(`phase === 'walk'`) 매 프레임 `exitAt(현재 맵, 발)` → 출구면 입력 잠금, 페이드 아웃 150ms → 지역·위치·방향을 `entry`로 바꾸고 위치 저장 → 페이드 인 150ms → 입력 풀림. 낚시 단계에서는 판정하지 않는다.
- 도착하면 지역 이름 알림(예: "마을 강") 1.5초, 지금 알림 방식 재사용.
- `cast` 페이로드의 `area`는 현재 지역 id, `spot`은 `interactionAt` 결과.
- 상점 메뉴·가방의 "상점에서 팔 수 있어요" 동작은 지금 그대로(마을 문 앞만 상점).
- 시작: `loadPosition`이 null이면 마을 `VILLAGE.spawn`.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `position: 1단계 형식 {pos,facing} → area 'village'로 복원` (Review Focus 1)
  - `position: {area:'river', pos(강 맵 걸을 수 있는 칸)} 복원; area 'lake'(맵 없음) → null; 강 맵에서 막힌 좌표 → null; 깨진 JSON → null` (Review Focus 5)
  - `Game: 마을 북쪽 출구로 걸어가면 페이드 뒤 강 맵에서 그 출구의 entry 위치에 서고, drawWorld의 scene.map.id가 'river', 위치가 {area:'river'}로 저장된다`
  - `Game: 도착 직후 0.5초 동안 아무 입력이 없거나 반대 방향으로 한 걸음 걸어도 다시 마을로 가지 않는다` (Review Focus 2)
  - `Game: 강에서 물을 보고 던지면 cast 페이로드가 {area:'river', spot:'river'}`
  - `Game: 숲 연못에서 던지면 {area:'forest', spot:'pond'}`
  - `Game: 지역에 들어가면 지역 이름 알림이 보인다`
  - `scene: fade 0.5면 마지막에 화면 전체 채우기 한 번, 0이면 없음`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing` / Expected: 새 테스트 FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS. (강·숲에서의 cast는 data에 어종이 없어 실제 서버라면 `bad_area`지만 Game 테스트는 서버를 흉내 내므로 무관)
- [ ] **Step 5: 커밋** — `git add src/games/fishing/Game.tsx src/games/fishing/position.ts src/games/fishing/scene.ts` + 테스트·css `&& git commit -m "feat: 낚시 지역 출구 전환과 지역별 위치 저장"`

---

### Task 5: 강·숲 물고기 그림 17종

**Files:**
- Modify: `src/games/fishing/sprites.ts`
- Test: `src/games/fishing/sprites.test.ts`

**Interfaces:**
- Produces: `fish-<id>` 16×16 스프라이트 17개 — id는 Task 6 표의 id 그대로: `pale-chub`, `dark-chub`, `skin-carp`, `aucha-perch`, `sweetfish`, `catfish`, `mandarin-fish`, `eel`, `golden-mandarin`, `crucian`, `carp`, `bluegill`, `loach`, `snakehead`, `stream-minnow`, `lenok`, `century-snakehead`.

- [ ] **Step 1: 실패하는 테스트 작성** — `sprites.test.ts`: `강·숲 17종 스프라이트가 모두 있고 16×16 안, 서로 다르고 기존 16종과도 다르다`; `전설 2종(golden-mandarin, century-snakehead)은 금빛/거대함 등으로 일반종(mandarin-fish, snakehead)과 구별된다 — 두 그림의 다른 픽셀 수 ≥ 30`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/sprites.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 기존 물고기와 같은 화풍·크기. 특징: 피라미(은빛 몸에 분홍 혼인색 줄), 갈겨니(검은 세로 띠), 누치(길쭉한 은회색, 아래 입), 꺽지(갈색 몸 흰 점, 아가미 뒤 파란 점), 은어(가늘고 노란 지느러미), 메기(넓은 머리, 수염), 쏘가리(황갈색 바탕 검은 무늬), 뱀장어(아주 긴 몸), 황금 쏘가리(쏘가리 모양 금빛), 붕어(둥근 갈색), 잉어(큰 비늘, 수염), 블루길(납작, 아가미 남색 점), 미꾸라지(가늘고 긴 갈색, 수염), 가물치(긴 몸 뱀무늬), 버들치(작고 갈색 점), 열목어(붉은 점, 눈가 붉음), 백년 가물치(크고 짙은 가물치, 흉터·이끼색).
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing/sprites.test.ts` / Expected: PASS
- [ ] **Step 5: 커밋** — `git add src/games/fishing/sprites.ts src/games/fishing/sprites.test.ts && git commit -m "feat: 낚시 강·숲 물고기 그림 17종"`

---

### Task 6: 강·숲 어종과 로직 버전 4

**Files:**
- Modify: `src/games/fishing/data.ts`, `src/games/fishing/logic.ts`, `src/games/fishing/Menus.tsx`(`SPOT_NAMES`), `supabase/functions/world/handler.test.ts`(필요 시)
- Test: `src/games/fishing/data.test.ts`, `src/games/fishing/logic.test.ts`, `src/games/fishing/Game.test.tsx`

**Interfaces:**
- Consumes: 1단계 `Species`, `speciesAvailable`, `rollCatch`; Task 5 스프라이트
- Produces: `SPECIES` 33종. `legend.power`가 0이면 강도 조건 없음. `logic.version` 4, `migrate`는 v3 → v4 변환 없음(버전만), v2 → v4도 지금 규칙 그대로. `SPOT_NAMES`에 river 강, pond 연못, waterfall 폭포.

**강 (`area: 'river'`, 자리 `river` 하나라 `spots` 없음)**

| id | 이름 | 등급 | 기본가 | cm | 난이도 | minRod | 유형 | 계절 | 시간 | 날씨 |
|---|---|---|---|---|---|---|---|---|---|---|
| pale-chub | 피라미 | common | 20 | 8–15 | .2 | 1 | dart | – | – | – |
| dark-chub | 갈겨니 | common | 25 | 10–18 | .25 | 1 | mixed | – | – | – |
| skin-carp | 누치 | common | 45 | 25–50 | .3 | 1 | smooth | 봄·여름·가을 | 6–19 | – |
| aucha-perch | 꺽지 | uncommon | 90 | 12–25 | .45 | 1 | sinker | – | – | – |
| sweetfish | 은어 | uncommon | 120 | 15–30 | .5 | 1 | dart | 여름 | 6–19 | – |
| catfish | 메기 | uncommon | 130 | 30–80 | .55 | 1 | mixed | 봄·여름·가을 | – | rain |
| mandarin-fish | 쏘가리 | rare | 350 | 25–55 | .7 | 2 | mixed | – | – | – |
| eel | 뱀장어 | rare | 400 | 40–90 | .75 | 2 | smooth | 여름·가을 | 20–5 | – |
| golden-mandarin | 황금 쏘가리 | legend | 3000 | 50–80 | .92 | 3 | mixed | 여름 | – | rain | + `legend: { power: 0.95 }` |

**숲 (`area: 'forest'`)**

| id | 이름 | 등급 | 기본가 | cm | 난이도 | minRod | 유형 | 자리 | 계절 | 시간 | 날씨 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| crucian | 붕어 | common | 25 | 10–30 | .2 | 1 | mixed | pond | – | – | – |
| carp | 잉어 | common | 40 | 30–80 | .25 | 1 | smooth | pond | – | – | – |
| bluegill | 블루길 | common | 15 | 8–20 | .15 | 1 | mixed | pond | 봄·여름·가을 | 6–19 | – |
| loach | 미꾸라지 | uncommon | 60 | 8–18 | .4 | 1 | sinker | pond | 봄·여름·가을 | – | rain |
| snakehead | 가물치 | uncommon | 150 | 40–90 | .65 | 1 | mixed | pond | 여름·가을 | 20–5 | – |
| stream-minnow | 버들치 | common | 20 | 6–12 | .25 | 1 | dart | waterfall | – | – | – |
| lenok | 열목어 | rare | 380 | 30–70 | .72 | 2 | dart | waterfall | 가을·겨울 | – | – |
| century-snakehead | 백년 가물치 | legend | 2800 | 90–150 | .9 | 3 | sinker | pond | 봄 | 20–5 | – | + `legend: { power: 0 }` |

- [ ] **Step 1: 실패하는 테스트 작성**
  - `data: 33종, id 유일, 1단계 16종 값 불변(스냅숏 비교), 모든 fish-<id> 스프라이트 존재`
  - `data 보장: 어종이 있는 모든 지역 × 그 지역 모든 자리 × 계절 × 시각(정각) × 날씨에서 rod 1 common ≥ 1` (마을만 보던 테스트를 모든 지역 반복으로)
  - `data 규칙: 각 지역마다 상시 common ≥ 2(지역 전체), 밤 전용 ≥ 1, 비 전용 ≥ 1, 행동 유형 ≥ 3, 전설 정확히 1종`
  - `areaHasSpecies: village·river·forest true, lake false`
  - `logic: version 4; cast {area:'river', spot:'river'} 정상(조건 맞는 어종만); {area:'forest', spot:'waterfall'} → 버들치·열목어만; {area:'forest', spot:'river'} → bad_spot; {area:'lake'} → bad_area`
  - `logic 전설: 황금 쏘가리는 여름·비·rod 3·power 0.95·r0 작음에서만; 백년 가물치는 power 0.1에서도 봄 밤 연못 rod 3이면 후보(power 0)`
  - `logic migrate: v3 세이브 → v4 그대로(골드·가방·도감·areas·legends), v2 세이브도 지금처럼`
  - `records: dex detail 'n/33'`
  - `Menus conditionLabel: 지금은 전설일 때만 자리를 붙인다 → 어종에 spots가 있으면 항상 자리 이름을 앞에 붙이도록 바꾼다 — 버들치 '폭포 · 사계절', 가물치 '연못 · 여름 · 가을 · 20~5시', 다금바리 '부두 · 겨울'; spots 없는 강 어종은 자리 없음, 예: 메기 '봄 · 여름 · 가을 · 비'`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck && npm run fn:test` / Expected: PASS
- [ ] **Step 5: 커밋** — `git add src/games/fishing/data.ts src/games/fishing/logic.ts src/games/fishing/Menus.tsx` + 테스트 `&& git commit -m "feat: 낚시 강·숲 어종 17종과 로직 버전 4"`

---

### Task 7: 도감 지역 탭, 배포 체크리스트

**Files:**
- Modify: `src/games/fishing/Menus.tsx`, `src/games/fishing/fishing.css`, `docs/deploy-checklist.md`
- Test: `src/games/fishing/Game.test.tsx`

**Interfaces:**
- Consumes: data.ts `AREAS`, `SPECIES`, `areaHasSpecies`

- [ ] **Step 1: 실패하는 테스트 작성**
  - `도감: 어종이 있는 지역마다 탭(바닷가 마을·마을 강·숲), 처음엔 현재 지역 탭(DexPanel에 currentArea prop), 탭을 누르면 그 지역 어종만 보인다`
  - `도감: 탭마다 'n/전체' (예: 마을 강 0/9), 맨 위에 전체 'n/33종'`
  - `도감: 안 잡은 어종은 실루엣 + '???'(지금처럼), 전설은 잡기 전에도 테두리 표식으로 자리만 보인다(이름은 ???)`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/Game.test.tsx` / Expected: FAIL
- [ ] **Step 3: 구현** — 탭은 버튼 목록(`role="tablist"`/`role="tab"`, `aria-selected`), 색은 theme 토큰만.
  - `docs/deploy-checklist.md` 낚시 절에 2단계 추가: `logic.version` 4, `world` 재배포 후 바로 머지·Vercel, 새로고침 안내, v3로 되돌리지 않기(옛 migrate·옛 화면은 강·숲 어종을 모름 — 옛 탭은 가방에 강·숲 물고기가 있으면 가격 계산에서 멈춤). 수동 확인: 마을 북쪽 길 → 강 → 서쪽 → 숲 → 되돌아오기, 출구에서 깜빡임 없음, 강 다리·강가·연못·폭포에서 각각 던져 지역 어종이 걸림, 강·숲에서 상점 안 열림, 새로고침하면 마지막 지역·위치에서 시작, 도감 지역 탭.
- [ ] **Step 4: 전체 검증** — Run: `npm test && npm run typecheck && npm run build && npm run fn:test` / Expected: 모두 PASS
- [ ] **Step 5: 커밋** — `git add src/games/fishing/Menus.tsx src/games/fishing/fishing.css src/games/fishing/Game.test.tsx docs/deploy-checklist.md && git commit -m "feat: 낚시 도감 지역 탭과 2단계 배포 안내"`

# 펨타듀 낚시 — 큰 지도 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하단 "지도" 버튼(데스크톱 `M`)으로 여는 큰 지도 창을 넣는다. 지역 탭 6개, 축소 그림 위에 레이어(길·낚시 자리)와 필터(지금 잡히는·미발견만), 자리를 누르면 물고기 목록(안 잡은 물고기는 실루엣 + 등급), 잠긴 지역 카드, 지역 단위 가는 길.

**Architecture:** 순수 모듈 `atlas.ts`가 맵 정의·어종·view·조건에서 표시 자리, 낚시 자리 대표점, 물고기 목록·필터, 지역 경로를 계산한다. `minimap.ts`가 칸당 3×3px 무늬 축소 그림을 지역별 PNG 주소로 한 번 만들어 캐시한다. `MapPanel.tsx`는 그 그림(`<img>`) 위에 퍼센트 좌표 `<button>` 표시를 띄우고, 아래에 상세 칸을 둔다. 서버·`logic.version`·`world` 함수는 바꾸지 않는다. 순간이동기·도전과제 표시만 4단계 필드를 쓰며 어댑터 함수 하나(`teleporterInfo`)에 모은다.

**Tech Stack:** TypeScript, React 18, Canvas 2D(오프스크린 → PNG), vitest + Testing Library(jsdom). 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-24-fishing-map-design.md` (전체. §5 화면, §6 계산, §7 4단계 의존)

**선행 조건:** 4단계(도전과제·순간이동기, `logic.version` 8) PR이 main에 머지된 뒤 시작한다. Task 1~4는 4단계와 무관하고, **Task 5만 4단계 인터페이스에 기댄다**(아래 "4단계 가정 이름"). 시작 전에 4단계 머지본에서 가정 이름을 확인하고 다르면 Task 5의 어댑터만 맞춘다.

## Global Constraints

- `atlas.ts`·`map.ts`·`maps/*.ts`·`data.ts`·`clock.ts`는 순수 모듈: React·DOM·`Date.now()`·`Math.random` 없음, 상대 import에 `.ts`. `minimap.ts`만 `document`(오프스크린 캔버스)를 쓴다.
- 서버 변경 없음: `logic.ts`·`data.ts`의 판정·추첨·저장 형식을 바꾸지 않고 `logic.version`을 올리지 않는다. 플랫폼 코드(`src/platform/`, `src/app/`)와 DB도 그대로. (`data.ts`에 화면용 상수를 더할 필요가 생기면 판정에 안 쓰이는 것만, 그래도 `fn:test`를 돌린다.)
- 화면 문구 한국어, 모바일 우선. 패널·칩·버튼 색은 `theme.css` 토큰만. 축소 그림 안 색은 "낚시 캔버스 내부 색" 예외(`minimap.ts` 색표에만 둔다). 표시 그림은 새로 그린 9×9 픽셀 스프라이트(`sprites.ts` 형식)를 `spriteDataUrl`로 쓴다. 원작 지도·아이콘 금지.
- 스포일러 B: 안 잡은 물고기는 실루엣 + 등급(흔함·드묾·희귀·전설) + "지금" 칩만. 이름·`fish-<id>` 그림·조건 문구·필요 낚싯대는 `alt`·`aria-label`·`title` 어디에도 나오지 않는다(`alt="미발견 물고기"`).
- 지도에는 사기·타기·이동 버튼이 없다. 상세의 버튼은 "○○ 지도 보기"(탭 바꾸기)뿐.
- 축소 그림은 지역마다 처음 볼 때 한 번 만든다. 시계가 흐르거나 필터를 바꿔도 다시 만들지 않는다. Game을 떠날 때 `releaseMinimapCache()`.
- 기존 메뉴(가방·상점·도감·해금)의 props·동작 불변. `Game.test`의 기존 테스트는 그대로 통과.
- 커밋 `type: 내용`, 마지막 두 줄 트레일러(Co-Authored-By: <작성 모델 이름> <noreply@anthropic.com> / Claude-Session: https://claude.ai/code/session_01T7oyVpQAuQkbAiCkNHahWh). 경로 지정 스테이징, 푸시 금지.

## 4단계 가정 이름 (Task 5가 쓴다)

| 가정 | 이름·모양 |
|---|---|
| 맵 이동기 | `MapDef.teleporter: { tiles: Rect; front: TileFacing } \| null` (`map.ts`) |
| 맵 세계 원점 | `MapDef.world: { tx: number; ty: number }` — 지도는 직접 쓰지 않는다 |
| 과제 정의 | `CHALLENGES: readonly Challenge[]`, `Challenge = { id; area: AreaId; title; desc; count; filter }` (`data.ts`) |
| 과제 진행 | `View['challenges']: Record<string, { progress: number; seen?: string[]; done: boolean }>` |
| 이동기 열림 | 그 지역 과제의 `done` |
| 요금 | `teleportFee(from: AreaId, to: AreaId): number` (4단계가 둔 순수 모듈) |

다르면: `atlas.ts`의 `teleporterInfo`와 `placeMarkers`의 이동기 줄, `MapPanel` 테스트 픽스처만 고친다. 요금 함수가 없으면 요금 줄을 뺀다(공식을 화면에 다시 쓰지 않는다).

## Review Focus

1. **스포일러 B**: 안 잡은 물고기의 이름·그림·조건이 목록·`alt`·`aria-label` 어디에도 없다. 잠긴 지역 탭은 지형을 그리지 않는다. → Task 1, Task 4
2. **"지금"이 서버와 같은 규칙**: `speciesAvailable(s, area, spot, cond, rodTier)` + 이미 잡은 전설 제외. `cond`는 `Date.now() + offset`(서버 시각 보정)으로, 게임 시각이 바뀌면 열린 창에서도 갱신된다. → Task 1, Task 4
3. **지도가 가리키는 자리가 진짜**: 모든 맵의 모든 자리 대표점이 걸을 수 있는 칸이고 거기서 그 자리 낚시가 된다. 잠긴 문 표시는 `view.areas`로 정해지고 열리면 사라진다. 안 연 지역 출구는 문·선착장 표시로 대신한다. → Task 1, Task 4
4. **렌더 비용**: 축소 그림은 지역당 한 번(`getContext` 호출 수로 검사), 강조 그림은 (지역, 자리)당 한 번, 1초 시계 확인은 시가 바뀔 때만 다시 계산. 떠나면 캐시 해제. → Task 2, Task 4
5. **4단계 필드가 없어도 안 죽음, 지도에서 행동 불가**: `view.challenges` 없음·`map.teleporter` 없음·과제 정의 없음·요금 함수 없음 각각에서 렌더된다. 지도 안 어떤 버튼도 `world()`를 부르지 않는다. → Task 4, Task 5

---

### Task 1: `atlas.ts` — 표시 자리·낚시 자리 대표점·물고기 목록·지역 경로 (순수)

**Files:**
- Create: `src/games/fishing/atlas.ts`
- Test: `src/games/fishing/atlas.test.ts`

**Interfaces:**
- Consumes: `map.ts`의 `MapDef`, `Exit`, `Rect`, `TileFacing`, `Opened`, `ALL_AREAS_OPEN`, `isWalkable`, `interactionAt`, `tileAt`, `shopSpot`, `TILE`, `WATER_KINDS`; `maps/index.ts`의 `MAPS`, `mapFor`; `data.ts`의 `AREAS`, `SPECIES`, `UNLOCKS`, `speciesAvailable`, `Species`, `AreaId`, `Rarity`; `clock.ts`의 `Conditions`, `inHours`; `logic.ts`의 `View`(타입만)
- Produces:
  ```ts
  export const MARKER_GAP = 5 // 칸, 체비셰프 거리
  export type Cell = { tx: number; ty: number }
  export type PlaceMarker =
    | { kind: 'exit'; tx: number; ty: number; target: AreaId; dir: 'n' | 's' | 'e' | 'w' | 'in' }
    | { kind: 'gate'; tx: number; ty: number; area: AreaId }      // 잠긴 동안만
    | { kind: 'dock'; tx: number; ty: number; target: AreaId }    // dock.front
    | { kind: 'shop'; tx: number; ty: number }                    // shopSpot
    | { kind: 'teleporter'; tx: number; ty: number }              // Task 5에서 채움(이 Task에서는 만들지 않음)
  /** 길 레이어 표시. 안 연 지역 출구 중 같은 지역의 문·선착장이 이 맵에 있으면 뺀다. 순서: 출구(정의 순) → 문 → 선착장 → 상점 */
  export function placeMarkers(map: MapDef, opened: Opened): PlaceMarker[]
  /** 진행과 무관한 고정 표시 칸(출구·선착장·상점; Task 5 뒤 이동기 포함). 잠긴 문은 넣지 않는다 */
  export function fixedCells(map: MapDef): Cell[]
  export type SpotAnchor = { spot: string; tx: number; ty: number }
  /** 맵의 자리마다 대표점(AREAS의 spots 순서). 설 자리 = ALL_AREAS_OPEN 기준 걸을 수 있고 네 방향 중 하나에서 interactionAt이 {kind:'fish', spot}. 무게중심 가까운 순으로 fixedCells·앞선 대표점과 MARKER_GAP 이상인 첫 칸, 없으면 무게중심에 가장 가까운 칸. 동점은 (ty, tx) 작은 쪽. 맵 id별 모듈 캐시 */
  export function spotAnchors(map: MapDef): SpotAnchor[]
  /** 설 자리 칸과 그 칸에서 보는 물 칸(중복 없음). 강조 그림용 */
  export function spotTiles(map: MapDef, spot: string): { stands: Cell[]; waters: Cell[] }
  /** 물 칸이고 map.spots에 자리가 있으면 그 자리(부두 옆 바다는 'shore' 같은 물 자리), 아니면 null */
  export function spotAtTile(map: MapDef, tx: number, ty: number): string | null
  export type NotNow = 'legend-done' | 'rod' | 'season' | 'hours' | 'weather'
  export type FishRow = { species: Species; found: boolean; now: boolean; legendDone: boolean; reason: NotNow | null }
  type FishView = Pick<View, 'dex' | 'legends' | 'rodTier'>
  /** 정렬: now 먼저 → 등급(common, uncommon, rare, legend) → SPECIES 순 */
  export function spotFish(area: AreaId, spot: string, view: FishView, cond: Conditions): FishRow[]
  /** 지역 전체. now = 그 지역 자리 중 하나라도 now. reason은 첫 자리 기준이 아니라 "어느 자리에서도 안 되는" 첫 이유 */
  export function areaFish(area: AreaId, view: FishView, cond: Conditions): FishRow[]
  export type FishFilter = { now: boolean; undiscovered: boolean }
  export function filterFish(rows: readonly FishRow[], f: FishFilter): FishRow[]
  /** 필터 둘 다 꺼짐 → '찾음/전체', 하나라도 켜짐 → 통과한 수 */
  export function fishBadge(rows: readonly FishRow[], f: FishFilter): string
  /** 그 지역을 여는 문·선착장이 있는 맵. 기본 지역·모르는 지역은 null */
  export function unlockPlace(area: AreaId): { area: AreaId; kind: 'gate' | 'dock' } | null
  /** 열린 지역만 지나는 최단(지역 수) 경로. 대상이 잠겼으면 path는 unlockPlace 지역까지, unlockAt 채움. 못 가면 path null */
  export function areaRoute(from: AreaId, to: AreaId, opened: Opened): { path: AreaId[] | null; unlockAt: { area: AreaId; kind: 'gate' | 'dock' } | null }
  /** 지금 지역 지도에서 route의 첫 걸음에 해당하는 표시(출구 또는 선착장), 없으면 null */
  export function firstHop(map: MapDef, path: readonly AreaId[] | null): PlaceMarker | null
  ```
- `notNow` 이유 순서: 이미 잡은 전설 → 낚싯대(`minRod > rodTier`) → 계절 → 시간 → 날씨.

- [ ] **Step 1: 실패하는 테스트 작성** (실제 6장 맵 + 합성 `defineMap` 맵)
  - `spotAnchors: 6장 × AREAS의 모든 자리에 대표점이 하나씩 있다; 각 대표점은 isWalkable(ALL_AREAS_OPEN)이고 네 방향 중 하나에서 interactionAt === {kind:'fish', spot}` (Review Focus 3)
  - `spotAnchors: 마을 pier 대표점은 부두(#) 칸, shore 대표점은 부두가 아닌 칸; 동굴 cave1·cave2·cave3 대표점이 서로 다름; 숲 pond·waterfall 다름`
  - `spotAnchors: 실제 6장에서 모든 대표점 쌍·대표점-고정 표시 쌍의 체비셰프 거리 ≥ 3 (목표 MARKER_GAP 5, 3 미만이면 실패)`; 같은 맵에 두 번 부르면 같은 배열(캐시)
  - `spotAnchors 합성: 무게중심 칸이 고정 표시와 2칸이면 그 칸을 건너뛰고 5칸 이상인 다음 칸; 후보가 모두 가까우면 무게중심 칸`
  - `placeMarkers: 강, 기본 지역만 열림 → 남·서 출구 표시 + 잠긴 문(lake) 표시, 북쪽 출구(lake) 표시 없음; lake 열림 → 문 표시 없음, 북쪽 출구 표시(dir 'n')` (Review Focus 3)
  - `placeMarkers: 숲, cave 잠김 → 동굴 안쪽 출구 표시 없음 + 문(cave); 열림 → 출구 dir 'in'`
  - `placeMarkers: 마을 → 북쪽 출구, 선착장(target island, dock.front 칸), 상점(shopSpot 칸); 섬 → 선착장(target village), 출구 없음`
  - `spotAtTile: 강물 칸 → 'river'; 풀 칸 → null; 마을 부두 옆 바다 → 'shore'; 동굴 용암 → 'cave3'; 폭포(falls) → null`
  - `spotTiles: 설 자리는 모두 걸을 수 있고 물 칸은 모두 WATER_KINDS; 마을 pier의 stands는 모두 부두 칸`
  - `spotFish: 마을 해안, 봄 맑음 10시, rod 1 → 고등어(여름~겨울)는 reason 'season', 참돔(rod 2)은 'rod', 망둥어 now; 정렬 now 먼저·등급 순` (Review Focus 2)
  - `spotFish: 다금바리(pier 전설)는 shore 목록에 없고 pier 목록에 있다; legends에 grouper → legendDone·now false·reason 'legend-done'`
  - `spotFish now ⇔ speciesAvailable: 모든 지역 × 자리 × 계절 × 정각 × 날씨 × rod 1·4에서, 전설 안 잡음 상태의 now가 speciesAvailable과 같다` (Review Focus 2)
  - `areaFish: 숲 — 붕어(pond)·버들치(waterfall) 모두; now는 자리 중 하나라도`
  - `filterFish/fishBadge: 필터 없음 '2/5'; now만 → now 수; undiscovered만 → 미발견 수; 둘 다 → 교집합 수(0이면 '0')`
  - `unlockPlace: lake → {river, gate}, cave → {forest, gate}, island → {village, dock}, village → null`
  - `areaRoute: forest→island, 섬 열림 → [forest, river, village, island]; 섬 잠김 → path [forest, river, village], unlockAt {village, dock}; village→village → [village]; cave 잠김에서 cave→village(저장 위치 꼬임) → 경로 계산은 from을 열린 것으로 보고 [cave, forest, river, village]`
  - `firstHop: 마을에서 [village, river, …] → 북쪽 출구 표시; [village, island] → 선착장 표시; null → null`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/atlas.test.ts` / Expected: FAIL (모듈 없음)
- [ ] **Step 3: 구현** — 대표점 캐시는 `Map<AreaId, SpotAnchor[]>`(맵 정의가 바뀌는 테스트가 없도록 맵 객체 동일성도 함께 확인). `interactionAt`의 `opened` 인자는 `ALL_AREAS_OPEN`.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git add src/games/fishing/atlas.ts src/games/fishing/atlas.test.ts && git commit -m "feat: 낚시 지도 계산(표시 자리·낚시 자리·물고기 목록·경로)"`

---

### Task 2: `minimap.ts` — 축소 그림과 강조 그림 캐시

**Files:**
- Create: `src/games/fishing/minimap.ts`
- Test: `src/games/fishing/minimap.test.ts`

**Interfaces:**
- Consumes: `map.ts`의 `MapDef`, `TileKind`, `TILE_CHARS`, `tileAt`; Task 1 `spotTiles`
- Produces:
  ```ts
  export const MINIMAP_PX = 3 // 칸당 px
  /** 타일 종류별 [바탕, 무늬] 색과 3×3 무늬('b' 바탕 / 'm' 무늬). 캔버스 안 색(토큰 예외) */
  export const MINIMAP_LOOK: Readonly<Record<TileKind, { base: string; mark: string; glyph: readonly [string, string, string] }>>
  /** 맵 칸을 MINIMAP_PX 무늬로 ctx에 그린다(테스트용으로 내보냄) */
  export function drawMinimap(ctx: CanvasRenderingContext2D, map: MapDef): void
  /** 맵 id별 PNG 주소. 처음 한 번만 그린다. 2D 컨텍스트를 못 얻으면 null. 그 null도 캐시해 같은 맵을 다시 시도하지 않는다(해제 뒤에는 다시 시도) */
  export function minimapUrl(map: MapDef): string | null
  /** 그 자리 stands·waters 칸을 반투명 밝은 색으로 칠한 투명 PNG. (맵 id, 자리)별 캐시. 실패 시 null */
  export function spotHighlightUrl(map: MapDef, spot: string): string | null
  export function releaseMinimapCache(): void
  /** 표시 배율: max(1, floor(innerWidth / (map.w * MINIMAP_PX))) */
  export function minimapScale(innerWidth: number, map: MapDef): number
  ```
- 그린 뒤 오프스크린 캔버스는 `width = height = 0`으로 바로 놓아 준다.
- 무늬: 나무·야자수 = 가운데 진한 점 + 십자, 바위 = 가운데 점, 꽃 = 한 점, 부두·선착장·다리 = 가로 판자 줄, 건물 = 위 줄, 문 = 가운데 어두운 칸, 울타리 = 가운데 가로줄, 절벽·동굴 벽 = 아래 줄 그림자, 물 종류 = 무늬 없음(바탕만, 종류마다 색이 다름: 바다·강·연못·웅덩이·호수·동굴 웅덩이·수정·용암·석호).

- [ ] **Step 1: 실패하는 테스트 작성**
  - `MINIMAP_LOOK: TILE_CHARS의 모든 kind에 항목; glyph는 3줄 × 3글자, 글자는 b/m만; 물 종류(WATER_KINDS)는 glyph 전부 b; 물 종류끼리 base 색이 서로 다름`
  - `drawMinimap: 기록용 가짜 ctx(fillStyle·fillRect 기록)로 2×1 합성 맵('~T') → 모든 fillRect가 [0, 6)×[0, 3) 안, 나무 칸에 mark 색 칠하기가 있다`
  - `minimapUrl: getContext가 가짜 ctx(fillRect·toDataURL 있는 캔버스)를 주면 'data:' 주소; 같은 맵 두 번 → getContext 호출 1번(캐시); 다른 맵 → 1번 더; releaseMinimapCache 뒤 같은 맵 → 다시 그림` (Review Focus 4)
  - `minimapUrl: getContext가 null → null, 예외 없음`
  - `spotHighlightUrl: (마을, pier)·(마을, shore) 각각 한 번씩만 그림; 모르는 자리 → 빈 그림이 아니라 null`
  - `minimapScale: 48칸 맵, 폭 300 → 2; 폭 100 → 1; 폭 600 → 4`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/minimap.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 6장을 PNG로 뽑아(저장소 밖 스크립트, 예: `/tmp/minimap-preview/<area>.png`, 배율 3) 눈으로 확인하고 보고서에 경로를 적는다.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git add src/games/fishing/minimap.ts src/games/fishing/minimap.test.ts && git commit -m "feat: 낚시 지도 축소 그림"`

---

### Task 3: 표시 스프라이트 7개

**Files:**
- Modify: `src/games/fishing/sprites.ts`
- Test: `src/games/fishing/sprites.test.ts`

**Interfaces:**
- Produces: 9×9 스프라이트 `map-you`(위에서 본 사람 머리·밝은 테두리), `map-spot`(물결 동그라미), `map-exit`(화살 표지판), `map-gate`(자물쇠), `map-dock`(작은 돛배), `map-shop`(지붕 있는 집), `map-teleporter`(4단계 이동기 구조물과 닮은 작은 신호기 — 4단계 그림을 보고 맞춘다, 원작 오벨리스크와 닮지 않게). 모두 어두운 외곽선 1px로 축소 그림 위에서 눈에 띄게.
- 현재 위치 방향은 그림을 돌리지 않고 MapPanel에서 CSS로 작은 삼각형(토큰 색)을 붙인다.

- [ ] **Step 1: 실패하는 테스트 작성** — `7개 존재, 9×9, 서로 다름, 외곽선(테두리 픽셀 중 어두운 색 비율 ≥ 절반)`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/sprites.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — PNG로 렌더해 확인, 보고서에 경로.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing/sprites.test.ts` / Expected: PASS
- [ ] **Step 5: 커밋** — `git add src/games/fishing/sprites.ts src/games/fishing/sprites.test.ts && git commit -m "feat: 낚시 지도 표시 그림"`

---

### Task 4: `MapPanel.tsx`와 Game 연결 — 탭·레이어·필터·상세·잠긴 지역·가는 길

**Files:**
- Create: `src/games/fishing/MapPanel.tsx`
- Modify: `src/games/fishing/Game.tsx`(메뉴 `'map'`, 지도 버튼, `M` 키, 레이어 상태, 떠날 때 캐시 해제), `src/games/fishing/Menus.tsx`(`SPOT_NAMES` export만), `src/games/fishing/fishing.css`
- Test: `src/games/fishing/MapPanel.test.tsx`, `src/games/fishing/Game.test.tsx`(지도 버튼 몇 개만 추가, 기존 테스트 불변)

**Interfaces:**
- Consumes: Task 1 전부, Task 2 `minimapUrl`·`spotHighlightUrl`·`minimapScale`·`releaseMinimapCache`, Task 3 스프라이트, `Menus.tsx`의 `conditionLabel`·`SPOT_NAMES`, `clock.ts`의 `conditionsAt`·`formatClock`·`SEASON_NAMES`·`isSnow`, `data.ts`의 `AREAS`·`UNLOCKS`·`RODS`
- Produces:
  ```ts
  export type MapLayers = { paths: boolean; spots: boolean; now: boolean; undiscovered: boolean }
  export const DEFAULT_LAYERS: MapLayers // { paths: true, spots: true, now: false, undiscovered: false }
  export const RARITY_NAMES: Record<Rarity, string> // 흔함·드묾·희귀·전설
  type MapPanelProps = {
    view: View
    /** 지금 지역과 캐릭터 칸(창을 열 때의 값) */
    here: { area: AreaId; tx: number; ty: number; facing: Facing }
    /** 서버 보정 시각(ms): () => Date.now() + rt.offset */
    now(): number
    /** 패널 안쪽 폭(css px). 축소 그림 정수 배율 계산용 */
    innerWidth: number
    layers: MapLayers
    onLayers(next: MapLayers): void
  }
  export function MapPanel(props: MapPanelProps): JSX.Element
  ```
- 동작 (설계 §5):
  - 머리줄: `봄 · 맑음 · 14:30 · 대나무 낚싯대`(겨울 비는 "눈"). 1초 간격으로 `conditionsAt(now())`를 보고 `(gameDay, 시, 계절, 날씨)`가 바뀔 때만 상태를 바꾼다(타이머는 언마운트 때 정리).
  - 탭: `AREAS` 순, `role="tablist"`/`role="tab"`, 처음엔 `here.area`. 열린 지역은 `이름 배지`, 잠긴 지역은 `이름 · 잠김`.
  - 칩: "보기" 길·낚시 자리, "물고기" 지금 잡히는·미발견만. `aria-pressed`.
  - 열린 지역: `<div class="fish-map" style="aspect-ratio: w / h; width: w*3*k px">` 안에 `<img src={minimapUrl}>`(null이면 생략, 토큰 바탕만), 고른 자리면 강조 `<img>`, 그 위 표시 버튼(`left/top` %). `here.area` 탭에서만 현재 위치 표시. 지도 그림 클릭 → 좌표를 칸으로 바꿔 `spotAtTile`이 자리를 주면 그 자리 선택.
  - 자리 칩 줄(낚시 자리 레이어가 켜졌을 때): `SPOT_NAMES[spot] 배지`, 표시와 같은 선택.
  - 상세: 선택 없음 → 지역 요약 + (다른 지역이면) "가는 길: A → B → (배) C" + 이동기 문구(Task 5). 자리 → `spotFish` + 필터 결과 목록(설계 §5.4 표 그대로). 출구 → "○○로 가는 길 · 북쪽" + [○○ 지도 보기]. 잠긴 문 → `UNLOCKS` 이름·가격·보유 골드 + "문 앞에서 열 수 있어요". 선착장 → 잠김이면 배 가격, 열림이면 "무료 왕복". 상점 → 한 줄.
  - 지금 지역 탭에서 마지막으로 본 다른 지역 탭의 경로가 있으면 `firstHop` 표시에 강조 클래스.
  - 잠긴 지역 탭: 축소 그림·표시 없이 잠김 카드(설계 §5.5) + [○○ 지도 보기](그 탭으로 가며 문/선착장 표시 선택) + `areaFish` 실루엣 목록(필터 적용).
  - 버튼 어디에도 `world()` 호출 없음.
- Game.tsx:
  - `type Menu = … | 'map'`, 패널 제목 '지도', 하단 `가방 · 도감 · 지도` 다음 전체화면. 낚시 중 `menuLocked`로 막힘.
  - `KeyM` keydown: 입력칸·낚시 중·다른 메뉴 열림이면 무시, 지도 열림이면 닫기, 아니면 열기.
  - 레이어 상태 `useState(DEFAULT_LAYERS)`(창을 닫아도 유지). `here`는 열 때 `rt.map.id`·`tileOf(rt.player.pos)`·`rt.player.facing`. `innerWidth = fit.w * fit.scale - 24`(패널 좌우 여백).
  - 언마운트 정리에 `releaseMinimapCache()` 추가(`releaseSceneCache` 옆).
- CSS: `.fish-map`(position relative, 토큰 바탕·테두리), `.fish-map img`(absolute inset 0, 100%, `image-rendering: pixelated`), `.fish-map-marker`(28×28 투명 버튼, translate(-50%, -50%), 포커스 링 토큰), `.fish-map-marker-dim`, `.fish-map-marker-hop`, `.fish-map-badge`, `.fish-map-chips`, 탭은 `.fish-dex-tabs`/`.fish-dex-tab` 재사용(가로 스크롤), `.fish-menu { flex-wrap: wrap }`.

- [ ] **Step 1: 실패하는 테스트 작성** (`MapPanel.test.tsx`: `vi.mock('./minimap.ts')`로 `minimapUrl`→`'data:mini'`, `spotHighlightUrl`→`'data:hl'`, `minimapScale`→2; `vi.mock('./sprites.ts')`는 Game.test와 같은 방식; 가짜 타이머)
  - `처음 탭은 here.area; 탭 6개, 잠긴 지역은 '산 호수 · 잠김'`
  - `기본 레이어: 마을 탭에 상점·출구(강)·선착장 표시와 낚시 자리 표시 pier·shore, 현재 위치 표시(aria-label '현재 위치'); 길 끄면 상점·출구·선착장 표시 없음, 현재 위치는 남음; 낚시 자리 끄면 자리 표시·칩 없음`
  - `해안 자리 누르면 목록: 잡은 망둥어는 이름·조건, 안 잡은 물고기는 alt '미발견 물고기'·'???'·등급 이름; 안 잡은 물고기의 이름·fish-<id>(실루엣 아님) 그림·conditionLabel 문구가 패널 텍스트·alt·aria-label 어디에도 없다` (Review Focus 1)
  - `필터 지금: 봄 10시(가짜 시각) → 고등어 없음, 망둥어 있음; 시스템 시각을 게임 시간이 바뀌도록 진행(advanceTimersByTime) → 목록·머리줄 시각 갱신` (Review Focus 2)
  - `필터 지금+미발견: 배지가 교집합 수, 0인 자리 표시에 흐림 클래스`
  - `강 탭, lake 잠김 → 잠긴 문 표시, 누르면 '무너진 다리 수리'·'5,000 G'·보유 골드, 버튼은 '… 지도 보기' 말고 없음; view.areas에 lake → 문 표시 없고 북쪽 출구 표시` (Review Focus 3, 5)
  - `산 호수 탭(잠김): 지도 그림(img) 없음, 잠김 카드에 '마을 강'·'5,000 G', [마을 강 지도 보기] → 강 탭으로 바뀌고 문 표시 선택됨; 실루엣 목록만` (Review Focus 1)
  - `숲에서 섬 탭(섬 열림) → '가는 길' 숲 → 마을 강 → 바닷가 마을 → 섬; 숲 탭으로 돌아가면 강으로 가는 출구 표시에 강조 클래스`
  - `지도 그림을 강물 칸 위치로 클릭 → 강 자리 선택`
  - `패널 어떤 버튼을 눌러도 world 목이 불리지 않는다` (Review Focus 5)
  - `minimapUrl이 null → img 없이 표시 버튼은 그대로` (Review Focus 4)
  - Game.test: `지도 버튼으로 열고 닫기, 제목 '지도'; 낚시 중(fighting) 지도 버튼 비활성; KeyM으로 열고 닫기, 메뉴(가방) 열려 있으면 KeyM 무시; 레이어를 끄고 닫았다 다시 열면 꺼진 그대로; 언마운트 시 releaseMinimapCache 호출` (`vi.mock('./minimap.ts')` 추가)
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing` / Expected: FAIL
- [ ] **Step 3: 구현** — 패널 색은 토큰만. 폰 폭(360·320px)과 데스크톱(1280px)에서 `npm run dev`로 눈으로 확인(지도가 패널 폭 안, 하단 메뉴 넘치면 줄바꿈).
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git add src/games/fishing/MapPanel.tsx src/games/fishing/MapPanel.test.tsx src/games/fishing/Game.tsx src/games/fishing/Game.test.tsx src/games/fishing/Menus.tsx src/games/fishing/fishing.css && git commit -m "feat: 낚시 큰 지도 창(탭·레이어·필터·물고기 목록)"`

---

### Task 5: 순간이동기 표시와 도전과제 안내 **(4단계 의존)**

**Files:**
- Modify: `src/games/fishing/atlas.ts`, `src/games/fishing/MapPanel.tsx`
- Test: `src/games/fishing/atlas.test.ts`, `src/games/fishing/MapPanel.test.tsx`

**Interfaces:**
- Consumes (4단계, 가정 이름 — 위 표): `MapDef.teleporter`, `CHALLENGES`, `View['challenges']`, `teleportFee`
- Produces:
  ```ts
  export type TeleporterInfo = {
    open: boolean
    /** 그 지역 과제. CHALLENGES에 없으면 null */
    challenge: { title: string; desc: string; progress: number; count: number; done: boolean } | null
    /** 지금 지역 이동기에서 오는 요금. 두 이동기 모두 열림이고 요금 함수가 있을 때만, 같은 지역이면 null */
    feeFromHere: number | null
  }
  /** 그 지역 맵에 이동기가 없으면 null. view.challenges가 없으면 모두 잠김·진행 0 */
  export function teleporterInfo(area: AreaId, view: Pick<View, 'challenges'> | { challenges?: undefined }, here: AreaId): TeleporterInfo | null
  ```
  - `placeMarkers`: `map.teleporter`가 있으면 `{ kind: 'teleporter' }`를 `tiles` 가운데 칸에(없으면 `front`), 상점 다음 순서. `fixedCells`에도 넣는다(자리 대표점이 이동기와 겹치지 않게 — 대표점 캐시 결과가 바뀔 수 있으니 Task 1 대표점 테스트를 다시 돌린다).
  - MapPanel 상세: 이동기 → "순간이동기 · 열림" + (요금 있으면) "여기 이동기에서 오면 N G" / "순간이동기 · 잠김" + 과제 제목·설명·`진행 p/count`. 과제 없으면 "잠김"만. 이동 버튼 없음.
  - 가는 길 문구: `areaRoute` 결과 뒤에, 지금 지역과 대상 지역 이동기가 모두 열렸으면 "순간이동기로도 갈 수 있어요".
- 4단계 실제 이름이 다르면 이 Task의 어댑터·픽스처만 고친다(보고서에 실제 이름을 적는다).

- [ ] **Step 1: 실패하는 테스트 작성**
  - `teleporterInfo: 과제 done → open true; 진행 중 → open false, progress/count; view.challenges 없음 → open false, progress 0 (예외 없음); 이동기 없는 맵(합성 MAPS 목 또는 teleporter null) → null` (Review Focus 5)
  - `teleporterInfo feeFromHere: 두 지역 모두 열림 → teleportFee(here, area)와 같은 값; 지금 지역 잠김 → null; here === area → null`
  - `placeMarkers: 이동기가 있는 맵에 teleporter 표시 1개(tiles 가운데 칸); spotAnchors 거리 검사(≥3) 6장 다시 통과`
  - `MapPanel: 이동기 표시 누르면 잠김·과제 제목·'진행 2/5'; done이면 '열림'과 요금 줄; challenges 없는 view로도 렌더되고 '잠김'; 이동기 상세에 버튼 없음` (Review Focus 5)
  - `MapPanel 가는 길: 두 이동기 열림 → '순간이동기로도 갈 수 있어요'`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/atlas.test.ts src/games/fishing/MapPanel.test.tsx` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git add src/games/fishing/atlas.ts src/games/fishing/atlas.test.ts src/games/fishing/MapPanel.tsx src/games/fishing/MapPanel.test.tsx && git commit -m "feat: 낚시 지도 순간이동기·도전과제 안내"`

---

### Task 6: 배포 체크리스트와 전체 검증

**Files:**
- Modify: `docs/deploy-checklist.md`

- [ ] **Step 1: 체크리스트 추가** — 낚시 절 4단계 항목 뒤에 "큰 지도": 서버 변경 없음(`logic.version` 그대로, `world` 재배포 불필요), Vercel 배포 뒤 새로고침 안내. 수동 확인: 폰(360px)에서 지도 버튼으로 열림·지도가 패널 폭 안·정수 배로 또렷함, 하단 메뉴 줄바꿈 정상(320px), 탭 6개와 잠긴 지역 카드(가격·어디서), 마을에서 상점·출구·선착장·부두·해안 표시, 해안 누르면 안 잡은 물고기가 실루엣·등급만, "지금 잡히는"을 켜고 1분 기다리면 시각과 목록이 바뀜, 강 북쪽 다리 해금 뒤 문 표시가 사라지고 출구 표시, 다른 지역 탭의 가는 길과 첫 출구 강조, 순간이동기 잠김·과제 진행·열린 뒤 요금 줄, 데스크톱 `M` 키, 지도 탭을 오가도 끊김 없음.
- [ ] **Step 2: 전체 검증** — Run: `npm test && npm run typecheck && npm run build` / Expected: 모두 PASS. (`logic.ts`·`data.ts`·`supabase/functions/`를 바꾸지 않았으면 `fn:test`는 필요 없다. 바꿨다면 `npm run fn:test`도.)
- [ ] **Step 3: 서버 불변 확인** — Run: `git diff --stat origin/main -- src/games/fishing/logic.ts src/games/fishing/data.ts supabase/` / Expected: 출력 없음 (Global Constraints)
- [ ] **Step 4: 커밋** — `git add docs/deploy-checklist.md && git commit -m "docs: 낚시 큰 지도 배포 안내"`

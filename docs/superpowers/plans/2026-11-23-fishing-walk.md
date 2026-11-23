# 펨타듀 낚시 — 걸어 다니는 마을 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고정 부두 화면을 타일맵 마을로 바꿔, 캐릭터가 걸어 다니며 물가 어디서나 낚시하고 상점 건물 앞에서만 판매·구매하게 한다.

**Architecture:** 순수 모듈 `map.ts`(타일맵·상호작용·찌 위치)와 `walk.ts`(이동·충돌·카메라·입력 벡터)를 새로 두고, `scene.ts`는 고정 장면 대신 카메라로 잘라 그리는 타일맵 렌더러가 된다. 서버 규칙은 `cast`의 `spot`(부두 보너스)과 가방 업그레이드만 추가된다(로직 버전 2). 플랫폼·`world` 함수 코드는 바뀌지 않는다.

**Tech Stack:** TypeScript, React 18, Canvas 2D, vitest. 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-23-fishing-walk-design.md`

## Global Constraints

- 플랫폼 코드(`src/platform/`, `src/app/`, `supabase/functions/`)는 바꾸지 않는다. 게임 id 분기 금지.
- `src/games/fishing/{data,logic,manifest,map,walk}.ts`는 순수 함수, 외부 의존 없음, 상대 import에 `.ts` 확장자 (Deno가 `logic.ts`·`data.ts`를 import한다). React import 금지.
- 화면 문구는 한국어, 모바일 우선. 캔버스 밖 색은 `theme.css` 토큰만. 캔버스 내부는 자체 팔레트.
- 그림은 전부 새로 그린다. 원작 게임의 그림·맵을 옮기지 않는다.
- 새 npm 의존성 금지. DB·플랫폼 변경 없음.
- 커밋 `type: 내용`, 마지막 두 줄 트레일러(Co-Authored-By: <작성 모델 이름> <noreply@anthropic.com> / Claude-Session: https://claude.ai/code/session_01T7oyVpQAuQkbAiCkNHahWh). 경로 지정 스테이징, 푸시 금지.
- 이동 속도 48px/s(초당 3타일), 타일 16px, 프레임 간격 상한은 `minigame.ts`의 `MAX_DT_MS`(50).
- 가방 20/30/40칸, 가격 0/800/5,000 G. 부두 보너스: 크기 추첨 세기 `min(1.25, power + 0.25)`.
- 부두 끝 ↔ 상점 문 앞 최단 경로 30~45타일.

## Review Focus

1. **두 손가락 동시 조작**: 한 손가락으로 조이스틱을 밀면서 다른 손가락으로 행동 버튼을 누른다 → 이동과 행동이 서로를 끊지 않는다(포인터 id별 처리). → Task 6
2. **저장된 위치가 못 쓰는 값**: localStorage가 깨졌거나 맵이 바뀌어 저장 위치가 걸을 수 없는 타일 → 시작 위치에서 시작. → Task 6 (`position.ts`)
3. **배포 사이 구버전 클라이언트**: `spot` 없는 `cast`, `bagTier` 없는 세이브 → shore로 처리, 20칸으로 이어짐. → Task 1
4. **충전 중 조이스틱 입력**: 게이지를 모으는 동안 조이스틱을 밀어도 캐릭터가 움직이거나 방향이 바뀌지 않는다(찌가 엉뚱한 곳에 떨어지지 않게). → Task 6
5. **물가에서 가방이 가득 참**: 낚시 버튼을 누르면 서버 `bag_full` → "상점에 가서 팔아 주세요" 안내(상점 열기 버튼 없음). → Task 6

---

## File Structure

| 파일 | 책임 |
|---|---|
| `data.ts` (수정) | `BAGS`, `bagSize()`, `PIER_POWER_BONUS`; `BAG_SIZE` 제거 |
| `logic.ts` (수정) | `rollCatch` 크기 보너스 인자, `spot`, `bagTier`, `buyBag`, version 2, migrate |
| `map.ts` (신규) | 맵 격자, 타일 종류, 걷기 가능, 상호작용, 찌 위치, 시작·상점·부두 끝 좌표 |
| `walk.ts` (신규) | 이동·충돌, 방향, 입력 벡터, 카메라 |
| `sprites.ts` (수정) | 마을 타일, 상점 건물, 4방향 캐릭터, 좌우 반전 그리기 |
| `scene.ts` (교체) | 타일맵+카메라 렌더러 `drawWorld`, 정적 레이어 캐시, HUD |
| `position.ts` (신규) | 마지막 위치 localStorage 저장·복원 |
| `Controls.tsx` (신규) | 조이스틱·행동 버튼 (터치) |
| `Game.tsx`, `Menus.tsx`, `fishing.css` (수정) | 이동 루프, 입력, 상호작용, 상점 위치 제한, 가방 업그레이드 메뉴 |

모든 경로는 `src/games/fishing/` 아래.

---

### Task 1: 서버 규칙 — 부두 보너스, 가방 업그레이드, 버전 2

**Files:** Modify `data.ts`, `logic.ts`, `logic.test.ts`, `Menus.tsx`(BAG_SIZE 사용처만 `bagSize(view.bagTier)`로), `Game.tsx`(같은 이유로 사용처만), `supabase/functions/world/handler.test.ts`

**Interfaces — Produces:**
```ts
// data.ts
export const BAGS: readonly { tier: 1 | 2 | 3; size: number; price: number }[]  // [{1,20,0},{2,30,800},{3,40,5000}]
export function bagSize(tier: number): number   // 모르는 tier → 20
export const PIER_POWER_BONUS = 0.25
// logic.ts
export function rollCatch(rng: () => number, rodTier: 1|2|3|4, power: number, sizeBonus?: number): Catch
//   크기 추첨에만 min(1.25, power + (sizeBonus ?? 0)) 사용. rng 호출 순서·횟수 불변.
State 에 bagTier: 1 | 2 | 3 추가
Action: { type: 'cast'; area: string; power: number; spot?: 'pier' | 'shore' } | ... | { type: 'buyBag'; tier: number }
logic.version === 2
```

- [ ] **Step 1: 실패하는 테스트 작성** (`logic.test.ts`)
  - `cast without spot and with spot 'shore' and spot 'zzz' give identical pending (same seed)`
  - `pier spot raises mean size percentile`: power 0.5, 같은 시드 3,000번씩, pier 평균 백분위 > shore 평균 + 0.05
  - `rollCatch calls rng the same number of times with or without bonus` (rng를 감싸 호출 수 세기)
  - `buyBag 1→2 at 800 gold leaves 0 gold, bagTier 2, totalEarned unchanged`; 799 → `not_enough_gold`; tier 3 건너뛰기·`'2'`·`2.5`·현재 tier → `bad_tier`; 3단계에서 4 → `bad_tier`
  - `bagTier 2 allows the 21st..30th fish and rejects the 31st cast with bag_full`
  - `migrate v1 save without bagTier → bagTier 1, gold/dex/rodTier kept`; `bagTier: 7` → 1
  - `errors never mutate input` 목록에 buyBag 오류 경로 추가
  - `view exposes bagTier`
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing/logic.test.ts` → FAIL
- [ ] **Step 3: 구현.** `init()`에 `bagTier: 1`. `cast`는 `spot === 'pier'`일 때만 `PIER_POWER_BONUS`. `bag_full` 판정은 `bagSize(state.bagTier)`.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/fishing && npm run typecheck` → PASS
- [ ] **Step 5: 함수 한 바퀴 테스트 갱신** — `handler.test.ts`의 실제 등록부 테스트에서 cast payload에 `spot: 'pier'`를 넣고, sell 뒤 `buyBag { tier: 2 }`를 보내 골드가 800 미만이면 400 `not_enough_gold`가 오는지 확인. `npm run fn:test` → world 포함 전부 PASS
- [ ] **Step 6: Commit** — `feat: 낚시 부두 보너스와 가방 업그레이드 (로직 버전 2)`

### Task 2: 타일맵 — `map.ts`

**Files:** Create `map.ts`, `map.test.ts`

**Interfaces — Produces:**
```ts
export const TILE = 16
export type TileKind = 'water' | 'sand' | 'grass' | 'path' | 'pier' | 'tree' | 'flower' | 'fence' | 'rock' | 'building' | 'door'
export type Facing = 'up' | 'down' | 'left' | 'right'
export type Vec = { x: number; y: number }            // 월드 픽셀. 캐릭터 pos는 발 중앙
export const MAP_ROWS: readonly string[]               // 가로 40~56, 세로 30~40
export const MAP_W: number; export const MAP_H: number // 타일 수
export const TILE_CHARS: Readonly<Record<string, TileKind>>
export function tileAt(tx: number, ty: number): TileKind | null   // 맵 밖 null
export function isWalkable(tx: number, ty: number): boolean      // sand grass path pier flower만 true
export function tileOf(pos: Vec): { tx: number; ty: number }     // floor(pos / 16)
export const SPAWN: { pos: Vec; facing: Facing }                 // 상점 문 앞 타일 중앙, facing 'down'
export const SHOP_SPOT: { tx: number; ty: number }               // 문 바로 아래 타일
export const PIER_END: { tx: number; ty: number }                // 부두 맨 끝 타일
export type Interaction = { kind: 'shop' } | { kind: 'fish'; spot: 'pier' | 'shore' } | null
export function interactionAt(pos: Vec, facing: Facing): Interaction
//   서 있는 타일 = tileOf(pos), 앞 타일 = 서 있는 타일 + facing.
//   앞이 door이고 facing 'up' → shop. 앞이 water → fish (서 있는 타일이 pier면 'pier'). 그 외 null.
export function castTarget(pos: Vec, facing: Facing, power: number): Vec
//   거리 = (1.5 + 3.5 * clamp(power,0,1)) 타일, 발에서 facing 방향.
//   앞 타일부터 한 타일씩 나아가며, 물이 아닌 타일을 만나기 직전 물 타일에서 멈춘다. 반환은 그 타일의 중앙(거리 끝 타일이면 그 지점).
```
맵 배치와 꾸밈은 구현자 재량(스펙 4.1·4.2). 맵 밖 테두리는 걸을 수 없어야 한다.

- [ ] **Step 1: 실패하는 테스트 작성** (`map.test.ts`)
  - 모든 줄 길이 === `MAP_W`, 줄 수 === `MAP_H`, 40 ≤ MAP_W ≤ 56, 30 ≤ MAP_H ≤ 40, 모든 글자가 `TILE_CHARS`에 있다
  - 테두리 타일은 전부 `isWalkable === false`
  - `SPAWN` 타일은 걸을 수 있고 `interactionAt(SPAWN.pos, 'up')`이 `{ kind: 'shop' }`
  - 맵 전체에서 `interactionAt(tile center, 'up')`이 shop인 타일은 `SHOP_SPOT` 하나뿐
  - `interactionAt(PIER_END center, 'down')` → `{ kind: 'fish', spot: 'pier' }`
  - 모래 타일 중 아래가 물인 타일 하나를 찾아 `'down'` → `{ kind: 'fish', spot: 'shore' }`, `'up'` → null
  - BFS(4방향, `isWalkable`): SPAWN에서 PIER_END와 물에 닿은 모든 걷기 타일에 도달 가능
  - BFS 최단 경로 PIER_END ↔ SHOP_SPOT 길이(타일 수)가 30 이상 45 이하
  - `castTarget(PIER_END center, 'down', 0)`은 발에서 1.5타일 거리, `power 1`은 5타일 거리(둘 다 물 위); 앞에 물 한 칸 뒤 육지가 있는 지점에서는 그 물 한 칸의 중앙
  - `tileAt(-1, 0) === null`, `isWalkable(MAP_W, 0) === false`
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing/map.test.ts` → FAIL
- [ ] **Step 3: 구현** (맵을 직접 그린다)
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS
- [ ] **Step 5: Commit** — `feat: 낚시 마을 타일맵과 상호작용 판정`

### Task 3: 이동·카메라 — `walk.ts`

**Files:** Create `walk.ts`, `walk.test.ts`

**Interfaces — Consumes:** Task 2 `isWalkable`, `TILE`, `Vec`, `Facing`, `MAP_W`, `MAP_H`; `MAX_DT_MS`(minigame.ts). **Produces:**
```ts
export const WALK_SPEED = 48                       // px/s
export const FEET = { w: 10, h: 6 }                // pos 중심의 발 사각형
export type Player = { pos: Vec; facing: Facing; moving: boolean; walkMs: number }
export type MoveInput = { x: number; y: number }   // 길이 ≤ 1
export function joystickVector(dx: number, dy: number, radius: number): MoveInput  // 원 밖은 길이 1로, 길이 < 0.15는 {0,0}
export function keysVector(k: { up: boolean; down: boolean; left: boolean; right: boolean }): MoveInput  // 대각선 정규화
export function stepWalk(p: Player, input: MoveInput, dtMs: number): Player
//   dt = clamp(dtMs, 0, MAX_DT_MS). x축 먼저 이동→발 사각형이 걸을 수 없는 타일과 겹치면 x 이동 취소, 이어서 y축 같은 방식(벽 따라 미끄러짐).
//   입력 길이 > 0이면 facing = |x| >= |y| ? (x<0?'left':'right') : (y<0?'up':'down'), moving true, walkMs += dt. 입력 0이면 facing 유지, moving false, walkMs 0.
export function cameraFor(target: Vec, view: { w: number; h: number }): Vec
//   맵 픽셀 크기 (MAP_W*16, MAP_H*16). 각 축: 맵 ≥ 화면이면 clamp(round(target - view/2), 0, map - view); 맵 < 화면이면 -floor((view - map)/2). 정수 반환.
```

- [ ] **Step 1: 실패하는 테스트 작성** (`walk.test.ts`; 위치는 `map.ts`의 SPAWN·PIER_END와 맵을 탐색해 찾은 타일로 잡는다, 숫자 좌표를 하드코딩하지 않는다)
  - `keysVector({up,right})` ≈ `{ x: 0.7071, y: -0.7071 }` (소수 4자리)
  - `joystickVector(0, 100, 50)` → `{0, 1}`; `(3, 0, 50)` → `{0, 0}`; `(25, 0, 50)` → `{0.5, 0}`
  - 넓은 걷기 영역에서 대각선 입력 50ms×20번 → 이동 거리 48 ± 0.5
  - 물을 향해(아래) 걸으면 발 사각형이 물 타일과 겹치지 않는 지점에서 멈춤; 물 쪽으로 대각선 입력이면 x는 계속 움직임
  - 어떤 입력으로 60초를 돌려도 발 사각형이 걸을 수 없는 타일과 겹치지 않고 맵 안에 있다 (시드 고정 무작위 입력)
  - `stepWalk(p, in, 5000)`의 결과가 `stepWalk(p, in, 50)`과 같다
  - 입력 0 → facing 유지, moving false
  - `cameraFor({x:0,y:0}, {w:195,h:280})` → `{0, 0}`; 맵 오른쪽 아래 끝 → `{mapW-195, mapH-280}`; view가 맵보다 넓은 축(예: w 2000) → `-floor((2000-mapW)/2)`
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing/walk.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: Commit** — `feat: 낚시 마을 이동·충돌·카메라`

### Task 4: 그림 — 마을 타일과 4방향 캐릭터

**Files:** Modify `sprites.ts`, `sprites.test.ts`

**Interfaces — Produces:**
- `drawSprite(ctx, name, x, y, scale, opts?: { silhouette?: boolean; flipX?: boolean })` — `flipX` 추가. `spriteDataUrl`은 그대로.
- 새 키(전부 필수):
  - 캐릭터 16×24: `player-idle-down`(기존 `player-idle`과 같은 그림이어도 됨), `player-walk-down-0`, `player-walk-down-1`, `player-idle-up`, `player-walk-up-0`, `player-walk-up-1`, `player-idle-side`, `player-walk-side-0`, `player-walk-side-1`(오른쪽을 봄; 왼쪽은 flipX), `player-cast-up`, `player-reel-up`, `player-cast-side`, `player-reel-side`. 기존 `player-cast`, `player-reel`은 아래 방향으로 계속 쓴다.
  - 타일 16×16: `tile-grass`, `tile-grass-alt`, `tile-path`, `tile-sand`, `tile-flower`, `tile-rock`, `tile-fence`
  - 나무 16×32: `tile-tree` (아래 16px가 자기 타일, 위 16px는 윗칸에 겹쳐 그림)
  - 상점 건물: `shop` — 너비·높이는 16의 배수, 문이 아래 가운데. 맵의 `building`/`door` 타일 배치와 크기가 맞아야 한다(Task 5가 맵에서 건물 좌상단을 찾아 한 번에 그린다).
- 원작의 그림을 옮기지 않는다. 기존 캐릭터의 옷·색을 이어 간다.

- [ ] **Step 1: 실패하는 테스트 추가** (`sprites.test.ts`): 위 키가 모두 있다, 크기(캐릭터 16×24, 타일 16×16, 나무 16×32, shop의 w·h가 16의 배수), 팔레트 무결성(기존 검사에 자동 포함), 걷기 프레임 0과 1의 rows가 서로 다르다(세 방향 모두)
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing/sprites.test.ts` → FAIL
- [ ] **Step 3: 그린다. `flipX` 구현**
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 미리보기** — 커밋하지 않는 스크립트(저장소 밖, Pillow 사용 가능)로 새 스프라이트 전부를 확대한 시트를 PNG로 뽑아 확인. `/home/claude/onlyfms/.superpowers/sdd/2026-11-23-fishing-walk/preview/sprites.png`
- [ ] **Step 6: Commit** — `feat: 낚시 마을 타일과 4방향 캐릭터 그림`

### Task 5: 장면 — 타일맵 렌더러

**Files:** Replace `scene.ts` contents, replace `scene.test.ts`

**Interfaces — Consumes:** Task 2·3·4. **Produces:**
```ts
export type Phase = 'idle' | 'charging' | 'waiting' | 'bite' | 'fighting' | 'caught' | 'lost'   // 그대로
export type WorldScene = {
  phase: Phase; tMs: number; gauge: number
  player: Player; camera: Vec
  bobber: Vec | null                 // 월드 픽셀. waiting/bite/fighting에서 그림
  bar: Bar | null; barParams: BarParams | null; caughtSpecies: string | null
}
export type SceneSize = { w: number; h: number }   // 그대로
export function drawWorld(ctx: CanvasRenderingContext2D, s: WorldScene, size: SceneSize): void
export function releaseSceneCache(): void           // 그대로
export function hudSide(playerScreenX: number, w: number): 'left' | 'right'   // 캐릭터가 왼쪽 절반이면 'right'
```
- 기존 `drawScene`, `layout`, `SceneState`, 고정 부두 장면 코드는 지운다(사용처는 Task 6이 바꾼다; 이 태스크에서 `Game.tsx`가 컴파일되도록 임시로 `drawWorld` 호출로 바꾸고, 캐릭터는 SPAWN에 고정된 채로 둔다).
- 정적 레이어: 맵 전체(타일, 모래·물 경계의 거품, 상점, 나무 아래칸)를 물 프레임 2장 분량으로 오프스크린에 한 번 그리고, 매 프레임 카메라 영역만 `drawImage`로 잘라 그린다. 2D 컨텍스트가 없으면(jsdom) 화면에 보이는 타일만 직접 그린다.
- 그리는 순서: 정적 레이어 → 찌·낚싯줄 → 캐릭터와 나무 윗부분을 발 y 기준으로 정렬(캐릭터가 나무 밑동보다 위에 있으면 나무 윗부분이 캐릭터를 가린다) → 입질 느낌표(찌 위) → HUD(충전 게이지는 캐릭터 머리 위, 미니게임 트랙·진행 게이지는 `hudSide` 쪽 화면 가장자리, 낚음·놓침 표시는 화면 가운데 위).
- 캐릭터 그림 선택: phase가 charging/waiting/bite → cast, fighting → reel, 그 외 → 걷는 중이면 walk 프레임(`walkMs` 기준 약 200ms마다 교대), 아니면 idle. 방향은 `player.facing`(left는 side + flipX).

- [ ] **Step 1: 실패하는 테스트 작성** (`scene.test.ts`, 기록용 가짜 컨텍스트, 오프스크린 컨텍스트 null)
  - 크기 160×240, 195×280, 320×480 × 모든 phase(fighting엔 유효한 bar·barParams, caught엔 어종): 예외 없음
  - 캐릭터 스프라이트가 `(player.pos.x - camera.x - 8, player.pos.y - camera.y - 24)`에 그려진다 (발 중앙 기준; fighting 흔들림 ±1 허용) — 위치는 drawSprite 호출을 감시하거나 기록된 사각형으로 확인
  - `hudSide(40, 195) === 'right'`, `hudSide(150, 195) === 'left'`
  - fighting에서 트랙 사각형이 `hudSide` 쪽 절반 안에 있고 캔버스를 벗어나지 않는다
  - 오프스크린 컨텍스트를 제공하는 가짜로 바꾸면: 캐시 캔버스 2장이 한 번만 만들어지고, 다음 프레임은 `drawImage` 1번으로 배경을 그린다; `releaseSceneCache()` 뒤 다시 2장 생성
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing/scene.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/fishing && npm run typecheck`
- [ ] **Step 5: 미리보기** — 저장소 밖 스크립트로 PNG: 맵 전체 1장(`map.png`), 195×280 화면에서 상점 앞·모래사장 물가(waiting)·부두 끝(fighting) 3장. 같은 preview 폴더. 확인 항목: 타일 경계가 어색하지 않음, 나무 가림 순서, HUD가 캐릭터를 가리지 않음.
- [ ] **Step 6: Commit** — `feat: 낚시 마을 타일맵 렌더러`

### Task 6: 화면 — 이동, 입력, 상호작용, 상점 위치 제한

**Files:** Create `Controls.tsx`, `position.ts`, `position.test.ts`; Modify `Game.tsx`, `Game.test.tsx`, `Menus.tsx`, `fishing.css`

**Interfaces — Consumes:** Task 1~5, `useAuth()`(`src/platform/auth/AuthProvider.tsx`의 profile id; 읽기만). **Produces:**
```ts
// position.ts
export function loadPosition(userId: string): { pos: Vec; facing: Facing } | null   // 키 `fishing-pos:${userId}`, try/catch, 걸을 수 없는 타일이면 null
export function savePosition(userId: string, p: { pos: Vec; facing: Facing }): void  // try/catch
// Controls.tsx
export function Controls(props: {
  onMove(v: MoveInput): void                 // 조이스틱 놓으면 {0,0}
  action: { label: '낚시' | '상점'; enabled: true } | { label: '낚시'; enabled: false }
  onActionDown(): void; onActionUp(): void
}): JSX.Element
// Menus.tsx: ShopPanel props에 onBuyBag(tier: number) 추가
```
동작(스펙 4.3~4.5, 7-1):
- 위치는 `loadPosition(profile.id) ?? SPAWN`으로 시작, 걸음이 멈출 때와 언마운트 때 저장.
- rAF 루프에서 phase가 `idle`이고 메뉴가 닫혀 있을 때만 `stepWalk`. 카메라는 매 프레임 `cameraFor`.
- 입력: 조이스틱 포인터와 행동 버튼 포인터는 각자의 pointerId로 따로 추적(멀티터치). 데스크톱은 방향키·WASD(`keysVector`) + 스페이스(행동). `(pointer: coarse)`일 때만 `Controls`를 보이고, 아니면 "방향키로 이동 · 스페이스로 낚시/상점" 안내.
- 행동: `interactionAt(player.pos, player.facing)` → shop이면 누를 때 상점 패널 열기; fish면 기존 캐스팅 흐름(누르고 있으면 충전, 떼면 cast). cast payload에 `spot`. 찌 위치는 `castTarget`. 챔·미니게임 입력은 행동 버튼, 캔버스 아무 곳, 스페이스 모두.
- 충전이 시작되면 이동·방향 고정(Review Focus 4).
- 아래 버튼 줄: 가방, 도감, 전체화면. 상점 버튼 없음. 가방 패널에 상점 밖이면 "상점에서 팔 수 있어요".
- `bag_full`: "상점에 가서 팔아 주세요" 안내, 버튼 없음.
- 상점 패널에 가방 업그레이드 목록(다음 단계 가격, 최고 단계면 "최고 단계예요", 돈 부족 "골드가 부족해요"). 가방 표시 `n/{bagSize(view.bagTier)}`.
- 기존 전체화면, `fitScene` 크기 계산, 텍스트 선택 방지, 오류 문구, 서버 시간 보정은 그대로.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `position.test.ts`: 저장 후 불러오기 왕복; 깨진 JSON → null; 걸을 수 없는 타일 → null; localStorage가 던져도 null·예외 없음 (Review Focus 2)
  - `Game.test.tsx` (기존 world·rAF·캔버스 스텁 방식):
    - 시작 위치가 SPAWN일 때 행동 버튼 글자가 "상점", 누르면 상점 패널이 열린다
    - 위치를 부두 끝(저장 위치로 주입)으로 두면 "낚시", 누르고 떼면 cast 요청 payload에 `spot: 'pier'`; 모래 물가면 `'shore'`
    - 물도 문도 아닌 곳이면 행동 버튼 비활성
    - 아래 버튼 줄에 "상점" 버튼이 없다
    - 데스크톱: 방향키를 누르고 rAF를 진행시키면 캐릭터 위치가 바뀐다(drawWorld에 넘긴 player.pos로 확인)
    - 충전 중 조이스틱 이동 입력 → pos·facing 불변 (Review Focus 4)
    - 조이스틱 포인터 1과 행동 버튼 포인터 2를 동시에: 이동 중 행동 버튼 down/up이 이동을 끊지 않고, 이동 포인터 up이 충전을 끊지 않는다 (Review Focus 1)
    - cast가 `bag_full`이면 "상점에 가서 팔아 주세요"가 보이고 상점 열기 버튼은 없다 (Review Focus 5)
    - 상점 패널: 골드 800이면 가방 2단계 구매 버튼이 켜지고 누르면 `{ type: 'buyBag', tier: 2 }`; 799면 꺼짐
    - 언마운트 시 위치 저장
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/fishing src/platform && npm run typecheck && npm run build`
- [ ] **Step 5: Commit** — `feat: 낚시 마을 걷기·조작·상점 위치 제한`

### Task 7: 문서와 전체 검증

**Files:** Modify `docs/deploy-checklist.md`

- [ ] **Step 1:** "낚시 미리보기 확인" 절에 추가: 폰에서 조이스틱으로 걷기·벽 미끄러짐·스크롤 없음, 두 손가락 동시 조작, 물가·부두·상점 앞에서 행동 버튼 글자, 부두 끝→상점 걷는 시간(10~15초), 가방 업그레이드 구매, 새로고침 후 위치 유지, 데스크톱 방향키·스페이스. 그리고 이 변경은 `world` 함수 재배포가 필요하다는 줄(로직 버전 2).
- [ ] **Step 2: 전체 검증** — `npm test && npm run typecheck && npm run build && npm run db:test && npm run fn:test` → 전부 PASS
- [ ] **Step 3: Commit** — `docs: 낚시 마을 배포·확인 안내`

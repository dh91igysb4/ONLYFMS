# 마을회관 1차 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 마을 상점 건물을 마을회관으로 바꾸고, 회관 1층 실내 지역(자판기 상점, 9번 옷 가게, 7번 노트북, 잠긴 6·8번, 계단·엘리베이터 안내, 명예의 전당)을 넣는다.

**Architecture:** 실내는 새 지역 `hall`이다(기존 지역 체계: 맵 정의·페이드 이동·지역 방·위치 저장을 그대로 쓴다). 맵은 행 문자열로 걷기만 정하고, 그림은 Python 생성기로 만든 큰 스프라이트(배경)를 정적 레이어에 한 번 그린다. 방 벽은 칸이 아니라 칸 사이 "벽 모서리"로 막는다. 상호작용은 맵의 `fixtures`(서는 칸·방향 → 행동)로 정의한다. 명예의 전당은 새 RPC `hall_of_fame` + 플랫폼 모듈이 게시판 목록을 만들고, 낚시 화면은 그것을 액자로 그린다.

**Tech Stack:** TypeScript/React/Vite, vitest, Canvas 2D, Supabase Postgres(pgtap), Python 3 + Pillow(그림 생성).

**Spec:** `docs/superpowers/specs/2026-11-25-village-hall-design.md` (1차 = §10 1차 범위). 그림 기준: 평면 v7, 외관 v2(`/home/claude/hall/plan7.py`, `/home/claude/hall/gen2.py`).

## Global Constraints

- 모든 화면 문구는 한국어, 모바일 우선. 색은 theme 토큰만. 캔버스 내부 색(실내 배경·외관·액자)은 예외.
- 플랫폼 코드(`src/platform/**`)에 게임 id 분기 금지. 게임마다 다른 점은 manifest·등록부로 푼다.
- `logic.ts`는 순수 함수, 상대 import에 `.ts` 확장자. `data.ts`·`maps/**`·`map.ts`는 서버가 번들하므로 React·DOM import 금지.
- 낚시 데이터(`data.ts`)를 바꾸므로 `logic.version` 16 → 17, `migrate` 테스트 추가, `world` 재배포(`docs/deploy-checklist.md` "낚시 배포").
- DB 변경은 `npx supabase@2 migration new hall_of_fame`으로 만든 파일로만.
- 커밋 `type: 내용`, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 와 `Claude-Session: https://claude.ai/code/session_01T7oyVsG4qDMV2cGWjUgtdW`.
- 푸시 전 `npm test && npm run typecheck && npm run build`, DB는 `npm run db:test`, 함수는 `npm run fn:test`.
- 화면 이름은 계속 "상점"(자판기). 지역 이름은 "마을회관".

## Review Focus

1. 옛 세이브(v16, `areas`에 `hall` 없음)를 읽으면 `hall`이 들어가고, 저장 위치가 `hall`인 사람이 다시 들어와도 막힌 칸에 서지 않는다 → Task 2(migrate), Task 1(reachable).
2. 벽 모서리 옆을 대각선으로 비비며 걸어도 유리벽을 뚫지 못한다(발 사각형이 두 칸에 걸친 경우) → Task 1 `feetBlocked` 대각선 테스트.
3. 회관 안에서 낚시 버튼·캐스팅이 열리지 않는다(`spots` 없음; 서버도 거절) → Task 2 서버 테스트, Task 7.
4. 명예의 전당 데이터가 비었거나(기록 0건) 불러오기 실패해도 회관이 정상 동작하고 액자는 빈 얼굴로 그려진다 → Task 5·6·7.
5. 옷 사기는 9번 행거 앞에서만, 입기는 가방에서 계속 된다 → Task 7.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/games/fishing/map.ts` (수정) | 칸 `floor`(F)·`wall`(Y), 벽 모서리 `walls`, `fixtures`, `onWorldMap`, `backdrop`; `shop`→`building`, `shopSpot`→`doorSpot`; 문 칸 걷기 가능 |
| `src/games/fishing/walk.ts` (수정) | `feetBlocked`가 벽 모서리를 본다 |
| `src/games/fishing/data.ts` (수정) | `AreaId`에 `hall`, `AREAS`·`DEFAULT_AREAS`에 추가 |
| `src/games/fishing/maps/hall.ts` (새) | 회관 1층 맵 |
| `src/games/fishing/maps/village.ts` (수정) | 회관 건물·문·출구 |
| `src/games/fishing/maps/index.ts` (수정) | `hall` 등록 |
| `scripts/hall-art/exterior.py`, `scripts/hall-art/interior.py`, `scripts/build-hall-art.py` (새) | 그림 생성기 → `src/games/fishing/hallArt.ts` |
| `src/games/fishing/hallArt.ts` (생성) | `HALL_EXTERIOR`, `HALL_INTERIOR` 스프라이트 데이터. 직접 고치지 않는다 |
| `src/games/fishing/sprites.ts`, `scene.ts` (수정) | 스프라이트 등록, 건물·배경·액자 그리기 |
| `supabase/migrations/<ts>_hall_of_fame.sql`, `supabase/tests/23_hall_of_fame.test.sql` (새) | RPC |
| `src/platform/world/hallOfFame.ts` (+test) (새) | RPC 결과 → 게시판 목록 |
| `src/games/ui.ts`, `src/platform/world/WorldPage.tsx` (수정) | `onOpenGames` |
| `src/games/fishing/fame.ts` (+test) (새) | 액자 칸 ↔ 게시판, 장면용 액자 목록 |
| `src/games/fishing/FamePanel.tsx`, `HallPanels.tsx` (새), `Game.tsx`, `WardrobePanel.tsx`, `MapPanel.tsx`, `atlas.ts` (수정) | 화면 |

---

### Task 1: 맵 엔진 — 실내 칸, 벽 모서리, 고정물, 건물 문

**Files:**
- Modify: `src/games/fishing/map.ts`, `src/games/fishing/walk.ts`, `src/games/fishing/position.ts`(이름 변경만), `src/games/fishing/atlas.ts`(이름 변경만)
- Test: `src/games/fishing/map.test.ts`, `src/games/fishing/walk.test.ts`

**Interfaces:**
- Produces:
  - `TileKind`에 `'floor' | 'wall'`, `TILE_CHARS`에 `F: 'floor'`, `Y: 'wall'`. `floor`·`door`는 WALKABLE.
  - `type FameSlot = { group: 'record'; key: string } | { group: 'site'; index: number }`
  - `type FixtureAct = { kind: 'shop' } | { kind: 'wardrobe' } | { kind: 'laptop' } | { kind: 'elevator' } | { kind: 'notice'; text: string } | { kind: 'fame'; slot: FameSlot }`
  - `type Fixture = { front: TileFacing; act: FixtureAct }`
  - `type WallSpec = { v?: readonly (readonly [x: number, y0: number, y1: number])[]; h?: readonly (readonly [y: number, x0: number, x1: number])[] }` — `v`: x 열 왼쪽 모서리를 y0..y1 줄(포함)에서 막음, `h`: y 줄 위쪽 모서리를 x0..x1 열(포함)에서 막음
  - `MapDef`에 `walls: ReadonlySet<string>`(키 `v:x,y`, `h:x,y`), `fixtures: readonly Fixture[]`, `onWorldMap: boolean`(기본 true), `backdrop: string | null`(스프라이트 이름)
  - `MapOpts`에 `walls?: WallSpec; fixtures?: Fixture[]; onWorldMap?: boolean; backdrop?: string`
  - `export function blockedBetween(map: MapDef, tx: number, ty: number, dx: number, dy: number): boolean` — 이웃 칸으로 가는 모서리가 벽인가
  - `export function edgeHits(map: MapDef, x0: number, y0: number, x1: number, y1: number): boolean` — 픽셀 사각형(열린 구간) 안을 벽 모서리가 지나는가
  - `Interaction` = 기존 ∪ `FixtureAct`(`{ kind: 'shop' }`은 이미 있음)
  - 이름 변경: `MapDef.shop` → `MapDef.building`, `shopSpot` → `doorSpot`, `computeShop` → `computeBuilding`. 의미 동일(문 D가 맨 아래 줄인 B 사각형, 문 아래 칸).
  - `interactionAt`: 문 칸 앞이면 더는 `{ kind: 'shop' }`을 돌려주지 않는다(문은 이제 출구). 고정물은 `standsAt(here, facing, f.front)`로 찾고, 잠긴 문·선착장 다음, 순간이동기 전에 본다.
  - `checkPlaces`: 고정물 front가 걷는 칸이 아니면 throw `fixture ${i} front is not walkable`.
  - `reachableTiles`·`nearestDryTile`: `blockedBetween`이면 건너가지 않는다.
- `walk.ts` `feetBlocked`: 칸 검사 뒤 `edgeHits(map, 발 사각형)`이면 true.

- [ ] **Step 1: 실패하는 테스트 작성** (`map.test.ts`에 `describe('실내 맵 엔진')`, 작은 테스트 맵을 `defineMap('hall', ...)`으로 만든다. 예: 5×4 `['YYYYY','YFFFY','YFFFY','YYYYY']`, `walls: { v: [[2, 1, 2]] }`, `fixtures: [{ front: { tx: 1, ty: 1, facing: 'up' }, act: { kind: 'notice', text: '안내' } }]`)

```ts
it('F는 걷고 Y는 못 걷는다', () => { expect(isWalkable(m, 1, 1, ALL_AREAS_OPEN)).toBe(true); expect(isWalkable(m, 0, 1, ALL_AREAS_OPEN)).toBe(false) })
it('벽 모서리: blockedBetween은 양방향, 다른 모서리는 열림', () => {
  expect(blockedBetween(m, 1, 1, 1, 0)).toBe(true); expect(blockedBetween(m, 2, 1, -1, 0)).toBe(true)
  expect(blockedBetween(m, 1, 1, 0, 1)).toBe(false)
})
it('reachableTiles는 벽 모서리를 건너지 않는다', () => { expect(reachableTiles(m, [{ tx: 1, ty: 1 }], ALL_AREAS_OPEN).has('2,1')).toBe(false) })
it('고정물 front에서 그 방향을 보면 act, 다른 방향은 null', () => {
  expect(interactionAt(m, center(1, 1), 'up', ALL_AREAS_OPEN)).toEqual({ kind: 'notice', text: '안내' })
  expect(interactionAt(m, center(1, 1), 'down', ALL_AREAS_OPEN)).toBeNull()
})
it('고정물 front가 못 걷는 칸이면 throw', () => { expect(() => defineMap('hall', rows, { fixtures: [{ front: { tx: 0, ty: 0, facing: 'up' }, act: { kind: 'laptop' } }] })).toThrow(/fixture 0 front/) })
it('onWorldMap 기본 true, backdrop 기본 null', () => { expect(village.onWorldMap).toBe(true); expect(village.backdrop).toBeNull() })
```

`walk.test.ts`:

```ts
it('feetBlocked: 벽 모서리를 걸친 발 사각형은 막힌다, 같은 칸 안은 열림', () => {
  expect(feetBlocked(m, 2 * TILE, 1.5 * TILE, ALL_AREAS_OPEN)).toBe(true)
  expect(feetBlocked(m, 1.5 * TILE, 1.5 * TILE, ALL_AREAS_OPEN)).toBe(false)
})
it('stepWalk: 대각선으로 벽을 비벼도 x가 모서리를 넘지 못한다', () => {
  let p = { pos: { x: 1.5 * TILE, y: 1.5 * TILE }, facing: 'right' as const, moving: false, walkMs: 0 }
  for (let i = 0; i < 60; i++) p = stepWalk(m, p, { x: Math.SQRT1_2, y: Math.SQRT1_2 }, 16, ALL_AREAS_OPEN)
  expect(p.pos.x + FEET.w / 2).toBeLessThanOrEqual(2 * TILE)
})
```

기존 `describe('shop')`은 이름만 `building`/`doorSpot`으로 바꾸고, "SPAWN facing up interacts with the shop" 류 테스트는 Task 2에서 새 마을 기준으로 다시 쓴다(이 Task에서는 문 칸이 걷기 가능해졌다는 테스트로 바꾼다: `isWalkable(VILLAGE, door.tx, door.ty)` true).

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/map.test.ts src/games/fishing/walk.test.ts` / Expected: FAIL (`blockedBetween` 없음 등)
- [ ] **Step 3: 구현** — 위 Interfaces 그대로. `edgeHits`는 사각형이 걸친 칸 범위(EDGE_EPS 적용)의 세로 모서리 `v:X,y`(X*TILE이 x0<..<x1 안)와 가로 모서리 `h:x,Y`를 키 조회한다. `Game.tsx`의 `interactionFor` 폴백(문 앞 칸 = 상점)은 지운다.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing` / Expected: map·walk PASS. 문 관련 Game 테스트 실패는 Task 2·7에서 고친다(실패 목록을 ledger에 적는다).
- [ ] **Step 5: Commit** — `git commit -m "feat: 낚시 맵 엔진 실내 칸·벽 모서리·고정물"`

### Task 2: 지역 `hall`, 회관 맵, 마을 맵

**Files:**
- Modify: `src/games/fishing/data.ts`, `logic.ts`(version 17만), `maps/village.ts`, `maps/index.ts`, `atlas.ts`, `MapPanel.tsx`, `minimap.ts`(세계 지도 제외 규칙)
- Create: `src/games/fishing/maps/hall.ts`
- Test: `logic.test.ts`, `map.test.ts`, `atlas.test.ts`, `data.test.ts`, 영향받는 기존 테스트(`AREAS`를 도는 테스트는 `spots.length > 0`인 지역만 본다), `supabase/functions/world/handler.test.ts`(`FISHING_V`)

**Interfaces:**
- Consumes: Task 1 전부.
- Produces:
  - `AreaId`에 `'hall'`, `AREAS`에 `{ id: 'hall', name: '마을회관', spots: [] }`(마지막), `DEFAULT_AREAS = ['village', 'river', 'forest', 'hall']`.
  - `HALL: MapDef` (`maps/hall.ts`), `MAPS.hall = HALL`.
  - 규칙: `spots`가 빈 지역은 낚시 지역이 아니다(물고기 목록·경제 시뮬·지역 목록에서 뺀다). `onWorldMap === false`인 맵은 큰 지도·미니맵·세계 좌표 그림에서 뺀다.
  - `placeMarkers`: 출구가 `'at'`이고 그 사각형이 `map.building`의 문 칸을 덮으면 출구 표시를 내지 않는다(`shop` 표시가 대신). `shop` 표시 칸은 `doorSpot`.

**마을 행(48열, 0~11줄만 바뀜, 12줄부터 기존 그대로):**
```
'TTTTTTTTTTTTTTTTTTTTTTTT==TTTTTTTTTTTTTTTTTTTTTT',
'TTTTTT,BBBBBBBBBBB,T,TT,==,TT,T,,TT,T,TT,T,TTTTT',
'TT,T,,,BBBBBBBBBBB,f,,,,=,,,T,,,,,,,,,,,,,,,,,TT',
'TT,,,,TBBBBBBBBBBB,,f,,,=,,,,,,,,,,,T,,,T,,,,,TT',
'T,,,,f,BBBBBBBBBBB||||,,=,,,,,T,,,,,,,T,,,,,,,TT',
'TT,,,,,BBBBBBBBBBB,,,,,,==,,,,,,,,,,,,,,,,T,,,,T',
'TT,f,,,BBBBBBBBBBB,,,,,,,=,T,,,,,,,,,T,,,,,,,,,T',
'T,,,,,,BBBBBBDBBBB,,,,,,,=,,,,,,f,,,,,,,,T,,,,TT',
'T,,|||||||,,==,,,,,,,,o,,=,,,,,,,,,T,,,,,,,,,,TT',
'TT,|f,,,f|,,=======,,,,,,=,,,,,T,,,,,,,T,,,,T,,T',
'TT,|,ff,,,,,,,,,,,=,,,,,,=,,f,,,,,,,,,,,,,f,,,,T',
'T,,|,,ff,,,,,f,,,,=,,,f,,=,,,,,,,T,,,,o,,,,,,,TT',
```
마을 `exits`에 `{ at: { tx: 13, ty: 7, w: 1, h: 1 }, target: 'hall', entry: { tx: 4, ty: 16, facing: 'up' } }` 추가. 머리 주석의 상점·37칸 설명을 회관 기준으로 고친다.

**회관 행(42×18):**
```
'YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
'YYFFFFFFYYYFFFYFYYYYYYYYYYYYYYYYYYYFFFYYYY',
'YYFFFFFFYYYFFFYFFFFFFFFFFFFFFFFFFFFFFFYYYY',
'YYFFFFFFFFYFFFYFFFFFFFFFFFFFFFFFFFFFFFYYYY',
'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFYYYY',
'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFYYYY',
'YFFFFFFFFFYFFFFFFFFFFFFFFFFFFFFFFFFFFFYYYY',
'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFY',
'YFFFYYYFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFY',
'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFY',
'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFY',
'YFFFFFFFFYFFFFFFFFFFFFFFFFFFFFFFFFFFFFYYYY',
'YFFFFFFFFYFFFFFYYYYYYYYYYYYYYFYFFFFFFFYYYY',
'YFFFFFFFFYFFFFFYYYYYYYYYYYYYYFYFFFFFFFYYYY',
'YFFFFFFFFYFFFFFFFFFFFFFFFYYYYFYFFFFFFFYYYY',
'YYFFFFFFYYFFFFFYYYYYYYYYYYYYYYYFFFFFFFYYYY',
'YFFFFFFFFYFFFFFYYYYYYYYYYFFFFYYFFFFFFFYYYY',
'YYYFFFYYYYYYYYYYYYYYYYYYYYYYYYYFFFYYYYYYYY',
```
`defineMap('hall', rows, { indoor: true, onWorldMap: false, backdrop: 'hall-interior', world: { tx: 7, ty: 1 }, ... })`:
- `exits`: `{ edge: 's', from: 3, to: 5, target: 'village', entry: { tx: 13, ty: 8, facing: 'down' } }`, `{ edge: 's', from: 31, to: 33, target: 'village', entry: { tx: 13, ty: 8, facing: 'down' } }`
- `walls.v`: `[8,1,6] [10,1,6] [15,1,6] [35,1,13] [10,11,16] [15,11,16] [20,11,16] [25,11,16] [31,11,16]`
- `walls.h`: `[7,10,10] [7,13,14] [11,10,15] [11,18,28]` (1번 문 x11–12, 7번 문 x16–17, 9번 문 x29–30 열림. 6·8번 문은 닫힌 벽. 복도 쪽 명예의 전당은 벽 없음)
- 메인 복도는 x35 유리벽에서 끝나고, 엘리베이터·계단 구역은 x31–34 복도에서 유리문(x35, y14–16)으로만 들어간다(평면 v7 그대로).
- `fixtures` (front 칸, 방향 → act):
  - 상점 자판기: (2,1)(2,2)(2,3) `left` → `{ kind: 'shop' }`
  - 명예의 전당 낚시: (16,2)(17,2) `up` → record `biggest`; (18,2) → `total_earned`; (19,2) → `dex`; (20,2) → `challenges`
  - 명예의 전당 게임: (24+i, 2) `up`, i = 0..10 → `{ group: 'site', index: i }`
  - 노트북: (16,11) `down`, (18,14) `down` → `laptop`
  - 옷 가게 행거: (29,12)(29,13)(29,14) `left` → `wardrobe`
  - 6번 문: (11,10)(12,10) `up` → notice `'곤의 라면가게 · 준비 중이에요'`
  - 8번 문: (21,10)(22,10) `up` → notice `'들어갈 수 없어요'`
  - 엘리베이터: (37,3)(37,4)(37,5) `right` → `elevator`
  - 계단: (37,11)(37,12) `right`, (38,10)(39,10)(40,10) `down` → notice `'2층은 공사 중이에요'`

- [ ] **Step 1: 실패하는 테스트 작성**

`map.test.ts` `describe('마을회관')`:
```ts
it('마을 문(13,7)은 회관 출구, 들어가면 (4,16) 위', () => { expect(exitAt(VILLAGE, center(13, 7))).toMatchObject({ target: 'hall', entry: { tx: 4, ty: 16, facing: 'up' } }) })
it('회관 아래 출구 두 곳은 마을 문 아래(13,8)로', () => { for (const tx of [3, 5, 31, 33]) expect(exitAt(HALL, center(tx, 17))).toMatchObject({ target: 'village', entry: { tx: 13, ty: 8 } }) })
it('입구에서 고정물 front 전부에 걸어서 닿는다', () => {
  const r = reachableTiles(HALL, [{ tx: 4, ty: 16 }], ALL_AREAS_OPEN)
  for (const f of HALL.fixtures) expect(r.has(`${f.front.tx},${f.front.ty}`), JSON.stringify(f)).toBe(true)
})
it('잠긴 6·8번 방 안 칸에는 닿지 않는다', () => { const r = reachableTiles(HALL, [{ tx: 4, ty: 16 }], ALL_AREAS_OPEN); expect(r.has('12,14')).toBe(false); expect(r.has('22,14')).toBe(false) })
it('저장 위치가 회관 안 걷는 칸이면 그대로, 막힌 칸이면 입구로(position.ts)', () => { /* restorePosition류 기존 함수로 (17,14)는 유지, (16,12)는 입구 칸 */ })
it('7번·9번 방 안에는 닿는다', () => { const r = reachableTiles(HALL, [{ tx: 4, ty: 16 }], ALL_AREAS_OPEN); expect(r.has('17,14')).toBe(true); expect(r.has('29,13')).toBe(true) })
it('자판기 앞에서 왼쪽을 보면 상점', () => { expect(interactionAt(HALL, center(2, 2), 'left', ALL_AREAS_OPEN)).toEqual({ kind: 'shop' }) })
it('회관에는 낚시 자리·순간이동기가 없다', () => { expect(HALL.spots).toEqual({}); expect(HALL.teleporter).toBeNull() })
it('마을 doorSpot은 (13,8), 부두 끝에서 doorSpot까지 걸음 수 기대값을 새로 고정', () => { /* BFS 거리 계산해 상수로 고정 */ })
```
`logic.test.ts`:
```ts
it('v16 세이브 migrate → areas에 hall', () => { expect(logic.migrate(v16Save, 16).areas).toContain('hall') })
it('hall에서 cast는 거절', () => { expect(err(play(fresh(), { type: 'cast', area: 'hall', power: 50, spot: 'x' } as unknown as Action, ctx()))).toBeTruthy() })
it('version 17', () => { expect(logic.version).toBe(17) })
```
`atlas.test.ts`: 마을 표시에 `{ kind: 'shop', tx: 13, ty: 8 }`가 있고 target `hall` 출구 표시는 없다. 큰 지도 지역 목록에 `hall`이 없다.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing` / FAIL
- [ ] **Step 3: 구현** — 위 값 그대로. `AREAS`를 도는 화면·시뮬·테스트는 낚시 지역(`spots.length > 0`)만 보도록 고친다.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/fishing && npm run typecheck` / PASS(남은 Game 테스트 실패는 Task 7 몫이면 ledger에 이름을 적는다)
- [ ] **Step 5: 함수 테스트 기대 버전** — `supabase/functions/world/handler.test.ts`의 `FISHING_V`를 17로. Run `npm run fn:test` / PASS
- [ ] **Step 6: Commit** — `feat: 마을회관 지역과 마을 회관 건물 자리`

### Task 3: 그림 — 외관·실내 배경

**Files:**
- Create: `scripts/hall-art/exterior.py`(`/home/claude/hall/gen2.py`를 함수 `render() -> PIL.Image`로), `scripts/hall-art/interior.py`(`/home/claude/hall/plan7.py`를 함수로; **텔레포터·명예의 전당 액자·박제·트로피를 빼고**, 카펫·바닥 띠는 둔다), `scripts/build-hall-art.py`, `src/games/fishing/hallArt.ts`(생성)
- Modify: `src/games/fishing/sprites.ts`(등록), `src/games/fishing/scene.ts`
- Test: `sprites.test.ts`, `scene.test.ts`

**Interfaces:**
- Produces: 스프라이트 `'hall-exterior'`(168×H, H는 생성기 결과, 바닥 정렬), `'hall-interior'`(672×288). `hallArt.ts`는 `export const HALL_EXTERIOR = { w, h, rows, palette }`, `HALL_INTERIOR` 동일 형식. 팔레트 글자는 `'.'`(투명)을 빼고 ASCII 33–126, 모자라면 U+00C0부터. 파일 첫 줄에 `// 생성 파일: python3 scripts/build-hall-art.py — 직접 고치지 않는다`.
- `scene.ts`: 정적 레이어에서 `map.backdrop`이 있으면 칸 바닥 대신 그 스프라이트를 (0,0)에 그린다. `map.building`이 있으면 `'hall-exterior'`를 `x = building.tx*TILE`, `y = (building.ty + building.h)*TILE - sprite.h`에 그린다(기존 `'shop'` 대신). `'shop'` 스프라이트가 다른 곳에서 안 쓰이면 지운다.

- [ ] **Step 1: 테스트** — `sprites.test.ts`: `SPRITES['hall-interior']`가 672×288이고 `'.'`이 없다; `SPRITES['hall-exterior'].w === 168`. `scene.test.ts`: 회관 장면 그리기 기록에 `'hall-interior'`가 한 번, 마을 장면에 `'hall-exterior'`가 있고 `'shop'`이 없다.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing/sprites.test.ts src/games/fishing/scene.test.ts` / FAIL
- [ ] **Step 3: 생성기 작성·실행** — `python3 scripts/build-hall-art.py` → `hallArt.ts`. 외관 문(그림 x 96–116)이 마을 문 칸(13,7) 위에 오는지 PNG로 확인(`/mnt/user-data/outputs/hall-in-village.png`로 마을 일부를 렌더해 눈으로 확인).
- [ ] **Step 4: 등록·그리기 구현, 통과 확인** — 같은 명령 / PASS
- [ ] **Step 5: Commit** — `feat: 마을회관 외관·실내 그림`

### Task 4: DB — `hall_of_fame`

**Files:**
- Create: `npx supabase@2 migration new hall_of_fame`, `supabase/tests/23_hall_of_fame.test.sql`

**Interfaces:**
- Produces: `public.hall_of_fame(p_avatar_game text) returns jsonb`, security definer, `perform public._require_approved()`, authenticated만 실행.
  ```json
  { "records": [{ "game_id", "key", "handle", "value", "detail", "avatar" }],
    "free":    [{ "game_id", "by": "wins"|"best", "handle", "wins", "plays", "best_score", "avatar" }],
    "duel":    [{ "game_id", "handle", "rating", "rated_games", "avatar" }] }
  ```
  - records: `game_records`에서 키 `'avatar'`·`'free_bonus'`·`'areas'`를 뺀 (game_id, key)마다 value 내림차순, `updated_at` 오름차순, handle 순으로 상위 3.
  - free: `free_plays`를 (game_id, user)로 묶어 wins(= solved 수), plays, best_score(소수 둘째 반올림), win_rate. `by='wins'`: wins desc, win_rate desc, handle 상위 3; `by='best'`: best_score desc, avg desc, plays desc, handle 상위 3.
  - duel: `duel_ratings` `rated_games > 0`, rating desc, rated_games desc, handle 상위 3.
  - 모두 승인 사용자만, 관리자가 아니면 `_is_hidden_game` 제외. `avatar` = 같은 사용자의 `game_records(game_id = p_avatar_game, key = 'avatar').detail`, 없으면 null. 빈 묶음은 `[]`.

- [ ] **Step 1: pgtap 테스트** — `plan(n)`: 함수 존재; anon 실행 불가, authenticated 가능; 사용자 4명(승인 3·대기 1)과 world 기록 4건 → 상위 3·순서·대기 제외; 숨김 게임 기록은 일반 사용자에게 없고 관리자에게 있음; free wins/best 순서와 3개 제한; duel 순서; avatar 채움/null; 데이터 없으면 세 배열 모두 `[]`.
- [ ] **Step 2: 실패 확인** — `npm run db:test` / 23번 FAIL
- [ ] **Step 3: 마이그레이션 작성**
- [ ] **Step 4: 통과 확인** — `npm run db:test` / PASS 전체
- [ ] **Step 5: Commit** — `feat: 명예의 전당 RPC`

### Task 5: 플랫폼 — 명예의 전당 게시판, 게임 목록 출구

**Files:**
- Create: `src/platform/world/hallOfFame.ts`, `src/platform/world/hallOfFame.test.ts`
- Modify: `src/games/ui.ts`, `src/platform/world/WorldPage.tsx`, `src/platform/world/WorldPage.test.tsx`

**Interfaces:**
- Consumes: Task 4 RPC.
- Produces:
  - `export type FameRow = { handle: string; text: string; detail: string | null; avatar: string | null }`
  - `export type FameBoard = { gameId: string; group: 'record' | 'free' | 'duel'; key: string; title: string; label: string; rows: FameRow[] }`
  - `export type HallOfFame = { records: FameBoard[]; site: FameBoard[] }`
  - `export function buildHallOfFame(raw: unknown, isAdmin: boolean): HallOfFame` (순수)
    - records: 등록부 `worlds`의 manifest `records` 순서대로 게시판 하나씩(`key` = record.key, `title` = manifest.name, `label` = record.label). text = `value.toLocaleString('ko-KR') + (unit ?? '')`. detail은 raw 그대로.
    - site: 등록부 `games` 중 `modes.free`인 게임(등록부 순서), 그다음 `duels`. score 게임(`freeStats === 'score'`)은 `by='best'` 행, label `'최고 점수'`, text `formatFreeScore(gameId, best_score)` + `'점'`; 나머지는 `by='wins'`, label `'맞힌 수'`, text `${wins}번 · ${plays}판`. 대전은 label `'레이팅'`, text `${rating}`. key = `'free'` / `'duel'`.
    - manifest `hidden`인 게임은 `isAdmin`일 때만. 모양이 틀린 raw는 빈 배열로 본다(throw 안 함).
  - `export function loadHallOfFame(avatarGame: string, isAdmin: boolean): Promise<HallOfFame>` — `rpc('hall_of_fame', { p_avatar_game })` 후 build.
  - `WorldGameProps = { gameId: string; onOpenGames?: () => void }`. `WorldPage`는 `onOpenGames={() => navigate('/games')}`를 넘긴다.

- [ ] **Step 1: 테스트** — `buildHallOfFame`: 낚시 기록 4개 게시판이 manifest 순서이고 `biggest` text `'48.5cm'`, detail `'참돔'`; 점수 게임은 best 행·`'점'`; 맞히기 게임은 wins 행; 대전 게시판이 맨 뒤; 숨김 게임은 isAdmin false면 없음; `null`/잘못된 raw → `{ records: [...빈 rows], site: [...빈 rows] }`(게시판은 있고 rows만 빔). `WorldPage.test`: 게임 컴포넌트가 받은 `onOpenGames`를 부르면 `/games`로 간다.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/platform/world` / FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 같은 명령 / PASS
- [ ] **Step 5: Commit** — `feat: 명예의 전당 게시판과 게임 목록 출구`

### Task 6: 낚시 — 액자 칸 ↔ 게시판, 장면 액자

**Files:**
- Create: `src/games/fishing/fame.ts`, `src/games/fishing/fame.test.ts`
- Modify: `src/games/fishing/scene.ts`, `src/games/fishing/scene.test.ts`

**Interfaces:**
- Consumes: Task 1 `FameSlot`, Task 5 `HallOfFame`/`FameBoard`.
- Produces:
  - `export function boardIndexFor(hof: HallOfFame, gameId: string, slot: FameSlot): number | null` — 패널용 통합 목록(`allBoards(hof, gameId)` = 이 게임 records 게시판들 + site) 안의 위치. 없으면 null.
  - `export function allBoards(hof: HallOfFame, gameId: string): FameBoard[]`
  - `export type FameFrame = { tx: number; look: 'mount' | 'frame'; species: string | null; avatar: string | null; empty: boolean }`
  - `export function fameFrames(hof: HallOfFame | null, gameId: string): FameFrame[]` — 박제 tx 16(2칸, `biggest` 1위의 detail을 `SPECIES` 이름으로 찾아 id), 액자 tx 18·19·20(total_earned·dex·challenges), 게임 액자 tx 24+i(i < min(site 수, 11)). hof가 null이면 같은 자리에 `empty: true`(낚시 4개만).
  - `WorldScene`에 `fame?: readonly FameFrame[]`. 장면은 회관 맵(`map.id === 'hall'` 대신 `map.backdrop` 있을 때)에서 1줄(ty 1)에 액자를 그린다: 액자 테두리 + avatar가 있으면 `composePose('player-idle-down', decodeOutfit(avatar))`의 윗부분 12줄, 없으면 기본 얼굴 실루엣. 박제는 나무 판 + `fish-<id>` 스프라이트(없으면 판만).

- [ ] **Step 1: 테스트** — `fame.test.ts`: slot `{record, 'dex'}` → 통합 목록의 dex 위치; site index 0 → 낚시 기록 수(4); 범위 밖 index → null; `fameFrames`: 게임 12개면 액자 11개; 박제 species는 `'참돔'` → 해당 id; hof null → 4개 empty. `scene.test.ts`: fame 액자 2개 + 박제 하나를 넘기면 기록에 `fish-<id>`가 한 번 그려진다.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing/fame.test.ts src/games/fishing/scene.test.ts` / FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** / PASS
- [ ] **Step 5: Commit** — `feat: 명예의 전당 액자 그리기`

### Task 7: 낚시 화면 — 고정물 행동, 옷 가게, 패널

**Files:**
- Create: `src/games/fishing/FamePanel.tsx`, `src/games/fishing/HallPanels.tsx`(엘리베이터)
- Modify: `src/games/fishing/Game.tsx`, `WardrobePanel.tsx`, `Menus.tsx`(상점 안내 문구), `MapPanel.tsx`
- Test: `Game.test.tsx`(새 `describe('마을회관')`), `WardrobePanel.test.tsx`

**Interfaces:**
- Consumes: Task 1 `Interaction`/`FixtureAct`, Task 5 `loadHallOfFame`, `onOpenGames`, Task 6 `allBoards`/`boardIndexFor`/`fameFrames`.
- Produces / 정해진 동작:
  - `Menu`에 `'fame' | 'elevator'`.
  - 행동 라벨: shop `'상점'`, wardrobe `'옷 가게'`, laptop `'노트북'`, elevator `'엘리베이터'`, fame `'보기'`, notice `'살펴보기'`.
  - 행동(누르고 뗄 때, 기존 `release` 흐름): wardrobe → 메뉴 `wardrobe`(살 수 있음); laptop → `props.onOpenGames?.()`(없으면 아무 일 없음); elevator → 메뉴 `elevator`; notice → `flashInfo(text, TIDE_NOTICE_MS)`; fame → 메뉴 `fame`, 시작 위치 `boardIndexFor(...)`(null이면 0).
  - `WardrobePanel` prop `atShop` → `canBuy`. `canBuy = here?.kind === 'wardrobe'`. 가방에서 연 옷장은 입기만. 살 수 없을 때 안내 `'옷은 마을회관 9번 방 옷 가게에서 살 수 있어요'`.
  - 상점(자판기)은 기존 `atShop`(`here?.kind === 'shop'`) 그대로. 기존 "상점에서 팔 수 있어요" 류 문구는 유지하되 위치 설명이 있으면 `'마을회관 상점'`으로.
  - `ElevatorPanel`: 1층(현재, 비활성 "지금 층") · 2·3·4층 버튼 비활성 + `'공사 중'`.
  - `FamePanel({ boards, start })`: 제목 `${title} · ${label}`, 1~3위(순위·아이디·text·detail), 비었으면 `'아직 기록이 없어요'`, 이전/다음 버튼(끝에서 비활성), 닫기는 기존 메뉴 닫기.
  - 회관에 들어갈 때(`rt.map.id === 'hall'`로 바뀔 때)와 fame 메뉴를 열 때 `loadHallOfFame(gameId, !!profile?.is_admin)`. 실패하면 hof는 이전 값(처음이면 null) 유지, 패널은 `'불러오지 못했어요'`. 장면에 `fame: fameFrames(hof, gameId)`.
  - 회관 안 낚시 버튼은 기존 규칙대로 비활성(앞이 물이 아님) — 추가 코드 없음, 테스트만.

- [ ] **Step 1: 테스트** (`Game.test.tsx`, 기존 헬퍼로 회관 위치에 세운다)
  - 자판기 앞(2,2) 왼쪽 → 행동 `'상점'` → 상점 창.
  - 행거 앞(29,13) 왼쪽 → `'옷 가게'` → 옷장 창에서 사기 버튼 활성; 가방 → 옷장은 사기 비활성 + 안내 문구.
  - 노트북 앞(16,11) 아래 → `'노트북'` → `onOpenGames` 1번 호출.
  - 6번 문 앞 → `'살펴보기'` → `'곤의 라면가게 · 준비 중이에요'` 표시.
  - 엘리베이터 → 2·3·4층 버튼 disabled, `'공사 중'`.
  - 액자 (24,2) 위 → `rpc('hall_of_fame')` 호출, 패널에 첫 게임 게시판 제목; 다음 버튼으로 넘김; rpc 실패 → `'불러오지 못했어요'`, 회관 이동은 계속 됨.
  - 회관 안 아무 데서나 낚시 버튼 disabled.
  - 마을 문(13,7)으로 위로 걸어 들어가면 회관 (4,16)에, 회관 아래 출구로 나가면 마을 (13,8).
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing` / FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npm test && npm run typecheck && npm run build` / PASS
- [ ] **Step 5: Commit** — `feat: 마을회관 자판기 상점·옷 가게·노트북·명예의 전당 화면`

### Task 8: 문서·배포 메모

**Files:**
- Modify: `CLAUDE.md`(폴더 규칙에 `scripts/build-hall-art.py`·`hallArt.ts` 생성 규칙 한 줄, `onOpenGames`), `docs/deploy-checklist.md`(이번 배포: DB push → `world` 재배포 → Vercel), `docs/superpowers/specs/2026-11-24-fishing-online-design.md`(2단계 범위에서 대전 걸기 삭제)

- [ ] **Step 1: 문서 수정**
- [ ] **Step 2: 전체 확인** — `npm test && npm run typecheck && npm run build && npm run db:test && npm run fn:test` / 전부 PASS
- [ ] **Step 3: Commit** — `docs: 마을회관 1차 문서·배포 메모`

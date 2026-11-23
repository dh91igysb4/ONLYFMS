# 펨타듀 낚시 — 넓은 세계 5부 (신화 등급 · 갯벌 · 늪지 · 산정 호수 · 난파선 앞바다) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 지역 네 곳(갯벌·늪지·산정 호수·난파선 앞바다)과 전설 위 "신화" 등급(세이브당 한 마리, 잡으면 영구 버프)을 세 PR로 넣는다. 기존 가격·기존 56종 값은 그대로, 새 쓸 곳은 지역 해금 넷(360,000 G).

**Architecture:** M1이 공통 체계를 깐다 — 물때(`clock.ts` 순수 함수)와 자리 단위 열림(`spotOpen`), 지역 최소 낚싯대(`areaMinRod`, 서버가 해금·던지기에서 확인), 맵의 움직이는 상태(`MapDynamic`: 진흙·얼음 구멍), 장면 효과(물때 캐시·안개·늘 눈), 신화 등급(`legend` 필드 재사용 + `rarity: 'mythic'`, r0 공유로 rng 5번 계약 유지, 미니게임 `surge`), 신화 버프(`State.buffs`, 서버 추첨·판매가와 화면 바 크기에 적용). M2·M3는 그 위에 맵·어종·과제·이동기·해금을 데이터로 더한다. 각 PR이 `logic.version`을 올린다(10 / 11 / 12).

**Tech Stack:** TypeScript, React 18, Canvas 2D, vitest, Deno(`world` 함수 테스트). 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-24-fishing-world-5-design.md` (이하 "설계"). 함께 볼 것: `2026-11-23-fishing-world-design.md`(규칙), `2026-11-24-fishing-map-design.md`(큰 지도), 계획 `2026-11-24-fishing-polish.md`(경제 시뮬레이션).

## Global Constraints

- `clock.ts`·`data.ts`·`logic.ts`·`minigame.ts`·`map.ts`·`maps/*.ts`·`walk.ts`·`atlas.ts`·`teleport.ts`·`econSim.ts`는 순수 모듈: React·DOM·`Date.now()`·`Math.random` 없음, 상대 import에 `.ts`. `econSim.ts`는 서버·화면 어디서도 import하지 않는다.
- 기존 가격 불변: 낚싯대 0 / 1,500 / 8,000 / 40,000 / 280,000 / 620,000, 가방 0 / 800 / 5,000 / 50,000 / 100,000, 찌 1,000 / 1,500 / 2,000 / 1,500 / 5,000, 해금 5,000 / 15,000 / 50,000. 기존 56종 값(`data.test.ts` 스냅숏) 불변.
- 쓰지 않는 것(사용자 결정): 같은 어종 판매가 감소, 소모품(얼음 구멍 비용 포함), 갈퀴, 순간이동 요금 인상.
- rng 계약: `rollCatch`는 언제나 rng를 정확히 5번 부른다(r0 전설·신화 판정, r1 등급, r2 등급 안 어종, r3 크기, r4 입질). 기존 세이브·기존 지역의 모든 판 결과는 바뀌지 않는다(골든 테스트 유지).
- 도전과제는 어떤 계절에도 깰 수 있다. 서버 권위(골드·해금·도감·전설·신화·버프·과제는 서버 상태만). 맵 40×30 ~ 56×40칸. 마을 상점·`SPAWN`·부두 끝→문 37칸 불변.
- 플랫폼 코드(`src/platform/`, `src/app/`)와 DB는 바꾸지 않는다. 마이그레이션 없음.
- 화면 문구 한국어, 모바일 우선. 캔버스 밖 색은 `theme.css` 토큰만(`--sky`는 팔레트에 없으니 쓰지 않는다). 그림은 새로 그린 16px 픽셀 아트(`sprites.ts` 형식), 원작 그림·맵·이름 금지.
- `logic.version`: M1 10, M2 11, M3 12. 각 PR에서 한 번만 올린다. `migrate`는 v2~v(n−1)을 모두 읽는다.
- 커밋 `type: 내용`, 마지막 두 줄 트레일러(Co-Authored-By: <작성 모델 이름> <noreply@anthropic.com> / Claude-Session: https://claude.ai/code/session_01T7oyVpQAuQkbAiCkNHahWh). 경로 지정 스테이징, 푸시 금지.

## Review Focus

1. **기존 판 불변**: 신화를 넣어도 기존 지역·기존 세이브에서 같은 rng 열이면 같은 물고기·크기·입질(버프 없는 세이브). → M1 Task 2
2. **동시 후보 없음**: 신화마다 그 자리에 나올 수 있는 전설이 모두 `needs`에 있다(데이터 검사). → M1 Task 2, M2 Task 6, M3 Task 6
3. **안 누르면 못 잡음**: `surge` 유형, 백룡의 숨결(+8%) 바, 모든 찌 조합에서 60초 안 누르면 잡히는 비율 0. → M1 Task 4
4. **물때**: 썰물이 끝나면 진흙 위 캐릭터가 갇히지 않는다. 밀물에 갯골 던지기는 서버가 `spot_closed`(10초 여유). → M1 Task 1·3·5, M2
5. **난파선 낚싯대 요구**: 4단계 이하로는 해금도 던지기도 안 된다(`need_rod`). → M1 Task 1, M3
6. **경제**: 기존 품목 구매 시각 불변, 하루 1시간 + 상한 전부 다 사기 34일 ±20%, 21일 초과. 버프 포함. → M1 Task 7, M2 Task 7, M3 Task 7
7. **스포일러**: 안 잡은 신화·못 얻은 버프의 이름·그림·조건이 어디에도(`alt`·`aria-label` 포함) 없다. → M1 Task 6

---

# M1 — 공통 체계와 신화 등급 (`logic.version` 10)

브랜치: `feat/fishing-world-5-m1` (base `feat/fishing-polish` 머지 뒤 main). 새 지역·실제 신화 어종은 없다. 신화·물때·구멍 테스트는 테스트용 어종(`SPECIES`에 `beforeEach`로 넣고 `afterEach`로 빼는 도우미 `withTempSpecies`)과 합성 `defineMap` 맵으로 한다.

### Task 1: 물때·자리 열림·지역 최소 낚싯대 (순수 데이터)

**Files:**
- Modify: `src/games/fishing/clock.ts`, `src/games/fishing/data.ts`
- Test: `src/games/fishing/clock.test.ts`, `src/games/fishing/data.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // clock.ts
  export type Tide = 'low' | 'high'
  export const LOW_TIDE_HOURS: readonly (readonly [number, number])[]  // [[2,6],[14,18]]
  export function tideAt(gameMinute: number): Tide          // mod 1440
  export function nextTideChange(gameMinute: number): number // 다음 바뀌는 게임 분
  // data.ts
  export type Rarity = 'common' | 'uncommon' | 'rare' | 'legend' | 'mythic'
  export type BuffId = 'imugi-scale' | 'dragon-breath' | 'dragon-pearl'
  Species.minRod: RodTier
  Species.legend?: { power: number; needs?: readonly string[]; buff?: BuffId }
  AREAS[i]: { id; name; spots; tideSpots?: readonly string[]; minRod?: RodTier }
  UNLOCKS[area]: { price; name; minRod?: RodTier }
  export function spotOpen(area: AreaId, spot: string, gameMinute: number): boolean
  export function areaMinRod(area: AreaId): RodTier
  export const TIDE_GRACE_MIN = 10
  export const MYTHIC_CHANCE = 0.02
  export const BUFFS: readonly { id: BuffId; name: string; desc: string }[]
  //   imugi-scale 이무기의 비늘 '입질이 15% 빨라져요', dragon-breath 백룡의 숨결 '낚시 바가 8% 길어져요',
  //   dragon-pearl 용왕의 여의주 '물고기를 8% 비싸게 팔아요'
  export const BUFF_FX = { imugiBite: 0.85, dragonBar: 1.08, pearlSell: 108 } as const // pearlSell은 정수 백분율
  TACKLE_FX.curiousMythic = 1.5
  // 호기심 찌 desc: '희귀·전설·신화 물고기가 더 잘 나와요'
  ```

- [ ] **Step 1: 실패하는 테스트**
  - `tideAt: 1:59 high, 2:00 low, 5:59 low, 6:00 high, 14:00 low, 18:00 high, -1 → 23:59 high, 1440+120 → low`
  - `nextTideChange(0) = 120, (130) = 360, (1100) = 1560 mod 1440 = 120`
  - `spotOpen: tideSpots 없는 자리는 늘 true, 모르는 지역·자리는 false`
  - `areaMinRod: 지금 6지역 모두 1`
  - `legend 필드 규칙: legend 필드 ⇔ rarity ∈ {legend, mythic}; needs·buff ⇔ mythic; buff는 BUFFS의 id, 서로 다른 신화는 서로 다른 buff` (지금은 신화 0종이라 빈 검사가 통과해야 함)
  - `BUFFS 3개 id·이름·설명, BUFF_FX 값`
  - 기존 `data.test.ts` 스냅숏·보장 검사 그대로 통과(보장 검사는 `spotOpen`인 시각만, `areaMinRod`로 — 지금 결과 동일)
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing/clock.test.ts src/games/fishing/data.test.ts`
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/fishing && npm run typecheck`
- [ ] **Step 5: 커밋** — `feat: 낚시 물때·자리 열림·지역 최소 낚싯대와 신화 등급 데이터 형식`

### Task 2: 서버 — 신화 추첨·버프·`need_rod`·`spot_closed`, `logic.version` 10

**Files:**
- Modify: `src/games/fishing/logic.ts`
- Test: `src/games/fishing/logic.test.ts`

**Interfaces:**
- Consumes: Task 1
- Produces:
  ```ts
  CastCtx += { buffs: readonly BuffId[] }
  State += { buffs: BuffId[] }            // init [], view에 그대로
  export function sellPrice(f: Fish, buffs: readonly BuffId[]): number // dragon-pearl이면 Math.round(price × 108 / 100)
  // rollCatch: 일반 등급 후보 조건을 `!s.legend`로. 후보 = 자격 있는 전설 ?? 자격 있는 신화(needs 모두 legends에), 확률은 후보 등급별.
  //   입질 = round((1500 + r4 × 4500) × biteScale × spinner × (imugi-scale ? 0.85 : 1))
  // cast 오류: need_rod (rodTier < areaMinRod), spot_closed (!spotOpen(now) && !spotOpen(now − TIDE_GRACE_MIN))
  // unlockArea 오류: need_rod (UNLOCKS.minRod > rodTier, 골드 검사보다 먼저)
  // resolve: 잡은 어종 legend.buff가 있고 아직 없으면 buffs에 더하고 result.buff
  // sell: sellPrice 합
  // migrate: buffs = (저장된 알려진 BuffId) ∪ (legends의 신화 buff), BUFFS 순서
  ```
- `logic.version` 10. 주석: `// 10: 신화 등급·버프 상태, 물때 자리·지역 최소 낚싯대 확인`.

- [ ] **Step 1: 실패하는 테스트** (`withTempSpecies`로 신화·전설·물때 자리를 잠시 넣는다. 합성 지역은 `AREAS`에도 잠시 넣는다)
  - `rng 5번: 신화 후보가 있을 때도, 뽑힐 때도 정확히 5번`
  - `기존 골든: 기존 rollCatch 골든 열(지역 6곳, 버프 없음) 결과 그대로` (Review Focus 1)
  - `신화는 needs를 다 잡기 전에는 r0 = 0이어도 안 나온다; 다 잡으면 r0 < MYTHIC_CHANCE에서 나오고 r0 = MYTHIC_CHANCE면 일반; 호기심 찌면 ×1.5; 힘 미달·낚싯대 미달이면 안 나옴; 이미 잡았으면 안 나옴`
  - `같은 자리 전설이 후보면 전설 확률로 전설(신화는 needs 미충족으로 후보 아님)`
  - `일반 등급 추첨에 신화가 섞이지 않는다(rarity 'mythic' 어종이 있어도 throw 없음)`
  - `imugi-scale 버프: 같은 rng에서 입질이 0.85배(반올림), 어종·크기 같음`
  - `resolve로 신화를 잡으면 legends·buffs에 들어가고 잠긴 채 가방에, result.buff; 두 번째 신화는 버프가 겹친다`
  - `sell: dragon-pearl이면 물고기마다 ×1.08 반올림 합, 없으면 지금과 같음`
  - `cast need_rod: 합성 지역 minRod 5, rodTier 4 → need_rod, 5 → 정상`
  - `cast spot_closed: tideSpots 자리, 밀물 시각 → spot_closed; 썰물 끝 5초 뒤 → 받음(여유); 15초 뒤 → spot_closed; 썰물 → 정상`
  - `unlockArea need_rod: UNLOCKS.minRod 5 지역, rodTier 4 + 골드 충분 → need_rod(상태 불변), 5 → 열림`
  - `migrate: v9 세이브 → buffs [] 나머지 그대로; buffs에 모르는 id·중복 → 걸러짐; legends에 신화가 있는데 buffs가 비었으면 다시 생김; version 10`
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing/logic.test.ts`
- [ ] **Step 3: 구현** — `econSim.ts`의 `s.rarity !== 'legend'`도 `!s.legend`로(Task 7과 함께 확인).
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/fishing && npm run typecheck && npm run fn:test`
- [ ] **Step 5: 커밋** — `feat: 낚시 신화 추첨·신화 버프·낚싯대·물때 확인과 로직 버전 10`

### Task 3: 맵의 움직이는 상태 — 진흙·얼음 구멍·`drill` 상호작용

**Files:**
- Modify: `src/games/fishing/map.ts`, `src/games/fishing/walk.ts`, `src/games/fishing/atlas.ts`, `src/games/fishing/minimap.ts`, `src/games/fishing/scene.ts`(타입만), `src/games/fishing/sprites.ts`(타일 `mud`·`ice`·`hole`)
- Test: `map.test.ts`, `walk.test.ts`, `atlas.test.ts`, `minimap.test.ts`, `sprites.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TileKind = … | 'mud' | 'ice'          // 행 글자 'm', 'i'. 'hole'은 행 글자 없이 dyn으로만
  export type MapDynamic = { tide: Tide; holes: ReadonlySet<string> }
  export const STATIC_DYNAMIC: MapDynamic           // { tide: 'high', holes: new Set() }
  MapDef += { tidal: boolean; fog: boolean; snowy: boolean }   // defineMap opts, 기본 false
  MapDef.spots += mud?, hole? 자리(물 종류 표에 'mud'·'hole' 추가)
  // 마지막 인자 dyn = STATIC_DYNAMIC:
  isWalkable(map, tx, ty, opened, dyn?)   // mud: low면 걷기, high면 물. ice: 걷기. hole: 못 걷기
  reachableTiles(map, starts, opened, dyn?)
  interactionAt(map, pos, facing, opened, dyn?) // 앞이 ice이고 구멍 아님 → { kind: 'drill' }; 구멍 → fish(spots.hole); 밀물 mud → fish(spots.mud)
  castTarget(map, pos, facing, power, dyn?)     // 밀물 mud·구멍을 물로 본다
  feetBlocked(map, x, y, opened, dyn?), stepWalk(map, p, input, dtMs, opened, dyn?)
  export function nearestDryTile(map, from: {tx,ty}, opened): {tx,ty} // 진흙을 지나는 BFS로 가장 가까운 늘 걷는 칸(결정적: 거리, 그다음 ty, tx)
  export const MAX_HOLES = 3
  export function addHole(holes: readonly string[], tx: number, ty: number): string[] // 넷째면 가장 오래된 것을 뺀다
  // atlas.ts: spotAnchors가 썰물 dyn으로 설 자리를 계산하고 drill 상호작용을 spots.hole 자리로 친다
  // minimap.ts: MINIMAP_LOOK에 mud(갯벌 무늬)·ice(흰 바탕 금무늬)
  ```
- 기존 호출부는 인자를 안 넘겨 동작 불변(기존 테스트 그대로 통과).

- [ ] **Step 1: 실패하는 테스트** (합성 맵: 모래 / 진흙 / 갯골 물 줄, 얼음판 + 물가)
  - `mud: high면 못 걷고 그 칸을 보면 fish(spots.mud), low면 걷고 낚시 불가`
  - `ice: 걷는다. ice를 보면 drill. 구멍이 되면 못 걷고 fish(spots.hole)`
  - `castTarget: 밀물 진흙 위로 찌가 날아간다, 구멍 하나짜리면 구멍 칸 중앙`
  - `nearestDryTile: 진흙 한가운데서 가장 가까운 모래 칸, 같은 거리면 ty·tx 작은 쪽`
  - `addHole: 같은 칸 두 번은 하나, 넷째는 첫째를 뺀다`
  - `atlas spotAnchors: 갯골 자리 대표점이 생긴다(썰물 기준), 얼음 자리 대표점이 생긴다`
  - `minimap: 모든 TileKind에 look(타입), mud·ice 색`
  - `sprites: tile-mud, tile-mud-wet-0/1, tile-ice, tile-hole-0/1 16×16`
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing`
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/fishing && npm run typecheck`
- [ ] **Step 5: 커밋** — `feat: 낚시 맵 물때 진흙과 얼음 구멍(움직이는 맵 상태)`

### Task 4: 미니게임 — `surge` 유형과 버프 바

**Files:**
- Modify: `src/games/fishing/minigame.ts`, `src/games/fishing/scene.ts`(용솟음 테두리 깜박임)
- Test: `src/games/fishing/minigame.test.ts`, `scene.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Behavior = … | 'surge'           // data.ts
  export function barParams(speciesId, rodTier, equipped = [], buffs: readonly BuffId[] = []): BarParams
  //   dragon-breath면 barSize × BUFF_FX.dragonBar
  export function surgePhase(tMs: number): 'calm' | 'surge'  // 3,600ms 주기, 앞 2,400 calm
  // pickTarget('surge'): calm → 0.3 + 0.4r, surge → 현재 위치에서 0.5 이상 떨어진 곳(dart 방식). 속도 배율 calm 1, surge 1.6
  ```
- [ ] **Step 1: 실패하는 테스트**
  - `barParams: dragon-breath → barSize ×1.08, 코르크와 곱; 모르는 buff 무시`
  - `surgePhase: 0 calm, 2399 calm, 2400 surge, 3599 surge, 3600 calm`
  - `surge 이동량: surge 구간 평균 이동량 > calm 구간의 3배(여러 시드)`
  - `안 누르기(Review Focus 3): 테스트용 surge 어종(난이도 .97·1.0) × 낚싯대 5·6 × 칸 안의 찌 조합 × 버프 {없음, dragon-breath}, 그리고 기존 모든 어종 × 낚싯대 × 찌 조합 × dragon-breath, 60초 안 누르면 잡히는 비율 0`
  - `사람 비슷한 봇(200ms 반응, 기존 도우미): surge 난이도 1.0, 6단계 + 코르크·가시 → 시드 100개 중 25~70% 잡음; 5단계 찌 없음 → 10% 이상`
  - `봇 기준선: 기존 9경우(옛 값 ±15%p) 그대로`
  - `scene: surge 단계 동안 트랙 테두리 색이 번갈아 바뀐다`
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing/minigame.test.ts`
- [ ] **Step 3: 구현** — 봇 범위에 안 들면 `surge` 상수(주기·속도 배율)만 조정하고 값을 리뷰 반영에 적는다.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/fishing`
- [ ] **Step 5: 커밋** — `feat: 낚시 신화 미니게임 용솟음(surge)과 백룡의 숨결 바`

### Task 5: 장면 — 물때 캐시·밀물 이동·구멍·안개·늘 눈·신화 빛고리, 화면 배선

**Files:**
- Modify: `src/games/fishing/scene.ts`, `src/games/fishing/Game.tsx`, `src/games/fishing/Controls.tsx`(행동 이름 "구멍 뚫기"), `src/games/fishing/sprites.ts`(`icon-tide-low/high` 7×7)
- Test: `scene.test.ts`, `Game.test.tsx`

**Interfaces:**
- Consumes: Task 3, Task 4
- Produces:
  ```ts
  WorldScene += { dyn: MapDynamic; drillMs: number | null; mythicFlashMs: number | null }
  // mapCache(map, tide): tidal 맵만 물때별, 바뀌면 이전 캐시 dispose 후 새로(동시에 하나)
  // drawFog(ctx, s, w, h): map.fog만, 밤 색조 다음·HUD 앞. 짙기 = min(0.75, 0.35 + 0.25·nightLevel + (rain ? 0.15 : 0))
  //   비네트 캔버스 (w,h)별 캐시, releaseSceneCache가 함께 비움
  // snowy 맵: rain이면 눈 입자·HUD 눈 아이콘
  // tidal 맵: 시계 판에 물때 아이콘
  // Game.tsx: dyn = { tide: tideAt(clock), holes } 매 프레임; 물때가 high로 바뀐 순간 진흙 위 + 낚시 중 아님 → 페이드 후 nearestDryTile, 알림
  //   "밀물이 들어와 물가로 나왔어요"; 썰물 끝 30게임분 전 "곧 밀물이에요"; drill 상호작용 → 1,200ms 뒤 addHole; 맵을 떠나면 holes 비움
  //   오류 문구: need_rod "백골 낚싯대 이상이 있어야 해요", spot_closed "물이 들어와 갯골에 갈 수 없어요"
  ```
- [ ] **Step 1: 실패하는 테스트**
  - `scene: tidal 합성 맵에서 tide가 바뀌면 renderFrame이 한 번 더 불리고, 같은 tide면 안 불린다(캐시)`
  - `scene: fog 맵에서 화면 가운데(캐릭터)는 원래 색에 가깝고 모서리는 어둡다; fog 아닌 맵은 그대로; 비 오는 밤이 맑은 낮보다 어둡다`
  - `scene: snowy 맵 + 여름 비 → 눈 입자, HUD icon-snow`
  - `scene: 구멍은 월드 레이어에 그려지고 캐시 재생성 없음`
  - `Game: 합성 tidal 맵에서 시계를 썰물 끝으로 넘기면 진흙 위 캐릭터가 가장 가까운 모래로 옮겨지고 알림; 낚시 중이면 끝난 뒤 옮긴다` (Review Focus 4)
  - `Game: 얼음을 보고 행동 → "구멍 뚫기" 1.2초 뒤 같은 자리에서 낚시 가능, 맵을 나갔다 오면 구멍 없음`
  - `Game: cast가 need_rod·spot_closed면 해당 문구`
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing`
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/fishing && npm run typecheck`
- [ ] **Step 5: 커밋** — `feat: 낚시 물때·안개·눈 장면 효과와 얼음 구멍 뚫기`

### Task 6: 신화 표시와 신화의 힘(버프) 화면

**Files:**
- Modify: `src/games/fishing/Menus.tsx`, `src/games/fishing/Game.tsx`, `src/games/fishing/MapPanel.tsx`, `src/games/fishing/atlas.ts`, `src/games/fishing/fishing.css`, `src/games/fishing/sprites.ts`(버프 그림 9×9 셋)
- Test: `Game.test.tsx`, `MapPanel.test.tsx`, `atlas.test.ts`, `sprites.test.ts`

**Interfaces:**
- Produces:
  ```ts
  RARITY_NAMES.mythic = '신화'
  // 도감: fish-dex-item-mythic(이중 테두리), 배지 fish-dex-mythic(배경 --ink, 글자 --bg).
  //   안 잡음: "??? · 신화 · 세이브당 한 마리 · 먼저 잡을 전설 m/n" (전설 이름 없음)
  // 가방: fish-cell-mythic, aria-label "신화 …"; 가방 창 "신화의 힘 n/3" 줄 — 얻은 버프 그림·이름·설명, 못 얻은 칸 자물쇠 + "???"
  // 잡은 알림: "신화의 물고기!" + "새 힘: <이름> — <설명>", 3.5초, 장면 빛고리 1.5초(mythicFlashMs)
  // 상점 예상가: sellPrice(f, view.buffs)
  // 미니게임: barParams(…, view.buffs ?? [])
  // atlas FishRow에 mythic, notNowReason에 '먼저 잡을 전설'(잡은 신화 행에는 해당 없음, 안 잡은 행은 이유 숨김 그대로)
  // 지도: 잡은 신화 행에 버프 이름
  ```
- 옛 서버 응답(`view.buffs` 없음)은 빈 배열로 본다.

- [ ] **Step 1: 실패하는 테스트** (`withTempSpecies`로 신화 하나)
  - `도감: 안 잡은 신화 칸에 이름·그림·조건 없음, "신화"·"먼저 잡을 전설 0/2"; 잡은 신화는 이중 테두리 + 버프 이름` (Review Focus 7)
  - `가방: 신화 칸 fish-cell-mythic, aria-label "신화 …"; 신화의 힘 줄 — 버프 없으면 "???" 셋, alt·aria-label에도 버프 이름 없음; dragon-pearl 있으면 이름·설명`
  - `알림: 신화 잡기 결과(result.buff)면 "신화의 물고기!"와 새 힘 줄, 3.5초 뒤 사라짐`
  - `상점: dragon-pearl이면 예상가가 sellPrice 합`
  - `지도: 안 잡은 신화 행 실루엣 + "신화", alt "미발견 물고기"`
  - `sprites: buff-imugi-scale, buff-dragon-breath, buff-dragon-pearl 9×9`
  - `팔레트 대비: 모든 팔레트에서 --ink 위 --bg 글자 대비 4.5:1 이상`
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing`
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/fishing && npm run typecheck`
- [ ] **Step 5: 커밋** — `feat: 낚시 신화 표시와 신화의 힘 화면`

### Task 7: 경제 시뮬레이션 확장

**Files:**
- Modify: `src/games/fishing/econSim.ts`, `src/games/fishing/gold.test.ts`

**Interfaces:**
- Produces:
  ```ts
  TRIP_SEC: Record<AreaId, number>       // 새 지역은 M2·M3에서 값 추가(타입이 강제)
  // fishValue: 후보에서 !s.legend(전설·신화 제외), 열린 자리 시각만 평균
  // hourlyIncome(area, spot, gear): tideSpots 자리는 열린 비율 × 그 자리 + 나머지 × 같은 지역 첫 늘 열린 자리;
  //   rodTier < areaMinRod면 0; gear.buffs의 imugi-scale은 입질, dragon-pearl은 판매가에 반영
  export type Gear = { rodTier; bagTier; equipped; buffs?: readonly BuffId[] }
  export function buffsAt(areas, rodTier): BuffId[] // 그 신화의 지역이 열렸고 낚싯대가 신화 minRod 이상이면 얻었다고 본다(dragon-breath 제외 — 성공률 고정 가정)
  ```
- [ ] **Step 1: 실패하는 테스트**
  - 기존 `gold.test.ts` 고정값이 모두 그대로(신화·새 지역 없음 → 같은 수)
  - `hourlyIncome: 합성 tideSpots 자리는 열린 비율로 섞인다; minRod 지역은 낮은 낚싯대면 0; imugi-scale·dragon-pearl이 수입을 올린다(입질·판매가만큼)`
  - `buffsAt: 지역·낚싯대 조건 전에는 빈 배열`
- [ ] **Step 2~4**: 실패 확인 → 구현 → `npx vitest run src/games/fishing/gold.test.ts`
- [ ] **Step 5: 커밋** — `test: 낚시 경제 시뮬레이션에 물때 자리·지역 낚싯대·신화 버프`

### Task 8: M1 배포 체크리스트와 전체 검증

**Files:** Modify `docs/deploy-checklist.md`

- [ ] **Step 1** — 낚시 절에 "낚시 5부 M1(신화 등급·공통 체계)": `logic.version` 10, `world` 재배포(PR 브랜치에서 → 미리보기 확인 → 머지 → main에서 다시 → Vercel), DB 변경 없음, 새로고침 안내, 9로 되돌리지 않기(되돌려도 버프는 `legends`에서 다시 생기지만 v10 응답을 아는 화면이 깨질 수 있다), 수동 확인(기존 지역 낚시·전설 표시·상점 예상가 그대로, 호기심 찌 설명 "희귀·전설·신화", 가방 "신화의 힘 0/3"과 "???" 셋, 오류 문구는 M2 뒤 확인).
- [ ] **Step 2** — `npm test && npm run typecheck && npm run build && npm run fn:test` 모두 PASS
- [ ] **Step 3** — 커밋 `docs: 낚시 5부 M1 배포 안내`

---

# M2 — 갯벌·늪지 (`logic.version` 11)

브랜치: `feat/fishing-world-5-m2` (M1 머지 뒤 main).

### Task 1: 갯벌·늪지 타일

**Files:** Modify `map.ts`, `scene.ts`, `sprites.ts`, `minimap.ts`; Test `map.test.ts`, `scene.test.ts`, `sprites.test.ts`, `minimap.test.ts`

**Interfaces:**
- Produces: `TileKind += 'creek' | 'reed' | 'marsh' | 'bog' | 'boardwalk' | 'deadtree'`, 글자 `g` creek, `R` reed, `z` marsh, `Q` bog, `d` boardwalk, `X` deadtree. 물 종류(낚시 가능) += creek, marsh, bog. 걷는 칸 += boardwalk. 키 큰 장애물(`TALL_SPRITE`) += reed, deadtree. 물 그림 2프레임: creek·marsh·bog. 민물 바위 규칙(이웃 물 그림)에 새 물 포함. 문 그림 `gate-driftwood`, `gate-vines`(16×16), `Gate.look += 'driftwood' | 'vines'`.
- [ ] Step 1 테스트: 글자 → 종류, 걷기·낚시 가능 여부, 키 큰 장애물 윗부분이 캐릭터 위에, 늪 속 바위에 늪 그림, 스프라이트 크기, 축소 그림 색 → Step 2 실패 → Step 3 구현 → Step 4 `npx vitest run src/games/fishing && npm run typecheck` → Step 5 커밋 `feat: 낚시 갯벌·늪지 타일과 문 그림`

### Task 2: 맵 — 갯벌·늪지, 마을 서쪽·숲 서쪽 출구와 문

**Files:**
- Create: `src/games/fishing/maps/tideflat.ts`, `src/games/fishing/maps/swamp.ts`
- Modify: `maps/index.ts`, `maps/village.ts`, `maps/forest.ts`, `data.ts`(`AREAS`·`AreaId`·`UNLOCKS` — 이 Task에서 지역만 추가, 어종은 Task 6)
- Test: `maps/maps.test.ts`, `map.test.ts`, `position.test.ts`

**Interfaces:**
- Produces:
  ```ts
  AreaId += 'tideflat' | 'swamp'
  AREAS += { id: 'tideflat', name: '갯벌', spots: ['estuary', 'creek'], tideSpots: ['creek'] },
           { id: 'swamp', name: '늪지', spots: ['marsh', 'bog'] }
  UNLOCKS.tideflat = { price: 30000, name: '갯벌 장화' }, UNLOCKS.swamp = { price: 60000, name: '늪 나무 데크' }
  TIDEFLAT = defineMap('tideflat', …, { tidal: true, spots: { river: 'estuary', water: 'estuary', mud: 'estuary', creek: 'creek' },
    exits: [{ edge: 'e', … target: 'village' }], teleporter, world: { tx: -48, ty: 4 } })
  SWAMP = defineMap('swamp', …, { fog: true, spots: { marsh: 'marsh', bog: 'bog' }, exits: [{ edge: 'e', … target: 'forest' }], teleporter, world: { tx: -96, ty: -34 } })
  // village: 서쪽 가장자리 ty 19~21의 'o' → '.', exits += { edge: 'w', from: 19, to: 21, target: 'tideflat', … },
  //   gates += { area: 'tideflat', tiles: { tx: 1, ty: 19, w: 1, h: 3 }, look: 'driftwood', front: { tx: 2, ty: 20, facing: 'left' } }
  // forest: 서쪽 가장자리 ty 11~12에 길, exits += { edge: 'w', …, target: 'swamp' }, gates += { area: 'swamp', look: 'vines', … }
  ```
- 설계 §4.3·§4.4. 맵 크기 40×30~56×40, 갯골 칸은 늘 걷는 칸(모래·둑·데크 등 `mud` 아닌 걷는 칸)과 상하좌우로 붙지 않는다. 수렁은 데크 끝에서만 보인다.

- [ ] **Step 1: 실패하는 테스트**
  - 기존 맵 검사가 새 맵 두 장에도(테두리, 출구 짝, 도착점, 연결 — 연결은 썰물 dyn으로)
  - `마을: SHOP·SPAWN 불변, 부두 끝→문 37칸, 서쪽 출구 → 갯벌, 잠긴 동안 문 앞이 gate`
  - `숲: 서쪽 출구 → 늪지, 잠긴 동안 gate, 기존 동쪽·동굴 출구 그대로`
  - `갯벌: 갯골 칸에 붙은 늘 걷는 칸 없음; 밀물 상태로 모든 늘 걷는 칸에서 갯골 자리 상호작용이 나오지 않음; 썰물이면 도착점에서 갯골 자리에 닿음; 모든 진흙 칸에서 nearestDryTile이 있음` (Review Focus 4)
  - `늪지: fog true, marsh·bog 자리에 닿음, indoor false`
  - `순간이동기 두 개, 세계 원점 서로 다름, 요금 마을↔갯벌 36 안팎·숲↔늪지 36 안팎(±3)`
  - `position: 저장 위치가 tideflat인데 view.areas에 없으면 마을 SPAWN; 진흙 위 저장 위치를 밀물 시각에 복원하면 nearestDryTile`
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing`
- [ ] **Step 3: 구현** — 맵을 그리며 검사를 통과하게 칸을 고른다(빌더 재량, 설계 §12).
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/fishing && npm run typecheck`
- [ ] **Step 5: 커밋** — `feat: 낚시 갯벌·늪지 맵과 마을·숲 새 출구`

### Task 3: 화면 — 해금 창·도감·지도 탭에 새 지역

**Files:** Modify `Game.tsx`, `Menus.tsx`(`SPOT_NAMES`), `MapPanel.tsx`; Test `Game.test.tsx`, `MapPanel.test.tsx`

- `SPOT_NAMES += estuary 하구, creek 갯골, marsh 늪, bog 수렁`. 해금 창: 통나무 더미 "갯벌 장화 · 30,000 G", 덩굴 "늪 나무 데크 · 60,000 G". 지도 갯골 상세 "썰물(2~6시·14~18시)에만 걸어 들어가요", "지금"은 `spotOpen` 반영.
- [ ] Step 1 테스트: 해금 창 문구·가격·골드 부족, 해금 뒤 바로 지나감, 도감·지도 탭 8개(어종이 있는 지역 — 어종 전에는 지도 탭만), 갯골 "지금"이 밀물이면 꺼짐 → Step 2~4 → Step 5 커밋 `feat: 낚시 갯벌·늪지 해금 창과 지도·도감 탭`

### Task 4: 갯벌·늪지 물고기 그림 19종

**Files:** Modify `sprites.ts`; Test `sprites.test.ts`
- `fish-<id>` 19종(설계 §5.1·§5.2). 이무기는 비늘 광택·여의주 없는 뱀 모양 용. 기존 그림과 겹치지 않게.
- [ ] 테스트(크기·팔레트 범위·실루엣 생성) → 구현 → 커밋 `feat: 낚시 갯벌·늪지 물고기 그림 19종`

### Task 5: 도전과제·순간이동기 데이터

**Files:** Modify `data.ts`; Test `data.test.ts`, `teleport.test.ts`, `logic.test.ts`
- `CHALLENGES += tideflat-creek { spot: 'creek', count 5 }, swamp-rain-night { weather: 'rain', night: true, count 3 }` (설계 §4.7). 기존 "어떤 계절에도 깰 수 있다" 검사가 새 과제도(계절마다 rod 1 후보, 갯골은 열린 시각만).
- [ ] 테스트 → 구현 → 커밋 `feat: 낚시 갯벌·늪지 도전과제`

### Task 6: 갯벌·늪지 어종 19종과 이무기, `logic.version` 11

**Files:** Modify `data.ts`, `logic.ts`(version), `econSim.ts`(`TRIP_SEC` tideflat 45·swamp 90); Test `data.test.ts`, `logic.test.ts`, `Game.test.tsx`

**Interfaces:**
- Produces: `SPECIES` 75종(설계 §5.1·§5.2 표 그대로). `logic.version` 11. `migrate`: v10 → 그대로(새 지역 id·어종을 알게 됨).
- [ ] **Step 1: 실패하는 테스트**
  - `75종, 기존 56종 스냅숏 불변, 새 19종 스냅숏`
  - `보장: 모든 지역 × 자리 × 계절 × 정각 × 날씨(열린 자리만) × areaMinRod로 common ≥ 1`
  - `지역 규칙(갯벌·늪지): 상시 common ≥ 2, 밤 전용 ≥ 1, 비 전용 ≥ 1, 유형 ≥ 3, 전설 1`
  - `신화 규칙: 이무기의 지역·자리에서 나올 수 있는 전설(천년 자라)이 needs에 있다; needs는 모두 전설 id; buff imugi-scale` (Review Focus 2)
  - `logic: 갯벌 열린 세이브에서 creek 썰물 → 짱뚱어·낙지 등, 밀물 → spot_closed; estuary 늘 정상; 늪지 bog 비 오는 밤 rod 5 + 두 전설 잡음 + 힘 0.95 + r0 0 → 이무기, buffs에 imugi-scale`
  - `records dex 'n/75', challenges 'n/8'`
  - `migrate v10 세이브(areas에 tideflat) → 유지, version 11`
- [ ] **Step 2~4** — `npx vitest run src/games/fishing && npm run typecheck && npm run fn:test`
- [ ] **Step 5: 커밋** — `feat: 낚시 갯벌·늪지 어종 19종과 신화 이무기, 로직 버전 11`

### Task 7: 경제 갱신

**Files:** Modify `econSim.ts`(`BUY_ORDER`), `gold.test.ts`
- `BUY_ORDER`: 기존 13개 → 갯벌 → 늪지 → 백골 → 50칸 → 용왕 → 60칸 (산정·난파선은 M3).
- [ ] 테스트: 기존 품목 13개 구매 시각 불변(상한 없음·상한 모두, 지금 값 그대로 고정), 새 지역 수입: 갯벌 갯골(섞음) < 동굴 용암, 늪지 수렁 ≤ 동굴 용암(낚싯대 4·5·6, 40칸, 회전+호기심), 총액 1,276,300, 하루 1시간 + 상한 다 사기 값 기록(저장소 밖 시험 계산 31.7일, 32일 ±20%), 21일 초과 → 구현 → 커밋 `test: 낚시 경제에 갯벌·늪지 해금`
- 어종 가격을 ±20% 안에서 조정했다면 값과 이유를 아래 "리뷰 반영"에 적는다.

### Task 8: M2 배포 체크리스트와 전체 검증

- [ ] `docs/deploy-checklist.md` "낚시 5부 M2(갯벌·늪지)": `logic.version` 11, `world` 재배포 순서(M1과 같음), 새로고침 안내(옛 화면은 새 어종에 중립값으로 싸우지만 맵이 없다), 10으로 되돌리지 않기(옛 migrate가 갯벌·늪지 해금(9만 G)과 새 어종·도감을 지운다). 수동 확인: 마을 서쪽 끝 통나무 더미 해금·가격, 갯벌에서 썰물(2~6시·14~18시)에 진흙으로 걸어 들어가 갯골 낚시, 밀물이 들어오면 물가로 옮겨짐·"곧 밀물이에요", 밀물에 갯골 낚시 불가, HUD 물때 아이콘, 숲 서쪽 덩굴 해금, 늪지 안개(밤·비에 더 짙음, 찌가 보임), 폰에서 안개·물때 바뀔 때 끊김 없음, 도전과제 둘·순간이동기 둘(요금 36 G 안팎), 도감·지도 탭 8개, 이무기(테스트 계정)를 잡으면 "신화의 물고기!"·새 힘·입질 빨라짐.
- [ ] `npm test && npm run typecheck && npm run build && npm run fn:test`
- [ ] 커밋 `docs: 낚시 5부 M2 배포 안내`

---

# M3 — 산정 호수·난파선 앞바다 (`logic.version` 12)

브랜치: `feat/fishing-world-5-m3` (M2 머지 뒤 main).

### Task 1: 산정·난파선 타일

**Files:** Modify `map.ts`, `scene.ts`, `sprites.ts`, `minimap.ts`; Test 같은 이름 테스트들
- `TileKind += 'snow' | 'hotspring' | 'snowpine' | 'deck' | 'hull' | 'mast' | 'deep'`, 글자 `s` snow, `h` hotspring, `A` snowpine, `e` deck, `n` hull, `M` mast, `v` deep. 걷는 칸 += snow, deck. 물 종류 += hotspring, deep. 키 큰 장애물 += snowpine, mast. 물 그림 2프레임: hotspring(김), deep. `Gate.look += 'snowdrift'`, `gate-snowdrift`.
- [ ] 테스트 → 구현 → 커밋 `feat: 낚시 산정 호수·난파선 타일과 문 그림`

### Task 2: 맵 — 산정 호수·난파선, 산 호수 산길·섬 두 번째 선착장

**Files:**
- Create: `maps/summit.ts`, `maps/wreck.ts`
- Modify: `maps/index.ts`, `maps/lake.ts`, `maps/island.ts`, `data.ts`(`AREAS`·`AreaId`·`UNLOCKS`)
- Test: `maps/maps.test.ts`, `map.test.ts`

**Interfaces:**
- Produces:
  ```ts
  AreaId += 'summit' | 'wreck'
  AREAS += { id: 'summit', name: '산정 호수', spots: ['ice', 'hotspring'] },
           { id: 'wreck', name: '난파선 앞바다', spots: ['wreck', 'abyss'], minRod: 5 }
  UNLOCKS.summit = { price: 120000, name: '등산 장비' }, UNLOCKS.wreck = { price: 150000, name: '원양 어선', minRod: 5 }
  SUMMIT = defineMap('summit', …, { snowy: true, spots: { hole: 'ice', hotspring: 'hotspring' }, exits: [{ edge: 's', … target: 'lake' }], teleporter, world: { tx: 0, ty: -104 } })
  WRECK = defineMap('wreck', …, { spots: { water: 'wreck', deep: 'abyss' }, docks: [{ … target: 'island' }], teleporter, world: { tx: 380, ty: 1100 } })
  // lake: 북동쪽 tx 45~46 산길, exits += { edge: 'n', …, target: 'summit' }, gates += { area: 'summit', look: 'snowdrift', … }
  // island: 남쪽 물가 docks += { front, target: 'wreck', entry, boat }
  ```
- [ ] **Step 1: 실패하는 테스트**
  - 기존 맵 검사가 새 맵 두 장에도
  - `산 호수: 남쪽 → 강 그대로, 북쪽 → 산정, 잠긴 동안 gate`
  - `섬: 선착장 둘(마을·난파선), 기존 선착장 위치·도착점 그대로`
  - `산정: 얼음판에서 drill, 구멍 → ice 자리, 온천 → hotspring, snowy true`
  - `난파선: 걸어서 나가는 출구 없음, 선착장 하나(→ 섬), wreck·abyss 자리, 갑판 끝에서만 심해가 보임`
  - `요금: 산 호수↔산정 35 안팎, 섬↔난파선 43 안팎, 마을↔난파선 146 안팎(±5)`
- [ ] Step 2~4 → Step 5 커밋 `feat: 낚시 산정 호수·난파선 맵과 산길·두 번째 선착장`

### Task 3: 화면 — 해금 창(낚싯대 요구)·도감·지도

**Files:** Modify `Game.tsx`, `Menus.tsx`, `MapPanel.tsx`, `atlas.ts`; Test `Game.test.tsx`, `MapPanel.test.tsx`, `atlas.test.ts`
- `SPOT_NAMES += ice 얼음 구멍, hotspring 온천, wreck 난파선, abyss 심해`. 섬 두 번째 선착장 구매 창: "원양 어선 · 150,000 G · 백골 낚싯대 이상이 있어야 나갈 수 있어요", 낚싯대 4단계 이하면 버튼 막힘. 지도 잠긴 난파선 카드에 낚싯대 요구, 얼음 자리 상세 "얼음에 구멍을 뚫고 낚아요". `unlockPlace(wreck)` = 섬 선착장.
- [ ] 테스트(낚싯대 4 → 버튼 막힘·문구, 5 → 구매 가능, 서버 need_rod 문구, 탭 10개, 섬 → (배) 난파선 경로) → 구현 → 커밋 `feat: 낚시 산정 호수·난파선 해금 창과 지도·도감`

### Task 4: 산정·난파선 물고기 그림 19종

**Files:** Modify `sprites.ts`; Test `sprites.test.ts`
- 설계 §5.3·§5.4. 천지 백룡(흰 비늘·푸른 갈기), 용왕(붉은 수염·금빛 뿔 달린 큰 물고기 모양).
- [ ] 테스트 → 구현 → 커밋 `feat: 낚시 산정 호수·난파선 물고기 그림 19종`

### Task 5: 도전과제

**Files:** Modify `data.ts`; Test `data.test.ts`, `logic.test.ts`
- `CHALLENGES += summit-perfect { spot: 'ice', perfect: true, count 3 }, wreck-abyss-night { spot: 'abyss', night: true, count 5 }`. 계절 검사는 `areaMinRod`로(난파선 5).
- [ ] 테스트 → 구현 → 커밋 `feat: 낚시 산정 호수·난파선 도전과제`

### Task 6: 산정·난파선 어종 19종과 신화 둘, `logic.version` 12

**Files:** Modify `data.ts`, `logic.ts`(version), `econSim.ts`(`TRIP_SEC` summit 90·wreck 120); Test `data.test.ts`, `logic.test.ts`, `gold.test.ts`(minRod 검사 고침)

- [ ] **Step 1: 실패하는 테스트**
  - `94종, 기존 75종 스냅숏 불변`
  - `보장(열린 자리, areaMinRod): 난파선은 낚싯대 5로 common ≥ 1`
  - `산정·난파선 어종은 seasons 없음; 지역 규칙(상시 common ≥ 2 등)`
  - `신화 규칙: 천지 백룡 needs ⊇ {설백 자치}, 용왕 needs ⊇ {산갈치}; buff가 셋 모두 다름; 용왕 minRod 6` (Review Focus 2)
  - `gold.test "새 장비는 어떤 어종에도 필요 없다" → "난파선 어종·신화를 뺀 모든 어종이 4단계 이하, 난파선 어종은 5 이상, 용왕 6"`
  - `logic: 난파선 열린 세이브 rod 5 abyss 정상, rod 4(꼬인 세이브) → need_rod (Review Focus 5); 산정 ice·hotspring 정상(서버는 구멍을 모른다); 천지 백룡(맑은 0~4시, 두 전설) → buffs dragon-breath; 용왕(비, rod 6, 세 전설, 힘 0.98) → dragon-pearl`
  - `records dex 'n/94', challenges 'n/10'`
  - `migrate v11 → 그대로, version 12`
- [ ] **Step 2~4** — `npx vitest run src/games/fishing && npm run typecheck && npm run fn:test`
- [ ] **Step 5: 커밋** — `feat: 낚시 산정 호수·난파선 어종 19종과 신화 천지 백룡·용왕, 로직 버전 12`

### Task 7: 경제 최종 고정

**Files:** Modify `econSim.ts`(`BUY_ORDER`), `gold.test.ts`, `docs/superpowers/specs/2026-11-24-fishing-world-5-design.md`(§8 실제 값)
- `BUY_ORDER`: 기존 13개 → 갯벌 → 늪지 → 백골 → 산정 → 50칸 → 난파선 → 용왕 → 60칸.
- [ ] **Step 1: 테스트** (Review Focus 6)
  - 기존 품목 13개 구매 시각 불변
  - 총액 1,546,300
  - 수입 순서: 갯벌 갯골 < 동굴 용암, 늪지 수렁 ≤ 동굴 용암, 산정 얼음 ≈ 동굴 용암 × 1.0~1.4(낚싯대 5), 난파선 심해 ≈ × 1.3~1.9(낚싯대 5)
  - 고급 장비·새 해금은 살 때마다 시간당 수입이 오르거나 같다(해금 뒤 첫 수입 ≥ 앞)
  - 하루 1시간 + 상한(버프 포함) 다 사기 **34일 ±20%(27~41)**, 21일 초과, 기존 품목 7일 안
  - 기록용(±10%): 상한 없이 다 사기 약 16.6시간, 하루 3시간 약 18일, 5시간 약 12.4일
- [ ] **Step 2~4** — 실패 확인 → 값 맞춤(가격은 설계 ±20% 안) → `npx vitest run src/games/fishing/gold.test.ts`
- [ ] **Step 5: 커밋** — `test: 낚시 5부 경제 고정(하루 1시간 약 34일)`

### Task 8: M3 배포 체크리스트와 전체 검증

- [ ] `docs/deploy-checklist.md` "낚시 5부 M3(산정 호수·난파선)": `logic.version` 12, `world` 재배포 순서, 새로고침 안내, 11로 되돌리지 않기(옛 migrate가 산정·난파선 해금(27만 G)과 새 어종을 지운다; 버프는 legends에서 다시 생기지만 신화 어종을 모르면 legends에서도 빠진다 — 절대 되돌리지 말 것). 수동 확인: 산 호수 북동쪽 눈더미 해금, 산정 얼음 위를 걸어 구멍 뚫기(1.2초, 넷째 구멍이면 첫째가 얼어붙음, 다시 오면 구멍 없음), 여름에도 눈, 온천 낚시, 섬 남쪽 선착장 — 명장 낚싯대면 막힘 문구, 백골이면 구매 → 난파선 왕복, 심해·난파선 낚시, 순간이동 요금(섬 43, 마을 146 안팎), 도감·지도 탭 10개, 천지 백룡·용왕(테스트 계정)의 신화 알림·버프(바가 길어짐, 판매 예상가 +8%), "신화의 힘 3/3", 프로필 기록 n/94·n/10. 배포 뒤 관찰: 하루 버는 양이 시뮬레이션(늦은 수입 약 13만 G/h)과 크게 다르면 난파선 어종 가격을 다시 잡는다.
- [ ] `npm test && npm run typecheck && npm run build && npm run fn:test`
- [ ] 커밋 `docs: 낚시 5부 M3 배포 안내`

---

## 리뷰 반영

(구현하며 조정한 값과 이유를 여기에 적는다.)

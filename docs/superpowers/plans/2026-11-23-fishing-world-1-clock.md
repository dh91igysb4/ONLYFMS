# 펨타듀 낚시 — 넓은 세계 1단계 (시계·날씨·행동 유형·조건 판정) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게임 시계(하루 24분·주간 계절·날씨)를 만들고, 어종에 장소·계절·시간·날씨 조건과 행동 유형을 붙여, 서버가 던지는 순간의 조건으로 추첨하게 한다. 마을 어종은 16종(기존 12 + 새 4), 다금바리는 조건 전설이 된다.

**Architecture:** 순수 모듈 `clock.ts`가 `nowMs`에서 시각·게임 날짜·계절·날씨를 계산한다(서버·화면 공용, 저장 상태 없음). `data.ts` 어종 형식이 조건·행동 유형·지역을 갖고, `logic.ts`의 `rollCatch`가 조건으로 후보를 걸러 전설 판정 → 등급 → 어종 순으로 추첨한다(`logic.version` 3). 화면은 `server_now` 오프셋으로 같은 시계를 그리고(HUD·밤 색조·비/눈), 미니게임은 어종의 행동 유형대로 움직인다.

**Tech Stack:** TypeScript, React 18, Canvas 2D, vitest, Deno(`world` 함수 테스트). 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-23-fishing-world-design.md` (이 계획은 §10의 1단계)

## Global Constraints

- `src/games/fishing/{clock,data,logic,minigame,map,walk}.ts`는 순수 함수, 외부 의존 없음, 상대 import에 `.ts` 확장자 (Deno가 `logic.ts`·`data.ts`·`clock.ts`를 번들한다). React·DOM·`Date.now()`·`Math.random` 금지 (시간은 인자로).
- 플랫폼 코드(`src/platform/`, `src/app/`)와 DB는 바꾸지 않는다. `supabase/functions/world/handler.test.ts`의 낚시 페이로드 한 줄만 고친다(Task 6).
- 화면 문구 한국어, 모바일 우선. 캔버스 밖 색은 `theme.css` 토큰만, 캔버스 내부는 자체 팔레트.
- 그림은 전부 새로 그린다(16px 픽셀 아트, `sprites.ts` 형식). 원작 그림 금지.
- 시계: KST = UTC+9. 실제 1초 = 게임 1분, 게임 하루 = 실제 24분(1,440,000ms). 계절은 `SEASON_ANCHOR_MS = Date.UTC(2026, 10, 22, 15, 0, 0)`(2026-11-23 월 0시 KST)부터 1주씩 봄→여름→가을→겨울. 비 확률 25%, 게임 날짜마다 결정. 밤 = 게임 20시~5시.
- 기존 12종 id·가격·크기·난이도 유지. 전설 확률 `LEGEND_CHANCE = 0.08`, 전설 최소 강도 0.95.
- `logic.version` 3. 지역 id `village|river|forest|lake|cave|island`, 기본 열린 지역 `['village','river','forest']`.
- 커밋 `type: 내용`, 마지막 두 줄 트레일러(Co-Authored-By: <작성 모델 이름> <noreply@anthropic.com> / Claude-Session: https://claude.ai/code/session_01T7oyVpQAuQkbAiCkNHahWh). 경로 지정 스테이징, 푸시 금지.

## Review Focus

1. **배포 사이 구버전 화면**: 새 `world`가 배포된 뒤 캐시된 옛 화면이 `cast { area: 'pier', spot: 'pier' }`를 보낸다 → `village`로 받아 정상 추첨. → Task 3
2. **기기 시계가 몇 시간 틀림**: 화면 시계는 `server_now` 오프셋을 쓰므로 서버와 같은 계절·시각·날씨를 그린다. → Task 6
3. **던진 뒤 조건이 바뀜**: 비가 그친 뒤나 자정을 넘긴 뒤 `resolve` → 던질 때 저장한 조건과 어종이 그대로 유지된다(재추첨·거절 없음). → Task 3
4. **아직 어종이 없는 지역·없는 자리**: `cast { area: 'river' }`(열린 지역이지만 1단계엔 어종 없음)나 `spot: 'zzz'` → `bad_area`/`bad_spot`, 예외로 죽지 않는다. → Task 3
5. **기준 시각 이전·경계 시각**: `SEASON_ANCHOR_MS - 1` → 겨울(음수 나머지 처리), 게임 20:00 정각은 밤, 19:59는 낮, 자정을 넘는 구간 `[18, 2)`에서 1:59는 안, 2:00은 밖. → Task 1

---

### Task 1: 게임 시계 `clock.ts`

**Files:**
- Create: `src/games/fishing/clock.ts`
- Test: `src/games/fishing/clock.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
  export type Weather = 'sun' | 'rain'
  export type Conditions = { gameMinute: number; gameDay: number; season: Season; weather: Weather }
  export const KST_OFFSET_MS = 9 * 3_600_000
  export const GAME_DAY_MS = 1_440_000
  export const SEASON_ANCHOR_MS = Date.UTC(2026, 10, 22, 15, 0, 0)
  export const RAIN_CHANCE = 0.25
  export const SEASON_NAMES: Record<Season, string> // 봄·여름·가을·겨울
  export function conditionsAt(nowMs: number): Conditions
  export function weatherOf(gameDay: number): Weather
  export function inHours(gameMinute: number, hours: readonly [number, number]): boolean
  export function isNight(gameMinute: number): boolean
  export function nightLevel(gameMinute: number): number // 0~1
  export function formatClock(gameMinute: number): string // 'HH:MM', 분은 10분 단위 내림
  ```

- [ ] **Step 1: 실패하는 테스트 작성** (`clock.test.ts`)

```ts
const at = (y: number, mo: number, d: number, h: number, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, s) // KST 시각 → ms
it('KST 자정은 게임 0시, 실제 1초 = 게임 1분, 24분마다 다시 0시', () => {
  expect(conditionsAt(at(2026, 11, 23, 0)).gameMinute).toBe(0)
  expect(conditionsAt(at(2026, 11, 23, 0, 0, 59)).gameMinute).toBe(59)
  expect(conditionsAt(at(2026, 11, 23, 0, 23, 59)).gameMinute).toBe(1439)
  expect(conditionsAt(at(2026, 11, 23, 0, 24)).gameMinute).toBe(0)
  expect(conditionsAt(at(2026, 11, 23, 0, 24)).gameDay).toBe(conditionsAt(at(2026, 11, 23, 0)).gameDay + 1)
})
it('계절: 기준 주는 봄, 1주마다 다음 계절, 4주 뒤 다시 봄, 기준 1ms 전은 겨울', () => {
  expect(conditionsAt(SEASON_ANCHOR_MS).season).toBe('spring')
  expect(conditionsAt(at(2026, 11, 29, 23, 59, 59)).season).toBe('spring')
  expect(conditionsAt(at(2026, 11, 30, 0)).season).toBe('summer')
  expect(conditionsAt(at(2026, 12, 7, 0)).season).toBe('autumn')
  expect(conditionsAt(at(2026, 12, 14, 0)).season).toBe('winter')
  expect(conditionsAt(at(2026, 12, 21, 0)).season).toBe('spring')
  expect(conditionsAt(SEASON_ANCHOR_MS - 1).season).toBe('winter')
})
it('날씨: 같은 게임 날짜는 같은 날씨, 10,000일 중 비 22~28%, 게임 날짜 안에서는 바뀌지 않는다', () => { /* weatherOf(d) 반복 호출 동일, 비율 검사, conditionsAt(하루 시작)과 (하루 끝-1ms)의 weather 동일 */ })
it('inHours: 일반 구간과 자정을 넘는 구간, 경계', () => {
  expect(inHours(6 * 60, [6, 19])).toBe(true); expect(inHours(19 * 60, [6, 19])).toBe(false)
  expect(inHours(23 * 60, [18, 2])).toBe(true); expect(inHours(1 * 60 + 59, [18, 2])).toBe(true)
  expect(inHours(2 * 60, [18, 2])).toBe(false); expect(inHours(12 * 60, [18, 2])).toBe(false)
})
it('isNight: 20:00~4:59 밤, 19:59·5:00 낮', () => { /* 경계 4개 */ })
it('nightLevel: 정오 0, 자정 1, 19:00은 0과 1 사이, 5:30은 0과 1 사이, 6:00 이후 0', () => { /* … */ })
it("formatClock: 0 → '00:00', 14*60+37 → '14:30', 1439 → '23:50'", () => { /* … */ })
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/clock.test.ts` / Expected: FAIL (모듈 없음)

- [ ] **Step 3: `clock.ts` 구현**
  - `kst = nowMs + KST_OFFSET_MS`; `gameMinute = mod(floor(kst / 1000), 1440)`; `gameDay = floor(kst / GAME_DAY_MS)`; 계절은 `mod(floor((nowMs - SEASON_ANCHOR_MS) / 604_800_000), 4)`. `mod`는 음수에도 0 이상을 돌려준다.
  - `weatherOf`: 32비트 정수 해시(예: `Math.imul` 기반 섞기, 고정 상수)를 `2^32`로 나눈 값 `< RAIN_CHANCE`면 `'rain'`. 음수 `gameDay`도 처리.
  - `nightLevel`: 18~20시 0→1 선형, 20~5시 1, 5~6시 1→0 선형, 그 외 0.

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing/clock.test.ts` / Expected: PASS

- [ ] **Step 5: 커밋** — `git add src/games/fishing/clock.ts src/games/fishing/clock.test.ts && git commit -m "feat: 낚시 게임 시계·계절·날씨"`

---

### Task 2: 어종 형식과 마을 16종

**Files:**
- Modify: `src/games/fishing/data.ts`
- Test: `src/games/fishing/data.test.ts` (새 파일; `logic.test.ts`의 `fishing data` describe는 이 파일로 옮기고 갱신)

**Interfaces:**
- Consumes: Task 1의 `Season`, `Weather`, `Conditions`, `inHours`
- Produces:
  ```ts
  export type AreaId = 'village' | 'river' | 'forest' | 'lake' | 'cave' | 'island'
  export const AREAS: readonly { id: AreaId; name: string; spots: readonly string[] }[]
  //   village 바닷가 마을 ['pier','shore'] / river 마을 강 ['river'] / forest 숲 ['pond','waterfall']
  //   lake 산 호수 ['lake'] / cave 동굴 ['cave1','cave2','cave3'] / island 섬 ['sea','lagoon']
  export const DEFAULT_AREAS: readonly AreaId[] // ['village','river','forest']
  export type Behavior = 'mixed' | 'smooth' | 'dart' | 'floater' | 'sinker'
  export type Species = { id; name; rarity: Rarity; basePrice; minCm; maxCm; difficulty; minRod;
    behavior: Behavior; area: AreaId; spots?: readonly string[]; seasons?: readonly Season[];
    hours?: readonly [number, number]; weather?: Weather; legend?: { power: number } }
  export type Rod = { tier; name; price; barBonus; biteScale; weights: Record<'common'|'uncommon'|'rare', number> }
  export const LEGEND_CHANCE = 0.08
  export function speciesAvailable(s: Species, area: AreaId, spot: string, cond: Conditions, rodTier: number): boolean
  //   지역·자리·계절·시간·날씨·minRod를 모두 본다. legend.power는 보지 않는다(강도는 rollCatch가 본다).
  export function areaHasSpecies(area: AreaId): boolean
  ```
- 낚싯대 가중치에서 `legend`를 뺀다: 1단계 70/30/0, 2단계 55/33/12, 3단계 50/34/16, 4단계 46/34/20 (예전 legend 몫을 common에 더함).

**마을 16종** (모두 `area: 'village'`, `spots` 없음 = 부두·해안 모두. 기존 종은 가격·크기·난이도·minRod 그대로):

| id | 이름 | 등급 | 기본가 | cm | 난이도 | minRod | 유형 | 계절 | 시간 | 날씨 |
|---|---|---|---|---|---|---|---|---|---|---|
| anchovy | 멸치 | common | 20 | 8–15 | .15 | 1 | dart | 봄·가을 | – | – |
| goby | 망둥어 | common | 25 | 8–20 | .2 | 1 | mixed | – | – | – |
| horse-mackerel | 전갱이 | common | 30 | 15–35 | .2 | 1 | dart | – | – | – |
| mackerel | 고등어 | common | 50 | 25–45 | .3 | 1 | mixed | 여름·가을·겨울 | 6–19 | – |
| mullet | 숭어 | uncommon | 80 | 30–70 | .4 | 1 | smooth | 봄·겨울 | 6–19 | – |
| rockfish | 우럭 | uncommon | 110 | 20–50 | .45 | 1 | sinker | – | – | – |
| flounder | 도다리 | uncommon | 130 | 20–45 | .45 | 1 | sinker | 봄·여름 | – | – |
| squid | 오징어 | uncommon | 150 | 20–40 | .5 | 1 | mixed | 겨울 | 18–2 | – |
| hairtail | 갈치 | uncommon | 120 | 60–120 | .55 | 1 | dart | 가을·겨울 | 20–5 | – |
| conger | 붕장어 | uncommon | 110 | 40–90 | .6 | 1 | smooth | 봄·가을 | 16–2 | rain |
| pufferfish | 복어 | uncommon | 140 | 15–35 | .72 | 1 | floater | 여름 | 12–16 | sun |
| red-seabream | 참돔 | rare | 300 | 40–90 | .65 | 2 | mixed | 봄·가을 | – | – |
| seabass | 농어 | rare | 400 | 50–100 | .7 | 2 | dart | 여름·가을 | – | – |
| yellowtail | 방어 | rare | 600 | 60–110 | .75 | 2 | smooth | 겨울 | – | – |
| octopus | 문어 | rare | 350 | 30–90 | .85 | 2 | sinker | 여름 | 6–13 | – |
| grouper | 다금바리 | legend | 2500 | 80–140 | .95 | 3 | mixed | 겨울 | – | – | + `spots: ['pier']`, `legend: { power: 0.95 }` |

- [ ] **Step 1: 실패하는 테스트 작성** (`data.test.ts`)
  - `16 species, ids unique, 기존 12 id 모두 남아 있음, 크기·가격 정상, behavior는 5종 중 하나, area는 AREAS의 id`
  - `모든 species의 spots는 그 지역 AREAS.spots의 부분집합, hours는 0~24 정수`
  - `보장: 마을의 모든 자리 × 계절 × 시각(0~23시 정각) × 날씨에서 rodTier 1로 common 후보가 1종 이상` — `speciesAvailable`로 전수 검사
  - `마을 규칙: 밤에만 나오는 어종(hours가 밤 구간 안) ≥1, weather 'rain' 어종 ≥1, 행동 유형 3가지 이상, 상시 common(조건 없음) ≥2`
  - `speciesAvailable: 다금바리는 pier·겨울·rod 3에서만 true, shore/봄/rod 2면 false; 복어는 맑은 여름 13시만; 자정 넘는 오징어 1:00 true, 2:00 false`
  - `areaHasSpecies('village') true, 'river' false`
  - `RODS 가중치 키는 common·uncommon·rare만, 합 100`

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/data.test.ts` / Expected: FAIL

- [ ] **Step 3: `data.ts` 수정** — 위 형식·표대로. `AREAS`의 옛 `pier` 항목은 없앤다(Task 3이 옛 id를 처리).

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing/data.test.ts && npm run typecheck` / Expected: data 테스트 PASS (logic·화면 타입 오류는 Task 3·6에서 고친다; 이 커밋에서 typecheck가 깨지면 `AREAS[0].id` 같은 사용처만 최소 수정해 통과시킨다)

- [ ] **Step 5: 커밋** — `git add src/games/fishing/data.ts src/games/fishing/data.test.ts src/games/fishing/logic.test.ts && git commit -m "feat: 낚시 어종 조건·행동 유형과 마을 16종"`

---

### Task 3: 조건 추첨과 서버 상태 (`logic.version` 3)

**Files:**
- Modify: `src/games/fishing/logic.ts`
- Test: `src/games/fishing/logic.test.ts`

**Interfaces:**
- Consumes: Task 1 `conditionsAt`, `Conditions`; Task 2 `AREAS`, `DEFAULT_AREAS`, `AreaId`, `speciesAvailable`, `areaHasSpecies`, `LEGEND_CHANCE`
- Produces:
  ```ts
  export type CastCtx = { rodTier: 1|2|3|4; power: number; sizeBonus: number; area: AreaId; spot: string; cond: Conditions; legends: readonly string[] }
  export function rollCatch(rng: () => number, c: CastCtx): Catch
  export type Pending = { species; sizeCm; biteDelayMs; startedAt; hookedAt: number | null; area: AreaId; spot: string; cond: Conditions; power: number }
  export type State = { gold; totalEarned; rodTier; bagTier; areas: AreaId[]; bag: Fish[]; dex; legends: string[]; pending: Pending | null }
  export type Action = { type: 'cast'; area: string; power: number; spot?: string } | …(나머지 그대로)
  // PendingView는 바뀌지 않는다 (area·spot·cond·power를 내보내지 않는다)
  ```

**추첨 순서 (rng 호출 순서 고정, 항상 5번):**
1. `r0`: 전설 판정. 후보 = `rarity === 'legend'`이고 `speciesAvailable`이고 `power >= legend.power`이고 `legends`에 없음. 후보가 있고 `r0 < LEGEND_CHANCE`면 후보 중 첫 번째(지역당 1종이라 하나뿐)로 확정, 2번은 건너뛰되 `r1`은 그대로 소비한다.
2. `r1`: 등급(common/uncommon/rare 가중치). `r2`: 등급 안 어종. 뽑힌 등급에 후보가 없으면 아래 등급으로 차례로(common까지), 그래도 없으면 위 등급으로. `pickPool`이 `[]`를 돌려주면 `throw` (Task 2 보장 테스트로 일어나지 않음).
3. `r3`: 크기(지금 식, `sizeBonus` 포함). `r4`: 입질(지금 식).

**cast 검증 순서:** `area`가 `'pier'`면 `'village'`로 바꾼다(구버전 화면) → `area`가 `state.areas`에 없거나 `areaHasSpecies` 거짓 → `bad_area` → `spot` 없으면 `'shore'`(village) / 그 지역 첫 자리(그 외) → `spot`이 그 지역 `spots`에 없으면 `bad_spot` → power 검증 → 가방 → `cond = conditionsAt(ctx.now)`로 추첨. 부두 보너스는 `spot === 'pier'`일 때.

- [ ] **Step 1: 실패하는 테스트 작성** (`logic.test.ts`, 기존 rollCatch·cast 테스트를 새 시그니처로 갱신)
  - `version 3; init: areas = DEFAULT_AREAS, legends = []`
  - `rollCatch는 조건에 맞는 어종만 낸다 (마을, 봄 낮 맑음, rod 1, 5k회: 결과가 모두 speciesAvailable)`
  - `rollCatch는 rng를 항상 5번 부른다 (전설 후보 있음/없음, 등급 대체 발생 시)`
  - `rod 1 겨울 밤(우럭·망둥어·전갱이·갈치·오징어만 가능): uncommon을 뽑아도 결과는 후보 안, 예외 없음`
  - `등급 대체: 마을 데이터로는 rare·uncommon이 비는 조합이 없으므로, 대체 규칙을 순수 함수 export function pickPool(byRarity: Record<'common'|'uncommon'|'rare', Species[]>, rarity): Species[] 로 빼서 합성 데이터로 검사 — rare 비면 uncommon, uncommon도 비면 common, common만 비고 rare 있으면 위로(uncommon→rare), 전부 비면 []`
  - `전설: pier·겨울·rod 3·power 0.95·r0=0.01 → grouper; power 0.94 → grouper 아님; shore → 아님; legends에 grouper → 아님; r0=0.5 → 아님`
  - `cast { area: 'pier', spot: 'pier' }는 village로 정상 처리되고 부두 보너스가 붙는다` (Review Focus 1)
  - `cast area 'river'(열린 지역, 어종 없음) → bad_area; 'lake'(안 열림) → bad_area; spot 'zzz' → bad_spot; 오류 시 상태 불변` (Review Focus 4)
  - `pending은 던질 때의 area·spot·cond·power를 저장하고, view의 pending에는 그 필드가 없다`
  - `던진 뒤 now가 다음 게임 날·다른 계절이 되어도 resolve는 저장된 어종을 그대로 넣는다` (Review Focus 3)
  - `resolve로 전설을 잡으면 legends에 추가, 이후 같은 조건·r0=0에서도 다시 안 나옴; 놓치면(success false) legends 그대로`
  - `migrate v2(areas ['pier'], dex에 grouper 있음) → areas = DEFAULT_AREAS, legends ['grouper'], 골드·가방·도감 유지; grouper 없는 세이브 → legends []; legends의 모르는 id·비전설 id는 버림`
  - `records: dex detail은 'n/16'`

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/logic.test.ts` / Expected: FAIL

- [ ] **Step 3: `logic.ts` 구현** — 위 순서대로. `migrate`는 `legends`·`areas`를 검증해 채우고(알려진 지역만, 비면 기본값, `DEFAULT_AREAS`는 항상 포함), `pending`은 버린다.

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing/data.test.ts src/games/fishing/logic.test.ts` / Expected: PASS

- [ ] **Step 5: 커밋** — `git add src/games/fishing/logic.ts src/games/fishing/logic.test.ts && git commit -m "feat: 낚시 조건 추첨·전설·로직 버전 3"`

---

### Task 4: 미니게임 행동 유형

**Files:**
- Modify: `src/games/fishing/minigame.ts`
- Test: `src/games/fishing/minigame.test.ts`

**Interfaces:**
- Consumes: Task 2 `Behavior`, `Species.behavior`
- Produces: `export type BarParams = { barSize: number; difficulty: number; behavior: Behavior }`; `barParams(speciesId, rodTier)`가 `behavior`를 채운다. `stepBar` 시그니처는 그대로.

유형별 동작 (위치 0 = 트랙 아래, 1 = 위; 수치는 구현 재량, 아래 테스트를 만족하면 됨):
- `mixed`: 지금 동작 그대로 (기존 테스트가 그대로 통과해야 한다).
- `smooth`: 목표 변경 빈도 절반 이하, 목표까지 감속하며 접근.
- `dart`: 목표 변경 빈도 2배 이상, 새 목표가 현재 위치에서 멀리(0.4 이상 떨어진 곳 위주), 속도 상향.
- `floater`: 새 목표를 `0.55~1` 범위에서 주로 고름.
- `sinker`: 새 목표를 `0~0.45` 범위에서 주로 고름.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `barParams는 어종의 behavior를 담는다 (pufferfish → floater, octopus → sinker)`
  - 고정 seed rng로 난이도 0.5, 각 유형 60초(16ms 간격, 바는 안 누름) 시뮬레이션:
    - `floater 평균 fishPos > 0.6`, `sinker 평균 fishPos < 0.4`, `mixed 평균 0.35~0.65`
    - `dart의 총 이동량(|Δ fishPos| 합) > mixed > smooth`
  - `기존 mixed 테스트는 behavior: 'mixed'로 그대로 통과`

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/minigame.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** — `stepBar`의 목표 고르기·속도 부분만 `params.behavior`로 분기한다. rng는 지금처럼 주입된 것만 쓴다.

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing/minigame.test.ts` / Expected: PASS

- [ ] **Step 5: 커밋** — `git add src/games/fishing/minigame.ts src/games/fishing/minigame.test.ts && git commit -m "feat: 낚시 미니게임 행동 유형 5종"`

---

### Task 5: 장면 — HUD 시계, 밤 색조, 비·눈, 새 스프라이트

**Files:**
- Modify: `src/games/fishing/scene.ts`, `src/games/fishing/sprites.ts`
- Test: `src/games/fishing/scene.test.ts`, `src/games/fishing/sprites.test.ts`

**Interfaces:**
- Consumes: Task 1 `Conditions`, `nightLevel`, `formatClock`, `SEASON_NAMES`
- Produces: `WorldScene`에 `cond: Conditions` 필드 추가. 스프라이트 `fish-hairtail`, `fish-conger`, `fish-pufferfish`, `fish-octopus`(16×16), `icon-sun`, `icon-rain`, `icon-snow`(8×8 또는 10×10).

- [ ] **Step 1: 실패하는 테스트 작성**
  - `sprites.test.ts`: `SPECIES의 모든 id에 fish-<id> 스프라이트가 있다`(기존 검사가 있으면 그대로 16종으로 통과), `icon-sun/rain/snow가 있다`
  - `scene.test.ts`(기존 가짜 ctx 방식):
    - `HUD 텍스트: cond(봄, 14:37, sun) → fillText에 '봄 14:30'이 들어간 호출이 있다` (구분 기호·배치는 재량, 계절명과 formatClock 결과가 함께 그려지면 됨)
    - `밤(gameMinute 0)에는 화면 전체를 덮는 반투명 채우기가 한 번 그려지고, 정오에는 그려지지 않는다`
    - `날씨 rain: 봄이면 비 입자, 겨울이면 눈 입자를 그린다(그리기 호출 수 > 0, 상한 80개 이하); sun이면 입자 없음`
    - `HUD는 fighting 중 트랙 반대쪽(hudSide의 반대)에 그려진다`

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/scene.test.ts src/games/fishing/sprites.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현**
  - 그리기 순서: 정적 맵 → 월드 레이어 → 비·눈(월드 위, 화면 좌표, `tMs`로 결정되는 결정적 위치) → 밤 색조(`rgba(10, 16, 40, 0.5 * nightLevel)` 한 번 채우기) → 게이지·트랙·결과 → HUD 시계.
  - HUD: 장면 위쪽 가장자리, 작은 반투명 판 위에 날씨 아이콘 + `봄 14:30`. 낚시 트랙과 겹치지 않게 트랙 반대쪽.
  - 새 물고기 스프라이트는 기존 물고기와 같은 크기·화풍(`FISH_*` 형식). 복어는 둥글게 부푼 모양, 문어는 다리, 갈치는 길고 은빛, 붕장어는 길고 갈색.

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing/scene.test.ts src/games/fishing/sprites.test.ts` / Expected: PASS

- [ ] **Step 5: 커밋** — `git add src/games/fishing/scene.ts src/games/fishing/sprites.ts src/games/fishing/scene.test.ts src/games/fishing/sprites.test.ts && git commit -m "feat: 낚시 장면 시계·밤·날씨와 새 물고기 그림"`

---

### Task 6: 화면 연결, 도감 조건 표시, 함수 테스트, 체크리스트

**Files:**
- Modify: `src/games/fishing/Game.tsx`, `src/games/fishing/Menus.tsx`, `src/games/fishing/fishing.css`(필요 시), `supabase/functions/world/handler.test.ts`, `docs/deploy-checklist.md`
- Test: `src/games/fishing/Game.test.tsx`, `src/games/fishing/Menus.test.tsx`(없으면 Game.test 안에서)

**Interfaces:**
- Consumes: Task 1 `conditionsAt`, `SEASON_NAMES`; Task 2 `AREAS`, `Species`; Task 3 `Action`; Task 5 `WorldScene.cond`

- [ ] **Step 1: 실패하는 테스트 작성**
  - `Game.test`: `cast는 { type: 'cast', area: 'village', power, spot } 를 보낸다`
  - `Game.test`: `server_now가 Date.now()보다 3시간 앞선 응답 뒤, drawWorld에 넘기는 cond는 conditionsAt(Date.now() + 3시간)과 같다` (Review Focus 2)
  - `Game.test`: `첫 응답 전에도 cond가 있다 (오프셋 0)`
  - `도감: 잡은 어종은 출현 조건 문구(예: 복어 '여름 · 12~16시 · 맑음')를 보여 주고, 안 잡은 어종은 보여 주지 않는다; 다금바리는 '전설' 표시, 잡았으면 '잡음'`
  - `도감 개수 표시는 'n/16종'`

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing` / Expected: 새 테스트 FAIL

- [ ] **Step 3: 구현**
  - `Game.tsx`: `AREA = 'village'`; rAF에서 `cond = conditionsAt(Date.now() + rt.offset)`를 `WorldScene`에 넣는다(`rt.offset`은 이미 응답마다 갱신됨).
  - `Menus.tsx` `DexPanel`: 조건 문구 = 자리(전설만, '부두') · 계절(없으면 '사계절') · 시간(`hours` 있으면 `from~to시`) · 날씨(있으면 '비'/'맑음'). 순수 함수 `conditionLabel(s: Species): string`로 빼서 테스트한다. 색은 theme 토큰만.
  - `handler.test.ts` 241행 테스트의 페이로드를 `{ type: 'cast', area: 'village', power: 0.5, spot: 'pier' }`로.
  - `docs/deploy-checklist.md` 낚시 절에 추가: `logic.version` 3, `world` 재배포 필요(`clock.ts` 포함), 수동 확인 — 두 기기에서 HUD 계절·시각·날씨가 같다 / 실제 시각 기준 `분 mod 24`가 20 이상이면 밤 색조 / 비 오는 게임 날 비(겨울은 눈) / 복어(floater)·문어(sinker)의 미니게임 움직임이 위·아래로 치우친다 / 기존 세이브의 골드·가방·도감 유지.

- [ ] **Step 4: 전체 검증** — Run: `npm test && npm run typecheck && npm run build && npm run fn:test` / Expected: 모두 PASS (`fn:test`가 이 환경에서 Postgres를 못 띄우면 그 사실과 출력을 보고서에 적는다)

- [ ] **Step 5: 커밋** — `git add src/games/fishing/Game.tsx src/games/fishing/Menus.tsx src/games/fishing/Game.test.tsx supabase/functions/world/handler.test.ts docs/deploy-checklist.md` (+ 수정한 css·테스트 파일) `&& git commit -m "feat: 낚시 화면에 게임 시계 연결·도감 출현 조건"`

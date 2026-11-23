# 펨타듀 낚시 — 넓은 세계 4단계 (도전과제 · 순간이동기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지역마다 도전과제 하나(모두 6개)와 순간이동기 하나(모두 6개)를 넣는다. 도전과제를 깨면 그 지역 순간이동기가 켜지고, 켜진 이동기끼리 거리에 따른 요금을 내고 오갈 수 있다. 프로필 기록에 깬 과제 수(`n/6`)를 더한다.

**Architecture:** 과제 정의(`CHALLENGES`)는 `data.ts`, 판정은 `logic.ts`의 순수 함수로 `resolve` 성공 때 **던질 때 저장한 `pending`의 지역·자리·조건**으로 센다(`logic.version` 8). 맵에는 `world`(세계 지도 원점)와 `teleporter`(2×2 칸 구조물 + 도착 자리)를 더하고, 구조물 칸은 늘 못 걷는다. 요금은 새 순수 모듈 `teleport.ts`가 맵의 세계 좌표로 계산하고 서버 `teleport` 행동과 화면이 같은 함수를 쓴다. 이동기는 정적 캐시가 아니라 월드 레이어에 매 프레임 그려 켜짐(불빛 깜빡임)과 캐릭터 앞뒤를 맞춘다. 화면 이동은 2단계 지역 전환(페이드)을 그대로 쓰고 도착 맵 이동기 앞에 선다.

**Tech Stack:** TypeScript, React 18, Canvas 2D, vitest, Deno(`world` 함수 테스트). 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-23-fishing-world-design.md` (§10의 4단계, §8.3, §8.4, §9, §11)

## Global Constraints

- `clock.ts`·`data.ts`·`logic.ts`·`teleport.ts`·`map.ts`·`maps/*.ts`·`walk.ts`는 순수 모듈: React·DOM·`Date.now()`·`Math.random` 없음, 상대 import에 `.ts`. `logic.ts`가 `teleport.ts` → `maps/index.ts`를 import하므로 `world` 함수 번들에 맵 데이터가 들어간다(순수 문자열, Deno 호환).
- 플랫폼 코드(`src/platform/`, `src/app/`)와 DB는 바꾸지 않는다. 프로필 기록은 manifest `records`에 `challenges`를 선언하는 것만으로 그려진다(`game_records`는 키 제한이 없다).
- 화면 문구 한국어, 모바일 우선. 캔버스 밖 색은 `theme.css` 토큰만. 순간이동기 그림은 새로 그린 픽셀 아트(`sprites.ts` 형식)로, 원작 오벨리스크(돌기둥)와 닮지 않은 **등대 모양 신호기**다.
- 도전과제(지역마다 하나, 어떤 계절에도 깰 수 있어야 한다 — 설계 §8.3 규칙, 실패 조건 §2):

  | id | 지역 | 제목 | 설명 | count | filter |
  |---|---|---|---|---|---|
  | `pier-perfect` | village | 부두의 명수 | 부두에서 완벽하게 3마리 낚기 | 3 | `{ spot: 'pier', perfect: true }` |
  | `river-rain` | river | 빗속의 강태공 | 비 오는 날 강에서 5마리 낚기 | 5 | `{ weather: 'rain' }` |
  | `forest-variety` | forest | 숲의 탐험가 | 숲에서 서로 다른 물고기 3종 낚기 | 3 | `{ distinct: true }` |
  | `lake-night` | lake | 호수의 밤 | 밤(20~5시)에 산 호수에서 5마리 낚기 | 5 | `{ night: true }` |
  | `cave-deep` | cave | 용암 낚시꾼 | 동굴 가장 깊은 용암에서 5마리 낚기 | 5 | `{ spot: 'cave3' }` |
  | `island-big` | island | 섬의 대물 | 섬에서 크기 상위 30% 물고기 3마리 낚기 | 3 | `{ minSizePct: 0.7 }` |

  숲은 설계 초안("폭포에서 3종 이상")을 바꾼다: 폭포 어종은 버들치·열목어 2종뿐이고 열목어는 가을·겨울 한정이라 깰 수 없다. 대나무 낚싯대로 겨울에도 붕어·잉어(연못)·버들치(폭포) 3종은 늘 나오므로 "숲에서 3종"은 사계절 가능하다.
- 판정: `area`가 과제 지역과 같고, `spot`(있으면)·`perfect`·`weather`·`night`(`isNight`, 20~5시)·`minSizePct`(`sizePercentile >= 값`)를 모두 만족하면 센다. `distinct`면 `seen`에 없는 어종일 때만 더하고 `progress = seen.length`. `progress >= count`가 되는 순간 `done: true`. 깬 과제는 더 세지 않고 되돌아가지 않는다. 진행은 배포 뒤부터 센다(도감 소급 없음).
- 순간이동기: 지역의 과제가 `done`이고 그 지역이 `areas`에 있으면 켜짐. 요금 `fee = TP_BASE + ceil(dist / 10) * TP_PER_10`, `TP_BASE = 30`, `TP_PER_10 = 1`, `dist` = 두 이동기 칸 사각형 중심의 세계 좌표(맵 `world` + 칸) 직선 거리. 섬은 세계 지도에서 멀리(약 1,000칸) 둬서 다른 어느 쌍보다 세 배 이상 비싸다.
- 마을 상점·부두·`SPAWN`·부두 끝→문 앞 37칸·선착장 불변. 맵 크기·테두리·출구 규칙(`maps.test.ts`) 그대로.
- `logic.version` 8 (이번 단계에서 한 번만 올림, main은 7). 기존 56종·해금·찌 값은 바꾸지 않는다.
- 커밋 `type: 내용`, 마지막 두 줄 트레일러(Co-Authored-By: <작성 모델 이름> <noreply@anthropic.com> / Claude-Session: https://claude.ai/code/session_01T7oyVpQAuQkbAiCkNHahWh). 경로 지정 스테이징, 푸시 금지.

## Review Focus

1. **던질 때 조건으로 판정**: 비 오는 날 던지고 비가 그친 뒤(또는 밤에 던지고 아침에) `resolve`해도 과제가 센다. 반대로 맑을 때 던지고 비 올 때 거두면 세지 않는다. `pending`에 `cond`·`area`·`spot`이 없는(비정상·옛 형식) 상태에서 `resolve`해도 오류 없이 물고기는 들어오고 과제만 세지 않는다. 옛 세이브(v7 이하)는 `migrate`에서 `pending`을 버리고 `challenges: {}`. → Task 1
2. **어떤 계절에도 깰 수 있다 / 되돌아가지 않는다**: 과제마다 사계절 각각에서 대나무 낚싯대로 조건을 만족하는 어종이 있고(`distinct`면 `count`종 이상), 깬 과제는 이후 잡이·`migrate`에서 `done`이 유지된다. → Task 1
3. **순간이동 요금·검증**: 켜진 이동기끼리만 이동(`not_open`), 같은 곳(`same`), 낚시 중(`busy`), 골드 부족(`not_enough_gold`, 상태 불변), 모르는 id·프로토타입 키(`bad_teleporter`). 요금은 화면 목록과 서버 차감이 같다(같은 `teleportFee`). → Task 3, Task 4, Task 6
4. **이동기 구조물 통행·앞뒤**: 2×2 칸은 어떤 열린 집합에서도 못 걷고, 도착 자리(front)는 각 맵의 실제 도착점(기본 맵은 기본 지역만 열린 상태, 해금 맵은 그 지역을 연 상태)에서 걸어 닿는다. 37칸 경로 불변. 캐릭터가 이동기 위쪽(뒤)에 서면 탑이 캐릭터를 가리고, 아래쪽(앞)에 서면 캐릭터가 탑 앞에 그려진다. → Task 2, Task 3, Task 5
5. **이동 결과 화면**: 이동 성공 → 창이 닫히고 페이드 뒤 도착 맵 이동기 front에 front.facing으로 선다(위치 저장). 도착 방향은 이동기를 등지므로 바로 다시 행동해도 창이 열리지 않는다. 서버가 옛 함수라 view에 `challenges`가 없어도 화면이 그려지고 이동기는 꺼진 것으로 본다. → Task 6

---

### Task 1: 도전과제 정의·판정, 기록, 로직 버전 8

**Files:**
- Modify: `src/games/fishing/data.ts`, `src/games/fishing/logic.ts`, `src/games/fishing/manifest.ts`
- Test: `src/games/fishing/data.test.ts`, `src/games/fishing/logic.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // data.ts
  export type ChallengeFilter = { spot?: string; perfect?: true; weather?: 'rain'; night?: true; minSizePct?: number; distinct?: true }
  export type Challenge = { id: string; area: AreaId; title: string; desc: string; count: number; filter: ChallengeFilter }
  export const CHALLENGES: readonly Challenge[]           // 위 표, AREAS 순서
  export const TP_BASE = 30
  export const TP_PER_10 = 1
  // logic.ts
  export type ChallengeProgress = { progress: number; seen?: string[]; done: boolean }
  export type State = { …; challenges: Record<string, ChallengeProgress> }   // init {}
  export type CatchFacts = { area: AreaId; spot: string; cond: Conditions; species: string; sizeCm: number; perfect: boolean }
  export function challengeMatches(ch: Challenge, c: CatchFacts): boolean
  export function progressChallenges(prev: State['challenges'], c: CatchFacts): { challenges: State['challenges']; completed: string[] }
  export function teleporterOpen(state: Pick<State, 'areas' | 'challenges'>, area: AreaId): boolean
  //   resolve 성공 결과: { caught: Fish, completed?: string[] }  (이번에 깬 과제 id가 있을 때만 completed)
  //   records에 { key: 'challenges', value: 깬 수, detail: `${n}/6` }
  ```
- `logic.version` 8. `migrate`: `challenges`는 알려진 id만, `progress`는 0 이상 정수, `seen`은 알려진 어종 중복 없이(`distinct` 과제만), `done`은 boolean(`done: true`는 유지). v7 이하 세이브에는 필드가 없으므로 `{}`. `pending`은 지금처럼 버린다.
- `resolve`: `p.area`가 알려진 지역이고 `p.spot`이 문자열이고 `p.cond`가 객체일 때만 판정한다(아니면 진행도 그대로).
- manifest `records`에 `{ key: 'challenges', label: '도전과제', unit: '개' }`.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `data: CHALLENGES 6개, 지역마다 하나(AREAS 순서), id 유일, count ≥ 1, spot은 그 지역 자리`
  - `data: 과제마다 사계절 각각에서 rod 1로 조건(자리·날씨·밤 시간)을 만족하는 어종이 있고, distinct면 count종 이상` (Review Focus 2)
  - `logic: 부두 완벽 → pier-perfect progress 1, 해안·완벽 아님 → 0; 3마리째에 done, result.completed ['pier-perfect']; 깬 뒤 더 잡아도 progress 3 그대로`
  - `logic: 비 오는 날 던지고 맑은 날 resolve → river-rain 셈; 맑은 날 던지고 비 올 때 resolve → 안 셈` (Review Focus 1)
  - `logic: lake-night 밤 던짐만, cave-deep cave3만, island-big sizePct ≥ 0.7만, forest-variety 같은 어종 두 번은 1`
  - `logic: 실패 resolve·다른 지역 잡이는 진행 없음; pending에 cond 없는 상태 resolve 성공 → 물고기는 가방에, challenges 불변`
  - `logic: version 8; init challenges {}; migrate v7 세이브(pending 포함) → challenges {}·pending null, 나머지 그대로; v8 세이브의 challenges는 정리 후 유지(모르는 id·음수·모르는 어종 버림, done 유지)`
  - `records: 4개, challenges '0/6' → 깬 뒤 '1/6'`
  - `teleporterOpen: 과제 done + areas 포함일 때만 true`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/logic.test.ts src/games/fishing/data.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 기존 테스트 중 `migrate v6 … toEqual(v6)`·`records`·`init` 기대값은 `challenges` 필드를 더해 고친다.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git add src/games/fishing/data.ts src/games/fishing/logic.ts src/games/fishing/manifest.ts src/games/fishing/data.test.ts src/games/fishing/logic.test.ts && git commit -m "feat: 낚시 지역 도전과제 판정과 로직 버전 8"`

---

### Task 2: 맵 순간이동기 자리와 세계 원점

**Files:**
- Modify: `src/games/fishing/map.ts`, `src/games/fishing/Game.tsx`(interactionKey만)
- Test: `src/games/fishing/map.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Teleporter = { tiles: Rect; front: TileFacing }
  //   tiles: 구조물 칸(2×2). rows에서는 걸을 수 있는 땅(풀·모래·길·동굴 바닥)이고 그림은 월드 레이어가 덮는다.
  //   front: 순간이동으로 도착해 서는 칸과 방향. 구조물에 붙은 칸이고, facing은 구조물을 등진다.
  export type MapDef = { …; world: { tx: number; ty: number }; teleporter: Teleporter | null }
  export type Interaction = … | { kind: 'teleporter' }
  // isWalkable: teleporter.tiles 칸은 opened와 무관하게 false
  // interactionAt: 앞 칸(서 있는 칸 + facing)이 teleporter.tiles 안이면 { kind: 'teleporter' } (문·선착장 다음, 상점·낚시보다 먼저)
  ```
- `defineMap` opts에 `world`(기본 `{0,0}`), `teleporter`(기본 null). 잘못된 정의는 throw: 칸이 맵 밖, 칸 중 rows에서 못 걷는 칸, front가 못 걷는 칸·칸 안·구조물과 붙지 않음, front.facing으로 한 칸 가면 구조물 안.
- Game.tsx `interactionKey`가 `'teleporter'`를 돌려주게만 한다(행동 처리는 Task 6).

- [ ] **Step 1: 실패하는 테스트 작성** (합성 `defineMap` 맵)
  - `isWalkable/feetBlocked: 이동기 칸은 ALL_AREAS_OPEN에서도 false, 옆 칸은 true`
  - `stepWalk: 이동기로 걸으면 앞에서 멈춘다`
  - `interactionAt: 구조물 아래·옆·위 칸에서 구조물을 보면 teleporter, 등지면 아님; front에서 front.facing → teleporter 아님`
  - `defineMap: 칸이 맵 밖, 물 위, front가 떨어져 있음, front.facing이 구조물을 봄 → throw; 기본값 world {0,0}, teleporter null`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/map.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `… && git commit -m "feat: 낚시 맵 순간이동기 자리와 세계 원점"`

---

### Task 3: 여섯 맵에 이동기 배치, 세계 지도, 요금 계산

**Files:**
- Create: `src/games/fishing/teleport.ts`, `src/games/fishing/teleport.test.ts`
- Modify: `src/games/fishing/maps/village.ts`, `river.ts`, `forest.ts`, `lake.ts`, `cave.ts`, `island.ts`
- Test: `src/games/fishing/maps/maps.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // teleport.ts (순수, maps/index.ts·data.ts만 import)
  export function teleporterWorld(area: AreaId): { x: number; y: number } | null   // 칸 사각형 중심의 세계 좌표(칸 단위)
  export function teleportFee(from: AreaId, to: AreaId): number                    // TP_BASE + ceil(dist/10)*TP_PER_10
  ```
- 배치(모양 재량, 조건 필수): 구조물 2×2, 위 한 칸에 탑 끝이 솟으므로 바로 위 줄도 트인 땅이 좋다. 길·출구·문·선착장 front·낚시 자리를 막지 않는다.
  - 마을: 동쪽 모래사장(부두·선착장과 떨어진 곳), 등대답게 바다 쪽. 세계 원점 `{0, 0}`
  - 강: 남쪽 들판 길 옆. 원점 `{0, -34}`(마을 바로 북쪽)
  - 숲: 폭포 빈터 길 끝. 원점 `{-48, -34}`(강 서쪽)
  - 산 호수: 남쪽 풀밭 길 옆. 원점 `{0, -68}`(강 북쪽)
  - 동굴: 첫 방(입구 근처). 원점 `{-40, -70}`(숲 북쪽 산속)
  - 섬: 선착장 근처 모래. 원점 약 `{360, 980}`(멀리)
- [ ] **Step 1: 실패하는 테스트 작성**
  - `maps: 여섯 맵 모두 teleporter가 있고 2×2, 칸은 rows에서 땅, 어떤 열림에서도 못 걷고, front는 걸을 수 있으며 출구 칸·문 칸이 아니고 feetBlocked 아님`
  - `maps: front에서 front.facing → teleporter 아님, front에서 구조물을 보면 teleporter`
  - `maps: front 도달 — 마을·강·숲은 기본 지역만 열린 상태로 baseStarts에서, 산 호수·동굴·섬은 기본 + 그 지역을 연 상태로 그 맵 도착점(열린 맵의 출구·선착장 entry)에서 BFS로 닿는다` (Review Focus 4)
  - `maps: 기존 검사(37칸, 연결, 잠긴 문, 선착장) 그대로 통과`
  - `maps: world 원점이 서로 다르다`
  - `teleport: 요금 대칭, 같은 곳 30(dist 0), 맵 없는 지역 → null/throw 없는 처리; 이웃 지역(마을↔강) 요금 ≤ 40; 섬과의 요금은 섬이 아닌 쌍의 최대 요금 × 3 이상`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/maps src/games/fishing/teleport.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 맵 6장에 배치하고 PNG로 렌더해 눈으로 확인(저장소 밖 `/home/claude/preview/f4/`). 이동기 칸 아래 꽃·바위는 풀/모래로 바꾼다.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `… && git commit -m "feat: 낚시 여섯 지역 순간이동기 배치와 요금"`

---

### Task 4: 서버 `teleport` 행동

**Files:**
- Modify: `src/games/fishing/logic.ts`
- Test: `src/games/fishing/logic.test.ts`

**Interfaces:**
- Consumes: Task 1 `teleporterOpen`, Task 3 `teleportFee`
- Produces:
  ```ts
  export type Action = … | { type: 'teleport'; from: string; to: string }
  //   검사 순서: bad_teleporter(문자열 아님·AREAS에 없는 id·이동기 없는 맵, 자기 키만) → same → busy(pending) → not_open(둘 중 하나라도 꺼짐) → not_enough_gold
  //   성공: gold -= fee, totalEarned 그대로, result { from, to, fee }
  ```
- [ ] **Step 1: 실패하는 테스트 작성**
  - `teleport village→river(둘 다 깸): gold -= teleportFee('village','river'), result {from,to,fee}`
  - `오류: from/to 'zzz'·'__proto__'·3·null → bad_teleporter; 같은 곳 → same; pending → busy; river 과제 미완 → not_open; 과제는 done인데 areas에 지역 없음 → not_open; 골드 fee-1 → not_enough_gold. 오류 시 상태 불변(deepFreeze)` (Review Focus 3)
  - `섬으로 가는 요금 > 마을→강 요금 × 3`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/logic.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck && npm run fn:test` / Expected: PASS
- [ ] **Step 5: 커밋** — `… && git commit -m "feat: 낚시 순간이동 행동과 요금 차감"`

---

### Task 5: 이동기 그림과 장면

**Files:**
- Modify: `src/games/fishing/sprites.ts`, `src/games/fishing/scene.ts`, `src/games/fishing/Game.tsx`(장면 필드만)
- Test: `src/games/fishing/sprites.test.ts`, `src/games/fishing/scene.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // sprites: 'teleporter' 32×48 — 둥근 돌 받침 위 흰·붉은 줄무늬 탑, 철제 등롱(꺼진 유리), 붉은 지붕과 금빛 꼭지.
  //          아래 32줄이 2×2 칸, 위 16줄이 한 칸 위로 솟는다.
  //          'teleporter-glow-0', 'teleporter-glow-1' 32×16 — 켜진 등롱 불빛(유리에 노란 빛 + 바깥 빛살, 두 장이 번갈아)
  // scene.ts: WorldScene에 teleporterOn: boolean
  //   이동기는 월드 레이어에서 캐릭터·나무 윗부분과 같은 발 y 정렬로 그린다(기준선 = 구조물 칸 아래 끝).
  //   켜져 있으면 등롱 자리에 glow를 물 박자로 번갈아 얹는다. 정적 캐시에는 넣지 않는다.
  ```
- [ ] **Step 1: 실패하는 테스트 작성**
  - `sprites: teleporter 32×48, glow 둘 32×16이고 서로 다르다; teleporter는 기존 스프라이트와 다르다`
  - `scene: 이동기 칸이 화면에 있으면 teleporter 스프라이트가 칸 왼쪽 위 - 한 칸 자리에 한 번; 화면 밖이면 안 그린다`
  - `scene: teleporterOn이면 glow, 아니면 없음; 켜짐을 바꿔도 캐시 renderFrame 호출 수 불변`
  - `scene: 캐릭터가 이동기 위 줄(뒤)에 서면 teleporter가 캐릭터보다 나중, front(앞)에 서면 먼저 그려진다` (Review Focus 4)
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/sprites.test.ts src/games/fishing/scene.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — Game.tsx는 `teleporterOn: teleporterOpen(view, rt.map.id)`(view의 `challenges`가 없으면 `{}`)만 넘긴다. 스프라이트와 맵 6장(이동기 켜짐·꺼짐)을 PNG로 렌더해 확인, 보고서에 경로.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `… && git commit -m "feat: 낚시 순간이동기 등대 그림과 장면"`

---

### Task 6: 화면 — 도전과제 목록·완료 알림, 순간이동 창과 이동

**Files:**
- Modify: `src/games/fishing/Game.tsx`, `src/games/fishing/Menus.tsx`, `src/games/fishing/fishing.css`
- Test: `src/games/fishing/Game.test.tsx`

**Interfaces:**
- Consumes: Task 1 `CHALLENGES`·`teleporterOpen`·`resolve` 결과 `completed`, Task 2 `{ kind: 'teleporter' }`, Task 3 `teleportFee`, Task 4 `teleport`
- 동작:
  - 아래 메뉴 줄에 `과제` 버튼 → `ChallengePanel`(aria-label `도전과제`): 지역 순서로 6개, 각 `지역 이름 · 제목`, 설명, 진행 `n/count` 또는 `완료 · 순간이동기 켜짐`. 위에 `깬 과제 n/6`.
  - `resolve` 결과에 `completed`가 있으면 알림 `도전과제 완료! {제목} — {지역} 순간이동기가 켜졌어요`(여러 개면 첫 것 + 나머지 개수는 생략, 각각 목록에서 확인).
  - 이동기 앞(앞 칸이 구조물): 행동 버튼·스페이스 문구는 켜졌으면 `순간이동`, 꺼졌으면 `살펴보기`. 행동(뗄 때) → `TeleportPanel`(aria-label `순간이동기`, 제목 `{지역} 순간이동기`).
    - 꺼짐: `아직 꺼져 있어요` + `도전과제를 깨면 켜져요` + 과제 제목·설명·진행.
    - 켜짐: 켜진 다른 이동기 목록(지역 순서): 지역 이름, `teleportFee` 요금, `이동` 버튼(aria-label `{지역} 이동`). 골드 모자라면 버튼 비활성 + `골드가 모자라요`. 없으면 `다른 지역의 순간이동기를 켜면 오갈 수 있어요`. 보유 골드 표시.
  - `이동` → `act({ type: 'teleport', from: rt.map.id, to })`. 성공 → 창 닫고 `startTransition(to, mapFor(to).teleporter.front)`(지역 이름 알림·위치 저장은 전환이 한다). 오류 → 창 유지, 문구(`busy`: `낚시를 마친 뒤에 이동할 수 있어요`, `not_open`: `아직 켜지지 않은 순간이동기예요`, 나머지 기존 문구).
  - 상점·해금 창처럼 열린 뒤 300ms 유령 클릭 방지(`PANEL_GUARD_MS`)를 순간이동 창에도 적용.
  - 옛 서버 응답(`challenges` 없음)은 `{}`로 읽는다.
- [ ] **Step 1: 실패하는 테스트 작성**
  - `과제 버튼 → 도전과제 6개, 진행 1/3, 완료 과제는 '완료 · 순간이동기 켜짐', 깬 과제 1/6`
  - `잡은 결과 completed ['pier-perfect'] → 완료 알림 문구`
  - `꺼진 마을 이동기 앞: 안내 '살펴보기', 행동 → 창(마을 순간이동기 · 아직 꺼져 있어요 · 부두의 명수 0/3), 이동 버튼 없음`
  - `켜진 마을 이동기(마을·강 깸): 안내 '순간이동', 창에 강과 요금(teleportFee), 이동 → teleport {from:'village', to:'river'}; 응답 → 창 닫힘, 페이드 뒤 강 맵 teleporter.front에 front.facing, 위치 저장; 바로 다시 행동해도 창이 안 열린다` (Review Focus 5)
  - `골드 fee-1 → 이동 비활성·문구; 서버 busy → 창 유지·문구`
  - `켜진 곳이 자기뿐이면 안내 문구`
  - `장면 teleporterOn: 켜진 지역 true, 꺼진 지역 false; challenges 없는 옛 응답도 그려지고 false` (Review Focus 5)
  - `창이 뜬 지 300ms 안의 클릭은 이동을 누르지 않는다`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/Game.test.tsx` / Expected: FAIL
- [ ] **Step 3: 구현** — 패널 색은 theme 토큰만, 목록은 기존 `fish-rod` 줄 스타일 재사용.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `… && git commit -m "feat: 낚시 도전과제 목록과 순간이동 창"`

---

### Task 7: 배포 체크리스트와 전체 검증

**Files:**
- Modify: `docs/deploy-checklist.md`

- [ ] **Step 1: 체크리스트 추가** — 낚시 절 3단계 항목 뒤에 4단계: `logic.version` 8, PR 브랜치에서 `world` 재배포 직후 머지 → main 기준 `world` 한 번 더 배포 → Vercel, 새로고침 안내, v7로 되돌리지 않기(옛 migrate는 `challenges`를 모른다 — 깬 과제와 켜진 이동기가 사라진다). 수동 확인: 과제 목록·진행도, 부두 완벽 3마리로 마을 과제 완료 알림과 이동기 불빛, 꺼진 이동기 살펴보기 문구, 켜진 두 이동기 사이 이동·요금 차감·도착 자리, 골드 부족 문구, 낚시 중 이동 불가 문구, 이동기 뒤로 걸으면 탑이 캐릭터를 가림, 프로필 기록 "도전과제 n개 (n/6)", 섬 요금이 비싼지, 폰에서 이동 페이드 끊김 없음.
- [ ] **Step 2: 전체 검증** — Run: `npm test && npm run typecheck && npm run build && npm run fn:test` / Expected: 모두 PASS
- [ ] **Step 3: 커밋** — `git add docs/deploy-checklist.md && git commit -m "docs: 낚시 4단계 배포 안내"`

# 메인 화면 개편 — 밸리 미리보기와 바로가기 버튼 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/`를 상단 내비게이션(그대로) + 정사각형 펨타듀 밸리 미리보기 + 이름만 있는 바로가기 버튼 묶음으로 바꾼다.

**Architecture:** 지속형 게임이 미리보기 화면을 등록부(`getWorldPreview`)에 올리고, 플랫폼 `HomePage`는 등록부로만 찾는다. 낚시 미리보기는 기존 `drawWorld`를 대기 장면으로 부르고, 옷차림·열린 지역은 `user_records`의 기록 행, 위치는 브라우저 저장값을 쓴다. 메인은 `world` 함수를 부르지 않는다. 버튼 목록은 등록부에서 순수 함수로 만들고, 할 일 표시는 기존 RPC로 버튼마다 따로 불러온다.

**Tech Stack:** Vite + React + TypeScript, vitest + Testing Library, Supabase(Postgres RPC), Deno Edge Function(`world`)

**Spec:** `docs/superpowers/specs/2026-11-24-home-valley-design.md`

**Branch:** `feat/home-valley` (main에서), PR 하나.

## Global Constraints

- 플랫폼 코드(`src/platform/**`)에 게임 id 분기 금지. 게임별 차이는 manifest·등록부(`src/games/index.ts`, `src/games/ui.ts`)로 푼다.
- `src/games/index.ts`와 거기서 import되는 `logic.ts`·`data.ts`·`preview.ts`는 React·DOM을 import하지 않는다(Deno 번들). 상대 import에 `.ts`.
- 화면 문구 한국어, 모바일 우선. 메뉴·버튼 색은 `theme.css`·`palettes.ts` 토큰만(캔버스 안은 낚시 예외).
- DB 스키마 변경 없음(마이그레이션 없음). 낚시 `logic.version`은 올리지 않는다.
- 메인에서 서버 호출: `user_records` 한 번 + `lb_daily`(데일리 게임마다) + `duel_list` + 대회 목록(`listContests`, `getMyContestIds`). `world` 호출 금지.
- 미리보기 최대 한 변 480px, 넓은 화면(900px 이상)도 세로 배치.
- 미리보기 다시 그리기: 맑은 날 게임 10분(실제 10초)마다, 비·눈이면 100ms마다. 탭이 숨으면·화면 밖이면 멈춤.
- 푸시 전에 `npm test && npm run typecheck && npm run build && npm run fn:test`.
- 커밋 메시지 `type: 내용`(한국어), 끝에 세션 attribution 줄.

## Review Focus

1. **저장된 위치가 지금 못 쓰는 자리**(잠긴 지역, 다른 기기에서 해금하기 전 저장, 맵이 바뀐 칸): 마을 시작 위치에 선다. → Task 2 `previewState` 테스트
2. **낚시를 한 번도 안 한 사람**(기록 행 없음, 저장 위치 없음): 기본 옷차림으로 마을 시작 위치. 메인이 비거나 깨지지 않는다. → Task 2, Task 5
3. **그리기 실패**(`getContext`가 null, `drawWorld` 예외): 미리보기 자리에 `펨타듀 낚시 들어가기` 버튼, 바로가기 버튼은 그대로. → Task 3, Task 5
4. **할 일 표시 RPC 실패·느림**: 표시만 없고 버튼은 즉시 보이며 누를 수 있다. 숨김 게임은 관리자만. → Task 4
5. **메인을 빨리 떠남·탭 전환**: 타이머·관찰자 정리, 정적 캐시 해제, 숨은 탭에서 그리지 않음. → Task 3

---

### Task 1: 미리보기 계약과 `world` 핸들러의 `previewData` 기록

**Files:**
- Modify: `src/games/types.ts` (Manifest, WorldLogic)
- Modify: `supabase/functions/world/handler.ts`
- Modify: `supabase/functions/world/handler.test.ts`
- Modify: `src/games/fishing/logic.ts` (logic 객체)
- Modify: `src/games/fishing/logic.test.ts`
- Modify: `src/games/registry.test.ts`

**Interfaces:**
- Produces:
  - `Manifest.preview?: true` — 이 지속형 게임은 메인 미리보기를 그린다.
  - `WorldLogic.previewData?(state: State): Record<string, string>` — 미리보기에 쓸 짧은 값. 키마다 `game_records` 한 행(값 0, `detail` = 문자열).
  - 낚시: `logic.previewData = (s) => ({ areas: s.areas.join(',') })`. 키 상수 `PREVIEW_AREAS_KEY = 'areas'`를 `src/games/fishing/logic.ts`에서 export.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `handler.test.ts` (테스트 등록부에 `previewData: (s) => ({ p1: s.tag })`인 world 게임을 둔다, 기존 avatar 테스트 픽스처 방식):
    - `load (새 세이브) → game_records에 key 'p1', detail = 초기 tag`
    - `act로 tag 변경 → 해당 행 detail 갱신, updated_at 변경`
    - `act로 tag 불변 → 해당 행 updated_at 불변` (값이 같으면 쓰지 않음)
    - `previewData가 없는 게임 → game_records에 그 키 없음`
    - `act가 error → previewData 행 불변` (avatar와 같은 규칙: 지갑 이전만 저장되는 경우는 그 상태로 써도 됨)
  - `logic.test.ts`: `previewData(init()) → { areas: 'village,river,forest' }`, 지역을 연 상태 → 그 id가 포함.
  - `registry.test.ts`:
    - `world previewData keys are not record keys`: 모든 world에 대해 `Object.keys(logic.previewData?.(logic.init()) ?? {})`가 `manifest.records` 키, `AVATAR_RECORD_KEY`, `FREE_BONUS_RECORD_KEY`와 겹치지 않는다.
    - `games/duels have no preview`: `[...games, ...duels]`의 `manifest.preview`는 undefined.
- [ ] **Step 2: 실패 확인** — Run: `npm run fn:test && npx vitest run src/games/registry.test.ts src/games/fishing/logic.test.ts` / Expected: FAIL (새 테스트만)
- [ ] **Step 3: 구현**
  - `types.ts`: 위 두 필드, JSDoc에 "game_records 키 = 반환 객체의 키, manifest records·avatar·free_bonus 키와 겹치면 안 된다".
  - `handler.ts`: `writeAvatar` 근처에 `syncPreviewData(tx, uid, gameId, data: Record<string,string>)` — 그 키들의 현재 `detail`을 한 번 읽고, 다른 키만 upsert. 행동이 성공했거나 세이브를 새로 만들었거나 migrate한 요청에서 부른다(avatar 블록 바로 뒤). error 경로의 "지갑 이전만 저장" 분기에서도 avatar와 함께 부른다.
  - 낚시 `logic`에 `previewData`.
- [ ] **Step 4: 통과 확인** — Run: `npm run fn:test && npx vitest run src/games && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat: 지속형 게임 미리보기 기록(previewData)과 낚시 열린 지역"`

---

### Task 2: 낚시 미리보기 상태 계산 (순수)

**Files:**
- Create: `src/games/fishing/preview.ts`
- Create: `src/games/fishing/preview.test.ts`

**Interfaces:**
- Consumes: `PREVIEW_AREAS_KEY`(Task 1), `startPosition`·`SavedPosition`(`position.ts`), `decodeOutfit`(`outfit.ts`), `DEFAULT_AREAS`·`AREAS`·`AreaId`(`data.ts`), `Opened`(`map.ts`), `Player`(`walk.ts`), `Conditions`(`clock.ts`), `AVATAR_RECORD_KEY`(`types.ts`), `SCENE_W`(`scene.ts`)
- Produces:
  ```ts
  export type PreviewRecord = { key: string; detail: string | null }
  export type PreviewState = { area: AreaId; player: Player; opened: Opened; outfit: Outfit }
  export function previewState(saved: SavedPosition | null, records: PreviewRecord[]): PreviewState
  export function previewScale(size: number): number          // 1~4
  export function redrawDelayMs(cond: Conditions, nowMs: number): number
  export const PREVIEW_RAIN_FRAME_MS = 100
  ```
  - `previewState`: `opened` = `DEFAULT_AREAS` ∪ (`areas` 기록을 `,`로 나눠 알려진 `AreaId`만). `outfit` = `decodeOutfit(avatar 기록 detail ?? '')`. 위치 = `startPosition(saved, opened)`. `player` = `{ pos, facing, moving: false, walkMs: 0 }`.
  - `previewScale(size)` = `clamp(floor(size / SCENE_W), 1, 4)`. 논리 장면 한 변은 `floor(size / scale)`.
  - `redrawDelayMs`: `cond.weather === 'rain'`이면 `PREVIEW_RAIN_FRAME_MS`, 아니면 다음 게임 10분 경계(실제 10초 경계)까지 남은 ms(`10000 - (nowMs mod 10000)`, 0이면 10000).

- [ ] **Step 1: 실패하는 테스트 작성** (`preview.test.ts`)
  - `previewState(null, []) → area 'village', pos = VILLAGE.spawn.pos, opened = DEFAULT_AREAS 3개, outfit = decodeOutfit('')`
  - `저장 위치가 잠긴 지역(예: island)이고 areas 기록에 없음 → 마을 시작 위치`
  - `저장 위치가 island이고 areas 기록 'village,river,forest,island' → 그 위치 그대로(island의 도착 칸에서 닿는 칸으로 픽스처를 고른다)`
  - `areas 기록에 모르는 id·빈 문자열·null detail → 무시, 기본 지역은 항상 포함`
  - `avatar 기록이 깨진 JSON → 기본 옷차림`
  - `previewScale(159) → 1, previewScale(320) → 2, previewScale(480) → 3, previewScale(2000) → 4`
  - `redrawDelayMs({weather:'rain'}, 12345) → 100`, `redrawDelayMs({weather:'sun'}, 12345) → 7655`, `redrawDelayMs({weather:'sun'}, 20000) → 10000`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/preview.test.ts` / Expected: FAIL (모듈 없음)
- [ ] **Step 3: 구현** — DOM·React import 없음.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing/preview.test.ts && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat: 낚시 미리보기 상태 계산(위치·열린 지역·옷차림·다시 그리는 간격)"`

---

### Task 3: 낚시 미리보기 컴포넌트와 등록

**Files:**
- Create: `src/games/fishing/Preview.tsx`
- Create: `src/games/fishing/Preview.test.tsx`
- Modify: `src/games/ui.ts`
- Modify: `src/games/fishing/manifest.ts` (`preview: true`)
- Modify: `src/games/registry.test.ts`

**Interfaces:**
- Consumes: Task 2 전부, `loadPosition`(`position.ts`), `drawWorld`·`releaseSceneCache`(`scene.ts`), `mapFor`(`maps/index.ts`), `cameraFor`(`walk.ts`), `conditionsAt`·`tideAt`(`clock.ts`), `now`(`src/lib/serverTime.ts`), `STATIC_DYNAMIC` 대신 `{ tide: tideAt(cond.gameMinute), holes: new Set() }`
- Produces (`src/games/ui.ts`):
  ```ts
  export type WorldPreviewProps = {
    userId: string
    records: { key: string; detail: string | null }[]   // user_records 중 이 게임의 행
    size: number                                        // 정사각형 한 변(CSS px)
    onFail: () => void                                  // 그리기를 못 하면 한 번 부른다
  }
  export function getWorldPreview(id: string): ComponentType<WorldPreviewProps> | undefined
  ```
  낚시 `Preview`를 `previewComponents`에 등록.

- [ ] **Step 1: 실패하는 테스트 작성** (`Preview.test.tsx`, `getContext`를 `Game.test.tsx`처럼 spy로 가짜 컨텍스트, `drawWorld`는 `vi.mock('./scene.ts')`로 spy, `IntersectionObserver`는 테스트에서 가짜 클래스로 둔다)
  - `마운트 → drawWorld 1회, 인자: phase 'idle', bobber null, bar null, fade 0, hudTop 0, outfit = previewState의 outfit, opened = previewState의 opened, teleporterOn false`
  - `캔버스 크기: size 320 → scale 2, canvas.width = 320, 논리 장면 160×160 (drawWorld size 인자 {w:160,h:160})`
  - `캔버스는 aria-hidden (링크는 부모가 단다), 포인터·터치 핸들러 없음`
  - `가짜 타이머: 맑은 날 10초 진행 → drawWorld 1회 추가, 9초에는 추가 없음`
  - `document.hidden = true + visibilitychange → 시간이 지나도 drawWorld 추가 없음; 다시 보이면 즉시 1회`
  - `IntersectionObserver가 화면 밖 → 그리지 않음`
  - `언마운트 → 타이머·관찰자 정리, releaseSceneCache 1회`
  - `getContext가 null → onFail 1회, 예외 없음`; `drawWorld가 throw → onFail 1회, 이후 타이머 없음`
  - `registry.test.ts`: `world preview: manifest preview ⇔ getWorldPreview` (모든 world에 대해 `!!manifest.preview === !!getWorldPreview(id)`)
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/Preview.test.tsx src/games/registry.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — `useMemo(() => previewState(loadPosition(userId), records), [userId, records])`. 그리기 함수 하나가 `conditionsAt(now())`로 장면을 그리고 `setTimeout(draw, redrawDelayMs(cond, now()))`로 다음을 건다. 화면 표시 여부(`visible && intersecting`)가 false면 타이머를 걸지 않고, true가 되면 바로 그린다. 카메라는 `cameraFor(map, round(player.pos), {w: side, h: side})`. `imageSmoothingEnabled = false`.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat: 낚시 메인 미리보기 화면과 등록부(getWorldPreview)"`

---

### Task 4: 바로가기 버튼 목록과 할 일 표시

**Files:**
- Create: `src/platform/home/shortcuts.ts`
- Create: `src/platform/home/shortcuts.test.ts`
- Create: `src/platform/home/Shortcuts.tsx`
- Create: `src/platform/home/Shortcuts.test.tsx`
- Modify: `src/platform/home/home.css`

**Interfaces:**
- Consumes: `games`(등록부), `rpc`, `kstDate`, `now`, `syncServerTime`(`serverTime.ts`, `loadUpcomingContests`가 쓰는 것), `listContests`·`getMyContestIds`(`contests/data.ts`), `phaseOf`(`contests/format.ts`), `DuelList`·`DuelListItem`(`duel/data.ts`)
- Produces:
  ```ts
  // shortcuts.ts (순수 + 데이터 로더)
  export type Badge = 'daily' | 'duels' | 'contests'
  export type Shortcut = { key: string; label: string; to: string; badge: Badge | null; gameId?: string }
  export function buildShortcuts(mods: { manifest: Manifest }[], isAdmin: boolean): Shortcut[]
  export async function loadDailyDone(gameId: string, userId: string): Promise<boolean>
  export async function loadMyActiveDuels(): Promise<DuelListItem[]>          // duel_list().mine 중 status 'active'
  export async function loadMyActiveContests(userId: string): Promise<ContestRow[]> // 참가한 것, 취소 아님, live 또는 24시간 안 시작
  export function shortcutTarget(base: string, items: { id: string }[], pathOf: (id: string) => string): string
  // Shortcuts.tsx
  export function Shortcuts(): JSX.Element
  ```
  - `buildShortcuts` 순서: (1) `modes.daily`인 게임마다 `{ key: 'daily:<id>', label: '데일리 <name>', to: '/play/<id>/daily', badge: 'daily', gameId }` (2) `{ key: 'duel', label: '대전', to: '/duel', badge: 'duels' }` (3) `{ key: 'contests', label: '대회', to: '/contests', badge: 'contests' }` (4) `modes.free`인 게임마다 `{ key: 'free:<id>', label: <name>, to: '/play/<id>/free', badge: null }`. `manifest.hidden`이면 `isAdmin`일 때만. 각 묶음 안은 등록부 순서.
  - `shortcutTarget`: `items.length === 1`이면 `pathOf(items[0].id)`, 아니면 `base`.
  - 표시 문자: 데일리 미완료 `●`(완료·로딩·실패면 없음), 대전·대회는 수가 1 이상일 때 숫자. 접근 이름: `데일리 후알야, 아직 안 풀었어요` / `대전, 진행 중 2개` / `대회, 참가 중 1개`.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `shortcuts.test.ts` (테스트 manifest 픽스처):
    - `순서: 데일리 게임들 → 대전 → 대회 → 자유 플레이 게임들` (데일리+자유 게임은 두 번 나온다: `데일리 X`, `X`)
    - `hidden 게임: isAdmin false → 없음, true → 있음`
    - `world·duel 모듈은 넘겨도 데일리·자유 버튼이 생기지 않는다(modes가 모두 false)`
    - `shortcutTarget('/duel', [{id:'a'}], p) → p('a')`; `[]` → `'/duel'`; 2개 → `'/duel'`
    - `loadDailyDone`: rpc `lb_daily` `{ p_day: kstDate(now()), p_game }`가 내 user_id 행을 돌려주면 true, 아니면 false
    - `loadMyActiveDuels`: `mine`에 waiting·active·finished 섞임 → active만
    - `loadMyActiveContests`: 공개지만 참가 안 함 → 제외; 참가+live → 포함; 참가+25시간 뒤 시작 → 제외; 참가+취소 → 제외
  - `Shortcuts.test.tsx` (rpc·contests data mock, useAuth mock):
    - `모든 RPC가 pending이어도 버튼이 즉시 보이고 링크 href가 맞다`
    - `lb_daily에 내 행 없음 → '데일리 후알야' 버튼에 ● 와 접근 이름 '데일리 후알야, 아직 안 풀었어요'`
    - `lb_daily reject → ● 없음, 버튼 그대로`
    - `진행 중 대국 1개(id 'm1') → 대전 버튼 href '/duel/m1', 표시 '1'`; `2개 → href '/duel', 표시 '2'`; `0개 → 표시 없음`
    - `참가 중 대회 1개(id 'c1') → href '/contests/c1'`
    - `설명 문구(manifest.description)가 화면에 없다`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/platform/home/shortcuts.test.ts src/platform/home/Shortcuts.test.tsx` / Expected: FAIL
- [ ] **Step 3: 구현** — `Shortcuts`는 `buildShortcuts([...games], isAdmin)`로 버튼을 바로 그리고, 데일리 게임마다 `loadDailyDone`, 한 번씩 `loadMyActiveDuels`·`loadMyActiveContests`를 부른다(언마운트 뒤 결과 버림). CSS: `.home-shortcuts` 2열 격자, 900px 이상 3열, 버튼 안 이름 왼쪽·표시 오른쪽, 토큰 색만.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/platform/home && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat: 메인 바로가기 버튼과 할 일 표시"`

---

### Task 5: 새 `HomePage`, 옛 블록 삭제, 문서

**Files:**
- Rewrite: `src/platform/home/HomePage.tsx`, `src/platform/home/HomePage.test.tsx`, `src/platform/home/home.css`(블록용 규칙 정리)
- Delete: `src/platform/home/blocks/`(6개 + `socialBlocks.test.tsx`, `soloBlocks.test.tsx`), `blocks.ts`, `blocks.test.ts`, `EditList.tsx`, `layout.ts`, `layout.test.ts`, `BlockFrame.tsx`, `BlockFrame.test.tsx`, `useBlockData.ts` — 삭제 전 `grep -rn` 으로 다른 곳에서 import하지 않는지 확인(`loadUpcomingContests`는 `platform/games`에 있으므로 남는다)
- Modify: `CLAUDE.md`(폴더 규칙에 `src/platform/home/` = 밸리 미리보기 + 바로가기, 지속형 게임 추가 절차에 `preview`·`previewData`·`getWorldPreview` 한 줄)
- Modify: `docs/superpowers/specs/2026-11-01-home-dashboard-design.md` 머리에 "대체됨: 2026-11-24-home-valley-design.md"
- Modify: `docs/deploy-checklist.md` (새 절: `feat/home-valley` — `world` 재배포 → Vercel, 수동 확인 항목)

**Interfaces:**
- Consumes: `getWorldPreview`·`WorldPreviewProps`(Task 3), `Shortcuts`(Task 4), `worlds`, `rpc('user_records', { p_handle })`, `useAuth().profile`(`id`, `handle`, `is_admin`)
- Produces: `export function HomePage(): JSX.Element` (라우트 `/` 그대로)

- [ ] **Step 1: 실패하는 테스트 작성** (`HomePage.test.tsx`, 기존 파일 교체. `../../games/ui.ts`의 `getWorldPreview`를 mock해 가짜 미리보기(`onFail` 버튼 포함)를 돌려주고, `../../lib/api.ts`의 `rpc`·`world`를 spy)
  - `미리보기 게임: manifest.preview가 있는 첫 world. 링크 href '/world/<id>', 접근 이름 '<게임 이름> 들어가기', 그 안에 가짜 미리보기와 '들어가기' 글자`
  - `rpc 'user_records'를 { p_handle: profile.handle }로 1회, 가짜 미리보기의 records = 그 게임 행만({ key, detail })`
  - `user_records reject → records []로 미리보기는 그대로 그려짐`
  - `가짜 미리보기가 onFail 호출 → 미리보기 자리에 '<게임 이름> 들어가기' 버튼(링크) 하나, 바로가기 버튼은 그대로`
  - `미리보기 컴포넌트가 렌더 중 throw → 같은 대체 버튼(오류 경계), 바로가기 그대로`
  - `world() 호출 0회`
  - `preview 게임이 hidden이고 관리자가 아님 → 미리보기 없음, 대체 버튼도 없음, 바로가기만`
  - `size: 컨테이너 폭 360 → size 360, 폭 1200 → size 480` (ResizeObserver를 가짜로 두고 폭을 넣는다)
  - `'편집' 버튼이 없다`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/platform/home/HomePage.test.tsx` / Expected: FAIL
- [ ] **Step 3: 구현** — 구조: `<div className="home">` 안에 `<a className="home-valley">`(정사각형, `size` 상태, 안에 `Preview` + 모서리 `들어가기`) 또는 대체 `<Link className="btn btn-primary">`, 그 아래 `<Shortcuts />`. 오류 경계는 `HomePage.tsx` 안의 작은 클래스 컴포넌트. 넓은 화면은 `.home { max-width: 480px; margin: 0 auto }`. 옛 파일 삭제, 문서 수정.
- [ ] **Step 4: 전체 검증** — Run: `npm test && npm run typecheck && npm run build && npm run fn:test` / Expected: 모두 PASS. `npm run build` 출력의 메인 청크 크기를 main 기준과 비교해 PR 설명에 적는다.
- [ ] **Step 5: 수동 확인** (`npm run dev`, 폰 폭 375px와 데스크톱 1280px): 미리보기에 내 캐릭터·낮밤, 미리보기를 문질러 페이지 스크롤, 누르면 낚시 입장, 데일리 ●, 버튼 누르면 1클릭 이동. 확인 결과를 PR 설명에 적는다.
- [ ] **Step 6: 커밋** — `git commit -m "feat: 메인을 밸리 미리보기와 바로가기 버튼으로 바꿈"` (문서 변경 포함)

---

배포 순서(체크리스트에 적을 내용): `world` 함수 재배포(previewData 기록) → PR 머지(Vercel). 함수만 먼저 올라가도 옛 화면은 영향 없다. 화면이 먼저 올라가면 `areas` 기록이 없어 기본 지역으로 그릴 뿐이다.

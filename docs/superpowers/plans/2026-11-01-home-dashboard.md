# 홈 대시보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/`를 사용자별로 켜기·끄기·순서 변경이 되는 블록 대시보드로 바꾸고, 기존 게임 목록을 `/games`로 옮긴다.

**Architecture:** 블록 등록부(`src/platform/home/blocks.ts`) + 순수 함수 레이아웃 해석(`layout.ts`) + 블록마다 기존 RPC를 각자 부르는 컴포넌트. 레이아웃은 `profiles.home_layout jsonb`에 `[{id, on}]`로 저장하고 `set_home_layout` RPC로만 쓴다. DB에는 블록 id 허용 목록을 두지 않는다.

**Tech Stack:** Vite + React + TypeScript, react-router-dom, Vitest + Testing Library, Supabase(Postgres, pgTAP DB 테스트)

**Spec:** `docs/superpowers/specs/2026-11-01-home-dashboard-design.md` — 구현자는 이 계획과 스펙을 함께 읽는다.

## Global Constraints

- 작업 브랜치 `feat/home-dashboard` (`docs/home-dashboard-spec` 위에서 분기). main 직접 커밋 금지.
- 커밋 메시지 `type: 내용`(`feat`/`fix`/`test`/`docs`/`chore`), 한국어 가능. 끝에 attribution 두 줄(세션 안내 그대로).
- 각 태스크 끝: `npm test && npm run typecheck`. 마지막 태스크에서 `npm run build`, `npm run db:test` 추가.
- 플랫폼 코드에 게임별 분기 금지: 게임은 `games`/`duels` 등록부를 순회하고, `manifest.hidden`이면 `profile.is_admin`일 때만 보인다.
- 모든 화면 문구 한국어. 색은 `theme.css`·`palettes.ts` 토큰(`var(--…)`)만. 모바일 우선, 넓은 화면 기준점은 기존 `@media (min-width: 900px)`.
- 날짜는 서버 시계: `kstDate(now())`, `kstWeekStart(today)` (`src/shared/kst.ts`, `src/lib/serverTime.ts`).
- RPC 호출은 `rpc<T>(name, args)` (`src/lib/api.ts`), 오류 문구는 `errorMessage(code)`.
- 새 마이그레이션은 `npx supabase@2 migration new home_layout`으로 만든다(타임스탬프 이름). 번호를 직접 붙이지 않는다.
- 블록 id 형식 `^[a-z0-9-]{1,32}$`, 저장 배열 길이 1~32.

## Review Focus

1. 저장값이 깨진 경우(문자열, 객체, 형식 틀린 원소, 모르는 id만 있는 배열) — 홈은 기본 레이아웃으로 정상 렌더해야 한다. → Task 2 `resolveLayout` 테스트.
2. 등록부에 해당 게임이 하나도 없는 경우(모든 데일리 게임이 숨김인 일반 사용자 등) — 블록은 빈 문구를 보여야 하고 RPC를 부르지 않아야 한다. → Task 4·5 각 블록 "no visible games" 테스트.
3. 주간 순위에서 내가 5위 밖이거나 기록이 없는 경우 — 상위 5명 아래에 내 줄이 따로 보이고, 기록이 없으면 내 줄은 없다. → Task 4 `WeeklyBlock` 테스트.
4. `완료`를 빠르게 두 번 누르는 경우 — 저장 중 버튼 비활성으로 `set_home_layout`은 한 번만 호출. → Task 7 테스트.
5. 모든 블록을 끈 경우 — 보기 모드에 안내 문구와 `편집` 버튼, 블록 RPC 호출 없음. → Task 7 테스트.

---

### Task 1: DB 컬럼·RPC와 클라이언트 타입

**Files:**
- Create: `supabase/migrations/<ts>_home_layout.sql` (`npx supabase@2 migration new home_layout`)
- Create: `supabase/tests/08_home_layout.test.sql`
- Modify: `src/platform/auth/AuthProvider.tsx` (`Profile` 타입)
- Modify: `src/lib/api.ts` (`MESSAGES`)

**Interfaces:**
- Produces: `public.profiles.home_layout jsonb` (nullable, 기본 null); `public.set_home_layout(p_layout jsonb) returns void`; 오류 코드 `home_layout_invalid`, `forbidden`; TS `Profile.home_layout?: unknown` (해석은 Task 2의 `resolveLayout`이 맡으므로 `unknown`).

- [ ] **Step 1: DB 테스트 작성** — `06_appearance.test.sql`의 구조(사용자 두 명, `set local role authenticated`, `request.jwt.claims`, superuser로 검증)를 따른다. 두 사용자 모두 `status = 'approved'`로 갱신해 둔다(`04_leaderboards.test.sql:27` 방식). 단언:
  - 새 프로필의 `home_layout`은 null
  - A: `set_home_layout('[{"id":"daily","on":true},{"id":"elo","on":false}]')` lives_ok, 이후 값이 그대로 저장됨
  - A: `set_home_layout(null)` lives_ok → null
  - throws `P0001 home_layout_invalid`: `'{}'`, `'[]'`, 원소 33개 배열, `'[{"id":"daily"}]'`(on 없음), `'[{"id":"daily","on":true,"x":1}]'`(키 초과), `'[{"id":"Daily","on":true}]'`, `'[{"id":"daily","on":"yes"}]'`, `'[{"id":"daily","on":true},{"id":"daily","on":false}]'`
  - 미승인(pending) 사용자: throws `P0001 forbidden`
  - jwt 없음: throws `P0001 forbidden`
  - 직접 `update public.profiles set home_layout = '[]'` 는 `42501`
  - A 저장 후 B 행은 null 그대로
  - A 역할로 `select home_layout from public.my_profile()` 이 저장값을 돌려줌
  - `anon` 역할로 `set_home_layout` 실행 시 `42501`(권한 없음)
- [ ] **Step 2: 실패 확인** — Run: `npm run db:test` / Expected: `08_home_layout` FAIL(함수 없음).
- [ ] **Step 3: 마이그레이션 작성** — `alter table public.profiles add column home_layout jsonb;` + `set_home_layout`(plpgsql, security definer, `search_path = public`): `_require_approved()` → null이면 null 저장 → 아니면 스펙 §4.1 검증(배열, 길이 1~32, 각 원소 키 정확히 `id`·`on`, `id` 문자열 `^[a-z0-9-]{1,32}$`, `on` boolean, 중복 없음; 위반 시 `home_layout_invalid`) → `update ... where id = auth.uid()`. 권한은 `0010_appearance.sql:36-37`과 같은 두 줄(`revoke execute ... from public, anon, authenticated; grant execute ... to authenticated`).
- [ ] **Step 4: 통과 확인** — Run: `npm run db:test` / Expected: 전체 PASS.
- [ ] **Step 5: 클라이언트 타입·문구** — `Profile`에 `home_layout?: unknown`, `MESSAGES`에 `home_layout_invalid: '홈 설정을 저장하지 못했어요'`. Run: `npm test && npm run typecheck` / Expected: PASS.
- [ ] **Step 6: 커밋** — `feat: 홈 레이아웃 저장 컬럼과 set_home_layout RPC`

### Task 2: 레이아웃 해석 순수 함수

**Files:**
- Create: `src/platform/home/layout.ts`, `src/platform/home/layout.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type HomeLayoutEntry = { id: string; on: boolean }
  export function resolveLayout(saved: unknown, knownIds: readonly string[]): HomeLayoutEntry[]
  export function moveUp(layout: HomeLayoutEntry[], id: string): HomeLayoutEntry[]
  export function moveDown(layout: HomeLayoutEntry[], id: string): HomeLayoutEntry[]
  export function toggle(layout: HomeLayoutEntry[], id: string): HomeLayoutEntry[]
  /** 기본값(resolveLayout(null, knownIds))과 같으면 null, 다르면 layout 그대로 — set_home_layout에 보낼 값 */
  export function toSaved(layout: HomeLayoutEntry[], knownIds: readonly string[]): HomeLayoutEntry[] | null
  ```

- [ ] **Step 1: 테스트 작성** (`known = ['a','b','c']`)
  - `resolveLayout(null, known)` / `'x'` / `{}` / `undefined` → `[{a,on:true},{b,true},{c,true}]`
  - `resolveLayout([{id:'c',on:false},{id:'a',on:true}], known)` → `[c:false, a:true, b:true]` (저장 순서 유지, 새 블록 b는 맨 아래 켜짐)
  - 모르는 id·중복·형식 틀린 원소 제거: `[{id:'z',on:true},{id:'b',on:false},{id:'b',on:true},{id:'a'},'x',null]` → `[b:false, a:true, c:true]`
  - 모르는 id만 있는 배열 → 기본값과 같음
  - 결과에 known 각 id가 정확히 한 번
  - `moveUp(l,'첫 id')`, `moveDown(l,'끝 id')`는 같은 내용, 중간 이동은 이웃과 자리 바꿈, 꺼진 블록도 이동
  - `toggle`은 해당 `on`만 뒤집음, 입력 배열 불변(`toBe`로 원본이 바뀌지 않음 확인)
  - `toSaved(resolveLayout(null,known), known)` → `null`; 순서나 on이 하나라도 다르면 배열 그대로
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/platform/home/layout.test.ts` / Expected: FAIL(모듈 없음).
- [ ] **Step 3: 구현** — 스펙 §4.2 규칙 1~3 순서대로. 모든 함수는 새 배열 반환.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS.
- [ ] **Step 5: 커밋** — `feat: 홈 레이아웃 해석 함수`

### Task 3: 블록 공통 틀과 데이터 훅

**Files:**
- Create: `src/platform/home/useBlockData.ts`, `src/platform/home/BlockFrame.tsx`, `src/platform/home/BlockFrame.test.tsx`, `src/platform/home/home.css`

**Interfaces:**
- Produces:
  ```ts
  export type BlockState<T> = { kind: 'loading' } | { kind: 'done'; data: T } | { kind: 'error' }
  /** 마운트·deps 변경 때 한 번 load. 언마운트 뒤 결과는 버린다. retry는 같은 load를 다시 부른다. */
  export function useBlockData<T>(load: () => Promise<T>, deps: readonly unknown[]): { state: BlockState<T>; retry: () => void }
  // BlockFrame.tsx
  export function BlockFrame(props: { title: string; state: BlockState<unknown>; onRetry: () => void; children?: ReactNode }): JSX.Element
  ```
  `BlockFrame`은 `<section className="card home-block" aria-label={title}>` 안에 `<h3 className="card-title">{title}</h3>`, 그 아래 `loading` → `불러오는 중…`, `error` → `불러오지 못했어요` + `다시 시도` 버튼(onRetry), `done` → children.

- [ ] **Step 1: 테스트 작성** — 테스트용 컴포넌트에서 `useBlockData(load, [])` + `BlockFrame`:
  - 처음 `불러오는 중…`, resolve 후 children 표시
  - reject → `불러오지 못했어요`, `다시 시도` 클릭 → load 두 번째 호출, 이번엔 resolve → children
  - resolve 전에 unmount해도 경고·상태 갱신 없음(`console.error` spy가 호출되지 않음)
- [ ] **Step 2: 실패 확인** — `npx vitest run src/platform/home/BlockFrame.test.tsx` FAIL.
- [ ] **Step 3: 구현** — 훅은 기존 `alive` 패턴(`HomePage.tsx`의 useEffect). retry는 내부 카운터 state를 deps에 더해 재실행. `home.css`에는 `.home-grid`(모바일 한 열 flex column gap 10px, `@media (min-width: 900px)`에서 `display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; align-items: start`)와 편집 모드용 `.home-edit-row`, `.home-edit-row[data-off="true"]`(opacity로 흐리게)만 둔다. 색은 토큰.
- [ ] **Step 4: 통과 확인** — PASS.
- [ ] **Step 5: 커밋** — `feat: 홈 블록 공통 틀과 데이터 훅`

### Task 4: 솔로 게임 블록 — 데일리·주간·내 기록

**Files:**
- Create: `src/platform/home/blocks/DailyBlock.tsx`, `WeeklyBlock.tsx`, `StreakBlock.tsx`, `src/platform/home/blocks/soloBlocks.test.tsx`

**Interfaces:**
- Consumes: Task 3 `useBlockData`, `BlockFrame`; `games` (`src/games/index.ts`); `useAuth().profile`.
- Produces: 각 `export function XBlock({ title }: { title: string }): JSX.Element`.

공통: 보이는 게임 = `games.filter(g => (!g.manifest.hidden || profile?.is_admin) && g.manifest.modes.<daily|free>)`. 대상 게임이 0개면 RPC 없이 빈 문구. 게임별로 `rpc`를 `Promise.all`로 부르고 하나라도 실패하면 블록 전체 `error`. 게임이 둘 이상이면 게임 이름을 소제목(`h4`)으로.

| 블록 | RPC | 표시 (정확한 문구) | 빈 문구 |
|---|---|---|---|
| Daily (`modes.daily`) | `lb_daily {p_day: today, p_game}` | 내 행 있음: `{score}점 · {rank}위 / {rows.length}명`. 없음: `아직 끝내지 않았어요`. 둘 다 `데일리` 링크 → `/play/{id}/daily` | `열린 데일리 게임이 없어요` |
| Weekly (`modes.daily`) | `lb_range {p_from: kstWeekStart(today), p_to: today, p_game}` | 상위 5행 `{rank}. {handle} {score}점`(내 행은 `aria-current="true"`). 내가 6위 이하면 `…` 줄 다음에 내 행. 행 0개면 `이번 주 기록이 없어요` | `열린 데일리 게임이 없어요` |
| Streak (`modes.free`) | `lb_free {p_game}` | 내 행(`user_id === profile.id`): `{plays}판 · 승률 {Math.round(win_rate*100)}% · 연속 {current_streak} (최고 {best_streak ?? 0})`. 없음: `아직 기록이 없어요` + `자유 플레이` 링크 → `/play/{id}/free` | `열린 자유 플레이 게임이 없어요` |

- [ ] **Step 1: 테스트 작성** — `pages.test.tsx`의 mock 머리말(`withTestGame`, `api.ts`의 `rpc`, `useAuth` with `admin` 변수)을 그대로 쓴다. 단언은 `테스트 숫자 맞히기` 소제목 영역 안에서(`within`) 한다.
  - Daily: `[{user_id:'u2',rank:1,score:9},{user_id:'u1',rank:2,score:8.5}]` → `8.5점 · 2위 / 2명`, `rpc`가 `lb_daily`를 `{p_day: /^\d{4}-\d{2}-\d{2}$/, p_game:'test-guess'}`로 호출; `[]` → `아직 끝내지 않았어요`; 링크 href
  - Weekly: 7행 중 내가 7위 → 상위 5행 + `…` + `7. kane …점`; 내가 2위 → `…` 없음, 2위 행 `aria-current`; `[]` → `이번 주 기록이 없어요`; `p_from`이 `kstWeekStart(p_to)`와 같음
  - Streak: `{plays:12, win_rate:0.4167, current_streak:3, best_streak:5}` → `12판 · 승률 42% · 연속 3 (최고 5)`; 내 행 없음 → `아직 기록이 없어요` + 링크
  - 각 블록: `rpc` reject → `불러오지 못했어요`
  - no visible games: `admin=false`이고 `vi.mock`된 등록부를 테스트 게임만(숨김) 남기도록 바꾼 경우 빈 문구, `rpcMock` 호출 0회. (등록부를 `[testGuess]`만 돌려주는 mock을 이 describe에서 `vi.doMock` 대신 모듈 상태 변수로 제어: `let onlyTest = false` → mock factory가 `onlyTest ? [testGuess] : withTestGame(...)`)
  - 숨김 게임은 `admin=false`에서 안 보이고 `admin=true`에서 보임
- [ ] **Step 2: 실패 확인** — `npx vitest run src/platform/home/blocks/soloBlocks.test.tsx` FAIL.
- [ ] **Step 3: 구현** — 위 표대로 세 컴포넌트.
- [ ] **Step 4: 통과 확인** — PASS.
- [ ] **Step 5: 커밋** — `feat: 홈 데일리·주간·내 기록 블록`

### Task 5: 대회·대전·레이팅 블록

**Files:**
- Modify: `src/platform/games/UpcomingContests.tsx` (조회 로직 분리)
- Modify: `src/test-fixtures/registry.ts` (`withTestGame`이 `duels`·`getDuel`을 잃지 않게)
- Create: `src/platform/home/blocks/ContestsBlock.tsx`, `DuelsBlock.tsx`, `EloBlock.tsx`, `src/platform/home/blocks/socialBlocks.test.tsx`

**Interfaces:**
- Consumes: Task 3; `duels`, `getDuel` (`src/games/index.ts`); `DuelList`, `DuelListItem` (`src/platform/duel/data.ts`).
- Produces:
  - `export async function loadUpcomingContests(profileId: string | undefined): Promise<ContestRow[]>` (in `UpcomingContests.tsx`) — 지금 useEffect 안의 `syncServerTime` → `listContests`/`getMyContestIds` → 필터·정렬·`slice(0,3)` 그대로.
  - `withTestGame(real)`이 `{ ...real, games, getGame }`를 돌려준다(기존 호출부 동작 불변).
  - 블록 컴포넌트 3개, 시그니처는 Task 4와 같음.

| 블록 | 데이터 | 표시 (정확한 문구) | 빈 문구 |
|---|---|---|---|
| Contests | `loadUpcomingContests(profile?.id)` | 기존 `UpcomingContests` 카드 마크업(배지, 제목, `진행 중` / `시작까지 {countdown}`) 그대로, 1초 tick 유지 | `진행 중이거나 곧 시작하는 대회가 없어요` + `대회 보기` 링크 → `/contests` |
| Duels | `rpc<DuelList>('duel_list')` 한 번 | `mine` 중 보이는 게임(`getDuel(game_id)`이 있고 숨김이면 관리자만) 최대 5개, 각각 링크 → `/duel/{id}` 텍스트 `{게임 이름} · vs {상대 handle}`; `status === 'waiting'`이거나 상대가 없으면 `{게임 이름} · 상대 기다리는 중`. 아래 `공개 대기실 {lobby.length}개` + `대전하러 가기` 링크 → `/duel` | `mine` 0개: `진행 중인 대전이 없어요` (대기실 줄과 링크는 그대로) |
| Elo | 보이는 `duels` 게임별 `rpc('lb_duel', {p_game})` | 내 행(`handle === profile.handle`) 있음: `레이팅 {rating}`, `레이팅 대전 {wins}승 {draws}무 {losses}패`, `placed`면 `{배치 완료자 중 순위}위` 아니면 `배치 중`. 없음: `아직 레이팅 대전 기록이 없어요` + `/duel` 링크. 아래 배치 완료자 상위 3명 `{순위}. {handle} {rating}` | 대전 게임 0개: `열린 대전 게임이 없어요` |

배치 완료자 순위 = `rows.filter(r => r.placed)`의 반환 순서상 위치 + 1 (`lb_duel`은 순위 순으로 돌려준다 — `DuelBoard.tsx`와 같은 가정).

- [ ] **Step 1: 테스트 작성**
  - `registry.ts` 변경 회귀: 기존 테스트 전체가 그대로 통과(Step 4에서 확인)
  - Contests: `loadUpcomingContests`를 mock(`vi.mock('../../games/UpcomingContests.tsx', …)`로 함수만 교체)해 행 1개 → 제목·`진행 중` 표시; `[]` → 빈 문구와 `/contests` 링크
  - Duels: `mine`에 active(상대 `son`), waiting(나만) → `요트 다이스 · vs son`, `요트 다이스 · 상대 기다리는 중`, 각각 href `/duel/{id}`; `lobby` 3개 → `공개 대기실 3개`; `mine` 6개 → 링크 5개; `rpc`가 `duel_list`로 정확히 1회 호출
  - Elo: 내 행 없음 → `아직 레이팅 대전 기록이 없어요`, 상위 3명은 표시; `placed:false` 내 행 → `배치 중`; `placed:true`이고 배치 완료자 중 두 번째 → `2위`, `레이팅 대전 3승 1무 2패`
  - 오류: `rpc` reject → `불러오지 못했어요`
  - 숨김 대전 게임: 등록부 mock에서 요트 manifest를 `hidden:true`로 바꾼 경우 `admin=false`이면 Elo는 `열린 대전 게임이 없어요`·`lb_duel` 호출 없음, Duels는 그 대국을 목록에서 뺌
- [ ] **Step 2: 실패 확인** — `npx vitest run src/platform/home/blocks/socialBlocks.test.tsx` FAIL.
- [ ] **Step 3: 구현** — `UpcomingContests`는 `loadUpcomingContests`를 쓰도록 바꾸고 화면 동작(결과 없으면 `null`)은 그대로. 블록 3개 구현.
- [ ] **Step 4: 통과 확인** — Run: `npm test && npm run typecheck` / Expected: 기존 `pages.test.tsx` 포함 전체 PASS.
- [ ] **Step 5: 커밋** — `feat: 홈 대회·대전·레이팅 블록`

### Task 6: 블록 등록부

**Files:**
- Create: `src/platform/home/blocks.ts`, `src/platform/home/blocks.test.ts`

**Interfaces:**
- Consumes: Task 4·5 블록 컴포넌트.
- Produces:
  ```ts
  export type HomeBlock = { id: string; title: string; Component: ComponentType<{ title: string }> }
  export const homeBlocks: HomeBlock[]
  export const homeBlockIds: string[]   // homeBlocks.map(b => b.id)
  ```
  순서·제목: `daily` 오늘의 데일리, `contests` 대회, `duels` 대전, `weekly` 이번 주 순위, `elo` 대전 레이팅, `streak` 내 기록.

- [ ] **Step 1: 테스트** — 모든 id가 `^[a-z0-9-]{1,32}$`, 중복 없음, 개수 ≤ 32, `homeBlockIds`가 위 순서와 정확히 같음.
- [ ] **Step 2: 실패 확인 → Step 3: 구현 → Step 4: 통과 확인** — `npx vitest run src/platform/home/blocks.test.ts`.
- [ ] **Step 5: 커밋** — `feat: 홈 블록 등록부`

### Task 7: 홈 대시보드 화면 (보기·편집·저장)

**Files:**
- Create: `src/platform/home/HomePage.tsx`, `src/platform/home/EditList.tsx`, `src/platform/home/HomePage.test.tsx`

**Interfaces:**
- Consumes: Task 2 전체, Task 6 `homeBlocks`/`homeBlockIds`, `useAuth().profile.home_layout`·`refresh`, `rpc`, `errorMessage`.
- Produces: `export function HomePage(): JSX.Element` (src/platform/home); `export function EditList(props: { layout: HomeLayoutEntry[]; titles: Record<string, string>; onChange: (next: HomeLayoutEntry[]) => void }): JSX.Element`.

화면 규칙(스펙 §5.1·§5.2):
- 제목 `<h2>홈</h2>` + `편집` 버튼. 보이는 레이아웃 = `resolveLayout(savedLayout ?? profile?.home_layout, homeBlockIds)`. `savedLayout`은 저장 성공 때 보낸 값(null 포함)을 담는 로컬 state이고 `undefined`이면 미사용 — 즉 `savedLayout !== undefined ? savedLayout : profile?.home_layout`.
- 보기: `on`인 블록만 `.home-grid` 안에 `<Component title={title} />`. 모두 꺼짐 → `표시할 블록이 없어요. 편집에서 켜 주세요` + `편집` 버튼.
- 편집: `EditList` 한 줄 = 제목, `role="switch"` 버튼(`aria-label="{title} 표시"`, `aria-checked`), `{title} 위로`/`{title} 아래로` 버튼(끝에서 `disabled`), 꺼진 줄 `data-off="true"`. 블록 컴포넌트는 마운트하지 않는다. 하단 `완료`·`취소`·`기본값으로`.
- `완료`: `saving` 동안 세 버튼 `disabled`. `rpc('set_home_layout', { p_layout: toSaved(edit, homeBlockIds) })` 성공 → `setSavedLayout(보낸 값)`, 보기 모드, `void refresh()`. 실패 → 편집 모드 유지, `errorMessage(e instanceof ApiError ? e.code : 'network')`를 `role="alert"`로.

- [ ] **Step 1: 테스트 작성** — 블록 컴포넌트는 `vi.mock('./blocks.ts')`로 가짜 3개(`a`·`b`·`c`, 각자 마운트 때 `mountSpy(id)` 호출하고 `<p>{title} 내용</p>` 렌더)로 바꾼다. `useAuth` mock은 `profile`(변수)과 `refresh` spy를 준다.
  - `home_layout: null` → 세 블록이 a,b,c 순서로 렌더
  - `[{c,on:true},{a,on:false}]` → c, b 순서로 렌더, a는 렌더도 `mountSpy('a')`도 없음
  - 편집 → `b 위로` 클릭 → `완료` → `rpcMock`이 `('set_home_layout', { p_layout: [b:true, a:true, c:true] })`(꺼진 블록 포함 전체), 이후 보기 모드에 새 순서
  - 편집 → `a 표시` 스위치 끄기 → `완료` → 인자 배열에 `{id:'a', on:false}`
  - 편집 → `기본값으로` → `완료` (저장값이 기본이 아닌 상태에서 시작) → `p_layout: null`
  - 편집 → `기본값으로` → `c 위로` → `완료` → 배열 전송
  - `취소` → 편집 전 순서로, `rpc` 호출 없음
  - 저장 실패(`rpcMock` reject `new ApiError(...,'home_layout_invalid')`) → 편집 모드 유지, alert `홈 설정을 저장하지 못했어요`
  - 저장 성공 후 `refresh`가 아무것도 바꾸지 않아도(profile 그대로) 새 순서 유지
  - `완료` 두 번 빠르게 클릭 → `set_home_layout` 1회 (Review Focus 4)
  - 모두 꺼짐 → 안내 문구, `mountSpy` 호출 0회 (Review Focus 5)
  - 편집 모드에서 `mountSpy` 새 호출 없음, 맨 위 `위로`·맨 아래 `아래로`는 disabled
- [ ] **Step 2: 실패 확인** — `npx vitest run src/platform/home/HomePage.test.tsx` FAIL.
- [ ] **Step 3: 구현** — 위 규칙대로.
- [ ] **Step 4: 통과 확인** — PASS.
- [ ] **Step 5: 커밋** — `feat: 홈 대시보드 화면과 블록 편집`

### Task 8: 라우팅·내비게이션 전환과 기존 테스트 정리

**Files:**
- Rename: `src/platform/games/HomePage.tsx` → `src/platform/games/GamesPage.tsx` (컴포넌트 이름 `GamesPage`, 내용 불변)
- Modify: `src/app/routes.tsx`, `src/platform/layout/Layout.tsx`
- Modify: `src/platform/games/pages.test.tsx`, `src/app/App.test.tsx`, `src/platform/layout/Layout.test.tsx`

**Interfaces:**
- Consumes: Task 7 `HomePage` (`src/platform/home/HomePage.tsx`).

- [ ] **Step 1: 테스트 수정·추가**
  - `pages.test.tsx`: import를 `./GamesPage.tsx`의 `GamesPage`로, 렌더 대상 이름만 바꾼다(단언 불변).
  - `App.test.tsx` 'approved user…': `/`에서 `await screen.findByRole('heading', { name: '홈' })`. (프로필 mock의 `rpc`가 블록 RPC에 `{data:null}`을 돌려주므로 블록은 빈·오류 상태로 렌더돼도 된다 — 제목만 단언.)
  - `Layout.test.tsx`에 새 테스트: 주 메뉴 링크 이름과 href가 `홈 → /`, `게임 → /games`, `대회 → /contests`, `대전 → /duel`, `리더보드 → /leaderboard` 순서.
  - 라우팅 테스트(새 파일 `src/app/routes.test.tsx` 또는 `App.test.tsx`에 추가): `/games`에서 `게임 목록` 제목이 보인다.
- [ ] **Step 2: 실패 확인** — `npm test` FAIL(새 단언).
- [ ] **Step 3: 구현** — `git mv`로 이름 변경, `routes.tsx`에 `/`→`home/HomePage`, `/games`→`GamesPage`. `Layout.tsx` 내비게이션: `<NavLink to="/" end>홈</NavLink><NavLink to="/games">게임</NavLink>` 후 기존 탭.
- [ ] **Step 4: 전체 확인** — Run: `npm test && npm run typecheck && npm run build && npm run db:test` / Expected: 모두 성공.
- [ ] **Step 5: 커밋** — `feat: 홈을 대시보드로 바꾸고 게임 목록을 /games로 이동`

### Task 9: PR

- [ ] **Step 1:** `git fetch origin main` 후 필요하면 rebase, `feat/home-dashboard` 푸시.
- [ ] **Step 2:** PR 생성(base `main`). 본문: 스펙·계획 경로, 변경 요약, 배포 순서(스펙 §8: DB 마이그레이션 먼저 → Vercel), 수동 확인 항목(미리보기에서 편집·저장 후 새로고침 유지, 다른 기기 유지, 모바일 한 열·넓은 화면 2열). 끝에 세션 안내의 PR attribution.
- [ ] **Step 3:** PR URL을 사용자에게 전달. 원격 DB push·Vercel 머지는 사용자가 `docs/deploy-checklist.md`대로 한다.

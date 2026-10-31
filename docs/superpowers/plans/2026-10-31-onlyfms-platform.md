# ONLYFMS 플랫폼 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 구글 로그인·관리자 승인·데일리·커스텀 대회·자유 플레이·리더보드를 갖춘 축구 퀴즈 플랫폼을 만들고, 테스트용 게임 "숫자 맞히기"로 전체 흐름을 검증한다.

**Architecture:** Vite+React SPA를 Vercel에 정적 배포한다. Supabase가 Auth(Google), Postgres(RLS·집계 함수), Edge Function `play`(출제·판정)를 맡는다. 게임 로직은 `src/games/<id>/logic.ts` 순수 함수로, 브라우저(자유 플레이)와 Edge Function(데일리·대회)이 공유한다. 데일리는 kind=`daily` 대회로 처리한다.

**Tech Stack:** Vite 5.4, React 18.3, TypeScript 5.6, React Router 6.28, @supabase/supabase-js 2.45, Vitest 2.1, @testing-library/react 16, Supabase CLI(1.200 이상), pgTAP, Deno 1.46(Edge Function), postgres.js 3.4(`npm:postgres@3.4.4`, Edge Function의 트랜잭션용)

**Spec:** `docs/superpowers/specs/2026-10-31-onlyfms-platform-design.md` — 구현 전에 반드시 함께 읽는다. 장 번호(§)는 이 문서를 가리킨다.

## Global Constraints

- 날짜·주 기준은 Asia/Seoul. 데일리는 00:00 KST에 바뀌고, 주는 월요일 00:00 KST 시작.
- 점수는 문제당 0.0~10.0, 소수 첫째 자리(`numeric(3,1)`).
- 아이디 정규식 `^[a-z0-9_]{3,16}$`, citext UNIQUE, 소문자 저장.
- 대회: 제목 1~40자, 문제 1~10개, 시작은 now+5분 이후·now+30일 이내, 제한 시간 5~180분, 초대 코드 10자.
- 반복 출제 방지: 같은 게임 직전 60일의 `puzzleKey` 회피, 재시도 최대 20번.
- 시드: `HMAC-SHA256(PLAY_SECRET, contestId + ':' + position + ':' + retry)`.
- 문제 은행 잔량 경고 기준: 30개 미만.
- 자유 플레이 오프라인 대기열 최대 50개. 진행 중 대회 순위표 새로고침 5초.
- 게임 로직 파일은 외부 의존 없음, 상대 import에 `.ts` 확장자 명시(Deno 호환). 플랫폼 코드에 게임별 분기 금지.
- 비밀값: Vercel `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` / Edge Function `PLAY_SECRET`. 비밀값 커밋 금지.
- Supabase 리전 ap-northeast-2. DB 변경은 `supabase/migrations/`의 마이그레이션 파일로만.
- 모든 화면 문구는 한국어, 모바일 우선, 짙은 보라 톤(§10).

## Review Focus

1. **자정 직전·직후 행동:** 23:59:59 KST의 데일리 `act`는 성공하고, 00:00:01 KST의 같은 요청은 409 `ended`여야 한다. 사람이 자정을 넘겨 제출하는 일은 흔하다 → Task 8 테스트 `act_after_daily_end_is_409`.
2. **같은 행동 두 번 전송(더블 클릭, 재시도):** 한 번만 반영돼야 한다. `act`는 클라이언트가 아는 `expected_count`(현재 action_count)를 받아, 다르면 409 `stale`과 현재 상태를 돌려준다 → Task 8 테스트 `duplicate_act_is_rejected_as_stale`, Task 10 UI는 409 stale 응답의 상태로 화면을 덮어쓴다.
3. **대문자·공백 섞인 아이디 입력("Kane ", "KANE"):** 앞뒤 공백을 자르고 소문자로 바꾼 뒤 검사·저장한다. 이미 있는 "kane"과 중복으로 거부한다 → Task 4 pgTAP `set_handle_normalizes_case_and_trim`.
4. **자유 플레이 대기열 재전송 중복:** 오프라인 대기열을 다시 보낼 때 같은 판이 두 번 저장되면 안 된다. `free_plays.client_id uuid UNIQUE`를 두고 중복은 무시한다(§6에 없는 컬럼이며 이 계획에서 추가) → Task 5 pgTAP `free_play_duplicate_client_id_ignored`, Task 10 `queue_resend_is_idempotent`.
5. **진행 중 공개 대회에 목록에서 바로 들어가기:** 참가 버튼 없이 문제를 열면 403이 나면 안 된다. 공개 대회 페이지 진입 시 자동으로 `join_contest`를 부른 뒤 `open`한다 → Task 11 테스트 `public_live_contest_autojoins_before_open`.

## 사람이 먼저 할 일 (구현 시작 전)

이 항목은 코드 작업이 아니다. Task 8 Step 1과 Task 14에 필요하다.

1. Supabase에서 프로젝트를 만든다(리전 Seoul, ap-northeast-2). Project ref와 anon key를 확보한다.
2. Google Cloud Console에서 OAuth 클라이언트(웹)를 만들고 Supabase Auth → Providers → Google에 등록한다. 승인된 리디렉션 URI는 Supabase가 보여주는 콜백 주소다.
3. Supabase Auth → URL Configuration에 `https://onlyfms.vercel.app`, `https://*-<vercel팀>.vercel.app`, `http://localhost:5173`을 추가한다.
4. Vercel 프로젝트를 이 레포에 연결한다(Task 14 전까지는 main에 머지하지 않으므로 운영 화면은 바뀌지 않는다).
5. 개발자 PC에 Supabase CLI, Docker, Deno, Node 20을 설치한다.

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, vitest.config.ts, index.html, vercel.json
.env.example, .github/workflows/ci.yml, CLAUDE.md
src/
  main.tsx, app/App.tsx, app/routes.tsx, app/theme.css
  lib/supabase.ts                 클라이언트 생성
  lib/api.ts                      Edge Function 호출, RPC 래퍼(타입 포함)
  lib/serverTime.ts               서버 시각 보정
  shared/kst.ts                   KST 날짜·주 계산 (Deno·브라우저 공용)
  shared/rng.ts                   시드 → 난수 (공용)
  games/types.ts                  GameLogic, Ctx, PlatformAction, Manifest
  games/index.ts                  등록부
  games/number-guess/{manifest.ts,logic.ts,logic.test.ts,Game.tsx}
  platform/auth/{AuthProvider.tsx,Guard.tsx,LoginPage.tsx,WelcomePage.tsx}
  platform/games/{HomePage.tsx,PlayRunner.tsx,DailyPage.tsx,FreePage.tsx,freeQueue.ts}
  platform/contests/{ContestListPage.tsx,ContestNewPage.tsx,ContestPage.tsx,ContestItemPage.tsx,JoinPage.tsx,validate.ts}
  platform/leaderboard/LeaderboardPage.tsx
  platform/profile/ProfilePage.tsx
  platform/admin/AdminPage.tsx
supabase/
  config.toml
  migrations/0001_profiles.sql, 0002_contests.sql, 0003_contest_functions.sql, 0004_leaderboards.sql
  tests/01_profiles.test.sql, 02_contests_rls.test.sql, 03_contest_functions.test.sql, 04_leaderboards.test.sql
  functions/play/{index.ts,engine.ts,handler.ts,db.ts,registry.ts,handler.test.ts}
  functions/play/engine.test.ts   (Vitest에서도 실행)
```

---

### Task 1: 프로젝트 골격과 작업 규칙

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `vercel.json`, `.env.example`, `.github/workflows/ci.yml`, `CLAUDE.md`, `src/main.tsx`, `src/app/App.tsx`, `src/app/theme.css`, `src/app/App.test.tsx`, `supabase/config.toml`(`supabase init`으로 생성)

**Interfaces:**
- Produces: npm 스크립트 `dev`, `build`, `test`(vitest run), `typecheck`(tsc --noEmit), `db:test`(supabase test db). `theme.css`의 CSS 토큰 `--bg #1c1030`, `--panel #2d2140`, `--card #ffffff`, `--ink #ffffff`, `--muted #a79cb8`, `--hit #5cc169`, `--near #e9a43c`, `--miss #97a3b8`, `--lime #c9f25c`.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/app/App.test.tsx`

```tsx
test('renders app shell title', () => {
  render(<App />)
  expect(screen.getByText('ONLYFMS')).toBeInTheDocument()
})
```

- [ ] **Step 2: 실패 확인** — `npm test` → FAIL (App 없음)
- [ ] **Step 3: 골격 구현**
  - Vite React TS 템플릿 기준. `tsconfig`에 `"allowImportingTsExtensions": true`, `"noEmit": true`, `"strict": true`를 둔다.
  - `vitest.config.ts`는 jsdom 환경이고, `src/**/*.test.ts(x)`와 `supabase/functions/play/engine.test.ts`를 포함한다.
  - `vercel.json`은 `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}`.
  - CI(`ci.yml`)는 push·PR에서 `npm ci && npm run typecheck && npm test`를 돈다.
  - `supabase init` 후 `config.toml`의 `auth.external.google.enabled = true`로 둔다. 키는 env 참조.
- [ ] **Step 4: CLAUDE.md 작성**: 스펙 §13의 항목을 그대로 옮긴다.
  - 폴더 규칙
  - 게임 추가 절차
  - 로직 버전 규칙
  - 커밋·PR 규칙: 브랜치 → PR → 미리보기 확인 → 머지
  - 금지 사항
  - 스펙·계획 문서 경로
- [ ] **Step 5: 통과 확인** — `npm test && npm run typecheck` → PASS
- [ ] **Step 6: Commit** — `git commit -m "chore: 프로젝트 골격, CI, CLAUDE.md"`

### Task 2: 공용 유틸 — KST 날짜와 시드 난수

**Files:**
- Create: `src/shared/kst.ts`, `src/shared/rng.ts`, `src/shared/kst.test.ts`, `src/shared/rng.test.ts`

**Interfaces:**
- Produces:
  - `kstDate(nowMs: number): string` — `'YYYY-MM-DD'`
  - `kstDayRange(date: string): { start: Date; end: Date }` — 00:00 KST 시작, 다음 날 00:00 KST 끝(배타)
  - `kstWeekStart(date: string): string` — 그 주 월요일
  - `hmacSeed(secret: string, message: string): Promise<Uint8Array>` — WebCrypto HMAC-SHA256
  - `rngFromSeed(seed: Uint8Array): () => number` — [0,1) 결정적 난수(sfc32 또는 mulberry32, 시드 앞 16바이트 사용)
  - 두 파일 모두 외부 의존 없음, Deno에서도 import 가능

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('kstDate switches at 00:00 KST', () => {
  expect(kstDate(Date.parse('2026-10-31T14:59:59Z'))).toBe('2026-10-31')
  expect(kstDate(Date.parse('2026-10-31T15:00:00Z'))).toBe('2026-11-01')
})
test('kstDayRange', () => {
  const r = kstDayRange('2026-11-01')
  expect(r.start.toISOString()).toBe('2026-10-31T15:00:00.000Z')
  expect(r.end.toISOString()).toBe('2026-11-01T15:00:00.000Z')
})
test('kstWeekStart is Monday', () => {
  expect(kstWeekStart('2026-11-01')).toBe('2026-10-26') // 일요일 → 그 주 월요일
  expect(kstWeekStart('2026-11-02')).toBe('2026-11-02')
})
test('rng is deterministic per seed and in [0,1)', async () => {
  const s = await hmacSeed('k', 'c:1:0')
  const a = rngFromSeed(s), b = rngFromSeed(s)
  const xs = Array.from({ length: 100 }, a)
  expect(xs).toEqual(Array.from({ length: 100 }, b))
  expect(xs.every(x => x >= 0 && x < 1)).toBe(true)
  expect(rngFromSeed(await hmacSeed('k', 'c:1:1'))()).not.toBe(xs[0])
})
```

- [ ] **Step 2: 실패 확인** — `npm test -- src/shared` → FAIL
- [ ] **Step 3: 구현** — `kst.ts`는 UTC+9 고정 오프셋으로 계산(한국은 서머타임 없음). `rng.ts`는 sfc32.
- [ ] **Step 4: 통과 확인** — `npm test -- src/shared` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: KST 날짜·시드 난수 공용 유틸"`

### Task 3: 게임 약속 타입, 등록부, 숫자 맞히기 로직

**Files:**
- Create: `src/games/types.ts`, `src/games/index.ts`, `src/games/number-guess/manifest.ts`, `src/games/number-guess/logic.ts`, `src/games/number-guess/logic.test.ts`, `src/games/registry.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `types.ts`: §4.2의 `Ctx`, `PlatformAction`, `GameLogic<Puzzle, Action, State, PublicState>`를 그대로 정의한다.
  - `Manifest` 타입: `{ id; name; description; hidden; modes: { daily; contest; free }; puzzleSource: 'generate' | 'bank'; options: { key; label; choices: { value; label }[]; default }[] }`
  - `GameModule = { manifest: Manifest; logic: GameLogic<any, any, any, any> }`
  - `index.ts`: `export const games: GameModule[]`, `getGame(id: string): GameModule | undefined`
  - number-guess 타입
    - `Puzzle = { range: 100 | 1000; answer: number }`
    - `Action = { type: 'guess'; value: number } | { type: 'hint' }`
    - `State = { guesses: number[]; feedback: ('up' | 'down' | 'hit')[]; hintUsed: boolean; parity: 'even' | 'odd' | null; gaveUp: boolean }`
    - `PublicState = State`. 정답은 `reveal`에서만 나간다.
  - number-guess 상수: `version = 1`, 최대 8번, `puzzleKey = "${range}:${answer}"`

- [ ] **Step 1: 실패하는 테스트 작성** — `logic.test.ts`

```ts
const ctx = { now: 0, startedAt: 0, deadline: null }
const P = { range: 100, answer: 42 } as const
test('pickPuzzle respects range option', () => {
  const p = logic.pickPuzzle(() => 0.999, { range: '1000' })
  expect(p.range).toBe(1000); expect(p.answer).toBeGreaterThanOrEqual(1); expect(p.answer).toBeLessThanOrEqual(1000)
})
test('feedback up/down/hit and finish', () => {
  let s = logic.initState(P, ctx)
  s = ok(logic.apply(P, s, { type: 'guess', value: 10 }, ctx)); expect(s.feedback.at(-1)).toBe('up')
  s = ok(logic.apply(P, s, { type: 'guess', value: 50 }, ctx)); expect(s.feedback.at(-1)).toBe('down')
  s = ok(logic.apply(P, s, { type: 'guess', value: 42 }, ctx)); expect(logic.isFinished(s, ctx)).toBe(true)
  expect(logic.score(s, ctx)).toBe(8) // 3번 만: 11-3
})
test('errors: out of range, repeated, after finish', () => {
  const s = ok(logic.apply(P, logic.initState(P, ctx), { type: 'guess', value: 7 }, ctx))
  expect(logic.apply(P, s, { type: 'guess', value: 0 }, ctx)).toHaveProperty('error')
  expect(logic.apply(P, s, { type: 'guess', value: 7 }, ctx)).toHaveProperty('error')
})
test('score bounds: 1st=10, 8th=3, fail=0, give_up=0, hint -1', () => { /* 각 경우 상태를 만들어 assert */ })
test('hint reveals parity once and costs 1 point', () => {
  let s = ok(logic.apply(P, logic.initState(P, ctx), { type: 'hint' }, ctx))
  expect(s.parity).toBe('even')
  expect(logic.apply(P, s, { type: 'hint' }, ctx)).toHaveProperty('error')
  s = ok(logic.apply(P, s, { type: 'guess', value: 42 }, ctx)); expect(logic.score(s, ctx)).toBe(9)
})
test('unfinished score equals give-up score (0)', () => {
  const s = ok(logic.apply(P, logic.initState(P, ctx), { type: 'guess', value: 1 }, ctx))
  expect(logic.score(s, ctx)).toBe(0)
})
test('8 misses finishes the game', () => { /* 8개 오답 후 isFinished true, 9번째 guess error */ })
test('actionCount counts guesses only', () => { /* hint는 세지 않음 */ })
```

`registry.test.ts`:

```ts
test('every game has unique id, valid id format, and options defaults in choices', () => { /* games 순회 */ })
```

- [ ] **Step 2: 실패 확인** — `npm test -- src/games` → FAIL
- [ ] **Step 3: 구현** — `types.ts`, `manifest.ts`(§4.1 값 그대로, `hidden: true`), `logic.ts`, `index.ts`. `logic.ts`의 import는 `../types.ts`처럼 확장자를 붙인다.
- [ ] **Step 4: 통과 확인** — `npm test -- src/games` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: 게임 약속 타입, 등록부, 숫자 맞히기 로직"`

### Task 4: DB — profiles, 승인제, 관리자 함수

**Files:**
- Create: `supabase/migrations/0001_profiles.sql`, `supabase/tests/01_profiles.test.sql`

**Interfaces:**
- Produces (SQL):
  - enum `user_status`, 표 `profiles`(§6)
  - 트리거 `on_auth_user_created`
  - 함수 `is_approved() returns boolean`, `is_admin() returns boolean`
  - `set_handle(new_handle text) returns text` — 정규화된 handle을 반환
  - `admin_list_users(p_status user_status) returns table(id uuid, handle citext, email text, status user_status, created_at timestamptz)`
  - `admin_set_status(p_user uuid, p_status user_status) returns void`
  - `admin_set_handle(p_user uuid, p_handle text) returns void`
  - 함수는 모두 `security definer set search_path = public`
  - 오류는 `raise exception using errcode = 'P0001', message = '<code>'`. message 코드는 `handle_taken`, `handle_invalid`, `handle_already_set`, `forbidden`, `cannot_change_self`

- [ ] **Step 1: 실패하는 pgTAP 테스트 작성** — 테스트 사용자 생성은 `auth.users` insert + `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>"}'` 패턴.
  - `trigger_creates_pending_profile`: auth.users insert 후 profiles.status = 'pending', handle is null
  - `set_handle_normalizes_case_and_trim`: `set_handle(' Kane ')` = 'kane'. 다른 사용자의 `set_handle('KANE')`은 `handle_taken`
  - `set_handle_rejects_invalid`: 'ab', '한글', 'a b', 17자 → `handle_invalid`
  - `set_handle_only_once`: 두 번째 호출 → `handle_already_set`
  - `profiles_direct_update_denied`: 본인 `update profiles set status='approved'` → 0행
  - `pending_cannot_read_others`, `approved_reads_only_public_columns_of_approved`
  - `admin_functions_forbidden_for_non_admin`
  - `admin_approve_sets_approved_at_and_by`
  - `admin_cannot_change_self`
  - `admin_list_users_returns_email`
- [ ] **Step 2: 실패 확인** — `supabase start && supabase test db` → FAIL
- [ ] **Step 3: 마이그레이션 구현**
  - `create extension if not exists citext;`
  - 공개 컬럼 제한은 RLS + 컬럼 권한(`revoke select on profiles from authenticated; grant select (id, handle, created_at) on profiles to authenticated`, 다른 행의 승인 여부는 RLS 정책 안에서 security definer 함수로 확인)으로 한다. 본인 전체 행 조회는 `my_profile()` 함수(반환: profiles 행)를 추가해 제공한다.
- [ ] **Step 4: 통과 확인** — `supabase test db` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(db): profiles, 승인제, 관리자 함수"`

### Task 5: DB — 대회·기록 테이블과 RLS

**Files:**
- Create: `supabase/migrations/0002_contests.sql`, `supabase/tests/02_contests_rls.test.sql`
- Modify: `src/games/registry.test.ts` (hidden 일치 테스트 추가)

**Interfaces:**
- Consumes: `is_approved()`, `is_admin()` (Task 4)
- Produces:
  - 표 `contests`, `contest_items`, `contest_entries`, `attempts`, `puzzle_bank`, `free_plays`, `hidden_games`(§6)
  - enum `contest_kind`, `contest_visibility`
  - 함수 `can_see_contest(p_contest uuid) returns boolean`
  - `free_plays`에 `client_id uuid not null unique` 추가(Review Focus 4). `hidden_games`에 `insert ... values ('number-guess')`
  - 클라이언트용 뷰 `contest_items_public`: 종료 전에는 puzzle·puzzle_key를 null로 가린다. `security_invoker = true`

- [ ] **Step 1: 실패하는 pgTAP 테스트 작성**
  - `pending_cannot_insert_free_play`, `approved_inserts_own_free_play`
  - `free_play_score_bounds`(10.1 거부)
  - `free_play_other_user_id_denied`
  - `free_play_duplicate_client_id_ignored`: `insert ... on conflict (client_id) do nothing`이 성공하고 행은 1개
  - `free_play_update_delete_denied`
  - `attempts_direct_insert_denied`
  - `others_attempts_hidden_until_contest_end`: 진행 중 대회에서 다른 사람의 finished attempt 조회 0행, 종료 후 1행
  - `puzzle_hidden_until_end`: 진행 중 `contest_items_public.puzzle is null`, 종료 후 값
  - `invite_contest_invisible_to_non_participant`
  - `hidden_game_rows_admin_only`
  - `puzzle_bank_admin_only`
- [ ] **Step 2: 실패 확인** — `supabase test db` → FAIL
- [ ] **Step 3: 마이그레이션 구현** — §7 표대로 정책을 작성한다. `contest_items` 원본 표는 authenticated에 select를 주지 않고, 뷰로만 노출한다.
- [ ] **Step 4: registry 일치 테스트 추가** — `registry.test.ts`에 `hidden games match hidden_games seed in migrations`를 추가한다: `supabase/migrations/*.sql`에서 `insert into hidden_games` 값 집합 == `games.filter(g => g.manifest.hidden).map(g => g.manifest.id)`. (Task 6 이후 같은 방식으로 `game_modes` 일치도 검사)
- [ ] **Step 5: 통과 확인** — `supabase test db && npm test` → PASS
- [ ] **Step 6: Commit** — `git commit -m "feat(db): 대회·기록 테이블과 RLS"`

### Task 6: DB — 대회 개설·참가·문제 은행 함수

**Files:**
- Create: `supabase/migrations/0003_contest_functions.sql`, `supabase/tests/03_contest_functions.test.sql`

**Interfaces:**
- Consumes: Task 4·5의 표·함수
- Produces:
  - 대회 개설·수정·취소·참가
    - `create_contest(p_title text, p_starts_at timestamptz, p_duration_min int, p_visibility contest_visibility, p_items jsonb, p_official boolean) returns table(id uuid, invite_code text)`
      - `p_items` 형식: `[{"game_id":"number-guess","options":{"range":"100"},"count":2}]`. count만큼 position 1..n으로 펼친다.
    - `update_contest(p_id uuid, p_title text, p_starts_at timestamptz, p_duration_min int, p_visibility contest_visibility, p_items jsonb) returns void`
    - `cancel_contest(p_id uuid) returns void`
    - `join_contest(p_id uuid, p_invite_code text default null) returns void`
  - 문제 은행
    - `admin_upload_puzzles(p_game text, p_puzzles jsonb) returns table(added int, skipped int)`
      - 각 원소는 `{"puzzle_key":"…","puzzle":{…}}`
    - `admin_bank_status() returns table(game_id text, remaining int)`
  - 내부 함수
    - `contest_games_allowed(p_items jsonb) returns boolean`. 허용 게임 목록은 표 `game_modes(game_id text pk, daily bool, contest bool, free bool)`로 관리하고, 이 마이그레이션에서 number-guess 행을 넣는다.
    - registry와 `game_modes`가 일치하는지는 Task 5의 registry 테스트를 확장해 검사한다.
  - 오류 코드: `title_invalid`, `start_too_soon`, `start_too_far`, `duration_invalid`, `items_invalid`, `game_not_allowed`, `official_forbidden`, `not_editable`, `invite_required`, `contest_closed`, `forbidden`

- [ ] **Step 1: 실패하는 pgTAP 테스트 작성**
  - `create_validations`: 제목 0자·41자, 시작 now+4분·now+31일, 제한 시간 4·181, 문제 0개·11개, contest 미지원 게임 → 각 코드
  - `friendly_by_approved_ok`, `official_by_non_admin_forbidden`
  - `invite_code_is_10_chars_and_only_for_invite`
  - `update_and_cancel_only_before_start_by_creator`, `admin_can_cancel_live`
  - `join_rejects_wrong_code_closed_cancelled`, `join_is_idempotent`
  - `upload_skips_duplicates`, `bank_status_counts_unused`
- [ ] **Step 2: 실패 확인** — `supabase test db` → FAIL
- [ ] **Step 3: 구현** — 초대 코드는 `[a-z0-9]` 10자 무작위, 충돌하면 다시 만든다. `p_official`이면 kind=`official`, 아니면 `friendly`. 개설자는 자동 참가.
- [ ] **Step 4: 통과 확인** — `supabase test db` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(db): 대회 개설·참가·문제 은행 함수"`

### Task 7: DB — 리더보드·통계 함수

**Files:**
- Create: `supabase/migrations/0004_leaderboards.sql`, `supabase/tests/04_leaderboards.test.sql`

**Interfaces:**
- Consumes: Task 4~6
- Produces (모두 `security definer`, 승인 사용자만, 취소 대회 제외, 비관리자에게 hidden_games 제외)
  - `lb_daily(p_day date, p_game text default null) returns table(rank int, user_id uuid, handle citext, score numeric, action_count int, finished_at timestamptz)`
  - `lb_range(p_from date, p_to date, p_game text default null)`: 위와 같은 열. daily + 종료된 official 포함
  - `lb_contest(p_contest uuid) returns table(rank int, user_id uuid, handle citext, score numeric, solved_items int, action_count int, last_finished_at timestamptz)`
  - `lb_contests(p_from date, p_to date) returns jsonb` — `{ "contests": [{ contest_id, title, ends_at, podium: [{ handle, score }] }], "totals": [{ user_id, handle, total }] }` (종료된 official만)
  - `lb_free(p_game text default null) returns table(user_id uuid, handle citext, plays int, wins int, win_rate numeric, current_streak int, best_streak int, avg_score numeric)`. p_game null이면 streak 열 null
  - `user_stats(p_handle text) returns jsonb`. 키: `daily_by_game`, `contests`, `free_by_game`, `recent`(30개)
  - 정렬: §9. win 판정은 `solved`

- [ ] **Step 1: 실패하는 pgTAP 테스트 작성** — 고정 시드 데이터로 사용자 3명, 데일리 2일, official 1개, friendly 1개, 취소 대회 1개를 넣는다.
  - `daily_rank_order_and_tiebreak`: 점수 같으면 action_count 적은 쪽, 그다음 finished_at 이른 쪽
  - `range_includes_official_excludes_friendly_and_cancelled`
  - `week_range_monday_start`
  - `contest_live_partial_scores_visible`: 진행 중 lb_contest가 점수·solved_items만 반환
  - `free_streaks`: 승패 시퀀스 W W L W W W → current 3, best 3
  - `hidden_game_excluded_for_non_admin`, `pending_user_forbidden`
- [ ] **Step 2: 실패 확인** — `supabase test db` → FAIL
- [ ] **Step 3: 구현** — 연속 정답은 윈도우 함수(실패 지점 누적 합으로 그룹화)로 계산한다.
- [ ] **Step 4: 통과 확인** — `supabase test db` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(db): 리더보드·통계 함수"`

### Task 8: Edge Function `play` — 출제·판정

**Files:**
- Create: `supabase/functions/play/registry.ts`, `engine.ts`, `engine.test.ts`, `db.ts`, `handler.ts`, `handler.test.ts`, `index.ts`, `supabase/functions/play/deno.json`

**Interfaces:**
- Consumes: `src/games/index.ts`의 `getGame`, `src/shared/kst.ts`, `src/shared/rng.ts`, Task 5~6 표
- Produces (HTTP): POST `/functions/v1/play`, JSON 본문
  - `{ action: 'daily', game_id }` → `{ contest_id, item_id }`
  - `{ action: 'open', item_id }` → `PlayView`
  - `{ action: 'act', item_id, expected_count: number, payload: Action | { type: 'give_up' } }` → `PlayView`
  - `PlayView = { item_id, contest_id, game_id, options, public_state, finished, score, action_count, ends_at, server_now, reveal?: unknown }`
  - 오류: `{ error: '<code>' }`
    - 400 `invalid_action`(메시지 포함)
    - 403 `forbidden` / `not_approved` / `not_joined`
    - 404 `unknown_game`
    - 409 `not_started` / `ended` / `finished` / `stale`(본문에 현재 `PlayView` 포함) / `version_changed`
  - `engine.ts` (순수, IO 없음)
    - `pickFresh(logic, options, seedFor: (retry: number) => Promise<Uint8Array>, recentKeys: Set<string>): Promise<{ puzzle: unknown; key: string; retries: number }>`
    - `step(logic, puzzle, state, action, ctx): { ok: true; state; finished: boolean; score: number; actionCount: number } | { ok: false; status: 400; error: string }`
  - `db.ts`: postgres.js(`SUPABASE_DB_URL`)로 트랜잭션 헬퍼 `withTx<T>(fn: (sql) => Promise<T>): Promise<T>`
- 인증: `Authorization` JWT를 supabase-js `auth.getUser()`로 확인한 뒤, `profiles.status = 'approved'`인지 본다.

- [ ] **Step 1: 로직 공유 확인 (스펙 §4.7)**
  - `registry.ts`에서 `import { getGame } from '../../../src/games/index.ts'` 한 줄만 둔 최소 함수를 만든다.
  - `supabase functions serve play`로 로컬 호출해 200을 확인한다.
  - 사람이 만든 Supabase 프로젝트에 `supabase functions deploy play`로 배포해 호출이 200인지 확인한다.
  - 실패하면 `scripts/sync-logic.mjs`(src/games/*/logic.ts, src/games/types.ts, src/shared/*.ts → `supabase/functions/_shared/` 복사)와 `npm run sync:logic`을 만들고, CI에 "복사본과 원본 동일" 검사를 추가한다. `registry.ts`의 import를 `_shared`로 바꾼다.
  - 결과(어느 방식인지)를 CLAUDE.md에 한 줄 기록한다.
- [ ] **Step 2: 실패하는 엔진 테스트 작성** — `engine.test.ts` (Vitest로 실행)

```ts
test('pickFresh avoids recent keys and stops at 20 retries', async () => { /* 고정 시드가 같은 키를 내도록 만든 가짜 logic으로 retries===20, 마지막 결과 반환 */ })
test('pickFresh returns first non-recent puzzle', async () => { /* recentKeys에 첫 결과 키 → retries===1 */ })
test('step returns error without changing state', () => { /* 범위 밖 guess → ok:false, status 400 */ })
test('step stores give-up score while unfinished', () => { /* 미완료 상태 score === logic.score(state) */ })
```

- [ ] **Step 3: 실패 확인 → 엔진 구현 → 통과** — `npm test -- supabase/functions/play/engine.test.ts`
- [ ] **Step 4: 실패하는 핸들러 통합 테스트 작성** — `handler.test.ts`(Deno). 로컬 Supabase에 테스트 사용자와 대회를 만들고 `handle(req, { now })`를 직접 호출한다. `now`는 주입 가능한 시계다.
  - `daily_creates_once_concurrently`: 동시에 `daily` 5번 → 같은 contest_id·item_id
  - `open_generates_puzzle_once_concurrently`: 동시에 `open` 5번 → contest_items.generated_at 1회, 같은 puzzle
  - `open_before_start_is_409_not_started`
  - `act_flow_to_finish_then_409_finished`
  - `duplicate_act_is_rejected_as_stale`: 같은 `expected_count`로 두 번 → 두 번째 409 `stale`, action_count 1
  - `act_after_daily_end_is_409`: now=23:59:59 KST 성공, 00:00:01 KST 409 `ended`
  - `act_after_contest_end_is_409_ended`
  - `version_mismatch_finalizes_and_409`: attempts.logic_version을 0으로 바꾸고 act → 409 `version_changed`, finished = true
  - `pending_user_403`, `not_joined_403`, `unknown_game_404`
  - `reveal_only_when_finished_or_ended`
  - `bank_source_takes_unused_and_marks_used`: 가짜 bank 게임을 테스트 레지스트리에 주입
- [ ] **Step 5: 실패 확인** — `deno test --allow-all supabase/functions/play/handler.test.ts` → FAIL
- [ ] **Step 6: 핸들러 구현** (§8)
  - 출제는 트랜잭션에서 `select … from contest_items where id=$1 for update`로 잠근다. puzzle이 null이면 다음을 한다.
    - generate 게임: `pickFresh`로 출제한다. recentKeys는 같은 게임의 60일 이내 contest_items.puzzle_key다.
    - bank 게임: `puzzle_bank`에서 미사용 행을 `order by puzzle_key` 기준으로 시드 인덱스로 고르고 `for update skip locked`, used_item_id를 기록한다.
  - 행동은 `attempts`를 `for update`로 잠근 뒤 처리한다.
    - `expected_count`가 다르면 409 stale.
    - 버전이 다르면 포기 처리 후 저장하고 409 version_changed.
  - `daily`는 `insert … on conflict (daily_key) do nothing returning`으로 대회를 만든다.
    - 대회: starts/ends = `kstDayRange`, title = `"${name} · ${date}"`
    - 문제 1개, options = 게임 기본값
  - `daily`와 `open`은 데일리 대회에서 `contest_entries`를 자동 생성한다.
- [ ] **Step 7: 통과 확인** — `deno test --allow-all supabase/functions/play/` → PASS
- [ ] **Step 8: Commit** — `git commit -m "feat(play): 출제·판정 Edge Function"`

### Task 9: 인증, 레이아웃, 가입·승인 화면

**Files:**
- Create: `src/lib/supabase.ts`, `src/lib/api.ts`, `src/app/routes.tsx`, `src/platform/auth/AuthProvider.tsx`, `Guard.tsx`, `LoginPage.tsx`, `WelcomePage.tsx`, `src/platform/auth/Guard.test.tsx`, `WelcomePage.test.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: Task 4 RPC(`my_profile`, `set_handle`), Task 8 HTTP
- Produces:
  - `useAuth(): { session: Session | null; profile: Profile | null; loading: boolean; refresh(): Promise<void> }`
  - `Profile = { id; handle: string | null; status: 'pending' | 'approved' | 'rejected'; is_admin: boolean }`
  - `<RequireApproved>`, `<RequireAdmin>` 가드
  - `api.ts`
    - `rpc<T>(name, args): Promise<T>`. 오류 시 `ApiError { code: string; status: number; body?: unknown }`를 던진다.
    - `play(body): Promise<PlayView>`
  - 레이아웃 헤더 링크: 게임 `/`, 대회 `/contests`, 리더보드 `/leaderboard`, 내 프로필 `/u/:handle`, 관리자 `/admin`(관리자만)

- [ ] **Step 1: 실패하는 테스트 작성** (supabase 모듈은 vi.mock)
  - `Guard.test.tsx`
    - `redirects_logged_out_to_login`
    - `pending_goes_to_welcome`
    - `approved_renders_child`
    - `non_admin_blocked_from_admin`
    - `invite_link_returns_after_approval`: `/join/abc`로 들어와 로그인하면 `redirect` 파라미터가 보존된다
  - `WelcomePage.test.tsx`
    - `shows_handle_form_when_null`
    - `client_validation_matches_regex`: 'ab' 버튼 비활성
    - `shows_server_error_handle_taken_in_korean`: "이미 쓰는 아이디예요"
    - `pending_message`, `rejected_message`
- [ ] **Step 2: 실패 확인** — `npm test -- src/platform/auth` → FAIL
- [ ] **Step 3: 구현** — 로그인은 `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/welcome' } })`. 레이아웃은 theme.css 토큰을 쓴다.
- [ ] **Step 4: 통과 확인** — `npm test -- src/platform/auth` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: 로그인, 가입·승인 화면, 라우트 가드"`

### Task 10: 게임 실행기 — 홈, 데일리, 자유 플레이, 숫자 맞히기 화면

**Files:**
- Create: `src/lib/serverTime.ts`, `src/platform/games/HomePage.tsx`, `PlayRunner.tsx`, `DailyPage.tsx`, `FreePage.tsx`, `freeQueue.ts`, `freeQueue.test.ts`, `PlayRunner.test.tsx`, `src/games/number-guess/Game.tsx`
- Modify: `src/games/types.ts` (`GameModule`에 `Game: React.ComponentType<GameProps>` 추가), `src/games/index.ts` (number-guess 모듈에 Game 연결)

**Interfaces:**
- Consumes: `games`, `getGame`, `api.play`, `rpc`
- Produces:
  - `GameProps = { publicState: unknown; finished: boolean; score: number | null; reveal?: unknown; busy: boolean; error: string | null; onAction(action: unknown): void; remainingMs: number | null }`
  - `<PlayRunner mode="server" itemId={string} />`: Edge Function 사용
  - `<PlayRunner mode="local" gameId options />`: 브라우저에서 `logic` 직접 실행. 끝나면 `freeQueue.submit`
  - `serverTime.ts`: `syncFromView(serverNow: number)`, `now(): number`
  - `freeQueue.ts`: `submit(row: FreePlayRow): Promise<void>`, `flush(): Promise<void>`
    - localStorage 키 `onlyfms:freeQueue`, 최대 50개(넘치면 가장 오래된 것부터 버림)
    - `FreePlayRow = { client_id; game_id; options; logic_version; solved; score; action_count; played_at }`

- [ ] **Step 1: 실패하는 테스트 작성**
  - `freeQueue.test.ts`
    - `queues_on_failure_and_flushes_later`
    - `caps_at_50_dropping_oldest`
    - `queue_resend_is_idempotent`: 같은 client_id로 두 번 flush하면 insert 호출에 동일 client_id가 들어가고, 서버 중복 무시를 가정해 큐가 비워짐
    - `localStorage_unavailable_does_not_throw`
  - `PlayRunner.test.tsx`
    - `server_mode_sends_expected_count`
    - `stale_409_replaces_state_with_server_view`
    - `network_error_shows_retry_and_does_not_advance`
    - `ended_409_navigates_to_results`
    - `version_changed_409_shows_notice`: "규칙이 바뀌어 이 문제는 종료됐어요"
    - `local_mode_submits_free_play_on_finish`
- [ ] **Step 2: 실패 확인** — `npm test -- src/platform/games` → FAIL
- [ ] **Step 3: 구현**
  - HomePage는 비숨김 게임(관리자는 전체) 카드에 오늘 데일리 완료 여부·점수를 표시한다: `lb_daily(today, game)` 결과의 본인 행(없으면 "아직 안 풀었어요"). 진행 중·곧 시작 대회 3개를 보여준다.
  - FreePage는 manifest.options 선택 UI를 가진다.
  - number-guess `Game.tsx`: 숫자 입력(모바일 숫자 키패드 `inputMode="numeric"`), 힌트 버튼, 포기 버튼(두 번 눌러 확인), 추측 목록, 피드백.
- [ ] **Step 4: 통과 확인** — `npm test` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: 게임 실행기, 데일리·자유 플레이, 숫자 맞히기 화면"`

### Task 11: 대회 화면

**Files:**
- Create: `src/platform/contests/validate.ts`, `validate.test.ts`, `ContestListPage.tsx`, `ContestNewPage.tsx`, `ContestPage.tsx`, `ContestItemPage.tsx`, `JoinPage.tsx`, `ContestPage.test.tsx`

**Interfaces:**
- Consumes: Task 6 RPC, Task 7 `lb_contest`, Task 10 `PlayRunner`, `serverTime.now`
- Produces:
  - `validateContest(input: ContestInput, nowMs: number): Record<string, string>`: 필드별 한국어 오류, 서버와 같은 규칙
  - `ContestInput = { title; startsAt: Date; durationMin; visibility; items: { game_id; options; count }[]; official }`

- [ ] **Step 1: 실패하는 테스트 작성**
  - `validate.test.ts`: Global Constraints의 경계값(5분/30일, 5/180분, 1~40자, 1~10문제) 각각 통과·실패
  - `ContestPage.test.tsx`
    - `lobby_shows_countdown_using_server_offset`
    - `live_polls_lb_contest_every_5s`: fake timers
    - `public_live_contest_autojoins_before_open`: `join_contest` 호출이 `play open`보다 먼저
    - `invite_contest_without_code_shows_join_required`
    - `ended_shows_results_and_answers`
    - `cancelled_shows_notice`
- [ ] **Step 2: 실패 확인** — `npm test -- src/platform/contests` → FAIL
- [ ] **Step 3: 구현**
  - 목록은 진행 중, 예정, 종료(최근 30일) 섹션으로 나누고 공식/친선 배지를 단다.
  - 개설 폼의 공식 체크박스는 관리자에게만 보인다. 초대 대회 생성 후 `/join/<code>` 링크 복사 버튼을 둔다(clipboard 실패 시 텍스트 선택).
  - 대회 페이지 상태는 서버 시각 기준으로 계산한다.
- [ ] **Step 4: 통과 확인** — `npm test` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: 대회 목록·개설·진행·결과 화면"`

### Task 12: 리더보드와 프로필 화면

**Files:**
- Create: `src/platform/leaderboard/LeaderboardPage.tsx`, `LeaderboardPage.test.tsx`, `src/platform/profile/ProfilePage.tsx`, `ProfilePage.test.tsx`

**Interfaces:**
- Consumes: Task 7 함수들, `kstDate`, `kstWeekStart`

- [ ] **Step 1: 실패하는 테스트 작성**
  - `tabs_call_right_rpc`
    - 오늘 → `lb_daily(today)`
    - 주간 → `lb_range(weekStart, today)`
    - 전체 → `lb_range('2000-01-01', today)`
    - 대회 → `lb_contests`
    - 자유 → `lb_free`
  - `game_filter_passes_game_id`
  - `free_tab_sort_toggle`
  - `streak_hidden_in_total_view`
  - `my_row_highlighted`
  - `profile_not_found_message`
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — `npm test -- src/platform/leaderboard src/platform/profile`
- [ ] **Step 3: Commit** — `git commit -m "feat: 리더보드·프로필 화면"`

### Task 13: 관리자 화면

**Files:**
- Create: `src/platform/admin/AdminPage.tsx`, `AdminPage.test.tsx`

**Interfaces:**
- Consumes: `admin_list_users`, `admin_set_status`, `admin_set_handle`, `cancel_contest`, `admin_upload_puzzles`, `admin_bank_status`

- [ ] **Step 1: 실패하는 테스트 작성**
  - `lists_pending_with_email`
  - `approve_and_reject_update_list`
  - `reject_requires_second_click`
  - `handle_edit_shows_server_error`
  - `upload_json_file_reports_added_and_skipped`
  - `invalid_json_shows_error_without_calling_rpc`
  - `bank_under_30_shows_warning`
  - `cancel_live_contest_requires_confirm`
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — `npm test -- src/platform/admin`
- [ ] **Step 3: Commit** — `git commit -m "feat: 관리자 화면"`

### Task 14: 배포와 전체 흐름 확인

**Files:**
- Modify: `CLAUDE.md`(배포 절차 섹션), `README.md`(로컬 실행 방법)

- [ ] **Step 1: 원격 DB와 함수 배포**
  - `supabase link --project-ref <ref> && supabase db push`
  - `supabase secrets set PLAY_SECRET=<32바이트 무작위>`
  - `supabase functions deploy play`
- [ ] **Step 2: Vercel 환경 변수 설정** — Vercel에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 넣고 PR 미리보기를 확인한다.
- [ ] **Step 3: 첫 관리자 지정** — 미리보기에서 관리자 계정으로 로그인하고 아이디를 정한 뒤, Supabase SQL 편집기에서 `update profiles set is_admin = true, status = 'approved' where handle = '<관리자 아이디>'`.
- [ ] **Step 4: 수동 확인 목록** — 미리보기 주소, 폰과 PC에서 확인한다. 각 항목에 결과를 체크한다.
  1. 두 번째 구글 계정 가입 → 대기 화면 → 관리자 승인 → 게임 목록 보임
  2. 비관리자에게 숫자 맞히기가 안 보이고, 관리자에게는 보임
  3. 데일리: 추측·힌트·포기·결과. 다른 기기에서 이어 풀기
  4. 오늘 탭에 두 계정 순위, 동점 처리
  5. 친선 대회(10분 뒤 시작, 5분) 개설 → 초대 링크로 두 번째 계정 참가 → 카운트다운 → 동시 풀이 → 5초 순위 갱신 → 종료 후 정답 공개, 누적 탭 미반영
  6. 공식 대회 같은 흐름 → 주간·전체·대회 탭 반영
  7. 자유 플레이를 비행기 모드에서 끝냄 → 온라인 복귀 후 자동 저장, 중복 없음
  8. 개발자 도구 네트워크 탭에서 진행 중인 데일리·대회 정답이 응답에 없는지 확인
- [ ] **Step 5: README·CLAUDE.md 갱신 후 Commit** — `git commit -m "docs: 배포 절차와 로컬 실행 방법"`
- [ ] **Step 6: main 머지** — PR 리뷰 후 머지. onlyfms.vercel.app이 새 사이트로 바뀐 것을 확인한다.

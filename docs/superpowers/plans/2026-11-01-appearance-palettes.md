# 계정별 화면 팔레트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 검증된 프리셋 팔레트 10개와 화면 모드(다크·라이트·시스템)를 골라 계정에 저장하고, 화면 색이 그에 따라 바뀐다. 기본 계정 화면은 지금과 같다.

**Architecture:** 팔레트 값은 `src/app/palettes.ts` 한 곳에 둔다. `src/app/appearance.ts`가 고른 조합을 `<html>`의 CSS 변수로 쓰고 `localStorage`에 캐시하며, `index.html` 인라인 스크립트가 첫 렌더 전에 캐시를 적용해 깜빡임을 막는다. 저장은 `profiles` 컬럼 2개와 `set_appearance` RPC.

**Tech Stack:** React 18 + Vite + TypeScript, Vitest + Testing Library(jsdom), Supabase Postgres + pgTAP.

**Spec:** `docs/superpowers/specs/2026-11-01-appearance-palettes-design.md`

## Global Constraints

- 기본값은 `palette = 'classic'`, `appearance = 'dark'`. 이 조합의 화면은 지금과 픽셀 단위로 같아야 한다 (`theme.css` `:root` 기존 값 불변).
- 팔레트 id: `classic, navy, claret, stadium, graphite, indigo, slate, mono, sand, ice` (이 순서). 모드 값: `dark, light, system`.
- 레이아웃·컴포넌트·크기·클래스 구조는 바꾸지 않는다. CSS 변경은 §3 사용처를 새 토큰으로 바꾸는 것과 `:root`에 새 토큰 기본값을 더하는 것뿐.
- 화면 문구는 한국어. 오류 코드 `appearance_invalid` → "화면 설정 값이 올바르지 않아요".
- 마이그레이션 번호 `0010_appearance.sql`.
- 커밋 메시지 `type: 내용` (한국어 가능), 끝에 아래 두 줄:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01T7oyVqA4dHNUAtGkBwBBxb`
- 각 태스크 커밋 전에 `npm test && npm run typecheck` 통과. 기준선: 150개 테스트 통과.
- 파일 읽기 테스트는 `registry.test.ts`처럼 Vite `?raw` import/`import.meta.glob`을 쓴다 (node `fs` 타입 없이).

## Review Focus

1. DB나 캐시에 알 수 없는 팔레트 id·모드가 들어 있음 (나중에 팔레트를 뺐을 때) → `classic`/`dark`로 취급하고 예외 없음. Task 3 테스트.
2. `localStorage`가 없거나 접근 시 예외 (Safari 개인 정보 보호 모드) → 색 적용은 되고 예외 없음. Task 3·4 테스트.
3. `window.matchMedia`가 없는 환경 → `system`은 다크로 취급 (기존 디자인 유지). Task 3 테스트.
4. 저장 응답 전에 다른 라디오를 연속 클릭 → 저장 중 라디오 비활성화로 요청이 겹치지 않음. Task 5 테스트.
5. 같은 기기에서 로그아웃 후 다른 계정 로그인 → 로그아웃 때는 색 유지, 새 프로필이 로드되면 그 계정 설정 적용. Task 3 테스트(`useAppearance`가 undefined면 아무것도 안 함).

---

### Task 1: DB 컬럼과 `set_appearance` RPC

**Files:**
- Create: `supabase/migrations/0010_appearance.sql`
- Create: `supabase/tests/06_appearance.test.sql`
- Modify: `src/lib/api.ts` (MESSAGES에 `appearance_invalid`)
- Modify: `src/platform/auth/AuthProvider.tsx` (`Profile` 타입)

**Interfaces:**
- Produces: `profiles.palette text not null default 'classic'`, `profiles.appearance text not null default 'dark'`, 각각 check 제약 (Global Constraints의 목록, 제약 이름 `profiles_palette_check`, `profiles_appearance_check`, SQL 안에서 `'classic', 'navy', …` 순서로 한 줄에 나열 — Task 2 테스트가 이 줄을 파싱한다).
- Produces: `public.set_appearance(p_palette text, p_appearance text) returns void`, security definer, `set search_path = public`. uid 없음/프로필 행 없음 → `P0001 forbidden`; 목록 밖·null → `P0001 appearance_invalid`. `revoke … from public, anon, authenticated` + `grant execute … to authenticated` (`0001_profiles.sql` 패턴).
- Produces: `Profile` 타입에 `palette?: string; appearance?: string` (옵션 — 기존 테스트 픽스처가 이 필드 없이 만든다).

- [ ] **Step 1: pgTAP 테스트 작성** — `06_appearance.test.sql`, `01_profiles.test.sql`의 사용자·`request.jwt.claims` 패턴을 따른다. 단언:
  - 새 프로필의 `palette`/`appearance`가 `'classic'`/`'dark'`
  - 사용자 A가 `set_appearance('navy','light')` 후 A 행은 `navy`/`light`, B 행은 그대로
  - `set_appearance('neon','dark')`, `set_appearance('navy','dim')`, `set_appearance(null,'dark')` 모두 `throws_ok … 'P0001', 'appearance_invalid'`
  - jwt 없이(익명) 호출 → `forbidden`
  - `authenticated` 역할의 `update public.profiles set palette = 'mono'` → `throws_ok` (권한 오류 `42501`)
- [ ] **Step 2: 실패 확인** — `npm run db:test`. `pg_prove`·pgTAP이 없으면 `apt-get install -y postgresql-16-pgtap libtap-parser-sourcehandler-pgtap-perl`를 한 번 시도한다. 설치가 안 되면 이 사실을 보고하고 Step 4도 같은 이유로 건너뛴다 (SQL 문법은 `psql`로 마이그레이션을 임시 DB에 적용해 확인: `scripts/db-lib.sh`의 `db_start`/`db_migrate`).
- [ ] **Step 3: 마이그레이션 작성** — 위 Interfaces 그대로. 파일 머리 주석 `-- 0010_appearance: 계정별 화면 팔레트 (설계 docs/superpowers/specs/2026-11-01-appearance-palettes-design.md)`.
- [ ] **Step 4: 통과 확인** — `npm run db:test` 전부 PASS (또는 Step 2의 대체 확인).
- [ ] **Step 5: TS 쪽** — MESSAGES에 `appearance_invalid: '화면 설정 값이 올바르지 않아요'`, `Profile`에 두 옵션 필드. `npm test && npm run typecheck` PASS.
- [ ] **Step 6: 커밋** — `feat: 계정별 화면 설정 컬럼과 set_appearance RPC`

### Task 2: 토큰 분리와 팔레트 표

**Files:**
- Create: `src/app/palettes.ts`, `src/app/palettes.test.ts`
- Modify: `src/app/theme.css`, `src/games/who-are-ya/wya.css`
- Modify: `docs/superpowers/specs/2026-10-31-onlyfms-platform-design.md` (§10 디자인 문장), `CLAUDE.md` (금지 사항 줄 + 팔레트 추가 절차)

**Interfaces:**
- Consumes: Task 1의 `0010_appearance.sql` check 목록.
- Produces (`src/app/palettes.ts`):
  - `export const PALETTE_IDS = ['classic','navy','claret','stadium','graphite','indigo','slate','mono','sand','ice'] as const`, `export type PaletteId`
  - `export const APPEARANCES = ['dark','light','system'] as const`, `export type Appearance`, `export type Mode = 'dark' | 'light'`
  - `export type TokenName = 'bg'|'panel'|'card'|'ink'|'muted'|'lime'|'onAccent'|'accentStrong'|'warnText'|'winText'|'loseText'|'hit'|'near'|'miss'`, `export type Tokens = Record<TokenName, string>`
  - `export const CSS_VAR: Record<TokenName, string>` — `bg:'--bg', panel:'--panel', card:'--card', ink:'--ink', muted:'--muted', lime:'--lime', onAccent:'--on-accent', accentStrong:'--accent-strong', warnText:'--warn-text', winText:'--win-text', loseText:'--lose-text', hit:'--hit', near:'--near', miss:'--miss'`
  - `export const PALETTES: Record<PaletteId, { name: string; dark: Tokens; light: Tokens }>`
  - `export function isPaletteId(x: unknown): x is PaletteId`, `export function isAppearance(x: unknown): x is Appearance`
  - `export function resolveTokens(id: string, mode: Mode): Tokens` — 알 수 없는 id는 `classic`.

**팔레트 값** (계산·검증 완료, 그대로 옮긴다):

| id (이름) | 모드 | bg | panel | ink | muted | lime | onAccent | accentStrong |
|---|---|---|---|---|---|---|---|---|
| `classic` (기본 보라) | dark | `#1c1030` | `#2d2140` | `#ffffff` | `#a79cb8` | `#c9f25c` | `#1c1030` | `#c9f25c` |
| `classic` (기본 보라) | light | `#f4f1fa` | `#ffffff` | `#1c1030` | `#5b4a78` | `#c9f25c` | `#1c1030` | `#4d6b00` |
| `navy` (미드나잇 네이비) | dark | `#0f1b2d` | `#1a2a42` | `#ffffff` | `#9fb0c8` | `#7cc4ff` | `#0f1b2d` | `#7cc4ff` |
| `navy` (미드나잇 네이비) | light | `#f1f4f9` | `#ffffff` | `#0f1b2d` | `#4a5a75` | `#1a5fb4` | `#ffffff` | `#1a5fb4` |
| `claret` (클라렛) | dark | `#2a0f1c` | `#3d1a2b` | `#ffffff` | `#c9a9b8` | `#95bfe5` | `#2a0f1c` | `#95bfe5` |
| `claret` (클라렛) | light | `#f8f1f4` | `#ffffff` | `#2a0f1c` | `#6b4a5a` | `#7a1e45` | `#ffffff` | `#7a1e45` |
| `stadium` (스타디움) | dark | `#10182a` | `#1b2540` | `#ffffff` | `#a3afc6` | `#8fb0ff` | `#10182a` | `#8fb0ff` |
| `stadium` (스타디움) | light | `#eef1f5` | `#ffffff` | `#10182a` | `#4a5670` | `#1f4fd1` | `#ffffff` | `#1f4fd1` |
| `graphite` (그래파이트) | dark | `#16161b` | `#23232b` | `#ffffff` | `#a6a6b8` | `#a99bff` | `#16161b` | `#a99bff` |
| `graphite` (그래파이트) | light | `#f2f2f5` | `#ffffff` | `#16161b` | `#55556a` | `#5b47d6` | `#ffffff` | `#5b47d6` |
| `indigo` (인디고) | dark | `#16123a` | `#241f52` | `#ffffff` | `#b3addb` | `#ff9ccf` | `#16123a` | `#ff9ccf` |
| `indigo` (인디고) | light | `#f3f2fb` | `#ffffff` | `#16123a` | `#575273` | `#b0306f` | `#ffffff` | `#b0306f` |
| `slate` (슬레이트) | dark | `#131a23` | `#1f2a37` | `#ffffff` | `#a3b2c4` | `#5fe0e6` | `#131a23` | `#5fe0e6` |
| `slate` (슬레이트) | light | `#eef2f6` | `#ffffff` | `#131a23` | `#4a5868` | `#0b6f7a` | `#ffffff` | `#0b6f7a` |
| `mono` (모노크롬) | dark | `#121417` | `#1e2125` | `#ffffff` | `#a9afb8` | `#ffffff` | `#121417` | `#ffffff` |
| `mono` (모노크롬) | light | `#f4f5f7` | `#ffffff` | `#121417` | `#555b64` | `#121417` | `#ffffff` | `#121417` |
| `sand` (샌드) | dark | `#221e18` | `#302a22` | `#ffffff` | `#c2b8a6` | `#a9bdf0` | `#221e18` | `#a9bdf0` |
| `sand` (샌드) | light | `#f5f1ea` | `#ffffff` | `#1d2433` | `#575e6e` | `#24408e` | `#ffffff` | `#24408e` |
| `ice` (아이스) | dark | `#1a1733` | `#26224a` | `#ffffff` | `#b1abd6` | `#b3a3ff` | `#1a1733` | `#b3a3ff` |
| `ice` (아이스) | light | `#f3f2fb` | `#ffffff` | `#1a1733` | `#575273` | `#5b3fd6` | `#ffffff` | `#5b3fd6` |

모든 팔레트 공통: `card: '#ffffff'`. 모든 **다크**: `warnText #e9a43c, winText #5cc169, loseText #ff8f7a, hit #5cc169, near #e9a43c, miss #97a3b8`. 모든 **라이트**: `warnText #9a5800, winText #2b7d39, loseText #c4271c, hit #2f8a3e, near #b06a00, miss #5d6878`.

**CSS 사용처 교체** (값이 `classic` 다크와 같으므로 기본 화면 불변):
- `theme.css :root`에 추가: `--on-accent: #1c1030; --accent-strong: #c9f25c; --warn-text: #e9a43c; --win-text: #5cc169; --lose-text: #ff8f7a;` 그리고 `--lime` 위에 주석 `/* 강조 채움색. 이름은 역사적 이유 — 팔레트마다 실제 색이 다르다 */`
- `color: var(--lime)` / `border-bottom-color: var(--lime)` → `var(--accent-strong)`: `.app-title`, `.nav a.active`(테두리), `.card-status`, `.ng-score`, `.countdown`, `.list-row a`, `.table tr.me td`, `wya.css .wya-score`
- `color: var(--bg)` on 강조 채움 → `var(--on-accent)`: `.btn-primary`, `.badge-official`
- `.badge-live` 글자 → `#1c1030` (초록 배지 위 고정, 주석 한 줄)
- `color: var(--near)` → `var(--warn-text)`: `.form-error`, `.notice`, `.ng-hint`
- `wya.css .wya-win` → `var(--win-text)`, `.wya-lose` `#ff8f7a` → `var(--lose-text)`
- 타일 배경(`--hit/--near/--miss` 사용)과 `.ng-row` 테두리, `wya.css` 카드 내부 하드코딩 색은 그대로.

- [ ] **Step 1: 실패 테스트 작성** — `src/app/palettes.test.ts`. 대비 함수는 테스트 안에 둔다 (WCAG: sRGB 채널 `c/255`, `c<=0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4`, `L=0.2126R+0.7152G+0.0722B`, `(L1+0.05)/(L2+0.05)`).
  - `palettes_meet_text_contrast`: 모든 id × 모드, `ink, muted, accentStrong, warnText, winText, loseText` 각각 `bg`·`panel` 대비 `>= 4.5`; `onAccent` 대 `lime` `>= 4.5`. 실패 메시지에 `id/mode/token/배경`과 값.
  - `light_tiles_visible_on_bg`: 라이트 모드 `hit, near, miss` 대 `bg` `>= 3`.
  - `classic_dark_matches_theme_css`: `import css from './theme.css?raw'`에서 `:root { … }` 블록의 `--x: #hex;`를 파싱해 `CSS_VAR` 14개 모두가 `PALETTES.classic.dark`와 같음.
  - `palette_ids_match_migration`: `import.meta.glob('../../supabase/migrations/*.sql', {query:'?raw', import:'default', eager:true})`에서 `profiles_palette_check` 제약의 문자열 목록을 뽑아 `[...PALETTE_IDS]`와 같음 (순서 포함).
  - `resolve_unknown_falls_back`: `resolveTokens('neon','dark')`가 `PALETTES.classic.dark`와 같음; `isPaletteId('navy') === true`, `isPaletteId('neon') === false`, `isAppearance('system') === true`, `isAppearance(null) === false`.
  - `no_text_use_of_fill_tokens`: `theme.css`와 `wya.css`(`../games/who-are-ya/wya.css?raw`)에 정규식 `/(^|[^-])color:\s*var\(--(lime|near|bg)\)/m` 매치가 없음 (`background`·`border` 제외 — 채움 토큰을 글자색으로 쓰는 자리가 남지 않았는지).
- [ ] **Step 2: 실패 확인** — `npx vitest run src/app/palettes.test.ts` → FAIL (모듈 없음).
- [ ] **Step 3: `palettes.ts` 작성, CSS 교체** — 위 Interfaces·값·교체 목록 그대로.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/app/palettes.test.ts` PASS, 이어서 `npm test && npm run typecheck` PASS (기존 150개 포함).
- [ ] **Step 5: 문서** — 플랫폼 설계 §10의 `- 디자인은 현재 Who Are Ya 페이지의 짙은 보라 배경 톤을 공통 스타일 토큰으로 가져온다. 모바일 우선이다.` → `- 디자인 기본은 Who Are Ya의 짙은 보라 톤이며 공통 스타일 토큰으로 쓴다. 계정별로 검증된 프리셋 팔레트(10개 × 다크·라이트)를 고를 수 있다 ([설계](2026-11-01-appearance-palettes-design.md)). 모바일 우선이다.` `CLAUDE.md` 금지 사항의 `짙은 보라 단일 테마` → `색은 theme.css·src/app/palettes.ts 토큰만 쓴다 (후알야 카드 내부·킷 색 예외)`; `## 데이터 갱신` 앞에 `## 팔레트 추가` 절: (1) `palettes.ts`에 다크·라이트 묶음 추가 (2) 새 마이그레이션으로 `profiles_palette_check` 목록 갱신 (3) `npm test`의 대비·목록 테스트 통과.
- [ ] **Step 6: 커밋** — `feat: 화면 토큰을 용도별로 나누고 검증된 팔레트 표 추가`

### Task 3: 적용 모듈 `appearance.ts`와 앱 연결

**Files:**
- Create: `src/app/appearance.ts`, `src/app/appearance.test.ts`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: Task 2의 `PALETTES`, `CSS_VAR`, `resolveTokens`, `isPaletteId`, `isAppearance`, `Mode`, `Appearance`.
- Produces (`src/app/appearance.ts`):
  - `export const CACHE_KEY = 'onlyfms.appearance.v1'`
  - 캐시 값 JSON: `{ appearance: 'dark'|'light'|'system', dark: Record<string,string>, light: Record<string,string> }` — 키는 CSS 변수 이름(`'--bg'` 등). Task 4 인라인 스크립트가 이 모양만 안다.
  - `export function resolveMode(appearance: Appearance): Mode` — `system`이면 `window.matchMedia?.('(prefers-color-scheme: dark)').matches`, matchMedia가 없으면 `'dark'`.
  - `export function applyAppearance(palette: string, appearance: string): void` — 알 수 없는 값은 `classic`/`dark`. `document.documentElement.style.setProperty`로 14개 변수, `meta[name="theme-color"]`의 `content`를 `bg`로, 캐시 쓰기(`try/catch`). `system`이면 모듈 수준 change 리스너 하나를 등록(이미 있으면 교체), 아니면 해제.
  - `export function useAppearance(palette: string | undefined, appearance: string | undefined): void` — 둘 다 undefined면 아무것도 안 함. 값이 바뀔 때 `applyAppearance`.
- Produces (`App.tsx`): `AuthProvider` 안에 `<AppearanceSync />`(같은 파일의 작은 컴포넌트, `useAuth().profile`의 두 필드로 `useAppearance` 호출) 를 `AppRoutes` 옆에 둔다.

- [ ] **Step 1: 실패 테스트 작성** — `appearance.test.ts` (각 테스트 전 `document.documentElement.removeAttribute('style')`, `localStorage.clear()`, `<meta name="theme-color">` 삽입; matchMedia는 `vi.stubGlobal`로 `{ matches, addEventListener, removeEventListener }` 가짜):
  - `applies_tokens_and_meta`: `applyAppearance('navy','light')` → `getPropertyValue('--bg') === '#f1f4f9'`, `'--accent-strong' === '#1a5fb4'`, `'--hit' === '#2f8a3e'`, meta content `#f1f4f9`
  - `writes_cache`: 위 호출 후 `JSON.parse(localStorage.getItem(CACHE_KEY))`의 `appearance === 'light'`, `dark['--bg'] === '#0f1b2d'`, `light['--bg'] === '#f1f4f9'`
  - `system_follows_media`: matches=true로 `applyAppearance('classic','system')` → `--bg #1c1030`; 등록된 change 리스너를 matches=false로 호출 → `--bg #f4f1fa`
  - `leaving_system_removes_listener`: `system` 후 `applyAppearance('classic','dark')` → `removeEventListener` 호출됨
  - `unknown_values_fall_back`: `applyAppearance('neon','dim')` → `--bg #1c1030` (classic dark), 예외 없음
  - `no_matchmedia_means_dark`: `vi.stubGlobal('matchMedia', undefined)` 후 `resolveMode('system') === 'dark'`
  - `storage_throws_is_ignored`: `localStorage.setItem`이 throw하도록 spy → `applyAppearance('navy','dark')`가 예외 없이 `--bg #0f1b2d` 적용
  - `hook_noop_without_profile`: `renderHook(() => useAppearance(undefined, undefined))` 후 `style.getPropertyValue('--bg') === ''`
- [ ] **Step 2: 실패 확인** — `npx vitest run src/app/appearance.test.ts` FAIL.
- [ ] **Step 3: 구현** — Interfaces 그대로. `App.tsx`에 `AppearanceSync`.
- [ ] **Step 4: 통과 확인** — 해당 파일 PASS, `npm test && npm run typecheck` PASS (`App.test.tsx` 포함).
- [ ] **Step 5: 커밋** — `feat: 계정 화면 설정을 CSS 변수로 적용하고 캐시`

### Task 4: 첫 렌더 전 캐시 적용 (깜빡임 방지)

**Files:**
- Modify: `index.html` (`<head>`, `theme-color` meta 다음에 인라인 `<script>`)
- Create: `src/app/bootstrap.test.ts`

**Interfaces:**
- Consumes: Task 3의 `CACHE_KEY`와 캐시 JSON 모양 (스크립트에는 키 문자열 `onlyfms.appearance.v1`을 직접 쓴다; 테스트가 `CACHE_KEY`와 같은지 확인).
- Produces: 없음 (자립 스크립트, 전역 변수를 남기지 않는 IIFE, 전체 `try/catch`).

동작: 캐시를 읽어 모드 결정(`appearance === 'system'`이면 `window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'`, matchMedia 없으면 `'dark'`) → 해당 묶음의 각 키·값을 `document.documentElement.style.setProperty` → `meta[name="theme-color"]` content를 `--bg`로. 값이 `#`로 시작하는 6자리 hex가 아니면 그 항목은 건너뛴다.

- [ ] **Step 1: 실패 테스트 작성** — `import html from '../../index.html?raw'`, `type="module"`·`src`가 없는 `<script>` 하나를 정규식으로 꺼내 `new Function(code)()`로 실행:
  - `script_exists_and_uses_cache_key`: 스크립트가 존재하고 `CACHE_KEY` 문자열을 포함
  - `applies_cached_light`: 캐시 `{appearance:'light', dark:{'--bg':'#0f1b2d'}, light:{'--bg':'#f1f4f9'}}` → `--bg #f1f4f9`, meta `#f1f4f9`
  - `system_uses_media`: `appearance:'system'`, matchMedia matches=true → `--bg #0f1b2d`
  - `no_cache_does_nothing`: 캐시 없음 → `--bg` 빈 문자열, 예외 없음
  - `broken_cache_does_nothing`: 캐시 `'{not json'` → 예외 없음, `--bg` 빈 문자열
  - `rejects_non_hex_values`: `light:{'--bg':'url(x)'}` → `--bg` 빈 문자열
- [ ] **Step 2: 실패 확인** — `npx vitest run src/app/bootstrap.test.ts` FAIL.
- [ ] **Step 3: 스크립트 작성** — 위 동작.
- [ ] **Step 4: 통과 확인** — 해당 파일 PASS, `npm test && npm run typecheck && npm run build` PASS (빌드 결과 `dist/index.html`에 스크립트가 남아 있는지 `grep -c "onlyfms.appearance.v1" dist/index.html` → 1).
- [ ] **Step 5: 커밋** — `feat: 첫 렌더 전에 저장된 화면 색 적용`

### Task 5: 설정 화면

**Files:**
- Create: `src/platform/profile/AppearanceSettings.tsx`, `src/platform/profile/AppearanceSettings.test.tsx`
- Modify: `src/platform/profile/ProfilePage.tsx` (내 프로필이면 맨 아래에 렌더), `src/platform/profile/ProfilePage.test.tsx` (필요 시 `useAuth` mock)

**Interfaces:**
- Consumes: `useAuth()`의 `profile`(`palette`, `appearance`, `handle`)과 `refresh()`; `rpc`, `ApiError`, `errorMessage` (`src/lib/api.ts`); Task 2의 `PALETTE_IDS`, `PALETTES`, `APPEARANCES`; Task 3의 `applyAppearance`, `resolveMode`.
- Produces: `export function AppearanceSettings(): JSX.Element`. `ProfilePage`는 `useAuth().profile?.handle === handle`일 때 `<AppearanceSettings />`를 마지막에 렌더.

화면(기존 클래스만): `<section className="stack" aria-labelledby=…>` 안에 `<h3 className="section-title">화면 설정</h3>`; `fieldset.field` legend `화면 모드`, `.radio` 3개 `시스템 설정 따르기`/`라이트`/`다크` (값 `system`/`light`/`dark`); `fieldset.field` legend `팔레트`, `.radio` 10개 — 레이블 텍스트는 `PALETTES[id].name`, 그 뒤에 `aria-hidden` 견본 `span` 3개(14px 원, `bg`·`panel`·`lime`, 현재 `resolveMode(appearance)` 기준 토큰, 인라인 style). 현재 값은 profile 값(없으면 `classic`/`dark`).

변경 흐름: 선택 → 로컬 상태 갱신 + `applyAppearance(new)` → `saving=true`(모든 라디오 `disabled`) → `rpc('set_appearance', { p_palette, p_appearance })` → 성공 `await refresh()`; 실패 시 로컬 상태와 `applyAppearance`를 이전 값으로 되돌리고 `<p className="form-error" role="alert">{errorMessage(code)}</p>` → `saving=false`.

- [ ] **Step 1: 실패 테스트 작성** — `AppearanceSettings.test.tsx` (`vi.mock('../../lib/api.ts')`의 `rpc`, `vi.mock('../auth/AuthProvider.tsx')`의 `useAuth`, `vi.mock('../../app/appearance.ts')`의 `applyAppearance`/`resolveMode`):
  - `renders_current_choice`: profile `{palette:'navy', appearance:'light'}` → `getByRole('radio', {name:'미드나잇 네이비'})` checked, `getByRole('radio', {name:'라이트'})` checked
  - `defaults_when_missing`: palette·appearance 없는 profile → `기본 보라`, `다크` checked
  - `pick_applies_and_saves`: `인디고` 클릭 → `applyAppearance('indigo','light')` 호출, `rpc('set_appearance', {p_palette:'indigo', p_appearance:'light'})` 호출, 이후 `refresh` 호출
  - `disabled_while_saving`: rpc가 미해결 promise를 반환하는 동안 모든 라디오 `disabled`
  - `failure_reverts_and_alerts`: rpc가 `new ApiError('appearance_invalid', 400)`로 reject → `applyAppearance`가 마지막으로 `('navy','light')`로 호출, `navy` 다시 checked, `role="alert"`에 `화면 설정 값이 올바르지 않아요`
  - `ProfilePage.test.tsx`에 `settings_only_on_own_profile`: useAuth profile handle `kane`일 때 `/u/kane`에는 `화면 설정` heading이 있고 `/u/other`에는 없다
- [ ] **Step 2: 실패 확인** — `npx vitest run src/platform/profile` FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces와 흐름.
- [ ] **Step 4: 통과 확인** — `npm test && npm run typecheck && npm run build` 전부 PASS.
- [ ] **Step 5: 커밋** — `feat: 내 프로필에 화면 설정(팔레트·모드) 추가`

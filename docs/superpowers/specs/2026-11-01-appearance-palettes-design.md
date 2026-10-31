# 계정별 화면 팔레트 설계

- 날짜: 2026-11-01
- 범위: 사용자가 검증된 프리셋 팔레트와 화면 모드(다크·라이트·시스템)를 골라 계정에 저장한다. 레이아웃·컴포넌트·크기는 바꾸지 않는다.

## 1. 목표와 성공 기준

1. 아무것도 고르지 않은 계정의 화면은 지금과 한 픽셀도 다르지 않다 (기본 `classic` + `dark`).
2. 선택은 계정에 저장되어 다른 기기에서도 같다.
3. 새로고침 때 기본색이 비쳤다 바뀌는 깜빡임이 없다 (같은 기기에서 이미 한 번 적용된 경우).
4. 10개 팔레트 × 다크·라이트 = 20개 조합이 모두 §4 대비 기준을 통과하고, 이를 자동 테스트가 보장한다.

범위 밖: 색 직접 입력, 다른 사용자에게 내 색 보이기, HIG 개선안(하단 탭바·액션 시트 등), 기존 다크 결과 타일의 흰 숫자 대비 개선.

## 2. 데이터와 DB (마이그레이션 `0010_appearance.sql`)

- `profiles`에 컬럼 추가
  - `palette text not null default 'classic'`, check: `classic, navy, claret, stadium, graphite, indigo, slate, mono, sand, ice`
  - `appearance text not null default 'dark'`, check: `dark, light, system`
- 쓰기: `set_appearance(p_palette text, p_appearance text) returns void`, `security definer`, `search_path = public`
  - `auth.uid()`가 없거나 프로필 행이 없으면 `P0001 forbidden`
  - 허용 목록 밖(또는 null)이면 `P0001 appearance_invalid`
  - 승인 상태는 따지지 않는다 (설정 화면은 승인 사용자에게만 보인다)
  - `revoke ... from public, anon, authenticated` 후 `grant execute ... to authenticated` (기존 함수와 같은 패턴)
- 읽기: `my_profile()`은 `select p.*`라 새 컬럼이 자동 포함된다. 다른 사용자의 팔레트는 노출하지 않는다 (컬럼 select 권한 추가 없음).
- 번호: main은 `0008`까지, `feat/duel`이 `0008_yacht`·`0009_duel`을 쓰므로 `0010`을 쓴다.
- 오류 문구: `appearance_invalid` → "화면 설정 값이 올바르지 않아요" (`src/lib/api.ts` MESSAGES).

## 3. 토큰

지금 CSS는 한 변수를 채움과 글자에 함께 쓴다 (`--lime`을 버튼 채움과 강조 글자에, `--near`를 타일과 오류 글자에, `--bg`를 배경과 강조 위 글자에). 라이트 팔레트에서는 이 겸용이 대비를 깨므로 용도별로 나눈다. 새 토큰의 기본값은 지금 값과 같아 `classic` 다크는 변하지 않는다.

| 토큰 | 용도 | `classic` 다크 |
|---|---|---|
| `--bg` | 페이지 배경, 입력창 배경 | `#1c1030` |
| `--panel` | 카드·헤더·행 배경 | `#2d2140` |
| `--card` | 후알야 흰 카드 (모든 팔레트 `#ffffff`) | `#ffffff` |
| `--ink` | 본문 | `#ffffff` |
| `--muted` | 보조 글자, 고스트 버튼 테두리 | `#a79cb8` |
| `--lime` | 강조 **채움** (주 버튼, 공식 배지). 이름은 역사적 이유로 유지 | `#c9f25c` |
| `--on-accent` (신규) | 강조 채움 위 글자 | `#1c1030` |
| `--accent-strong` (신규) | 강조 **글자·선** (앱 제목, 상태 글자, 카운트다운, 탭 밑줄, 내 순위 행, 점수) | `#c9f25c` |
| `--warn-text` (신규) | 오류·안내 글자 (`.form-error`, `.notice`, `.ng-hint`) | `#e9a43c` |
| `--win-text` (신규) | 후알야 정답 문구 | `#5cc169` |
| `--lose-text` (신규) | 후알야 오답 문구 | `#ff8f7a` |
| `--hit` `--near` `--miss` | 결과 타일 | `#5cc169` `#e9a43c` `#97a3b8` |

- 결과 타일: 모든 팔레트의 **다크** 모드는 지금 색, **라이트** 모드는 같은 계열의 진한 톤 `#2f8a3e` `#b06a00` `#5d6878`. 색의 의미(일치·근접·다름)는 같다.
- `.badge-live` 글자는 초록 배지 위 `#1c1030` 고정 (지금 `var(--bg)`, 라이트에서 깨짐).
- `wya.css` 카드 내부 색(`--wya-card-ink` 등, 흰 카드 안)은 바꾸지 않는다.
- CSS 변경은 위 사용처를 새 토큰으로 바꾸는 것뿐이고, `theme.css` `:root`에 새 토큰의 기본값을 추가한다.

## 4. 팔레트 표와 대비 기준

- `src/app/palettes.ts`: `PALETTE_IDS`, 팔레트마다 한국어 이름과 `dark`·`light` 토큰 묶음(§3의 14개), `resolveTokens(id, mode)`.
- 팔레트(이름): `classic` 기본 보라, `navy` 미드나잇 네이비, `claret` 클라렛, `stadium` 스타디움, `graphite` 그래파이트, `indigo` 인디고, `slate` 슬레이트, `mono` 모노크롬, `sand` 샌드, `ice` 아이스. 강조색은 결과 타일·오류색과 겹치지 않게 파랑·청록·보라·분홍·무채색 계열에서 고른다.
- `classic` 다크 값은 `theme.css` `:root`와 같아야 한다.
- 대비 기준(WCAG 상대 휘도 공식), 20개 조합 전부:
  - `--ink`, `--muted`, `--accent-strong`, `--warn-text`, `--win-text`, `--lose-text`: `--bg`와 `--panel` 양쪽 대비 4.5:1 이상
  - `--on-accent` 대 `--lime`: 4.5:1 이상
  - `--hit`, `--near`, `--miss` 대 `--bg`: 3:1 이상 — 단 `classic` 다크를 포함한 모든 다크 모드의 타일은 기존 디자인 값이므로 이 항목은 라이트 모드에만 적용한다
- 예외: 기존 다크 타일 위 흰 숫자(2.1–2.6:1)는 검사하지 않는다 (범위 밖).

## 5. 적용 흐름

- `src/app/appearance.ts`
  - `applyAppearance(palette, appearance)`: 모드 결정(`system`이면 `matchMedia('(prefers-color-scheme: dark)')`) → `document.documentElement.style`에 변수 14개 → `<meta name="theme-color">`를 `--bg`로 → `localStorage`에 캐시. 알 수 없는 id는 `classic`으로 취급한다.
  - `system`일 때만 `matchMedia` change 리스너를 걸고, 다른 값으로 바뀌면 해제한다.
  - 캐시 키 `onlyfms.appearance.v1`, 값 `{ appearance, dark: {변수}, light: {변수} }`. 읽기·쓰기는 `try/catch`.
- `useAppearance()` 훅: `App.tsx`의 `AuthProvider` 안에서 `profile`의 두 값이 바뀔 때 `applyAppearance` 호출. 프로필이 없으면(로그아웃) 아무것도 하지 않는다 — 캐시와 현재 색을 유지한다.
- 깜빡임 방지: `index.html` `<head>`의 인라인 스크립트가 첫 렌더 전에 캐시를 읽어 모드를 정하고 변수를 적용한다. 캐시가 없거나 깨지면 아무것도 하지 않는다 (`theme.css` 기본값). 팔레트 표는 넣지 않는다.

## 6. 설정 화면

- `src/platform/profile/AppearanceSettings.tsx`, `ProfilePage`에서 `profile?.handle === handle`일 때 맨 아래에 렌더.
- 기존 클래스만 쓴다: `.section-title` "화면 설정", `fieldset.field` + `.radio`.
  - 화면 모드: 시스템 설정 따르기 / 라이트 / 다크
  - 팔레트: 라디오 10개, 이름 옆에 14px 원형 견본 3개(`--bg`·`--panel`·`--lime`, 현재 적용 모드 기준, `aria-hidden`)
- 고르면 즉시 `applyAppearance`(미리보기) → `set_appearance` → 성공 시 `refresh()`, 실패 시 이전 값으로 되돌리고 `.form-error`(`role="alert"`)로 문구. 저장 중에는 라디오 비활성화. 별도 저장 버튼 없음.

## 7. 테스트

- Vitest
  - `palettes.test.ts`: §4 대비 기준 20개 조합, `classic` 다크와 `theme.css` `:root` 일치, `PALETTE_IDS`와 `0010_appearance.sql` check 목록 일치
  - `appearance.test.ts`: 변수·`theme-color`·캐시 쓰기, `system`의 matchMedia 추종과 리스너 해제, 깨진 캐시 무시, 알 수 없는 id
  - 인라인 스크립트: `index.html`에서 스크립트를 꺼내 jsdom에서 실행 — 캐시 적용, 캐시 없음·깨짐 무시
  - `AppearanceSettings.test.tsx`: 내 프로필에서만 보임, 선택 즉시 적용 + RPC 호출, 실패 시 되돌림과 오류 문구
- pgTAP `supabase/tests/06_appearance.test.sql`: 기본값, 본인 행만 변경, `appearance_invalid`, 미로그인 `forbidden`, 직접 update 차단

## 8. 문서 변경

- 플랫폼 설계 §10 "짙은 보라 배경 톤" → 기본은 짙은 보라, 계정별 프리셋 팔레트(10개 × 다크·라이트) 선택 가능, 이 문서 링크.
- `CLAUDE.md` 금지 사항 "짙은 보라 단일 테마" → "색은 `theme.css`·`src/app/palettes.ts` 토큰만 쓴다(하드코딩 금지, 후알야 카드 내부·킷 색 예외)". 팔레트 추가 절차: `palettes.ts`에 다크·라이트 묶음 추가 → 새 마이그레이션으로 check 목록 갱신 → `npm test`(대비·목록 테스트).

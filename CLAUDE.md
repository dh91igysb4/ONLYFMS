# ONLYFMS 작업 규칙

두 개발자와 각자의 Claude가 공통으로 따른다. 설계·계획 문서가 먼저이고, 이 파일은 요약이다.

- 설계: `docs/superpowers/specs/2026-10-31-onlyfms-platform-design.md`
- 계획: `docs/superpowers/plans/` (구현 계획)

## 폴더 규칙
- `src/app/` 라우팅·레이아웃·공통 스타일 토큰(`theme.css`)
- `src/lib/supabase.ts` supabase 클라이언트
- `src/platform/{auth,games,contests,leaderboard,profile,admin}/` 플랫폼 화면. 게임별 코드는 두지 않는다.
- `src/games/index.ts` 게임 등록부. `src/games/<game-id>/` 에 `manifest.ts`, `logic.ts`, `logic.test.ts`, `Game.tsx`
- `supabase/migrations/` 스키마·RLS·함수, `supabase/tests/` DB 테스트, `supabase/functions/play/` 출제·판정 Edge Function

## 게임 추가 절차
1. `src/games/<game-id>/` 폴더 생성 (id는 영문 소문자·숫자·`-`)
2. `manifest.ts`, `logic.ts`, `logic.test.ts`, `Game.tsx` 작성 (테스트 먼저)
3. `src/games/index.ts` 등록부에 한 줄 추가
4. `hidden: true`로 PR 머지 → 미리보기·운영에서 관리자 확인
5. 문제없으면 `hidden`을 풀어 공개

## 로직 버전 규칙
- 버전은 `src/games/<game-id>/logic.ts`의 `logic.version`이다 (manifest 아님). 설계 §4.5 기준.
- 판정·채점·문제 선택 결과가 달라지는 변경은 `logic.version`을 올린다. 불확실하면 올린다.
- 출제 당시 버전이 데일리·대회 기록(`contest_items`, `attempts`)과 `free_plays`에 저장된다.
- 진행 중 기록의 버전이 현재와 다르면 서버가 그 기록을 그 시점 점수로 확정(포기 처리)하고 409 `version_changed`를 돌려준다. 화면에는 "규칙이 바뀌어 이 문제는 종료됐어요"가 뜬다.
- 그래서 규칙 변경은 진행 중인 데일리가 적은 새벽(KST)에 배포한다.
- `logic.ts`는 순수 함수만, 외부 의존 없음. 상대 import에는 `.ts` 확장자를 명시한다 (Deno 호환).

## 커밋·PR 규칙
- main은 보호 브랜치. 작업 브랜치 → PR → Vercel 미리보기 확인 → 머지.
- 커밋 메시지는 `type: 내용` 형식(`feat`, `fix`, `chore`, `docs`, `test`), 한국어 가능.
- 푸시 전에 `npm test && npm run typecheck && npm run build`.
- DB 변경은 `supabase/migrations/` 마이그레이션 파일로만. 대시보드에서 스키마를 직접 바꾸지 않는다.

## 금지 사항
- 비밀값 커밋 금지 (`.env`, `.env.local`, 키, `PLAY_SECRET`). 예시는 `.env.example`만.
- 플랫폼 코드에 게임별 분기 금지. 게임마다 다른 점은 manifest·등록부로 푼다.
- 모든 화면 문구는 한국어, 모바일 우선, 짙은 보라 단일 테마.

## 비밀값 위치
- Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (공개용 키)
- Supabase Edge Function 시크릿: `PLAY_SECRET`

## 개발 환경
- `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`
- DB 테스트: `npm run db:test` (`scripts/db-test.sh`, 로컬 Postgres + Supabase shim). Docker가 있는 머신에서는 로컬 스택에 `npx supabase test db`가 동일한 역할이다.
- Deno는 이 클라우드 환경에서 npm으로만 쓸 수 있다 (`npx deno` 또는 로컬 설치). Deno 코드(Edge Function)의 import는 상대 경로 또는 `npm:` 지정자만 쓴다 (jsr, deno.land 금지).

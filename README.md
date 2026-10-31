# ONLYFMS

축구 퀴즈 게임 플랫폼. 구글 로그인 후 관리자 승인을 받으면 데일리 퀴즈, 자유 플레이, 친선·공식 대회와 리더보드를 쓸 수 있다. 게임은 등록부에 모듈로 추가하는 방식이고, 정답은 서버(Edge Function)에서만 판정한다.

## 스택
React 18 + Vite + TypeScript, react-router, Supabase(Auth, Postgres + RLS, Edge Function `play` on Deno), Vercel, 테스트는 Vitest·pgTAP·`deno test`.

## 로컬 실행
```bash
npm ci
cp .env.example .env.local   # VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY 채우기
npm run dev
```

## 테스트
```bash
npm test             # 단위·컴포넌트 (Vitest)
npm run typecheck
npm run db:test      # 필요: Postgres 16, pgTAP, pg_prove
npm run fn:test      # 필요: Postgres 16, Deno 2 (임시 DB를 띄웠다 내림)
```

## 폴더
- `src/app/` 라우팅·레이아웃·테마
- `src/platform/` 플랫폼 화면 (auth, games, contests, leaderboard, profile, admin)
- `src/games/` 게임 등록부(`index.ts`, `ui.ts`)와 게임별 폴더
- `src/lib/` supabase 클라이언트
- `supabase/migrations/`, `supabase/tests/`, `supabase/functions/play/`
- `scripts/` DB·함수 테스트 스크립트

## 문서
- 설계: [docs/superpowers/specs/2026-10-31-onlyfms-platform-design.md](docs/superpowers/specs/2026-10-31-onlyfms-platform-design.md)
- 계획: [docs/superpowers/plans/2026-10-31-onlyfms-platform.md](docs/superpowers/plans/2026-10-31-onlyfms-platform.md)
- 배포: [docs/deploy-checklist.md](docs/deploy-checklist.md)
- 작업 규칙: [CLAUDE.md](CLAUDE.md)

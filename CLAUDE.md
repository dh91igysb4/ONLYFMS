# ONLYFMS 작업 규칙

두 개발자와 각자의 Claude가 공통으로 따른다. 설계·계획 문서가 먼저이고, 이 파일은 요약이다.

- 설계: `docs/superpowers/specs/2026-10-31-onlyfms-platform-design.md`
- 계획: `docs/superpowers/plans/` (구현 계획)

## 폴더 규칙
- `src/app/` 라우팅·레이아웃·공통 스타일 토큰(`theme.css`)
- `src/lib/supabase.ts` supabase 클라이언트
- `src/platform/{auth,games,contests,duel,leaderboard,profile,admin,chat}/` 플랫폼 화면. 게임별 코드는 두지 않는다.
- `src/games/index.ts` 게임 등록부(Deno Edge Function이 import하므로 React 등 화면 코드를 import하지 않는다). `src/games/ui.ts` 화면 컴포넌트 등록(`getGameComponent`). `src/games/<game-id>/` 에 `manifest.ts`, `logic.ts`, `logic.test.ts`, `Game.tsx`
- `src/test-fixtures/` 테스트 전용 게임(`test-guess`, 숫자 맞히기)과 등록부 래퍼. 운영 등록부에 넣지 않는다. 플랫폼 테스트는 `vi.mock`으로 `withTestGame`/`withTestGameUi`를 끼워 쓴다
- `src/platform/games/freeLogQueue.ts` + 테이블 `free_play_logs`: 자유 플레이의 시드와 행동 기록. `free_plays` 행 저장 뒤에 올린다
- `src/platform/chat/` 데일리 채팅(데이터 계층·화면). 권한은 화면이 아니라 DB `can_chat`(RLS·RPC·Storage 정책)이 정한다. 사진은 비공개 Storage 버킷 `daily-chat`에 올리고 서명 주소로만 연다
- `supabase/migrations/` 스키마·RLS·함수, `supabase/tests/` DB 테스트, `supabase/functions/play/` 출제·판정 Edge Function, `supabase/functions/duel/` 1대1 대전 Edge Function, `supabase/functions/_shared/` 두 함수가 함께 쓰는 코드(`db.ts`)

## 게임 추가 절차
1. `src/games/<game-id>/` 폴더 생성 (id는 영문 소문자·숫자·`-`)
2. `manifest.ts`, `logic.ts`, `logic.test.ts`, `Game.tsx` 작성 (테스트 먼저)
3. `src/games/index.ts` 등록부에 한 줄 추가, 화면 컴포넌트는 `src/games/ui.ts`(`getGameComponent`)에 등록 (`index.ts`에 넣지 않는다)
4. 새 마이그레이션(`npx supabase@2 migration new`)으로 `game_modes` 행과, 숨김 게임이면 `hidden_games` 행을 추가 (등록부 테스트 `registry.test.ts`와 일치해야 한다)
5. `hidden: true`로 PR 머지 → 미리보기·운영에서 관리자 확인
6. 문제없으면 `hidden`을 풀어 공개

점수로 겨루는 게임은 manifest에 `freeStats: 'score'`를 둔다. 자유 플레이 리더보드가 플레이·평균·최고만 보여 주고 최고 점수 순으로 고정되며, 홈 블록도 최고 점수를 보여 준다.

대전(1대1) 게임은 다음이 다르다 (설계 `docs/superpowers/specs/2026-11-01-duel-platform-design.md`):
- manifest에 `category: 'duel'`, `modes`는 모두 false, `duel: { turnSeconds, sameScreen }`. 로직은 `DuelLogic`(`src/games/types.ts`).
- 등록은 `src/games/index.ts`의 `duels`, 화면은 `src/games/ui.ts`의 `getDuelComponent`(`DuelGameProps`).
- 마이그레이션에 `game_modes` (false, false, false) 행과 숨김이면 `hidden_games` 행.
- `timeoutAction`은 아직 보이지 않은 무작위 결과에 기대지 않는 "다음 행동 하나"를 돌려준다. 서버가 턴이 넘어갈 때까지 반복 호출한다.

## 로직 버전 규칙
- 버전은 `src/games/<game-id>/logic.ts`의 `logic.version`이다 (manifest 아님). 설계 §4.5 기준.
- 판정·채점·문제 선택 결과가 달라지는 변경은 `logic.version`을 올린다. 불확실하면 올린다.
- 출제 당시 버전이 데일리·대회 기록(`contest_items`, `attempts`)과 `free_plays`에 저장된다.
- 진행 중 기록의 버전이 현재와 다르면 서버가 그 기록을 그 시점 점수로 확정(포기 처리)하고 409 `version_changed`를 돌려준다. 화면에는 "규칙이 바뀌어 이 문제는 종료됐어요"가 뜬다.
- 새 버전은 이전 버전이 출제한 퍼즐 형식도 읽을 수 있어야 한다 (출제 후 배포된 규칙으로 늦게 시작한 사람이 풀 수 있음). 설계 §4.2, §4.5.
- 규칙 변경은 진행 중인 데일리가 적은 새벽(KST)에 배포하는 것을 권장한다.
- `logic.ts`는 순수 함수만, 외부 의존 없음. 상대 import에는 `.ts` 확장자를 명시한다 (Deno 호환).

## 팔레트 추가
1. `src/app/palettes.ts`에 다크·라이트 묶음을 추가한다.
2. 새 마이그레이션으로 `profiles_palette_check` 목록을 갱신한다.
3. `npm test`의 대비·목록 테스트가 통과해야 한다.

## 데이터 갱신 (후알야 `who-are-ya`)
1. FotMob 스쿼드를 다시 수집해 `data/fotmob_squads.json`을 바꾼다.
2. `python3 scripts/build-wya-data.py` → `src/games/who-are-ya/data.ts` 재생성 (직접 고치지 않는다).
   - '쉬움'은 시장가치 3,000만 유로 이상이 기본이고, `scripts/wya_easy.py`의 수동 명단(`EASY_IN`: 값은 낮아도 축구팬이면 알 만한 선수, `EASY_OUT`: 값만 높고 덜 알려진 선수. 경계 예시는 파일 머리말)으로 바로잡는다. 갱신 때 새로 3,000만을 넘긴 선수와 이적·은퇴를 보고 명단을 함께 고친다.
3. 출제 풀·판정이 바뀌므로 `src/games/who-are-ya/logic.ts`의 `logic.version`을 올린다.
4. `npm test && npm run typecheck && npm run build` 후 PR → 진행 중 데일리가 적은 새벽(KST)에 배포.
5. `play` Edge Function을 다시 배포한다 (`npx supabase@2 functions deploy play --no-verify-jwt`, `docs/deploy-checklist.md` §3). 함수가 data.ts를 함께 번들하므로 Vercel만 배포하면 서버 판정은 옛 데이터로 남는다.

## 배포
- 원격 배포 절차(DB push, 함수, Vercel, 첫 관리자, 수동 확인, 머지)는 `docs/deploy-checklist.md`를 따른다.

## 커밋·PR 규칙
- main은 보호 브랜치. 작업 브랜치 → PR → Vercel 미리보기 확인 → 머지.
- 커밋 메시지는 `type: 내용` 형식(`feat`, `fix`, `chore`, `docs`, `test`), 한국어 가능.
- 푸시 전에 `npm test && npm run typecheck && npm run build`.
- DB 변경은 `supabase/migrations/` 마이그레이션 파일로만. 대시보드에서 스키마를 직접 바꾸지 않는다.
- 새 마이그레이션은 `npx supabase@2 migration new <이름>`으로 만든다(파일 이름이 `YYYYMMDDHHMMSS_<이름>.sql` 타임스탬프). 번호(`0011_…`)를 직접 붙이지 않는다 — 두 사람이 동시에 만들어도 겹치지 않게. 이미 운영에 적용된 `0001`~`0010`은 이름을 바꾸지 않는다(이름순 정렬에서 타임스탬프보다 앞). 주의: 대전 마이그레이션(`20261101020000`~`20261101020200`)은 KST 시각으로 이름을 붙여 UTC보다 9시간 앞서 있다. 2026-11-01 11:03 KST 전에 `migration new`로 만든 파일은 이들보다 앞 이름이 되므로, 그때까지는 이름을 `20261101020300_<이름>.sql`처럼 그 뒤 시각으로 직접 고친다.

## 금지 사항
- 비밀값 커밋 금지 (`.env`, `.env.local`, 키, `PLAY_SECRET`). 예시는 `.env.example`만.
- 플랫폼 코드에 게임별 분기 금지. 게임마다 다른 점은 manifest·등록부로 푼다.
- 모든 화면 문구는 한국어, 모바일 우선. 색은 theme.css·src/app/palettes.ts 토큰만 쓴다 (후알야 카드 내부·킷 색, 양치 캔버스 내부 색 예외).

## 비밀값 위치
- Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (공개용 키)
- Supabase Edge Function 시크릿: `PLAY_SECRET`

## 개발 환경
- `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`
- DB 테스트: `npm run db:test` (`scripts/db-test.sh`, 로컬 Postgres + Supabase shim). Docker가 있는 머신에서는 로컬 스택에 `npx supabase test db`가 동일한 역할이다.
- Edge Function 테스트: `npm run fn:test` (`scripts/fn-test.sh`: `scripts/db-up.sh`로 임시 Postgres를 띄우고 `deno test`로 `supabase/functions/play/`와 `supabase/functions/duel/`을 돌린 뒤 `scripts/db-down.sh`). Deno 경로는 `DENO` 환경 변수로 바꿀 수 있다.
- 게임 로직 공유(설계 §4.7): Edge Function은 `../../../src/games/index.ts`를 상대 경로로 직접 import한다(로컬 `deno check`·실행 확인 완료). 원격 `supabase functions deploy` 번들은 배포 체크리스트 §3에서 확인한다(실패하면 sync-logic 방식으로 전환).
- Deno는 이 클라우드 환경에서 npm으로만 쓸 수 있다 (`npx deno` 또는 로컬 설치). Deno 코드(Edge Function)의 import는 상대 경로 또는 `npm:` 지정자만 쓴다 (jsr, deno.land 금지).

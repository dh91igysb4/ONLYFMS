# ONLYFMS 작업 규칙

두 개발자와 각자의 Claude가 공통으로 따른다. 설계·계획 문서가 먼저이고, 이 파일은 요약이다.

- 설계: `docs/superpowers/specs/2026-10-31-onlyfms-platform-design.md`
- 계획: `docs/superpowers/plans/` (구현 계획)

## 폴더 규칙
- `src/app/` 라우팅·레이아웃·공통 스타일 토큰(`theme.css`)
- `src/lib/supabase.ts` supabase 클라이언트
- `src/platform/{auth,games,contests,duel,leaderboard,profile,admin,chat}/` 플랫폼 화면. 게임별 코드는 두지 않는다.
- `src/platform/home/` 메인(`/`): 정사각형 밸리 미리보기(manifest `preview`가 있는 지속형 게임을 `getWorldPreview`로 찾는다) + 이름만 있는 바로가기 버튼(`shortcuts.ts`가 등록부로 목록을 만든다). 메인은 `world` 함수를 부르지 않는다. 설계 `docs/superpowers/specs/2026-11-24-home-valley-design.md`
- `src/games/index.ts` 게임 등록부(Deno Edge Function이 import하므로 React 등 화면 코드를 import하지 않는다). `src/games/ui.ts` 화면 컴포넌트 등록(`getGameComponent`). `src/games/<game-id>/` 에 `manifest.ts`, `logic.ts`, `logic.test.ts`, `Game.tsx`
- `src/test-fixtures/` 테스트 전용 게임(`test-guess`, 숫자 맞히기)과 등록부 래퍼. 운영 등록부에 넣지 않는다. 플랫폼 테스트는 `vi.mock`으로 `withTestGame`/`withTestGameUi`를 끼워 쓴다
- `src/platform/games/freeLogQueue.ts` + 테이블 `free_play_logs`: 자유 플레이의 시드와 행동 기록. `free_plays` 행 저장 뒤에 올린다
- 월드 위치 메시지(`src/platform/world/peers.ts`)의 `show`는 게임이 해석하는 짧은 문자열(128자 이하, 플랫폼은 내용을 모른다). 낚시는 `src/games/fishing/show.ts`(자랑·이모트)
- `src/platform/world/` 지속형(world) 게임 화면 `WorldPage`(라우트 `/world/:game`). 게임 화면은 `getWorldComponent`로 찾고, 상태는 서버(Edge Function `world`)가 쥔다. 같은 지역 친구 보이기는 실시간 방 `room.ts`(Supabase Realtime 공개 채널 `world:<gameId>:<areaId>`, 프레즌스 + 브로드캐스트 `pos`)와 순수 로직 `peers.ts`(보내기 간격·보간·정리). 위치는 그리기 전용이고 서버 판정에 쓰지 않는다. 설계 `docs/superpowers/specs/2026-11-24-fishing-online-design.md`. 다른 지역 친구 위치는 게임 전체 프레즌스 `presence.ts`(채널 `world:<gameId>`, 상태 {지역·하는 일·칸}, 메인 화면은 듣기만). 설계 `docs/superpowers/specs/2026-11-24-fishing-online-2a-design.md`
- `src/platform/chat/` 데일리 채팅(데이터 계층·화면). 권한은 화면이 아니라 DB `can_chat`(RLS·RPC·Storage 정책)이 정한다. 사진은 비공개 Storage 버킷 `daily-chat`에 올리고 서명 주소로만 연다
- `src/platform/suggest/` 제안 게시판(데이터 계층·화면). 읽기는 RLS, 쓰기는 RPC. 분류·진행 기록은 워커가 `supabase/functions/suggest/`로만 쓴다
- `supabase/functions/suggest/` 제안 워커용 Edge Function. 브라우저는 부르지 않고 헤더 `x-worker-token`으로만 인증한다. 워커 절차는 `docs/suggest-worker.md`
- `supabase/functions/world/` 지속형 게임 Edge Function. 요청은 `{ game, action: 'load' }` 또는 `{ game, action: 'act', payload }`이고, 트랜잭션에서 `world_saves` 행을 잠근 채 게임의 `WorldLogic`을 돌리고 `game_records`를 upsert한다. 테이블은 `world_saves`·`game_records`. `world_saves`는 클라이언트에서 읽을 수 없다. 화면에 필요한 값은 `WorldLogic.view`로만 내보낸다.
- 등록부 `src/games/index.ts`의 `worlds`/`getWorld`(지속형 게임), 화면은 `src/games/ui.ts`의 `getWorldComponent`
- 지속형 게임 프로필 캐릭터: manifest `avatar` + `WorldLogic.avatar(state)`(문자열) → `world` 함수가 `game_records` 키 `avatar`(값 0, detail)에 쓰고, 화면은 `src/games/ui.ts`의 `getAvatarComponent`, 플랫폼은 `src/platform/profile/AvatarSection.tsx`(요약 탭). 낚시 옷장 품목은 `src/games/fishing/wardrobe.ts`(서버 공용), 그림은 `wearArt.ts`, 합성은 `outfit.ts`(화면 전용)
- 지갑(설계 `docs/superpowers/specs/2026-11-23-wallet-design.md`): 테이블 `wallets`(잔액)·`gold_ledger`(장부, `unique (user_id, reason, ref)`, 상한으로 줄기 전 금액 `raw_delta`). 골드를 바꾸는 길은 SQL `_gold_move` 하나이고, 사이트 하루 상한(KST 하루 들어간 합계 `REF × 1.5`까지 다, `REF × 2`까지 20%, 그 위 4%)도 그 안에서만 적용한다. 잠금 순서는 세이브·대국·대회 행 먼저, 지갑 나중. 끝난 대회 정산은 예약 작업 없이 `my_wallet()`(승인 사용자면 지갑 표시와 무관하게 앱 로드마다 `Layout`이 부름)이 부르는 `settle_due()`(끝나고 1분 지난 대회 행 `for no key update skip locked` → 지급 목록을 모아 전체 `user_id` 오름차순으로 `_gold_move`, `settled_at`). 데일리 상금은 `_contest_payouts`(리더보드 순위에서 행동 1번 이상인 사람만 다시 센 등수, `_economy()->'daily_prizes'`). 대회 참가비(`contests.entry_fee`, 0~41,000, 만들 때 고정, 데일리·숨김 게임 0만)는 참가 한 곳 `_contest_enter`가 처음 참가 때 `contest_fee`로 빼고(화면이 본 참가비가 다르면 `fee_mismatch`), 취소는 `cancel_contest`가 즉시 환불, 분배는 같은 `_contest_payouts`(0명 환불, 1·2명 1등 독식, 3명 이상 60/30/10·나머지 1등)가 정산 때 한다. 새 참가비 대회는 SQL `_wallet_enabled()`(등록부 `walletEnabled()`의 사본, `walletFlag.test.ts`가 비교)가 true일 때만 만들 수 있다 — 낚시가 지갑을 쓰면서(`20261124030000_wallet_on`) true다. 지갑 게임이 하나도 없게 되면 새 마이그레이션에서 다시 `select false`로 바꾼다
- `src/games/economy.ts` 경제 상수 원본(`REF`, `DAILY_SOFT_CAP`, `SOFT_CAP_RATE`, `DAILY_SOFT_CAP_2`, `SOFT_CAP_RATE_2`, `softCap`). 상한 모양을 바꾸면 `economyPace.test.ts`(낚시 진행 날짜)도 함께 본다. SQL 사본은 `_economy()`이고 `economy.test.ts`가 마이그레이션의 마지막 정의와 비교한다. 수치를 바꾸면 새 마이그레이션에서 `_economy()`를 `create or replace`한다
- `src/lib/walletStore.ts` 내 잔액 저장소(React 밖, 구독 모듈). `world` 응답 최상위 `gold`와 `my_wallet()`이 채운다. `src/platform/wallet/` 지갑 데이터 계층·헤더 배지·관리자 골드 섹션
- `supabase/migrations/` 스키마·RLS·함수, `supabase/tests/` DB 테스트, `supabase/functions/play/` 출제·판정 Edge Function, `supabase/functions/duel/` 1대1 대전 Edge Function, `supabase/functions/_shared/` 두 함수가 함께 쓰는 코드(`db.ts`)

## 게임 추가 절차
1. `src/games/<game-id>/` 폴더 생성 (id는 영문 소문자·숫자·`-`)
2. `manifest.ts`, `logic.ts`, `logic.test.ts`, `Game.tsx` 작성 (테스트 먼저)
3. `src/games/index.ts` 등록부에 한 줄 추가, 화면 컴포넌트는 `src/games/ui.ts`(`getGameComponent`)에 등록 (`index.ts`에 넣지 않는다)
4. 새 마이그레이션(`npx supabase@2 migration new`)으로 `game_modes` 행과, 숨김 게임이면 `hidden_games` 행을 추가 (등록부 테스트 `registry.test.ts`와 일치해야 한다)
5. `hidden: true`로 PR 머지 → 미리보기·운영에서 관리자 확인
6. 문제없으면 `hidden`을 풀어 공개

점수로 겨루는 게임은 manifest에 `freeStats: 'score'`를 둔다. 자유 플레이 리더보드가 플레이·평균·최고만 보여 주고 최고 점수 순으로 고정되며, 홈 블록도 최고 점수를 보여 준다.
점수 상한이 10이 아닌 자유 플레이 점수 게임은 manifest `scoreMax`·`scoreDecimals`와 마이그레이션의 `game_modes.score_max`를 맞춘다 (`registry.test.ts`가 `scoreMax`와 `score_max`를 비교한다).
자유 플레이 골드에는 도전과제 보너스가 곱해진다(지갑 설계 §7.5): 지속형 게임의 `WorldLogic.freeBonus`(%)를 `world` 함수가 `game_records` 키 `free_bonus`(`FREE_BONUS_RECORD_KEY`, manifest records에 쓰지 않는다)에 쓰고, 트리거가 `_free_bonus_pct`(합, 상한 `FREE_BONUS_MAX_PCT` 400)로 판당 금액과 게임별 하루 상한에 곱한다. 사이트 하루 상한·상금·판돈·참가비에는 곱하지 않는다. 화면 미리 계산은 `freeGold(…, bonusPct)`.
자유 플레이 점수 게임에 골드를 주려면 manifest `gold: { perPoint, playCap, dailyCap: FREE_DAILY_CAP }`과 새 마이그레이션의 고정 형식 한 줄 `update game_modes set gold_per_point = X, gold_play_cap = Y, gold_daily_cap = 2050 where game_id = '…';`을 맞춘다(`registry.test.ts`가 비교, 없으면 지급 없음). 수치는 `src/games/<id>/gold.test.ts`로 기준 플레이(평균 점수·한 판 시간, 출처 주석) 시간당 골드가 `FREE_REF`(= `REF / 10`) ±20%, 기준 한 판은 100 미만(`FREE_AVG_PLAY_MAX`), `playCap`은 기준 한 판의 5배(10 단위)이되 200 이하(`FREE_PLAY_CAP_MAX`), 봇이 있으면 봇 평균 점수도 검사한다(지갑 설계 §7.3). 지급은 `free_plays` 트리거가 하고 숨김·`free = false` 게임은 주지 않는다.

대전(1대1) 게임은 다음이 다르다 (설계 `docs/superpowers/specs/2026-11-01-duel-platform-design.md`):
- manifest에 `category: 'duel'`, `modes`는 모두 false, `duel: { turnSeconds, sameScreen }`. 로직은 `DuelLogic`(`src/games/types.ts`).
- 등록은 `src/games/index.ts`의 `duels`, 화면은 `src/games/ui.ts`의 `getDuelComponent`(`DuelGameProps`).
- 마이그레이션에 `game_modes` (false, false, false) 행과 숨김이면 `hidden_games` 행.
- 판돈(`duel_matches.stake`, 0~41,000, 숨김 게임 0만, 지갑 게임이 없으면 함수가 0만 받음)은 `duel` 함수가 `create`·`join`에서 `duel_stake`로 맡기고, 지급·환불은 트리거 `_duel_settle_stakes` 한 곳(`status`가 `finished`/`void`로 바뀔 때, 장부 기준). 대국을 끝내거나 무효로 만드는 새 길을 더해도 `status` update만 하면 된다. 참가는 화면이 본 `stake`를 보내고 다르면 409 `stake_mismatch`.
- `timeoutAction`은 아직 보이지 않은 무작위 결과에 기대지 않는 "다음 행동 하나"를 돌려준다. 서버가 턴이 넘어갈 때까지 반복 호출한다.

지속형(world) 게임은 대전과 비슷하게 추가한다:
- manifest에 `category: 'world'`, `modes`는 모두 false, 필요하면 `records: [{ key, label, unit? }]`(프로필 "기록" 탭이 이 선언과 RPC `user_records`만으로 그린다). 로직은 `WorldLogic`.
- 메인 미리보기를 그리려면 manifest `preview: true` + `src/games/ui.ts`의 `getWorldPreview` 등록(`WorldPreviewProps`). 미리보기에 서버 값이 필요하면 `WorldLogic.previewData`(키마다 `game_records` 행, records·avatar·free_bonus 키와 겹치면 안 된다). 등록부 테스트가 둘을 함께 검사한다.
- 등록은 `src/games/index.ts`의 `worlds`, 화면은 `src/games/ui.ts`의 `getWorldComponent`.
- 마이그레이션에 `game_modes` (false, false, false) 행과 `hidden_games` 행.
- 골드는 세이브에 두지 않는다. 지갑을 쓰는 게임은 logic에 `wallet: true`를 두고 `ctx.gold`(잔액)를 읽어 지출을 검사한 뒤 `apply`의 `gold`(정수 증감)로 돌려준다. 옛 세이브의 골드는 `legacyGold`가 한 번 지갑으로 옮긴다(reason `migrate`). 사이트 하루 상한은 게임이 몰라도 된다(핸들러가 `gold_capped`를 응답에 넣고 `WorldPage`가 알린다).

## 마을회관 그림 (`fishing`)
- 회관 외관·1층 실내 배경은 `python3 scripts/build-hall-art.py`가 `scripts/hall-art/{exterior,interior}.py`로 그려 `src/games/fishing/hallArt.ts`를 만든다(생성 파일, 직접 고치지 않는다). 그림을 바꾸면 이 명령을 다시 돌린다.
- 회관 맵(`maps/hall.ts`)은 행으로 걷기만 정하고(F 바닥, Y 벽·가구), 방 유리벽은 `walls`(칸 사이 모서리), 상호작용은 `fixtures`로 둔다. 그림과 좌표를 함께 맞춘다.
- 명예의 전당 데이터는 RPC `hall_of_fame`과 플랫폼 `src/platform/world/hallOfFame.ts`(게시판). 지속형 게임 화면은 `WorldGameProps.onOpenGames`로 게임 목록에 갈 수 있다.

## 낚시 데이터 갱신 (`fishing`)
`src/games/fishing/data.ts`(어종·낚싯대)나 `logic.ts`를 바꿔 결과가 달라지면:
1. `logic.ts`의 `logic.version`을 올린다.
2. `migrate`가 옛 버전 세이브를 읽는지 `logic.test.ts`에 테스트를 추가한다 (세이브는 서버에 계속 남아 있다).
3. `world` Edge Function을 다시 배포한다 (`npx supabase@2 functions deploy world --no-verify-jwt`, `docs/deploy-checklist.md` "낚시 배포"). 함수가 `src/games/**` 로직·데이터를 함께 번들하므로 Vercel만 배포하면 서버 판정은 옛 데이터로 남는다 (후알야 데이터와 `play`의 관계와 같다).
4. 장비·해금 가격이나 판매가를 바꾸면 진행 속도(하루 1시간 약 30일, 27~41일, 설계 `2026-11-25-fishing-sell-decay-design.md`)를 다시 잰다: `src/games/fishing/econSim.ts`가 판매 마릿수 감쇠(`data.ts` `SELL_DECAY`)로 재고, `fishing/gold.test.ts`의 기록 값·날짜 검사가 통과해야 한다. 낚시 수입(`world`)은 사이트 하루 상한을 받지 않는다(상한은 미니게임 `free`만).
5. 골드는 지갑에 있다(logic.version 14부터, `wallet: true`). 새 골드 행동은 `ctx.gold`로 검사하고 `apply`의 `gold`로 증감을 돌려준다. 세이브(`State`)에 골드를 두지 않는다. `world`를 v14 아래로 되돌리지 않는다(`docs/deploy-checklist.md` "지갑 켜기").

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
- 골드는 `_gold_move`로만 바꾼다. `wallets`·`gold_ledger`를 직접 update/insert하지 않는다(테스트 픽스처 제외).
- 모든 화면 문구는 한국어, 모바일 우선. 색은 theme.css·src/app/palettes.ts 토큰만 쓴다 (후알야 카드 내부·킷 색, 양치 캔버스 내부 색, 볼 런·몰래 수능 3D 장면 내부 색, 네온 라이더 캔버스 내부 색, 낚시 캔버스 내부 색 예외). 문구 예외는 네온 라이더 착지 감탄 문구(영어 소문자) 하나뿐이다.

## 비밀값 위치
- Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (공개용 키)
- Supabase Edge Function 시크릿: `PLAY_SECRET`, `SUGGEST_WORKER_TOKEN` (제안 워커 토큰. 워커 예약 작업은 환경 변수나 맥의 `.env.local`에서 읽는다)

## 개발 환경
- `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`
- 네온 라이더의 `sim.ts`·`collide.ts`·`pieces.ts`·`constants.ts`를 바꾸면 푸시 전에 `npm run test:gate`(느린 통과 게이트 `*.gate.test.ts`, 기본 `npm test`에서는 빠진다)도 돌린다.
- DB 테스트: `npm run db:test` (`scripts/db-test.sh`, 로컬 Postgres + Supabase shim). Docker가 있는 머신에서는 로컬 스택에 `npx supabase test db`가 동일한 역할이다.
- Edge Function 테스트: `npm run fn:test` (`scripts/fn-test.sh`: `scripts/db-up.sh`로 임시 Postgres를 띄우고 `deno test`로 `supabase/functions/play/`, `supabase/functions/duel/`, `supabase/functions/suggest/`, `supabase/functions/world/`를 돌린 뒤 `scripts/db-down.sh`). Deno 경로는 `DENO` 환경 변수로 바꿀 수 있다.
- 게임 로직 공유(설계 §4.7): Edge Function은 `../../../src/games/index.ts`를 상대 경로로 직접 import한다(로컬 `deno check`·실행 확인 완료). 원격 `supabase functions deploy` 번들은 배포 체크리스트 §3에서 확인한다(실패하면 sync-logic 방식으로 전환).
- Deno는 이 클라우드 환경에서 npm으로만 쓸 수 있다 (`npx deno` 또는 로컬 설치). Deno 코드(Edge Function)의 import는 상대 경로, `npm:` 지정자, `node:` 내장 모듈만 쓴다 (jsr, deno.land 금지. 예: `handler.ts`의 `node:crypto`).

# 배포 체크리스트

원격 작업(Supabase, Vercel)은 사람이 직접 실행한다. 위에서 아래로 순서대로 진행하고, 막히면 맨 아래 "문제가 생기면"을 본다.
프로젝트 ref: `xhikfflklkrysmakaqoj` / 브랜치: `feat/platform`

## 1. 준비
- [ ] Supabase CLI 로그인과 프로젝트 연결
```bash
npx supabase@2 login
npx supabase@2 link --project-ref xhikfflklkrysmakaqoj
```
이후 명령도 `npx supabase@2 …`로 실행한다.

## 2. DB 마이그레이션
- [ ] 마이그레이션 적용 (`supabase/migrations/0001`~`0005`)
```bash
npx supabase@2 db push
```
- [ ] 확장 위치 확인 (Supabase SQL 편집기). 마이그레이션이 초대 코드에 `extensions.gen_random_bytes`를 쓴다.
```sql
select extname, extnamespace::regnamespace from pg_extension where extname in ('citext','pgcrypto');
```
  - `pgcrypto`가 스키마 `extensions`에 있어야 한다. 다르면 결과를 그대로 알려 준다(고치지 말고 보고).
  - `citext`가 어느 스키마인지도 함께 적어 둔다.
- 가입 트리거 확인은 로그인할 주소(4번의 미리보기)가 있어야 하므로 5번에서 한다.

## 3. Edge Function `play`
- [ ] 시크릿 설정과 배포
```bash
npx supabase@2 secrets set PLAY_SECRET=$(openssl rand -hex 32)
npx supabase@2 functions deploy play
```
  - `supabase/config.toml`의 `[functions.play] verify_jwt = false`로 배포돼야 한다. 함수가 토큰을 직접 확인한다(`auth.getUser`). 플랫폼의 JWT 검사는 새 키 체계(publishable 키)의 요청을 막을 수 있어 끈다.
  - 설정이 반영되지 않으면(대시보드 → Edge Functions → play에서 "Verify JWT"가 켜져 있으면) `npx supabase@2 functions deploy play --no-verify-jwt`로 다시 배포한다.
  - 배포가 `../../../src/games/...` import를 번들하지 못해 실패하면 **중단하고 에러 전문을 보고**한다. (대안: 설계 §4.7의 sync-logic 복사 스크립트 방식으로 전환)
- [ ] 자동 제공 환경 변수 확인: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`은 Supabase가 함수에 자동으로 넣어 준다. 대시보드 → Edge Functions → play → Secrets/환경 변수에서 확인한다.
  - `SUPABASE_ANON_KEY`가 없으면(새 키 체계) publishable 키를 시크릿으로 직접 넣는다.
```bash
npx supabase@2 secrets set SUPABASE_ANON_KEY=<publishable key>
```
  (`SUPABASE_` 접두사 시크릿이 거부되면 그 에러를 보고.)

## 4. Vercel
- [ ] Project Settings → Environment Variables, **Production과 Preview 모두**:
  - `VITE_SUPABASE_URL` = `https://xhikfflklkrysmakaqoj.supabase.co`
  - `VITE_SUPABASE_PUBLISHABLE_KEY` = `<publishable key>`
- [ ] PR을 열어 첫 미리보기 배포를 만든다 (7번 참고). 환경 변수는 배포 시점에 반영되므로 변수 추가 후 재배포.
- [ ] Supabase → Authentication → URL Configuration → Redirect URLs에 미리보기 주소 패턴 추가
  - 예: `https://onlyfms-*-<팀이름>.vercel.app/**`
  - 운영 주소 `https://onlyfms.vercel.app/**`도 있는지 확인.
  - 로컬 개발 주소 `http://localhost:5173/**`도 추가한다 (설계 §13).

## 5. 첫 관리자
- [ ] 미리보기(4번)에서 구글로 로그인한다.
- [ ] 가입 트리거 확인: SQL 편집기에서
```sql
select id, handle, status, is_admin from profiles order by created_at desc limit 5;
```
  - 방금 가입한 계정의 `profiles` 행이 있고 `status = 'pending'`이어야 한다. 행이 없으면 트리거가 Supabase의 auth 삽입에서 동작하지 않는 것이니 보고.
- [ ] 아이디(handle)를 정한다.
- [ ] Supabase SQL 편집기에서 (두 값 모두 필요 — 관리자는 스스로를 승인할 수 없다)
```sql
update profiles set is_admin = true, status = 'approved', approved_at = now() where handle = '<아이디>';
```
- [ ] 새로고침하면 게임 목록과 관리자 메뉴가 보인다.

## 6. 수동 확인 (미리보기 주소, 폰과 PC 모두)
- [ ] 1. 두 번째 구글 계정 가입 → 대기 화면 → 관리자 승인 → 게임 목록 보임
- [ ] 2. 숨김 게임(`hidden: true`)이 있으면 비관리자에게 안 보이고, 관리자에게는 보임 (숫자 맞히기는 0008에서 제거됨)
- [ ] 3. 데일리: 추측·힌트·포기·결과. 다른 기기에서 이어 풀기
- [ ] 4. 오늘 탭에 두 계정 순위, 동점 처리
- [ ] 5. 친선 대회(10분 뒤 시작, 5분) 개설 → 초대 링크로 두 번째 계정 참가 → 카운트다운 → 동시 풀이 → 5초 순위 갱신 → 종료 후 정답 공개, 누적 탭 미반영
- [ ] 6. 공식 대회 같은 흐름 → 주간·전체·대회 탭 반영
- [ ] 7. 자유 플레이를 비행기 모드에서 끝냄 → 온라인 복귀 후 자동 저장, 중복 없음
- [ ] 8. 개발자 도구 네트워크 탭에서 진행 중인 데일리·대회 정답이 응답에 없는지 확인
- [ ] 9. 실제 로그인 JWT 경로: 승인된 계정으로 `play` 함수 호출이 200, 승인 대기 계정은 403 `not_approved` (네트워크 탭에서 확인)

## 7. main 머지
- [ ] `feat/platform` → `main` PR을 연다.
- [ ] Vercel 미리보기에서 6번을 통과했는지 확인하고 PR을 리뷰한다.
- [ ] 머지한다. **머지하면 onlyfms.vercel.app의 현재 Who Are Ya 페이지가 새 플랫폼으로 바뀐다**(설계 §13).
- [ ] 운영 주소에서 로그인과 게임 목록이 뜨는지 확인한다.

## 대전(1대1) 배포
`feat/duel` 머지 전에, 미리보기에서 확인한다. 요트 다이스는 숨김(관리자만)으로 들어간다.

- [ ] 마이그레이션: `npx -y supabase@2 db push` → `20261101020000_yacht.sql`, `20261101020100_duel.sql`
- [ ] 함수 배포 (두 함수 모두. `_shared/db.ts`를 바꾸면 항상 둘 다 다시 배포)
```bash
npx -y supabase@2 functions deploy duel --no-verify-jwt
npx -y supabase@2 functions deploy play --no-verify-jwt
```
  - 업로드 목록에 `supabase/functions/_shared/db.ts`와 `src/games/yacht/...`가 보여야 한다. 번들 오류면 출력 전문을 보고.
- [ ] 실시간 신호 확인: 관리자 두 계정(폰 두 대)으로 랭크 대국 → 한쪽이 굴리면 다른 쪽 화면이 1~2초 안에 바뀌는지. 5초 간격으로만 바뀌면 대시보드 → Edge Functions → duel → Logs에서 `broadcast` 오류를 찾아 전문을 보고(키 문제일 수 있음, 대국 진행에는 지장 없음).
- [ ] 수동 확인
  - [ ] 랭크 한 판 끝까지 → 결과 화면 레이팅 변화(처음 1000 → 1020/980), 리더보드 대전 탭은 5판 전까지 "배치 중"
  - [ ] 친선 한 판 → 레이팅 그대로, 프로필 "전체" 전적에만 반영
  - [ ] 한쪽 창을 닫고 두 번 시간 초과 → 기권패
  - [ ] 참가 직후(첫 수 전) 기권 → 무효(레이팅·전적 미반영)
  - [ ] 초대 링크로 참가, 대기실(공개)로 참가 각각
  - [ ] 같은 화면 모드 한 판(서버 요청 없음)
  - [ ] 프로필 상대 전적
- [ ] 문제없으면 숨김 해제 PR(새 마이그레이션 `delete from hidden_games where game_id = 'yacht';` + manifest `hidden: false`)

## 홈 대시보드 배포
`feat/home-dashboard` 머지 전에, 미리보기에서 확인한다. Edge Function은 다시 배포하지 않는다.

- [ ] 마이그레이션 먼저: `npx -y supabase@2 db push` → `20261101150803_home_layout.sql` (`profiles.home_layout` 컬럼 + `set_home_layout` RPC)
- [ ] 그다음 Vercel 배포. 프런트가 먼저 나가면 홈은 기본 배치로 보이고, 마이그레이션을 적용하기 전까지 저장이 실패한다.
- [ ] 수동 확인 (폰과 PC 모두)
  - [ ] 편집 → 순서 바꾸기 → 완료 → 새로고침해도 순서 유지
  - [ ] 다른 기기에서도 같은 순서로 보임
  - [ ] 블록을 모두 끄면 안내 문구와 편집 버튼이 보임
  - [ ] 기본값으로 → 완료가 오류 없이 저장됨 (null 초기화 경로)
  - [ ] 폰은 한 열, 넓은 화면(900px 이상)은 두 열

## 양치 시뮬레이터(숨김) 배포
`claude/toothbrush-game` 머지 전에, 미리보기에서 관리자 계정으로 확인한다.

- [ ] 마이그레이션: `npx -y supabase@2 db push` → 파일 이름순으로 `20261101155028_toothbrush.sql`, `20261101160235_free_play_logs.sql`, `20261101161044_free_best_score.sql` 세 개가 적용된다.
- [ ] `play` Edge Function은 이번 변경에 재배포가 필요 없다(설계 §6). Vercel 배포만 하면 된다.

## 데일리 채팅 배포
`feat/daily-chat` 머지 전에, 미리보기에서 확인한다. Edge Function은 다시 배포하지 않는다.

- [ ] 마이그레이션 먼저: `npx -y supabase@2 db push` → `20261102053000_daily_chat.sql` (테이블·RPC·RLS·Realtime publication·`daily-chat` 버킷·Storage 정책)
- [ ] 그다음 Vercel 배포(머지)
- [ ] 원격에서만 확인할 것 (로컬 shim으로는 검증되지 않음)
  - [ ] `db push`가 `storage.objects` 정책과 `daily-chat` 버킷을 만들었는지 (대시보드 Storage → Policies에서 확인. 버킷은 비공개여야 한다)
  - [ ] 관리자가 아직 안 끝낸 문항의 사진도 지울 수 있는지
  - [ ] 끝낸 계정 둘이 글·사진을 주고받으면 1~2초 안에 보이는지
  - [ ] 안 끝낸 계정은 채팅이 보이지 않고, 개발자 도구 Network → WS 프레임에 `daily_chat` 이벤트가 오지 않는지
  - [ ] 안 끝낸 계정으로 사진 서명 주소 만들기가 실패하는지
  - [ ] 지운 뒤 (받아 둔 서명 주소를 포함해) 사진 주소가 열리지 않는지
  - [ ] 아이폰·안드로이드에서 사진 고르기·줄이기·올리기

## 제안 게시판 배포
`feat/suggestion-board` 머지 전에, 미리보기에서 확인한다. 워커 절차는 `docs/suggest-worker.md`에 있다.

- [ ] 마이그레이션 먼저: `npx supabase@2 db push` → `20261122174000_suggestions.sql`
```bash
npx supabase@2 db push
```
- [ ] 워커 토큰을 만들고 시크릿으로 설정한다. 값을 화면에 찍지 않고 셸 변수에 담아 바로 넘긴다.
```bash
TOKEN="$(openssl rand -hex 32)"; npx supabase@2 secrets set SUGGEST_WORKER_TOKEN="$TOKEN"
```
  같은 값을 이 절 끝의 예약 작업 단계에서 쓸 곳(맥 `.env.local` 또는 예약 작업 설정)에 넣는다. 값을 `echo`로 찍거나 채팅·커밋에 남기지 않는다. 같은 셸에서 `.env.local`에 넣을 때는 `printf 'SUGGEST_WORKER_TOKEN=%s\n' "$TOKEN" >> .env.local`처럼 화면에 출력하지 않는 방법으로 하고, 끝나면 `unset TOKEN`을 한다.
- [ ] 함수 배포
```bash
npx supabase@2 functions deploy suggest --no-verify-jwt
```
- [ ] 함수 확인 (`<함수 주소>`는 `https://xhikfflklkrysmakaqoj.supabase.co/functions/v1/suggest`)
  - 토큰 없이 POST하면 401
```bash
curl -sS -i -X POST "<함수 주소>" -H 'content-type: application/json' -d '{"action":"pending"}'
```
  - 토큰과 `{"action":"pending"}`이면 200과 네 목록(`to_triage`, `context`, `to_build`, `to_check`)
```bash
curl -sS -i -X POST "<함수 주소>" -H "x-worker-token: <값>" -H 'content-type: application/json' -d '{"action":"pending"}'
```
- [ ] 수동 확인 (미리보기, 관리자와 일반 승인 계정 각각)
  - [ ] 제안 쓰기, 공감, 본인 글 삭제
  - [ ] 같은 계정으로 하루에 6번째 제안은 거절됨
  - [ ] 관리자 구역(`/admin` 제안 검토)에서 승인·거절 (분류된 항목은 위 `pending` 호출이 아니라 워커 실행 뒤에 나타난다. 확인용 분류가 필요하면 `docs/suggest-worker.md`의 `triage` 호출로 글 하나를 분류한다)
- [ ] 예약 작업 만들기 (프롬프트는 "저장소를 최신 main으로 맞추고 `docs/suggest-worker.md`를 따르라"뿐)
  - 클라우드 환경 네트워크 설정에 `*.supabase.co`를 허용할 수 있으면 클라우드 예약 작업으로 만들고, 토큰은 예약 작업 설정에 둔다.
  - 안 되면 맥에서 매일 15:30 KST에 도는 "이 컴퓨터 필요" 예약 작업으로 만들고, 저장소 루트 `.env.local`에 `SUGGEST_WORKER_TOKEN=<값>`을 넣는다(`.env.local`은 커밋하지 않는다).

## 낚시(지속형 world 게임) 배포
낚시 마을 변경(`feat/fishing-walk`, `logic.version` 2) 머지 전에, 미리보기에서 관리자 계정으로 확인한다. 낚시는 `20261123065500_fishing_public.sql`부터 공개다 (`hidden: false`, `npx supabase@2 db push` 필요).

순서: DB push → `world` 함수 배포 → Vercel.

- [ ] 마이그레이션 먼저: `npx supabase@2 db push` → `20261122191800_world.sql`(테이블 `world_saves`·`game_records`, RPC `user_records`), `20261122193304_fishing.sql`(`game_modes`·`hidden_games` 행)
- [ ] 함수 배포. `world`는 `src/games/**` 로직·데이터를 번들하므로 `src/games/fishing/data.ts`·`logic.ts`가 바뀔 때마다 다시 배포한다. 낚시 마을(걷기·부두 크기 보너스·가방 업그레이드, `logic.version` 2) 변경도 `logic.ts`·`data.ts`가 바뀌므로 `world` 함수 재배포가 필요하다.
```bash
npx supabase@2 functions deploy world --no-verify-jwt
```
  - 번들 오류면 출력 전문을 보고.
  - world를 v2로 배포한 뒤에는 v1으로 되돌리지 않는다 — 되돌리면 옛 migrate가 가방 업그레이드와 21번째 이후 물고기를 지운다. 문제가 생기면 고쳐서 다시 배포한다
  - 배포 직후 첫 요청에서 진행 중이던 캐스트가 사라진다(설계상 허용) — 플레이어가 적은 새벽(KST)에 배포한다
- [ ] 그다음 Vercel 배포(머지)

게임 시계 변경(게임 시계·계절·날씨, 새 물고기 4종): `logic.version` 3. `world` 함수가 `clock.ts`까지 번들하므로 `world` 재배포가 필요하다(위 명령과 같다).
- [ ] 진행 중 데일리가 적은 새벽(KST)에 배포한다
- [ ] `world` 함수를 v3로 배포한 직후 바로 머지·Vercel 배포까지 이어서 한다. 옛 화면 번들을 연 탭은 새 물고기(문어·갈치·복어·붕장어)를 받으면 미니게임·가격 계산(`barParams`·`price`)에서 멈춘다
- [ ] Vercel 배포가 끝나면 테스터에게 열어 둔 낚시 탭을 새로고침해 달라고 알린다
- [ ] world를 v3로 배포한 뒤에는 v2로 되돌리지 않는다 — 되돌리면 옛 migrate가 가방·도감에서 새 물고기 4종을 지우고 열린 지역을 `['pier']`로 되돌린다. 문제가 생기면 고쳐서 다시 배포한다

세계 확장 2단계(마을 강·숲 지도, 지역별 어종 33종, 도감 지역 탭): `logic.version` 4. `world` 함수가 `data.ts`·`logic.ts`를 번들하므로 `world` 재배포가 필요하다(위 명령과 같다).
- [ ] 진행 중 데일리가 적은 새벽(KST)에 배포한다
- [ ] `world` 함수를 v4로 배포한 직후 바로 머지·Vercel 배포까지 이어서 한다. 옛 화면 번들을 연 탭은 강·숲 어종을 받으면 미니게임·가격 계산(`barParams`·`price`)에서 멈춘다
- [ ] Vercel 배포가 끝나면 테스터에게 열어 둔 낚시 탭을 새로고침해 달라고 알린다
- [ ] world를 v4로 배포한 뒤에는 v3로 되돌리지 않는다 — 옛 migrate·옛 화면은 강·숲 어종을 모른다. 옛 탭은 가방에 강·숲 물고기가 있으면 가격 계산에서 멈춘다. 문제가 생기면 고쳐서 다시 배포한다

### 낚시 미리보기 확인
브라우저 폭 390px와 1280px 모두, 관리자 계정으로.

- [ ] 게임 목록에 "펨타듀 낚시" 카드와 "들어가기"가 관리자가 아닌 계정에도 보인다
- [ ] 캐스팅 → 입질 → 챔 → 미니게임 → 가방 → 판매 → 골드 증가 한 바퀴
- [ ] 1,500 G 모아 유리섬유 낚싯대 구매 후 바가 길어지고 희귀 어종이 나온다
- [ ] 새로고침·다른 브라우저에서 세이브가 이어진다
- [ ] 프로필 기록 탭에 누적 수익·최대어·도감이 뜨고, 낚싯대를 사도 누적 수익이 줄지 않는다
- [ ] 터치(개발자 도구 모바일 모드)로 전 과정이 된다, 길게 눌러도 화면이 스크롤·확대되지 않는다
- [ ] 폰(또는 모바일 모드)에서 조이스틱으로 마을을 걷는다. 건물·나무·물에 닿으면 벽을 따라 미끄러지고, 걷는 동안 화면이 스크롤·확대되지 않는다
- [ ] 한 손가락은 조이스틱, 다른 손가락은 행동 버튼으로 동시에 조작된다
- [ ] 물가에서는 행동 버튼 글자가 "낚시", 부두 위에서도 "낚시", 상점 문 앞에서는 "상점"이다. 상점은 문 앞에서만 열리고 다른 곳에서는 열리지 않는다
- [ ] 부두 끝에서 상점 문 앞까지 걷는 데 약 8초 걸린다 (최단 경로 37칸, 초당 4.5칸)
- [ ] 부두 위에서 던지면 큰 물고기가 더 잘 나온다 (크기 보너스)
- [ ] 가방 업그레이드 구매: 20칸 → 30칸(800 G) → 40칸(5,000 G), 가득 차면 "상점에 가서 팔아 주세요"가 뜬다
- [ ] 새로고침 후 걷던 위치가 유지된다
- [ ] 게임 시계(`logic.version` 3): 두 기기에서 HUD의 계절·시각·날씨가 같다 (게임 시각 = 실제로 KST 자정부터 흐른 분 mod 24, 실제 1초 = 게임 1분)
- [ ] 실제 시각의 `분 mod 24`가 20 이상이면 장면이 밤 색조다
- [ ] 비 오는 게임 날에는 비가 내린다 (겨울은 눈)
- [ ] 복어(floater)·문어(sinker)의 미니게임 움직임이 위·아래로 치우친다
- [ ] 기존 세이브의 골드·가방·도감이 그대로 유지된다
- [ ] 도감에서 잡은 어종에만 출현 조건(예: 복어 '여름 · 12~16시 · 맑음')이 보이고, 다금바리는 '전설' 표시가 있다
- [ ] 폰 폭(390px)에서 HUD 시계(계절 아이콘·날씨 아이콘·시각 숫자)가 또렷하고, 던지기부터 싸움까지 위쪽 안내 줄에 가리지 않으며 싸움 트랙·조이스틱·행동 버튼과 겹치지 않는다
- [ ] 세계 확장(`logic.version` 4): 마을 북쪽 길 → 강 → 서쪽 → 숲 → 되돌아오기까지 걸어서 오간다. 출구에서 화면이 깜빡이지 않는다
- [ ] 강 다리·강가·연못·폭포에서 각각 던지면 그 지역의 어종이 걸린다
- [ ] 강·숲에서는 상점이 열리지 않는다 (상점은 마을에서만)
- [ ] 새로고침하면 마지막 지역·위치에서 시작한다
- [ ] 도감에 지역 탭(바닷가 마을·마을 강·숲)이 있고, 처음엔 현재 지역 탭이 열린다. 탭마다 'n/전체'가 보이고 맨 위는 'n/33종'이다. 못 잡은 전설은 테두리 칸에 '???'로 보인다
- [ ] 데스크톱(1280px)에서 방향키로 걷고 스페이스로 낚시·상점이 된다
- [ ] 브라우저 콘솔에서 `world_saves`·`game_records`에 직접 update를 시도하면 거부되고, `supabase.from('world_saves').select('state')`는 행 없이 오류(권한 거부)를 돌려준다

## 문제가 생기면
아래를 그대로 보내 준다.
- 어느 단계(번호와 항목)에서 막혔는지
- 에러 전문(터미널 출력 또는 브라우저 콘솔·네트워크 탭의 응답 본문)
- 2번 확장 위치 쿼리 결과, 배포 실패 시 `functions deploy` 출력

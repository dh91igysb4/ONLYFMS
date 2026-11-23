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

가방 잠금(잠근 물고기는 "전부 팔기"에서 빠짐, 전설 자동 잠금): `logic.version` 5. `logic.ts`가 바뀌므로 `world` 재배포가 필요하다(위 명령과 같다).
- [ ] `world` 함수를 v5로 배포한 뒤 머지·Vercel 배포. 순서가 어긋나도 멈추지는 않는다(옛 화면은 잠금을 모를 뿐이고, 새 화면이 옛 함수에 잠금을 보내면 "다시 시도해 주세요"가 뜬다)
- [ ] world를 v5로 배포한 뒤에는 v4로 되돌리지 않는다 — 옛 migrate가 잠금을 지워서 잠가 둔 전설이 "전부 팔기"에 팔린다
- [ ] 수동 확인: 가방에서 칸을 눌러 잠금·해제(자물쇠 표시), 잠근 채 "전부 팔기"를 하면 잠긴 물고기만 남는다, 상점 문구가 "팔 물고기 n마리 · 잠금 m마리 · 예상 …", 새로고침 뒤에도 잠금 유지, 배포 전부터 가방에 있던 전설이 잠겨 있다, 전설을 새로 잡으면 잠긴 채 들어온다

찌(상점 5종, 카본 1칸·명장 2칸 장착, 미니게임·입질·희귀 확률 효과): `logic.version` 6. `world` 함수가 `data.ts`·`logic.ts`를 번들하므로 `world` 재배포가 필요하다(위 명령과 같다).
- [ ] 진행 중 데일리가 적은 새벽(KST)에 배포한다
- [ ] `world` 함수를 v6으로 배포한 직후 바로 머지·Vercel 배포까지 이어서 한다. main 기준으로 Vercel이 한 번 더 배포되는 것도 확인한다
- [ ] Vercel 배포가 끝나면 테스터에게 열어 둔 낚시 탭을 새로고침해 달라고 알린다
- [ ] world를 v6으로 배포한 뒤에는 v5로 되돌리지 않는다 — 옛 migrate는 찌를 모른다(산 찌가 사라진다). 문제가 생기면 고쳐서 다시 배포한다

세계 해금 3단계(강 북쪽 다리·산 호수·숲 동굴·마을 선착장 배·섬 석호와 바다, 지역 해금 상태 저장): `logic.version` 7. `world` 함수가 `data.ts`·`logic.ts`를 번들하므로 `world` 재배포가 필요하다(위 명령과 같다).
- [ ] 진행 중 데일리가 적은 새벽(KST)에 배포한다
- [ ] PR 브랜치에서 `world` 함수를 v7로 배포한 직후 머지한다. 머지 뒤 main 기준으로 `world`를 한 번 더 배포하고, Vercel 배포까지 이어서 한다
- [ ] Vercel 배포가 끝나면 테스터에게 열어 둔 낚시 탭을 새로고침해 달라고 알린다
- [ ] world를 v7로 배포한 뒤에는 v6으로 되돌리지 않는다 — 옛 migrate와 옛 화면은 새 어종과 해금 지역을 모른다. 문제가 생기면 고쳐서 다시 배포한다
- [ ] 수동 확인 (해금 3단계):
  - [ ] 강 북쪽 다리 앞에서 해금 창이 뜨고 가격이 보인다. 골드가 모자라면 골드 부족 문구가 뜬다
  - [ ] 해금 뒤에는 다리를 바로 건널 수 있다
  - [ ] 산 호수에서 낚시가 된다
  - [ ] 숲 동굴 입구에서 해금할 수 있다. 동굴 안은 비가 오지 않고 밤 효과가 없으며, 용암에서도 낚시가 된다
  - [ ] 마을 선착장에서 배를 살 수 있고, 섬과 마을을 배로 왕복할 수 있다
  - [ ] 섬 석호와 바다에서 낚시가 된다
  - [ ] 다른 기기에서 아직 안 연 지역의 위치가 저장돼 있으면 마을에서 시작한다
  - [ ] 도감 탭이 6개다
  - [ ] 동굴로 들어가고 나올 때 폰에서 화면이 끊기지 않는다

세계 4단계(지역 도전과제 6개·순간이동기 6개, 프로필 기록 "도전과제"): `logic.version` 8. `world` 함수가 `data.ts`·`logic.ts`에 더해 `teleport.ts`·`maps/*.ts`(요금 계산용 세계 좌표)까지 번들하므로 `world` 재배포가 필요하다(위 명령과 같다). DB 변경은 없다(`game_records`는 키 제한이 없어 `challenges` 기록이 그대로 들어간다).
- [ ] 진행 중 데일리가 적은 새벽(KST)에 배포한다
- [ ] PR 브랜치에서 `world` 함수를 v8로 배포한 직후 머지한다. 머지 뒤 main 기준으로 `world`를 한 번 더 배포하고, Vercel 배포까지 이어서 한다. 순서가 어긋나도 멈추지는 않는다(옛 화면은 과제·이동기를 모를 뿐이고, 새 화면은 옛 응답의 빈 `challenges`를 꺼진 이동기로 본다)
- [ ] Vercel 배포가 끝나면 테스터에게 열어 둔 낚시 탭을 새로고침해 달라고 알린다
- [ ] 배포 직후 첫 요청에서 진행 중이던 캐스트가 사라진다(v7 → v8 migrate, 설계상 허용). 과제 진행은 배포 뒤부터 센다(도감 소급 없음)
- [ ] world를 v8로 배포한 뒤에는 v7로 되돌리지 않는다 — 옛 migrate는 `challenges`를 모른다(깬 과제와 켜진 순간이동기가 사라진다). 문제가 생기면 고쳐서 다시 배포한다
- [ ] 수동 확인 (도전과제·순간이동기 4단계):
  - [ ] 아래 줄 "과제" 버튼으로 도전과제 6개가 지역 순서로 보이고, 맨 위에 "깬 과제 n/6", 과제마다 진행 "n/count"가 보인다
  - [ ] 마을 부두 끝에서 완벽하게 3마리를 낚으면 "도전과제 완료! 부두의 명수 — 바닷가 마을 순간이동기가 켜졌어요" 알림이 뜨고, 과제 목록에 "완료 · 순간이동기 켜짐"
  - [ ] 꺼진 순간이동기(등대) 앞에서 행동 버튼이 "살펴보기"이고, 누르면 "아직 꺼져 있어요"와 켜는 과제·진행이 보인다
  - [ ] 과제를 깬 지역의 등대는 등롱에 불이 들어오고 빛살이 깜빡인다. 행동 버튼이 "순간이동"이 된다
  - [ ] 두 곳을 켠 뒤 등대 창에 다른 지역과 요금이 보이고, "이동"을 누르면 요금만큼 골드가 줄고 페이드 뒤 도착 지역 등대 바로 앞에 선다. 도착하자마자 행동해도 창이 다시 열리지 않는다
  - [ ] 골드가 요금보다 적으면 "이동"이 꺼지고 "골드가 모자라요"가 뜬다
  - [ ] 섬과 오가는 요금(130G 안팎)이 다른 지역끼리(30G대)보다 훨씬 비싸다
  - [ ] 등대 위쪽으로 돌아가 서면 탑이 캐릭터를 가리고, 앞에 서면 캐릭터가 탑 앞에 보인다. 등대 칸은 걸어서 지나갈 수 없다
  - [ ] 프로필 기록 탭에 "도전과제 n개 (n/6)"가 뜬다
  - [ ] 마을 부두 끝→상점 문 앞 길, 상점·부두·선착장이 그대로다
  - [ ] 폰에서 순간이동 페이드와 등대 불빛 때문에 화면이 끊기지 않는다

큰 지도(아래 줄 "지도" 버튼·데스크톱 `M` 키, 지역 탭·길/낚시 자리 레이어·지금 잡히는/미발견만 필터·물고기 목록·잠긴 지역 카드·가는 길): 화면만 바뀐다. 서버 상태·행동·`logic.version`(8) 그대로, `world` 재배포 불필요, DB 변경 없음. **Vercel 배포만** 한다.
- [ ] 4단계(`logic.version` 8)가 먼저 배포돼 있어야 한다(순간이동기 표시가 `view.challenges`를 쓴다. 없으면 모든 이동기를 꺼짐으로 보여 줄 뿐 멈추지는 않는다)
- [ ] Vercel 배포가 끝나면 테스터에게 열어 둔 낚시 탭을 새로고침해 달라고 알린다
- [ ] 수동 확인 (큰 지도):
  - [ ] 폰(360px)에서 "지도"로 열리고, 지도 그림이 패널 폭 안에 또렷하게(흐리지 않게) 들어간다. 320px에서도 아래 줄 다섯 버튼(가방·도감·과제·지도·전체화면)이 한 줄에 들어간다
  - [ ] 탭 6개, 처음엔 지금 지역 탭. 안 연 지역은 "· 잠김"이고 누르면 지형 없이 잠김 카드(무엇·가격·어디서 여는지)와 물고기 실루엣만 보인다. [○○ 지도 보기]를 누르면 그 지역 탭의 잠긴 문(또는 선착장)이 골라진다
  - [ ] 마을에서 상점·북쪽 출구·선착장·등대·부두·해안 표시와 현재 위치(보는 방향 삼각형)가 보인다. "길"·"낚시 자리" 칩을 끄면 그 표시만 사라지고 현재 위치는 남는다
  - [ ] 해안을 누르면 물고기 목록: 잡은 물고기는 그림·이름·조건, 안 잡은 물고기는 실루엣·"???"·등급(흔함·드묾·희귀·전설)과 "지금" 칩만 보인다
  - [ ] "지금 잡히는"을 켜고 1분쯤 기다리면 머리줄 시각과 목록이 바뀐다. 지도에서 "지금" 표시였던 물고기가 실제로 그 자리에서 걸린다
  - [ ] "지금 잡히는 + 미발견만"이면 자리 배지·탭 숫자가 "지금 잡을 수 있는 새 물고기 수"가 되고 0인 자리는 흐리다
  - [ ] 지도에 찍힌 낚시 자리 표시로 걸어가 서면 그 자리 낚시가 된다(마을 부두·해안, 동굴 세 웅덩이, 숲 연못·폭포)
  - [ ] 강 북쪽 다리 해금 전에는 잠긴 문 표시(이름·가격·보유 골드), 해금 뒤에는 문 표시가 사라지고 북쪽 출구 표시가 나온다
  - [ ] 다른 지역 탭에 "가는 길: …"(섬은 "(배) 섬")이 보이고, 지금 지역 탭으로 돌아오면 그 길의 첫 출구(또는 선착장) 표시에 점선 테두리가 생긴다
  - [ ] 등대 표시: 꺼졌으면 과제 제목·설명·"진행 n/count", 켜졌고 지금 지역 등대도 켜졌으면 "○○ 이동기에서 오면 N G"(등대 창 요금과 같다). 두 곳 모두 켜졌으면 가는 길에 "순간이동기로도 갈 수 있어요"
  - [ ] 지도 안 어떤 버튼으로도 사기·배 타기·순간이동이 되지 않는다(탭 바꾸기만)
  - [ ] 데스크톱에서 `M` 키로 열고 닫힌다(한글 입력 상태에서도). 가방 등 다른 창이 열려 있거나 낚시 중이면 무시한다
  - [ ] 지도를 열고 탭을 여러 번 오가도 폰에서 끊기지 않는다(축소 그림은 지역마다 처음 한 번만 만든다)

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
- [ ] 중급 폰에서 마을↔숲(또는 강) 전환이 부드럽게 어두워졌다 밝아지고, 눈에 띄게 멈칫하지 않는다
- [ ] 강 다리·강가·연못·폭포에서 각각 던지면 그 지역의 어종이 걸린다
- [ ] 강·숲에서는 상점이 열리지 않는다 (상점은 마을에서만)
- [ ] 새로고침하면 마지막 지역·위치에서 시작한다
- [ ] 도감에 지역 탭(바닷가 마을·마을 강·숲)이 있고, 처음엔 현재 지역 탭이 열린다. 탭마다 'n/전체'가 보이고 맨 위는 'n/33종'이다. 못 잡은 전설은 테두리 칸에 '???'로 보인다
- [ ] 찌(`logic.version` 5): 상점에서 찌 5종이 보이고 구매하면 골드가 줄고 "보유 중 · 가방에서 낄 수 있어요"가 되고 끼면 "장착 중"이 된다. 낚싯대가 카본 미만이면 "사 둘 수 있고, 카본 낚싯대부터 낄 수 있어요"가 보인다
- [ ] 카본 낚싯대에서 찌 칸이 1개, 명장 낚싯대에서 2개다. 칸이 다 차면 안 낀 찌는 눌러지지 않는다
- [ ] 낚시 중(던진 뒤)에는 가방의 장비를 바꿀 수 없고 "낚시 중에는 바꿀 수 없어요"가 보인다
- [ ] 코르크 찌를 끼면 미니게임 바가 눈에 띄게 길어진다
- [ ] 함정 찌를 끼면 물고기를 놓쳐도 진행도가 덜 깎인다 (감소량 ×0.75)
- [ ] 가시 바늘을 끼면 물고기가 바 안에 있을 때 바가 물고기 쪽으로 끌려간다
- [ ] 회전 찌를 끼면 입질이 눈에 띄게 빨리 온다
- [ ] 데스크톱(1280px)에서 방향키로 걷고 스페이스로 낚시·상점이 된다
- [ ] 브라우저 콘솔에서 `world_saves`·`game_records`에 직접 update를 시도하면 거부되고, `supabase.from('world_saves').select('state')`는 행 없이 오류(권한 거부)를 돌려준다

## 지갑 배포 (1단계, `feat/wallet-core`)
설계 `docs/superpowers/specs/2026-11-23-wallet-design.md`, 계획 `docs/superpowers/plans/2026-11-24-wallet.md` 1단계. 이 브랜치는 지갑 핵심(Task 1·1b·2·3·5·6·7)만 담고, **낚시 골드 이전(Task 4)은 낚시 다듬기 PR 뒤 따로 들어온다**. 그래서 이 PR만 배포하면 어떤 게임도 아직 지갑을 쓰지 않는다(`WorldLogic.wallet`이 있는 게임 없음): 낚시는 지금처럼 세이브 안 골드를 쓰고, 헤더 배지·프로필 골드 줄은 **보이지 않는다**(등록부에 `wallet: true` 게임이 생기면 저절로 켜진다, `src/platform/wallet/enabled.ts`). `/admin` 골드 섹션은 처음부터 보인다.

- **권장**: Task 4(낚시 → 지갑, 낚시 `logic.version` = 다듬기 버전 + 1) PR과 같은 새벽(KST)에 이어서 배포한다. 이 PR만 먼저 배포해도 낚시·다른 게임은 그대로 동작하고 사용자 화면에는 바뀌는 것이 없다.

순서: DB push → `world` 함수 → Vercel. (테이블·함수만 더하므로 옛 `world`·옛 화면과 호환. 새 `world`는 `wallet`이 없는 게임에 지금과 똑같이 동작하고 응답에 `gold`를 넣지 않는다)

- [ ] `npx supabase@2 db push` → `20261123181545_wallet.sql`(테이블 `wallets`·`gold_ledger`, `_wallet_lock`·`_gold_move`(사이트 하루 상한)·`_economy()`, RPC `my_wallet`·`user_wallet`·`admin_gold_adjust`·`admin_gold_ledger`)
- [ ] `npx supabase@2 functions deploy world --no-verify-jwt` (지갑 잠금·이전·증감 경로. 낚시 로직은 바뀌지 않았으므로 버전 변화 없음)
- [ ] PR 머지 → Vercel 배포
- [ ] 수동 확인(미리보기 → 운영, 폰 390px·PC):
  - [ ] 헤더·프로필에 골드가 **보이지 않는다**(지갑 게임 없음). Task 4 뒤에는 헤더 오른쪽(아이디 메뉴 왼쪽)에 `N G`가 줄바꿈 없이(360px 폭 포함), 다른 계정 프로필 요약에 "골드 N G", 대기 계정에는 없음
  - [ ] `/admin` 골드 섹션: 내 아이디로 +100 → "반영했어요. … 잔액 100 G", 장부 맨 위에 "관리자 조정 +100"과 메모. −1000 → "잔액보다 많이 뺄 수 없어요", 메모 비움 → 브라우저가 막거나 "메모를 1~100자로 적어 주세요", 없는 아이디 → "없는 아이디예요". 끝나면 −100으로 되돌린다
  - [ ] 비관리자 계정 브라우저 콘솔: `supabase.from('gold_ledger').select('*')`는 본인 줄만, `supabase.from('wallets').update({balance: 1})`·`supabase.rpc('_gold_move', …)`는 거부
  - [ ] 낚시가 지금과 똑같이 동작한다(팔기·사기·새로고침 뒤 골드 유지). 네트워크 탭의 `world` 응답에 최상위 `gold`가 없다
- 확인 쿼리(SQL 편집기): `select count(*), sum(balance) from wallets;` `select reason, count(*), sum(delta) from gold_ledger group by 1;`

### Task 4(낚시 → 지갑) 배포 때 더할 것
Task 4 PR이 아래를 이 절에 옮겨 적는다(계획 Task 7 Step 1).
- 순서 동일. `world`를 낚시 지갑 버전으로 배포한 뒤에는 그 아래 버전으로 되돌리지 않는다. 옛 로직은 세이브에 gold가 없어 0으로 시작하고, 그 사이 번 골드는 다시 배포해도 **사라진다**: 이전 장부 `(user, 'migrate', 'fishing')`가 이미 있어 두 번째 이전이 무시되기 때문이다.
- 수동 확인: 낚시를 열기 전 헤더 `0 G`(지연 이전), 낚시를 열면 헤더와 낚시 화면 골드가 옛 골드와 같음, 새로고침해도 같음; 물고기 팔기 → 헤더가 바로 오름; 낚싯대·가방·찌·해금·순간이동·고급 장비 구매 → 헤더가 바로 내림, 모자라면 "골드가 부족해요".
- 확인 쿼리: 아직 이전되지 않은 세이브 `select count(*) from world_saves where game_id = 'fishing' and logic_version <= <LAST_GOLD_IN_SAVE>;`, 이전 합계 `select count(*), sum(delta) from gold_ledger where reason = 'migrate';`, 이중 이전 없음 `select user_id, count(*) from gold_ledger where reason = 'migrate' group by 1 having count(*) > 1;`(0행).
- 사이트 하루 상한 확인: 관리자 계정으로 낚시를 해 30,750을 넘긴 뒤 판매 → "오늘 골드 상한을 넘어 일부만 들어왔어요 (+… G / +… G)" 알림이 3초 뜨고 헤더 증가가 넘은 몫의 20%; 관리자 장부에 "(상한, 원래 …)" (2단계 PR 뒤에는 들어간 합계 41,000 위 몫은 4%).
- 일주일 뒤 사람별 하루 들어옴: `select user_id, (created_at at time zone 'Asia/Seoul')::date d, sum(delta) filter (where reason in ('world','free','daily_prize') and delta > 0) earned, sum(coalesce(raw_delta, delta)) filter (where reason in ('world','free') and delta > 0) asked from gold_ledger group by 1, 2 order by 2 desc, 3 desc;` → 하루 1시간쯤 하는 사람의 `earned` 중앙값이 `REF × 1.2~1.5`(24,600~30,750)에서 크게 벗어나면 설계 §4.1 목표(`REF × 40`)를 다시 본다.

## 지갑 배포 (2단계 자유 플레이 지급, `feat/wallet-free`)
설계 §5.6(2단 상한 개정)·§7, 계획 `docs/superpowers/plans/2026-11-24-wallet.md` 2단계(Task 8~12). 1단계(`feat/wallet-core`) 뒤에 쌓인 브랜치라 **1단계 PR이 먼저 머지·배포**돼야 한다. 낚시 다듬기 PR(#81)·Task 4(낚시 → 지갑)와는 독립이다(낚시 코드를 건드리지 않는다).

바뀌는 것:
- 마이그레이션 `20261123191621_soft_cap_tier2.sql`: 사이트 하루 상한 2단(들어간 합계 30,750까지 100%, 41,000까지 20%, 그 위 4%). `_economy()`·`_gold_move`를 `create or replace`.
- 마이그레이션 `20261123192423_free_gold.sql`: `game_modes.gold_per_point·gold_play_cap·gold_daily_cap`과 다섯 게임 수치, `free_plays` after insert 트리거 `free_plays_gold`.
- 화면: 자유 플레이 결과에 `+N G`(지갑을 쓰는 게임이 등록돼 있을 때만, 헤더 배지와 같은 조건 `walletEnabled()`).

**Task 4 전에 배포하면**: 트리거는 바로 지급하지만(지갑에 쌓임) 헤더·결과 화면에는 골드가 보이지 않는다. Task 4가 배포되면 낚시 옛 골드와 합쳐져 한꺼번에 보인다(사라지는 골드 없음). 사용자에게 "미니게임 골드가 미리 쌓이고 있다"고 알릴지는 운영 판단.

순서: DB push → PR 머지 → Vercel. (함수 재배포 없음: `play`·`world`는 바뀌지 않았다. `world`는 `_gold_move`를 SQL로 부르므로 2단 상한이 DB push 때 바로 적용된다)

- [ ] `npx supabase@2 db push` → 위 두 마이그레이션. 트리거가 이때부터 지급한다(옛 화면에서 끝낸 판도 받는다)
- [ ] PR 머지 → Vercel 배포
- [ ] 수동 확인(미리보기 → 운영, 폰 390px·PC). 결과 화면의 골드 줄은 Task 4 뒤에만 보이므로, Task 4 전이면 장부 쿼리로 확인한다:
  - [ ] 양치·몰래 수능·볼 런·네온 라이더·후알야 자유 플레이 한 판씩 → (Task 4 뒤) `+N G`와 헤더 증가가 같다. 관리자 장부에 `free` 줄과 게임 이름
  - [ ] 비행기 모드로 끝낸 판 → "+N G · 저장되면 골드가 들어가요", 온라인 복귀 뒤 장부에 한 번만 들어온다
  - [ ] 같은 게임 하루 상한: 관리자가 SQL로 오늘 free 장부 확인 `select game_id, sum(coalesce(raw_delta, delta)) asked, sum(delta) got from gold_ledger where reason = 'free' and created_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' group by 1;` → 게임마다 `asked` ≤ 20,500
  - [ ] 사이트 상한과 함께: 같은 날 30,750을 넘긴 계정(관리자 조정은 세지 않으니 낚시로)으로 자유 플레이 한 판 → `+N G · 오늘 상한을 넘어 일부만`, 헤더 증가가 N과 같다
  - [ ] 2단 상한: 오늘 들어간 합계가 41,000을 넘은 계정의 `free`·`world` 줄은 원래 금액의 4%(관리자 장부 "(상한, 원래 …)")
- 일주일 뒤 기준 플레이 확인: `select game_id, count(*), avg(score), percentile_cont(0.5) within group (order by score) from free_plays where played_at > now() - interval '7 days' group by 1;` → 설계 §7.3 표의 `avgScore`(양치 5.81, 몰래 수능 921, 볼 런 60, 네온 라이더 30, 후알야 6)에서 ±30% 넘게 벗어난 게임은 수치 조정 PR(manifest `gold`·새 마이그레이션 `update game_modes set gold_…`·`gold.test.ts` 함께). 특히 가정으로 둔 볼 런·네온 라이더·후알야.
- 일주일 뒤 한 판 시간 확인(가정 `playSec`: 볼 런 30, 네온 라이더 45, 후알야 90초 + 판 사이 5초): 같은 사람·게임의 연속 판 간격 중앙값 `select game_id, count(*), percentile_cont(0.5) within group (order by gap) from (select game_id, extract(epoch from played_at - lag(played_at) over (partition by user_id, game_id order by played_at)) gap from free_plays where played_at > now() - interval '7 days') t where gap between 1 and 600 group by 1;` → `playSec + 5`보다 30% 넘게 짧으면 시간당 골드가 그만큼 크다(예: 후알야 판당 30초면 약 REF × 3). 그 게임의 `perPoint`·`playCap`을 다시 잡는다(`gold.test.ts`의 `PLAY_SEC` 함께).
- 일주일 뒤 상한 모양 확인: 1단계 절의 "사람별 하루 들어옴" 쿼리에서 하루 여러 시간 하는 사람의 `earned`가 41,000 근처에 몰리고 4% 구간 수입이 거의 없으면 정상. 하루 1시간쯤 하는 사람의 `earned`가 41,000을 자주 넘으면(데일리 상금 등) 41,000·4%를 다시 본다(`economyPace.test.ts`로 날짜를 다시 재서).
- 낚시 다듬기 PR(#81)을 이 뒤에 머지할 때: 그 PR의 `fishing/gold.test.ts` "하루 여러 시간 (지금 값 기록)"(16.4·11.4일, 1단 20%로 계산)과 `econSim.ts`의 `DayPlan {cap, rate}`를 2단 상한(`SOFT_CAP_TIERS`)으로 바꾸고 기록 값을 25.0·22.0일로 고친다. 이 브랜치의 `src/games/economyPace.test.ts`는 그때 `econSim`을 직접 import해도 된다.

## 지갑 배포 (3단계 정산과 데일리 상금, `feat/wallet-daily`)
설계 §8·§8.1, 계획 `docs/superpowers/plans/2026-11-24-wallet.md` 3단계(Task 13~18). 2단계(`feat/wallet-free`) 뒤에 쌓인 브랜치라 **2단계 PR이 먼저 머지·배포**돼야 한다.

바뀌는 것:
- 마이그레이션 `20261123200515_settle_daily.sql`: `_economy()`에 상금 표·`stake_max`·`fee_max`, `contests.settled_at`(+ 부분 인덱스, **이미 끝난 대회는 모두 정산 표시 = 소급 없음**), `gold_ledger (ref, reason)` 인덱스, `_contest_payouts`·`settle_due`·`contest_prizes`·`user_prize_total`, `my_wallet()`을 volatile로 바꿔 처음에 `settle_due()`(실패는 경고만)와 `prizes`(최근 3일 받은 상금).
- 화면: 헤더 아래 상금 알림(처음 보는 상금만, 확인하면 다시 안 뜸), 끝난 대회 순위의 "상금" 열과 "내 상금", 프로필 "데일리 상금 누적". 모두 헤더 배지와 같은 조건(`walletEnabled()`)일 때만.

순서: DB push → PR 머지 → Vercel. (함수 재배포 없음: `play`·`duel`·`world`는 바뀌지 않았다)

- [ ] `npx supabase@2 db push`. **이 시각이 소급 없음의 기준이다**: 이미 끝난 데일리·대회는 표시만 되고 지급되지 않는다. 그날 진행 중인 데일리는 끝난 뒤(끝나고 1분이 지나 누군가 앱을 열 때) 지급된다. 그래서 **새벽(KST)에 push하면 전날 데일리(자정에 끝남)는 상금이 없다**. 전날 데일리까지 주려면 자정 전에 push한다(판단: 새벽 배포 권장을 따르고 하루치는 주지 않는다 — 소급 없음 원칙과 같다).
- [ ] 정산은 **새 화면(Vercel)부터** 돈다: 새 `Layout`은 지갑 화면이 보이든 말든(`walletEnabled()`와 무관하게) 승인 사용자면 앱 로드 때 `my_wallet()`(= `settle_due`)을 부른다. 옛 화면은 지갑 게임이 없으면 `my_wallet()`을 부르지 않으므로, DB push와 Vercel 사이에 끝난 데일리는 Vercel 뒤 첫 접속 때 정산된다(그 사이가 짧으면 문제없다).
- [ ] PR 머지 → Vercel 배포
- [ ] 수동 확인(다음 날, 미리보기 → 운영, 폰 390px·PC). Task 4(낚시 → 지갑) 전이면 지갑 화면이 없어 아래 화면 항목은 보이지 않지만 **정산·지급은 일어난다**(앱 로드 때 `my_wallet()`). 그때는 아래 확인 쿼리로 장부를 본다:
  - [ ] 첫 접속 → 헤더 잔액이 상금만큼 오르고, 헤더 아래 "데일리 상금이 들어왔어요 · 후알야 k등 +N G"와 "보기"·"확인". 확인 뒤 새로고침해도 안 뜬다
  - [ ] 어제 데일리 대회 페이지: 최종 순위에 "상금" 열(행동한 사람만, 6등 이하 +2,050 G), 표 위 "내 상금 +N G (k등)"
  - [ ] 다른 계정 프로필: "데일리 상금 누적 N G"
  - [ ] `/admin` 골드 장부: "데일리 상금" 줄, 메모 `k등`, 상한 표시 없음(상금은 줄지 않는다)
- 확인 쿼리: 정산 안 된 끝난 대회 `select count(*) from contests where settled_at is null and ends_at <= now() - interval '1 minute';`(누가 앱을 열었으면 0 근처. 계속 늘면 Postgres 로그에서 `settle_due:` 경고(실패한 대회 id)를 찾는다), 이중 지급 없음 `select user_id, ref, count(*) from gold_ledger where reason = 'daily_prize' group by 1, 2 having count(*) > 1;`(0행), 날마다 지급 `select ref, count(*), sum(delta) from gold_ledger where reason = 'daily_prize' group by 1 order by max(created_at) desc limit 7;`
- 데일리 게임이 늘면 `src/games/economy.test.ts`의 "데일리 게임 수 × 1등 상금 ≤ REF"가 넷째 게임에서 실패한다 → 설계 §8.1대로 상금 표를 줄이는 PR(`economy.ts`와 새 마이그레이션의 `_economy()` 함께).
- 되돌리기: 화면만 문제면 Vercel 이전 배포로. DB의 `my_wallet()` 정산은 그대로 둬도 옛 화면과 호환된다. 정산 자체를 멈춰야 하면 새 마이그레이션으로 `my_wallet()`에서 `settle_due()` 호출을 뺀다(지급된 장부는 그대로 두고, 잘못 지급됐으면 `admin_gold_adjust`).

## 지갑 배포 (4단계 대전 판돈, `feat/wallet-duel`)
설계 §9·§14, 계획 `docs/superpowers/plans/2026-11-24-wallet.md` 4단계(Task 19~22). 3단계(`feat/wallet-daily`) 뒤에 쌓인 브랜치라 **3단계 PR이 먼저 머지·배포**돼야 한다.

바뀌는 것:
- 마이그레이션 `20261124010000_duel_stake.sql`: `duel_matches.stake`(0~41,000, 기본 0, 만든 뒤 변경 금지, 숨김 게임은 0만 — 트리거 `_duel_stake_guard`), 지급·환불 트리거 `_duel_settle_stakes`(`status`가 `finished`/`void`로 바뀌는 순간 장부 `duel_stake` 줄 기준: 승자 독식 `duel_payout`, 무승부·무효 `duel_refund`, `user_id` 오름차순), `_duel_item`에 `stake`, `duel_list()`의 10분 만료 정리를 만든 사람 순서로 하나씩(`for update skip locked`) 바꿈.
- `duel` 함수: `create`의 `stake`(대국 insert 뒤 만든 사람 지갑에서 맡김), `join`의 `stake`(화면이 본 판돈, 다르면 409 `stake_mismatch { stake }`, 같으면 참가자 지갑에서 맡김), 잔액 부족 409 `not_enough_gold`(트랜잭션 전체 롤백), 잘못된 판돈·숨김 게임 판돈·**지갑 게임이 등록부에 없을 때 판돈 > 0** → 400 `invalid_stake`, 응답 `view.stake`.
- 화면: 대국 만들기의 판돈(빠른 선택 0·100·500·1,000·5,000·10,000 중 상한 이하 + 직접 입력, 상한 min(내 골드, 41,000), "내 골드 N G"; 지갑 게임이 없거나 숨김 게임이면 입력 없음), 대기실·내 대국 "판돈 N G"와 "N G 걸고 참가", 초대 링크 참가 확인 화면, 대국 머리 "판돈 N G" 배지·대기 중 "맡겼어요" 안내, 결과 "+N G"/"−N G"/"판돈을 돌려받았어요", 재대결은 같은 판돈. `/duel/local`은 그대로.

순서: DB push → `duel` 함수 → PR 머지 → Vercel.

- [ ] `npx supabase@2 db push`. 옛 함수·옛 화면은 `stake`를 모르므로 모든 대국이 판돈 0(기본값)으로 지금과 같다.
- [ ] `npx supabase@2 functions deploy duel --no-verify-jwt` (함수가 `src/games/economy.ts`·등록부를 번들한다). 새 함수 + 옛 화면: 옛 화면은 판돈을 보내지 않아 0으로만 만들고 0으로만 참가한다.
- [ ] PR 머지 → Vercel 배포
- [ ] **낚시 Task 4(지갑 이전) 전에는 판돈을 걸 수 없다**: 등록부에 `wallet: true` 게임이 없으면 함수가 판돈 > 0을 거절하고 화면에 입력이 없다(볼 수 없는 골드를 걸지 않게). 이때는 아래 수동 확인 가운데 "판돈 0 대국이 지금과 같다"만 본다. Task 4 배포 뒤 판돈 항목을 확인한다(Task 4 배포 때 `duel` 함수도 다시 배포해야 등록부의 `wallet: true`가 함수에 들어간다).
- [ ] 수동 확인(두 계정 A·B, 미리보기 → 운영, 폰 390px·PC):
  - [ ] 판돈 0 대국: 만들기·참가·끝까지 지금과 같다(골드 문구 없음)
  - [ ] A가 판돈 500 대국을 만든다 → A 헤더 −500, 대기 화면 "판돈 500 G를 맡겼어요"
  - [ ] B가 초대 링크를 연다 → "판돈 500 G를 걸고 참가할까요? · 이기면 1,000 G를 받아요 · 내 골드 N G" → 참가 → B 헤더 −500. 대기실(공개 대국)에서는 "500 G 걸고 참가" 버튼
  - [ ] 끝까지 둔다 → 이긴 쪽 결과 "+1,000 G"·헤더 +1,000, 진 쪽 "−500 G". 비기면 둘 다 "판돈을 돌려받았어요"
  - [ ] 판돈 대국을 만들고 "대국 취소" → 환불. 대기 10분 방치 → 대전 탭을 열거나 다음 대국을 만들 때 환불
  - [ ] 참가 뒤 아무도 두기 전에 기권 → 무효, 둘 다 환불. 둘 다 둔 뒤 기권·시간 초과 → 패배(상대가 1,000)
  - [ ] 잔액보다 큰 판돈 입력 → "골드가 부족해요"와 만들기 버튼 비활성. 잔액이 모자란 B의 링크 참가 → 확인 화면에 "골드가 부족해요", 참가 버튼 비활성
  - [ ] 숨김 대전 게임(관리자) 선택 → 판돈 입력 없음
  - [ ] `/admin` 골드 장부: "판돈"·"판돈 획득"·"판돈 환불" 줄(게임 이름 함께), 상한 표시 없음
- 확인 쿼리: 끝난 대국의 돈 보존 `select l.ref, sum(l.delta) from gold_ledger l where l.reason like 'duel\_%' and l.ref in (select id::text from duel_matches where status in ('finished','void')) group by 1 having sum(l.delta) <> 0;`(0행. 진 사람 계정이 지워진 대국만 예외로 나올 수 있다 — 그 사람 장부가 계정과 함께 지워진다), 진행 중 맡긴 돈 `select sum(-delta) from gold_ledger where reason = 'duel_stake' and ref in (select id::text from duel_matches where status in ('waiting','active'));`, 이중 지급 없음은 장부 unique가 보장한다.
- 되돌리기: 화면만 문제면 Vercel 이전 배포로(옛 화면은 판돈 0으로만 만들고, 판돈 > 0 대국에 링크로 들어오면 `stake_mismatch` 오류 문구). 함수 문제면 이전 `duel` 함수로 되돌린다 — 옛 함수는 `stake`를 모르고 맡기지 않으므로 판돈 0으로만 만든다. 이미 판돈이 걸린 대국은 트리거가 끝날 때 그대로 지급·환불한다(DB는 되돌리지 않는다).

## 문제가 생기면
아래를 그대로 보내 준다.
- 어느 단계(번호와 항목)에서 막혔는지
- 에러 전문(터미널 출력 또는 브라우저 콘솔·네트워크 탭의 응답 본문)
- 2번 확장 위치 쿼리 결과, 배포 실패 시 `functions deploy` 출력

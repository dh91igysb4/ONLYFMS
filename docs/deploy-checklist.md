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

- [ ] 마이그레이션: `npx -y supabase@2 db push` → `0010_yacht.sql`, `0011_duel.sql`
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

## 문제가 생기면
아래를 그대로 보내 준다.
- 어느 단계(번호와 항목)에서 막혔는지
- 에러 전문(터미널 출력 또는 브라우저 콘솔·네트워크 탭의 응답 본문)
- 2번 확장 위치 쿼리 결과, 배포 실패 시 `functions deploy` 출력

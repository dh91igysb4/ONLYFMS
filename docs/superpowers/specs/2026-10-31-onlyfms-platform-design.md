# ONLYFMS 플랫폼 설계

- 작성일: 2026-10-31
- 상태: 검토 대기
- 범위: 사이트(플랫폼)만. 실제 게임(Who Are Ya, 미싱 11 등)은 이 문서 범위 밖이며, 게임마다 별도 설계 문서로 붙인다.

## 1. 목표

친구들이 각자 계정으로 로그인해 축구 퀴즈 게임을 풀고, 사람별 기록과 리더보드로 경쟁하는 사이트를 만든다.

성공 기준:

1. 구글로 로그인하고 아이디를 정하면 "승인 대기" 상태가 되고, 관리자가 승인해야 게임·리더보드를 쓸 수 있다.
2. 데일리 문제는 모두에게 같으며, 정답은 그날이 끝나기 전에는 브라우저에 노출되지 않는다.
3. 데일리 기록은 서버(판정 함수)만 쓸 수 있어 브라우저에서 조작할 수 없다.
4. 자유 플레이 기록도 계정별로 서버에 쌓여 기기를 바꿔도 누적 통계가 남는다.
5. 리더보드에 오늘·주간·전체·자유 플레이 탭이 있고, 각 탭에서 게임별·합계 순위를 볼 수 있다.
6. 새 게임은 `src/games/<게임>/` 폴더 하나와 등록부 한 줄로 추가되며, 플랫폼 코드는 고치지 않는다.
7. 테스트용 게임 "숫자 맞히기"로 위 흐름 전체를 실제로 검증한다.

## 2. 사용자와 역할

| 역할 | 할 수 있는 것 |
|---|---|
| 비로그인 | 로그인 화면만 본다 |
| 승인 대기(pending) | 아이디 설정, 대기 화면. 게임·리더보드·프로필 접근 불가 |
| 거절(rejected) | 거절 안내 화면만 본다 |
| 승인(approved) | 게임(데일리·자유), 리더보드, 모든 승인 사용자의 프로필 |
| 관리자(is_admin) | 승인 사용자 권한 + `/admin`(승인·거절, 아이디 변경, 숨김 게임 보기) |

- 한 사람당 한 계정은 관리자 승인으로 보장한다. 같은 사람이 다른 구글 계정으로 다시 가입하면 관리자가 거절한다. 거절된 구글 계정은 재신청할 수 없다.
- 첫 관리자는 Supabase 대시보드에서 `profiles.is_admin = true`를 직접 설정한다. 이후 관리는 사이트에서 한다.
- 예상 규모는 친구 수십 명이며, Supabase·Vercel 무료 등급 안에서 운영한다.

## 3. 아키텍처

```
[브라우저: Vite + React + TS, Vercel 정적 배포]
    │  supabase-js (anon key + 로그인 세션)
    ├──▶ Supabase Auth (Google OAuth)
    ├──▶ Supabase Postgres (RLS로 권한 강제, 리더보드 집계 함수)
    └──▶ Supabase Edge Function `daily` (데일리 문제 출제·판정, service role로 기록)
```

- 별도 서버는 두지 않는다. 서버 측 로직은 Postgres 함수와 Edge Function 하나뿐이다.
- 데일리 판정은 Edge Function이, 자유 플레이 판정은 브라우저가 한다. 두 곳이 **같은 게임 로직 파일**을 쓴다(4장).
- 날짜 기준은 한국 시간(Asia/Seoul)이다. 데일리는 매일 00:00 KST에 바뀌고, 주간은 월요일 00:00 KST에 시작한다.

### 기술 선택

| 항목 | 선택 |
|---|---|
| 프론트엔드 | Vite, React 18, TypeScript, React Router |
| 백엔드 | Supabase (Auth, Postgres, Edge Functions), 리전 ap-northeast-2(서울) |
| 배포 | Vercel. 레포 연결, PR마다 미리보기 배포. SPA 라우팅을 위해 `vercel.json`에서 모든 경로를 `index.html`로 rewrite |
| 테스트 | Vitest(로직·컴포넌트), pgTAP(`supabase test db`, 권한 규칙) |
| 로컬 개발 | Supabase CLI 로컬 스택(`supabase start`) |

## 4. 폴더 구조와 게임 약속

```
src/
  app/                 라우팅, 레이아웃, 공통 스타일 토큰
  lib/supabase.ts      supabase 클라이언트
  platform/
    auth/              로그인, 세션, 아이디 설정, 대기·거절 화면, 접근 가드
    games/             게임 등록부 사용, 게임 목록, 데일리·자유 플레이 실행기
    leaderboard/       리더보드 화면
    profile/           프로필 화면
    admin/             관리자 화면
  games/
    index.ts           게임 등록부 (게임 모듈 배열)
    number-guess/      테스트용 게임
      manifest.ts
      logic.ts         순수 함수만. 브라우저·Edge Function 공용
      logic.test.ts
      Game.tsx         게임 화면 (데일리·자유 공통)
supabase/
  migrations/          스키마, RLS, 함수 (SQL)
  tests/               pgTAP 권한 테스트
  functions/daily/     데일리 Edge Function
docs/superpowers/specs/  설계 문서
CLAUDE.md              작업 규칙 (두 개발자와 각자의 Claude가 공통으로 따름)
```

### 4.1 게임 모듈 약속

모든 게임은 아래 두 가지를 내보낸다.

```ts
// manifest.ts
export const manifest = {
  id: 'number-guess',          // URL·DB에 쓰는 고정 식별자 (영문 소문자, 숫자, -)
  name: '숫자 맞히기',
  description: '1~100 사이 숫자를 8번 안에 맞힌다',
  hidden: true,                // true면 관리자에게만 보임
  modes: { daily: true, free: true },
}

// logic.ts — 외부 의존 없는 순수 함수. import 경로에 .ts 확장자 명시(Deno 호환)
export interface GameLogic<Puzzle, Guess, State, PublicState> {
  /** 난수 함수로 문제 하나를 고른다. 데일리는 서버가 시드 난수를 넘긴다. */
  pickPuzzle(rng: () => number): Puzzle
  /** 새 게임 상태 */
  initState(puzzle: Puzzle): State
  /** 추측 하나를 적용. 잘못된 추측이면 error를 돌려주고 상태는 바뀌지 않는다. */
  applyGuess(puzzle: Puzzle, state: State, guess: Guess): { state: State } | { error: string }
  isFinished(state: State): boolean
  /** 0~10점, 소수 첫째 자리까지 */
  score(state: State): number
  /** 총 시도 횟수 (동점 처리용) */
  guessCount(state: State): number
  /** 정답을 빼고 브라우저에 보낼 수 있는 상태 (끝나기 전 데일리 응답에 사용) */
  publicState(state: State): PublicState
  /** 게임이 끝났을 때 공개할 정답 정보 */
  reveal(puzzle: Puzzle): unknown
}
```

- 이 상태 기반 형태는 Who Are Ya(정답 1개, 추측 8번)와 미싱 11(정답 11개, 선수별 6번)을 모두 표현할 수 있다.
- 점수는 모든 게임이 10점 만점이다. 그래야 합계 순위가 한 게임에 쏠리지 않는다.
- 게임 화면(`Game.tsx`)은 실행기에서 `publicState`, 마지막 결과, `onGuess(guess)` 콜백을 받는다. 데일리인지 자유 플레이인지 몰라도 동작한다.

### 4.2 테스트용 게임: 숫자 맞히기

- 문제: 1~100 정수 하나.
- 추측: 정수. 범위 밖이거나 이미 낸 숫자면 오류.
- 피드백: 정답, 더 큼, 더 작음.
- 기회는 8번이고, 점수는 n번 만에 맞히면 `max(0, 11 - n)`(1번 10점 … 8번 3점), 실패하면 0점.
- `hidden: true`라서 관리자만 보인다. 실제 게임을 붙일 때 참고할 예시 코드 역할도 한다.

### 4.3 게임 로직 공유 방식

Edge Function(Deno)이 `src/games/<게임>/logic.ts`를 상대 경로로 직접 가져와 쓴다. 구현 계획의 첫 단계에서 Supabase 배포가 저장소의 이 경로를 번들에 포함하는지 확인한다. 포함하지 않으면 빌드 스크립트(`npm run sync:logic`)가 각 게임의 `logic.ts`를 `supabase/functions/_shared/games/<게임>/`로 복사하는 방식으로 바꾸고, 복사본은 직접 수정하지 않는다(CI에서 원본과 같은지 검사한다).

## 5. 데이터 모델

모든 테이블에 RLS를 켠다. 시각은 `timestamptz`, 날짜는 KST 기준 `date`다.

### profiles

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK, FK auth.users | |
| handle | citext UNIQUE NULL | 아이디. 정규식 `^[a-z0-9_]{3,16}$` (소문자로 저장) |
| status | enum `pending`/`approved`/`rejected` | 기본값 pending |
| is_admin | boolean | 기본값 false |
| created_at, approved_at | timestamptz | |
| approved_by | uuid NULL | 승인한 관리자 |

- `auth.users`에 사용자가 생기면 트리거가 `profiles` 행을 만든다(status = pending, handle = null).
- 구글 이메일·이름은 `auth.users`에만 있고, 관리자 함수로만 조회된다.

### daily_puzzles

| 컬럼 | 타입 | 설명 |
|---|---|---|
| game_id | text | PK(game_id, puzzle_date) |
| puzzle_date | date | |
| puzzle | jsonb | 정답 포함 문제 |
| created_at | timestamptz | |

- 그날 처음 데일리 요청이 들어오면 Edge Function이 만들어 저장한다. 이후 모든 사용자는 같은 행을 쓴다.
- 문제 선택: `HMAC-SHA256(DAILY_SECRET, game_id + ':' + puzzle_date)`에서 시드를 만들고, 그 시드 난수로 `pickPuzzle`을 호출한다. 직전 60일 안에 같은 문제가 나왔으면 시드 뒤에 `:1`, `:2`…를 붙여 다시 뽑는다(최대 20번).
- 문제를 저장해 두므로 나중에 게임 데이터를 갱신해도 지난 문제는 바뀌지 않는다.

### daily_attempts

| 컬럼 | 타입 | 설명 |
|---|---|---|
| user_id | uuid | PK(user_id, game_id, puzzle_date) |
| game_id | text | |
| puzzle_date | date | |
| state | jsonb | 게임 상태 전체 |
| finished | boolean | |
| score | numeric(3,1) | 0.0~10.0, 끝났을 때만 |
| guess_count | int | |
| started_at, finished_at | timestamptz | |

### free_plays

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | bigint identity PK | |
| user_id | uuid | |
| game_id | text | |
| variant | text | 난이도·리그 등 게임별 설정 문자열(없으면 'default') |
| solved | boolean | |
| score | numeric(3,1) | 0.0~10.0 |
| guess_count | int | |
| played_at | timestamptz | 기본값 now() |

## 6. 권한 규칙

헬퍼 함수 `is_approved()`와 `is_admin()`은 `auth.uid()`의 profiles 행을 본다(security definer).

| 대상 | 읽기 | 쓰기 |
|---|---|---|
| profiles | 본인 행, 또는 승인된 사용자가 다른 승인 사용자의 `id, handle, created_at` | 직접 수정 불가. 아이디는 `set_handle()`, 상태는 관리자 함수로만 |
| daily_puzzles | 승인 사용자가 `puzzle_date < 오늘(KST)`인 행만 (어제 이전 정답 공개) | 불가 (Edge Function만 service role로) |
| daily_attempts | 승인 사용자가 끝난(finished) 행 전체, 진행 중인 행은 본인 것만. 숨김 게임 행은 관리자만 | 불가 (Edge Function만) |
| free_plays | 승인 사용자 전체. 숨김 게임 행은 관리자만 | 승인된 본인만 INSERT. `score`는 0~10, `user_id = auth.uid()`. UPDATE·DELETE 불가 |

RPC 함수 (모두 security definer, 내부에서 호출자 권한 확인):

- `set_handle(new_handle)`: 본인 handle이 null일 때만, 형식·중복 검사 후 설정한다.
- `admin_list_users(status)`: 관리자만. id, handle, email, status, created_at을 돌려준다.
- `admin_set_status(user_id, status)`: 관리자만. 승인하면 approved_at과 approved_by를 기록한다. 자기 자신의 관리자 권한은 바꿀 수 없다.
- `admin_set_handle(user_id, new_handle)`: 관리자만.

## 7. 데일리 흐름

Edge Function `daily`는 POST 요청을 받는다. Authorization 헤더의 사용자 JWT로 호출자를 확인하고, 승인 사용자가 아니면 403을 돌려준다.

| action | 입력 | 동작 | 응답 |
|---|---|---|---|
| `open` | game_id | 오늘(KST) 문제를 찾고 없으면 만든다. 본인 attempt가 없으면 `initState`로 만든다 | publicState, finished, 끝났으면 score와 reveal |
| `guess` | game_id, guess, puzzle_date | `puzzle_date`가 오늘이 아니면 409(날짜가 바뀜). 끝난 게임이면 409. `applyGuess`로 오류가 나면 400과 메시지. 성공하면 state를 저장하고, 끝났으면 score·guess_count·finished_at을 기록 | publicState, finished, 끝났으면 score와 reveal |

- 등록부에 없거나 데일리를 지원하지 않는 game_id는 404로 처리한다.
- 같은 사용자의 동시 추측은 행 잠금(`SELECT … FOR UPDATE`)으로 순서를 보장한다.
- 하루에 게임당 한 번만 풀 수 있다(PK가 보장).

## 8. 리더보드와 통계

모두 SQL 함수(security definer, 승인 사용자만 호출 가능)로 계산하며 별도 집계 테이블은 두지 않는다.

| 함수 | 내용 |
|---|---|
| `lb_daily(day date, game text null)` | 그날 끝난 데일리. game이 null이면 사용자별 게임 점수 합계 |
| `lb_range(from date, to date, game text null)` | 기간 합산. 주간 탭은 이번 주 월~오늘, 전체 탭은 from = 2000-01-01 |
| `lb_free(game text null)` | 자유 플레이 사용자별 플레이 수, 정답 수, 정답률, 현재 연속 정답, 최고 연속 정답, 평균 점수 |
| `user_stats(handle)` | 프로필용. 게임별 데일리 참여일·평균 점수·최근 기록 30개, 자유 플레이 통계 |

- 정렬: 점수 합계 내림차순 → 총 시도 횟수 오름차순 → 마지막 완료 시각 오름차순.
- 자유 플레이 탭 정렬은 정답 수 내림차순 → 정답률 내림차순이다. 탭 안에서 기준을 바꿀 수 있다.
- 연속 정답은 게임별로 `played_at` 순서에서 마지막 실패 이후의 정답 수다. 게임 합계 탭에서는 연속 정답을 표시하지 않는다.
- 숨김 게임(`hidden: true`)의 기록은 관리자가 아닌 사용자에게 리더보드와 프로필에서 보이지 않는다. 숨김 목록은 DB 테이블 `hidden_games(game_id)`로 관리하고, 등록부와 맞추는 일은 마이그레이션에서 한다.

## 9. 화면

| 경로 | 내용 |
|---|---|
| `/login` | 구글 로그인 버튼 |
| `/welcome` | 아이디 설정(handle이 null일 때), 대기 안내(pending), 거절 안내(rejected) |
| `/` | 게임 카드 목록. 각 카드에 오늘 데일리 완료 여부와 점수, 자유 플레이 버튼 |
| `/play/:game/daily` | 데일리. 끝나면 결과와 오늘 순위로 가는 링크 |
| `/play/:game/free` | 자유 플레이. 한 판 끝날 때마다 free_plays에 저장 |
| `/leaderboard` | 탭: 오늘, 주간, 전체, 자유 플레이. 게임 선택(전체 합계 또는 게임별) |
| `/u/:handle` | 프로필과 통계 |
| `/admin` | 관리자만. 대기·승인·거절 목록, 승인·거절 버튼, 아이디 변경 |

- 로그인 상태와 profiles.status에 따라 라우트 가드가 `/login` 또는 `/welcome`으로 보낸다.
- 디자인은 현재 Who Are Ya 페이지의 짙은 보라 배경 톤을 공통 스타일 토큰으로 가져온다. 모바일 우선이다.

## 10. 오류 처리

- 데일리 판정 요청이 실패(네트워크, 5xx)하면 "다시 시도" 버튼을 보여준다. 서버가 저장에 성공하지 않은 추측은 시도로 세지 않는다. 같은 추측을 다시 보내는 것은 안전하다(서버 상태 기준으로 판정).
- 409(날짜가 바뀜)를 받으면 "새 데일리가 시작됐어요" 안내 후 `open`을 다시 부른다.
- 자유 플레이 기록 저장이 실패하면 브라우저 저장소에 대기열로 보관하고, 다음 접속 때 다시 보낸다(최대 50개).
- 승인이 취소된 사용자의 요청은 RLS·함수에서 거부되며, 화면은 `/welcome`으로 이동한다.

## 11. 테스트

- 게임 로직: `logic.test.ts`(Vitest). 숫자 맞히기의 판정, 오류, 종료, 점수 경계값(1번, 8번, 실패)을 검사한다.
- 권한: pgTAP으로 다음을 검사한다. 대기 사용자의 free_plays 쓰기 거부, 남의 기록 쓰기 거부, daily_attempts 직접 쓰기 거부, 오늘 daily_puzzles 읽기 거부, 비관리자의 관리자 함수 거부, handle 중복·형식 거부.
- Edge Function: Deno 테스트로 open → guess 반복 → 종료 → 재추측 409, 날짜 불일치 409, 미승인 403을 검사한다.
- 리더보드: 고정 시드 데이터로 `lb_daily`, `lb_range`, `lb_free`의 정렬과 동점 처리를 pgTAP으로 검사한다.
- PR마다 GitHub Actions에서 Vitest와 타입 검사를 돌린다. DB 테스트는 로컬에서 `supabase test db`로 돌린다.

## 12. 공동 개발과 운영

- main 브랜치를 보호한다. 모든 변경은 PR로 올리고, Vercel 미리보기에서 확인한 뒤 머지한다.
- `CLAUDE.md`에 폴더 규칙, 게임 추가 절차(폴더 생성 → manifest·logic·test·Game → 등록부 한 줄 → 숨김으로 머지 → 공개), 커밋·PR 규칙, 금지 사항(비밀값 커밋 금지, 플랫폼 코드에 게임별 분기 금지)을 적는다.
- 비밀값:
  - Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (공개용 키)
  - Supabase Edge Function 시크릿: `DAILY_SECRET`
  - Google OAuth 클라이언트는 Supabase 대시보드에 등록하고, 허용 리디렉션에 운영 주소·Vercel 미리보기 와일드카드·localhost를 넣는다.
- DB 변경은 마이그레이션 파일로만 한다. 대시보드에서 직접 스키마를 바꾸지 않는다.
- 배포: 이 레포의 main이 onlyfms.vercel.app으로 배포되도록 Vercel 프로젝트를 연결한다. 연결 시점에 현재의 Who Are Ya 단독 페이지는 새 사이트로 대체된다.

## 13. 범위 밖

- 실제 게임(Who Are Ya, 미싱 11 등)과 그 데이터. 게임마다 별도 설계로 붙인다.
- 사용자가 직접 아이디 바꾸기, 계정 삭제 화면(관리자가 Supabase 대시보드에서 처리)
- 부정행위 방지 중 데일리 서버 판정 이외의 것(예: 여러 기기 동시 사용 탐지)

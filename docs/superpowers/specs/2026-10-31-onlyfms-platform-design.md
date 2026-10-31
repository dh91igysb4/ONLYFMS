# ONLYFMS 플랫폼 설계

- 작성일: 2026-10-31
- 상태: 검토 대기 (개정 2: 대회 추가, 게임 모듈 보강)
- 범위: 사이트(플랫폼)만. 실제 게임(Who Are Ya, 미싱 11 등)은 이 문서 범위 밖이며, 게임마다 별도 설계 문서로 붙인다.

## 1. 목표

친구들이 각자 계정으로 로그인해 축구 퀴즈 게임을 풀고, 사람별 기록·리더보드·대회로 경쟁하는 사이트를 만든다.

성공 기준:

1. 구글로 로그인하고 아이디를 정하면 "승인 대기" 상태가 되고, 관리자가 승인해야 게임·리더보드·대회를 쓸 수 있다.
2. 데일리와 대회의 문제는 참가자 모두에게 같으며, 정답은 끝나기 전에는 브라우저에 노출되지 않는다.
3. 데일리·대회 기록은 서버(판정 함수)만 쓸 수 있어 브라우저에서 조작할 수 없다. 시간 관련 판정은 서버 시각만 쓴다.
4. 자유 플레이 기록도 계정별로 서버에 쌓여 기기를 바꿔도 누적 통계가 남는다.
5. 리더보드에 오늘·주간·전체·대회·자유 플레이 탭이 있고, 각 탭에서 게임별·합계 순위를 볼 수 있다.
6. 승인된 사용자는 누구나 대회를 열 수 있다. 관리자가 연 공식 대회만 누적 리더보드에 반영된다.
7. 새 게임은 `src/games/<게임>/` 폴더 하나와 등록부 한 줄로 추가되며, 플랫폼 코드는 고치지 않는다.
8. 테스트용 게임 "숫자 맞히기"로 데일리·대회·자유 플레이·힌트·포기 흐름 전체를 실제로 검증한다.

## 2. 사용자와 역할

| 역할 | 할 수 있는 것 |
|---|---|
| 비로그인 | 로그인 화면만 본다 |
| 승인 대기(pending) | 아이디 설정, 대기 화면. 게임·리더보드·대회·프로필 접근 불가 |
| 거절(rejected) | 거절 안내 화면만 본다 |
| 승인(approved) | 게임(데일리·자유), 대회 참가·개설(친선), 리더보드, 승인 사용자 프로필 |
| 관리자(is_admin) | 승인 사용자 권한 + 공식 대회 개설, 모든 대회 취소, 가입 승인·거절, 아이디 변경, 문제 은행 업로드, 숨김 게임 보기 |

- 한 사람당 한 계정은 관리자 승인으로 보장한다. 같은 사람이 다른 구글 계정으로 다시 가입하면 관리자가 거절한다. 거절된 구글 계정은 재신청할 수 없다.
- 첫 관리자는 Supabase 대시보드에서 `profiles.is_admin = true`를 직접 설정한다. 이후 관리는 사이트에서 한다.
- 예상 규모는 친구 수십 명이며, Supabase·Vercel 무료 등급 안에서 운영한다.

## 3. 아키텍처

```
[브라우저: Vite + React + TS, Vercel 정적 배포]
    │  supabase-js (publishable key + 로그인 세션)
    ├──▶ Supabase Auth (Google OAuth)
    ├──▶ Supabase Postgres (RLS로 권한 강제, 대회 개설·리더보드 함수)
    └──▶ Supabase Edge Function `play` (데일리·대회 문제 출제와 판정, service role로 기록)
```

- 별도 서버는 두지 않는다. 서버 측 로직은 Postgres 함수와 Edge Function 하나뿐이다.
- **데일리는 대회의 한 종류다.** 매일 게임마다 자동으로 열리는 "문제 1개, 하루 동안 진행되는 대회"로 다룬다. 출제·판정·기록·순위 계산은 데일리와 커스텀 대회가 같은 코드를 쓴다.
- 데일리·대회 판정은 Edge Function이, 자유 플레이 판정은 브라우저가 한다. 두 곳이 **같은 게임 로직 파일**을 쓴다(4장).
- 날짜 기준은 한국 시간(Asia/Seoul)이다. 데일리는 매일 00:00 KST에 바뀌고, 주간은 월요일 00:00 KST에 시작한다.

### 기술 선택

| 항목 | 선택 |
|---|---|
| 프론트엔드 | Vite, React 18, TypeScript, React Router |
| 백엔드 | Supabase (Auth, Postgres, Edge Functions), 리전 ap-northeast-2(서울) |
| 배포 | Vercel. 레포 연결, PR마다 미리보기 배포. SPA 라우팅을 위해 `vercel.json`에서 모든 경로를 `index.html`로 rewrite |
| 테스트 | Vitest(로직·컴포넌트), pgTAP(`supabase test db`, 권한 규칙·집계), Deno test(Edge Function) |
| 로컬 개발 | Supabase CLI 로컬 스택(`supabase start`) |

## 4. 폴더 구조와 게임 약속

```
src/
  app/                 라우팅, 레이아웃, 공통 스타일 토큰
  lib/supabase.ts      supabase 클라이언트
  platform/
    auth/              로그인, 세션, 아이디 설정, 대기·거절 화면, 접근 가드
    games/             게임 등록부 사용, 게임 목록, 문제 실행기(데일리·대회·자유 공통)
    contests/          대회 목록, 개설, 대기실·진행·결과 화면
    leaderboard/       리더보드 화면
    profile/           프로필 화면
    admin/             관리자 화면
  games/
    index.ts           게임 등록부 (게임 모듈 배열)
    <game-id>/         게임 하나 (예: who-are-ya). 테스트 전용 숫자 맞히기는 src/test-fixtures/test-guess/ (운영 등록부·DB에 없음, 0008에서 제거)
      manifest.ts
      logic.ts         순수 함수만. 브라우저·Edge Function 공용
      logic.test.ts
      Game.tsx         게임 화면 (데일리·대회·자유 공통)
supabase/
  migrations/          스키마, RLS, 함수 (SQL)
  tests/               pgTAP 테스트
  functions/play/      출제·판정 Edge Function
docs/superpowers/specs/  설계 문서
CLAUDE.md              작업 규칙 (두 개발자와 각자의 Claude가 공통으로 따름)
```

### 4.1 manifest

```ts
export const manifest = {
  id: 'number-guess',          // URL·DB에 쓰는 고정 식별자 (영문 소문자, 숫자, -)
  name: '숫자 맞히기',
  description: '1~100 사이 숫자를 8번 안에 맞힌다',
  hidden: true,                // true면 관리자에게만 보임
  modes: { daily: true, contest: true, free: true },
  puzzleSource: 'generate',    // 'generate' = 서버가 pickPuzzle로 출제, 'bank' = 문제 은행에서 출제 (4.4)
  dailyTimeLimitSec: 600,      // 데일리 제한 시간(초). 처음 연 순간부터 센다. null이면 자정까지. 대회에는 적용 안 함
  options: [                   // 자유 플레이·대회에서 고를 수 있는 설정 (없으면 빈 배열)
    { key: 'range', label: '범위', choices: [{ value: '100', label: '1~100' }, { value: '1000', label: '1~1000' }], default: '100' },
  ],
}
```

### 4.2 logic

```ts
// logic.ts — 외부 의존 없는 순수 함수. import 경로에 .ts 확장자 명시(Deno 호환)

/** 서버가 넘기는 시각 정보(밀리초). 자유 플레이에서는 브라우저 시각을 쓴다. */
export type Ctx = { now: number; startedAt: number; deadline: number | null }

/** 모든 게임이 반드시 처리해야 하는 플랫폼 행동 */
export type PlatformAction = { type: 'give_up' }

export interface GameLogic<Puzzle, Action, State, PublicState> {
  /** 판정 규칙을 바꿀 때마다 1씩 올린다 (4.5) */
  version: number
  /** 난수 함수와 설정으로 문제 하나를 고른다 */
  pickPuzzle(rng: () => number, options: Record<string, string>): Puzzle
  /** 문제의 고유 키. 같은 문제가 반복 출제되지 않게 하는 데 쓴다 */
  puzzleKey(puzzle: Puzzle): string
  initState(puzzle: Puzzle, ctx: Ctx): State
  /** 행동 하나를 적용한다. 잘못된 행동이면 error를 돌려주고 상태는 바뀌지 않는다 */
  apply(puzzle: Puzzle, state: State, action: Action | PlatformAction, ctx: Ctx): { state: State } | { error: string }
  isFinished(state: State, ctx: Ctx): boolean
  /** 0~10점, 소수 첫째 자리. 끝나지 않은 상태에서는 "지금 포기했다면 받을 점수"를 돌려준다 */
  score(state: State, ctx: Ctx): number
  /** 동점 처리용 행동 수 (보통 추측 횟수) */
  actionCount(state: State): number
  /** 정답을 빼고 브라우저에 보낼 수 있는 상태 */
  publicState(state: State): PublicState
  /** 끝났을 때 공개할 정답 정보 */
  reveal(puzzle: Puzzle): unknown
}
```

- `Action`은 게임마다 정한다. 예: `{ type: 'guess', value: number } | { type: 'hint' }`. 힌트처럼 추측이 아닌 행동도 여기 넣는다.
- `give_up`은 모든 게임이 처리해야 한다. 포기하면 `isFinished`가 true가 된다.
- 시간 제한이 있는 게임은 `ctx.now`와 `ctx.deadline`으로 판단한다. 서버에서는 항상 서버 시각이 들어간다.
- 이 형태는 정답 1개 게임(Who Are Ya), 정답 여러 개 게임(미싱 11, Connections, Tenable), 칸 채우기(Tiki-Taka-Toe 1인용), 시간 게임, 끝없이 이어가는 게임을 모두 표현할 수 있다.
- 게임 화면(`Game.tsx`)은 실행기에서 `publicState`, 마지막 결과, `onAction(action)` 콜백, 남은 시간(있으면)을 받는다. 데일리·대회·자유 플레이 중 어느 것인지 몰라도 동작한다.

### 4.3 점수 환산 가이드 (10점 만점)

모든 게임은 문제당 10점 만점이다. 그래야 합계 순위가 한 게임에 쏠리지 않는다.

| 게임 유형 | 권장 환산 |
|---|---|
| 기회 n번 안에 맞히기 | 적게 쓸수록 높게. 실패 0점 |
| 정답 여러 개 | 맞힌 비율 × 10 |
| 끝없이 이어가기 | 상한을 정하고 비례 (예: 연속 20개 이상이면 10점) |
| 시간 점수 | 기본 점수에 남은 시간 비율을 곱하거나 더하되, 합이 10점을 넘지 않게 |

### 4.4 출제 방식

- **generate**: 서버가 `pickPuzzle`로 출제한다. 문제 풀 데이터가 Edge Function에 포함돼야 하므로, 데이터가 작은 게임(대략 수 MB 이하)에 쓴다.
- **bank**: 관리자가 미리 만든 문제 목록(JSON 배열)을 `/admin`에서 `puzzle_bank`에 올린다. 출제 시 그 게임의 미사용 문제 중 시드 순서로 하나를 꺼낸다. 라인업처럼 데이터가 큰 게임에 쓴다. 남은 문제가 30개 미만이면 관리자 화면에 경고를 띄운다.
- 어느 방식이든 **문제 하나에 판정에 필요한 정보가 모두 들어 있어야 한다.** 판정 때 별도 데이터 조회를 하지 않는다.

### 4.5 로직 버전

- 데일리·대회 기록과 자유 플레이 기록에는 출제 당시의 `logic.version`을 저장한다.
- 진행 중인 기록의 버전이 현재 버전과 다르면, Edge Function은 그 기록을 이어서 진행하지 않는다. 기록을 그 시점 점수로 확정(포기 처리)하고 화면에 "규칙이 바뀌어 이 문제는 종료됐어요"를 보여준다. 그래서 규칙 변경은 진행 중인 데일리가 적은 새벽에 배포하는 것을 권장한다.

### 4.6 테스트용 게임: 숫자 맞히기

- 문제: 설정 범위(1~100 또는 1~1000)의 정수 하나. `puzzleKey`는 `"범위:숫자"`.
- 행동: `guess`(정수, 범위 밖이거나 이미 낸 숫자면 오류), `hint`(정답이 짝수인지 홀수인지 공개, 1회, 쓰면 최종 점수 −1), `give_up`.
- 피드백: 정답, 더 큼, 더 작음.
- 기회는 8번. 점수는 n번 만에 맞히면 `max(0, 11 - n)`(1번 10점 … 8번 3점)에서 힌트를 썼으면 1점을 뺀다(최소 0). 실패·포기는 0점.
- `hidden: true`라서 관리자만 보인다. 실제 게임을 붙일 때 참고할 예시 코드 역할도 한다.

### 4.7 게임 로직 공유 방식

Edge Function(Deno)이 `src/games/<게임>/logic.ts`를 상대 경로로 직접 가져와 쓴다. 구현 계획의 첫 단계에서 Supabase 배포가 저장소의 이 경로를 번들에 포함하는지 확인한다. 포함하지 않으면 빌드 스크립트(`npm run sync:logic`)가 각 게임의 `logic.ts`를 `supabase/functions/_shared/games/<게임>/`로 복사하는 방식으로 바꾸고, 복사본은 직접 수정하지 않는다(CI에서 원본과 같은지 검사한다).

## 5. 대회

### 5.1 종류

| 종류 | 누가 여나 | 누적 리더보드 반영 | 참가 |
|---|---|---|---|
| daily | 시스템이 매일 게임마다 자동 | 오늘·주간·전체 | 승인 사용자 전체 |
| official | 관리자 | 주간·전체·대회 탭 | 공개 또는 초대 링크 |
| friendly | 승인 사용자 누구나 | 반영 안 함. 대회 페이지·참가자 프로필에만 | 공개 또는 초대 링크 |

### 5.2 개설 규칙 (official, friendly)

- 제목(1~40자), 시작 시각, 제한 시간, 공개 범위(공개 / 초대 링크), 문제 목록을 정한다.
- 문제 목록: 게임과 그 게임의 설정(options)을 고르고 문제 수를 정한다. 여러 게임을 섞을 수 있다. 전체 1~10문제이며, `modes.contest`가 true인 게임만 고를 수 있다.
- 시작 시각은 지금부터 5분 이후, 30일 이내다. 제한 시간은 5분~180분이다. 대회 하나의 시작~종료 구간 전체에 적용되며 모든 참가자의 종료 시각이 같다.
- 시작 전에는 연 사람(또는 관리자)이 수정·취소할 수 있다. 시작 후에는 바꿀 수 없고, 관리자만 취소할 수 있다. 취소된 대회의 기록은 순위에 반영되지 않는다.
- 초대 링크 대회는 개설 시 무작위 초대 코드(10자)를 만든다. 코드를 아는 사람만 참가할 수 있다.

### 5.3 진행

- 상태는 시각으로 정해진다: 예정(시작 전) → 진행 중 → 종료. 취소되면 취소.
- **문제는 시작 전에 만들지 않는다.** 시작 후 첫 참가자가 문제를 열 때 Edge Function이 행 잠금을 걸고 출제해 저장한다. 그래서 시작 전에는 서버에도 정답이 없다.
- 늦게 들어와도 참가할 수 있다. 종료 시각은 같다.
- 참가자는 대회 안의 문제를 아무 순서로나 풀 수 있다. 문제마다 기록이 따로 생긴다.
- 진행 중에는 대회 순위표가 5초마다 새로고침된다. 다른 참가자의 점수, 끝낸 문제 수만 보이고 추측 내용은 보이지 않는다.
- 종료 시각이 지나면 모든 행동이 거부되고, 정답과 최종 순위가 공개된다. 끝내지 못한 문제는 마지막 행동 때 저장된 점수(4.2의 "지금 포기했다면 받을 점수")로 확정된다. 그래서 종료 처리를 위한 예약 작업이 필요 없다.

### 5.4 데일리

- 게임마다 하루에 하나씩, 00:00~24:00 KST 동안 열리는 문제 1개짜리 대회다.
- 그날 누군가 처음 데일리를 열 때 대회 행과 문제가 함께 만들어진다(`daily_key = 게임:날짜`로 중복 방지).
- 문제는 하루에 게임당 한 번만 풀 수 있고, 다음 날 정답이 공개된다.

### 5.5 반복 출제 방지와 시드

- 시드: `HMAC-SHA256(PLAY_SECRET, 대회id + ':' + 문제위치 + ':' + 재시도번호)`. 이 시드로 만든 난수를 `pickPuzzle`에 넘긴다.
- 같은 게임에서 직전 60일 안에 출제된 `puzzleKey`와 겹치면 재시도 번호를 올려 다시 뽑는다(최대 20번). 20번 모두 겹치면 마지막 결과를 쓴다.

## 6. 데이터 모델

모든 테이블에 RLS를 켠다. 시각은 `timestamptz`, 날짜는 KST 기준 `date`다.

### profiles

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK, FK auth.users | |
| handle | citext UNIQUE NULL | 아이디. 정규식 `^[a-z0-9_가-힣]{2,16}$` (NFC·소문자로 저장, 0009에서 한글 허용) |
| status | enum `pending`/`approved`/`rejected` | 기본값 pending |
| is_admin | boolean | 기본값 false |
| created_at, approved_at | timestamptz | |
| approved_by | uuid NULL | 승인한 관리자 |

- `auth.users`에 사용자가 생기면 트리거가 `profiles` 행을 만든다(status = pending, handle = null).
- 구글 이메일·이름은 `auth.users`에만 있고, 관리자 함수로만 조회된다.

### contests

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| kind | enum `daily`/`official`/`friendly` | |
| title | text | 데일리는 "게임이름 · 날짜" |
| created_by | uuid NULL | 데일리는 null |
| visibility | enum `public`/`invite` | 데일리는 public |
| invite_code | text UNIQUE NULL | invite일 때만 |
| starts_at, ends_at | timestamptz | |
| cancelled_at | timestamptz NULL | |
| daily_key | text UNIQUE NULL | 데일리만. `게임id:YYYY-MM-DD` |
| created_at | timestamptz | |

### contest_items

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| contest_id | uuid FK | |
| position | int | 1부터. UNIQUE(contest_id, position) |
| game_id | text | |
| options | jsonb | 게임 설정 |
| puzzle | jsonb NULL | 시작 후 첫 열람 때 채움 |
| puzzle_key | text NULL | |
| logic_version | int NULL | 출제 당시 버전 |
| generated_at | timestamptz NULL | |

### contest_entries

| 컬럼 | 타입 | 설명 |
|---|---|---|
| contest_id, user_id | PK | |
| joined_at | timestamptz | |

### attempts

| 컬럼 | 타입 | 설명 |
|---|---|---|
| item_id, user_id | PK | 문제당 한 번 |
| state | jsonb | 게임 상태 전체 |
| logic_version | int | |
| finished | boolean | |
| score | numeric(3,1) | 0.0~10.0. 매 행동 후 갱신 |
| action_count | int | |
| started_at, last_action_at, finished_at | timestamptz | |

### puzzle_bank

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | bigint identity PK | |
| game_id | text | |
| puzzle | jsonb | |
| puzzle_key | text | UNIQUE(game_id, puzzle_key) |
| used_item_id | uuid NULL | 출제되면 기록 |
| uploaded_at | timestamptz | |

### free_plays

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | bigint identity PK | |
| user_id | uuid | |
| game_id | text | |
| options | jsonb | 게임 설정 |
| logic_version | int | |
| solved | boolean | |
| score | numeric(3,1) | 0.0~10.0 |
| action_count | int | |
| played_at | timestamptz | 기본값 now() |

### hidden_games

| 컬럼 | 타입 | 설명 |
|---|---|---|
| game_id | text PK | 등록부에서 hidden인 게임. 마이그레이션으로 맞춘다 |

## 7. 권한 규칙

헬퍼 함수 `is_approved()`, `is_admin()`, `can_see_contest(contest_id)`는 `auth.uid()` 기준으로 판단한다(security definer). `can_see_contest`는 승인 사용자이면서, 공개 대회이거나 참가자이거나 관리자일 때 참이다. 숨김 게임만 들어 있는 대회는 관리자만 볼 수 있다.

| 대상 | 읽기 | 쓰기 |
|---|---|---|
| profiles | 본인 행, 또는 승인된 사용자가 다른 승인 사용자의 `id, handle, created_at` | 직접 수정 불가. 아이디는 `set_handle()`, 상태는 관리자 함수로만 |
| contests | `can_see_contest`. 초대 대회는 참가자와 관리자만. `invite_code`는 연 사람과 관리자에게만 | `create_contest()`, `update_contest()`, `cancel_contest()` 함수로만 |
| contest_items | `can_see_contest`이면서, puzzle·puzzle_key는 대회 종료 후에만 | 함수와 Edge Function만 |
| contest_entries | `can_see_contest` | `join_contest()` 함수로만 |
| attempts | 본인 기록은 언제나. 다른 사람 기록은 대회 종료 후 `can_see_contest`일 때만(끝낸 기록의 상태에는 정답이 들어 있으므로 종료 전에는 `lb_contest`의 점수만 공개). 숨김 게임 기록은 관리자만 | Edge Function만 |
| puzzle_bank | 관리자만 | 관리자만 (업로드 함수) |
| free_plays | 승인 사용자 전체. 숨김 게임 기록은 관리자만 | 승인된 본인만 INSERT. `score`는 0~10, `user_id = auth.uid()`. UPDATE·DELETE 불가 |

RPC 함수 (모두 security definer, 내부에서 호출자 권한 확인):

- `set_handle(new_handle)`: 본인 handle이 null일 때만, 형식·중복 검사 후 설정한다.
- `create_contest(title, starts_at, duration_min, visibility, items, official)`: 승인 사용자. `official = true`는 관리자만. 5.2의 검증을 모두 한다. 대회 id(초대면 코드 포함)를 돌려준다.
- `update_contest(id, …)`, `cancel_contest(id)`: 5.2 규칙대로.
- `join_contest(id, invite_code null)`: 승인 사용자. 취소·종료된 대회는 거부. 초대 대회는 코드가 맞아야 한다.
- `admin_list_users(status)`: 관리자만. id, handle, email, status, created_at.
- `admin_set_status(user_id, status)`: 관리자만. 승인하면 approved_at, approved_by 기록. 자기 자신은 바꿀 수 없다.
- `admin_set_handle(user_id, new_handle)`: 관리자만.
- `admin_upload_puzzles(game_id, puzzles jsonb)`: 관리자만. 중복 puzzle_key는 건너뛰고, 추가된 개수와 건너뛴 개수를 돌려준다.

## 8. 출제·판정 흐름 (Edge Function `play`)

POST 요청이며, Authorization 헤더의 사용자 JWT로 호출자를 확인한다. 승인 사용자가 아니면 403.

| action | 입력 | 동작 | 응답 |
|---|---|---|---|
| `daily` | game_id | 오늘 데일리 대회가 없으면 만든다 | contest_id, item_id |
| `open` | item_id | `can_see_contest`가 아니거나 참가하지 않았으면 403(데일리는 자동 참가). 시작 전이면 409. 문제가 없으면 출제(행 잠금). 본인 기록이 없고 대회가 진행 중이면 `initState`로 만든다 | publicState, finished, score, 남은 시간. 끝났거나 대회 종료면 reveal |
| `act` | item_id, action | 대회 종료·취소면 409. 이미 끝난 기록이면 409. 버전이 다르면 4.5대로 확정 후 409. `apply` 오류면 400과 메시지. 성공하면 state, score, action_count, last_action_at 저장. 끝났으면 finished, finished_at 기록 | open과 같음 |

- 등록부에 없거나 해당 모드를 지원하지 않는 game_id는 404.
- 같은 사용자의 동시 행동은 attempts 행 잠금(`SELECT … FOR UPDATE`)으로 순서를 보장한다.
- `Ctx`의 now는 서버 시각, startedAt은 기록의 started_at, deadline은 대회 ends_at이다. 단 데일리이고 manifest에 `dailyTimeLimitSec`이 있으면 deadline은 min(started_at + 제한 시간, ends_at)이고, 화면에 주는 `PlayView.ends_at`도 이 값이다.
- 데일리 제한 시간이 지나면 다음 open/act에서 서버가 기록을 저장된 점수(그 시점 포기 점수)로 마감 시각(finished_at = deadline)에 확정한다. act는 409 `timeout`(화면 포함), open은 끝난 화면을 200으로 준다. 브라우저는 남은 시간이 0이 되면 한 번 다시 열어 결과를 받는다.

## 9. 리더보드와 통계

모두 SQL 함수(security definer, 승인 사용자만 호출 가능)로 계산하며 별도 집계 테이블은 두지 않는다. 취소된 대회와 숨김 게임(관리자가 아닐 때)은 제외한다.

| 함수 | 내용 |
|---|---|
| `lb_daily(day date, game text null)` | 그날 데일리. game이 null이면 사용자별 게임 점수 합계 |
| `lb_range(from date, to date, game text null)` | 기간 합산(데일리 + 종료된 공식 대회). 주간 탭은 이번 주 월~오늘, 전체 탭은 from = 2000-01-01 |
| `lb_contest(contest_id)` | 대회 순위. 진행 중에도 호출 가능(점수, 끝낸 문제 수, 총 행동 수) |
| `lb_contests(from date, to date)` | 대회 탭. 종료된 공식 대회별 1~3위와 사용자별 공식 대회 점수 합계 |
| `lb_free(game text null)` | 자유 플레이 사용자별 플레이 수, 정답 수, 정답률, 현재 연속 정답, 최고 연속 정답, 평균 점수 |
| `user_stats(handle)` | 프로필용. 게임별 데일리 참여일·평균 점수, 참가한 대회(공식·친선)와 순위, 자유 플레이 통계, 최근 기록 30개 |

- 정렬: 점수 합계 내림차순 → 총 행동 수 오름차순 → 마지막 완료 시각 오름차순.
- 자유 플레이 탭 기본 정렬은 정답 수 내림차순 → 정답률 내림차순이다. 탭 안에서 기준을 바꿀 수 있다.
- 연속 정답은 게임별로 `played_at` 순서에서 마지막 실패 이후의 정답 수다. 게임 합계 보기에서는 연속 정답을 표시하지 않는다.
- 공식 대회는 문제 수만큼 점수가 커질 수 있다(4문제 대회는 최대 40점). 주간·전체 합산에 그대로 더한다.

## 10. 화면

| 경로 | 내용 |
|---|---|
| `/login` | 구글 로그인 버튼 |
| `/welcome` | 아이디 설정(handle이 null일 때), 대기 안내(pending), 거절 안내(rejected) |
| `/` | 게임 카드 목록(오늘 데일리 완료 여부·점수, 자유 플레이 버튼), 진행 중·곧 시작하는 대회 |
| `/play/:game/daily` | 데일리. 끝나면 결과와 오늘 순위 링크 |
| `/play/:game/free` | 자유 플레이. 게임 설정 선택, 한 판 끝날 때마다 free_plays에 저장 |
| `/contests` | 대회 목록: 진행 중, 예정, 종료. 공식·친선 구분 |
| `/contests/new` | 대회 개설. 관리자에게는 "공식 대회" 선택지가 보인다 |
| `/contests/:id` | 시작 전: 대기실(카운트다운, 문제 구성, 참가자). 진행 중: 문제 목록과 실시간 순위. 종료: 정답과 최종 순위 |
| `/contests/:id/:position` | 대회 문제 풀기 |
| `/join/:code` | 초대 링크. 참가 확인 후 대회 페이지로 |
| `/leaderboard` | 탭: 오늘, 주간, 전체, 대회, 자유 플레이. 게임 선택(전체 합계 또는 게임별) |
| `/u/:handle` | 프로필과 통계 |
| `/admin` | 관리자만. 가입 승인·거절·아이디 변경, 대회 취소, 문제 은행 업로드와 잔량 |

- 로그인 상태와 profiles.status에 따라 라우트 가드가 `/login` 또는 `/welcome`으로 보낸다. 초대 링크로 들어온 사람은 로그인·승인 후 원래 링크로 돌아온다.
- 디자인 기본은 Who Are Ya의 짙은 보라 톤이며 공통 스타일 토큰으로 쓴다. 계정별로 검증된 프리셋 팔레트(10개 × 다크·라이트)를 고를 수 있다 ([설계](2026-11-01-appearance-palettes-design.md)). 모바일 우선이다.

## 11. 오류 처리

- 판정 요청이 실패(네트워크, 5xx)하면 "다시 시도" 버튼을 보여준다. 서버가 저장에 성공하지 않은 행동은 세지 않는다. 다시 보내도 서버 상태 기준으로 판정하므로 안전하다.
- 409를 받으면 이유별로 안내한다: 날짜가 바뀜(새 데일리 열기), 대회 종료(결과 화면으로), 이미 끝난 문제, 규칙 변경(4.5).
- 대회 시작 전 카운트다운은 서버 시각 기준이다. 첫 로딩 때 서버 시각과의 차이를 계산해 보정한다.
- 자유 플레이 기록 저장이 실패하면 브라우저 저장소에 대기열로 보관하고, 다음 접속 때 다시 보낸다(최대 50개).
- 승인이 취소된 사용자의 요청은 RLS·함수에서 거부되며, 화면은 `/welcome`으로 이동한다.

## 12. 테스트

- 게임 로직: `logic.test.ts`(Vitest). 숫자 맞히기의 판정, 오류, 힌트 감점, 포기, 종료, 점수 경계값(1번, 8번, 실패), `puzzleKey`를 검사한다.
- 권한(pgTAP):
  - 대기 사용자의 free_plays 쓰기·대회 참가·대회 개설 거부
  - 남의 기록 쓰기 거부, attempts 직접 쓰기 거부
  - 종료 전 contest_items.puzzle 읽기 거부
  - 초대 대회의 비참가자 읽기 거부, 잘못된 초대 코드 거부
  - 비관리자의 공식 대회 개설·관리자 함수 거부
  - handle 중복·형식 거부
  - 개설 검증(시작 시각, 제한 시간, 문제 수, contest 미지원 게임)
- Edge Function(Deno test):
  - open → act 반복 → 종료 → 재행동 409
  - 시작 전 open 409, 종료 후 act 409
  - 동시 첫 open에서 문제가 한 번만 출제됨
  - 60일 중복 회피
  - 버전 불일치 확정
  - 미승인 403, 비참가자 403
- 리더보드: 고정 시드 데이터로 `lb_daily`, `lb_range`, `lb_contest`, `lb_contests`, `lb_free`의 정렬·동점 처리·친선 대회 제외·취소 대회 제외를 pgTAP으로 검사한다.
- PR마다 GitHub Actions에서 Vitest와 타입 검사를 돌린다. DB·Edge Function 테스트는 로컬에서 돌린다.

## 13. 공동 개발과 운영

- main 브랜치를 보호한다. 모든 변경은 PR로 올리고, Vercel 미리보기에서 확인한 뒤 머지한다.
- `CLAUDE.md`에 다음을 적는다.
  - 폴더 규칙
  - 게임 추가 절차: 폴더 생성 → manifest·logic·test·Game → 등록부 한 줄 → 숨김으로 머지 → 공개
  - 로직 버전 올리는 규칙
  - 커밋·PR 규칙
  - 금지 사항: 비밀값 커밋 금지, 플랫폼 코드에 게임별 분기 금지
- 비밀값:
  - Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (공개용 키)
  - Supabase Edge Function 시크릿: `PLAY_SECRET`
  - Google OAuth 클라이언트는 Supabase 대시보드에 등록하고, 허용 리디렉션에 운영 주소·Vercel 미리보기 와일드카드·localhost를 넣는다.
- DB 변경은 마이그레이션 파일로만 한다. 대시보드에서 직접 스키마를 바꾸지 않는다.
- 배포: 이 레포의 main이 onlyfms.vercel.app으로 배포되도록 Vercel 프로젝트를 연결한다. 연결 시점에 현재의 Who Are Ya 단독 페이지는 새 사이트로 대체된다.

## 14. 범위 밖

- 실제 게임(Who Are Ya, 미싱 11 등)과 그 데이터. 게임마다 별도 설계로 붙인다.
- 사용자가 직접 아이디 바꾸기, 계정 삭제 화면(관리자가 Supabase 대시보드에서 처리)
- 부정행위 방지 중 서버 판정 이외의 것(예: 여러 기기 동시 사용 탐지)

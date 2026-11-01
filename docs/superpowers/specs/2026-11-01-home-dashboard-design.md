# 홈 대시보드 설계

- 날짜: 2026-11-01
- 상태: 초안 (사용자 검토 전)
- 관련: 플랫폼 설계 `2026-10-31-onlyfms-platform-design.md`, 대전 설계 `2026-11-01-duel-platform-design.md`, 팔레트 설계 `2026-11-01-appearance-palettes-design.md`

## 1. 목표

로그인 후 첫 화면(`/`)을 개인 대시보드로 바꾼다. 들어오자마자 오늘 할 일(안 푼 데일리, 진행 중인 대회·대전)과 내 위치(순위, 레이팅, 기록)가 보여야 한다. 사용자마다 어떤 블록을 어떤 순서로 볼지 정할 수 있고, 설정은 계정에 저장돼 기기 간에 유지된다.

### 성공 기준
1. 로그인 후 `/`에서 안 푼 데일리, 진행 중인 대회, 진행 중인 내 대전이 한 화면에 보인다.
2. 블록 켜기·끄기와 순서 변경이 저장 후 새로고침·다른 기기에서도 유지된다.
3. 새 블록은 등록부(`src/platform/home/blocks.ts`)에 한 줄 추가로 붙는다. DB 마이그레이션이 필요 없다(블록 자체가 새 RPC를 요구하는 경우는 그 RPC 몫만).
4. 블록 하나가 실패해도 나머지 블록은 정상으로 보인다.

### 범위 밖 (이번에 하지 않음)
- 드래그 앤 드롭, 블록 크기 조절, 자유 배치
- 친구 활동 피드 등 새 테이블·RPC가 필요한 블록
- 대전 "내 턴" 표시 (§9 참고. `_duel_item`에 턴 정보가 없다)
- 홈 데이터 실시간 갱신(폴링·Realtime)

## 2. 라우팅·내비게이션

| 경로 | 화면 | 비고 |
|---|---|---|
| `/` | `HomePage` (새 대시보드) | `RequireApproved` 안, 지금과 같다 |
| `/games` | `GamesPage` | 지금 `src/platform/games/HomePage.tsx`를 이름만 바꿔 옮긴 것. 동작 변화 없음 |

- 상단 내비게이션: `홈(/, end) · 게임(/games) · 대회 · 대전 · 리더보드 · (관리자)`.
- `/`로 가는 기존 경로는 `Layout.tsx`의 내비게이션 링크(→ `홈`으로 이름 변경), `Guard.tsx`의 `RequireAdmin` 되돌리기, `redirect.ts`의 `safeRedirect` 기본값뿐이다. 뒤의 둘은 그대로 대시보드로 보낸다(로그인·환영 후 대시보드에 도착 — 의도된 동작). `Brand`는 링크가 아니다.
- `/games` 화면의 `UpcomingContests` 오른쪽 열은 그대로 둔다(대시보드에 같은 정보가 있어도 게임 목록 화면만 보는 사람을 위해).

## 3. 블록

### 3.1 목록 (기본 순서 = 아래 순서, 기본 전부 켜짐)

| id | 제목 | 내용 | 데이터 |
|---|---|---|---|
| `daily` | 오늘의 데일리 | `modes.daily`인 게임별: 끝냈으면 내 점수와 오늘 순위(`n위 / m명`), 아니면 "아직 끝내지 않았어요" + 데일리 버튼 | 게임별 `lb_daily(오늘, game)` |
| `contests` | 대회 | 진행 중이거나 24시간 안에 시작하는 대회 최대 3개(공개 또는 내가 참가). 없으면 빈 문구 + `/contests` 링크 | `listContests`, `getMyContestIds` (기존 `UpcomingContests` 로직) |
| `duels` | 대전 | 진행 중·대기 중인 내 대국 최대 5개(게임 이름, 상대, `/duel/:id` 링크), 공개 로비 대국 수 + `/duel` 링크 | `duel_list()`의 `mine`, `lobby` |
| `weekly` | 이번 주 순위 | `modes.daily`인 게임별: 이번 주(월요일~오늘, KST) 합계 상위 5명 + 내 순위(5위 밖이면 아래에 따로 한 줄). 리더보드 `주간` 탭과 같은 집계(데일리 + 이번 주 끝난 공식 대회) | 게임별 `lb_range(주 시작, 오늘, game)` |
| `elo` | 대전 레이팅 | 대전 게임별: 내 레이팅과 레이팅 대전 승·무·패, 배치 완료자 상위 3명 | 게임별 `lb_duel(game)` |
| `streak` | 내 기록 | `modes.free`인 게임별: 자유 플레이 판수, 승률(%), 현재·최고 연속 기록. 기록이 없으면 "아직 기록이 없어요" + 자유 플레이 버튼 | 게임별 `lb_free(game)` |

블록별 세부 규칙 (기존 RPC 동작에서 나오는 것):
- `daily`: `lb_daily`는 끝난 기록만 돌려준다(`_lb_attempt_rows`). 시작했지만 끝내지 않은 사람과 시작하지 않은 사람을 구분할 수 없으므로 둘 다 "아직 끝내지 않았어요"로 보인다. 다른 사람의 끝난 기록은 내가 풀기 전에도 보이므로 `m명`은 항상 표시할 수 있다.
- `duels`: 이름은 `getDuel(game_id).manifest.name`. 상대는 `players`에서 내가 아닌 사람의 `handle`. 대기 중인 대국은 `players`에 만든 사람만 있으므로 상대 대신 "상대 기다리는 중"을 보인다.
- `elo`: `lb_duel`은 레이팅 대전을 1판 이상 한 사람만 돌려준다. 세 가지 상태를 구분한다.
  - 내 행 없음(레이팅 대전 0판): "아직 레이팅 대전 기록이 없어요" + `/duel` 링크. 상위 3명은 그대로 보인다.
  - 내 행 있고 `placed=false`: 레이팅과 승·무·패 + "배치 중"
  - `placed=true`: 레이팅, 승·무·패, 배치 완료자 중 내 순위
  - 승·무·패는 레이팅 대전만 센다(친선 제외). 제목 옆에 따로 적지는 않고 숫자 줄에 "레이팅 대전" 라벨을 단다.
- `streak`: `lb_free.win_rate`는 0~1 비율이므로 ×100 해서 정수 %로 보인다. 아직 서버에 올라가지 않은 `freeQueue` 기록은 반영되지 않는다(리더보드와 같음).

- 게임을 고르는 규칙은 지금 `HomePage`와 같다: 등록부(`games`, `duels`)를 순회하고, `manifest.hidden`이면 관리자에게만 보인다. 플랫폼 코드에 게임별 분기를 두지 않는다.
- `weekly`·`streak`·`elo`를 게임별로 나누는 이유: 게임마다 점수 척도가 달라 합치면 비교가 안 된다. 지금은 게임이 각 1개라 한 줄씩이다.
- 오늘·주 시작 날짜는 서버 시계 기준(`kstDate(now())`, `kstWeekStart`)으로 계산한다. 기존 `HomePage`와 같은 방식.
- "내 행"은 `user_id`(있으면) 또는 `handle`로 찾는다. `lb_duel`은 `user_id`가 없어 `handle`로 찾는다.

### 3.2 등록부 (`src/platform/home/blocks.ts`)

```ts
export type HomeBlock = {
  id: string          // 영문 소문자·숫자·'-', 1~32자. 바꾸면 기존 저장값이 그 블록을 새 블록으로 본다
  title: string       // 블록 제목·편집 목록 이름 (한국어)
  Component: React.ComponentType
}
export const homeBlocks: HomeBlock[] = [ /* §3.1 순서 */ ]
```

- 블록 추가 절차: `blocks/<Name>Block.tsx` 작성(테스트 포함) → `homeBlocks`에 한 줄 추가. 기존 사용자에게는 맨 아래 켜진 채로 나타난다(§4.2).
- 블록 삭제: `homeBlocks`에서 빼면 된다. 저장값에 남은 id는 무시된다.
- 등록부 테스트: id 형식, 중복 없음.

## 4. 저장

### 4.1 스키마 (새 마이그레이션 `npx supabase@2 migration new home_layout`)

```sql
alter table public.profiles add column home_layout jsonb;  -- null = 기본값
```

- `my_profile()`은 `p.*`를 돌려주므로 따로 고치지 않는다. 클라이언트 `Profile` 타입에 `home_layout?: HomeLayoutEntry[] | null`을 더한다.
- 블록 id 허용 목록을 DB에 두지 않는다(팔레트의 `check` 제약과 다르게). 블록을 추가·삭제할 때 마이그레이션이 필요 없게 하려는 것.

`set_home_layout(p_layout jsonb) returns void` (security definer, `search_path = public`):
- `_require_approved()`.
- `p_layout`이 `null`이면 `home_layout = null`(기본값으로 되돌리기).
- 아니면 모두 만족해야 한다. 어긋나면 `P0001 home_layout_invalid`.
  - JSON 배열, 길이 1~32
  - 각 원소는 키가 정확히 `id`, `on`인 객체
  - `id`: 문자열, `^[a-z0-9-]{1,32}$`
  - `on`: boolean
  - `id` 중복 없음
- 본인 행만 갱신(`where id = auth.uid()`).
- 권한: `0010_appearance.sql`과 똑같이 `revoke execute on function public.set_home_layout(jsonb) from public, anon, authenticated; grant execute on function public.set_home_layout(jsonb) to authenticated;`. `public`에서만 빼면 Supabase 기본 권한으로 `anon`에 실행 권한이 남는다.
- 클라이언트 오류 문구: `src/lib/api.ts`의 `MESSAGES`에 `home_layout_invalid: '홈 설정을 저장하지 못했어요'`를 더한다.

### 4.2 저장값 해석 (`src/platform/home/layout.ts`, 순수 함수)

```ts
export type HomeLayoutEntry = { id: string; on: boolean }
export function resolveLayout(saved: unknown, knownIds: string[]): HomeLayoutEntry[]
export function moveUp(layout: HomeLayoutEntry[], id: string): HomeLayoutEntry[]
export function moveDown(layout: HomeLayoutEntry[], id: string): HomeLayoutEntry[]
export function toggle(layout: HomeLayoutEntry[], id: string): HomeLayoutEntry[]
```

`resolveLayout` 규칙(순서대로):
1. `saved`가 배열이 아니면(`null` 포함) `knownIds` 순서대로 전부 `on: true`.
2. 배열이면 원소 중 `{id: string, on: boolean}` 형식이 아닌 것, `knownIds`에 없는 id, 앞에서 이미 나온 id를 버린다. 남은 것은 저장된 순서를 지킨다.
3. `knownIds` 중 2의 결과에 없는 id를 `knownIds` 순서대로 맨 아래에 `on: true`로 붙인다.

- 결과에는 `knownIds`의 모든 블록이 정확히 한 번 나온다.
- `moveUp`/`moveDown`은 꺼진 블록도 한 칸씩 움직인다(편집 화면에 꺼진 블록도 보이므로 화면과 같은 순서). 맨 위·맨 아래에서는 그대로 돌려준다.
- 저장할 때는 `resolveLayout` 결과 전체(꺼진 블록 포함)를 보낸다. 그래야 "일부러 끈 블록"이 다음에 "처음 보는 블록"으로 오인되지 않는다.
- 저장값에서 버려진 항목(모르는 id)은 다음 저장 때 사라진다. 블록을 등록부에서 지웠다가 같은 id로 되살리면 그 사용자에게는 새 블록처럼(켜진 채 맨 아래) 보인다. 의도된 동작.

## 5. 화면

### 5.1 보기 모드

- 제목 줄: `홈` + 오른쪽 `편집` 버튼.
- 켜진 블록만 저장 순서대로 렌더한다. 꺼진 블록은 마운트하지 않으므로 RPC도 부르지 않는다.
- 배치: 모바일은 한 열. 넓은 화면(기존 `.split`과 같은 미디어 쿼리 기준점)은 `home.css`의 같은 폭 2열 grid(`repeat(2, minmax(0, 1fr))`, `.split-even`과 같은 비율), 순서는 왼→오, 위→아래. 열별로 따로 쌓지 않는다(순서 의미가 흐려짐). 블록 높이 차이로 생기는 빈칸은 감수한다.
- 모든 블록이 꺼져 있으면: "표시할 블록이 없어요. 편집에서 켜 주세요" + `편집` 버튼.

### 5.2 편집 모드

- `편집`을 누르면 지금 레이아웃을 복사해 편집용 상태로 둔다. 블록 내용은 렌더하지 않고 `BlockFrame`이 제목만 있는 줄로 바꾼다(편집 중 RPC 호출 없음, 목록이 짧아져 순서 바꾸기 쉬움).
- 각 줄: 제목, `켜기` 스위치(`role="switch"`, `aria-checked`), `↑`·`↓` 버튼(`aria-label="<제목> 위로"` 등, 끝에서는 비활성).
- 꺼진 줄은 흐리게(토큰 색만 사용).
- 하단: `완료`(저장) · `취소`(편집 전 상태로) · `기본값으로`(편집 상태를 기본 순서·전부 켜짐으로 바꿈. 저장은 `완료` 때 한다).
- `완료` 때 보내는 값: 편집 상태가 기본값(`resolveLayout(null, knownIds)`)과 같으면 `null`(이후 블록이 추가돼도 기본 순서를 따르게), 다르면 편집 상태 전체 배열. `기본값으로`를 누른 뒤 다시 바꿨으면 배열을 보낸다.
- 저장 흐름 (낙관적 반영 없이, 성공 후 반영):
  1. 버튼 비활성, `rpc('set_home_layout', { p_layout })`.
  2. 실패: 편집 모드 유지, 하단에 `errorMessage(e)` 문구. 다시 `완료` 가능.
  3. 성공: `HomePage`의 로컬 상태 `savedLayout`에 보낸 값을 넣고 보기 모드로 간다. 화면은 `savedLayout ?? profile.home_layout`을 해석해 그린다. 그 뒤 `refresh()`를 부른다. `refresh()`는 실패해도 예외를 던지지 않고 이전 프로필을 남기므로, `savedLayout`이 없으면 저장된 설정이 옛 값으로 되돌아 보인다. `savedLayout`은 이 문제를 막기 위한 것이고 `HomePage`가 마운트된 동안 유지한다.
  - `AppearanceSettings`는 화면에 먼저 반영하고 실패하면 되돌리는(낙관적) 방식이라 이 흐름과 다르다. 홈은 편집 모드가 따로 있어 낙관적 반영이 필요 없다.

### 5.3 블록 공통 틀 (`BlockFrame`)

- 카드(`.card`) 안에 제목(`h3.card-title`)과 내용.
- 블록 컴포넌트는 `useBlockData(load)` 훅으로 데이터를 받는다: `{ kind: 'loading' } | { kind: 'done', data } | { kind: 'error' }`. 마운트 때 한 번 부르고, 언마운트 뒤 결과는 버린다(기존 `alive` 패턴).
- 로딩: "불러오는 중…". 오류: "불러오지 못했어요" + `다시 시도` 버튼(그 블록만 다시 부름). 다른 블록에 영향 없음.
- 빈 데이터 문구는 각 블록이 정한다(§3.1).
- 대회 블록의 1초 카운트다운은 기존 `UpcomingContests`처럼 유지한다(표시 갱신일 뿐 RPC 반복 아님).
- `duel_list()`는 호출 때마다 10분 지난 대기 대국을 `void`로 정리하는 `update`를 실행한다. 반복해도 결과가 같은 정리라 홈에서 불러도 안전하다. 홈에서는 진입 때 한 번만 부른다.

### 5.4 대회 블록과 기존 컴포넌트

`UpcomingContests`의 조회·필터 로직을 함수(`loadUpcomingContests(profileId)`)로 빼서 `/games` 화면과 `ContestsBlock`이 함께 쓴다. `/games`의 `UpcomingContests`는 지금처럼 결과가 없으면 아무것도 그리지 않고, `ContestsBlock`은 빈 문구를 그린다.

## 6. 파일

```
src/platform/home/
  blocks.ts, blocks.test.ts
  layout.ts, layout.test.ts
  useBlockData.ts
  BlockFrame.tsx
  HomePage.tsx, HomePage.test.tsx
  blocks/DailyBlock.tsx, ContestsBlock.tsx, DuelsBlock.tsx,
         WeeklyBlock.tsx, EloBlock.tsx, StreakBlock.tsx  (+ 각 .test.tsx)
  home.css
src/platform/games/GamesPage.tsx        (HomePage.tsx 이름 변경)
src/platform/games/UpcomingContests.tsx (조회 로직을 loadUpcomingContests로 분리)
src/platform/games/pages.test.tsx       (import 경로 ./HomePage.tsx → ./GamesPage.tsx)
src/app/routes.tsx, src/app/App.test.tsx (`/`에서 '게임 목록'을 기대하는 단언 수정)
src/platform/layout/Layout.tsx, Layout.test.tsx (탭 이름·링크 단언 추가)
src/platform/auth/AuthProvider.tsx      (Profile 타입에 home_layout)
src/lib/api.ts                          (MESSAGES에 home_layout_invalid)
supabase/migrations/<ts>_home_layout.sql
supabase/tests/<home_layout 테스트>
```

## 7. 테스트

- `layout.test.ts`: `resolveLayout`의 null·비배열·형식 틀린 원소·모르는 id·중복·새 블록 추가·전부 꺼짐, `moveUp`/`moveDown` 경계, `toggle`.
- `blocks.test.ts`: id 형식, 중복 없음.
- 블록별 테스트(`rpc` 목): 로딩·완료·빈 데이터·오류와 `다시 시도`, 숨김 게임이 일반 사용자에게 안 보이고 관리자에게 보임(`withTestGame` 사용). 추가로 `elo`의 세 상태(행 없음·배치 중·배치 완료), `duels`의 대기 중 대국("상대 기다리는 중"), `streak`의 승률 % 변환, `daily`의 끝냄·안 끝냄.
- `HomePage.test.tsx`: 저장값 순서대로 렌더, 꺼진 블록은 렌더·RPC 호출 없음, 편집 → 순서 변경 → `완료` 시 `set_home_layout` 인자(꺼진 블록 포함 전체), `취소` 복원, `기본값으로` 후 그대로 `완료` → `null`, `기본값으로` 후 다시 바꾸고 `완료` → 배열, 저장 실패 시 편집 모드 유지와 문구, 저장 성공 후 `refresh`가 옛 프로필을 남겨도 새 순서 유지, 모두 꺼짐 문구.
- 라우팅·레이아웃 테스트: `/`는 대시보드, `/games`는 게임 목록, 내비게이션 탭 이름·링크(`홈`, `게임` → `/games`). 기존 `App.test.tsx`, `pages.test.tsx`, `Layout.test.tsx`를 함께 고친다.
- DB 테스트: `set_home_layout` 정상 저장, `null` 저장, 각 검증 위반 시 `home_layout_invalid`, 미승인 사용자 거부, 다른 사람 행은 바뀌지 않음, `my_profile`에 `home_layout` 포함.
- 푸시 전 `npm test && npm run typecheck && npm run build`, DB 테스트 `npm run db:test`.

## 8. 배포

- 마이그레이션(컬럼 + RPC)을 먼저 원격에 적용한 뒤 Vercel 배포(`docs/deploy-checklist.md`). 프런트가 먼저 나가도 `home_layout`이 없으면 `resolveLayout`이 기본값을 쓰므로 홈은 깨지지 않고, 저장만 실패한다.
- Edge Function 재배포는 필요 없다.

## 9. 나중에 할 것

- 대전 "내 턴" 표시: `_duel_item`에 현재 턴(또는 `my_turn` boolean)을 더하는 마이그레이션 + `DuelsBlock` 표시. 대전 설계 쪽 변경이라 따로 다룬다.
- 친구 활동 피드 등 새 RPC가 필요한 블록.

# ONLYFMS 1대1 대전 설계

- 작성일: 2026-11-01
- 상태: 검토 대기
- 범위: 둘이 번갈아 두는 실시간 1대1 대전 플랫폼(대국 생성·참가·턴·시간 초과·판정·Elo·전적)과 첫 게임 요트 다이스. 같은 화면(한 기기 2인) 모드 포함.
- 선행 문서: [ONLYFMS 플랫폼 설계](2026-10-31-onlyfms-platform-design.md). 이 문서에 없는 규칙(승인 사용자, 숨김 게임, 로직 버전, 한국어·모바일·보라 테마, 게임별 분기 금지)은 그 문서를 따른다.

## 1. 목표

친구끼리 실시간으로 번갈아 두는 게임을 하고, 게임별 Elo로 순위를 매긴다. 게임은 하나씩 붙일 수 있어야 한다(요트 다이스 먼저, 티키타카토 대전형은 커리어 데이터가 준비된 뒤).

성공 기준:

1. 대국을 만들어 초대 링크로 친구를 부르거나, 공개 대기실에 올려 아무나 들어오게 할 수 있다.
2. 상대가 두면 1~2초 안에 내 화면이 바뀐다. 알림이 빠져도 5초 안에 맞춰진다.
3. 수는 서버가 판정한다. 주사위 같은 무작위 값은 서버가 만든다. 브라우저는 게임 상태를 직접 읽거나 고칠 수 없다.
4. 창을 닫고 사라진 사람 때문에 대국이 멈추지 않는다(시간 초과 → 기본 수 → 연속 2회 기권패).
5. 게임별 Elo 순위, 내 승·무·패와 승률, 특정 친구와의 상대 전적을 볼 수 있다.
6. 같은 화면 모드는 서버 없이 브라우저에서 돌고 기록을 남기지 않는다.
7. 나중에 리그전·토너먼트가 대국을 만들고 결과를 받아 갈 수 있는 자리가 있다.

## 2. 결정 요약

| 항목 | 결정 | 이유 |
|---|---|---|
| 진행 방식 | 실시간(턴 제한) | 사용자 결정 |
| 시작 방식 | 초대 링크 + 공개 대기실 둘 다 | 대회의 public/invite와 같은 구조 |
| 랭킹 | 게임별 Elo, 승률·상대 전적 표시 | 사용자 결정 |
| 랭크/친선 | 대국 생성 때 선택. 친선은 Elo 미반영, 전적에는 남음 | 연습·새 게임 시험용 |
| 시간 초과 | 게임이 정한 기본 수를 서버가 둠. 연속 2회면 기권패. 기권 버튼 | 사용자 결정 |
| 첫 수 전 이탈 | 무효(Elo·전적 미반영) | 시작 직후 이탈을 패배로 치는 것은 과함 |
| 실시간 전달 | Supabase Realtime 브로드캐스트 "바뀜" 신호 + 화면이 상태 재조회 + 5초 폴링 | 추가 서비스 없음. 무료 등급(동시 200명, 월 200만 메시지, 함수 월 50만 회)으로 충분 |
| 타이머 | 별도 타이머 서버 없음. 마감 지난 것을 본 클라이언트가 `tick` 요청, 서버 시각으로 확인 | 단순함 |
| 같은 화면 | 브라우저 안에서 같은 로직 실행, 기록 없음 | 랭킹 미반영이라 서버 판정 불필요 |
| 리그전·토너먼트 | 이번 범위 밖. 대국에 소속 칸만 둔다 | 대국 하나가 먼저 안정돼야 함 |

검토했지만 고르지 않은 것: 별도 실시간 서버(Cloudflare Durable Objects/PartyKit)는 무료로 가능하지만 인증 연동, Supabase 관리자 키를 외부에 두는 것, 배포처 3곳, 상태 이원화가 따라온다. 폴링만 쓰는 방식은 함수 호출이 많고 반응이 느리다.

## 3. 게임 모듈

### 3.1 위치와 manifest

대전 게임도 `src/games/<game-id>/`에 둔다. manifest에 `category`를 추가한다.

```ts
export type Manifest = {
  // 기존 필드 …
  category?: 'solo' | 'duel'   // 없으면 'solo' (기존 게임 수정 불필요)
}
```

- `category: 'duel'`인 게임은 `modes`(daily/contest/free)를 모두 false로 둔다. 대신 `duel` 블록을 가진다.

```ts
duel?: {
  turnSeconds: { choices: number[]; default: number }   // 요트: [30, 60, 90], 60
  sameScreen: boolean                                     // 같은 화면 모드 지원 여부
}
```

- 플랫폼 코드는 `category`와 `duel` 블록으로만 나눈다. 게임 id로 분기하지 않는다.
- 등록은 기존과 같다: `src/games/index.ts`(로직, Deno가 import), `src/games/ui.ts`(화면).
- 등록부 테스트(`registry.test.ts`)와 맞추기 위해 대전 게임도 `game_modes`에 (false, false, false) 행을 넣고, 숨김이면 `hidden_games` 행을 넣는다. `play` 함수는 `category: 'duel'` 게임을 404로 거절한다.

### 3.2 DuelLogic 계약

`src/games/types.ts`에 추가한다. 순수 함수, 외부 의존 없음, `.ts` 확장자 import.

```ts
export type Seat = 0 | 1

export type DuelResult =
  | { over: false }
  | { over: true; winner: Seat | null; scores?: [number, number] }   // winner null = 무승부

export interface DuelLogic<State, Action, View> {
  version: number
  /** 새 판. rng는 서버(또는 같은 화면 모드에서는 브라우저)가 준다 */
  init(rng: () => number, options: Record<string, string>): State
  /** 지금 둘 차례 */
  toMove(state: State): Seat
  /** seat이 action을 둔다. 차례가 아니거나 규칙 위반이면 error. rng는 무작위가 필요한 행동(주사위)용 */
  apply(state: State, seat: Seat, action: Action, rng: () => number): { state: State } | { error: string }
  /** 시간 초과 때 서버가 대신 둘 행동 목록(한 턴을 끝내는 데 필요한 만큼). 게임마다 결정적이어야 한다 */
  timeoutActions(state: State, rng: () => number): Action[]
  /** 지금 턴이 끝났는가(차례가 넘어갔는가)를 판단할 때 쓰는 턴 번호 */
  turnNo(state: State): number
  result(state: State): DuelResult
  /** seat에게 보여줄 상태. 관전자·종료 후는 viewer = null */
  view(state: State, viewer: Seat | null): View
}
```

- `turnNo`는 시간 초과·연속 초과 계산에 쓴다. 한 턴 안에 여러 행동(굴리기 3번 + 칸 선택)이 있는 게임이 있어서 행동 수와 턴 수를 구분한다.
- 숨길 정보가 없는 게임은 `view`가 상태를 그대로 돌려줘도 된다. 그래도 브라우저는 `view`만 받는다.

### 3.3 난수

- 서버: `rng = rngFromSeed(hmacSeed(PLAY_SECRET, "duel:" + matchId + ":" + moveNo))` (`src/shared/rng.ts` 재사용). `moveNo`는 그 대국의 행동 순번이다. 같은 대국·같은 순번이면 같은 값이라 재계산으로 검증할 수 있고, `PLAY_SECRET`을 모르면 미리 알 수 없다.
- 같은 화면 모드: `Math.random`.

## 4. 대국 흐름

```
waiting ──참가──▶ active ──종료 조건──▶ finished
   │                 │
   └─10분 무참가/취소─┴─첫 수 전 이탈·로직 버전 변경──▶ void
```

1. **생성**: 게임, 설정, 랭크/친선, 공개/초대, 턴 시간을 고른다. 초대 코드(대회와 같은 형식)가 생긴다. 공개면 대기실 목록에 보인다. 한 사람이 동시에 대기 중인 대국은 3개까지.
2. **참가**: 초대 링크 `/duel/join/:code` 또는 대기실에서 참가. 자기 대국에는 참가 불가. 참가 순간 서버가 선공을 무작위로 정하고 `init`, 첫 턴 마감을 설정하고 `active`가 된다.
3. **진행**: 차례인 사람이 `move`를 보낸다. 서버는 행 잠금 → 차례·순번 확인 → `apply` → 턴이 넘어갔으면 마감 갱신·그 사람의 연속 초과 횟수 0 → 저장 → 브로드캐스트.
4. **시간 초과**: 마감이 지난 대국에 누구든(참가자) `tick`을 보내면 서버가 서버 시각으로 확인하고 `timeoutActions`를 차례로 적용한다. 그 사람의 연속 초과 횟수 +1. 2가 되면 상대 승(기권패)으로 끝낸다. 시간 초과로 넘어간 턴의 새 마감은 `이전 마감 + turn_seconds`로 잡는다. 그래서 한 번의 `tick`이 지금 시각까지 마감이 지난 턴을 모두 연쇄 처리한다(둘 다 자리를 비운 경우).
5. **기권**: 언제든 `resign`. 상대 승.
6. **종료**: `result.over`면 `finished`. 같은 트랜잭션에서 Elo·전적 갱신.
7. **무효(void)**: 두 사람 중 누구든 첫 수(첫 행동)를 두기 전에 끝나면 무효(기권·시간 초과 포함). 진행 중 대국의 `logic_version`이 현재와 다르면 무효. 무효는 Elo·전적 모두 미반영.
8. **자동 취소**: `waiting` 10분 경과. 대기실 조회·내 대국 조회 때 정리한다.
9. **방치 대국 정리**: 둘 다 창을 닫으면 아무도 `tick`을 안 보낸다. 대전 탭 목록 조회(`duel_list`)가 마감 지난 내 대국 id를 함께 돌려주고, 화면이 그 대국들에 `tick`을 보낸다(시간 초과 기본 수는 TypeScript 로직이라 SQL에서 처리할 수 없다). 그때까지 Elo 반영이 늦어질 수 있다.
10. **재대결**: 종료 화면에서 같은 설정으로 새 초대 대국을 만들고 상대에게 초대 링크를 띄운다(자동 수락 없음).

## 5. 데이터 모델

마이그레이션 번호는 구현 시점의 다음 빈 번호를 쓴다(현재 0007까지 적용). 테이블은 RLS를 켜고 기존 방식대로 기본 권한을 회수한 뒤 필요한 것만 연다.

### duel_matches

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| game_id | text | 등록부 id |
| options | jsonb | 게임 설정 |
| logic_version | int | 생성 당시 |
| rated | boolean | 랭크 여부 |
| visibility | enum `public`/`invite` | |
| invite_code | text unique | 대회 초대 코드와 같은 생성 방식 |
| status | enum `waiting`/`active`/`finished`/`void` | 취소도 `void` |
| created_by | uuid FK profiles | |
| players | uuid[2] NULL | [선공, 후공]. 참가 때 확정 |
| state | jsonb NULL | 게임 상태. **브라우저 읽기 불가**(컬럼 권한 회수) |
| action_no | int | 지금까지 적용한 행동 수(중복 방지, 난수 순번) |
| turn_no | int | `logic.turnNo(state)` 캐시 |
| turn_seconds | int | |
| turn_deadline | timestamptz NULL | |
| timeouts | int[2] | 좌석별 연속 시간 초과 |
| moved | boolean[2] | 좌석별 첫 행동 여부(무효 판정) |
| winner | smallint NULL | 0/1, 무승부·무효는 null |
| end_reason | enum `normal`/`resign`/`timeout`/`void` NULL | |
| final_scores | int[2] NULL | 결과 화면·전적용 |
| parent_type, parent_id | text, uuid NULL | 리그전·토너먼트용. 이번에는 항상 null |
| created_at, started_at, ended_at | timestamptz | |

### duel_moves

| 컬럼 | 타입 | 설명 |
|---|---|---|
| match_id, action_no | PK | |
| seat | smallint | |
| action | jsonb | |
| auto | boolean | 시간 초과로 서버가 둔 행동 |
| created_at | timestamptz | |

읽기: 대국이 끝난 뒤 참가자만(다시보기는 범위 밖이지만 기록은 남긴다).

### duel_ratings

| 컬럼 | 타입 | 설명 |
|---|---|---|
| user_id, game_id | PK | |
| rating | int | 시작 1000 |
| rated_games | int | K값 결정용 |
| wins, draws, losses | int | 랭크 대국만 |
| updated_at | timestamptz | |

### duel_rating_changes

match_id, user_id (PK), before, after, created_at.

### 전적

승·무·패·상대 전적은 `duel_matches`(`finished`)에서 계산한다. 친선 대국은 전적에는 들어가고 Elo에는 안 들어간다. 화면에서 "랭크만/전체"를 고를 수 있다.

## 6. Elo

- 시작 1000. 기대값 `E = 1 / (1 + 10^((Rb − Ra) / 400))`. 결과 `S` = 승 1, 무 0.5, 패 0.
- `Δ = round(K × (S − E))`, K는 그 사람의 `rated_games < 10`이면 40, 아니면 20. 두 사람 K가 다를 수 있다(합이 0이 아닐 수 있음).
- 랭크 대국이 `finished`가 되는 트랜잭션 안에서 갱신하고 `duel_rating_changes`에 남긴다. 무효·친선은 갱신하지 않는다.
- 계산은 SQL 함수 `_duel_apply_elo(match_id)` 하나에 둔다(Edge Function과 정리 경로가 같이 쓴다).

## 7. 서버

### 7.1 Edge Function `duel`

`supabase/functions/duel/`. 구조는 `play`와 같다(`handle(req, deps)`, 주입 의존, `npm:postgres`, `auth.getUser`, `verify_jwt = false`, 같은 CORS). 승인 사용자만.

| action | 입력 | 동작 |
|---|---|---|
| `create` | game_id, options, rated, visibility, turn_seconds | 대국 생성, 초대 코드 반환 |
| `join` | match_id 또는 code | 참가, 시작 |
| `cancel` | match_id | 만든 사람만, `waiting`일 때 |
| `view` | match_id | 내 화면 상태(`view` 결과 + 메타) |
| `move` | match_id, expected_action_no, payload | 행동 적용 |
| `tick` | match_id | 마감 지난 턴 처리 |
| `resign` | match_id | 기권 |

- 응답의 화면 상태: `{ match_id, game_id, options, status, players[{id, handle, rating}], my_seat, to_move, turn_deadline, server_now, view, result, end_reason, rating_change? }`.
- 오류: 401 unauthorized, 403 not_approved/not_player, 404 unknown_game/not_found, 409 not_your_turn/stale/finished/not_waiting/full/version_changed, 400 invalid_action. 409 응답에는 가능한 한 최신 화면 상태를 같이 싣는다(기존 `play`와 같은 원칙).
- 모든 변경은 `select … for update`로 대국 행을 잠근 트랜잭션 안에서 한다.

### 7.2 실시간 신호

- 변경을 커밋한 뒤 Realtime 브로드캐스트 채널 `duel:<match_id>`에 `{ action_no, status }`만 보낸다(Realtime REST 브로드캐스트). 게임 상태는 싣지 않으므로 채널을 누가 구독해도 새는 정보가 없다.
- 브로드캐스트에 필요한 키: Edge Function 기본 환경 변수(`SUPABASE_SECRET_KEYS` 또는 `SUPABASE_SERVICE_ROLE_KEY`)를 쓴다. 어느 키가 REST 브로드캐스트에 받아들여지는지는 구현 첫 단계에서 원격으로 확인한다(로컬에서 확인 불가). 브로드캐스트 실패는 대국 진행을 막지 않는다(로그만, 폴링으로 보완).
- 화면은 신호를 받으면 `view`를 다시 부른다. 신호와 무관하게 5초마다 `view`를 부른다. 마감이 지나면 `tick`을 부른다(여러 번 와도 서버가 한 번만 처리).
- 대기실 목록은 Realtime 없이 화면이 열려 있는 동안 5초 폴링한다.

### 7.3 DB 함수 (security definer, 승인 사용자)

- `duel_list()`: 공개 대기 대국, 내 대기·진행·최근 종료 대국. 호출 시 자동 취소·방치 대국 정리(마감 지난 것은 Edge Function을 거치지 않고 처리할 수 없으므로, 정리 대상 id 목록을 돌려주고 화면이 `tick`을 부른다).
- `lb_duel(game_id)`: 레이팅 순위. 랭크 5판 미만은 "배치 중"으로 따로.
- `duel_stats(handle, game_id)`: 레이팅, 랭크 승·무·패·승률, 전체(친선 포함) 승·무·패, 최근 20판.
- `duel_h2h(handle_a, handle_b, game_id NULL)`: 게임별 상호 승·무·패, 최근 20판.
- 숨김 게임은 관리자가 아니면 모든 목록·통계에서 제외(기존 규칙).

## 8. 첫 게임: 요트 다이스 (`yacht`)

Yahtzee 공식 규칙.

- manifest: id `yacht`, 이름 `요트 다이스`, `category: 'duel'`, `hidden: true`, `duel.turnSeconds` [30, 60, 90] 기본 60, `sameScreen: true`, 설정 없음.
- 13턴씩, 총 26턴. 한 턴에 주사위 5개를 최대 3번 굴린다. 두 번째·세 번째 굴림 전에 고정할 주사위를 고른다. 턴 끝에 빈 칸 하나를 골라 점수를 적는다(0점 가능).
- 행동: `{ type: 'roll', keep: number[] }`(keep은 고정할 주사위 위치 0~4, 첫 굴림은 빈 배열), `{ type: 'score', category }`. 굴리기 전 `score`, 3번 굴린 뒤 `roll`은 오류.

| 칸 | 점수 |
|---|---|
| Aces~Sixes | 해당 눈의 합 |
| 위 칸 보너스 | 위 6칸 합 ≥ 63이면 +35 |
| Choice | 5개 합 |
| 3 of a Kind | 같은 눈 3개 이상이면 5개 합, 아니면 0 |
| 4 of a Kind | 같은 눈 4개 이상이면 5개 합, 아니면 0 |
| Full House | 3개 + 2개면 25 |
| Small Straight | 4개 연속이면 30 |
| Large Straight | 5개 연속이면 40 |
| Yacht | 5개 같으면 50 |

- **추가 Yacht(조커 규칙)**: 5개가 같고 Yacht 칸이 이미 채워졌을 때.
  - Yacht 칸이 50이면 +100 보너스(횟수마다).
  - 같은 눈의 위 칸이 비어 있으면 그 칸에만 넣을 수 있다.
  - 그 칸이 차 있으면 아래 칸 아무 데나 넣을 수 있고 조건을 만족한 것으로 친다(Full House 25, Small 30, Large 40, 3·4 of a Kind와 Choice는 5개 합).
  - 아래 칸도 모두 차 있으면 빈 위 칸 하나에 0점으로 넣는다.
  - Yacht 칸이 0이면 보너스 없이 같은 배치 규칙만 적용.
- **승패**: 26턴 뒤 총점(위 칸 + 보너스 + 아래 칸 + 추가 Yacht 보너스)이 높은 쪽 승, 같으면 무승부.
- **시간 초과 기본 수**: 아직 안 굴렸으면 한 번 굴린다(keep 없음). 그다음 규칙상 둘 수 있는 빈 칸 중 점수가 가장 높은 칸에 적는다. 같으면 표 순서상 앞 칸.
- `turnNo` = 지금까지 채운 칸 수의 합. `view`는 숨길 정보가 없어 전체 상태(두 사람의 칸, 현재 주사위, 남은 굴림 수)를 준다.
- 같은 화면 모드: 같은 로직, 턴 시간 제한 없음, 화면 하단에 "○○ 차례" 표시와 기기 넘기기 안내.

## 9. 화면

- **대전 탭** `/duel`: 대국 만들기(게임, 랭크/친선, 공개/초대, 턴 시간), 같은 화면 시작, 대기실(공개 대기 대국), 내 대국(대기·진행), 최근 결과.
- **대국** `/duel/:id`: 위에 두 사람 아이디·레이팅·남은 시간(내 차례 강조), 가운데 게임 화면(`GameProps`와 별도의 `DuelGameProps`: `view`, `mySeat`, `toMove`, `busy`, `error`, `onAction`), 아래 기권(두 번 눌러 확정). 대기 중이면 초대 링크 복사 버튼과 취소.
- **결과**: 승패, 점수, 레이팅 변화(랭크일 때), 재대결.
- **같은 화면** `/duel/local/:game`: 서버 호출 없음.
- **초대 링크** `/duel/join/:code`: 승인 전이면 기존처럼 가입·승인 뒤 돌아온다.
- **리더보드**: "대전" 탭, 게임 선택, Elo 순위와 배치 중 목록.
- **프로필**: 게임별 레이팅·승률·최근 대국, 상대 선택 시 상대 전적.

## 10. 오류 처리

- 차례가 아닐 때·같은 행동 중복: `expected_action_no`로 거른다(409 stale + 최신 상태).
- 네트워크 단절 후 복귀: `view`로 맞춘다. 그동안 시간 초과가 처리됐으면 그 결과가 보인다.
- 로직 버전 변경: 진행 중 대국은 다음 요청 때 무효 처리(409 version_changed, "규칙이 바뀌어 이 대국은 무효가 됐어요").
- Realtime 연결 실패: 폴링만으로 계속 동작한다(반응만 느려짐).
- `logic.apply`의 예외는 서버 로그에만 남기고 400 invalid_action.

## 11. 테스트

- 요트 로직: 13칸 점수, 위 칸 보너스 경계(62/63), 조커 규칙 전 경우(위 칸 강제, 아래 칸 만점, 0점 위 칸, Yacht 0일 때 보너스 없음), 굴림 3회 제한, keep 유지, 굴리기 전 score 거부, 시간 초과 기본 수, 같은 시드 같은 주사위, 26턴 뒤 승패·무승부.
- Elo: 승·무·패, 레이팅 차이별 기대값, K 40→20 전환, 반올림.
- pgTAP: `state` 직접 읽기 불가, 참가자 외 `duel_moves` 읽기 불가, 대기 3개 제한, 랭크 종료 시 레이팅·변화 기록이 함께 갱신, 친선·무효는 미반영, `duel_h2h`·`duel_stats` 계산, 숨김 게임 제외, 자동 취소.
- Edge Function: 생성 → 참가 → 한 판 끝까지 → Elo 반영, 차례 아님 409, 중복 행동 409 stale, 시간 초과 1회 기본 수, 연속 2회 기권패, 첫 수 전 기권 무효, 로직 버전 변경 무효, 브로드캐스트 호출(가짜 의존으로 확인).
- 화면: 대국 화면이 내 차례에만 조작 가능, 기권 두 번 확인, 마감 지나면 `tick` 호출, 같은 화면 모드 한 판.
- 수동(미리보기): 폰 두 대로 실시간 한 판, 한쪽 창 닫고 기권패까지, 초대 링크·대기실 각각.

## 12. 공개 순서

1. 숨김(`hidden: true`)으로 머지, 마이그레이션 적용, `duel` 함수 배포(`--no-verify-jwt`).
2. 관리자 둘이 미리보기·운영에서 랭크·친선·같은 화면 각각 한 판.
3. 숨김 해제 마이그레이션 + manifest 수정 PR.

## 13. 범위 밖

- 리그전·토너먼트(별도 설계, 대국의 `parent_*` 칸 사용)
- 티키타카토 대전형(커리어 데이터 준비 후 별도 게임 설계)
- 관전, 다시보기 화면, 채팅, 자동 매칭
- 같은 화면 모드 기록·통계

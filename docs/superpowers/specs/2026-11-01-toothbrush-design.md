# 양치 시뮬레이터 (`toothbrush`) 설계

작성: 2026-11-01. 플랫폼 설계(`2026-10-31-onlyfms-platform-design.md`)를 따르고, 여기서는 이 게임과 그에 필요한 플랫폼 공통 변경만 다룬다. 독립 검토(1차)를 반영한 판이다.

## 1. 목표와 범위

- 친구끼리 점수를 겨루는 1인 캐주얼 게임. 60초 동안 칫솔로 치아의 플라그를 문질러 지우고, 지운 비율로 점수를 받는다.
- **자유 플레이 전용.** 데일리·대회 없음 (`modes: { daily: false, contest: false, free: true }`).
- 판마다 플라그 배치가 무작위(층화 생성, §3.4). 리더보드는 이 게임만 **최고 점수** 기준 정렬.
- 점수는 기존 자유 플레이 방식대로 클라이언트가 계산해 `free_plays`에 저장한다(신뢰 모델 변경 없음). 출제 시드와 행동 로그를 함께 저장해 **재현**할 수 있게 한다(§5.3). 단, 로그 없이 `free_plays`에 직접 넣는 것도 여전히 가능하므로 로그는 검증 수단이 아니다. 리플레이·디버깅·밸런스 분석용이다.
- 처음에는 `hidden: true`로 머지하고 관리자 확인 뒤 공개한다.

범위 밖: 데일리·대회 모드, 리플레이 화면, 서버 재검증, 게임 화면 안의 "내 최고 기록"(리더보드 '최고' 열로 대신), 효과음.

## 2. 매니페스트

```ts
{
  id: 'toothbrush',
  name: '양치 시뮬레이터',
  description: '60초 동안 양치해서 플라그를 지운다',
  hidden: true,
  modes: { daily: false, contest: false, free: true },
  puzzleSource: 'generate',
  dailyTimeLimitSec: null,
  options: [],
  freeDefaultSort: 'best',   // §5.1에서 추가하는 선택 필드
}
```

## 3. 로직 (`src/games/toothbrush/logic.ts`, 순수 함수)

모든 판정·채점 연산은 정수 덧셈·곱셈·나눗셈 후 `Math.floor`·비교뿐이다. `sqrt`·초월함수·부동소수 누적·`Math.random`·`ctx`를 쓰지 않는다. 난수는 `pickPuzzle`이 받은 `rng`만 쓴다. 시드와 행동 열이 같으면 어느 엔진에서든 결과가 같다.

### 3.1 시간
- 고정 틱 60Hz. 한 판은 `TOTAL_TICKS = 3600`(60초).
- 시간은 벽시계가 아니라 **입력 샘플 개수**로 센다. 샘플 1개 = 1틱.
- `ticks`가 3600이 되면 끝난다(`isFinished`). 모두 닦아도 일찍 끝나지 않는다(포기는 가능). 마지막 행동이 남은 틱보다 많은 샘플을 담고 있으면 앞에서부터 남은 틱만큼만 적용한다.

### 3.2 공간과 치아 마스크 (`src/games/toothbrush/mask.ts`)
- 구역 6개(`ZONES`, 순서 고정): 0 위 바깥 면, 1 위 안쪽 면, 2 위 씹는 면, 3 아래 바깥 면, 4 아래 안쪽 면, 5 아래 씹는 면. 시작 구역은 0.
- 구역마다 논리 좌표 `480 × 320`(정수). 플라그 격자는 `W × H = 48 × 32`칸, 1칸 = 10단위. 샘플 `(x, y)`의 칸은 `(⌊x/10⌋, ⌊y/10⌋)`. 칸 번호는 행 우선 `i = row × 48 + col`.
- 치아는 한 줄에 14개, 너비(칸) `[4,4,3,3,3,3,3,3,3,3,3,3,4,4]`(합 46), 열 1부터 빈틈 없이 이어 놓는다(열 0과 47은 비움).
- 치아 하나는 열 범위 × 행 범위의 직사각형에서 **네 모서리 칸을 뺀** 모양이다.
  - 바깥·안쪽 면(구역 0, 1, 3, 4): 치아 행 6~27(22행). 위 치아(0, 1)는 행 0~5, 아래 치아(3, 4)는 행 28~31이 잇몸 띠로 그려진다(플라그 없음, 그림만).
  - 씹는 면(구역 2, 5): 치아 행 8~23(16행).
- 치아 칸 수: 바깥·안쪽 면 `46 × 22 − 14 × 4 = 956`칸, 씹는 면 `46 × 16 − 56 = 680`칸. 테스트로 고정한다.
- 마스크는 이 규칙에서 계산한 상수다. 바꾸면 `logic.version`을 올린다.

### 3.3 행동
- `{ type: 'b', s: number[] }` — 문지르기. `s`는 `[x0, y0, x1, y1, …]`, 샘플 하나가 1틱. 접촉 없는 틱은 `-1, -1`. 배열 길이는 짝수, 샘플 수는 1~30. 각 값은 정수이고, 샘플은 `0 ≤ x < 480`, `0 ≤ y < 320`이거나 정확히 `(-1, -1)`. 어긋나면 `{ error }`(상태 불변).
- `{ type: 'z', zone: k }` — 구역 전환. 정수 `0 ≤ k < 6`, 현재 구역과 달라야 하고, **시계가 시작된 뒤(`ticks > 0`)에만** 허용된다. 틱을 쓰지 않는다. 전환하면 `cooldown = SWITCH_TICKS (30)`, `prev = null`.
- `{ type: 'give_up' }` — 플랫폼 공통. `ticks = 3600`으로 만들어 끝낸다.
- 끝난 뒤의 모든 행동은 `{ error }`.

### 3.4 플라그 배치 (`pickPuzzle`, 층화 생성)
퍼즐은 구역별 칸 두께 배열 6개(각 1536칸, 정수 0~`MAX_THICK = 255`, 치아 아닌 칸은 항상 0)다. 구역마다 순서대로:

1. **기본층**: 모든 치아 칸 = `BASE (20)`.
2. **덩어리**: `BLOBS (6)`번 반복. 중심 = 치아 칸 목록(행 우선 고정 순서)에서 `⌊rng() × n⌋`번째, 반지름 `r = 3 + ⌊rng() × 4⌋`(3~6). 중심에서 `dx² + dy² ≤ r²`인 치아 칸(격자 밖·치아 아닌 칸 제외)에 `BLOB_ADD (60)`를 더하고 `MAX_THICK`에서 자른다. rng 호출 순서: 덩어리마다 중심 → 반지름.
3. **총량 맞추기**: 구역 총량을 정확히 `ZONE_TOTAL[z]`로 맞춘다. 후보는 그 구역의 **모든 치아 칸**(행 우선 고정 순서). 모자라면 후보를 처음부터 순환하며 `MAX_THICK` 미만인 칸에 1씩 더하고, 넘치면 순환하며 0 초과인 칸에서 1씩 뺀다. 한 칸에 몇 번이든 들를 수 있다.
   - 종료 보장: `0 ≤ ZONE_TOTAL[z] ≤ 치아 칸 수 × MAX_THICK`이면 매 순환마다 최소 1은 움직이므로 반드시 끝난다(바깥·안쪽 상한 243,780, 씹는 면 173,400). 이 부등식을 상수에 대한 테스트로 확인한다. 루프는 칸 하나씩이 아니라 "한 바퀴에 일괄"로 구현해도 결과가 같아야 한다.
- 결과: 판마다 덩어리 위치는 달라도 **구역별 총량이 항상 같다** → 맵 운이 줄어든다. 기본층이 치아 전체에 있으므로 "남은 데를 찾아 닦기"와 "두꺼운 데에 오래 머물기"가 함께 실력 요소다.
- `puzzleKey`: 6개 배열을 이어 붙인 값의 FNV-1a 32비트 해시(16진 8자). 곱셈은 `Math.imul`, 결과는 `>>> 0`.

### 3.5 브러싱 모델 (틱마다)
틱마다 샘플 `p`에 대해 순서대로:

1. `p = (-1, -1)`(접촉 없음): `prev = null`. 끝.
2. `d² = (p.x − prev.x)² + (p.y − prev.y)²`. `prev`가 null이면 `d² = 0`. 그 뒤 `prev = p`(전환 대기 중에도 갱신).
3. `cooldown > 0`이면 `cooldown −= 1`. 닦지 않고 잇몸도 늘지 않는다. 끝.
4. 속도 구간(단위²/틱²):

   | 구간 | 조건 | 속도(단위/s) | 칸당 감소 `dec` | 잇몸 |
   |---|---|---|---|---|
   | 느림 | `d² < 4` | < 120 | 1 | — |
   | 최적 | `4 ≤ d² < 144` | 120 ~ 720 | 4 | — |
   | 빠름 | `d² ≥ 144` | ≥ 720 | 1 | `gumTicks += 1` |

5. 칫솔 중심 칸 `(cx, cy)`에서 `dx² + dy² ≤ R² (R = 3)`인 칸(최대 29칸, 격자 밖은 건너뜀)마다 `t = min(dec, 두께)`만큼 빼고 `removed += t`. 두께는 0 아래로 내려가지 않는다.

틱 증가(`ticks += 1`)는 샘플마다 1~5와 무관하게 일어난다.

### 3.6 상태·점수
- 상태: `{ zones: number[][] (6 × 1536), zone, ticks, cooldown, prev: [x, y] | null, gumTicks, switches, removed }`. `apply`는 바뀌는 구역 배열만 복사해 바꾸고 입력 상태를 변경하지 않는다.
- `TOTAL = Σ ZONE_TOTAL`. 점수(정수 0.1점 단위로 계산):
  - `tenths = ⌊(100 × removed + ⌊TOTAL / 2⌋) / TOTAL⌋ − ⌊gumTicks / 60⌋`
  - `score = clamp(tenths, 0, 100) / 10`
  - 즉 빠르게 문지른 1초마다 0.1점 감점이다. 끝나지 않았을 때도 같은 식("지금 포기하면 받을 점수").
- `actionCount = switches`(구역 전환 횟수). 자유 플레이 정렬에는 쓰이지 않는다.
- `publicState`: `{ zones, zone, ticksLeft, cooldown, gumTicks, started: ticks > 0, cleanByZone: number[] }`. `cleanByZone[z] = ⌊100 × (ZONE_TOTAL[z] − 남은 총량) / ZONE_TOTAL[z]⌋`(내림이라 플라그가 남아 있으면 100이 되지 않는다).
- `reveal`: `null`.
- 플랫폼의 `solved`(`score > 0`)는 그대로 둔다. 이 게임에서는 거의 항상 참이라 정답·정답률 열은 의미가 약하지만, 정렬은 최고 점수라 문제 삼지 않는다.

### 3.7 상수와 난이도 목표
초기값: `BASE = 20`, `BLOB_ADD = 60`, `BLOBS = 6`, 반지름 3~6, `MAX_THICK = 255`, `R = 3`, 속도 경계 `4 / 144`, 감소량 `1 / 4 / 1`, 감점 0.1점/초, `SWITCH_TICKS = 30`, `ZONE_TOTAL = [60000, 60000, 45000, 60000, 60000, 45000]`(합 330,000).

- **용량비 목표**: 칫솔이 매 틱 29칸 모두 최적 감소를 낼 때의 최대 제거량은 `29 × 4 × (3600 − 5 × 30) = 400,200`이다. 이 값이 `TOTAL`의 약 1.2배가 되게 잡는다. 실제로는 칫솔 가장자리가 이미 깨끗한 칸에 걸리고, 동선이 겹치고, 최적 속도로 계속 움직이며 한 곳에 오래 머물 수 없다. 그래서 이상적인 사람도 전부는 지우지 못하는 수준이다.
- 이 수치는 초기값이고, §7 밸런스 테스트가 통과하도록 조정한다. 공개 뒤 조정할 때마다 `logic.version`을 올린다.

## 4. 화면 (`src/games/toothbrush/Game.tsx`)

- 레이아웃(모바일 우선): 남은 시간 막대 → 잇몸 게이지 → 3:2 캔버스(컨테이너 폭) → 구역 버튼 6개(2×3, 각 청결도 % 표시). 구역 전환은 버튼으로만 한다(스와이프는 문지르기와 충돌). 시작 전(`started = false`)에는 구역 버튼이 비활성이다(로직도 거부). 그래서 다른 구역 지도를 미리 볼 수 없다.
- 입력: Pointer Events로 마우스·터치를 통합하고, 캔버스에 `touch-action: none`을 건다. 접촉 = 포인터 누름. 화면 좌표 → 논리 `480 × 320` 정수, 영역 밖은 가장자리로 고정.
- 샘플링: rAF마다 `performance.now()` 누산기로 지난 시간만큼 60Hz 샘플 `n`개를 만든다. 샘플 위치는 직전에 내보낸 위치와 현재 포인터 위치 사이를 정수 선형 보간한다(`x_i = x0 + ⌊(x1 − x0) × i / n⌋`, i = 1..n). 프레임률(30/60/120Hz)과 무관하게 같은 손동작이 같은 `d²`를 내게 하려는 것이다. 접촉이 없으면 `(-1, -1)`.
- 프레임 간격이 250ms를 넘으면(탭 전환, 끊김) 그 공백은 버리고 `(-1, -1)` 샘플 하나를 넣는다(`prev`를 끊어 순간이동이 빠름 구간으로 판정되지 않게). **탭을 숨기면 게임이 멈추는 것은 의도된 동작이다.**
- 모은 샘플은 50ms마다 `onAction({ type: 'b', s })`로 보내고, 30샘플을 넘으면 여러 행동으로 나눈다.
- **시계는 캔버스를 처음 누른 순간부터 간다.** 그 전에는 샘플을 만들지 않는다.
- 렌더링: 치아 마스크와 잇몸 띠를 그리고, 플라그 칸을 두께에 비례한 불투명도로 덮는다. 칫솔 커서는 포인터를 즉시 따라가고, 닦임 반영은 최대 50ms 늦다. 빠름 구간이면 잇몸 게이지가 붉게 깜빡이고, 전환 대기 중에는 캔버스를 흐리게 표시한다.
- 끝나면: 점수, 구역별 청결도, 잇몸 손상 초. 그 아래에 플랫폼의 "한 판 더".
- 색: 캔버스 바깥 UI는 `theme.css`·팔레트 토큰만 쓴다. 캔버스 안의 치아·플라그·잇몸 색은 예외이며 `CLAUDE.md` 금지 사항의 예외 목록에 추가한다.

## 5. 플랫폼 공통 변경

### 5.1 자유 플레이 리더보드: 최고 점수
- 새 마이그레이션:
  - `drop function public.lb_free(text); drop function public._free_stats(text, boolean);`
  - 0004의 정의 그대로 다시 만들되, 반환 맨 끝에 `best_score numeric`(= `max(f.score)`)을 추가한다. `lb_free`의 서버 정렬은 그대로 둔다.
  - 권한은 0004 패턴을 다시 적용한다: 두 함수 모두 `revoke all … from public, anon, authenticated`, `lb_free`만 `grant execute … to authenticated`. (새 함수에는 PUBLIC 실행 권한이 기본으로 붙으므로 revoke가 필수다.)
  - `user_stats`(0004:271)는 `select st.*`에서 이름으로 키를 뽑으므로 영향이 없다. 다시 만들 필요는 없고, 출력도 바뀌지 않는다(DB 테스트로 확인).
- `Manifest`에 선택 필드 `freeDefaultSort?: 'wins' | 'rate' | 'plays' | 'best'` 추가. 생략하면 `'wins'`(지금과 같음).
- `LeaderboardPage`:
  - `FreeRow`에 `best_score`, `Sort`에 `'best'`, `sortFree`에 `best`(`best_score` desc → `plays` desc), `SORTS`에 `['best', '최고 점수']`, `SORT_COLUMN.best = '최고'`.
  - 게임 필터를 바꾸면 정렬을 그 게임의 `freeDefaultSort ?? 'wins'`로 맞춘다('전체 합계'는 `'wins'`).
  - '최고' 열과 '최고 점수' 정렬 선택지는 게임을 하나 골랐을 때만 보인다(전체 합계의 최고 점수는 의미가 없다).
  - 후알야는 `freeDefaultSort`가 없으므로 기본 화면이 그대로다. 기존 `LeaderboardPage.test.tsx`의 정렬 테스트는 그대로 통과해야 한다.

### 5.2 자유 플레이 출제 시드
- 새 모듈 `src/platform/games/seed.ts`: `newSeed(): Uint8Array`(16바이트, `crypto.getRandomValues`), `seedHex(seed): string`(소문자 16진 32자).
- `LocalRunner`는 `pickPuzzle(rngFromSeed(newSeed()), options)`로 출제한다. 출제 분포는 바뀌지 않는다.
- 테스트: `PlayRunner.test.tsx`의 `local_mode_submits_free_play_on_finish`는 지금 `vi.spyOn(Math, 'random')`으로 정답을 고정한다. 이 테스트는 `seed.ts`를 `vi.mock`해 고정 시드를 주는 방식으로 바꾼다(그 시드에서 test-guess의 정답을 테스트 안에서 계산).

### 5.3 행동 로그 저장 (모든 자유 플레이 게임)
**LocalRunner 상태 관리 수정** (로그와 점수가 어긋나지 않게 하는 선행 조건):
- 지금 `onAction`은 렌더 클로저의 `state`에 적용한다. 한 렌더 안에서 행동이 두 번 오면(샘플 분할, 같은 틱의 구역 클릭) 뒤 행동이 앞 행동을 덮어쓴다.
- 권위 있는 상태와 행동 로그를 `useRef`에 두고 들어오는 순서대로 적용한 뒤 `setState(ref.current)`로 화면을 갱신한다. 성공한 행동(플랫폼 `give_up` 포함)만 로그에 쌓는다.
- 테스트: 한 렌더 안에서 행동 두 개를 동기적으로 보내면 둘 다 반영되는지 확인한다.

**테이블 `free_play_logs`** (새 마이그레이션):
```
client_id  uuid primary key references free_plays(client_id) on delete cascade
user_id    uuid not null references auth.users(id) on delete cascade
seed       text not null  check (seed ~ '^[0-9a-f]{32}$')
actions    jsonb not null check (jsonb_typeof(actions) = 'array')
created_at timestamptz not null default now()
check (octet_length(actions::text) <= 262144)   -- 256KB. jsonb::text는 공백이 붙어 원문보다 약 25% 크다
```
- RLS·권한(0002 패턴):
  - `security definer` 도우미 `public._owns_free_play(p_client uuid) returns boolean`: `free_plays`에서 `client_id = p_client and user_id = auth.uid()`인 행이 있는지 본다. 호출자 RLS를 거치지 않으므로, 숨김 게임이 되어도 본인 기록 확인이 막히지 않는다. 도우미는 0002 패턴대로 `revoke execute … from public, anon, authenticated` 후 `grant execute … to authenticated`(정책이 invoker 권한으로 부르므로).
  - 정책: INSERT `with check (user_id = auth.uid() and public.is_approved() and public._owns_free_play(client_id))`. SELECT `using (public.is_approved() and (user_id = auth.uid() or public.is_admin()))`. UPDATE·DELETE 정책 없음.
  - 테이블 권한: `revoke all … from public, anon, authenticated` 후 `grant select … to authenticated`, `grant insert (client_id, user_id, seed, actions) … to authenticated`(0002의 `free_plays`처럼 열 단위).

**대기열 `src/platform/games/freeLogQueue.ts`** (점수 대기열과 분리):
- localStorage 키 `onlyfms:freeLogQueue`, 최대 `MAX_LOG_QUEUE = 10`건. 넘치면 오래된 것부터 버린다. 쓰기가 실패하면(용량 초과 등) 메모리에만 두고, 그것도 안 되면 로그를 버린다. 어떤 경우에도 점수 기록에는 영향을 주지 않는다.
- 행 형식: `{ client_id, user_id, seed, actions, attempts }`.
- `submitLog(row, after: Promise<void>)`: 로그를 대기열에 넣는다. 그다음 `after`가 끝나기를 기다린 뒤(성공이든 실패든) `flushLogs()`를 부른다. `LocalRunner`는 `const p = freeQueue.submit(…)`를 호출한 다음 `void freeLogQueue.submitLog(log, p)`를 호출한다. 점수 행 전송이 끝난 직후에 로그도 같은 화면에서 바로 나간다.
- `flushLogs()`: 각 로그에 대해
  - 같은 `client_id`가 아직 점수 대기열(`freeQueue`)에 있으면 건너뛴다(점수 행이 먼저 저장돼야 함).
  - upsert(`onConflict: 'client_id', ignoreDuplicates: true`). 성공하면 제거한다.
  - 오류 코드 `23503`(외래 키: 점수 행이 서버에 없음)이면 `attempts += 1`, 3번째면 제거한다(점수 행이 점수 대기열에서 밀려났거나 거부된 경우).
  - `42501`(RLS 거부, 다른 계정으로 쌓인 로그 등) 또는 `23514`(크기·형식 위반)이면 즉시 제거한다.
  - 네트워크 오류 등 그 밖의 실패는 남겨 둔다.
- `useFreeQueueFlush`(레이아웃)와 온라인 복귀 때 점수 대기열을 비운 뒤 로그 대기열도 비운다.
- 크기: 양치 한 판은 50ms 묶음으로 약 1,200행동, JSON으로 약 50KB. 후알야는 1KB 미만. 10건이면 localStorage 0.5MB 정도다.

## 6. 등록·배포

- `src/games/index.ts`의 `games`에 한 줄, `src/games/ui.ts`의 `components`에 한 줄.
- 마이그레이션(`npx supabase@2 migration new`로 이름 생성): `insert into game_modes (game_id, daily, contest, free) values ('toothbrush', false, false, true);`와 `insert into hidden_games (game_id) values ('toothbrush');`. `registry.test.ts`의 정규식에 맞도록 이 문장 형식을 그대로 쓴다. 리더보드·로그 변경은 별도 마이그레이션 파일로 둔다.
- `play` Edge Function: 등록부 일치 검사가 없고, 데일리가 없는 게임은 404로 끝난다. 그래서 재배포는 필요 없다(번들에 새 로직이 들어가도 동작은 같다).
- `docs/deploy-checklist.md`: DB push로 마이그레이션 3개 적용 순서만 적는다.
- `CLAUDE.md`: 금지 사항의 색 예외에 "양치 캔버스 내부 색"을 추가한다. 자유 플레이 로그(`free_play_logs`, `freeLogQueue`)를 폴더·규칙 설명에 한 줄 추가한다.

## 7. 테스트

- `mask.test.ts`: 구역별 치아 칸 수(956/680), 치아 아닌 칸 위치, 모든 구역 `ZONE_TOTAL[z] ≤ 치아 칸 수 × MAX_THICK`.
- `logic.test.ts`
  - 결정론: 같은 시드·같은 행동 열 → 같은 상태·점수. 고정 시드에 대한 `puzzleKey` 스냅샷.
  - 층화: 시드 1,000개에서 생성이 끝나고, 구역별 총량 = `ZONE_TOTAL[z]`, 치아 아닌 칸 = 0, 모든 칸 0~`MAX_THICK`.
  - §3.5 순서: 속도 구간별 감소량, 잇몸은 빠름 + 접촉 + 비대기에서만, 대기 중 `prev` 갱신과 미닦음, 접촉 끊김 뒤 첫 틱 `d² = 0`, 격자 가장자리 칫솔 잘림, 0 아래로 안 내려감.
  - 시간: 3600틱에서 종료, 초과 샘플 무시, 다 닦아도 종료 안 됨, `give_up`, 종료 뒤 행동 거부.
  - 잘못된 행동: 샘플 0개·31개, 홀수 길이, 범위 밖·소수 좌표, `(-1, 5)` 같은 반쪽 무접촉, 같은 구역 전환, 시작 전 전환 → `{ error }`이고 상태 불변.
  - 점수식(정수 계산, 반올림 경계, 0·10 자르기), `cleanByZone` 내림.
- 밸런스(`balance.test.ts`, 봇 4종, 시드 20개)
  - 조준 봇(사람 상한 근사): 각 구역에 남은 시간을 균등하게 배분한다. 구역 안에서는 최적 속도(틱당 약 6단위)로 "칫솔 원 안 남은 두께 합이 가장 큰 칸" 쪽으로 이동하며 짧게 왕복한다. 배분 시간이 끝나면 다음 구역으로 간다. 시간이 남으면 청결도가 가장 낮은 구역으로 돌아간다.
  - 왕복 봇: 구역마다 같은 시간, 행 단위 지그재그를 최적 속도로.
  - 낙서 봇: 구역 전환 없이 틱당 20단위 이상으로 무작위 왕복.
  - 가만히 봇: 한 점을 누르고 있음.
  - 기대: 조준 봇 평균 8.0~9.5이고 20판 모두 10.0 미만, 왕복 봇 평균이 조준 봇보다 0.5 이상 낮음, 낙서 봇 ≤ 3.0, 가만히 봇 ≤ 1.0. 안 맞으면 §3.7 상수를 조정한다(만점에 가까우면 `ZONE_TOTAL`을 올리고, 너무 어려우면 내린다. 용량비 1.1~1.4 범위 안에서).
- `Game.test.tsx`: 렌더링. 시작 전 구역 버튼 비활성. 가짜 타이머로 포인터 누름 뒤 샘플이 50ms 묶음·30개 이하로 나가는지. 누르기 전에는 행동이 없는지. 30Hz·60Hz 프레임에서 같은 손동작이 같은 샘플 열을 내는지(보간). 250ms 넘는 공백 뒤 `(-1, -1)`.
- 플랫폼:
  - `registry.test.ts`(등록부·시드 일치).
  - `LeaderboardPage.test.tsx`: 기본 정렬이 `freeDefaultSort`를 따르는지, 후알야는 그대로인지, '최고' 열·선택지 표시 조건, 기존 `free_tab_sort_toggle` 통과.
  - `PlayRunner.test.tsx`: 시드 모듈 모킹, 로그 제출, 동기 연속 행동.
  - `freeLogQueue.test.ts`: 점수 대기열에 있으면 건너뜀, 23503 3회 뒤 제거, 42501·23514 즉시 제거, localStorage 쓰기 실패에도 점수 대기열 무사, 최대 10건.
- DB(`supabase/tests/`): `free_play_logs` RLS(남의 `client_id` 거부, 미승인 거부, 숨김 게임 본인 기록 허용, 본인·관리자 조회, 남의 로그 조회 불가, UPDATE·DELETE 불가), 크기 제한, `lb_free`·`_free_stats`의 `best_score`, `user_stats` 출력 불변, `anon`의 `lb_free` 실행 불가.
- 검증: `npm test && npm run typecheck && npm run build`, `npm run db:test`.

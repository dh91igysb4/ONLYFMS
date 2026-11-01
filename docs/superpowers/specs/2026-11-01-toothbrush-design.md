# 양치 시뮬레이터 (`toothbrush`) 설계

작성: 2026-11-01. 플랫폼 설계(`2026-10-31-onlyfms-platform-design.md`)를 따르고, 여기서는 이 게임과 그에 필요한 플랫폼 공통 변경만 다룬다.

## 1. 목표와 범위

- 친구끼리 점수를 겨루는 1인 캐주얼 게임. 60초 동안 칫솔로 치아의 플라그를 문질러 지우고, 지운 비율로 점수를 받는다.
- **자유 플레이 전용.** 데일리·대회 없음 (`modes: { daily: false, contest: false, free: true }`).
- 판마다 플라그 배치가 무작위(층화 생성, §3.4). 리더보드는 이 게임만 **최고 점수** 기준 정렬.
- 점수는 기존 자유 플레이 방식대로 클라이언트가 계산해 `free_plays`에 저장한다(신뢰 모델 변경 없음). 대신 **행동 로그와 출제 시드를 함께 저장**해 나중에 재현·검증할 수 있게 한다(§5.3).
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

### 3.1 시간
- 고정 틱 60Hz. 한 판은 `TOTAL_TICKS = 3600`(60초).
- 시간은 벽시계(`ctx.now`)가 아니라 **입력 샘플 개수**로 센다. 샘플 1개 = 1틱. 로직은 `ctx`를 쓰지 않는다.
- 3600틱이 소진되면 끝난다(`isFinished`). 마지막 행동이 남은 틱보다 많은 샘플을 담고 있으면 남은 틱만큼만 적용한다.

### 3.2 공간
- 구역 6개(`ZONES`): 위 바깥 면, 위 안쪽 면, 위 씹는 면, 아래 바깥 면, 아래 안쪽 면, 아래 씹는 면. 시작 구역은 0(위 바깥 면).
- 구역마다 논리 좌표 `480 × 320`(정수). 플라그 격자는 `48 × 32`칸, 1칸 = 10단위. 샘플 `(x, y)`가 속한 칸은 `(⌊x/10⌋, ⌊y/10⌋)`.
- **치아 마스크**: 구역마다 어느 칸이 치아인지 나타내는 고정 마스크. `src/games/toothbrush/mask.ts`가 정수 기하(둥근 사각형, 타원의 `x²·b² + y²·a² ≤ a²·b²` 판정)로 만든다. 바깥·안쪽 면은 치아 열을 펼친 정면도, 씹는 면은 위에서 본 U자 치열. 마스크는 버전에 고정된 상수다(바꾸면 `logic.version` 올림).

### 3.3 행동
- `{ type: 'b', s: number[] }` — 문지르기. `s`는 `[x0, y0, x1, y1, …]`, 샘플 하나가 1틱. 접촉 없는 틱은 `-1, -1`. 샘플 수는 1~30. 좌표는 정수이고 `0 ≤ x < 480`, `0 ≤ y < 320`이거나 `(-1, -1)`이어야 한다. 어긋나면 `{ error }`.
- `{ type: 'z', zone: k }` — 구역 전환(`0 ≤ k < 6`, 현재 구역과 달라야 함). 틱을 쓰지 않고, 전환 뒤 `SWITCH_TICKS = 30`(0.5초) 동안은 접촉해도 닦이지 않는다(틱은 흐른다).
- `{ type: 'give_up' }` — 플랫폼 공통. 남은 틱을 0으로 만들어 끝낸다.

### 3.4 플라그 배치 (`pickPuzzle`, 층화 생성)
- 퍼즐 = 구역별 칸 두께 배열 6개(각 `48 × 32`, 값 0~`MAX_THICK = 60`, 치아가 아닌 칸은 0).
- 구역마다 시드 난수로 플라그 덩어리 `BLOBS = 6`개의 중심을 치아 칸 중에서 고르고, 반지름 2~5칸 원 안의 치아 칸에 두께를 더한다(칸마다 `MAX_THICK`에서 자름).
- 그 뒤 구역 총량을 **정확히 `ZONE_TOTAL`**로 맞춘다: 모자라면 이미 플라그가 있는 칸을 행 우선 순서로 돌며 1씩 더하고(`MAX_THICK` 미만인 칸만), 넘치면 같은 순서로 1씩 뺀다. 순서가 고정이므로 결정론적이다.
- 결과: 판마다 위치는 달라도 **구역별 총량과 전체 총량이 항상 같다** → 맵 운이 줄어든다.
- `puzzleKey`: 두께 배열 전체의 FNV-1a 32비트 해시(16진). 자유 플레이에서는 쓰이지 않지만 계약상 필요하다.

### 3.5 브러싱 모델 (틱마다)
- 접촉 중이고 전환 대기(cooldown)가 아니면, 칫솔 중심 칸에서 `(dx² + dy² ≤ R²)`, `R = 3`칸인 칸들(29칸)의 두께를 줄인다.
- 감소량은 직전 틱 샘플과의 이동량 `d² = Δx² + Δy²`(논리 단위², 틱당)로 정한다. 직전 틱이 접촉이 아니었거나 구역이 바뀐 직후면 `d² = 0`으로 본다.

  | 구간 | 조건 | 초당 속도(단위/s) | 칸당 감소 | 잇몸 게이지 |
  |---|---|---|---|---|
  | 느림 | `d² < 4` | < 120 | 1 | — |
  | 최적 | `4 ≤ d² < 144` | 120 ~ 720 | 3 | — |
  | 빠름 | `d² ≥ 144` | ≥ 720 | 1 | +1틱 |

- 두께는 0 아래로 내려가지 않는다. 이미 깨끗한 칸은 다시 문질러도 이득이 없다.
- 모든 연산은 정수 덧셈·곱셈·비교뿐이다(`sqrt`·초월함수·부동소수 누적 없음).

### 3.6 상태·점수
- 상태: `{ zones: number[][](6 × 1536), zone, ticks, cooldown, prev: [x, y] | null, gumTicks, switches, removed }`. `apply`는 현재 구역 배열만 복사해 바꾼다(입력 상태를 변경하지 않는다).
- `score = clamp(0, 10, round1(10 × removed / TOTAL − 0.1 × ⌊gumTicks / 60⌋))`. 즉 빠르게 문지른 시간 1초마다 0.1점 감점. `TOTAL = 6 × ZONE_TOTAL`.
- 끝나지 않았을 때 `score`는 "지금 포기하면 받을 점수"(같은 식).
- `actionCount = switches`(구역 전환 횟수). 자유 플레이 정렬에는 쓰이지 않는다.
- `publicState`: 숨길 정보가 없으므로 `{ zones, zone, ticksLeft, cooldown, gumTicks, cleanByZone: number[](0~100 정수 %) }`.
- `reveal`: `null`.
- 플랫폼의 `solved`(`score > 0`)는 그대로 둔다. 이 게임에서는 거의 항상 참이라 정답·정답률 열은 의미가 약하지만, 정렬은 최고 점수라 문제 삼지 않는다.

### 3.7 초기 상수와 조정
`ZONE_TOTAL = 12000`, `BLOBS = 6`, `R = 3`, 속도 경계 `4 / 144`, 감소량 `1 / 3 / 1`, 감점 `0.1점/초`, `SWITCH_TICKS = 30`은 초기값이다. §7의 밸런스 테스트(스크립트 봇)가 통과하도록 조정하고, 공개 뒤 조정할 때마다 `logic.version`을 올린다.

## 4. 화면 (`src/games/toothbrush/Game.tsx`)

- 레이아웃(모바일 우선): 남은 시간 막대 → 잇몸 게이지 → 3:2 캔버스(컨테이너 폭) → 구역 버튼 6개(2×3, 각 청결도 % 표시). 구역 전환은 버튼으로만(스와이프는 문지르기와 충돌).
- 입력: Pointer Events로 마우스·터치 통합, 캔버스에 `touch-action: none`. 접촉 = 포인터 누름. 화면 좌표 → 논리 `480 × 320` 정수, 영역 밖은 가장자리로 고정.
- 샘플링: rAF마다 `performance.now()` 누산기로 지난 시간만큼 60Hz 샘플을 만든다(최신 포인터 위치를 그대로 씀). 프레임 간격이 250ms를 넘으면 그 공백은 버린다(일시정지). 모은 샘플은 50ms마다 `onAction({ type: 'b', s })`로 보내고, 한 행동은 30샘플을 넘지 않게 나눈다.
- **시계는 캔버스를 처음 누른 순간부터 간다.** 그 전에는 샘플을 만들지 않는다.
- 렌더링: 치아 마스크를 그리고, 플라그 칸을 두께에 비례한 불투명도로 덮는다. 칫솔 커서는 포인터를 즉시 따라간다(닦임 반영은 최대 50ms 지연). 빠름 구간이면 잇몸 게이지가 붉게 깜빡인다.
- 끝나면: 점수, 구역별 청결도, 잇몸 손상 초. 그 아래에 플랫폼의 "한 판 더".
- 색: 캔버스 바깥 UI는 `theme.css`·팔레트 토큰만. 캔버스 안의 치아·플라그·잇몸 색은 예외로 하고 `CLAUDE.md` 금지 사항의 예외 목록에 추가한다.

## 5. 플랫폼 공통 변경

### 5.1 자유 플레이 리더보드: 최고 점수
- 새 마이그레이션: `_free_stats`와 `lb_free`의 반환에 `best_score numeric`(= `max(score)`, 소수 첫째 자리)을 맨 끝 열로 추가한다. 반환형이 바뀌므로 `drop function` 후 다시 만들고, 기존 권한 설정(0004의 revoke/grant)을 그대로 다시 적용한다. `lb_free`의 서버 정렬과 프로필 통계 함수의 출력은 바꾸지 않는다.
- `Manifest`에 선택 필드 `freeDefaultSort?: 'wins' | 'rate' | 'plays' | 'best'` 추가. 생략하면 `'wins'`(지금과 같음).
- `LeaderboardPage`: 정렬 선택지에 '최고 점수'(`best`: `best_score` desc → `plays` desc) 추가. 게임 필터를 바꾸면 정렬을 그 게임의 `freeDefaultSort ?? 'wins'`로 맞춘다('전체 합계'는 `'wins'`). '최고' 열은 게임을 하나 골랐을 때만 보인다(전체 합계의 최고 점수는 의미가 없다). 전체 합계에서는 `best` 정렬 선택지도 숨긴다.
- 후알야는 `freeDefaultSort`가 없으므로 기본 화면이 그대로다.

### 5.2 자유 플레이 출제 시드
- `LocalRunner`가 `Math.random` 대신 `crypto.getRandomValues`로 만든 16바이트 시드를 `rngFromSeed`에 넣어 `pickPuzzle`한다. 시드는 16진 문자열로 로그에 남긴다(§5.3). 출제 분포는 바뀌지 않는다.

### 5.3 행동 로그 저장 (모든 자유 플레이 게임)
- 새 테이블 `free_play_logs`:
  ```
  client_id  uuid primary key references free_plays(client_id) on delete cascade
  user_id    uuid not null references auth.users(id) on delete cascade
  seed       text not null  check (seed ~ '^[0-9a-f]{32}$')
  actions    jsonb not null check (jsonb_typeof(actions) = 'array')
  created_at timestamptz not null default now()
  check (octet_length(actions::text) <= 262144)   -- 256KB
  ```
- RLS: INSERT는 `user_id = auth.uid()`이고 승인된 본인이며 같은 `client_id`의 `free_plays` 행이 본인 것일 때만. SELECT는 본인 또는 관리자. UPDATE·DELETE 없음.
- `LocalRunner`는 적용에 성공한 행동(플랫폼 `give_up` 포함)을 순서대로 모은다. 판이 끝나 `free_plays` 행을 제출할 때 같은 `client_id`로 로그를 **별도 대기열**(`freeLogQueue`)에 넣는다.
- `freeLogQueue`: localStorage 키를 따로 쓴다. `free_plays` 대기열을 비운 뒤에 보낸다(외래 키 때문에 점수 행이 먼저 있어야 함). 같은 `client_id`는 무시(upsert ignoreDuplicates). 최대 10건 보관, 넘치면 오래된 것부터 버린다. localStorage 쓰기가 실패하면(용량 초과 등) 로그만 버리고 점수 기록에는 영향을 주지 않는다. 외래 키 위반(점수 행 아직 없음)은 대기열에 남겨 다음에 다시 보낸다.
- 크기: 양치 한 판은 50ms 묶음으로 약 1,200행동, JSON으로 약 50KB. 후알야는 1KB 미만.

## 6. 등록·배포

- `src/games/index.ts`의 `games`에 한 줄, `src/games/ui.ts`의 `components`에 한 줄.
- 마이그레이션: `game_modes ('toothbrush', false, false, true)`, `hidden_games ('toothbrush')`. 리더보드·로그 마이그레이션과 같은 파일이어도 되고 나눠도 된다(이름은 `supabase migration new` 규칙).
- `play` Edge Function은 등록부를 import하므로 데일리·대회가 없는 이 게임도 번들에 들어간다. 함수 재배포가 필요한지 배포 체크리스트에 적는다(등록부 일치 검사가 있다면 재배포).
- `CLAUDE.md`: 색 예외 한 줄 추가.

## 7. 테스트

- `logic.test.ts`
  - 결정론: 같은 시드·같은 행동 열 → 같은 상태·점수(두 번 실행 비교).
  - 층화: 여러 시드에서 구역별 총량 = `ZONE_TOTAL`, 치아 아닌 칸 = 0, 모든 칸 ≤ `MAX_THICK`.
  - 속도 구간별 감소량, 잇몸 게이지, 0 아래로 안 내려감, 구역 전환 대기, 3600틱에서 종료·초과 샘플 무시, `give_up`.
  - 잘못된 행동: 샘플 0개·31개, 범위 밖·소수 좌표, 같은 구역으로 전환, 홀수 길이 배열 → `{ error }`이고 상태 불변.
  - 점수식·반올림·자르기.
- 밸런스(`balance.test.ts`, 스크립트 봇 3종, 시드 20개 평균)
  - 왕복 봇: 구역마다 10초, 행 단위로 최적 속도(틱당 약 6단위) 지그재그.
  - 낙서 봇: 구역 전환 없이 틱당 20단위 이상으로 무작위 왕복.
  - 가만히 봇: 한 점을 누르고 있음.
  - 조준 봇: 플라그가 보이므로 사람은 남은 플라그를 찾아 닦는다. 최적 속도로 가장 두꺼운 남은 칸 쪽으로 움직이며 그 주변을 짧게 왕복하고, 구역 청결도가 95%를 넘으면 다음 구역으로 간다.
  - 기대: 조준 봇 평균 8.5~9.8이고 20판 중 10.0이 3판 이하(상위권이 만점에 몰리면 최고 점수 정렬이 무의미해진다), 왕복 봇 평균 6.0~9.0이고 조준 봇보다 낮음, 낙서 봇 ≤ 3.0, 가만히 봇 ≤ 1.0. 안 맞으면 §3.7 상수를 조정한다(특히 만점 쏠림이면 `ZONE_TOTAL`을 올리거나 감소량을 낮춘다).
  - 접촉 중이 아니거나 전환 대기 중인 틱은 빠름 구간이어도 잇몸 게이지가 오르지 않는다(§3.5 정의 보충).
- `Game.test.tsx`: 렌더링, 구역 버튼 → `{type:'z'}`, 가짜 타이머로 포인터 누름 뒤 샘플이 50ms 묶음·30개 이하로 나가는지, 누르기 전에는 행동이 없는지.
- 플랫폼: `registry.test.ts`(등록부·시드 일치), `LeaderboardPage.test.tsx`(정렬 기본값이 `freeDefaultSort`를 따르고 후알야는 그대로, '최고' 열 표시 조건), `PlayRunner.test.tsx`(시드 사용·로그 제출), `freeLogQueue` 단위 테스트(순서, 용량 실패, 외래 키 실패 시 남김).
- DB(`supabase/tests/`): `free_play_logs` RLS(남의 `client_id` 거부, 미승인 거부, 본인·관리자 조회), 크기 제한, `lb_free`·`_free_stats`의 `best_score`.
- 검증: `npm test && npm run typecheck && npm run build`, `npm run db:test`.

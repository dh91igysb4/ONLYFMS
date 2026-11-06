# 볼 런 (`ball-run`) 설계

작성: 2026-11-07. 플랫폼 설계(`2026-10-31-onlyfms-platform-design.md`)를 따르고, 여기서는 이 게임과 그에 필요한 플랫폼 공통 변경만 다룬다. 1~3장은 사용자와 대화로 확정했고, 4~7장은 사용자가 위임해 이 문서에서 정했다.

## 1. 목표와 범위

- 3D 끝없는 러너. 공이 자동으로 앞으로 굴러가고, 플레이어는 좌우 드래그로 장애물(블록)과 구멍·벽을 피한다. 거리에 따라 속도가 계단식으로 오른다. 참고: 'Offline Games' 앱의 공 굴리기 게임(Slope 계열) 녹화.
- **자유 플레이 전용.** `modes: { daily: false, contest: false, free: true }`, `freeStats: 'score'`. 리더보드는 최고 점수 순.
- **난이도는 하나.** 옵션 없음.
- 점수는 거리 기반 정수, 상한 없는 성격이라 **플랫폼 점수 범위를 게임별로 넓힌다**(§5).
- 신뢰 모델은 양치와 같다: 클라이언트가 점수를 계산해 `free_plays`에 저장, 시드·행동 기록은 `free_play_logs`(재현·분석용, 검증 수단 아님).
- 처음에는 `hidden: true`로 머지하고 관리자 확인 뒤 공개한다.

범위 밖: 데일리·대회·1v1 대전, 서버 재검증, 리플레이 화면, 효과음, 게임 화면 안의 "내 최고 기록", 드래그 외 조작(기울이기 등), 좌우로 꺾이는 트랙.

## 2. 구조와 데이터 흐름

### 2.1 파일

`src/games/ball-run/`

| 파일 | 역할 | 의존 |
|---|---|---|
| `manifest.ts` | 매니페스트(§2.3) | 없음 |
| `constants.ts` | 틱·속도·중력·치수·tier 가중치 등 조정 수치 | 없음 |
| `segments.ts` | 조각 템플릿(문자열 DSL)과 파서 | constants |
| `course.ts` | 시드 → 조각 이어붙이기, 칸 조회 | segments, constants |
| `sim.ts` | 틱 하나 진행 `step(state, input, course)`, `initSim()` | course, constants |
| `input.ts` | 틱 입력 런 길이 부호화·복호화·검증 | constants |
| `logic.ts` | `GameLogic` 래퍼 | sim, course, input |
| `bots.ts` | 앞을 내다보는 테스트용 봇(밸런스 테스트 전용) | sim, course |
| `render/scene.ts` | Three.js 장면·카메라·조각 메시·정리 | three, course, sim(읽기) |
| `render/textures.ts` | 격자 바닥·빌딩 CanvasTexture 생성 | three |
| `Game.tsx` | 캔버스, 드래그 입력, 고정 틱 루프, HUD | sim, course, input, render(동적 import) |
| `ball-run.css` | HUD·오버레이 | 없음 |

`logic.ts`·`sim.ts`·`course.ts`·`segments.ts`·`input.ts`·`constants.ts`는 순수 TS이고 외부 의존이 없다(Deno 호환, 상대 import에 `.ts` 명시). `three`는 `render/`에서만 import한다.

### 2.2 흐름

1. `pickPuzzle(rng)`는 `{ seed: string }`(32자리 16진수, rng로 128비트 생성)만 돌려준다. `puzzleKey`는 그 seed.
2. `publicState`는 `{ seed, sim }`(시뮬 상태 전체, 정수만이라 작다). `Game.tsx`는 마운트 때 그것으로 로컬 시뮬을 시작하고, 매 프레임 같은 `sim.step`으로 화면용 상태를 진행한다. 플랫폼 상태만 보고 그리면 전송 주기만큼 화면이 늦어지기 때문이다.
3. 입력은 0.5초(30틱)마다 묶어 `onAction({ type: 'i', d })`로 보낸다(§3.3). 공이 죽는 틱에는 그 틱까지 즉시 보낸다. 플랫폼(`PlayRunner`)은 같은 `sim`으로 진행하므로 로컬 상태와 같아진다. 개발 모드에서는 플랫폼 `publicState.sim`과 로컬 기록을 비교해 다르면 `console.warn`.
4. 끝나면 기존 경로 그대로 `free_plays`(점수), `free_play_logs`(시드·행동)에 저장된다.

### 2.3 매니페스트

```ts
{
  id: 'ball-run',
  name: '볼 런',
  description: '굴러가는 공을 좌우로 움직여 장애물을 피한다',
  hidden: true,
  modes: { daily: false, contest: false, free: true },
  puzzleSource: 'generate',
  dailyTimeLimitSec: null,
  options: [],
  freeStats: 'score',
  scoreMax: 99999,      // §5 신규 필드
  scoreDecimals: 0,     // §5 신규 필드
}
```

## 3. 물리와 판정 (`sim.ts`)

### 3.1 좌표·단위·결정성

- x 좌우, y 위, z 앞. 트랙은 z축을 따르는 직선이다.
- 타일 1칸 = 1 m = 1000 단위(mm). 틱 = 1/60 s. 속도는 mm/틱, 가속도는 mm/틱²(정수, 필요하면 1/1000 단위 보조 누산기).
- **시뮬 상태는 모두 정수**(`Number.isInteger`)다. 연산은 `+ - *`, `Math.floor(a / b)`, `Math.imul`, 비교만 쓴다. 값 범위는 2^40 미만으로 유지해 floor 나눗셈이 정확하다. 삼각함수·`sqrt`·`pow` 금지. 따라서 어느 JS 엔진에서도 같은 시드와 입력이면 결과가 같다.

### 3.2 트랙 칸

`cell(col, row)` → `{ floor: null | { h0: number; h1: number }; block: boolean }`. `col`은 -3..3, `row`는 z를 1 m로 나눈 정수. `h0`/`h1`은 칸 앞/뒤 끝 바닥 높이(mm), 칸 안에서는 z에 대해 선형 보간(정수 floor). `null`은 구멍. 블록은 바닥 위 높이 1 m의 직육면체로 칸 전체를 차지한다.

### 3.3 입력

- 틱 입력 = 목표 x(mm, 정수, `[-X_LIMIT, X_LIMIT]`, `X_LIMIT = 3500`).
- `Game.tsx`의 매핑: 손가락을 댄 순간의 공 목표 x를 기준으로, 손가락 가로 이동량 ÷ 화면 폭 × `DRAG_SPAN`(초기 6000 mm)을 더한다. 손을 떼면 마지막 목표를 유지한다. PC: 마우스 드래그 동일, ←/→(또는 A/D)는 누르는 동안 틱마다 목표를 `KEY_STEP`씩 옮긴다.
- 행동 `{ type: 'i', d: number[] }`: `d`는 `[값, 반복수, 값, 반복수, …]` 런 길이 부호화. 검증: 길이 짝수·2 이상, 값은 정수·범위 안, 반복수는 정수 ≥ 1, 반복수 합 ≤ 120(2초). 위반이면 `{ error }`.
- 0.5초 묶음 + 런 길이 부호화로 행동 기록은 약 15분 이상이 256KB(`free_play_logs` 상한) 안에 든다(추정). 넘으면 기록 저장만 실패하고 점수는 저장된다.

### 3.4 상태

```ts
type SimState = {
  tick: number
  x: number; y: number; z: number      // 공 중심 (mm)
  vy: number                            // mm/틱
  vz: number                            // mm/틱
  grounded: boolean
  speedLevel: number                    // 계단식 속도 단계
  dead: null | 'hit' | 'fall' | 'give_up'
}
```

### 3.5 한 틱

1. **앞으로**: `z += vz`.
2. **속도 단계**: `z`가 `SPEED_STEP_DIST`(초기 120 m)를 넘을 때마다 `speedLevel += 1`, `vz = min(V_MAX, floor(V0 × (100 + 8)^level / 100^level))`를 정수 표로 미리 계산(`constants.ts`의 `SPEED_TABLE`). 초기값 V0 = 10 m/s, V_MAX = 28 m/s(밸런스 테스트로 조정). 화면은 `speedLevel` 증가 시 '속도 증가'를 띄운다.
3. **옆으로**: `x += clamp(목표 - x, -VX_MAX, VX_MAX)`, VX_MAX 초기 7 m/s. 옮긴 뒤 공 아래 칸(공 중심 col)의 바닥이 공 밑면보다 `STEP_TOL`(초기 50 mm) 넘게 높으면 그 칸으로 들어가지 못하고 직전 x로 되돌린다(옆면 막힘, 사망 아님). 트랙 밖 x는 `±X_LIMIT`으로 자른다(그 너머는 구멍과 같음).
4. **위아래**: 공 중심 아래 바닥 높이 `hf`.
   - `grounded`이고 `hf`가 있고 `hf ≥ y - R - DROP_TOL`이면 `y = hf + R`로 붙고, `vy`는 이번 틱의 바닥 높이 변화량. 경사로 끝에서 바닥이 갑자기 낮아지면 이 조건이 깨져 `grounded = false`가 되고 마지막 `vy`로 날아간다(오르막 끝 점프).
   - 아니면 공중: `vy -= G`(초기 25 m/s² 환산), `y += vy`. 직전 틱에 바닥 위에 있었고 이번에 `y - R ≤ hf`가 되면 착지: `y = hf + R`, `vy = 0`, `grounded = true`.
5. **충돌·사망**
   - `hit`: 진행 방향 앞 칸 바닥이 공 밑면보다 `STEP_TOL` 넘게 높아 정면으로 닿음, 또는 블록과 겹침. 블록 겹침은 xz 평면에서 원(반지름 R = 350 mm)과 칸 사각형의 제곱 거리 비교로, 공 밑면이 블록 꼭대기보다 낮을 때만.
   - `fall`: 공 중심 y가 최근 지나온 바닥 중 가장 낮은 높이보다 `FALL_DEPTH`(3 m) 아래.
   - 죽으면 이후 `step`은 상태를 바꾸지 않는다.

### 3.6 점수

`score = min(scoreMax, floor(z / 10000))`. 즉 10 m마다 1점, 초반 약 초당 1점. `actionCount = tick`(동점 정렬용, 오래 버틴 쪽이 의미 있게 큼 — 플랫폼은 최고 점수 순 고정이라 실제 영향은 작다).

### 3.7 시간·프레임

게임 시간은 틱 수다. 화면은 고정 간격 누산기로 프레임마다 필요한 틱을 돌리되 한 프레임 최대 5틱까지만 따라잡는다(느린 기기에서는 끊김 대신 느려짐). 첫 터치 전, 일시정지, 탭 숨김(`visibilitychange`) 중에는 틱이 멈춘다.

알려진 한계: 클라이언트 점수라 브라우저를 느리게 돌리는 조작은 막지 못한다(양치와 같은 신뢰 모델).

## 4. 코스 생성 (`segments.ts`, `course.ts`)

### 4.1 조각 DSL

조각 하나 = `{ id, tier: 1|2|3|4, decor?: 'tunnel', rows: string[] }`. 행 하나는 7글자(col -3..3), 위에서 아래로 진행 순서.

| 기호 | 의미 |
|---|---|
| `_` | 평평한 바닥(현재 기준 높이) |
| `.` | 구멍 |
| `B` | 바닥 + 블록 |
| `/` | 오르막(이 행에서 +250 mm) |
| `\` | 내리막(이 행에서 -250 mm) |
| `^` | 위층 바닥(기준 + 1000 mm, 평평) |

같은 행에서 `/`·`\`는 그 칸만 높이가 변하고, 열마다 높이를 따로 누적한다. 파서는 열별 높이를 추적해 칸의 `h0`/`h1`을 만든다.

### 4.2 이음 규칙

- 모든 조각은 **가운데 5칸(col -2..2)이 `_`이고 바깥 2칸이 `.`인 이음 행으로 시작하고 끝난다.** 끝 이음 행에서 다섯 칸의 높이는 같아야 한다(파서가 검사). 그래서 어떤 조각 뒤에 어떤 조각이 와도 연결되고, 갈림길은 조각 안에서 다시 합쳐진다.
- 조각의 순높이 변화를 기준 높이에 누적한다.
- 터널(`decor: 'tunnel'`) 조각에는 점프(공중에 뜨는 구간)를 넣지 않는다. 천장 충돌은 시뮬하지 않는다.

### 4.3 고르기

- `course.ts`는 seed에서 sfc32 상태를 만들되 **정수 출력**(`>>> 0`)만 쓴다. 장식(빌딩 배치 등)은 seed에 고정 문자열을 섞어 만든 **별도 난수 흐름**을 쓴다. 장식 변경은 `logic.version`을 올리지 않는다.
- 처음 조각은 고정 시작 직선(약 2초 분량, 블록 없음).
- 거리 구간별 tier 가중치(`constants.ts`의 `TIER_WEIGHTS`, 예: 0~300 m는 tier 1만, 300~800 m tier 1·2, 800~1500 m tier 1~3, 이후 1~4 비중 점증).
- 최근 3개와 같은 템플릿은 다시 뽑지 않는다.
- 조각마다 동전 던지기로 좌우 반전(col → -col). 반전은 대칭이라 통과 가능성이 유지된다. 장애물 위치를 무작위로 바꾸는 변형은 하지 않는다(대안 배치는 별도 템플릿).

### 4.4 인터페이스

```ts
getCourse(seed: string): Course   // seed별 캐시. 결과는 seed만으로 결정
Course.cell(col: number, row: number): Cell
Course.segmentAt(row: number): { id: string; startRow: number; length: number; mirrored: boolean; decor?: 'tunnel' }
Course.ensure(row: number): void   // row까지 생성(cell·segmentAt이 내부에서 호출)
```

캐시는 최근 seed 몇 개만 유지한다(메모리). `State`에는 코스를 담지 않는다.

### 4.5 첫 세트 (20개 내외)

tier 1: 직선, 블록 하나 피하기(좌/중/우), 폭이 3칸으로 줄었다 넓어짐, 완만한 내리막.
tier 2: 블록 지그재그, 좁은 다리 2칸, 오르막-내리막 언덕, 터널 안 블록 두 개.
tier 3: 높이가 다른 두 갈래(한쪽 `^`), 오르막 끝 점프로 구멍 2행 넘기, 1칸 다리, 블록 벽 사이 틈.
tier 4: 1칸 다리 지그재그, 점프 후 바로 블록 피하기, 터널 안 촘촘한 블록, 긴 내리막 끝 구멍.

템플릿·가중치 변경은 `logic.version`을 올린다.

## 5. 플랫폼 공통 변경: 게임별 점수 범위

### 5.1 매니페스트·계약

- `Manifest`에 선택 필드 `scoreMax?: number`(생략 시 10)와 `scoreDecimals?: 0 | 1 | 2`(생략 시 2) 추가. `GameLogic.score` 주석을 "0~scoreMax(기본 10)"로 바꾼다.
- 규칙(등록부 테스트로 고정): `scoreMax`가 10이 아니면 `freeStats === 'score'`이고 `modes.daily === false && modes.contest === false`. 데일리·대회 점수(`attempts.score`, `play` 함수의 `normalizeScore`)는 0~10 그대로다.

### 5.2 DB (새 마이그레이션 하나)

- `game_modes`에 `score_max numeric(9,2) not null default 10` 추가.
- `free_plays.score`를 `numeric(4,2)` → `numeric(9,2)`. `free_plays_score_range`(0~10)를 지우고 `score >= 0` 검사로 바꾼다.
- `before insert or update` 트리거 `free_plays_score_max`: `new.score`가 `coalesce((select score_max from game_modes where game_id = new.game_id), 10)`보다 크면 `errcode = '23514'`로 거부.
- 볼 런 등록: `game_modes`(ball-run, false, false, true, score_max 99999), `hidden_games`('ball-run').
- `_free_stats`·`lb_free`는 반환 형식이 같고 `round(…, 2)`라 그대로 둔다.
- DB 테스트 `supabase/tests/11_free_score_max.test.sql`: ball-run 583 저장 성공, ball-run 100000 거부, toothbrush 10.01 거부, 음수 거부, 기존 toothbrush 9.99 성공.

### 5.3 화면

- 공통 함수 `formatFreeScore(gameId, value)`(`src/platform/games/score.ts`): 매니페스트 `scoreDecimals`로 `toFixed`. 
- `LeaderboardPage`의 점수 게임 평균·최고 열, `StreakBlock`의 "최고 N점"이 이 함수를 쓴다. 볼 런은 "583", 양치는 기존처럼 "7.40".
- `PlayRunner`의 "N점으로 마무리됐어요"와 프로필 최근 기록은 숫자를 그대로 찍으므로 바꾸지 않는다.

### 5.4 문서

`CLAUDE.md` 게임 추가 절차에 "점수 상한이 10이 아닌 자유 플레이 점수 게임은 manifest `scoreMax`·`scoreDecimals`와 마이그레이션의 `game_modes.score_max`를 맞춘다"를 추가하고, 금지 사항의 색 예외에 "볼 런 3D 장면 내부 색"을 더한다.

## 6. 화면 (`Game.tsx`, `render/`)

### 6.1 구성

- `three`를 의존성으로 추가. `Game.tsx`는 `render/scene.ts`를 **동적 import**해 Vite가 별도 청크로 나눈다. 다른 페이지 번들 크기는 그대로.
- 화면: 전체 폭 캔버스(모바일 세로 기준, 넓은 화면에서는 가운데 세로 비율 상자). 위쪽 HUD: 점수(가운데 크게), 일시정지 버튼(오른쪽). 시작 전 "화면을 눌러 시작" 안내, 일시정지 오버레이("계속하려면 누르기"). '속도 증가' 문구는 1.2초간 가운데에 뜬다. 끝난 뒤 결과 표시는 플랫폼(`PlayRunner`)에 맡긴다.
- 포인터 이벤트로 드래그(`setPointerCapture`), `touch-action: none`. 키보드는 window keydown/keyup.

### 6.2 장면

- 분위기: 녹화처럼 어두운 배경의 네온 신스웨이브. 바닥은 격자선 CanvasTexture(남색 바탕 + 하늘색 선), 블록은 발광 마젠타, 구멍 너머는 검정, 양옆에 격자 텍스처 빌딩(`InstancedMesh`, 장식 난수 흐름), 거리 안개로 먼 곳을 가린다.
- 공: 광택 구(`MeshStandardMaterial`), 굴러간 거리만큼 회전. 공 색은 장면 내부 색(예외).
- 카메라: 공 뒤 위쪽에서 따라가며, x·y는 화면 쪽에서만 부드럽게 보간(시뮬에 영향 없음).
- 조각 단위로 메시를 만들고 공 앞 약 80 m까지 유지, 카메라 뒤로 지난 조각은 `dispose`.
- 렌더 보간: 틱 사이 프레임은 직전·현재 시뮬 상태를 선형 보간해 그린다.
- `devicePixelRatio`는 최대 2. 목표: 최근 2~3년 휴대폰에서 60fps.
- 사망 연출: `hit`은 공이 0.4초 멈칫하며 깨지듯 축소, `fall`은 계속 떨어지는 모습. 연출 동안 입력 무시.

### 6.3 예외

- WebGL 생성 실패: "이 기기에서는 3D 화면을 지원하지 않아요" 안내와 포기 버튼만.
- 동적 import 실패(오프라인 등): "게임을 불러오지 못했어요. 새로고침해 주세요."
- 언마운트 시 rAF·리스너 해제, renderer·geometry·material·texture `dispose`.

## 7. 테스트

모두 `npm test`(vitest)에 들어간다.

- `segments.test.ts`: 모든 템플릿이 파싱되고 7글자 행, 시작·끝 이음 행 규칙, 터널 조각에 점프 없음, id 중복 없음.
- `course.test.ts`: 같은 seed는 같은 코스, 다른 seed는 다름; 최근 3개 중복 없음; 거리 구간별 tier 허용 범위 준수; 반전 조각의 칸이 원본의 거울상; 장식 흐름이 코스에 영향 없음.
- `sim.test.ts`: 옆 이동 속도 제한, 옆면 막힘, 정면 벽 `hit`, 블록 `hit`(스치기 직전·직후 경계), 구멍 `fall`, 경사로 따라가기, 오르막 끝 점프와 착지, 속도 단계 증가, 사망 후 불변, 무작위 입력 1만 틱 동안 모든 상태 값 정수.
- `input.test.ts`: 부호화·복호화 왕복, 잘못된 `d` 거부(홀수 길이, 0 반복, 범위 밖, 합 > 120).
- `logic.test.ts`: `pickPuzzle` seed 형식, `apply` 진행·오류·`give_up`, 끝난 뒤 행동 거부, `score` 단조 증가와 `scoreMax` 상한, **결정성**(같은 seed·행동 → 같은 최종 상태; 행동을 다른 크기로 묶어도 같은 결과).
- `balance.test.ts` + `bots.ts`: 앞을 내다보는 탐색 봇(틱마다 목표 x 후보 몇 개를 짧게 시뮬해 살아남는 쪽 선택, 빔 탐색)이 **모든 템플릿을 원본·반전 각각, 시작 속도와 최대 속도에서 통과**해야 한다. 하나라도 실패하면 테스트 실패. 추가로 seed 몇 개로 봇이 1500 m 이상 가는지 확인(난이도가 불가능 수준이 아님).
- `Game.test.tsx`: `render/scene.ts`를 mock. 첫 터치 전 틱 없음, 드래그 → 목표 x 매핑, 0.5초 묶음 전송(가짜 타이머), 사망 즉시 남은 입력 전송, 일시정지 중 전송 없음.
- 플랫폼: `registry.test.ts`에 `scoreMax` 규칙; `score.test.ts`(`formatFreeScore`); `LeaderboardPage`·`StreakBlock` 테스트에 소수 0자리 게임 표시; DB 테스트(§5.2).
- 수동(미리보기): 아이폰 Safari·안드로이드 Chrome·PC에서 한 판씩, 일시정지·탭 전환, 리더보드 표시, 관리자만 보이는지.

## 8. 등록·배포

1. 코드·마이그레이션·문서를 한 PR로. `hidden: true`.
2. 푸시 전 `npm test && npm run typecheck && npm run build`, `npm run db:test`.
3. 머지 후 `docs/deploy-checklist.md` 절차대로 DB push(점수 범위 마이그레이션 포함) → Vercel. 이 게임은 Edge Function을 쓰지 않지만 `src/games/index.ts`가 바뀌므로 `play`·`duel` 함수 재배포는 체크리스트를 따른다.
4. 관리자 확인 후 공개 마이그레이션(`delete from hidden_games where game_id = 'ball-run'`)과 `hidden: false`.

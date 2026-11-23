// neon-rider 조정 수치. 다른 파일에 숫자 상수를 두지 않는다.
// 단위: 길이 1u = 1/16 mm, 시간 1틱 = 1/60 s, 각도 한 바퀴 = TURN(4096, trig.ts). y는 위가 +.
// 근거 표기 [Mn]은 docs/superpowers/specs/2026-11-23-neon-rider-measurements.md의 항목.
// 녹화 환산: 차 전체 길이 89 px = 2000 mm(= WHEELBASE × 10/7) → 1 px ≈ 359.6u, 60 fps = 1프레임 1틱 [M1].

export const TICK_HZ = 60 // 녹화도 60 fps [M1]
export const MM = 16 // 1 mm = 16u
export const WHEELBASE = 1400 * MM // 축간 65±3 px ≈ 1460 mm. 환산 기준이라 1400 유지 [M1][M13]
export const WHEEL_R = 180 * MM // 바퀴 지름 ≈ 16~18 px → 반지름 8±1 px [M13]
export const HEAD_OFFSET = 200 * MM // 두 바퀴 중점에서 차 윗방향. 지붕 꼭대기 ≈ 축 위 17 px(380 mm) = OFFSET + R [M13]
export const HEAD_R = 180 * MM // 지붕 판정원. 축선 위 20~380 mm를 덮는다 [M13]
export const G = 75 // u/틱². 포물선 0.209 px/프레임² (≈ 16.9 m/s²) ±5% [M2]
export const DRIVE_ACC = 135 // u/틱². 녹화 측정값(정지 출발 0.25±0.06 px/프레임² ≈ 90)의 1.5배, 사용자 결정 2026-11-23 [M3]
export const WHEELIE_ACC = 0 // 평지 가속 중 앞 들림이 3° 미만이라 보이지 않음 → 0(코드 경로는 남김) [M11]
export const V_MAX = 2900 // u/틱. 평지 지속 속도 8.1±0.3 px/프레임 (≈ 10.9 m/s) [M4]
export const BOOST_V = 5200 // u/틱. 부스터 직후 14.5±1.5 px/프레임 (≈ 19.5 m/s) [M5]
export const V_TERMINAL = 6400 // u/틱. 종단 속도는 관측 안 됨. 관측 최대 속력(≈15 px/프레임)과 BOOST_V 위의 안전 상한 [M6]
export const SUBSTEPS = 3 // floor(V_TERMINAL / SUBSTEPS) = 2133 < WHEEL_R. 2로는 3200 ≥ 2880이라 3 [M6]
// 공중 회전: 두 바퀴에 ±SPIN_ACC를 주면 각가속도 = 2·SPIN_ACC / WHEELBASE (rad/틱²).
// SPIN_ACC·SPIN_MAX를 같은 비율로 올려 최대 회전까지 걸리는 시간(11~12틱)은 그대로 둔다.
export const SPIN_ACC = 130 // 녹화 측정값(각가속도 0.55±0.2 °/프레임² → 0.0096 rad × WHEELBASE/2 ≈ 108)의 1.2배, 사용자 결정 2026-11-23 [M8]
export const SPIN_MAX = 82 // TURN/틱. 녹화 측정값(누르고 있을 때 5.8~6.2 °/프레임 ≈ 1바퀴/초 → 68)의 1.2배, 사용자 결정 2026-11-23 [M7]
export const AIR_SPIN_DAMP = 3 // 공중에서 뗐을 때 AIR_SPIN_KEEP을 넘는 각속도만 틱마다 1/AIR_SPIN_DAMP씩 줄인다. 빠른 회전이 뗀 뒤 4~6프레임에 1~2 °/프레임로 떨어짐 [M9 ①]
export const AIR_SPIN_KEEP = 8 // TURN/틱. 이 이하의 느린 잔여 회전은 그대로 남는다(녹화: 1초 넘게 줄지 않음) [M9]
export const ROLL_DRAG = 1 // u/틱². 손맛 자리표시: V_MAX에서 120틱에 4.1% 감속(5% 미만). 관성 주행 상한 ≈ 3 [M12]
export const RESTITUTION_PCT = 0 // 착지 8회 모두 다시 뜨지 않음(2~5 px 가라앉았다 복귀) [M10]
export const GROUND_TOL = 16 * MM // 바퀴가 지면에서 이만큼 안에 있으면 접지로 본다(선분화한 곡선에서 생기는 1~2틱 떨어짐을 접지로). 측정 대상 아님 (설계 §5.2)
export const FRICTION_PCT = 2 // 미측정. 바퀴가 공중에서 땅에 닿는 틱에 접선 속도에서 깎는 비율(굴러가는 동안은 0) [M12]
export const CONSTRAINT_ITERS = 4 // 측정 대상 아님
export const COLLIDE_WINDOW = 40 // 선분 수. 측정 대상 아님
export const FALL_DEPTH = 6000 * MM // 측정 대상 아님
export const LAND_GRACE = 12 // 측정 대상 아님
export const PERFECT_TOL = 170 // ≈ 15°. 측정 대상 아님
export const GEM_R = 250 * MM // 보석 줍기 반지름. 바퀴·차체 판정원과 GEM_R + 그 반지름 안이면 줍는다
export const GEM_MEMORY = 64 // 상태에 남기는 주운 보석 id 수 상한(공개 상태 크기). 넘치면 가장 뒤(작은 id)부터 버린다
export const PERFECT_MULT = 2 // 나무위키·녹화 "+2" (설계 §5.6)
export const SCORE_MAX = 9999
export const SEG_LEN = 250 * MM // 호를 선분화하는 목표 길이
// 장애물 사이 평지. 녹화에서는 장애물 사이 평지가 차 0~3대(0~6 m)라(영상 장애물 목록 "순서와 리듬"), 구간 사이 쉼 평지를 1 m로 줄이고
// 템플릿 앞뒤의 맨 평지도 아래 상한으로 잘라 이어 붙인다(buildTemplate). 장애물 사이 평지는 많아야 1 + 2 + 4 = 7 m. 사용자 결정 2026-11-23
export const REST_LEN = 1000 * MM
export const LEAD_FLAT_MAX = 2000 * MM // 템플릿 앞쪽 맨 평지(부스터 제외) 상한
export const TAIL_FLAT_MAX = 4000 * MM // 템플릿 뒤쪽 맨 평지 상한. 낙하·점프 뒤 착지할 자리라 앞쪽보다 길게 둔다
export const START_LEN = 12000 * MM
// 시작 평지가 코스 시작점(x = 0) 뒤로 이어지는 길이. 첫 구간(tier 1)에서 되굴러 나오는 속력은 많아야 약 3500 u/틱이고
// ROLL_DRAG(1 u/틱²)로 멈추기까지 v²/2 ≈ 380 m를 간다(hill 오르막에서 떼면 실측 약 195 m). 그보다 넉넉히 둔다. 측정 대상 아님
export const START_BACK = 500000 * MM
// 구간 번호(from)부터 쓰는 티어 1~4 가중치. 티어 1만으로도 11종이라 첫 구간부터 여러 종류가 나온다.
// 녹화에서는 점수 1~5에서도 컬·구덩이·'9'자 고리가 나와(영상 장애물 목록 "순서와 리듬") 높은 티어를 예전(4·12·30)보다 일찍 섞는다.
export const TIER_WEIGHTS: readonly { from: number; w: readonly [number, number, number, number] }[] =
  [{ from: 0, w: [1, 0, 0, 0] }, { from: 3, w: [3, 2, 0, 0] }, { from: 8, w: [3, 3, 1, 0] }, { from: 16, w: [2, 3, 2, 1] }]
export const SEND_TICKS = 30
export const PASS_AFTER_TICKS = 30 // 통과 게이트(bots.ts): 구간 끝을 넘은 뒤 이만큼 더 살아 있어야 그 구간을 넘은 것으로 본다
export const MAX_ACTION_TICKS = 120
// 120틱이 전부 번갈아 바뀌면 [0, 1×120]으로 121구간이 필요하다 (첫 값 0 포함)
export const MAX_RUNS = 121
export const VIEW_CARS = 9 // 화면 폭 800 px ÷ 차 길이 89 px = 9.0 [M14]
export const CAR_LEN = 2000 * MM // 차 전체 길이(뒤 꼬리~앞바퀴 앞끝) 89 px = 2000 mm. 화면 축척의 단위 [M1]
// 화면 루프(Game.tsx). 시뮬 규칙이 아니다.
export const MAX_CATCHUP = 5 // 한 프레임에 따라잡는 최대 틱 수(설계 §7)
export const DEATH_RENDER_MS = 3000 // 끝난 뒤 사망 입자를 그리는 시간. 지나면 프레임 루프를 멈춘다

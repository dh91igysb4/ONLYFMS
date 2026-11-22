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
export const DRIVE_ACC = 90 // u/틱². 정지 출발 0.25±0.06 px/프레임² [M3]
export const WHEELIE_ACC = 0 // 평지 가속 중 앞 들림이 3° 미만이라 보이지 않음 → 0(코드 경로는 남김) [M11]
export const V_MAX = 2900 // u/틱. 평지 지속 속도 8.1±0.3 px/프레임 (≈ 10.9 m/s) [M4]
export const BOOST_V = 5200 // u/틱. 부스터 직후 14.5±1.5 px/프레임 (≈ 19.5 m/s) [M5]
export const V_TERMINAL = 6400 // u/틱. 종단 속도는 관측 안 됨. 관측 최대 속력(≈15 px/프레임)과 BOOST_V 위의 안전 상한 [M6]
export const SUBSTEPS = 3 // floor(V_TERMINAL / SUBSTEPS) = 2133 < WHEEL_R. 2로는 3200 ≥ 2880이라 3 [M6]
// 공중 회전: 두 바퀴에 ±SPIN_ACC를 주면 각가속도 = 2·SPIN_ACC / WHEELBASE (rad/틱²).
export const SPIN_ACC = 108 // 누르기 시작 후 각가속도 0.55±0.2 °/프레임² → 0.0096 rad × WHEELBASE/2 [M8]
export const SPIN_MAX = 68 // TURN/틱. 누르고 있을 때 5.8~6.2 °/프레임 (≈ 1바퀴/초) [M7]
export const AIR_SPIN_DAMP = 3 // 공중에서 뗐을 때 AIR_SPIN_KEEP을 넘는 각속도만 틱마다 1/AIR_SPIN_DAMP씩 줄인다. 빠른 회전이 뗀 뒤 4~6프레임에 1~2 °/프레임로 떨어짐 [M9 ①]
export const AIR_SPIN_KEEP = 8 // TURN/틱. 이 이하의 느린 잔여 회전은 그대로 남는다(녹화: 1초 넘게 줄지 않음) [M9]
export const ROLL_DRAG = 1 // u/틱². 손맛 자리표시: V_MAX에서 120틱에 4.1% 감속(5% 미만). 관성 주행 상한 ≈ 3 [M12]
export const RESTITUTION_PCT = 0 // 착지 8회 모두 다시 뜨지 않음(2~5 px 가라앉았다 복귀) [M10]
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
export const REST_LEN = 9000 * MM
export const START_LEN = 12000 * MM
export const TIER_WEIGHTS: readonly { from: number; w: readonly [number, number, number, number] }[] =
  [{ from: 0, w: [1, 0, 0, 0] }, { from: 4, w: [3, 2, 0, 0] }, { from: 12, w: [2, 3, 2, 0] }, { from: 30, w: [1, 2, 3, 2] }]
export const SEND_TICKS = 30
export const MAX_ACTION_TICKS = 120
export const MAX_RUNS = 64
export const VIEW_CARS = 9 // 화면 폭 800 px ÷ 차 길이 89 px = 9.0 [M14]

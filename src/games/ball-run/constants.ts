// 볼 런 상수. 길이는 mm, 시간은 틱(60Hz). 시뮬은 모두 정수로 계산한다.
export const TICK_HZ = 60
export const ROW = 1000
export const COL_MIN = -3
export const COL_MAX = 3
export const X_LIMIT = 3500
export const R = 350
export const BLOCK_H = 1000
export const RAMP_STEP = 250
export const STEEP_STEP = 500 // '!' 급경사 한 행의 하강
export const LEDGE = 1000 // 'v' 단차(칸 시작에서 한 번에 내려가는 높이)
export const PILLAR_H = 3000 // 'P' 기둥 높이
export const GATE_H = 2000 // 'G' 문 높이

export const V0 = 200
export const V_MAX = 467
// k번째 = min(V_MAX, floor(V0 * 106^k / 100^k)). 큰 수 곱셈 오차를 피하려고 미리 계산해 둔다.
// V_MAX에 닿은 뒤 1개까지만 둔다.
export const SPEED_TABLE: readonly number[] = [
  200, 212, 224, 238, 252, 267, 283, 300, 318, 337, 358, 379, 402, 426, 452, 467, 467,
]

export const LAT_K = 5
export const LAT_ACC = 25
export const BANK_PUSH = 60

export const VX_MAX = 117
export const G = 7
export const STEP_TOL = 150
export const DROP_TOL = 260
export const FALL_DEPTH = 3000

export const SCORE_TICKS = 30 // 점수 = floor(tick / SCORE_TICKS), 0.5초에 1점
export const OBST_PER_STAGE = 3
export const SCORE_MAX = 99999

export const DRAG_SPAN = 6000
export const KEY_STEP = 117
export const SEND_TICKS = 30
export const MAX_CATCHUP = 5
export const MAX_ACTION_TICKS = 120

// 장애물 tier 가중치는 지나온 터널 수(단계) 기준.
export const TIER_WEIGHTS: readonly { fromStage: number; w: readonly [number, number, number, number] }[] = [
  { fromStage: 0, w: [1, 0, 0, 0] },
  { fromStage: 1, w: [3, 1, 0, 0] },
  { fromStage: 3, w: [2, 2, 1, 0] },
  { fromStage: 5, w: [1, 2, 2, 1] },
  { fromStage: 8, w: [1, 1, 2, 2] },
]

// 볼 런 상수. 길이는 mm, 시간은 틱(60Hz). 시뮬은 모두 정수로 계산한다.
export const TICK_HZ = 60
export const ROW = 1000
export const COL_MIN = -3
export const COL_MAX = 3
export const X_LIMIT = 3500
export const R = 350
export const BLOCK_H = 1000
export const RAMP_STEP = 250

export const V0 = 167
export const V_MAX = 467
export const SPEED_STEP_DIST = 120000
// k번째 = min(V_MAX, floor(V0 * 108^k / 100^k)). 큰 수 곱셈 오차를 피하려고 미리 계산해 둔다.
// V_MAX에 닿은 뒤 1개까지만 둔다.
export const SPEED_TABLE: readonly number[] = [
  167, 180, 194, 210, 227, 245, 265, 286, 309, 333, 360, 389, 420, 454, 467, 467,
]

export const VX_MAX = 117
export const G = 7
export const STEP_TOL = 150
export const DROP_TOL = 150
export const FALL_DEPTH = 3000

export const SCORE_DIV = 10000
export const SCORE_MAX = 99999

export const DRAG_SPAN = 6000
export const KEY_STEP = 117
export const SEND_TICKS = 30
export const MAX_CATCHUP = 5
export const MAX_ACTION_TICKS = 120

export const TIER_WEIGHTS: readonly { fromM: number; w: readonly [number, number, number, number] }[] = [
  { fromM: 0, w: [1, 0, 0, 0] },
  { fromM: 300, w: [3, 1, 0, 0] },
  { fromM: 800, w: [2, 2, 1, 0] },
  { fromM: 1500, w: [1, 2, 2, 1] },
  { fromM: 2500, w: [1, 1, 2, 2] },
]

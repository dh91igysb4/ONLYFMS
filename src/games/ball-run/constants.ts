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
export const GATE_H = 1000 // 'G' 문 기둥 높이(블록과 같은 1 m 큐브, 위 가로대는 화면용)

// v4 기믹. 전진 속도는 입력과 무관하므로 도로 전체를 막는 시간 기믹은 두지 않고, 움직이는 장애물은 늘 지나갈 칸을 남긴다.
// 'J' 점프대: 바닥에 있는 공의 중심이 점프대 칸에 오면 vy = JUMP_VY로 뜬다. 정점 = Σ(JUMP_VY − kG) = 1683 mm(1 m 블록은 넘고
// 3 m 기둥은 못 넘는다), 체공 약 45틱(1단계 360 mm/틱에서 약 16 m, 최고 속도 794에서 약 36 m).
export const JUMP_VY = 157
// 'M' 좌우 왕복 블록: 그 행 바깥 'M' 칸 가운데 사이(2 m)를 오가는 1 m 큐브. 정수 사다리꼴 파형: 한쪽 끝에서 MOVER_DWELL틱 멈췄다가
// MOVER_TRAVEL틱 동안 2 m를 옮겨 가고(약 31 mm/틱, 공 옆 최고 117의 1/3 아래) 반대 끝에서 다시 멈춘다. 끝에서 멈추는 동안 빈 쪽이
// 바뀌지 않아 보고 피할 수 있다(차선 하나 옮기는 데 18~21틱). 위상 = 조각 위상(조각 추첨 셋째 난수의 위 비트) + 조각 안 행 × MOVER_ROW_OFFSET.
export const MOVER_TRAVEL = 64
export const MOVER_DWELL = 16
export const MOVER_PERIOD = 2 * MOVER_TRAVEL + 2 * MOVER_DWELL // 160
export const MOVER_ROW_OFFSET = 53 // 35행 떨어진 두 행이면 95틱(주기의 약 0.6) 어긋난다.

// v3: v2(200 → 467)의 1.7배.
export const V0 = 340
export const V_MAX = 794
// k번째 = min(V_MAX, floor(V0 * 106^k / 100^k)). 큰 수 곱셈 오차를 피하려고 미리 계산해 둔다.
// V_MAX에 닿은 뒤 1개까지만 둔다.
export const SPEED_TABLE: readonly number[] = [
  340, 360, 382, 404, 429, 454, 482, 511, 541, 574, 608, 645, 684, 725, 768, 794, 794,
]

export const LAT_K = 5
export const LAT_ACC = 25
// 기운 판 위 한 틱마다 drift(실효 목표 이동량)에 더하는 값. drift는 줄지 않고 ±BANK_DRIFT_MAX에서 멈춘다.
export const BANK_DRIFT = 80
export const BANK_DRIFT_MAX = 2 * X_LIMIT

export const VX_MAX = 117
export const G = 7
export const STEP_TOL = 150
export const DROP_TOL = 440 // v3: 급경사 최고 속도 한 틱 하강 ≈ 397 mm보다 크게(단차 1000은 여전히 난다)
export const FALL_DEPTH = 3000

export const SCORE_TICKS = 30 // 점수 = floor(tick / SCORE_TICKS), 0.5초에 1점
export const SCORE_MAX = 99999

export const DRAG_SPAN = 6000
export const KEY_STEP = 117
export const SEND_TICKS = 30
export const MAX_CATCHUP = 5
export const MAX_ACTION_TICKS = 120

// 단계 = 지나온 터널 수(시작 터널 포함) = 그 구간의 속도 단계. 시작 터널 뒤가 단계 1이다.
// 터널 사이 장애물 조각 수: 단계 0~2는 1개, 3부터 2개(원작 녹화: '속도 증가'가 5~8초마다).
export const OBSTACLES_BY_STAGE: readonly { fromStage: number; n: number }[] = [
  { fromStage: 0, n: 1 },
  { fromStage: 3, n: 2 },
]
export function obstaclesInStage(stage: number): number {
  let n = OBSTACLES_BY_STAGE[0].n
  for (const b of OBSTACLES_BY_STAGE) if (b.fromStage <= stage) n = b.n
  return n
}

// 장애물 tier 가중치도 단계 기준.
export const TIER_WEIGHTS: readonly { fromStage: number; w: readonly [number, number, number, number] }[] = [
  { fromStage: 0, w: [1, 0, 0, 0] },
  { fromStage: 2, w: [3, 1, 0, 0] },
  { fromStage: 5, w: [2, 2, 1, 0] },
  { fromStage: 8, w: [1, 2, 2, 1] },
  { fromStage: 12, w: [1, 1, 2, 2] },
]

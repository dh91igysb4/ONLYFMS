// 볼 런 시뮬레이션(설계 §3). 판정과 화면이 같은 함수를 쓰는 단일 기준.
// 모든 상태는 정수(mm, mm/틱, 틱). 연산은 + - *, Math.floor(a / b), 비교만 쓴다.
import {
  BANK_DRIFT, BANK_DRIFT_MAX, BLOCK_H, DROP_TOL, FALL_DEPTH, G, LAT_ACC, LAT_K, R, ROW, SPEED_TABLE, STEP_TOL, VX_MAX, X_LIMIT,
} from './constants.ts'
import type { Course } from './course.ts'
import { clampX } from './input.ts'

export type SimState = {
  tick: number
  x: number
  vx: number // 옆 속도(mm/틱). 목표를 향해 틱마다 LAT_ACC까지만 바뀐다.
  drift: number // 기운 판이 밀어 옮긴 실효 목표(mm). 판 위 한 틱마다 bank × BANK_DRIFT, 줄지 않는다.
  y: number
  z: number
  vy: number
  vz: number
  grounded: boolean
  lastFloor: number // 마지막으로 딛은 바닥 높이. 낙하 판정 기준.
  speedLevel: number
  dead: null | 'hit' | 'fall' | 'give_up'
}

const R2 = R * R
const LAST_LEVEL = SPEED_TABLE.length - 1
const speedOf = (level: number): number => SPEED_TABLE[Math.min(level, LAST_LEVEL)]
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export function colOf(x: number): number {
  return Math.floor((x + 500) / 1000)
}

export function rowOf(z: number): number {
  return Math.floor(z / ROW)
}

// 공 중심 (x, z) 아래 바닥 높이. 구멍이면 null. 칸 안에서는 z에 대해 정수 선형 보간.
export function floorAt(course: Course, x: number, z: number): number | null {
  const row = rowOf(z)
  const f = course.cell(colOf(x), row).floor
  if (f === null) return null
  return f.h0 + Math.floor(((f.h1 - f.h0) * (z - row * ROW)) / ROW)
}

export function initSim(opts?: { speedLevel?: number }): SimState {
  const speedLevel = opts?.speedLevel ?? 0
  return {
    tick: 0, x: 0, vx: 0, drift: 0, y: R, z: 0, vy: 0, vz: speedOf(speedLevel),
    grounded: true, lastFloor: 0, speedLevel, dead: null,
  }
}

function hitsBlock(course: Course, x: number, y: number, z: number): boolean {
  const bottom = y - R
  for (let row = rowOf(z - R); row <= rowOf(z + R); row++) {
    for (let col = colOf(x - R); col <= colOf(x + R); col++) {
      const c = course.cell(col, row)
      if (!c.block || c.floor === null) continue
      // 블록 꼭대기는 칸에서 높은 쪽 바닥 + 블록 높이(기둥·문은 blockH, 블록 칸은 평평하다).
      if (bottom >= Math.max(c.floor.h0, c.floor.h1) + (c.blockH ?? BLOCK_H)) continue
      const left = col * 1000 - 500
      const right = left + 1000
      const near = row * ROW
      const far = near + ROW
      const dx = Math.max(left - x, 0, x - right)
      const dz = Math.max(near - z, 0, z - far)
      if (dx * dx + dz * dz < R2) return true
    }
  }
  return false
}

// 한 틱 진행. 새 객체를 돌려준다. 죽은 상태는 그대로 돌려준다.
// 순서: 앞으로 -> 속도 단계 -> 옆으로(관성·기운 판·옆면 막힘) -> 위아래 -> 충돌(정면·블록, 그다음 낙하).
export function step(s: SimState, targetX: number, course: Course): SimState {
  if (s.dead !== null) return s

  // 1. 앞으로
  const z = s.z + s.vz

  // 2. 속도 단계 = 지나온 터널 수(시작 터널 포함, 첫 틱에 1). 다음 틱부터 적용.
  const speedLevel = Math.max(s.speedLevel, course.boostsBefore(rowOf(z)))
  const vz = speedOf(speedLevel)

  // 3. 옆으로. 기운 판: 직전 틱에 바닥에 있었고 공 중심 칸(이동 전 x, 새 z)이 기울었으면 drift를 낮은 쪽으로 BANK_DRIFT
  // 쌓는다. drift는 줄지 않는다(판이 공을 옮긴 것이지 되돌아오는 용수철이 아니다). 실효 목표 = clampX(target + drift).
  const bank = s.grounded ? course.cell(colOf(s.x), rowOf(z)).bank : undefined
  const drift = bank !== undefined ? clamp(s.drift + bank * BANK_DRIFT, -BANK_DRIFT_MAX, BANK_DRIFT_MAX) : s.drift
  // 실효 목표까지 거리의 1/LAT_K를 원하는 속도로 삼고, vx는 틱마다 LAT_ACC까지만 따라간다.
  // 0 쪽으로 버림(음수는 -floor(-d / LAT_K))이라 좌우가 정확히 대칭이다(반전 조각도 같은 결과). 목표에는 넘어가거나
  // 흔들리지 않고 최대 LAT_K - 1 mm 모자라게 멈춘다. (그냥 floor면 왼쪽만 정확히 닿아 반전 코스가 어긋난다.)
  const d = clampX(targetX + drift) - s.x
  const want = clamp(d < 0 ? 0 - Math.floor(-d / LAT_K) : Math.floor(d / LAT_K), -VX_MAX, VX_MAX) // 0 - : -0 방지
  let vx = s.vx + clamp(want - s.vx, -LAT_ACC, LAT_ACC)
  // colOf(X_LIMIT) = 4(트랙 밖)라서 오른쪽 끝은 X_LIMIT - 1. 좌우 끝이 모두 바깥 열(±3) 안에 머문다.
  let x = Math.min(X_LIMIT - 1, clampX(s.x + vx))
  // 다른 열로 넘어가는데 그 열 바닥이 공 밑면보다 STEP_TOL 넘게 높으면 막힌다.
  if (colOf(x) !== colOf(s.x)) {
    const side = floorAt(course, x, z)
    if (side !== null && side > s.y - R + STEP_TOL) {
      x = s.x
      vx = 0
    }
  }

  // 4. 위아래
  const hf = floorAt(course, x, z)
  let y = s.y
  let vy = s.vy
  let grounded = s.grounded
  let lastFloor = s.lastFloor
  if (grounded && hf !== null && hf >= y - R - DROP_TOL) {
    const ny = hf + R
    vy = ny - y
    y = ny
    lastFloor = hf
  } else {
    // 공중(이번 틱에 떨어진 경우 직전 vy를 이어받는다).
    grounded = false
    const prevBottom = y - R
    vy -= G
    y += vy
    if (hf !== null && prevBottom >= hf - STEP_TOL && y - R <= hf) {
      y = hf + R
      vy = 0
      grounded = true
      lastFloor = hf
    }
  }

  // 5. 충돌·사망 (이번 틱 최종 위치 기준)
  let dead: SimState['dead'] = null
  const front = floorAt(course, x, z + R)
  if ((front !== null && front > y - R + STEP_TOL) || hitsBlock(course, x, y, z)) dead = 'hit'
  else if (y - R < lastFloor - FALL_DEPTH) dead = 'fall'

  return { tick: s.tick + 1, x, vx, drift, y, z, vy, vz, grounded, lastFloor, speedLevel, dead }
}

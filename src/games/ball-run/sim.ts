// 볼 런 시뮬레이션(설계 §3). 판정과 화면이 같은 함수를 쓰는 단일 기준.
// 모든 상태는 정수(mm, mm/틱, 틱). 연산은 + - *, Math.floor(a / b), 비교만 쓴다.
import {
  BLOCK_H, DROP_TOL, FALL_DEPTH, G, R, ROW, SPEED_STEP_DIST, SPEED_TABLE, STEP_TOL, VX_MAX,
} from './constants.ts'
import type { Course } from './course.ts'
import { clampX } from './input.ts'

export type SimState = {
  tick: number
  x: number
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
    tick: 0, x: 0, y: R, z: 0, vy: 0, vz: speedOf(speedLevel),
    grounded: true, lastFloor: 0, speedLevel, dead: null,
  }
}

function hitsBlock(course: Course, x: number, y: number, z: number): boolean {
  const bottom = y - R
  for (let row = rowOf(z - R); row <= rowOf(z + R); row++) {
    for (let col = colOf(x - R); col <= colOf(x + R); col++) {
      const c = course.cell(col, row)
      if (!c.block || c.floor === null) continue
      // 블록 꼭대기는 칸에서 높은 쪽 바닥 + BLOCK_H (블록 칸은 평평하다).
      if (bottom >= Math.max(c.floor.h0, c.floor.h1) + BLOCK_H) continue
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
// 순서: 앞으로 -> 속도 단계 -> 옆으로(옆면 막힘) -> 위아래 -> 충돌(정면·블록, 그다음 낙하).
export function step(s: SimState, targetX: number, course: Course): SimState {
  if (s.dead !== null) return s

  // 1. 앞으로
  const z = s.z + s.vz

  // 2. 속도 단계 (다음 틱부터 적용)
  const speedLevel = Math.max(s.speedLevel, Math.floor(z / SPEED_STEP_DIST))
  const vz = speedOf(speedLevel)

  // 3. 옆으로. 다른 열로 넘어가는데 그 열 바닥이 공 밑면보다 STEP_TOL 넘게 높으면 막힌다.
  let x = clampX(s.x + Math.max(-VX_MAX, Math.min(VX_MAX, targetX - s.x)))
  if (colOf(x) !== colOf(s.x)) {
    const side = floorAt(course, x, z)
    if (side !== null && side > s.y - R + STEP_TOL) x = s.x
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

  return { tick: s.tick + 1, x, y, z, vy, vz, grounded, lastFloor, speedLevel, dead }
}

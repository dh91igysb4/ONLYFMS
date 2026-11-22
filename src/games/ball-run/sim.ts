// 볼 런 시뮬레이션(설계 §3). 판정과 화면이 같은 함수를 쓰는 단일 기준.
// 모든 상태는 정수(mm, mm/틱, 틱). 연산은 + - *, Math.floor(a / b), 비교만 쓴다.
import {
  BANK_ACC, BANK_DRIFT_MAX, BLOCK_H, DROP_TOL, FALL_DEPTH, G, JUMP_VY, LAT_ACC, LAT_K, R, ROW, SPEED_TABLE, STEP_TOL, VX_MAX, X_LIMIT,
} from './constants.ts'
import type { Course } from './course.ts'
import { clampX } from './input.ts'
import { moverX } from './mover.ts'

export type SimState = {
  tick: number
  x: number
  vx: number // 옆 속도(mm/틱). 목표를 향해 틱마다 LAT_ACC까지만 바뀐다.
  drift: number // 기운 판이 밀어 옮긴 실효 목표(mm). 판 위 한 틱마다 driftV / 100(0 쪽 버림)씩, 줄지 않는다.
  driftV: number // v8: drift의 속도(1/100 mm/틱). 판 위 한 틱마다 bank × BANK_ACC, 판을 벗어나거나 뜨면 0.
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
    tick: 0, x: 0, vx: 0, drift: 0, driftV: 0, y: R, z: 0, vy: 0, vz: speedOf(speedLevel),
    grounded: true, lastFloor: 0, speedLevel, dead: null,
  }
}

// 원(공 중심, 반지름 R)과 x·z 직사각형 [left, right] × [near, far]가 겹치는지(경계에 딱 닿으면 겹치지 않음).
function overlaps(x: number, z: number, left: number, right: number, near: number, far: number): boolean {
  const dx = Math.max(left - x, 0, x - right)
  const dz = Math.max(near - z, 0, z - far)
  return dx * dx + dz * dz < R2
}

// tick: 이번 틱(새 상태)의 틱. 왕복 블록은 그 틱 위치(moverX)로 본다 — 화면도 같은 함수로 그린다.
function hitsBlock(course: Course, x: number, y: number, z: number, tick: number): boolean {
  const bottom = y - R
  for (let row = rowOf(z - R); row <= rowOf(z + R); row++) {
    const m = course.moverAt(row)
    if (m !== null && bottom < m.h + BLOCK_H) {
      const mx = moverX(m, tick)
      if (overlaps(x, z, mx - 500, mx + 500, row * ROW, row * ROW + ROW)) return true
    }
    for (let col = colOf(x - R); col <= colOf(x + R); col++) {
      const c = course.cell(col, row)
      if (!c.block || c.floor === null) continue
      // 블록 꼭대기는 칸에서 높은 쪽 바닥 + 블록 높이(기둥·문은 blockH, 블록 칸은 평평하다).
      if (bottom >= Math.max(c.floor.h0, c.floor.h1) + (c.blockH ?? BLOCK_H)) continue
      if (overlaps(x, z, col * 1000 - 500, col * 1000 + 500, row * ROW, row * ROW + ROW)) return true
    }
  }
  return false
}

// 한 틱 진행. 새 객체를 돌려준다. 죽은 상태는 그대로 돌려준다.
// 순서: 앞으로 -> 속도 단계 -> 옆으로(관성·기운 판·옆면 막힘) -> 위아래(점프대) -> 충돌(정면·블록·왕복 블록, 그다음 낙하).
export function step(s: SimState, targetX: number, course: Course): SimState {
  if (s.dead !== null) return s

  // 1. 앞으로
  const z = s.z + s.vz

  // 2. 속도 단계 = 지나온 터널 수(시작 터널 포함, 첫 틱에 1). 다음 틱부터 적용.
  const speedLevel = Math.max(s.speedLevel, course.boostsBefore(rowOf(z)))
  const vz = speedOf(speedLevel)

  // 3. 옆으로. 기운 판(v8 등가속): 직전 틱에 바닥에 있었고 공 중심 칸(이동 전 x, 새 z)이 기울었으면 driftV를 낮은 쪽으로
  // BANK_ACC 더하고, 아니면 driftV = 0(판을 벗어나면 미끄러지던 속도를 바로 잃는다). 반대로 기운 판이 바로 이어지면 driftV가
  // 그대로 이어져 줄었다가 뒤집힌다. drift += driftV / 100(0 쪽 버림이라 좌우 정확히 대칭). drift는 줄지 않는다(판이 공을
  // 옮긴 것이지 되돌아오는 용수철이 아니다). 실효 목표 = clampX(target + drift).
  // vx에 힘을 직접 주지 않는 까닭: 옆 제어기가 자리를 따라가므로(want = d / LAT_K) vx에 a를 더하면 공이 목표에서 LAT_K·a만큼
  // 비켜 선 채 멈출 뿐 계속 밀리지 않는다. 그래서 미는 힘은 실효 목표(drift)에 준다.
  const bank = s.grounded ? course.cell(colOf(s.x), rowOf(z)).bank : undefined
  const driftV = bank !== undefined ? s.driftV + bank * BANK_ACC : 0
  const driftStep = driftV < 0 ? 0 - Math.floor(-driftV / 100) : Math.floor(driftV / 100) // 0 - : -0 방지
  const drift = clamp(s.drift + driftStep, -BANK_DRIFT_MAX, BANK_DRIFT_MAX)
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
  // 점프대: 이번 틱 끝에 바닥에 있고 공 중심 칸이 점프대면 튀어 오른다(다음 틱부터 기존 중력·착지 규칙). 공중이면 아무 일 없다.
  if (grounded && course.cell(colOf(x), rowOf(z)).pad === true) {
    vy = JUMP_VY
    grounded = false
  }

  // 5. 충돌·사망 (이번 틱 최종 위치 기준)
  let dead: SimState['dead'] = null
  const front = floorAt(course, x, z + R)
  if ((front !== null && front > y - R + STEP_TOL) || hitsBlock(course, x, y, z, s.tick + 1)) dead = 'hit'
  else if (y - R < lastFloor - FALL_DEPTH) dead = 'fall'

  return { tick: s.tick + 1, x, vx, drift, driftV, y, z, vy, vz, grounded, lastFloor, speedLevel, dead }
}

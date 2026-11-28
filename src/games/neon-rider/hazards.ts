// 위험물 도형과 겹침 판정(정수만). 설계 §4.1, §5.
// 위험물은 판의 시각 T(부분 틱)로만 움직인다(밟힌 시각 T0 없음).
// 기준점: disc·blades는 도형 중심, bar는 (x0, y0)(창의 바닥). 이동은 도형 전체를 옮기고,
// 회전은 blades의 조각 시작각(pose.a + i·TURN/n)과 bar의 (x0, y0) 둘레 회전에 쓴다.
// pop은 숨음(extension 0)이면 도형이 없고, bar는 끝점 1만 (0, extension)만큼 올라간다.
import type { Box } from './collide.ts'
import { applyPose, maxReach, poseAt, type Motion } from './motion.ts'
import { TRIG_ONE, TURN, atan2T, cosT, isqrt, sinT } from './trig.ts'

export type HazardShape =
  | { s: 'disc'; x: number; y: number; r: number }
  | { s: 'blades'; x: number; y: number; rIn: number; rOut: number; n: number; w: number } // w: 조각 폭 TURN, 조각 시작각은 pose.a + i·TURN/n
  | { s: 'bar'; x0: number; y0: number; x1: number; y1: number; r: number }
export type HazardLook = 'saw' | 'pacman' | 'blades' | 'ring' | 'spikes' | 'laser' | 'spear' | 'plain'
export type HazardDef = { shape: HazardShape; motion: Motion; look: HazardLook }
export type Hazard = HazardDef & { id: number } // 월드 좌표
export type Probe = {
  circles: readonly { x: number; y: number; r: number }[] // 바퀴 둘 + 차체 판정원
  capsule: { x0: number; y0: number; x1: number; y1: number; r: number } // 차대(두 바퀴 중심 선분을 윗방향으로 차의 bodyDY 올린 선분, 반지름 bodyR. cars.ts)
}
type Blades = Extract<HazardShape, { s: 'blades' }>
type Capsule = Probe['capsule']

// 2^25: 이보다 작은 두 수의 제곱은 2^50 미만(정밀 비교를 해도 되는 범위)
const EXACT_LIMIT = 33554432

function mod(a: number, n: number): number {
  return a - n * Math.floor(a / n)
}

function ceilDiv(a: number, b: number): number {
  return -Math.floor(-a / b)
}

/** 월드 도형. pop 숨음이면 null. blades의 회전은 bladeAngles로 꺼낸다. */
export function shapeAt(h: Hazard, T: number): HazardShape | null {
  const p = poseAt(h.motion, T, null)
  const pop = h.motion.k === 'pop'
  if (pop && p.dy <= 0) return null
  const s = h.shape
  switch (s.s) {
    case 'disc':
      return { s: 'disc', x: s.x + p.dx, y: s.y + p.dy, r: s.r }
    case 'blades':
      return { s: 'blades', x: s.x + p.dx, y: s.y + p.dy, rIn: s.rIn, rOut: s.rOut, n: s.n, w: s.w }
    case 'bar': {
      if (pop) return { s: 'bar', x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 + p.dy, r: s.r }
      const e = applyPose(p, s.x0, s.y0, s.x1, s.y1)
      return { s: 'bar', x0: s.x0 + p.dx, y0: s.y0 + p.dy, x1: e.x, y1: e.y, r: s.r }
    }
  }
}

function anglesOf(a: number, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(mod(a + Math.floor((i * TURN) / n), TURN))
  return out
}

/** blades 조각 시작각들, [0, TURN). blades가 아니면 빈 배열. */
export function bladeAngles(h: Hazard, T: number): number[] {
  if (h.shape.s !== 'blades') return []
  return anglesOf(poseAt(h.motion, T, null).a, h.shape.n)
}

// ── 겹침 (모두 "거리 < R"이면 겹침. 좌표 차는 먼저 상자로 걸러 곱이 2^50을 넘지 않게 한다) ──

/** (dx, dy)의 길이 < R */
function pointNear(dx: number, dy: number, R: number): boolean {
  if (Math.abs(dx) >= R || Math.abs(dy) >= R) return false
  return dx * dx + dy * dy < R * R
}

/** a < R·√l2 (a, R ≥ 0, l2 > 0). 곱이 커서 정밀 비교를 못 하는 좁은 구간만 false(거리 오차 < R/√l2, 이 경우 수 u). */
function ltMulSqrt(a: number, R: number, l2: number): boolean {
  const len = isqrt(l2)
  if (a < R * len) return true
  const hi = R * (len + 1)
  if (a >= hi) return false
  return hi <= EXACT_LIMIT && a * a < R * R * l2
}

/** 점 (px, py)에서 선분까지 거리 < R */
function pointSegNear(px: number, py: number, x0: number, y0: number, x1: number, y1: number, R: number): boolean {
  if (R <= 0) return false
  if (px <= Math.min(x0, x1) - R || px >= Math.max(x0, x1) + R) return false
  if (py <= Math.min(y0, y1) - R || py >= Math.max(y0, y1) + R) return false
  const sx = x1 - x0
  const sy = y1 - y0
  const l2 = sx * sx + sy * sy
  const ex = px - x0
  const ey = py - y0
  const dot = ex * sx + ey * sy
  if (l2 === 0 || dot <= 0) return pointNear(ex, ey, R)
  if (dot >= l2) return pointNear(px - x1, py - y1, R)
  return ltMulSqrt(Math.abs(ex * sy - ey * sx), R, l2)
}

/** (bx, by)가 선분 a 기준 왼쪽 +1, 오른쪽 −1, 위 0 */
function side(ax0: number, ay0: number, ax1: number, ay1: number, bx: number, by: number): number {
  const c = (ax1 - ax0) * (by - ay0) - (ay1 - ay0) * (bx - ax0)
  return c > 0 ? 1 : c < 0 ? -1 : 0
}

/** 두 선분 사이 최단 거리 < R */
function segSegNear(a: Capsule, b: Capsule, R: number): boolean {
  if (R <= 0) return false
  if (Math.max(a.x0, a.x1) + R <= Math.min(b.x0, b.x1) || Math.max(b.x0, b.x1) + R <= Math.min(a.x0, a.x1)) return false
  if (Math.max(a.y0, a.y1) + R <= Math.min(b.y0, b.y1) || Math.max(b.y0, b.y1) + R <= Math.min(a.y0, a.y1)) return false
  // 서로 엄격히 가로지르면 거리 0. 닿기·겹쳐 놓임은 아래 끝점 거리(0)가 잡는다.
  if (
    side(a.x0, a.y0, a.x1, a.y1, b.x0, b.y0) * side(a.x0, a.y0, a.x1, a.y1, b.x1, b.y1) < 0 &&
    side(b.x0, b.y0, b.x1, b.y1, a.x0, a.y0) * side(b.x0, b.y0, b.x1, b.y1, a.x1, a.y1) < 0
  )
    return true
  return (
    pointSegNear(a.x0, a.y0, b.x0, b.y0, b.x1, b.y1, R) ||
    pointSegNear(a.x1, a.y1, b.x0, b.y0, b.x1, b.y1, R) ||
    pointSegNear(b.x0, b.y0, a.x0, a.y0, a.x1, a.y1, R) ||
    pointSegNear(b.x1, b.y1, a.x0, a.y0, a.x1, a.y1, R)
  )
}

/**
 * 반지름 c 원이 부채꼴 고리 조각(시작각 a, 폭 sh.w)과 겹치는지.
 * 중심이 조각 각도 안이면 반지름 방향 거리로, 밖이면 가장 가까운 점이 곧은 변(끝 모서리 포함) 위에 있으므로
 * 두 곧은 변까지 거리로 판정한다. 오차: atan2T 1 TURN 단위(반지름 3 m에서 약 5 mm), 변 끝점 반올림 1 u.
 */
function circleSectorNear(px: number, py: number, c: number, sh: Blades, a: number): boolean {
  const dx = px - sh.x
  const dy = py - sh.y
  const ro = sh.rOut + c
  if (Math.abs(dx) >= ro || Math.abs(dy) >= ro) return false
  const d2 = dx * dx + dy * dy
  if (d2 >= ro * ro) return false
  const ri = sh.rIn - c
  if ((ri <= 0 || d2 > ri * ri) && (sh.w >= TURN || mod(atan2T(dy, dx) - a, TURN) <= sh.w)) return true
  for (const e of [a, a + sh.w]) {
    const ux = cosT(e)
    const uy = sinT(e)
    const x0 = sh.x + Math.floor((ux * sh.rIn) / TRIG_ONE)
    const y0 = sh.y + Math.floor((uy * sh.rIn) / TRIG_ONE)
    const x1 = sh.x + Math.floor((ux * sh.rOut) / TRIG_ONE)
    const y1 = sh.y + Math.floor((uy * sh.rOut) / TRIG_ONE)
    if (pointSegNear(px, py, x0, y0, x1, y1, c)) return true
  }
  return false
}

/**
 * 캡슐–부채꼴 고리: 선분을 간격 r 이하로 나눈 점들의 반지름 r 원으로 근사한다(설계 §5.3).
 * 원 사이 오목한 곳 때문에 판정이 안쪽으로 최대 r·(1 − √3/2) ≈ 0.134·r 줄어든다(쿠페 bodyR 190 mm → 25 mm, 스케이트보드 120 mm → 16 mm).
 */
function capsuleSectorNear(cap: Capsule, sh: Blades, angles: readonly number[]): boolean {
  const r = cap.r
  if (r <= 0) return false
  const reach = sh.rOut + r
  if (Math.max(cap.x0, cap.x1) <= sh.x - reach || Math.min(cap.x0, cap.x1) >= sh.x + reach) return false
  if (Math.max(cap.y0, cap.y1) <= sh.y - reach || Math.min(cap.y0, cap.y1) >= sh.y + reach) return false
  const sx = cap.x1 - cap.x0
  const sy = cap.y1 - cap.y0
  const k = Math.max(1, ceilDiv(isqrt(sx * sx + sy * sy) + 1, r))
  for (let i = 0; i <= k; i++) {
    const x = cap.x0 + Math.floor((sx * i) / k)
    const y = cap.y0 + Math.floor((sy * i) / k)
    for (const a of angles) if (circleSectorNear(x, y, r, sh, a)) return true
  }
  return false
}

/** 시각 T에 위험물이 판정원·차대와 겹치는지. */
export function hazardHit(h: Hazard, T: number, p: Probe): boolean {
  const s = shapeAt(h, T)
  if (s === null) return false
  const cap = p.capsule
  switch (s.s) {
    case 'disc':
      for (const q of p.circles) if (pointNear(q.x - s.x, q.y - s.y, q.r + s.r)) return true
      return pointSegNear(s.x, s.y, cap.x0, cap.y0, cap.x1, cap.y1, s.r + cap.r)
    case 'bar':
      for (const q of p.circles) if (pointSegNear(q.x, q.y, s.x0, s.y0, s.x1, s.y1, q.r + s.r)) return true
      return segSegNear(s, cap, s.r + cap.r)
    case 'blades': {
      const angles = anglesOf(poseAt(h.motion, T, null).a, s.n)
      for (const q of p.circles) for (const a of angles) if (circleSectorNear(q.x, q.y, q.r, s, a)) return true
      return capsuleSectorNear(cap, s, angles)
    }
  }
}

/** 움직임 전체를 덮는 상자 (blades는 중심 ± rOut, 도는 bar는 (x0, y0) ± (길이 + r)). */
export function hazardBox(h: Hazard): Box {
  const s = h.shape
  const m = maxReach(h.motion)
  let b: Box
  switch (s.s) {
    case 'disc':
      b = { x0: s.x - s.r, y0: s.y - s.r, x1: s.x + s.r, y1: s.y + s.r }
      break
    case 'blades':
      b = { x0: s.x - s.rOut, y0: s.y - s.rOut, x1: s.x + s.rOut, y1: s.y + s.rOut }
      break
    case 'bar': {
      if (m.turns) {
        const dx = s.x1 - s.x0
        const dy = s.y1 - s.y0
        const L = isqrt(dx * dx + dy * dy) + 2 + s.r // + 2: applyPose 내림 여유
        b = { x0: s.x0 - L, y0: s.y0 - L, x1: s.x0 + L, y1: s.y0 + L }
      } else {
        b = {
          x0: Math.min(s.x0, s.x1) - s.r,
          y0: Math.min(s.y0, s.y1) - s.r,
          x1: Math.max(s.x0, s.x1) + s.r,
          y1: Math.max(s.y0, s.y1) + s.r,
        }
      }
      break
    }
  }
  return { x0: b.x0 + m.dx0, y0: b.y0 + m.dy0, x1: b.x1 + m.dx1, y1: b.y1 + m.dy1 }
}

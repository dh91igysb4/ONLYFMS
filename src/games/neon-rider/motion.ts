// 움직임 함수(정수만). 위험물·움직이는 길·블록의 자세는 모두 여기서 계산한다. 설계 §4.2.
// 시각 T는 부분 틱: T = tick × SUBSTEPS + k + 1 (이동 단계 k, 0부터).
import { FALL_DEPTH, G, SUBSTEPS } from './constants.ts'
import { TRIG_ONE, cosT, sinT } from './trig.ts'

/** 기준 위치에서 옮긴 양(u)과 기준점 둘레 회전(TURN) */
export type Pose = { dx: number; dy: number; a: number }
/** t: 시작부터 틱, 오름차순, 첫 키 t = 0 */
export type Key = { t: number; dx: number; dy: number; a: number }
export type Motion =
  | { k: 'none' }
  | { k: 'rotate'; a0: number; w: number } // w: TURN/틱, 음수 = 시계 방향
  | { k: 'swing'; ax: number; ay: number; period: number; phase: number } // 틱
  | { k: 'pop'; period: number; phase: number; hide: number; rise: number; up: number; fall: number; height: number } // 틱, height u. hide+rise+up+fall = period
  | { k: 'keys'; keys: readonly Key[] }
  | { k: 'fall'; w: number } // 떨어지며 도는 각속도 TURN/틱

const ZERO: Pose = { dx: 0, dy: 0, a: 0 }

/** 틱 tick의 이동 단계 k(0부터) 끝의 부분 틱 */
export function subtick(tick: number, k: number): number {
  return tick * SUBSTEPS + k + 1
}

function mod(a: number, n: number): number {
  return a - n * Math.floor(a / n)
}

// 0 → 1 → 0 삼각파의 분자(분모 = len). u는 [0, len).
function triNum(u: number, len: number): number {
  return u * 2 <= len ? u * 2 : (len - u) * 2
}

export function poseAt(m: Motion, T: number, T0: number | null): Pose {
  switch (m.k) {
    case 'none':
      return ZERO
    case 'rotate':
      return { dx: 0, dy: 0, a: m.a0 + Math.floor((m.w * T) / SUBSTEPS) }
    case 'swing': {
      const len = m.period * SUBSTEPS
      const num = triNum(mod(T + m.phase * SUBSTEPS, len), len)
      return { dx: 0 + Math.floor((m.ax * num) / len), dy: 0 + Math.floor((m.ay * num) / len), a: 0 } // 0 + : -0 방지
    }
    case 'pop': {
      const S = SUBSTEPS
      const hide = m.hide * S
      const rise = m.rise * S
      const up = m.up * S
      const fall = m.fall * S
      const u = mod(T + m.phase * S, m.period * S)
      let ext = 0
      if (u < hide) ext = 0
      else if (u < hide + rise) ext = Math.floor((m.height * (u - hide)) / rise)
      else if (u < hide + rise + up) ext = m.height
      else ext = m.height - Math.floor((m.height * (u - hide - rise - up)) / fall)
      return { dx: 0, dy: ext, a: 0 }
    }
    case 'keys': {
      const ks = m.keys
      const first = ks[0]
      if (T0 === null) return { dx: first.dx, dy: first.dy, a: first.a }
      const e = T - T0
      if (e <= 0) return { dx: first.dx, dy: first.dy, a: first.a }
      const last = ks[ks.length - 1]
      if (e >= last.t * SUBSTEPS) return { dx: last.dx, dy: last.dy, a: last.a }
      let i = 0
      while (ks[i + 1].t * SUBSTEPS <= e) i++
      const p = ks[i]
      const q = ks[i + 1]
      const span = (q.t - p.t) * SUBSTEPS
      const el = e - p.t * SUBSTEPS
      return {
        dx: p.dx + Math.floor(((q.dx - p.dx) * el) / span),
        dy: p.dy + Math.floor(((q.dy - p.dy) * el) / span),
        a: p.a + Math.floor(((q.a - p.a) * el) / span),
      }
    }
    case 'fall': {
      if (T0 === null) return ZERO
      const s = T - T0
      if (s <= 0) return ZERO
      return { dx: 0, dy: 0 - Math.floor((G * s * s) / (2 * SUBSTEPS * SUBSTEPS)), a: Math.floor((m.w * s) / SUBSTEPS) }
    }
  }
}

/** 기준점 둘레로 p.a 회전한 뒤 (p.dx, p.dy) 이동 */
export function applyPose(p: Pose, pivotX: number, pivotY: number, x: number, y: number): { x: number; y: number } {
  const rx = x - pivotX
  const ry = y - pivotY
  const c = cosT(p.a)
  const s = sinT(p.a)
  return {
    x: pivotX + Math.floor((c * rx - s * ry) / TRIG_ONE) + p.dx,
    y: pivotY + Math.floor((s * rx + c * ry) / TRIG_ONE) + p.dy,
  }
}

/** keys: 마지막 키를 지남. 그 밖: false (fall 끝은 높이로 정한다) */
export function motionDone(m: Motion, T: number, T0: number | null): boolean {
  if (m.k !== 'keys' || T0 === null) return false
  return T - T0 >= m.keys[m.keys.length - 1].t * SUBSTEPS
}

/** 움직임 전체의 이동 범위(기준 위치 기준)와 회전 여부. fall은 아래로 FALL_DEPTH까지로 본다. */
export function maxReach(m: Motion): { dx0: number; dy0: number; dx1: number; dy1: number; turns: boolean } {
  switch (m.k) {
    case 'none':
      return { dx0: 0, dy0: 0, dx1: 0, dy1: 0, turns: false }
    case 'rotate':
      return { dx0: 0, dy0: 0, dx1: 0, dy1: 0, turns: true }
    case 'swing':
      return { dx0: Math.min(0, m.ax), dy0: Math.min(0, m.ay), dx1: Math.max(0, m.ax), dy1: Math.max(0, m.ay), turns: false }
    case 'pop':
      return { dx0: 0, dy0: 0, dx1: 0, dy1: Math.max(0, m.height), turns: false }
    case 'keys': {
      let dx0 = Infinity
      let dy0 = Infinity
      let dx1 = -Infinity
      let dy1 = -Infinity
      let turns = false
      for (const k of m.keys) {
        dx0 = Math.min(dx0, k.dx)
        dy0 = Math.min(dy0, k.dy)
        dx1 = Math.max(dx1, k.dx)
        dy1 = Math.max(dy1, k.dy)
        if (k.a !== 0) turns = true
      }
      return { dx0, dy0, dx1, dy1, turns }
    }
    case 'fall':
      return { dx0: 0, dy0: -FALL_DEPTH, dx1: 0, dy1: 0, turns: m.w !== 0 }
  }
}

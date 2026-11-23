// 움직이는 길(올라타는 길). 설계 §6.1~§6.2. 정수만.
// 선분을 기준점 (pivotX, pivotY) 둘레로 자세 각도만큼 돌리고 (dx, dy)만큼 옮긴다.
// time 길의 시각은 판의 부분 틱 T, touch·pass 길은 T0(밟힌·넘은 시각, 아직이면 null)부터 센다.
import { candOf, divRound, type Body, type Box, type Cand } from './collide.ts'
import { SUBSTEPS } from './constants.ts'
import { maxReach, poseAt, type Motion } from './motion.ts'
import type { Seg } from './pieces.ts'
import { TRIG_ONE, cosT, isqrt, sinT } from './trig.ts'

/** delay: 틱. pass.x는 템플릿 좌표(코스가 월드로 옮긴다). */
export type MoverStart = { k: 'time' } | { k: 'touch'; delay: number } | { k: 'pass'; x: number; delay: number }
export type MoverLook = 'yellow' | 'green'
export type MoverDef = { segs: readonly Seg[]; pivotX: number; pivotY: number; motion: Motion; start: MoverStart; look: MoverLook }
export type Mover = MoverDef & { id: number } // 월드 좌표

/** 시각 T(부분 틱)의 월드 선분. */
export function moverSegsAt(m: Mover, T: number, T0: number | null): Seg[] {
  const p = poseAt(m.motion, T, T0)
  if (p.a === 0) {
    return m.segs.map((s) => ({ x0: s.x0 + p.dx, y0: s.y0 + p.dy, x1: s.x1 + p.dx, y1: s.y1 + p.dy, boost: s.boost }))
  }
  // applyPose와 같은 계산(회전 값은 한 번만 구한다).
  const c = cosT(p.a)
  const sn = sinT(p.a)
  const X = (x: number, y: number): number => m.pivotX + Math.floor((c * (x - m.pivotX) - sn * (y - m.pivotY)) / TRIG_ONE) + p.dx
  const Y = (x: number, y: number): number => m.pivotY + Math.floor((sn * (x - m.pivotX) + c * (y - m.pivotY)) / TRIG_ONE) + p.dy
  return m.segs.map((s) => ({ x0: X(s.x0, s.y0), y0: Y(s.x0, s.y0), x1: X(s.x1, s.y1), y1: Y(s.x1, s.y1), boost: s.boost }))
}

/** 움직임 전체를 덮는 상자. 도는 길은 기준점 ± (가장 먼 끝점 거리 + 2), fall은 아래로 FALL_DEPTH까지. */
export function moverBox(m: Mover): Box {
  const r = maxReach(m.motion)
  let b: Box
  if (r.turns) {
    let d2 = 0
    for (const s of m.segs) {
      for (const [x, y] of [[s.x0, s.y0], [s.x1, s.y1]]) d2 = Math.max(d2, (x - m.pivotX) * (x - m.pivotX) + (y - m.pivotY) * (y - m.pivotY))
    }
    const L = isqrt(d2) + 2 // + 2: isqrt 내림과 applyPose 내림 여유
    b = { x0: m.pivotX - L, y0: m.pivotY - L, x1: m.pivotX + L, y1: m.pivotY + L }
  } else {
    b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
    for (const s of m.segs) {
      b = {
        x0: Math.min(b.x0, s.x0, s.x1),
        y0: Math.min(b.y0, s.y0, s.y1),
        x1: Math.max(b.x1, s.x0, s.x1),
        y1: Math.max(b.y1, s.y0, s.y1),
      }
    }
  }
  return { x0: b.x0 + r.dx0, y0: b.y0 + r.dy0, x1: b.x1 + r.dx1, y1: b.y1 + r.dy1 }
}

// 움직이는 길 선분 후보의 번호: −1 − id × SEG_SLOTS − 선분 번호(음수라 진행 번호를 바꾸지 않는다).
const SEG_SLOTS = 1000
// 끝난 keys 길의 T0: 어느 시각에서도 마지막 키를 지난 것으로 본다.
const LONG_AGO = -(2 ** 40)

/** 이번 틱에 판정에 쓰는 길과 그 시작 부분 틱 T0(null = 아직 시작 안 함). */
export type MoverRun = { m: Mover; T0: number | null }

/** 후보 번호 i(음수)의 길 id. */
export function moverIdOf(i: number): number {
  return Math.floor((-1 - i) / SEG_SLOTS)
}

/** touch·pass가 의미 있는 움직임(시작 시각부터 세는 것). 그 밖의 움직임은 판의 시각만 쓴다. */
export function startsLate(m: Mover): boolean {
  return m.start.k !== 'time' && (m.motion.k === 'keys' || m.motion.k === 'fall')
}

/**
 * 상태(시작 틱 t0, 끝남)로 정하는 T0(부분 틱). time 길은 판 시작(0), touch·pass는 t0 × SUBSTEPS(그 부분 틱 다음부터 움직인다),
 * 끝난 keys 길은 마지막 키 자세로 고정한다. 끝난 fall 길은 판정하지 않으므로 부르지 않는다.
 */
export function moverT0(m: Mover, t0: number | null, done: boolean): number | null {
  if (done) return LONG_AGO
  if (!startsLate(m)) return 0
  return t0 === null ? null : t0 * SUBSTEPS
}

/** 길마다 부분 틱 T의 월드 선분(runs 순서). */
export function moverPoses(runs: readonly MoverRun[], T: number): Seg[][] {
  return runs.map(({ m, T0 }) => moverSegsAt(m, T, T0))
}

/** 선분 후보: cur = 부분 틱 T의 자세, prev = T − 1의 자세(moverPoses, runs 순서). */
export function moverCands(runs: readonly MoverRun[], cur: readonly Seg[][], prev: readonly Seg[][]): Cand[] {
  const out: Cand[] = []
  for (let k = 0; k < runs.length; k++) {
    const m = runs[k].m
    if (m.segs.length > SEG_SLOTS) throw new RangeError(`움직이는 길 선분이 너무 많다: ${m.segs.length}`)
    for (let j = 0; j < cur[k].length; j++) {
      const c = candOf(-1 - m.id * SEG_SLOTS - j, cur[k][j], prev[k][j])
      if (c) out.push(c)
    }
  }
  return out
}

/**
 * 실려 감: 바퀴 (이동 전 위치, p1 = 부분 틱 T − 1 자세 기준)가 길 선분에서 reach 안에 닿아 있으면, 바퀴 밑 길의 같은 점이
 * p2(T − 2) → p1(T − 1) → p0(T) 사이에 바뀐 속도의 접선 성분을 바퀴 속도에 더한다(이동 단계마다 한 번).
 * 그래서 길에 대한 바퀴의 접선 상대 속도는 고정 지형 위와 같이 유지된다(길이 서거나 방향을 바꾸면 차도 함께). 법선 성분은 충돌 응답이 맡는다.
 */
export function carryOn(w: Body, p0: readonly Seg[][], p1: readonly Seg[][], p2: readonly Seg[][], reach: number): void {
  let best: { s0: Seg; s1: Seg; s2: Seg; c: Cand; along: number } | null = null
  let bestD = 0
  for (let k = 0; k < p1.length; k++) {
    for (let j = 0; j < p1[k].length; j++) {
      const g = p1[k][j]
      if (w.x + reach < Math.min(g.x0, g.x1) || w.x - reach > Math.max(g.x0, g.x1)) continue
      if (w.y + reach < Math.min(g.y0, g.y1) || w.y - reach > Math.max(g.y0, g.y1)) continue
      const c = candOf(0, g)
      if (!c) continue
      const rx = w.x - c.seg.x0
      const ry = w.y - c.seg.y0
      const dot = rx * c.sx + ry * c.sy
      if (dot < 0 || dot > c.l2) continue
      const d = Math.floor(Math.abs(c.sx * ry - c.sy * rx) / c.len)
      if (d > reach) continue
      if (best === null || d < bestD) {
        best = { s0: p0[k][j], s1: g, s2: p2[k][j], c, along: divRound(dot, c.len) }
        bestD = d
      }
    }
  }
  if (!best) return
  const { c, along } = best
  const px = (s: Seg): number => s.x0 + divRound((s.x1 - s.x0) * along, c.len)
  const py = (s: Seg): number => s.y0 + divRound((s.y1 - s.y0) * along, c.len)
  const ax = px(best.s0) - 2 * px(best.s1) + px(best.s2)
  const ay = py(best.s0) - 2 * py(best.s1) + py(best.s2)
  const at = divRound((ax * c.sx + ay * c.sy) * SUBSTEPS, c.len) // u/틱
  w.vx += divRound(at * c.sx, c.len)
  w.vy += divRound(at * c.sy, c.len)
}

// 원-선분 충돌. 순수 정수 TS (설계 §5.2, §5.5).
// 선분은 양면의 얇은 장애물로 다룬다: 원 중심이 이동 전에 있던 쪽으로 법선을 따라 밀어낸다.
import type { Course } from './course.ts'
import type { Seg } from './pieces.ts'
import { isqrt } from './trig.ts'

/** 충돌 후보 선분. sx, sy는 방향 벡터, len은 그 길이(정수 제곱근), l2 = sx² + sy². */
export type Cand = { i: number; seg: Seg; sx: number; sy: number; len: number; l2: number }
/** 움직이는 원(바퀴). 속도는 u/틱. */
export type Body = { x: number; y: number; vx: number; vy: number }
export type Box = { x0: number; y0: number; x1: number; y1: number }

/** 0으로 가는 반올림이 아닌 반올림(가장 가까운 정수, 0.5는 올림). b > 0. */
export function divRound(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b))
}

/** 0 쪽으로 자르는 나눗셈. b > 0. */
export function divTrunc(a: number, b: number): number {
  return a < 0 ? -Math.floor(-a / b) : Math.floor(a / b)
}

function ceilDiv(a: number, b: number): number {
  return -Math.floor(-a / b)
}

/**
 * 진행 번호 p 앞뒤 window 안의 선분 중 box와 겹치는 것.
 * extend면(공중) 창 밖으로도 선분이 box의 x 범위에 걸치는 동안 앞뒤로 이어서 넣는다:
 * 진행 번호는 공중에서 그대로라, 짧은 선분이 많은 호를 날아 넘으면 착지점이 창 밖일 수 있다.
 */
export function windowCands(course: Course, p: number, window: number, box: Box, extend: boolean): Cand[] {
  const out: Cand[] = []
  const add = (i: number): void => {
    const seg = course.seg(i)
    if (Math.max(seg.x0, seg.x1) < box.x0 || Math.min(seg.x0, seg.x1) > box.x1) return
    if (Math.max(seg.y0, seg.y1) < box.y0 || Math.min(seg.y0, seg.y1) > box.y1) return
    const sx = seg.x1 - seg.x0
    const sy = seg.y1 - seg.y0
    const l2 = sx * sx + sy * sy
    if (l2 === 0) return
    out.push({ i, seg, sx, sy, len: isqrt(l2), l2 })
  }
  const lo = Math.max(0, p - window)
  const hi = p + window
  if (extend) for (let i = lo - 1; i >= 0 && Math.max(course.seg(i).x0, course.seg(i).x1) >= box.x0; i--) add(i)
  for (let i = lo; i <= hi; i++) add(i)
  if (extend) for (let i = hi + 1; Math.min(course.seg(i).x0, course.seg(i).x1) <= box.x1; i++) add(i)
  return out
}

function far(c: Cand, x: number, y: number, m: number): boolean {
  const g = c.seg
  return x + m < Math.min(g.x0, g.x1) || x - m > Math.max(g.x0, g.x1) || y + m < Math.min(g.y0, g.y1) || y - m > Math.max(g.y0, g.y1)
}

// 선분 방향의 왼쪽(반시계) 법선 기준 부호 있는 거리 × len.
function crossOf(c: Cand, x: number, y: number): number {
  return c.sx * (y - c.seg.y0) - c.sy * (x - c.seg.x0)
}

function dotOf(c: Cand, x: number, y: number): number {
  return c.sx * (x - c.seg.x0) + c.sy * (y - c.seg.y0)
}

// 단위 법선 (nx, ny)/nl 방향으로 push만큼 밀고, 안쪽으로 향하는 법선 속도를 반발 계수 e%로 되돌린다.
function respond(b: Body, nx: number, ny: number, nl: number, push: number, e: number): void {
  if (push > 0) {
    b.x += divRound(push * nx, nl)
    b.y += divRound(push * ny, nl)
  }
  const vn = divRound(b.vx * nx + b.vy * ny, nl)
  if (vn < 0) {
    const dv = Math.floor((-vn * (100 + e)) / 100)
    b.vx += divRound(dv * nx, nl)
    b.vy += divRound(dv * ny, nl)
  }
}

/**
 * 반지름 r 원 b를 후보 선분들과 충돌시킨다. (ox, oy)는 이번 이동 전 중심(밀어낼 쪽을 정한다).
 * 닿은(겹치거나 딱 맞닿은) 선분 목록을 돌려준다. e는 반발 계수(%).
 * 선분 안쪽 접촉을 먼저 모두 풀고 끝점 접촉을 나중에 본다. 거꾸로 하면 이어진 평지의 이음매에서
 * 이동 중 살짝 파고든 원이 다음 선분의 끝점을 모서리로 보고 튀어 오른다.
 */
export function collideWheel(b: Body, ox: number, oy: number, r: number, cands: readonly Cand[], e: number): Cand[] {
  const hits: Cand[] = []
  const hit = (c: Cand): void => {
    if (!hits.includes(c)) hits.push(c)
  }
  for (const c of cands) {
    if (far(c, b.x, b.y, 2 * r)) continue
    const dot = dotOf(c, b.x, b.y)
    if (dot < 0 || dot > c.l2) continue
    const cross = crossOf(c, b.x, b.y)
    const before = crossOf(c, ox, oy)
    const side = before > 0 ? 1 : before < 0 ? -1 : cross < 0 ? -1 : 1
    const rl = r * c.len
    if (side * cross > rl) continue
    hit(c)
    respond(b, -side * c.sy, side * c.sx, c.len, ceilDiv(rl - side * cross, c.len), e)
  }
  for (const c of cands) {
    if (far(c, b.x, b.y, r)) continue
    const dot = dotOf(c, b.x, b.y)
    if (dot >= 0 && dot <= c.l2) continue
    const ex = b.x - (dot < 0 ? c.seg.x0 : c.seg.x1)
    const ey = b.y - (dot < 0 ? c.seg.y0 : c.seg.y1)
    const d2 = ex * ex + ey * ey
    if (d2 > r * r || d2 === 0) continue
    hit(c)
    const d = isqrt(d2)
    respond(b, ex, ey, Math.max(1, d), r - d, e)
  }
  return hits
}

/** 반지름 r 원이 후보 선분 중 하나와 겹치는지. */
export function hitsCircle(x: number, y: number, r: number, cands: readonly Cand[]): boolean {
  for (const c of cands) {
    if (far(c, x, y, r)) continue
    const dot = dotOf(c, x, y)
    if (dot >= 0 && dot <= c.l2) {
      if (Math.abs(crossOf(c, x, y)) < r * c.len) return true
    } else {
      const ex = x - (dot < 0 ? c.seg.x0 : c.seg.x1)
      const ey = y - (dot < 0 ? c.seg.y0 : c.seg.y1)
      if (ex * ex + ey * ey < r * r) return true
    }
  }
  return false
}

/** (x, y)에서 가장 가까운 후보 선분. 접지한 바퀴의 접선 방향을 구할 때 쓴다. */
export function nearestCand(cands: readonly Cand[], x: number, y: number): Cand | null {
  let best: Cand | null = null
  let bestD = 0
  for (const c of cands) {
    const dot = dotOf(c, x, y)
    let d: number
    if (dot >= 0 && dot <= c.l2) d = Math.floor(Math.abs(crossOf(c, x, y)) / c.len)
    else {
      const ex = x - (dot < 0 ? c.seg.x0 : c.seg.x1)
      const ey = y - (dot < 0 ? c.seg.y0 : c.seg.y1)
      d = isqrt(ex * ex + ey * ey)
    }
    if (best === null || d < bestD) {
      best = c
      bestD = d
    }
  }
  return best
}

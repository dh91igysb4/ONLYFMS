// 결정적 정수 물리: 두 바퀴 질점 + 고정 길이 막대(위치 기반 Verlet). 설계 §5.
// 상태의 (px, py)는 Verlet의 "직전 위치"로, 속도 = (x - px, y - py) u/틱. 충돌 보정 뒤에도 px = x - 속도로 다시 쓴다.
import {
  AIR_SPIN_DAMP,
  AIR_SPIN_KEEP,
  BOOST_V,
  COLLIDE_WINDOW,
  CONSTRAINT_ITERS,
  DRIVE_ACC,
  FALL_DEPTH,
  FRICTION_PCT,
  G,
  GEM_MEMORY,
  GROUND_TOL,
  GEM_R,
  HEAD_OFFSET,
  HEAD_R,
  LAND_GRACE,
  PERFECT_MULT,
  PERFECT_TOL,
  RESTITUTION_PCT,
  ROLL_DRAG,
  SCORE_MAX,
  SPIN_ACC,
  SPIN_MAX,
  SUBSTEPS,
  V_MAX,
  V_TERMINAL,
  WHEELBASE,
  WHEELIE_ACC,
  WHEEL_R,
} from './constants.ts'
import { collideWheel, divRound, divTrunc, hitsCircle, nearestCand, windowCands } from './collide.ts'
import type { Body, Cand } from './collide.ts'
import type { Course } from './course.ts'
import { TURN, angDiff, atan2T, cosT, isqrt, sinT } from './trig.ts'

export type Wheel = { x: number; y: number; px: number; py: number; ground: boolean } // px,py는 직전 위치(Verlet)
export type SimState = {
  tick: number
  rear: Wheel
  front: Wheel
  progress: number // 마지막으로 닿은 선분 번호
  nextSection: number // 아직 안 지난 첫 구간 번호
  sectionScore: number
  flipScore: number
  airAngle: number | null // 공중 구간의 부호 있는 누적 회전(TURN 단위). 접지 중이면 null(착지 지급 대기 중에는 계속 쌓으며 유지)
  pending: null | { flips: number; perfect: boolean; grace: number }
  lastAward: null | { tick: number; flips: number; perfect: boolean; points: number }
  gems: number
  takenGems: number[] // 현재 충돌 창 안에서 주운 보석 id만 유지(창을 벗어난 것은 버린다)
  dead: null | 'crash' | 'fall' | 'give_up'
  airBefore: boolean // 이 상태 직전 틱이 끝났을 때 두 바퀴가 모두 공중이었는지. 공중 회전은 두 틱 연속 공중일 때만 건다(설계 §5.3)
}

// 한 틱 동안의 작업용 바퀴: 속도를 따로 들고, 이번 틱에 닿은 선분을 기록한다.
type Work = Body & { was: boolean; hit: Cand | null; top: number; scrubbed: boolean }

// 한 틱에 차와 그 판정원이 닿을 수 있는 범위(후보 선분을 고르는 상자 여백).
const REACH = V_TERMINAL + HEAD_OFFSET + HEAD_R + 2 * WHEEL_R

function toWork(w: Wheel): Work {
  return { x: w.x, y: w.y, vx: w.x - w.px, vy: w.y - w.py, was: w.ground, hit: null, top: -1, scrubbed: false }
}

function toWheel(w: Work): Wheel {
  return { x: w.x, y: w.y, px: w.x - w.vx, py: w.y - w.vy, ground: w.hit !== null }
}

function sign(n: number): number {
  return n > 0 ? 1 : n < 0 ? -1 : 0
}

// 각속도 a(TURN/틱)에 해당하는 두 바퀴의 상대 수직 속도(u/틱): dist·tan(a).
function spinSpeed(a: number, dist: number): number {
  return Math.floor((dist * sinT(a)) / cosT(a))
}

// 두 바퀴 사이 거리(막대 길이).
function rodLen(r: Body, f: Body): number {
  const dx = f.x - r.x
  const dy = f.y - r.y
  return isqrt(dx * dx + dy * dy)
}

// 바퀴 속도를 선분 c의 접선 방향으로 dv만큼 바꾼다.
function pushAlong(w: Body, c: Cand, dv: number): void {
  w.vx += divRound(dv * c.sx, c.len)
  w.vy += divRound(dv * c.sy, c.len)
}

function tangentSpeed(w: Body, c: Cand): number {
  return divRound(w.vx * c.sx + w.vy * c.sy, c.len)
}

// ① 입력 힘 (설계 §5.3).
function applyInput(r: Work, f: Work, hold: boolean, airBefore: boolean, cands: readonly Cand[]): void {
  const dx = f.x - r.x
  const dy = f.y - r.y
  const dist = Math.max(1, rodLen(r, f))
  if (hold && r.was) {
    const c = nearestCand(cands, r.x, r.y)
    if (!c) return
    // 차(두 바퀴 평균)의 접선 속도가 V_MAX가 될 때까지 차 가속도 DRIVE_ACC.
    // 뒷바퀴만 밀고 막대가 반을 앞바퀴에 넘기므로 뒷바퀴에는 2배를 준다.
    const vcar = divRound((r.vx + f.vx) * c.sx + (r.vy + f.vy) * c.sy, 2 * c.len)
    if (vcar < V_MAX) pushAlong(r, c, 2 * Math.min(DRIVE_ACC, V_MAX - vcar))
    if (WHEELIE_ACC > 0) {
      f.vx += divRound(WHEELIE_ACC * -c.sy, c.len)
      f.vy += divRound(WHEELIE_ACC * c.sx, c.len)
    }
  } else if (!r.was && !f.was) {
    // 두 바퀴 모두 공중: 막대에 수직인 상대 속도 rp(반시계 +)로 회전을 다룬다.
    const rp = divRound((f.vx - r.vx) * -dy + (f.vy - r.vy) * dx, dist)
    let half = 0
    if (hold) {
      // 곡선의 꼭대기에서 한 틱만 뜬 바퀴에 회전이 걸리지 않게, 두 틱 연속 공중일 때부터 돈다.
      if (!airBefore) return
      const max = spinSpeed(SPIN_MAX, dist)
      if (rp < max) half = Math.min(SPIN_ACC, Math.floor((max - rp) / 2))
    } else {
      // 뗌: AIR_SPIN_KEEP을 넘는 부분만 틱마다 1/AIR_SPIN_DAMP씩 줄인다. 그 이하의 느린 회전은 남는다.
      const excess = Math.abs(rp) - spinSpeed(AIR_SPIN_KEEP, dist)
      if (excess > 0) half = -sign(rp) * Math.min(Math.floor(excess / 2), Math.floor((excess + 2 * AIR_SPIN_DAMP - 1) / (2 * AIR_SPIN_DAMP)))
    }
    if (half !== 0) {
      const ax = divRound(half * -dy, dist)
      const ay = divRound(half * dx, dist)
      f.vx += ax
      f.vy += ay
      r.vx -= ax
      r.vy -= ay
    }
  } else if (!hold) {
    for (const w of [r, f]) {
      if (!w.was) continue
      const c = nearestCand(cands, w.x, w.y)
      if (!c) continue
      const vt = tangentSpeed(w, c)
      pushAlong(w, c, -sign(vt) * Math.min(Math.abs(vt), ROLL_DRAG))
    }
  }
}

// ② 중력과 속도 상한.
function gravity(w: Work): void {
  w.vy -= G
  const v2 = w.vx * w.vx + w.vy * w.vy
  if (v2 > V_TERMINAL * V_TERMINAL) {
    const v = isqrt(v2)
    w.vx = divTrunc(w.vx * V_TERMINAL, v)
    w.vy = divTrunc(w.vy * V_TERMINAL, v)
  }
}

// ③ 막대 제약: 길이(위치)와 막대 방향 상대 속도(속도)를 맞춘다. 같은 질량이라 반씩 나눈다.
function rod(r: Work, f: Work): void {
  const dx = f.x - r.x
  const dy = f.y - r.y
  const dist = rodLen(r, f)
  if (dist === 0) return
  const err = dist - WHEELBASE
  if (err !== 0) {
    const cx = divTrunc(err * dx, 2 * dist)
    const cy = divTrunc(err * dy, 2 * dist)
    r.x += cx
    r.y += cy
    f.x -= cx
    f.y -= cy
  }
  const rad = divTrunc((f.vx - r.vx) * dx + (f.vy - r.vy) * dy, dist)
  if (rad !== 0) {
    const vx = divTrunc(rad * dx, 2 * dist)
    const vy = divTrunc(rad * dy, 2 * dist)
    r.vx += vx
    r.vy += vy
    f.vx -= vx
    f.vy -= vy
  }
}

// ③ 바퀴-선분 충돌과 접촉 효과(착지 마찰, 부스터).
function contact(w: Work, ox: number, oy: number, cands: readonly Cand[]): void {
  for (const c of collideWheel(w, ox, oy, WHEEL_R, GROUND_TOL, cands, RESTITUTION_PCT)) {
    if (!w.was && !w.scrubbed) {
      w.scrubbed = true
      const vt = tangentSpeed(w, c)
      pushAlong(w, c, -divTrunc(vt * FRICTION_PCT, 100))
    }
    if (c.seg.boost) {
      const vt = tangentSpeed(w, c)
      if (vt < BOOST_V) pushAlong(w, c, BOOST_V - vt)
    }
    w.hit = c
    w.top = Math.max(w.top, c.i)
  }
}

function headOf(r: Body, f: Body): { x: number; y: number } {
  const dx = f.x - r.x
  const dy = f.y - r.y
  const dist = Math.max(1, rodLen(r, f))
  return {
    x: Math.floor((r.x + f.x) / 2) + divRound(-dy * HEAD_OFFSET, dist),
    y: Math.floor((r.y + f.y) / 2) + divRound(dx * HEAD_OFFSET, dist),
  }
}

// 차 중심 x가 든 구간의 최저점(첫 구간 앞의 시작 평지는 y = 0).
function floorY(course: Course, from: number, cx: number): number {
  let k = from
  while (cx >= course.section(k).endX) k++
  while (k > 0 && cx < course.section(k).startX) k--
  const sec = course.section(k)
  return cx < sec.startX ? 0 : sec.minY
}

function near(px: number, py: number, gx: number, gy: number, r: number): boolean {
  const dx = px - gx
  const dy = py - gy
  const m = r + GEM_R
  return Math.abs(dx) < m && Math.abs(dy) < m && dx * dx + dy * dy < m * m
}

export function bodyAngle(s: SimState): number {
  return atan2T(s.front.y - s.rear.y, s.front.x - s.rear.x)
}

export function scoreOf(s: SimState): number {
  return Math.min(SCORE_MAX, s.sectionScore + s.flipScore)
}

/** 테스트·봇 전용: x의 지면 위에 뒷바퀴를 두고 지면 방향으로 앞바퀴를 둔다. 수평 속도 vx. x가 틈 위면 다음 선분 시작 높이에 둔다. */
export function initSimAt(course: Course, x: number, vx: number): SimState {
  let i = 0
  while (Math.max(course.seg(i).x0, course.seg(i).x1) < x || course.seg(i).x0 === course.seg(i).x1) i++
  const g = course.seg(i)
  const sx = g.x1 - g.x0
  const sy = g.y1 - g.y0
  const len = isqrt(sx * sx + sy * sy)
  const gy = x < Math.min(g.x0, g.x1) ? g.y0 : g.y0 + Math.floor(((x - g.x0) * sy) / sx)
  const rx = x + divRound(WHEEL_R * -sy, len)
  const ry = gy + divRound(WHEEL_R * sx, len)
  const fx = rx + divRound(WHEELBASE * sx, len)
  const fy = ry + divRound(WHEELBASE * sy, len)
  const cx = Math.floor((rx + fx) / 2)
  let k = 0
  while (cx > course.section(k).endX) k++
  const wheel = (wx: number, wy: number): Wheel => ({ x: wx, y: wy, px: wx - vx, py: wy, ground: true })
  return {
    tick: 0,
    rear: wheel(rx, ry),
    front: wheel(fx, fy),
    progress: i,
    nextSection: k,
    sectionScore: 0,
    flipScore: 0,
    airAngle: null,
    pending: null,
    lastAward: null,
    gems: 0,
    takenGems: [],
    dead: null,
    airBefore: false,
  }
}

/** 시작 평지 위 정지 상태. */
export function initSim(course: Course): SimState {
  return initSimAt(course, WHEELBASE, 0)
}

/** 한 틱. 순수 함수: 새 객체를 돌려준다. 죽은 상태는 그대로 돌려준다. */
export function step(s: SimState, hold: boolean, course: Course): SimState {
  if (s.dead) return s
  const r = toWork(s.rear)
  const f = toWork(s.front)
  const box = {
    x0: Math.min(r.x, f.x) - REACH,
    y0: Math.min(r.y, f.y) - REACH,
    x1: Math.max(r.x, f.x) + REACH,
    y1: Math.max(r.y, f.y) + REACH,
  }
  const cands = windowCands(course, s.progress, COLLIDE_WINDOW, box, !r.was && !f.was)

  applyInput(r, f, hold, s.airBefore, cands) // ①
  gravity(r) // ②
  gravity(f)

  let crashed = false
  for (let k = 0; k < SUBSTEPS && !crashed; k++) {
    // ② 이동을 SUBSTEPS번으로 나눈다. 속도가 그대로면 나눈 이동의 합이 정확히 속도와 같다.
    const ox = [r.x, f.x]
    const oy = [r.y, f.y]
    for (const w of [r, f]) {
      w.x += Math.floor((w.vx * (k + 1)) / SUBSTEPS) - Math.floor((w.vx * k) / SUBSTEPS)
      w.y += Math.floor((w.vy * (k + 1)) / SUBSTEPS) - Math.floor((w.vy * k) / SUBSTEPS)
    }
    // ③ 막대 제약과 충돌.
    for (let it = 0; it < CONSTRAINT_ITERS; it++) {
      rod(r, f)
      contact(r, ox[0], oy[0], cands)
      contact(f, ox[1], oy[1], cands)
    }
    // ⑤ 차체 판정원(이동 단계마다 확인해 빠른 회전에서도 놓치지 않는다).
    const h = headOf(r, f)
    if (hitsCircle(h.x, h.y, HEAD_R, cands)) crashed = true
  }

  // ④ 진행 번호: 이번 틱에 닿은 선분 중 가장 큰 번호. 공중이면 그대로.
  const touched = Math.max(r.top, f.top)
  const progress = touched >= 0 ? touched : s.progress
  const base = { ...s, tick: s.tick + 1, rear: toWheel(r), front: toWheel(f), progress, airBefore: !s.rear.ground && !s.front.ground }
  if (crashed) return { ...base, dead: 'crash' }
  const cx = Math.floor((r.x + f.x) / 2)
  const cy = Math.floor((r.y + f.y) / 2)
  if (cy < floorY(course, s.nextSection, cx) - FALL_DEPTH) return { ...base, dead: 'fall' }

  // ⑥ 공중 구간·착지·지급 (설계 §5.6).
  const angle = atan2T(f.y - r.y, f.x - r.x)
  const rg = r.hit !== null
  const fg = f.hit !== null
  let { airAngle, pending, flipScore, lastAward } = s
  const turned = angDiff(angle, bodyAngle(s))
  if (!rg && !fg) {
    airAngle = (airAngle ?? 0) + turned
    pending = null // 지급 전에 다시 뜨면 같은 공중 구간으로 이어 센다
  } else if (airAngle !== null) {
    // 처음 닿은 틱과 지급 대기 중(한 바퀴만 닿은 틱)의 회전도 같은 구간에 쌓는다: 다시 뜨면 이어서 세므로 잃지 않는다.
    // 그대로 지급되면 처음 닿은 틱에 정한 pending.flips를 쓴다.
    airAngle += turned
    if (pending === null) {
      const c = (f.hit ?? r.hit) as Cand
      const err = Math.abs(angDiff(angle, atan2T(c.sy, c.sx)))
      pending = { flips: Math.floor(Math.abs(airAngle) / TURN), perfect: err <= PERFECT_TOL, grace: LAND_GRACE }
    } else pending = { ...pending, grace: pending.grace - 1 }
    if ((rg && fg) || pending.grace <= 0) {
      const points = pending.flips * (pending.perfect ? PERFECT_MULT : 1)
      flipScore += points
      if (pending.flips > 0) lastAward = { tick: s.tick + 1, flips: pending.flips, perfect: pending.perfect, points }
      pending = null
      airAngle = null
    }
  }

  // ⑦ 구간 통과와 보석.
  let { nextSection, sectionScore, gems } = s
  while (cx > course.section(nextSection).endX) {
    nextSection++
    sectionScore++
  }
  const list = course.gemsBetween(Math.max(0, progress - COLLIDE_WINDOW), progress + COLLIDE_WINDOW)
  const inWindow = new Set(list.map((g) => g.id))
  const takenGems = s.takenGems.filter((id) => inWindow.has(id))
  const taken = new Set(takenGems)
  const h = headOf(r, f)
  for (const g of list) {
    if (taken.has(g.id)) continue
    if (
      near(r.x, r.y, g.x, g.y, WHEEL_R) ||
      near(f.x, f.y, g.x, g.y, WHEEL_R) ||
      near(cx, cy, g.x, g.y, WHEEL_R) ||
      near(h.x, h.y, g.x, g.y, HEAD_R)
    ) {
      takenGems.push(g.id)
      gems++
    }
  }
  // 창 안의 보석이 아주 많은 지형에서도 상태가 커지지 않게, 가장 뒤의 것부터 버린다(gemsBetween은 id 오름차순).
  // 받아들인 한계: 버린 id의 보석은 차가 그만큼 되굴러가면 다시 주울 수 있다.
  takenGems.sort((a, b) => a - b)
  if (takenGems.length > GEM_MEMORY) takenGems.splice(0, takenGems.length - GEM_MEMORY)

  // ⑧
  return { ...base, nextSection, sectionScore, flipScore, airAngle, pending, lastAward, gems, takenGems }
}

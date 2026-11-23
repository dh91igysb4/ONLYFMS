// 결정적 정수 물리: 두 바퀴 질점 + 고정 길이 막대(위치 기반 Verlet). 설계 §5.
// 상태의 (px, py)는 Verlet의 "직전 위치"로, 속도 = (x - px, y - py) u/틱. 충돌 보정 뒤에도 px = x - 속도로 다시 쓴다.
import {
  AIR_SPIN_DAMP,
  AIR_SPIN_KEEP,
  BOOST_V,
  COLLIDE_WINDOW,
  CONSTRAINT_ITERS,
  CRUSH_DEPTH,
  DRIVE_ACC,
  FALL_DEPTH,
  FRICTION_PCT,
  G,
  GEM_MEMORY,
  GROUND_TOL,
  GEM_R,
  HEAD_OFFSET,
  BODY_R,
  HEAD_R,
  LAND_GRACE,
  MOVER_MEMORY,
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
import { candVel, collideWheel, depthIn, divRound, divTrunc, far, hitsCircle, nearestCand, windowCands } from './collide.ts'
import type { Body, Cand } from './collide.ts'
import type { Course } from './course.ts'
import { hazardHit } from './hazards.ts'
import { motionDone, subtick } from './motion.ts'
import { carryOn, moverCands, moverIdOf, moverPoses, moverSegsAt, moverT0, startsLate } from './movers.ts'
import type { Mover, MoverRun } from './movers.ts'
import type { Seg } from './pieces.ts'
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
  // 공중 구간의 차체 각도를 감지 않고 이어 센 값(TURN 단위, 부호 있음). 뜨는 순간의 기울기(−반 바퀴~+반 바퀴)에서 시작해 틱마다 회전을 더한다.
  // 접지 중이면 null(착지 지급 대기 중에는 계속 쌓으며 유지)
  airAngle: number | null
  pending: null | { flips: number; perfect: boolean; grace: number }
  lastAward: null | { tick: number; flips: number; perfect: boolean; points: number }
  gems: number
  takenGems: number[] // 현재 충돌 창 안에서 주운 보석 id만 유지(창을 벗어난 것은 버린다)
  dead: null | 'crash' | 'fall' | 'give_up'
  airBefore: boolean // 이 상태 직전 틱이 끝났을 때 두 바퀴가 모두 공중이었는지. 공중 회전은 두 틱 연속 공중일 때만 건다(설계 §5.3)
  // touch·pass 길 중 시작 틱 t0이 정해졌고 아직 움직임이 안 끝난 것(id 오름차순). 움직임은 부분 틱 t0 × SUBSTEPS 다음부터 (움직임 설계 §6.2)
  movers: { id: number; t0: number }[]
  // 움직임이 끝난 길 id(오래된 것부터, 최대 MOVER_MEMORY). keys 길은 마지막 키 자세로 고정, fall 길은 더 판정하지 않는다
  moversDone: number[]
}

// 한 틱 동안의 작업용 바퀴: 속도를 따로 들고, 이번 틱에 닿은 선분을 기록한다.
// rode: 이번 틱에 닿은 움직이는 길 id.
type Work = Body & { was: boolean; hit: Cand | null; top: number; scrubbed: boolean; rode: number[] }

// 한 틱에 차와 그 판정원이 닿을 수 있는 범위(후보 선분을 고르는 상자 여백).
const REACH = V_TERMINAL + HEAD_OFFSET + HEAD_R + 2 * WHEEL_R

function toWork(w: Wheel): Work {
  return { x: w.x, y: w.y, vx: w.x - w.px, vy: w.y - w.py, was: w.ground, hit: null, top: -1, scrubbed: false, rode: [] }
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

// 선분 c에 대한 바퀴의 접선 속도. 움직이는 길이면 접점의 길 속도에 대한 상대 속도다.
function tangentSpeed(w: Body, c: Cand): number {
  const g = candVel(c, w.x, w.y)
  return divRound((w.vx - g.vx) * c.sx + (w.vy - g.vy) * c.sy, c.len)
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
    // 뒷바퀴만 밀고 막대가 반을 앞바퀴에 넘기므로 뒷바퀴에는 2배를 준다. 움직이는 길 위에서는 그 길 접점 속도에 대한 상대 속도로 잰다.
    const g = candVel(c, r.x, r.y)
    const vcar = divRound((r.vx + f.vx - 2 * g.vx) * c.sx + (r.vy + f.vy - 2 * g.vy) * c.sy, 2 * c.len)
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
    if (c.prev && !w.rode.includes(moverIdOf(c.i))) w.rode.push(moverIdOf(c.i))
  }
}

// 끼임: 바퀴가 움직이는 길과 고정 지형 사이에 끼었다. 차례로 푸는 충돌이라 마지막에 민 쪽의 깊이는 0이 되므로,
// 한쪽에 CRUSH_DEPTH 넘게 파고든 채 다른 쪽에 닿아 있으면(GROUND_TOL 안) 끼인 것으로 본다(움직임 설계 §6.3).
function crushed(w: Work, ox: number, oy: number, cands: readonly Cand[]): boolean {
  let dm = -Infinity
  let df = -Infinity
  for (const c of cands) {
    if (far(c, w.x, w.y, WHEEL_R + GROUND_TOL)) continue
    const d = depthIn(c, w.x, w.y, ox, oy, WHEEL_R)
    if (c.prev) dm = Math.max(dm, d)
    else df = Math.max(df, d)
  }
  return (dm > CRUSH_DEPTH && df > -GROUND_TOL) || (df > CRUSH_DEPTH && dm > -GROUND_TOL)
}

// 이번 틱에 판정할 길과 그 T0. 끝난 fall 길은 뺀다.
function moverRuns(s: SimState, near: readonly Mover[]): MoverRun[] {
  const out: MoverRun[] = []
  for (const m of near) {
    const done = s.moversDone.includes(m.id)
    if (done && m.motion.k === 'fall') continue
    const e = s.movers.find((x) => x.id === m.id)
    out.push({ m, T0: moverT0(m, e ? e.t0 : null, done) })
  }
  return out
}

// 길의 움직임이 부분 틱 T에 끝났는지: keys는 마지막 키, fall은 가장 높은 점이 그 자리 코스 바닥보다 FALL_DEPTH 넘게 아래.
function moverFinished(course: Course, from: number, m: Mover, t0: number, T: number): boolean {
  if (m.motion.k === 'keys') return motionDone(m.motion, T, t0 * SUBSTEPS)
  let top = -Infinity
  for (const g of moverSegsAt(m, T, t0 * SUBSTEPS)) top = Math.max(top, g.y0, g.y1)
  return top < floorY(course, from, m.pivotX) - FALL_DEPTH
}

// 시작 조건(touch: 닿은 틱, pass: 차 중심 x가 pass.x를 넘은 틱, 둘 다 + delay)과 끝난 길 정리. tick은 이번 step이 끝난 뒤의 틱.
function nextMovers(
  s: SimState,
  course: Course,
  rode: readonly number[],
  passing: readonly Mover[],
  cx: number,
  tick: number,
): Pick<SimState, 'movers' | 'moversDone'> {
  if (rode.length === 0 && passing.length === 0 && s.movers.length === 0) return { movers: s.movers, moversDone: s.moversDone }
  const list = s.movers.slice()
  const known = (id: number): boolean => list.some((e) => e.id === id) || s.moversDone.includes(id)
  const begin = (m: Mover, delay: number): void => {
    if (startsLate(m) && !known(m.id)) list.push({ id: m.id, t0: tick + delay })
  }
  for (const id of rode) {
    const m = course.moverById(id)
    if (m.start.k === 'touch') begin(m, m.start.delay)
  }
  for (const m of passing) if (m.start.k === 'pass' && cx > m.start.x) begin(m, m.start.delay)
  list.sort((a, b) => a.id - b.id)
  const movers: SimState['movers'] = []
  const moversDone = s.moversDone.slice()
  for (const e of list) {
    if (moverFinished(course, s.nextSection, course.moverById(e.id), e.t0, tick * SUBSTEPS)) moversDone.push(e.id)
    else movers.push(e)
  }
  if (moversDone.length > MOVER_MEMORY) moversDone.splice(0, moversDone.length - MOVER_MEMORY)
  return { movers, moversDone }
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

/**
 * 공중제비 수: 차체가 거꾸로 선 자세(각도 ±반 바퀴)를 지난 횟수. 앞으로 돌든 뒤로 돌든 같다(설계 §5.6).
 * 점프대에서 앞이 들린 채 떠서 내리막에 맞춰 내리면 돈 각도는 360°에 못 미치지만(예: 45° 들린 채 떠서 −32° 경사에 착지하면 283°),
 * 거꾸로 선 자세를 한 번 지나 바퀴로 내렸으므로 한 바퀴다.
 */
export function flipsOf(airAngle: number): number {
  return Math.abs(Math.floor((airAngle + TURN / 2) / TURN))
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
    movers: [],
    moversDone: [],
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
  // 움직이는 길: 이동 단계마다 그 시각의 자세로 고정 선분 뒤에 붙인다(움직임 설계 §6.3). 없으면 고정 지형만으로 예전과 똑같이 돈다.
  const runs = moverRuns(s, course.moversNear(box))
  const poses = new Map<number, Seg[][]>() // 부분 틱 → 길마다 선분(이 틱에 T − 2 ~ T를 여러 번 쓴다)
  const posesAt = (T: number): Seg[][] => {
    let p = poses.get(T)
    if (!p) poses.set(T, (p = moverPoses(runs, T)))
    return p
  }
  const withMovers = (T: number): readonly Cand[] => (runs.length > 0 ? cands.concat(moverCands(runs, posesAt(T), posesAt(T - 1))) : cands)

  applyInput(r, f, hold, s.airBefore, withMovers(s.tick * SUBSTEPS)) // ① 틱 시작(직전 이동 단계 끝)의 자세
  gravity(r) // ②
  gravity(f)

  const hazards = course.hazardsNear(box) // 틱마다 한 번만 가져오고, 이동 단계마다 그 시각으로 확인한다
  let crashed = false
  for (let k = 0; k < SUBSTEPS && !crashed; k++) {
    const T = subtick(s.tick, k)
    const sub = withMovers(T)
    if (runs.length > 0) {
      carryOn(r, posesAt(T), posesAt(T - 1), posesAt(T - 2), WHEEL_R + GROUND_TOL)
      carryOn(f, posesAt(T), posesAt(T - 1), posesAt(T - 2), WHEEL_R + GROUND_TOL)
    }
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
      contact(r, ox[0], oy[0], sub)
      contact(f, ox[1], oy[1], sub)
    }
    // ⑤ 차체 판정원(이동 단계마다 확인해 빠른 회전에서도 놓치지 않는다).
    const h = headOf(r, f)
    if (hitsCircle(h.x, h.y, HEAD_R, sub)) crashed = true
    if (!crashed && runs.length > 0 && (crushed(r, ox[0], oy[0], sub) || crushed(f, ox[1], oy[1], sub))) crashed = true
    // ⑤' 위험물: 바퀴 둘·차체 판정원·차대 캡슐을 그 이동 단계의 시각으로 확인한다.
    if (!crashed && hazards.length > 0) {
      const probe = {
        circles: [
          { x: r.x, y: r.y, r: WHEEL_R },
          { x: f.x, y: f.y, r: WHEEL_R },
          { x: h.x, y: h.y, r: HEAD_R },
        ],
        capsule: { x0: r.x, y0: r.y, x1: f.x, y1: f.y, r: BODY_R },
      }
      for (const z of hazards) {
        if (hazardHit(z, T, probe)) {
          crashed = true
          break
        }
      }
    }
  }

  // ④ 진행 번호: 이번 틱에 닿은 선분 중 가장 큰 번호. 공중이면 그대로.
  const touched = Math.max(r.top, f.top)
  const progress = touched >= 0 ? touched : s.progress
  const cx = Math.floor((r.x + f.x) / 2)
  const rode = r.rode.concat(f.rode.filter((id) => !r.rode.includes(id)))
  const passing = course.moversNear({ x0: cx, y0: -Infinity, x1: cx, y1: Infinity }).filter((m) => m.start.k === 'pass')
  const base = {
    ...s,
    tick: s.tick + 1,
    rear: toWheel(r),
    front: toWheel(f),
    progress,
    airBefore: !s.rear.ground && !s.front.ground,
    ...nextMovers(s, course, rode, passing, cx, s.tick + 1),
  }
  if (crashed) return { ...base, dead: 'crash' }
  const cy = Math.floor((r.y + f.y) / 2)
  if (cy < floorY(course, s.nextSection, cx) - FALL_DEPTH) return { ...base, dead: 'fall' }

  // ⑥ 공중 구간·착지·지급 (설계 §5.6).
  const angle = atan2T(f.y - r.y, f.x - r.x)
  const rg = r.hit !== null
  const fg = f.hit !== null
  let { airAngle, pending, flipScore, lastAward } = s
  const turned = angDiff(angle, bodyAngle(s))
  if (!rg && !fg) {
    // 구간 시작값은 뜨기 직전 차체의 기울기다. 그래야 '거꾸로 선 자세를 지난 횟수'를 셀 수 있다(flipsOf).
    airAngle = (airAngle ?? angDiff(bodyAngle(s), 0)) + turned
    pending = null // 지급 전에 다시 뜨면 같은 공중 구간으로 이어 센다
  } else if (airAngle !== null) {
    // 처음 닿은 틱과 지급 대기 중(한 바퀴만 닿은 틱)의 회전도 같은 구간에 쌓는다: 다시 뜨면 이어서 세므로 잃지 않는다.
    // 그대로 지급되면 처음 닿은 틱에 정한 pending.flips를 쓴다.
    airAngle += turned
    if (pending === null) {
      const c = (f.hit ?? r.hit) as Cand
      const err = Math.abs(angDiff(angle, atan2T(c.sy, c.sx)))
      pending = { flips: flipsOf(airAngle), perfect: err <= PERFECT_TOL, grace: LAND_GRACE }
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

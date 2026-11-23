import { describe, expect, it } from 'vitest'
import {
  AIR_SPIN_DAMP,
  AIR_SPIN_KEEP,
  BLOCK_MEMORY,
  BLOCK_WAKE,
  BOOST_V,
  COLLIDE_WINDOW,
  CRUSH_DEPTH,
  DRIVE_ACC,
  FALL_DEPTH,
  G,
  GROUND_TOL,
  HEAD_OFFSET,
  HEAD_R,
  LAND_GRACE,
  MM,
  MOVER_MEMORY,
  PERFECT_MULT,
  PERFECT_TOL,
  REST_LEN,
  SPIN_MAX,
  START_LEN,
  SUBSTEPS,
  V_MAX,
  V_TERMINAL,
  WHEELBASE,
  WHEELIE_ACC,
  WHEEL_R,
} from './constants.ts'
import { collideWheel, toFrame, windowCands } from './collide.ts'
import { courseFromTemplates, courseOf, getCourse } from './course.ts'
import type { Course } from './course.ts'
import { TEMPLATES } from './pieces.ts'
import type { Template } from './pieces.ts'
import type { BlockDef, BlockState } from './blocks.ts'
import type { HazardDef } from './hazards.ts'
import { poseAt, type Motion } from './motion.ts'
import { moverSegsAt, type MoverDef } from './movers.ts'
import { bodyAngle, flipsOf, initSim, initSimAt, moverRuns, scoreOf, step } from './sim.ts'
import type { SimState, Wheel } from './sim.ts'
import { TRIG_ONE, TURN, angDiff, atan2T, cosT, isqrt, sinT } from './trig.ts'

const mm = (n: number): number => n * MM

// ---- 테스트용 지형 ----
const flatT: Template = { id: 'flat', tier: 1, prims: [{ t: 'line', dx: mm(400000), dy: 0 }] }
// 30 m 낭떠러지: 체공 약 110틱이라 한 바퀴(약 66틱)를 돌고 내릴 수 있다.
const cliffT: Template = {
  id: 'cliff',
  tier: 1,
  prims: [
    { t: 'line', dx: mm(10000), dy: 0 },
    { t: 'gap', dx: mm(4000), dy: -mm(30000) },
    { t: 'line', dx: mm(200000), dy: 0 },
  ],
}
// 60° 쿼터파이프(반지름 6 m, 높이 3 m) 뒤에 짧은 경사 직선.
const quarterT: Template = {
  id: 'quarter',
  tier: 1,
  prims: [
    { t: 'line', dx: mm(10000), dy: 0 },
    { t: 'arc', r: mm(6000), a0: (TURN * 3) / 4, a1: (TURN * 3) / 4 + TURN / 6 },
    { t: 'line', dx: mm(1000), dy: mm(1732) },
  ],
}
// 4 m 낙차의 낮은 턱.
const lipT: Template = {
  id: 'lip',
  tier: 1,
  prims: [
    { t: 'line', dx: mm(10000), dy: 0 },
    { t: 'gap', dx: mm(3000), dy: -mm(4000) },
    { t: 'line', dx: mm(100000), dy: 0 },
  ],
}
const boostT: Template = {
  id: 'boost',
  tier: 1,
  prims: [
    { t: 'line', dx: mm(10000), dy: 0 },
    { t: 'boost', len: mm(4000) },
    { t: 'line', dx: mm(200000), dy: 0 },
  ],
}
const TPL_X = START_LEN + REST_LEN // 구간 0 템플릿의 시작 x

// ---- 도우미 ----
function run(s: SimState, n: number, hold: (s: SimState, i: number) => boolean, c: Course): SimState {
  for (let i = 0; i < n && !s.dead; i++) s = step(s, hold(s, i), c)
  return s
}
const vxOf = (w: Wheel): number => w.x - w.px
const speed = (s: SimState): number => Math.floor((vxOf(s.rear) + vxOf(s.front)) / 2)
const rodLen = (s: SimState): number => isqrt((s.front.x - s.rear.x) ** 2 + (s.front.y - s.rear.y) ** 2)
const centreX = (s: SimState): number => Math.floor((s.rear.x + s.front.x) / 2)

function lcg(seed: number): () => number {
  let x = seed >>> 0
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x
  }
}
// 길이가 무작위인 누름/뗌 구간을 번갈아 낸다.
function randomInput(seed: number): (s: SimState, i: number) => boolean {
  const r = lcg(seed)
  let left = 0
  let h = false
  return () => {
    if (left <= 0) {
      h = !h
      left = 1 + (r() % 90)
    }
    left--
    return h
  }
}

function allIntegers(v: unknown, path = 'state'): string | null {
  if (typeof v === 'number') return Number.isInteger(v) ? null : path
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return null
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const bad = allIntegers(v[i], `${path}[${i}]`)
      if (bad) return bad
    }
    return null
  }
  if (typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const bad = allIntegers(x, `${path}.${k}`)
      if (bad) return bad
    }
    return null
  }
  return path
}

/** initSimAt 상태를 높이 h만큼 올리고 중점 기준 angle만큼 돌린 공중 상태. 속도 (vx, vy), airAngle 지정. */
function airborne(c: Course, x: number, h: number, angle: number, airAngle: number, vx = 0, vy = 0): SimState {
  const s = initSimAt(c, x, 0)
  const mx = Math.floor((s.rear.x + s.front.x) / 2)
  const my = Math.floor((s.rear.y + s.front.y) / 2) + h
  const half = Math.floor(WHEELBASE / 2)
  const dx = Math.floor((half * cosT(angle)) / TRIG_ONE)
  const dy = Math.floor((half * sinT(angle)) / TRIG_ONE)
  const wheel = (x0: number, y0: number): Wheel => ({ x: x0, y: y0, px: x0 - vx, py: y0 - vy, ground: false })
  return { ...s, rear: wheel(mx - dx, my - dy), front: wheel(mx + dx, my + dy), airAngle, pending: null }
}

// 바퀴 중심의 한 틱 이동(p → q)이 선분 g를 가로지르는지(끝점에 닿거나 지나는 경우 포함, 정수 방향 판정).
function crosses(p: Wheel, q: Wheel, g: { x0: number; y0: number; x1: number; y1: number }): boolean {
  const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number =>
    Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax))
  const o1 = orient(g.x0, g.y0, g.x1, g.y1, p.x, p.y)
  const o2 = orient(g.x0, g.y0, g.x1, g.y1, q.x, q.y)
  const o3 = orient(p.x, p.y, q.x, q.y, g.x0, g.y0)
  const o4 = orient(p.x, p.y, q.x, q.y, g.x1, g.y1)
  return o1 !== o2 && o1 !== 0 && o3 !== o4
}

const omega = (a: SimState, b: SimState): number => angDiff(bodyAngle(b), bodyAngle(a))

// 선분 i에 대한 바퀴 중심의 부호 있는 거리(왼쪽 = 선분 방향의 반시계 쪽 = 평지에서 위가 +)와 투영이 선분 안인지.
function sideOf(c: Course, i: number, x: number, y: number): { inside: boolean; sd: number } {
  const g = c.seg(i)
  const sx = g.x1 - g.x0
  const sy = g.y1 - g.y0
  const len = isqrt(sx * sx + sy * sy)
  const dot = (x - g.x0) * sx + (y - g.y0) * sy
  return { inside: dot >= 0 && dot <= len * len, sd: Math.floor((sx * (y - g.y0) - sy * (x - g.x0)) / len) }
}

describe('neon-rider 시뮬', () => {
  it('결정성: 같은 입력 600틱 → 같은 상태, 모든 필드 정수', () => {
    const c1 = courseOf(['ramp', 'hill', 'bowl'])
    const c2 = courseOf(['ramp', 'hill', 'bowl'])
    const a = run(initSim(c1), 600, randomInput(7), c1)
    const b = run(initSim(c2), 600, randomInput(7), c2)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    let s = initSim(c1)
    const inp = randomInput(11)
    for (let i = 0; i < 600 && !s.dead; i++) {
      s = step(s, inp(s, i), c1)
      expect(allIntegers(s)).toBeNull()
    }
  })

  it('평지 자유 낙하: 한 틱의 속도 변화가 정확히 G', () => {
    const c = courseFromTemplates([flatT])
    let s = airborne(c, TPL_X, mm(20000), 0, 0)
    const vys: number[] = []
    for (let i = 0; i < 40; i++) {
      s = step(s, false, c)
      vys.push(s.rear.y - s.rear.py)
    }
    for (let i = 1; i < vys.length; i++) expect(vys[i] - vys[i - 1]).toBe(-G)
    expect(s.rear.y).toBe(s.front.y)
  })

  it('평지에서 600틱 누름 → 속도가 단조 증가해 V_MAX±5%로 수렴, 300틱 뗌 → 감속', () => {
    const c = courseFromTemplates([flatT])
    let s = initSim(c)
    let prev = 0
    for (let i = 0; i < 600; i++) {
      s = step(s, true, c)
      expect(s.dead).toBeNull()
      const v = speed(s)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
    expect(Math.abs(speed(s) - V_MAX)).toBeLessThanOrEqual(Math.floor(V_MAX / 20))
    const before = speed(s)
    s = run(s, 300, () => false, c)
    expect(s.dead).toBeNull()
    expect(speed(s)).toBeLessThan(before)
  })

  it('정지에서 계속 누르면 ceil(V_MAX / DRIVE_ACC)틱(가속 1.5배로 22틱) 만에 V_MAX', () => {
    const c = courseFromTemplates([flatT])
    let s = initSim(c)
    let reached = -1
    for (let i = 1; i <= 120 && reached < 0; i++) {
      s = step(s, true, c)
      if (speed(s) >= V_MAX) reached = i
    }
    const want = Math.ceil(V_MAX / DRIVE_ACC)
    expect(reached).toBeGreaterThanOrEqual(want)
    expect(reached).toBeLessThanOrEqual(want + 1)
  })

  it('공중에서 누르면 약 12틱에 최대 회전(SPIN_MAX), 한 바퀴는 약 56틱(회전 1.2배)', () => {
    const cc = courseFromTemplates([cliffT])
    let a = airborne(cc, TPL_X + mm(30000), mm(40000), 0, 0)
    let total = 0
    let full = -1
    let turn = -1
    for (let i = 1; i <= 100; i++) {
      const prev = a
      a = step(a, true, cc)
      const w = omega(prev, a)
      total += w
      if (full < 0 && w >= SPIN_MAX - 2) full = i
      if (turn < 0 && total >= TURN) turn = i
    }
    // 녹화: 정지에서 최대까지 11~12프레임 [M8]. SPIN_ACC·SPIN_MAX를 같은 비율로 올려 그대로다(첫 틱은 airBefore로 회전 없음).
    expect(full).toBeGreaterThanOrEqual(11)
    expect(full).toBeLessThanOrEqual(13)
    // 한 바퀴: 4096 / 82 ≈ 50틱 + 처음 가속 구간. 측정값 기준 1.2배 이전 66틱.
    expect(turn).toBeGreaterThanOrEqual(55)
    expect(turn).toBeLessThanOrEqual(57)
  })

  it.skipIf(WHEELIE_ACC <= 0)('앞 들림: 정지 상태에서 누르면 60틱 안에 앞바퀴가 뒷바퀴보다 높아진다', () => {
    const c = courseFromTemplates([flatT])
    let s = initSim(c)
    let lifted = false
    for (let i = 0; i < 60; i++) {
      s = step(s, true, c)
      if (s.front.y > s.rear.y) lifted = true
    }
    expect(lifted).toBe(true)
  })

  it('막대 길이: 임의 입력 2000틱 동안 |거리 - WHEELBASE| ≤ WHEELBASE/50', () => {
    for (const ids of [['ramp'], ['bowl'], ['hill', 'ramp', 'bowl']]) {
      const c = courseOf(ids)
      let s = initSim(c)
      const inp = randomInput(ids.length * 31)
      for (let i = 0; i < 2000 && !s.dead; i++) {
        s = step(s, inp(s, i), c)
        expect(Math.abs(rodLen(s) - WHEELBASE)).toBeLessThanOrEqual(Math.floor(WHEELBASE / 50))
      }
    }
  })

  it('관통 없음: ramp·bowl·평지에서 임의 입력 2000틱(20개 시드)', () => {
    const courses = [courseOf(['ramp']), courseOf(['bowl']), courseFromTemplates([flatT])]
    for (let seed = 1; seed <= 20; seed++) {
      for (const c of courses) {
        let s = initSim(c)
        const inp = randomInput(seed)
        for (let i = 0; i < 2000; i++) {
          const n = step(s, inp(s, i), c)
          if (n.dead) break
          for (const [a, b] of [
            [s.rear, n.rear],
            [s.front, n.front],
          ]) {
            for (let k = Math.max(0, n.progress - COLLIDE_WINDOW); k <= n.progress + COLLIDE_WINDOW; k++) {
              const before = sideOf(c, k, a.x, a.y)
              const now = sideOf(c, k, b.x, b.y)
              // 직전 틱에 선분 위쪽(또는 겹침 이내)이던 바퀴가 아래쪽으로 WHEEL_R 넘게 들어가면 관통이다.
              if (now.inside && before.inside && before.sd > -WHEEL_R) expect(now.sd).toBeGreaterThan(-WHEEL_R)
            }
          }
          s = n
        }
      }
    }
  })

  it('관통 없음(집중): 돌아간 차를 V_TERMINAL로 ramp 턱(볼록 끝점)에 떨어뜨려도 바퀴 중심이 선분 너머로 가지 않는다', () => {
    const c = courseOf(['ramp'])
    const lipX = TPL_X + mm(19000) // 오르막 끝(높이 3 m), 그 뒤는 틈
    let cases = 0
    for (const off of [-1500, -700, 0, 700, 1500]) {
      for (const angle of [0, 512, 1024, 1536, 2048, 2560, 3072, 3584]) {
        let s = airborne(c, lipX + mm(off), mm(1500), angle, 0, 0, -V_TERMINAL)
        cases++
        for (let t = 0; t < 120; t++) {
          const n = step(s, false, c)
          if (n.dead) break
          for (const [a, b] of [
            [s.rear, n.rear],
            [s.front, n.front],
          ]) {
            for (let k = Math.max(0, n.progress - COLLIDE_WINDOW); k <= n.progress + COLLIDE_WINDOW; k++) {
              const g = c.seg(k)
              if (Math.min(g.x0, g.x1) - WHEELBASE > b.x || Math.max(g.x0, g.x1) + WHEELBASE < b.x) continue
              // 이번 틱의 중심 이동이 선분을 가로지르면(끝점 포함) 관통이다.
              expect(crosses(a, b, g), `off ${off} angle ${angle} tick ${t} seg ${k}`).toBe(false)
              // 끝점(턱 모서리)에 깊이 박히지도 않는다.
              for (const [ex, ey] of [
                [g.x0, g.y0],
                [g.x1, g.y1],
              ]) {
                expect(isqrt((b.x - ex) ** 2 + (b.y - ey) ** 2)).toBeGreaterThan(Math.floor(WHEEL_R / 2))
              }
            }
          }
          s = n
        }
      }
    }
    expect(cases).toBe(40)
  })

  it('ramp에서 계속 누름 → 공중에서 airAngle이 반시계로 증가, 떼면 약 8틱 안에 각속도가 AIR_SPIN_KEEP 근처로 줄어 유지된다', () => {
    const c = courseOf(['ramp'])
    let s = initSimAt(c, TPL_X, V_MAX)
    let maxAir = 0
    for (let i = 0; i < 400 && !s.dead; i++) {
      s = step(s, true, c)
      if (s.airAngle !== null) maxAir = Math.max(maxAir, s.airAngle)
    }
    expect(maxAir).toBeGreaterThan(TURN / 4)

    // 높은 낭떠러지에서 최대 회전까지 누른 뒤 뗀다.
    const cc = courseFromTemplates([cliffT])
    let a = airborne(cc, TPL_X + mm(30000), mm(25000), 0, 0)
    for (let i = 0; i < 20; i++) a = step(a, true, cc)
    let prev = a
    a = step(a, true, cc)
    expect(omega(prev, a)).toBeGreaterThanOrEqual(SPIN_MAX - 2)
    const ws: number[] = []
    for (let i = 0; i < 60; i++) {
      prev = a
      a = step(a, false, cc)
      expect(a.rear.ground || a.front.ground).toBe(false)
      ws.push(omega(prev, a))
    }
    // 녹화: 빠른 회전은 뗀 뒤 4~6프레임에 1~2 °/프레임(11~23 TURN/틱)로 떨어진다 [M9 ①].
    expect(ws[5]).toBeLessThanOrEqual(23)
    for (const w of ws) expect(w).toBeGreaterThanOrEqual(AIR_SPIN_KEEP - 2)
    for (const w of ws.slice(8)) expect(w).toBeLessThanOrEqual(AIR_SPIN_KEEP + 2) // 약 8틱 안에 AIR_SPIN_KEEP 근처
  })

  it('뒤집힌 착지 → crash, 바퀴로 착지 → 생존', () => {
    const c = courseFromTemplates([flatT])
    const flipped = run(airborne(c, TPL_X, mm(2000), TURN / 2, 0), 200, () => false, c)
    expect(flipped.dead).toBe('crash')
    const upright = run(airborne(c, TPL_X, mm(2000), 0, 0), 200, () => false, c)
    expect(upright.dead).toBeNull()
    expect(upright.rear.ground && upright.front.ground).toBe(true)
  })

  it('공중제비: 낭떠러지에서 1바퀴 돌고 착지 → flipScore 1~2, flips 1, LAND_GRACE 안에 지급', () => {
    const c = courseFromTemplates([cliffT])
    let s = initSimAt(c, TPL_X, V_MAX)
    // 뗀 뒤에도 (SPIN_MAX - AIR_SPIN_KEEP) × AIR_SPIN_DAMP(= 74 × 3 = 222)만큼 더 돌고, 그 뒤 AIR_SPIN_KEEP으로 계속 돈다.
    const coast = (SPIN_MAX - AIR_SPIN_KEEP) * AIR_SPIN_DAMP
    let firstTouch = -1
    let releasedAt: number | null = null
    for (let i = 0; i < 600 && !s.dead && !s.lastAward; i++) {
      const hold = s.airAngle !== null && s.pending === null && s.airAngle < TURN - coast
      if (!hold && s.airAngle !== null && releasedAt === null) releasedAt = s.airAngle
      const n = step(s, hold, c)
      if (firstTouch < 0 && s.airAngle !== null && s.airAngle > TURN / 2 && (n.rear.ground || n.front.ground)) firstTouch = n.tick
      s = n
    }
    expect(s.dead).toBeNull()
    expect(s.lastAward?.flips).toBe(1)
    expect([1, 2]).toContain(s.flipScore)
    expect(firstTouch).toBeGreaterThan(0)
    expect(s.lastAward!.tick - firstTouch).toBeLessThanOrEqual(LAND_GRACE)
    expect(scoreOf(s)).toBe(s.flipScore)
  })

  it('공중제비: 착지 직후 죽으면 flipScore 0', () => {
    const c = courseFromTemplates([flatT])
    // 거의 수직으로 선 채(뒷바퀴 아래) 뒤로 넘어가는 회전을 가진 채 떨어진다.
    const tilt = Math.floor(TURN / 3) // 120°: 뒷바퀴가 먼저 닿고 LAND_GRACE 안에 지붕으로 넘어간다
    let s = airborne(c, TPL_X, mm(1200), tilt, TURN + tilt)
    const sp = Math.floor((AIR_SPIN_KEEP * WHEELBASE * 6) / 4096) // 대략 AIR_SPIN_KEEP 각속도의 접선 속도
    s = { ...s, front: { ...s.front, px: s.front.px + sp }, rear: { ...s.rear, px: s.rear.px - sp } }
    let touched = false
    for (let i = 0; i < 300 && !s.dead; i++) {
      s = step(s, false, c)
      if (s.pending) touched = true
    }
    expect(touched).toBe(true)
    expect(s.dead).toBe('crash')
    expect(s.flipScore).toBe(0)
    expect(s.lastAward).toBeNull()
  })

  it('튕겨 이어진 공중 구간: 첫 접촉 → 지급 전에 다시 뜸 → 최종 착지에 한 번만 지급, 닿아 있던 틱의 회전도 센다', () => {
    // 낮은 턱(4 m 낙차) 바로 앞에서 뒷바퀴가 턱 끝을 스치고 다시 떠서 아래 평지에 내린다.
    const c = courseFromTemplates([lipT])
    // 턱을 스치는 동안 앞으로 약 370 돌므로(GROUND_TOL 접지로 스침이 몇 틱 길다) 최종 첫 접촉에도 1바퀴가 남게 TURN + 600에서 시작한다.
    const start = TURN + 600
    let s = airborne(c, TPL_X + mm(10000) - mm(1000), mm(100), 0, start, 2500, -200)
    let sum = start // 공중 구간 시작 뒤 모든 틱(접촉 틱 포함)의 몸체 각도 변화 합
    let phases = ''
    let awards = 0
    for (let i = 0; i < 300 && !s.dead; i++) {
      const n = step(s, false, c)
      if (s.airAngle !== null && n.airAngle !== null) {
        sum += omega(s, n)
        expect(n.airAngle).toBe(sum)
      }
      const ph = n.pending ? 'P' : n.airAngle !== null ? 'A' : 'G'
      if (!phases.endsWith(ph)) phases += ph
      if (n.lastAward !== s.lastAward) awards++
      s = n
    }
    expect(phases).toMatch(/^AP(AP)+G$/) // 닿았다가 지급 전에 다시 떴다(한 번 이상), 마지막에 착지
    expect(s.dead).toBeNull()
    expect(awards).toBe(1)
    expect(s.lastAward?.flips).toBe(1)
    expect(s.flipScore).toBe(s.lastAward?.points)
  })

  it('퍼펙트: 오차 0 → flips × PERFECT_MULT, 오차 PERFECT_TOL+50 → flips', () => {
    const c = courseFromTemplates([flatT])
    const perfect = run(airborne(c, TPL_X, mm(1000), 0, TURN), 120, () => false, c)
    expect(perfect.dead).toBeNull()
    expect(perfect.lastAward).toMatchObject({ flips: 1, perfect: true, points: PERFECT_MULT })
    expect(perfect.flipScore).toBe(PERFECT_MULT)
    const off = PERFECT_TOL + 50
    const sloppy = run(airborne(c, TPL_X, mm(1000), off, TURN + off), 120, () => false, c)
    expect(sloppy.dead).toBeNull()
    expect(sloppy.lastAward).toMatchObject({ flips: 1, perfect: false, points: 1 })
  })

  it('앞으로 도는 1바퀴(−TURN)도 flips 1', () => {
    const c = courseFromTemplates([flatT])
    const s = run(airborne(c, TPL_X, mm(1000), 0, -TURN - 100), 120, () => false, c)
    expect(s.dead).toBeNull()
    expect(s.lastAward?.flips).toBe(1)
  })

  it('접지 깜박임 없음: V_MAX로 hill·waves를 계속 누르며 지나면 두 바퀴가 함께 뜨는 틱도, 다시 닿는 틱도 없다(GROUND_TOL)', () => {
    for (const id of ['hill', 'waves']) {
      const c = courseOf([id])
      const sec = c.section(0)
      let s = initSimAt(c, sec.startX + WHEEL_R, V_MAX)
      let bothAir = 0
      let retouch = 0
      for (let i = 0; i < 900 && centreX(s) <= sec.endX; i++) {
        const n = step(s, true, c)
        expect(n.dead, id).toBeNull()
        if (!n.rear.ground && !n.front.ground) bothAir++
        if ((n.rear.ground && !s.rear.ground) || (n.front.ground && !s.front.ground)) retouch++
        s = n
      }
      expect(centreX(s), id).toBeGreaterThan(sec.endX)
      expect(bothAir, `${id} 두 바퀴 공중 틱`).toBe(0)
      expect(retouch, `${id} 다시 닿은 틱`).toBe(0)
    }
  })

  it('collideWheel: 지면에서 GROUND_TOL 안이면 닿은 것으로 돌려주되 밀거나 속도를 바꾸지 않는다, 그 밖이면 안 닿음', () => {
    const c = courseFromTemplates([flatT])
    const X = TPL_X + mm(2000) // 선분 이음매가 아닌 곳
    const cands = windowCands(c, 1, COLLIDE_WINDOW, { x0: X - mm(5000), y0: -mm(5000), x1: X + mm(5000), y1: mm(5000) }, false)
    const y = WHEEL_R + GROUND_TOL - 1
    const near = { x: X, y, vx: 100, vy: 0 }
    expect(collideWheel(near, X, y, WHEEL_R, GROUND_TOL, cands, 0).length).toBe(1)
    expect(near).toEqual({ x: X, y, vx: 100, vy: 0 })
    const off = { x: X, y: WHEEL_R + GROUND_TOL + 1, vx: 100, vy: 0 }
    expect(collideWheel(off, off.x, off.y, WHEEL_R, GROUND_TOL, cands, 0)).toEqual([])
    const sunk = { x: X, y: WHEEL_R - mm(5), vx: 100, vy: -50 }
    expect(collideWheel(sunk, X, WHEEL_R + mm(5), WHEEL_R, GROUND_TOL, cands, 0).length).toBe(1)
    expect(sunk.y).toBe(WHEEL_R)
    expect(sunk.vy).toBe(0)
  })

  it('공중 회전은 두 바퀴가 두 틱 연속 공중일 때부터 건다(한 틱만 뜬 꼭대기에서 회전 충격 없음)', () => {
    const c = courseFromTemplates([flatT])
    const a0 = airborne(c, TPL_X, mm(5000), 0, 0)
    expect(a0.airBefore).toBe(false)
    const a1 = step(a0, true, c)
    expect(omega(a0, a1)).toBe(0)
    expect(a1.airBefore).toBe(true)
    const a2 = step(a1, true, c)
    expect(omega(a1, a2)).toBeGreaterThan(0)
  })

  it('코스 시작점 뒤로 되굴러가도 길이 있다: hill 오르막 전후에 떼면 x = 0 뒤로 가지만 3000틱 뒤에도 살아 있다', () => {
    // 템플릿 앞뒤 평지 자르기(trimFlats)를 끈 hill로 잰다: 이 시험은 코스 시작점 뒤의 길을 보는 것이고, 긴 도움닫기가 있어야 오르막 중간에서 떼게 된다.
    const hillRaw = { ...(TEMPLATES.find((t) => t.id === 'hill') as Template), trimFlats: false }
    for (const release of [100, 115, 130]) {
      const c = courseFromTemplates([hillRaw])
      let s = initSim(c)
      let minX = centreX(s)
      for (let i = 0; i < 3000; i++) {
        s = step(s, i < release, c)
        minX = Math.min(minX, centreX(s))
      }
      expect(s.dead, `release ${release}`).toBeNull()
      expect(minX, `release ${release}`).toBeLessThan(0)
    }
  })

  it('구간 통과: hill 하나를 지나면 sectionScore 1, nextSection 1', () => {
    const c = courseOf(['hill'])
    let s = initSim(c)
    const end = c.section(0).endX
    for (let i = 0; i < 3000 && centreX(s) <= end; i++) {
      s = step(s, true, c)
      expect(s.dead).toBeNull()
      if (centreX(s) <= end) expect(s.sectionScore).toBe(0)
    }
    expect(s.sectionScore).toBe(1)
    expect(s.nextSection).toBe(1)
    expect(scoreOf(s)).toBe(1)
  })

  it('부스터: 떼고 지나가도 직후 속도 ≥ BOOST_V × 0.95', () => {
    const c = courseFromTemplates([boostT])
    let s = initSimAt(c, TPL_X, 1000)
    const boostEnd = TPL_X + mm(14000)
    for (let i = 0; i < 2000 && Math.min(s.rear.x, s.front.x) - WHEEL_R <= boostEnd; i++) s = step(s, false, c)
    expect(s.dead).toBeNull()
    expect(speed(s)).toBeGreaterThanOrEqual(Math.floor((BOOST_V * 95) / 100))
  })

  it('보석: bowl의 보석 위를 지나면 gems 증가, 같은 보석은 한 번만', () => {
    const c = courseOf(['bowl'])
    let s = initSimAt(c, TPL_X, 1200)
    const seen = new Set<number>()
    for (let i = 0; i < 900 && !s.dead; i++) {
      s = step(s, false, c)
      expect(new Set(s.takenGems).size).toBe(s.takenGems.length)
      for (const g of s.takenGems) seen.add(g)
      expect(s.gems).toBe(seen.size)
    }
    expect(s.gems).toBeGreaterThan(0)
  })

  it('되굴러옴: 쿼터파이프에서 속도가 모자라 돌아와도 바닥을 뚫지 않고 progress가 감소', () => {
    const c = courseFromTemplates([quarterT])
    let s = initSimAt(c, TPL_X, 2000)
    let maxProgress = 0
    let minY = s.rear.y
    for (let i = 0; i < 400; i++) {
      s = step(s, false, c)
      expect(s.dead).toBeNull()
      maxProgress = Math.max(maxProgress, s.progress)
      minY = Math.min(minY, s.rear.y, s.front.y)
    }
    expect(minY).toBeGreaterThanOrEqual(WHEEL_R - mm(20))
    expect(speed(s)).toBeLessThan(0)
    expect(s.progress).toBeLessThan(maxProgress)
  })

  it('give_up·사망 뒤 step은 같은 내용을 돌려준다', () => {
    const c = courseFromTemplates([flatT])
    const g = { ...initSim(c), dead: 'give_up' as const }
    expect(JSON.stringify(step(g, true, c))).toBe(JSON.stringify(g))
    const crashed = run(airborne(c, TPL_X, mm(2000), TURN / 2, 0), 200, () => false, c)
    expect(crashed.dead).toBe('crash')
    expect(JSON.stringify(step(crashed, true, c))).toBe(JSON.stringify(crashed))
  })

  it('틈으로 떨어지면 fall', () => {
    const c = courseOf(['ramp'])
    // ramp의 틈(앞쪽 평지를 8 m → 2 m로 자른 뒤 템플릿 x 5.5~13.5 m) 한가운데에 멈춘 채로 둔다. 틈 뒤 내리막 시작 높이에서 떨어지기 시작한다.
    const s = run(airborne(c, TPL_X + mm(9500), 0, 0, 0), 600, () => false, c)
    expect(s.dead).toBe('fall')
    expect(Math.floor((s.rear.y + s.front.y) / 2)).toBeLessThan(c.section(0).minY - FALL_DEPTH)
  })

  it('Review Focus 4: 20000틱 뒤 takenGems ≤ 64, 상태 JSON < 6000자', () => {
    // 바퀴 높이에 보석이 줄지어 있는 평지를 계속 달려 보석을 많이 줍는다(충돌 창 안의 보석이 64개를 훨씬 넘는다).
    const gemsT: Template = {
      id: 'gems',
      tier: 1,
      prims: [
        ...Array.from({ length: 8 }, () => ({ t: 'gem' as const, dx: 0, dy: WHEEL_R })),
        { t: 'line', dx: mm(6000), dy: 0 },
      ],
    }
    const c = courseFromTemplates([gemsT])
    let s = initSim(c)
    let maxTaken = 0
    for (let i = 0; i < 20000; i++) {
      s = step(s, true, c)
      maxTaken = Math.max(maxTaken, s.takenGems.length)
    }
    expect(s.dead).toBeNull()
    expect(s.tick).toBe(20000)
    expect(s.gems).toBeGreaterThan(1000)
    expect(maxTaken).toBeLessThanOrEqual(64)
    expect(JSON.stringify(s).length).toBeLessThan(6000)
  }, 20000)
})

describe('공중제비 수: 거꾸로 선 자세를 지난 횟수 (flipsOf)', () => {
  const D = (deg: number) => Math.floor((deg * TURN) / 360)
  it('평지에서 떠서 360° 돌면 1, 179°까지는 0, 181°부터 1, 540°를 넘기면 2', () => {
    expect(flipsOf(0)).toBe(0)
    expect(flipsOf(D(179))).toBe(0)
    expect(flipsOf(D(181))).toBe(1)
    expect(flipsOf(D(360))).toBe(1)
    expect(flipsOf(D(539))).toBe(1)
    expect(flipsOf(D(541))).toBe(2)
    expect(flipsOf(D(720))).toBe(2)
  })
  it('앞이 45° 들린 채 떠서 283°만 돌아 내리막에 내려도 1 (45° + 283° = 328°)', () => {
    expect(flipsOf(D(45) + D(283))).toBe(1)
  })
  it('앞이 들린 채 떠서 조금만 돌면 0 (45° + 100° = 145°)', () => {
    expect(flipsOf(D(45) + D(100))).toBe(0)
  })
  it('앞으로 도는 회전도 같다: −181° → 1, −179° → 0, 앞이 30° 숙여진 채 −160° 더 돌면 1', () => {
    expect(flipsOf(-D(179))).toBe(0)
    expect(flipsOf(-D(181))).toBe(1)
    expect(flipsOf(-D(30) - D(160))).toBe(1)
  })
  it('공중 구간의 시작값은 뜨기 직전 차체의 기울기다', () => {
    // 가파른 오르막 끝에서 뜨면 airAngle이 0이 아니라 그 기울기에서 시작한다.
    const course = courseOf(['ramp'])
    const sec = course.section(0)
    let s = initSimAt(course, sec.startX + WHEEL_R, V_MAX)
    let first: { angle: number; air: number } | null = null
    for (let t = 0; t < 600 && !s.dead && first === null; t++) {
      const before = bodyAngle(s)
      const wasNull = s.airAngle === null
      s = step(s, true, course)
      const pitch = before > TURN / 2 ? before - TURN : before
      if (wasNull && s.airAngle !== null && Math.abs(pitch) > D(20)) first = { angle: pitch, air: s.airAngle }
    }
    expect(first).not.toBeNull()
    expect(Math.abs(first!.air - first!.angle)).toBeLessThan(D(8)) // 시작 기울기 + 한 틱 회전
    expect(first!.angle).toBeGreaterThan(D(20))
  })
})

describe('위험물 판정', () => {
  const still: Motion = { k: 'none' }
  // 평지 위, 출발점에서 dx 앞에 놓은 위험물 하나짜리 코스.
  const withHazard = (h: HazardDef, dx = mm(20000)): Course =>
    courseFromTemplates([{ id: 'hz', tier: 1, prims: [{ t: 'hazard', dx, dy: 0, h }, { t: 'line', dx: mm(400000), dy: 0 }] }])
  const drive = (c: Course, ticks = 200): SimState => run(initSimAt(c, TPL_X, V_MAX), ticks, () => true, c)

  it('위험물이 없는 평지는 그대로 달린다', () => {
    const c = courseFromTemplates([flatT])
    expect(drive(c).dead).toBeNull()
  })

  it('제자리 톱니로 달려가면 crash (지급 대기 없이)', () => {
    const c = withHazard({ shape: { s: 'disc', x: 0, y: mm(100), r: mm(300) }, motion: still, look: 'saw' })
    const s = drive(c)
    expect(s.dead).toBe('crash')
    expect(s.pending).toBeNull()
  })

  it('원형 배럴: 틈이 있어 시작 위상에 따라 살아 지나가기도, crash하기도 한다', () => {
    const outcomes = new Set<string | null>()
    for (let a0 = 0; a0 < TURN; a0 += 256) {
      const c = withHazard({
        shape: { s: 'blades', x: 0, y: mm(500), rIn: mm(1500), rOut: mm(3000), n: 1, w: TURN / 8 },
        motion: { k: 'rotate', a0, w: 20 },
        look: 'blades',
      })
      outcomes.add(drive(c).dead)
    }
    expect(outcomes.has('crash')).toBe(true)
    expect(outcomes.has(null)).toBe(true)
  })

  it('pop 창: 숨은 위상에 지나가면 살고, 솟은 위상에 지나가면 crash', () => {
    const pop = (phase: number): HazardDef => ({
      shape: { s: 'bar', x0: 0, y0: 0, x1: 0, y1: 0, r: mm(300) },
      motion: { k: 'pop', period: 60, phase, hide: 20, rise: 10, up: 20, fall: 10, height: mm(1500) },
      look: 'spear',
    })
    const results: (string | null)[] = []
    for (let phase = 0; phase < 60; phase += 5) results.push(drive(withHazard(pop(phase))).dead)
    expect(results).toContain('crash')
    expect(results).toContain(null)
    // 같은 phase는 같은 결과(결정성).
    expect(drive(withHazard(pop(0))).dead).toBe(results[0])
  })

  it('두 바퀴 사이로 들어온 가는 레이저는 차대 캡슐에 걸려 crash', () => {
    // 차체 판정원은 중점 위 200 mm, 반지름 180 mm라 중점 위 20 mm까지만 내려온다. 바퀴(반지름 180 mm)는 x로 700 mm 떨어져 있다.
    // 그래서 중점 아래 30 mm의 가는 레이저(반지름 10 mm)는 차대(반지름 110 mm)에만 닿는다.
    const base = initSimAt(courseFromTemplates([flatT]), TPL_X, 0)
    const mx = Math.floor((base.rear.x + base.front.x) / 2)
    const my = base.rear.y
    const laser = (y: number): HazardDef => ({ shape: { s: 'bar', x0: 0, y0: y, x1: mm(10), y1: y, r: mm(10) }, motion: still, look: 'laser' })
    const probe = (y: number): SimState => {
      const c = courseFromTemplates([{ id: 'lz', tier: 1, prims: [{ t: 'hazard', dx: mx - TPL_X, dy: y, h: laser(0) }, { t: 'line', dx: mm(400000), dy: 0 }] }])
      return step(initSimAt(c, TPL_X, 0), false, c)
    }
    expect(probe(my - mm(30)).dead).toBe('crash') // 차대 안, 차체 판정원·바퀴 밖
    expect(probe(my - mm(150)).dead).toBeNull() // 차대 아래(−120 mm 밖), 땅(−180 mm) 위
  })

  it('같은 입력 600틱은 같은 결과(JSON)', () => {
    const c = withHazard({ shape: { s: 'disc', x: 0, y: mm(100), r: mm(300) }, motion: { k: 'swing', ax: 0, ay: mm(2000), period: 90, phase: 0 }, look: 'saw' }, mm(60000))
    const a = JSON.stringify(run(initSimAt(c, TPL_X, V_MAX), 600, () => true, c))
    const b = JSON.stringify(run(initSimAt(c, TPL_X, V_MAX), 600, () => true, c))
    expect(a).toBe(b)
  })
})

describe('움직이는 길', () => {
  const road = (segs: { x0: number; y0: number; x1: number; y1: number }[], motion: Motion, start: MoverDef['start'] = { k: 'time' }): MoverDef => ({
    segs: segs.map((g) => ({ ...g, boost: false })),
    pivotX: 0,
    pivotY: 0,
    motion,
    start,
    look: 'yellow',
  })
  const flatRoad = (len: number, motion: Motion, start?: MoverDef['start']): MoverDef => road([{ x0: 0, y0: 0, x1: len, y1: 0 }], motion, start)
  // 템플릿 원점(TPL_X, 0)에서 (dx, dy)에 길들을 놓고, 그 뒤로 평지 400 m(낭떠러지 없음). 길 좌표는 놓은 점 기준.
  const withRoads = (roads: [number, number, MoverDef][], ground: Template['prims'] = [{ t: 'line', dx: mm(400000), dy: 0 }]): Course =>
    courseFromTemplates([{ id: 'mv', tier: 1, prims: [...roads.map(([dx, dy, m]) => ({ t: 'mover' as const, dx, dy, m })), ...ground] }])
  // 뒷바퀴 x, 길 높이 y 위에 수평으로 앉은 차. 두 바퀴 속도 (vx, vy).
  const restOn = (c: Course, x: number, y: number, vx = 0, vy = 0, ground = true): SimState => {
    const w = (wx: number): Wheel => ({ x: wx, y: y + WHEEL_R, px: wx - vx, py: y + WHEEL_R - vy, ground })
    return { ...initSimAt(c, TPL_X, 0), rear: w(x), front: w(x + WHEELBASE) }
  }
  // 반지름 R 정다각형 고리(n 조각, 기준점 = 중심).
  const ring = (R: number, n: number, w: number): MoverDef => {
    const p = (i: number): [number, number] => [Math.round(R * Math.cos((2 * Math.PI * i) / n)), Math.round(R * Math.sin((2 * Math.PI * i) / n))]
    return { ...road(Array.from({ length: n }, (_, i) => ({ x0: p(i)[0], y0: p(i)[1], x1: p(i + 1)[0], y1: p(i + 1)[1] })), { k: 'rotate', a0: 0, w }), look: 'green' }
  }
  // 고리 중심 (cx, cy) 둘레 반지름 rw, 각도 ang(라디안)의 바퀴. 고리와 함께 도는 속도(w TURN/틱)를 준다.
  const ringWheel = (cx: number, cy: number, rw: number, ang: number, w: number): Wheel => {
    const om = (w * 2 * Math.PI) / TURN
    const x = Math.round(cx + rw * Math.cos(ang))
    const y = Math.round(cy + rw * Math.sin(ang))
    return { x, y, px: x + Math.round(om * (y - cy)), py: y - Math.round(om * (x - cx)), ground: true }
  }
  const SWING: Motion = { k: 'swing', ax: mm(6000), ay: 0, period: 240, phase: 60 } // 한가운데(+3 m)에서 시작, 800 u/틱
  const roadVx = (m: Motion, tick: number): number => poseAt(m, (tick + 1) * SUBSTEPS, null).dx - poseAt(m, tick * SUBSTEPS, null).dx
  const carVx = (s: SimState): number => Math.floor((vxOf(s.rear) + vxOf(s.front)) / 2)

  it('움직이는 것이 없는 지형: 이 기능 전과 같은 결과(상태에 빈 movers·moversDone·blocks·blocksDone만 늘었다)', () => {
    // 움직이는 길을 넣기 전 코드로 만든 최종 상태(JSON). 앞 셋은 고정 템플릿에 무작위 입력 1500틱, 뒤 둘은 시드 코스에 규칙 입력 3000틱.
    const before = [
      '{"tick":175,"rear":{"x":428420,"y":-36936,"px":425174,"py":-32900,"ground":false},"front":{"x":439806,"y":-17643,"px":438991,"py":-15044,"ground":false},"progress":18,"nextSection":0,"sectionScore":0,"flipScore":0,"airAngle":4718,"pending":null,"lastAward":null,"gems":0,"takenGems":[],"dead":"crash","airBefore":true}',
      '{"tick":379,"rear":{"x":958745,"y":-13004,"px":954348,"py":-12059,"ground":false},"front":{"x":937502,"y":-5892,"px":934005,"py":-2266,"ground":false},"progress":191,"nextSection":1,"sectionScore":1,"flipScore":0,"airAngle":1810,"pending":null,"lastAward":null,"gems":6,"takenGems":[],"dead":"crash","airBefore":true}',
      '{"tick":527,"rear":{"x":669049,"y":-5120,"px":665937,"py":-5127,"ground":true},"front":{"x":647387,"y":590,"px":644782,"py":2503,"ground":false},"progress":195,"nextSection":0,"sectionScore":0,"flipScore":1,"airAngle":1842,"pending":{"flips":0,"perfect":false,"grace":3},"lastAward":{"tick":387,"flips":1,"perfect":false,"points":1},"gems":0,"takenGems":[],"dead":"crash","airBefore":false}',
      '{"tick":217,"rear":{"x":640660,"y":4834,"px":637440,"py":4113,"ground":true},"front":{"x":618406,"y":7379,"px":615473,"py":9179,"ground":false},"progress":87,"nextSection":1,"sectionScore":1,"flipScore":0,"airAngle":null,"pending":null,"lastAward":null,"gems":5,"takenGems":[0,1,2,3,4],"dead":"crash","airBefore":false}',
      '{"tick":260,"rear":{"x":644397,"y":36521,"px":644162,"py":37548,"ground":false},"front":{"x":634453,"y":16451,"px":635018,"py":17080,"ground":true},"progress":83,"nextSection":1,"sectionScore":1,"flipScore":1,"airAngle":null,"pending":null,"lastAward":{"tick":237,"flips":1,"perfect":false,"points":1},"gems":5,"takenGems":[0,1,2,3,4],"dead":"crash","airBefore":false}'
    ]
    const after: string[] = []
    for (const [ids, seed] of [[['ramp', 'hill', 'bowl'], 7], [['loop', 'spikepit', 'waves'], 3], [['loop2', 'spikefloor', 'ramp'], 5]] as const) {
      const c = courseOf(ids)
      after.push(JSON.stringify(run(initSim(c), 1500, randomInput(seed), c)))
    }
    for (const seed of ['0123456789abcdef0123456789abcdef', 'fedcba9876543210fedcba9876543210']) {
      const c = getCourse(seed)
      after.push(JSON.stringify(run(initSim(c), 3000, (_, i) => i % 50 < 30, c)))
    }
    expect(after).toEqual(before.map((b) => b.slice(0, -1) + ',"movers":[],"moversDone":[],"blocks":[],"blocksDone":[]}'))
  })

  it('수평으로 왕복하는 길 위에 (길에 대해) 정지한 차는 방향이 네 번 바뀌는 동안 길과 함께 움직인다', () => {
    const c = withRoads([[mm(20000), mm(2000), flatRoad(mm(20000), SWING)]])
    let s = restOn(c, TPL_X + mm(29000), mm(2000), roadVx(SWING, -1))
    const rel: number[] = []
    for (let t = 0; t < 480; t++) {
      s = step(s, false, c)
      expect(s.dead).toBeNull()
      expect(s.rear.ground && s.front.ground).toBe(true)
      rel.push(carVx(s) - roadVx(SWING, t))
    }
    for (let i = 0; i < rel.length; i += 10) {
      const avg = Math.abs(rel.slice(i, i + 10).reduce((a, b) => a + b, 0)) / 10
      expect(avg, `ticks ${i}~${i + 9}`).toBeLessThan(WHEEL_R / 20)
    }
    expect(s.rear.y).toBe(mm(2000) + WHEEL_R) // 길에서 떨어지지 않았다
  })

  it('구동 최고 속도는 뒷바퀴가 닿은 길에 대한 상대 속도로 잰다', () => {
    const slow: Motion = { k: 'swing', ax: mm(60000), ay: 0, period: 2400, phase: 600 } // 800 u/틱으로 한 방향
    const c = withRoads([[mm(20000), mm(2000), flatRoad(mm(200000), slow)]])
    // phase 600(¼주기)이라 처음 자세가 이미 ax/2 = 30 m 옮겨져 있다: 길은 템플릿 x 50~250 m.
    const s = run(restOn(c, TPL_X + mm(60000), mm(2000), roadVx(slow, -1)), 90, () => true, c)
    expect(s.dead).toBeNull()
    const rel = carVx(s) - roadVx(slow, s.tick - 1)
    expect(Math.abs(rel - V_MAX)).toBeLessThan(Math.floor(V_MAX / 20))
    expect(carVx(s)).toBeGreaterThan(V_MAX + 700)
  })

  it('회전 고리: 고리와 함께 도는 차는 느리면 붙어 있고, 빠르면(ω²R > G) 튕겨 나가 뜬다', () => {
    const R = mm(4000)
    const H = mm(7000)
    const liftTick = (w: number): number => {
      const c = withRoads([[mm(30000), H, ring(R, 32, w)]])
      const cx = TPL_X + mm(30000)
      const rw = R * Math.cos(Math.PI / 32) + WHEEL_R
      const half = Math.asin(WHEELBASE / 2 / rw)
      let s: SimState = { ...initSimAt(c, TPL_X, 0), rear: ringWheel(cx, H, rw, Math.PI / 2 + half, w), front: ringWheel(cx, H, rw, Math.PI / 2 - half, w) }
      for (let i = 0; i < 60 && !s.dead; i++) {
        s = step(s, false, c)
        if (!s.rear.ground && !s.front.ground) return s.tick
      }
      return -1
    }
    // 고리 위 바퀴 중심 반지름 ≈ 4.18 m: 문턱 ω = √(G / R) ≈ 21.8 TURN/틱
    expect(liftTick(8)).toBeGreaterThan(30)
    expect(liftTick(16)).toBeGreaterThan(20)
    expect(liftTick(28)).toBeLessThanOrEqual(8)
    expect(liftTick(40)).toBeLessThanOrEqual(4)
  })

  it('회전 고리 위·안에서 임의 입력 600틱(20개 시드): 바퀴 중심이 고리 선분을 뚫지 않는다(길 기준 상대 위치로 검사)', () => {
    const R = mm(4000)
    const H = mm(7000)
    const W = 12
    const def = ring(R, 32, W)
    const cx = TPL_X + mm(30000)
    const rOut = R * Math.cos(Math.PI / 32) + WHEEL_R
    const rIn = R * Math.cos(Math.PI / 32) - WHEEL_R
    const starts: [number, number][] = [
      [rOut, Math.PI / 2], // 고리 위
      [rIn, -Math.PI / 2], // 고리 안 바닥
    ]
    let checked = 0
    for (const [rw, mid] of starts) {
      for (let seed = 1; seed <= 20; seed++) {
        const c = withRoads([[mm(30000), H, def]])
        const [m] = c.moversNear({ x0: cx, y0: H, x1: cx, y1: H })
        const half = Math.asin(WHEELBASE / 2 / rw)
        const up = mid > 0
        let s: SimState = {
          ...initSimAt(c, TPL_X, 0),
          rear: ringWheel(cx, H, rw, up ? mid + half : mid - half, W),
          front: ringWheel(cx, H, rw, up ? mid - half : mid + half, W),
        }
        const inp = randomInput(seed)
        for (let i = 0; i < 600; i++) {
          const n = step(s, inp(s, i), c)
          if (n.dead) break
          const g0 = moverSegsAt(m, s.tick * SUBSTEPS, 0)
          const g1 = moverSegsAt(m, n.tick * SUBSTEPS, 0)
          for (const [a, b] of [
            [s.rear, n.rear],
            [s.front, n.front],
          ]) {
            for (let j = 0; j < g1.length; j++) {
              const g = g1[j]
              if (Math.min(g.x0, g.x1) - WHEELBASE > b.x || Math.max(g.x0, g.x1) + WHEELBASE < b.x) continue
              // 틱 시작 위치를 길에 실어 틱 끝 자세로 옮긴 점 → 틱 끝 위치의 이동이 선분을 가로지르면 관통이다.
              const o = toFrame(g0[j], g, a.x, a.y)
              expect(crosses({ ...a, ...o }, b, g), `seed ${seed} tick ${i} seg ${j}`).toBe(false)
              for (const [ex, ey] of [
                [g.x0, g.y0],
                [g.x1, g.y1],
              ]) {
                expect(isqrt((b.x - ex) ** 2 + (b.y - ey) ** 2)).toBeGreaterThan(Math.floor(WHEEL_R / 2))
              }
              checked++
            }
          }
          s = n
        }
      }
    }
    expect(checked).toBeGreaterThan(100000)
  }, 60000)

  it('touch 길: 바퀴가 처음 닿은 틱 + delay = t0, 그 전에는 처음 자세, t0 뒤에 움직인다', () => {
    const lift: Motion = { k: 'keys', keys: [{ t: 0, dx: 0, dy: 0, a: 0 }, { t: 60, dx: 0, dy: mm(2000), a: 0 }] }
    const c = withRoads([[mm(20000), mm(2000), flatRoad(mm(6000), lift, { k: 'touch', delay: 10 })]])
    let s = restOn(c, TPL_X + mm(22000), mm(2500), 0, 0, false)
    let touchTick = -1
    for (let i = 0; i < 40 && touchTick < 0; i++) {
      const n = step(s, false, c)
      if (!s.rear.ground && !s.front.ground && (n.rear.ground || n.front.ground)) touchTick = n.tick
      else expect(n.movers).toEqual([])
      s = n
    }
    expect(touchTick).toBeGreaterThan(0)
    const t0 = touchTick + 10
    expect(s.movers).toEqual([{ id: 0, t0 }])
    const m = c.moverById(0)
    for (const T of [0, touchTick * SUBSTEPS, t0 * SUBSTEPS]) expect(moverSegsAt(m, T, t0 * SUBSTEPS)).toEqual(m.segs)
    expect(moverSegsAt(m, t0 * SUBSTEPS + 1, t0 * SUBSTEPS)).not.toEqual(m.segs)
    s = run(s, t0 - s.tick, () => false, c)
    expect(s.tick).toBe(t0)
    expect(s.rear.y).toBe(mm(2000) + WHEEL_R) // t0까지 처음 높이에 앉아 있다
    expect(s.movers).toEqual([{ id: 0, t0 }]) // 다시 닿아도 t0은 그대로
    s = run(s, 30, () => false, c)
    expect(s.rear.y - (mm(2000) + WHEEL_R)).toBeGreaterThan(mm(900)) // 30틱 동안 반쯤 올라갔다(차를 싣고)
    expect(s.dead).toBeNull()
  })

  it('Review Focus 2: 끝난 keys 길은 moversDone으로 옮겨지고, 차가 다시 닿으면 마지막 키 자세에 닿는다', () => {
    const lift: Motion = { k: 'keys', keys: [{ t: 0, dx: 0, dy: 0, a: 0 }, { t: 60, dx: 0, dy: mm(2000), a: 0 }] }
    const c = withRoads([[mm(20000), mm(2000), flatRoad(mm(6000), lift, { k: 'touch', delay: 0 })]])
    let s = run(restOn(c, TPL_X + mm(22000), mm(2100), 0, 0, false), 120, () => false, c)
    expect(s.movers).toEqual([])
    expect(s.moversDone).toEqual([0])
    expect(s.rear.y).toBe(mm(4000) + WHEEL_R)
    // 차를 들어 올렸다가(공중) 떨어뜨린다: 처음 자세(2 m)가 아니라 마지막 키(4 m)에 내려앉는다.
    s = { ...s, ...restOn(c, TPL_X + mm(23000), mm(5000), 0, 0, false), tick: s.tick, movers: s.movers, moversDone: s.moversDone }
    s = run(s, 120, () => false, c)
    expect(s.dead).toBeNull()
    expect(s.rear.ground && s.front.ground).toBe(true)
    expect(s.rear.y).toBe(mm(4000) + WHEEL_R)
    expect(s.moversDone).toEqual([0])
  })

  it('일회성 도로: 조각 셋 중 밟은 조각만 떨어지고, 같이 떨어지면 fall', () => {
    const piece = flatRoad(mm(3000), { k: 'fall', w: 0 }, { k: 'touch', delay: 5 })
    const ground: Template['prims'] = [
      { t: 'line', dx: mm(10000), dy: 0 },
      { t: 'gap', dx: mm(9300), dy: 0 },
      { t: 'line', dx: mm(400000), dy: 0 },
    ]
    const c = withRoads([0, 1, 2].map((k) => [mm(10100 + 3050 * k), 0, piece] as [number, number, MoverDef]), ground)
    let s = restOn(c, TPL_X + mm(10100 + 3050 + 800), mm(300), 0, 0, false)
    const seen = new Set<number>()
    for (let i = 0; i < 600 && !s.dead; i++) {
      s = step(s, false, c)
      for (const e of s.movers) seen.add(e.id)
      for (const id of s.moversDone) seen.add(id)
    }
    expect(s.dead).toBe('fall')
    expect([...seen]).toEqual([1])
    const T = s.tick * SUBSTEPS
    expect(moverSegsAt(c.moverById(0), T, null)).toEqual(c.moverById(0).segs)
    expect(moverSegsAt(c.moverById(2), T, null)).toEqual(c.moverById(2).segs)
  })

  it('pass 길: 차 중심 x가 pass.x를 넘기 전에는 처음 자세, 넘은 틱 + delay부터 움직인다', () => {
    const swingUp: Motion = { k: 'keys', keys: [{ t: 0, dx: 0, dy: 0, a: 0 }, { t: 30, dx: 0, dy: mm(3000), a: 0 }] }
    // 길은 땅 위 6 m에 떠 있어 차가 닿지 않는다. pass.x는 템플릿 원점 + 20 m(길보다 10 m 앞).
    const c = withRoads([[mm(30000), mm(6000), flatRoad(mm(4000), swingUp, { k: 'pass', x: -mm(10000), delay: 7 })]])
    const passX = TPL_X + mm(20000)
    let s = initSimAt(c, TPL_X, V_MAX)
    let crossed = -1
    for (let i = 0; i < 400 && crossed < 0; i++) {
      const n = step(s, true, c)
      if (Math.floor((n.rear.x + n.front.x) / 2) > passX) crossed = n.tick
      else expect(n.movers).toEqual([])
      s = n
    }
    expect(crossed).toBeGreaterThan(0)
    expect(s.movers).toEqual([{ id: 0, t0: crossed + 7 }])
    const m = c.moverById(0)
    const T0 = (crossed + 7) * SUBSTEPS
    expect(moverSegsAt(m, T0, T0)).toEqual(m.segs)
    expect(moverSegsAt(m, T0 + SUBSTEPS * 10, T0)[0].y0).toBeGreaterThan(m.segs[0].y0)
    s = run(s, 60, () => true, c)
    expect(s.movers).toEqual([])
    expect(s.moversDone).toEqual([0])
  })

  it('pass 길: pass.x가 길 오른쪽(움직임 상자 밖)이어도 차 중심이 넘는 틱에 시작한다', () => {
    const drop: Motion = { k: 'keys', keys: [{ t: 0, dx: 0, dy: 0, a: 0 }, { t: 30, dx: 0, dy: -mm(3000), a: 0 }] }
    // 길은 템플릿 원점 + 10~14 m, 땅 위 6 m. pass.x는 원점 + 30 m(길 끝보다 16 m 뒤).
    const c = withRoads([[mm(10000), mm(6000), flatRoad(mm(4000), drop, { k: 'pass', x: mm(20000), delay: 3 })]])
    const passX = TPL_X + mm(30000)
    let s = initSimAt(c, TPL_X, V_MAX)
    let crossed = -1
    for (let i = 0; i < 400 && crossed < 0; i++) {
      const n = step(s, true, c)
      if (Math.floor((n.rear.x + n.front.x) / 2) > passX) crossed = n.tick
      else expect(n.movers).toEqual([])
      s = n
    }
    expect(crossed).toBeGreaterThan(0)
    expect(s.movers).toEqual([{ id: 0, t0: crossed + 3 }])
  })

  it('떨어진 fall 길은 끝난다: moversDone으로 옮겨지고, 더는 판정·그림에 쓰지 않는다', () => {
    // 2 m 틈 위에 2.4 m 일회성 조각. 차가 V_MAX로 지나간 뒤(delay 20) 떨어진다.
    const piece = flatRoad(mm(2400), { k: 'fall', w: 0 }, { k: 'touch', delay: 20 })
    const ground: Template['prims'] = [
      { t: 'line', dx: mm(10000), dy: 0 },
      { t: 'gap', dx: mm(2000), dy: 0 },
      { t: 'line', dx: mm(400000), dy: 0 },
    ]
    const c = withRoads([[mm(9800), 0, piece]], ground)
    let s = initSimAt(c, TPL_X, V_MAX)
    let doneAt = -1
    for (let i = 0; i < 300 && doneAt < 0; i++) {
      s = step(s, true, c)
      if (s.moversDone.includes(0)) doneAt = s.tick
    }
    expect(s.dead).toBeNull()
    expect(doneAt).toBeGreaterThan(20)
    expect(s.movers).toEqual([])
    const all = c.moversNear({ x0: TPL_X, y0: -mm(1000000), x1: TPL_X + mm(20000), y1: mm(1000000) })
    expect(all.map((m) => m.id)).toEqual([0]) // 코스에는 남아 있지만
    expect(moverRuns(s, all)).toEqual([]) // 판정·그림 목록에서 빠진다
    // 조각이 있던 자리(틈 위) 바로 위에 차를 떨어뜨리면 그대로 틈으로 빠진다.
    let t = { ...s, ...restOn(c, TPL_X + mm(10300), mm(200), 0, 0, false), tick: s.tick, movers: s.movers, moversDone: s.moversDone }
    t = run(t, 30, () => false, c)
    expect(t.rear.y).toBeLessThan(-mm(1000))
  })

  it('끼임: §5.2 한계 가까이 빠르게 도는 막대에도 crash, 죽는 순간 바퀴 깊이는 CRUSH_DEPTH + 이동 단계 하나의 막대 이동 이내', () => {
    const L = mm(1900)
    const a = (150 * Math.PI) / 180
    for (const w of [128, 160]) {
      const tip = Math.round((w * L * 2 * Math.PI) / TURN / SUBSTEPS) // 막대 끝의 이동 단계당 이동(160이면 ≈ 2490 < WHEEL_R)
      expect(tip).toBeLessThan(WHEEL_R)
      const bar = road([{ x0: 0, y0: 0, x1: Math.round(L * Math.cos(a)), y1: Math.round(L * Math.sin(a)) }], { k: 'rotate', a0: 0, w })
      const c = withRoads([[WHEELBASE + mm(1500), mm(300), bar]])
      let s = initSimAt(c, TPL_X, 0)
      let lowest = Infinity
      for (let i = 0; i < 100 && !s.dead; i++) {
        s = step(s, false, c)
        lowest = Math.min(lowest, s.front.y, s.rear.y)
      }
      expect(s.dead).toBe('crash')
      // 지면 y = 0, 쉬는 바퀴 중심 y = WHEEL_R. 깊이 = WHEEL_R − y.
      expect(WHEEL_R - lowest, `w ${w}`).toBeLessThanOrEqual(CRUSH_DEPTH + tip)
      expect(lowest, `w ${w}`).toBeGreaterThan(0) // 측정값: 이 배치에서는 중심이 지면 아래로 가지 않는다(가장 낮은 값 366, w = 128)
    }
  })

  it('Review Focus 1: 평지에 정지한 차 쪽으로 돌아 들어온 막대 길이 바퀴를 지면 쪽으로 밀면 바퀴가 지면 아래로 가지 않고 crash', () => {
    // 앞바퀴 1.5 m 앞, 지면 위 0.3 m(바퀴 지름보다 낮다)에 기준점. 거기서 뒤로 150° 방향 1.9 m 막대가 반시계로 돌며 내려온다.
    const L = mm(1900)
    const a = (150 * Math.PI) / 180
    const bar = road([{ x0: 0, y0: 0, x1: Math.round(L * Math.cos(a)), y1: Math.round(L * Math.sin(a)) }], { k: 'rotate', a0: 0, w: 16 })
    const c = withRoads([[WHEELBASE + mm(1500), mm(300), bar]])
    let s = initSimAt(c, TPL_X, 0)
    let lowest = Infinity
    for (let i = 0; i < 400 && !s.dead; i++) {
      s = step(s, false, c)
      lowest = Math.min(lowest, s.front.y, s.rear.y)
    }
    expect(s.dead).toBe('crash')
    expect(lowest).toBeGreaterThan(0) // 바퀴 중심이 지면(y = 0) 아래로 간 적이 없다
    // 막대가 닿기 전에는 끼임으로 죽지 않는다(차체 판정원이 아니라 끼임으로 죽었다: 차체는 막대 끝보다 뒤에 있다).
    expect(s.tick).toBeGreaterThan(15)
  })

  it('끼임 규칙은 고정 지형끼리는 걸지 않는다: 바퀴가 길 위에만 깊게 눌려도 crash 아님(길만 있는 곳)', () => {
    // 길이 위로 빠르게 올라와 차를 싣고 가도(바퀴가 길에만 닿음) 죽지 않는다.
    const up: Motion = { k: 'keys', keys: [{ t: 0, dx: 0, dy: 0, a: 0 }, { t: 20, dx: 0, dy: mm(3000), a: 0 }] }
    const c = withRoads([[mm(20000), mm(2000), flatRoad(mm(6000), up)]])
    const s = run(restOn(c, TPL_X + mm(22000), mm(2000)), 120, () => false, c)
    expect(s.dead).toBeNull()
  })

  it('움직이는 길 위 착지에서도 공중제비·퍼펙트가 정상 지급된다(평평한 swing 길)', () => {
    const c = withRoads([[mm(20000), mm(3000), flatRoad(mm(20000), SWING)]])
    // 길과 같은 속도로 떨어뜨린다(길이 차 밑에서 빠져나가지 않게).
    const s0 = airborne(c, TPL_X + mm(28000), mm(4000), 0, TURN, roadVx(SWING, -1))
    const s = run(s0, 150, () => false, c)
    expect(s.dead).toBeNull()
    expect(s.rear.y).toBe(mm(3000) + WHEEL_R)
    expect(s.lastAward).toMatchObject({ flips: 1, perfect: true, points: PERFECT_MULT })
    expect(s.progress).toBe(s0.progress) // 움직이는 길은 진행 번호를 바꾸지 않는다
  })

  it('고정 지형보다 FALL_DEPTH 넘게 낮은 움직이는 길 위에 선 차는 fall로 죽지 않는다(구간 바닥에 길이 들어간다)', () => {
    const c = withRoads([[mm(10000), -mm(9000), flatRoad(mm(20000), { k: 'swing', ax: 0, ay: -mm(1000), period: 120, phase: 0 })]])
    const s = run(restOn(c, TPL_X + mm(15000), -mm(9000)), 300, () => false, c)
    expect(s.dead).toBeNull()
    expect(s.rear.ground).toBe(true)
  })

  it('상태 크기: 끝난 길 기록은 MOVER_MEMORY까지만, 가장 오래된 것부터 버린다', () => {
    // 길이 1 m짜리 touch 길 12개를 깐 템플릿을 이어 붙인다. 밟으면 1틱 만에 끝나는(제자리) keys.
    const blip: Motion = { k: 'keys', keys: [{ t: 0, dx: 0, dy: 0, a: 0 }, { t: 1, dx: 0, dy: 0, a: 0 }] }
    const T: Template = {
      id: 'blips',
      tier: 1,
      prims: [
        ...Array.from({ length: 12 }, (_, k) => ({ t: 'mover' as const, dx: mm(1000 * k), dy: 0, m: flatRoad(mm(1000), blip, { k: 'touch', delay: 0 }) })),
        { t: 'line', dx: mm(12000), dy: 0 },
      ],
    }
    const c = courseFromTemplates([T])
    let s = initSim(c)
    let maxDone = 0
    for (let i = 0; i < 3000; i++) {
      s = step(s, true, c)
      maxDone = Math.max(maxDone, s.moversDone.length)
      expect(s.movers.length).toBeLessThanOrEqual(2)
    }
    expect(s.dead).toBeNull()
    expect(maxDone).toBe(MOVER_MEMORY)
    const done = s.moversDone
    expect(done[done.length - 1]).toBeGreaterThan(MOVER_MEMORY * 2) // 최근 것이 남았다
    expect(done.every((id, k) => k === 0 || id > done[k - 1])).toBe(true)
    expect(JSON.stringify(s).length).toBeLessThan(6000)
  }, 20000)
})

describe('넘어지는 블록', () => {
  type BlockPrim = { t: 'block'; dx: number; dy: number; b: BlockDef }
  // 템플릿 원점(TPL_X, 0)에서 dx만큼 앞 평지 위에 세운 w×h 블록.
  const blk = (dx: number, w: number, h: number, dy = 0): BlockPrim => ({ t: 'block', dx, dy, b: { x: 0, y: 0, w, h, a: 0 } })
  const withBlocks = (blocks: BlockPrim[], len = mm(400000)): Course =>
    courseFromTemplates([{ id: 'bk', tier: 1, prims: [...blocks, { t: 'line', dx: len, dy: 0 }] }])
  const P = (b: BlockState, i: number): [number, number] => [b.p[4 * i], b.p[4 * i + 1]]
  const tilt = (b: BlockState): number => angDiff(atan2T(b.p[5] - b.p[1], b.p[4] - b.p[0]), 0)
  const mid = (b: BlockState): [number, number] => [
    Math.floor((b.p[0] + b.p[4] + b.p[8] + b.p[12]) / 4),
    Math.floor((b.p[1] + b.p[5] + b.p[9] + b.p[13]) / 4),
  ]
  const deg = (d: number): number => Math.floor((d * TURN) / 360)
  // 점 (x, y)가 블록 b 안으로 들어간 깊이(밖이면 0 이하): 네 변(반시계)의 왼쪽 거리 중 가장 작은 값.
  const inside = (b: BlockState, x: number, y: number): number => {
    let d = Infinity
    for (let e = 0; e < 4; e++) {
      const [ax, ay] = P(b, e)
      const [bx, by] = P(b, (e + 1) % 4)
      d = Math.min(d, ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / Math.hypot(bx - ax, by - ay))
    }
    return d
  }
  const rodErr = (b: BlockState, w: number, h: number): number => {
    const L = [w, h, w, h, Math.hypot(w, h), Math.hypot(w, h)]
    const pairs = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [1, 3]]
    return Math.max(...pairs.map(([i, j], k) => Math.abs(Math.hypot(P(b, j)[0] - P(b, i)[0], P(b, j)[1] - P(b, i)[1]) - L[k]) / L[k]))
  }

  it('평지에 혼자 선 블록은 600틱 뒤에도 서 있다(기울기 < 2°, 위치 변화 < 5 mm)', () => {
    const c = withBlocks([blk(mm(20000), mm(500), mm(2000))])
    let s = initSimAt(c, TPL_X, 0)
    s = step(s, false, c)
    expect(s.blocks).toHaveLength(1) // 차 중심에서 BLOCK_WAKE 안이라 깼다
    const m0 = mid(s.blocks[0])
    s = run(s, 600, () => false, c)
    expect(s.blocks).toHaveLength(1)
    const b = s.blocks[0]
    expect(Math.abs(tilt(b))).toBeLessThan(deg(2))
    const [x, y] = mid(b)
    expect(Math.hypot(x - m0[0], y - m0[1])).toBeLessThan(mm(5))
  })

  it('BLOCK_WAKE 밖의 블록은 깨지 않는다(상태에 없다)', () => {
    const c = withBlocks([blk(BLOCK_WAKE + mm(5000), mm(500), mm(2000))])
    const s = run(initSimAt(c, TPL_X, 0), 30, () => false, c)
    expect(s.blocks).toEqual([])
  })

  it('차가 밀면 블록이 앞으로 움직인다(낮고 넓은 블록은 밀려 간다)', () => {
    const c = withBlocks([blk(mm(10000), mm(1000), mm(1000))])
    const s0 = step(initSimAt(c, TPL_X, 0), true, c)
    const x0 = mid(s0.blocks[0])[0]
    const s = run(s0, 300, () => true, c)
    expect(s.dead).toBeNull()
    expect(mid(s.blocks[0])[0] - x0).toBeGreaterThan(mm(2000))
  })

  it('키 큰 블록은 차가 밀면 넘어진다(각도 > 45°)', () => {
    const c = withBlocks([blk(mm(10000), mm(400), mm(3000))])
    let s = initSimAt(c, TPL_X, 0)
    let maxTilt = 0
    for (let i = 0; i < 300; i++) {
      s = step(s, true, c)
      if (s.blocks.length > 0) maxTilt = Math.max(maxTilt, Math.abs(tilt(s.blocks[0])))
    }
    expect(maxTilt).toBeGreaterThan(TURN / 8)
  })

  it('차체 판정원이 블록에 닿아도 죽지 않는다(같은 낙하를 땅에 하면 crash)', () => {
    const plain = courseFromTemplates([flatT])
    expect(run(airborne(plain, TPL_X + mm(9300), mm(1500), TURN / 2, 0), 200, () => false, plain).dead).toBe('crash')
    // 낮고 넓은 블록(4 m × 0.6 m) 위로 뒤집힌 차를 떨어뜨린다.
    const c = withBlocks([blk(mm(10000), mm(4000), mm(600))])
    let s = airborne(c, TPL_X + mm(9300), mm(1500), TURN / 2, 0)
    let touched = false
    for (let i = 0; i < 200; i++) {
      s = step(s, false, c)
      expect(s.dead).toBeNull()
      const top = Math.max(...[0, 1, 2, 3].map((k) => P(s.blocks[0], k)[1]))
      const hy = Math.floor((s.rear.y + s.front.y) / 2) - HEAD_OFFSET // 뒤집힌 차의 판정원 중심(축 아래)
      if (hy - HEAD_R <= top + GROUND_TOL) touched = true
    }
    expect(touched).toBe(true)
  })

  it('블록끼리 겹치지 않는다: 밀린 블록이 다음 블록에 부딪혀도 꼭짓점이 상대 안으로 1 mm 넘게 들어가지 않는다', () => {
    const c = withBlocks([blk(mm(8000), mm(400), mm(2500)), blk(mm(9800), mm(400), mm(2500))])
    let s = initSimAt(c, TPL_X, 0)
    let b0: BlockState | null = null
    let b1: BlockState | null = null
    for (let i = 0; i < 400; i++) {
      s = step(s, true, c)
      if (s.blocks.length < 2) continue
      b0 ??= s.blocks[1]
      b1 = s.blocks[1]
      const [a, b] = s.blocks
      for (let k = 0; k < 4; k++) {
        expect(inside(b, ...P(a, k)), `tick ${s.tick} A${k}`).toBeLessThanOrEqual(mm(1))
        expect(inside(a, ...P(b, k)), `tick ${s.tick} B${k}`).toBeLessThanOrEqual(mm(1))
      }
    }
    // 뒤 블록이 실제로 맞았다(움직였거나 기울었다). 차가 멀어지면 앞 블록이 먼저 끝나므로 둘 다 있던 마지막 틱으로 본다.
    if (!b0 || !b1) throw new Error('블록 둘이 함께 깨어 있던 틱이 없다')
    expect(Math.abs(tilt(b1)) > deg(5) || Math.abs(mid(b1)[0] - mid(b0)[0]) > mm(200)).toBe(true)
  })

  it('높이가 같은 블록을 줄지어 밀어도 서로 뚫고 지나가지 않는다(면끼리 맞닿음, 둥근 모서리 원)', () => {
    // 꼭짓점이 상대의 위·아래 변 위를 스치기만 해 꼭짓점 판정만으로는 겹침을 못 찾던 배치.
    const c = withBlocks([blk(mm(8000), mm(500), mm(1500)), blk(mm(9500), mm(500), mm(1500)), blk(mm(11000), mm(500), mm(1500))])
    let s = initSimAt(c, TPL_X, 0)
    for (let i = 0; i < 400; i++) {
      s = step(s, true, c)
      for (const a of s.blocks) {
        for (const b of s.blocks) {
          if (a === b) continue
          for (let k = 0; k < 4; k++) expect(inside(b, ...P(a, k)), `tick ${s.tick} ${a.id}→${b.id}`).toBeLessThanOrEqual(mm(1))
        }
      }
    }
    const xs = s.blocks.map((b) => mid(b)[0])
    for (let k = 1; k < xs.length; k++) expect(xs[k] - xs[k - 1]).toBeGreaterThanOrEqual(mm(499)) // 순서와 간격이 남는다
  })

  it('넘어진 블록이 차 위로 떨어져도 바퀴가 땅에 박혀 끼임으로 죽지 않는다(블록은 질량비로만 민다)', () => {
    const c = withBlocks([blk(mm(10000), mm(400), mm(3000))])
    let s = initSimAt(c, TPL_X, V_MAX)
    let low = Infinity
    let maxTilt = 0
    for (let i = 0; i < 200; i++) {
      s = step(s, true, c)
      expect(s.dead, `tick ${s.tick}`).toBeNull()
      low = Math.min(low, s.rear.y, s.front.y)
      if (s.blocks.length > 0) maxTilt = Math.max(maxTilt, Math.abs(tilt(s.blocks[0])))
    }
    expect(maxTilt).toBeGreaterThan(TURN / 8)
    expect(low).toBeGreaterThan(WHEEL_R - mm(20))
  })

  it('블록 위에 올라탄 바퀴는 접지로 치고, 누르면 구동한다', () => {
    const c = withBlocks([blk(mm(10000), mm(8000), mm(600))])
    const y = mm(600) + WHEEL_R
    const x = TPL_X + mm(7000)
    let s: SimState = { ...initSimAt(c, TPL_X, 0), rear: { x, y, px: x, py: y, ground: true }, front: { x: x + WHEELBASE, y, px: x + WHEELBASE, py: y, ground: true } }
    for (let i = 0; i < 20; i++) {
      s = step(s, true, c)
      expect(s.dead).toBeNull()
      expect(s.rear.ground && s.front.ground, `tick ${s.tick}`).toBe(true)
      expect(Math.abs(s.rear.y - y)).toBeLessThan(mm(20)) // 블록 위에 남는다
    }
    expect(speed(s)).toBeGreaterThan(15 * DRIVE_ACC)
  })

  it('결정성·정수, 막대 길이 오차 < 2%: 블록 셋을 임의 입력으로 600틱(5개 시드)', () => {
    const dims: [number, number][] = [[mm(400), mm(3000)], [mm(1000), mm(1000)], [mm(600), mm(2000)]]
    const make = (): Course => withBlocks([blk(mm(8000), ...dims[0]), blk(mm(12000), ...dims[1]), blk(mm(16000), ...dims[2])])
    for (const seed of [1, 2, 3, 4, 5]) {
      const c1 = make()
      const c2 = make()
      const a = run(initSimAt(c1, TPL_X, 0), 600, randomInput(seed), c1)
      const b = run(initSimAt(c2, TPL_X, 0), 600, randomInput(seed), c2)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
      let s = initSimAt(c1, TPL_X, 0)
      const inp = randomInput(seed)
      let worst = 0
      for (let i = 0; i < 600 && !s.dead; i++) {
        s = step(s, inp(s, i), c1)
        expect(allIntegers(s)).toBeNull()
        for (const bs of s.blocks) worst = Math.max(worst, rodErr(bs, ...dims[bs.id % 3]))
      }
      expect(worst, `seed ${seed}`).toBeLessThan(0.02)
    }
  }, 30000)

  it('끝난 블록: 차 뒤로 BLOCK_WAKE보다 멀어지면 blocksDone으로 옮기고 다시 깨우지 않는다', () => {
    const c = withBlocks([blk(mm(10000), mm(500), mm(2000))])
    const s0 = step(initSimAt(c, TPL_X, 0), false, c)
    expect(s0.blocks.map((b) => b.id)).toEqual([0])
    const far = initSimAt(c, TPL_X + mm(10000) + BLOCK_WAKE + mm(2000), 0)
    const s1 = step({ ...far, blocks: s0.blocks }, false, c)
    expect(s1.blocks).toEqual([])
    expect(s1.blocksDone).toEqual([0])
    const back = initSimAt(c, TPL_X, 0)
    expect(step({ ...back, blocksDone: [0] }, false, c).blocks).toEqual([])
  })

  it('Review Focus 4: 블록 8개가 한꺼번에 깨어 있는 템플릿 600틱 동안 상태 JSON ≤ 6000자', () => {
    // 블록 8개(1.5 m 간격)가 10 m 안에 있고, 그 뒤 평지가 길어 다음 반복의 블록은 BLOCK_WAKE 밖이다.
    const c = withBlocks(Array.from({ length: 8 }, (_, k) => blk(mm(8000 + 1500 * k), mm(500), mm(1500))), mm(80000))
    let s = initSimAt(c, TPL_X, 0)
    let most = 0
    let longest = 0
    for (let i = 0; i < 600; i++) {
      s = step(s, i % 120 < 90, c)
      most = Math.max(most, s.blocks.length)
      longest = Math.max(longest, JSON.stringify(s).length)
    }
    expect(most).toBe(8)
    expect(longest).toBeLessThanOrEqual(6000)
  }, 20000)

  it('Review Focus 4: 20000틱 판에서 blocksDone ≤ BLOCK_MEMORY(가장 오래된 것부터 버린다)', () => {
    // 길 아래 허공에 놓인 블록 4개: 떨어져 코스 바닥 − FALL_DEPTH 아래로 가거나 차 뒤로 멀어지면 끝난다.
    const c = withBlocks(Array.from({ length: 4 }, (_, k) => blk(mm(3000 * k), mm(500), mm(1000), -mm(3000))), mm(12000))
    let s = initSim(c)
    let maxDone = 0
    for (let i = 0; i < 20000; i++) {
      s = step(s, true, c)
      maxDone = Math.max(maxDone, s.blocksDone.length)
    }
    expect(s.dead).toBeNull()
    expect(maxDone).toBe(BLOCK_MEMORY)
    const done = s.blocksDone
    expect(done[done.length - 1]).toBeGreaterThan(BLOCK_MEMORY * 4) // 최근 것이 남았다
    expect(done.every((id, k) => k === 0 || id > done[k - 1])).toBe(true)
    expect(JSON.stringify(s).length).toBeLessThan(6000)
  }, 60000)
})

import { describe, expect, it } from 'vitest'
import {
  AIR_SPIN_KEEP,
  BOOST_V,
  COLLIDE_WINDOW,
  FALL_DEPTH,
  G,
  GROUND_TOL,
  LAND_GRACE,
  MM,
  PERFECT_MULT,
  PERFECT_TOL,
  REST_LEN,
  START_LEN,
  V_MAX,
  V_TERMINAL,
  WHEELBASE,
  WHEELIE_ACC,
  WHEEL_R,
} from './constants.ts'
import { collideWheel, windowCands } from './collide.ts'
import { courseFromTemplates, courseOf } from './course.ts'
import type { Course } from './course.ts'
import type { Template } from './pieces.ts'
import { bodyAngle, initSim, initSimAt, scoreOf, step } from './sim.ts'
import type { SimState, Wheel } from './sim.ts'
import { TRIG_ONE, TURN, angDiff, cosT, isqrt, sinT } from './trig.ts'

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
    expect(omega(prev, a)).toBeGreaterThanOrEqual(66) // SPIN_MAX 근처
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
    // 뗀 뒤에도 (SPIN_MAX - AIR_SPIN_KEEP) × AIR_SPIN_DAMP ≈ 180만큼 더 돌고, 그 뒤 AIR_SPIN_KEEP으로 계속 돈다.
    let firstTouch = -1
    let releasedAt: number | null = null
    for (let i = 0; i < 600 && !s.dead && !s.lastAward; i++) {
      const hold = s.airAngle !== null && s.pending === null && s.airAngle < TURN - 200
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

  it('코스 시작점 뒤로 되굴러가도 길이 있다: hill 오르막 중간에 떼면 x = 0 뒤로 가지만 3000틱 뒤에도 살아 있다', () => {
    for (const release of [100, 150, 190]) {
      const c = courseOf(['hill'])
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
    // ramp의 틈(템플릿 x 11.5~19.5 m) 한가운데에 멈춘 채로 둔다. 틈 뒤 내리막 시작 높이에서 떨어지기 시작한다.
    const s = run(airborne(c, TPL_X + mm(15500), 0, 0, 0), 600, () => false, c)
    expect(s.dead).toBe('fall')
    expect(Math.floor((s.rear.y + s.front.y) / 2)).toBeLessThan(c.section(0).minY - FALL_DEPTH)
  })

  it('Review Focus 4: 20000틱 뒤 takenGems ≤ 64, 상태 JSON < 2000자', () => {
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
    expect(JSON.stringify(s).length).toBeLessThan(2000)
  }, 20000)
})

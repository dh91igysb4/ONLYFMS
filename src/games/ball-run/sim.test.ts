import { describe, expect, it } from 'vitest'
import { G, R, SPEED_STEP_DIST, SPEED_TABLE, V0, VX_MAX, X_LIMIT } from './constants.ts'
import { courseFromSegments, getCourse } from './course.ts'
import type { Course } from './course.ts'
import { JOINT, parseSegment } from './segments.ts'
import { colOf, floorAt, initSim, rowOf, step } from './sim.ts'
import type { SimState } from './sim.ts'

const J = JOINT
const F = '_______'
const rep = (row: string, n: number): string[] => new Array<string>(n).fill(row)
const course = (...rows: string[]): Course =>
  courseFromSegments([{ seg: parseSegment({ id: 'test', kind: 'obstacle', tier: 1, rows }), mirrored: false }])
const straight = (): Course => course(...rep(J, 200))

// target은 고정값 또는 상태를 보고 정하는 함수. dead가 되거나 n틱이 지나면 멈춘다.
function run(c: Course, n: number, target: number | ((s: SimState) => number), s0: SimState = initSim()): SimState[] {
  const out: SimState[] = []
  let s = s0
  for (let i = 0; i < n && s.dead === null; i++) {
    s = step(s, typeof target === 'number' ? target : target(s), c)
    out.push(s)
  }
  return out
}
const last = <T>(a: T[]): T => a[a.length - 1]

describe('ball-run sim', () => {
  it('helpers', () => {
    expect(colOf(0)).toBe(0)
    expect(colOf(-500)).toBe(0)
    expect(colOf(-501)).toBe(-1)
    expect(colOf(499)).toBe(0)
    expect(colOf(500)).toBe(1)
    expect(rowOf(0)).toBe(0)
    expect(rowOf(999)).toBe(0)
    expect(rowOf(-1)).toBe(-1)
    const c = course(J, '///////', J)
    expect(floorAt(c, 0, 1000)).toBe(0)
    expect(floorAt(c, 0, 1500)).toBe(125)
    expect(floorAt(c, 0, 1999)).toBe(249)
    expect(floorAt(c, 0, 2000)).toBe(250)
    expect(floorAt(c, -3000, 0)).toBeNull()
  })

  it('initSim', () => {
    expect(initSim()).toEqual({
      tick: 0, x: 0, y: R, z: 0, vy: 0, vz: V0, grounded: true, lastFloor: 0, speedLevel: 0, dead: null,
    })
    expect(initSim({ speedLevel: 3 }).vz).toBe(SPEED_TABLE[3])
    expect(initSim({ speedLevel: 99 }).vz).toBe(SPEED_TABLE[SPEED_TABLE.length - 1])
  })

  it('moves forward at V0', () => {
    const s = last(run(straight(), 60, 0))
    expect(s.tick).toBe(60)
    expect(s.z).toBe(60 * V0)
    expect(s.y).toBe(R)
    expect(s.dead).toBeNull()
  })

  it('lateral speed is capped', () => {
    const c = course(J, ...rep(F, 60), J)
    const states = run(c, 30, 3000)
    expect(states[0].x).toBe(VX_MAX)
    expect(states[29].x).toBe(Math.min(3000, 30 * VX_MAX))
    expect(states[29].dead).toBeNull()
  })

  it('both track edges are symmetric', () => {
    // colOf(3500) = 4 (트랙 밖)이므로 오른쪽 끝은 X_LIMIT - 1까지만 간다.
    const c = course(J, ...rep(F, 60), J)
    const right = run(c, 200, X_LIMIT)
    expect(right).toHaveLength(200)
    expect(last(right).dead).toBeNull()
    expect(last(right).x).toBe(X_LIMIT - 1)
    const left = run(c, 200, -X_LIMIT)
    expect(left).toHaveLength(200)
    expect(last(left).dead).toBeNull()
    expect(last(left).x).toBe(-X_LIMIT)
    expect(colOf(X_LIMIT - 1)).toBe(3)
    expect(colOf(-X_LIMIT)).toBe(-3)
  })

  it('side wall blocks', () => {
    // 왼쪽 두 열(col -2, -1)만 오르막 4행 -> 1 m 높은 평지 6행 -> 내리막 4행.
    const c = course(J, ...rep(F, 2), ...rep('_//____', 4), ...rep(F, 6), ...rep('_\\\\____', 4), ...rep(F, 2), J)
    // 높은 평지 구간(row 7..12)에 들어선 뒤 왼쪽으로 민다.
    const states = run(c, 60, (s) => (s.z >= 7000 ? -2000 : 0))
    expect(states).toHaveLength(60)
    expect(last(states).z).toBeLessThan(13000)
    for (const s of states) {
      expect(colOf(s.x)).toBe(0)
      expect(s.dead).toBeNull()
    }
    expect(last(states).x).toBe(-4 * VX_MAX)
  })

  it('frontal block kills', () => {
    const c = course(J, ...rep(F, 4), ...rep('___B___', 2), ...rep(F, 5), J)
    const s = last(run(c, 60, 0))
    expect(s.dead).toBe('hit')
    expect(s.z).toBeLessThan(5000)
  })

  it('grazing a block', () => {
    const c = course(J, ...rep(F, 4), ...rep('____B__', 2), ...rep(F, 10), J)
    const safe = 1000 - 500 - R - 1
    const a = run(c, 80, safe)
    expect(a).toHaveLength(80)
    expect(last(a).x).toBe(safe)
    expect(last(a).dead).toBeNull()
    expect(last(a).z).toBeGreaterThan(7000 + R)
    const b = last(run(c, 80, safe + 2))
    expect(b.x).toBe(safe + 2)
    expect(b.dead).toBe('hit')
    // 거리 정확히 R이면 겹침 아님(엄격한 <).
    expect(last(run(c, 80, safe + 1)).dead).toBeNull()
  })

  it('cannot pop up onto a ledge from below', () => {
    // 빠른 공(vz 467 > R)이 구멍 속 깊이(바닥 -400)에서 한 틱에 앞끝·중심이 함께 턱을 넘는 경우: 착지가 아니라 정면 충돌.
    const c = course(J, ...rep('_....._', 3), ...rep(F, 10), J)
    const s0: SimState = { ...initSim({ speedLevel: 14 }), z: 3550, y: R - 400, vy: -10, grounded: false }
    expect(floorAt(c, 0, s0.z + R)).toBeNull()
    const s = step(s0, 0, c)
    expect(floorAt(c, 0, s.z)).toBe(0)
    expect(s.dead).toBe('hit')
    // 같은 상황에서 바닥 -100(허용치 안)이면 착지.
    const ok = step({ ...s0, y: R - 100 }, 0, c)
    expect(ok.dead).toBeNull()
    expect(ok.grounded).toBe(true)
    expect(ok.y).toBe(R)
  })

  it('hole kills by falling', () => {
    const c = course(J, ...rep(F, 3), ...rep('_....._', 10), ...rep(F, 5), J)
    const states = run(c, 200, 0)
    const end = last(states)
    expect(end.dead).toBe('fall')
    const before = states.filter((s) => s.z >= 4000 && s !== end)
    expect(before.length).toBeGreaterThan(5)
    for (const s of before) expect(s.grounded).toBe(false)
    expect(end.z).toBeLessThan(14000)
  })

  it('follows ramps', () => {
    const c = course(J, ...rep(F, 3), ...rep('///////', 4), ...rep(F, 10), J)
    const states = run(c, 80, 0)
    expect(states).toHaveLength(80)
    for (const s of states) {
      expect(s.grounded).toBe(true)
      expect(s.dead).toBeNull()
    }
    expect(last(states).z).toBeGreaterThan(8000)
    expect(last(states).y - R).toBe(1000)
  })

  it('jumps off a ramp crest and lands', () => {
    // 가운데 5칸 오르막 6행(1500 mm) + 구멍 1행 + 평지. 구멍은 열 높이를 유지하므로 착지 높이 1500.
    const c = course(J, ...rep(F, 4), ...rep('_/////_', 6), '_....._', ...rep(F, 18), J)
    const states = run(c, 120, 0)
    expect(states).toHaveLength(120)
    const overHole = states.filter((s) => rowOf(s.z) === 11)
    expect(overHole.length).toBeGreaterThan(0)
    for (const s of overHole) expect(s.grounded).toBe(false)
    // 크레스트를 떠날 때 위로 솟는다. 떠나는 틱에 직전 vy를 이어받고 바로 중력을 받는다.
    expect(Math.max(...overHole.map((s) => s.y))).toBeGreaterThan(1500 + R)
    const leave = states.findIndex((s) => !s.grounded)
    expect(states[leave - 1].vy).toBeGreaterThan(0)
    expect(states[leave].vy).toBe(states[leave - 1].vy - G)
    expect(states[leave].y).toBe(states[leave - 1].y + states[leave].vy)
    const landed = states.findIndex((s) => s.z >= 12000 && s.grounded)
    expect(landed).toBeGreaterThan(0)
    expect(states[landed].y - R).toBe(1500)
    expect(states[landed].lastFloor).toBe(1500)
    for (const s of states) expect(s.dead).toBeNull()
    expect(last(states).y - R).toBe(1500)
  })

  it('speed steps up', () => {
    const c = courseFromSegments([])
    const states = run(c, 2000, 0, initSim())
    const i = states.findIndex((s) => s.z >= SPEED_STEP_DIST)
    expect(i).toBeGreaterThan(0)
    expect(states[i - 1].speedLevel).toBe(0)
    expect(states[i - 1].vz).toBe(SPEED_TABLE[0])
    expect(states[i].speedLevel).toBe(1)
    expect(states[i].vz).toBe(SPEED_TABLE[1])
    expect(states[i + 1].z - states[i].z).toBe(SPEED_TABLE[1])
  })

  it('dead state is frozen', () => {
    const c = course(J, ...rep(F, 4), ...rep('___B___', 2), ...rep(F, 5), J)
    const dead = last(run(c, 60, 0))
    expect(dead.dead).toBe('hit')
    const copy = { ...dead }
    const next = step(dead, 3000, c)
    expect(next).toEqual(copy)
    expect(step(next, -3000, c)).toEqual(copy)
    const gaveUp: SimState = { ...initSim(), dead: 'give_up' }
    expect(step(gaveUp, 0, c)).toEqual(gaveUp)
  })

  it('all values stay integers', () => {
    const seeds = Array.from({ length: 20 }, (_, n) => n.toString(16).padStart(2, '0').repeat(16))
    for (const seed of ['0123456789abcdef0123456789abcdef', ...seeds]) {
      const c = getCourse(seed)
      let s = initSim()
      for (let t = 0; t < 10000 && s.dead === null; t++) {
        s = step(s, ((t * 7919) % 7000) - 3500, c)
        for (const [k, v] of Object.entries(s)) {
          if (typeof v === 'number') expect(Number.isInteger(v), `${k}=${v} at tick ${s.tick}`).toBe(true)
        }
      }
      expect(s.tick).toBeGreaterThan(0)
    }
  })

  it('is deterministic', () => {
    const seed = '00112233445566778899aabbccddeeff'
    const go = () => {
      const c = getCourse(seed)
      let s = initSim()
      for (let t = 0; t < 3000 && s.dead === null; t++) s = step(s, ((t * 31) % 4000) - 2000, c)
      return s
    }
    expect(go()).toEqual(go())
  })
})

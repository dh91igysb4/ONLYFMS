import { describe, expect, it } from 'vitest'
import {
  BANK_DRIFT, BLOCK_H, G, GATE_H, KEY_STEP, LAT_ACC, PILLAR_H, R, SPEED_TABLE, V0, VX_MAX, X_LIMIT,
} from './constants.ts'
import { courseFromSegments, getCourse } from './course.ts'
import type { Course } from './course.ts'
import { JOINT, START_PARSED, parseSegment } from './segments.ts'
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
      tick: 0, x: 0, vx: 0, drift: 0, y: R, z: 0, vy: 0, vz: V0, grounded: true, lastFloor: 0, speedLevel: 0, dead: null,
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
    const states = run(c, 60, 3000)
    let prev = initSim()
    for (const s of states) {
      expect(Math.abs(s.vx)).toBeLessThanOrEqual(VX_MAX)
      expect(Math.abs(s.vx - prev.vx)).toBeLessThanOrEqual(LAT_ACC)
      expect(s.x - prev.x).toBe(s.vx)
      prev = s
    }
    expect(states.filter((s) => s.vx === VX_MAX).length).toBeGreaterThan(10)
    expect(last(states).dead).toBeNull()
  })

  it('lateral eases in', () => {
    const c = course(J, ...rep(F, 60), J)
    const states = run(c, 60, 3000)
    expect(states[0].vx).toBe(LAT_ACC)
    expect(states[0].x).toBe(LAT_ACC)
    expect(states.slice(0, 5).some((s) => s.vx === VX_MAX)).toBe(true)
    for (const s of states) expect(s.x).toBeLessThanOrEqual(3000)
    // 목표 근처에서 감속해 멈춘다(넘어가거나 흔들리지 않음).
    const end = last(states)
    expect(Math.abs(end.x - 3000)).toBeLessThan(50)
    const more = run(c, 30, 3000, end)
    for (const s of more) {
      expect(s.vx).toBe(0)
      expect(s.x).toBe(more[0].x)
    }
    // 반대 방향도 같은 방식으로 멈춘다.
    const left = run(c, 60, -3000)
    for (const s of left) expect(s.x).toBeGreaterThanOrEqual(-3000)
    expect(Math.abs(last(left).x + 3000)).toBeLessThan(50)
  })

  // 기운 판 밀림은 쌓이는 drift(설계 v2 §2.1): 판 위 한 틱마다 drift += bank × BANK_DRIFT, 줄지 않는다.
  // 실효 목표 = clampX(target + drift). 3칸 판 가운데에서 손을 떼면 6행 안에 판 밖으로 밀려난다.
  const plank = (ch: string, n: number, after = 12): Course =>
    course(J, ...rep('..___..', 4), ...rep(`..${ch.repeat(3)}..`, n), ...rep('..___..', after), J)
  const RUN0 = 5 // 기운 판 첫 행

  it('bank drift: a hands-off ball slides off a 3-wide plank within a 6-row run (speed 1)', () => {
    const c = plank('>', 6)
    const states = run(c, 200, 0, initSim({ speedLevel: 1 }))
    const off = states.findIndex((s) => s.dead === 'fall' || colOf(s.x) > 1)
    expect(off, 'never left the plank').toBeGreaterThan(0)
    expect(rowOf(states[off].z), `left at row ${rowOf(states[off].z)}`).toBeLessThanOrEqual(RUN0 + 5)
    expect(last(states).dead).toBe('fall')
    // 판 위에서 drift는 틱마다 BANK_DRIFT씩 쌓이고, 판 전에는 0이다.
    for (let i = 1; i < states.length; i++) {
      const d = states[i].drift - states[i - 1].drift
      expect([0, BANK_DRIFT]).toContain(d)
    }
    for (const s of states.filter((s) => rowOf(s.z) < RUN0)) expect(s.drift).toBe(0)
    expect(states.some((s) => s.drift > 0)).toBe(true)
  })

  it('bank drift: steering uphill as fast as the push holds the ball on the plank', () => {
    for (const [speedLevel, n] of [[1, 6], [1, 8], [8, 8], [16, 8]]) {
      const c = plank('>', n)
      // 판 위에 있는 틱마다 손가락을 위쪽(왼쪽)으로 BANK_DRIFT만큼 옮긴다(키보드 KEY_STEP보다 느리다).
      let tgt = 0
      const states = run(c, 400, (s) => {
        if (rowOf(s.z) >= RUN0 && rowOf(s.z) < RUN0 + n) tgt -= BANK_DRIFT
        return tgt
      }, initSim({ speedLevel }))
      const where = `speed ${speedLevel} rows ${n}`
      for (const s of states) {
        expect(s.dead, where).toBeNull()
        expect(Math.abs(s.x), `${where} x=${s.x} at row ${rowOf(s.z)}`).toBeLessThan(500)
      }
      expect(Math.abs(tgt)).toBeLessThanOrEqual(X_LIMIT)
    }
    expect(BANK_DRIFT).toBeLessThan(KEY_STEP)
  })

  it('bank drift does not decay after the plank and is zero on flat ground', () => {
    const flat = run(course(J, ...rep(F, 60), J), 200, (s) => ((s.tick * 977) % 6000) - 3000)
    for (const s of flat) expect(s.drift).toBe(0)
    const c = course(J, ...rep(F, 4), ...rep('.<<<<<.', 3), ...rep(F, 30), J)
    const states = run(c, 200, 0)
    for (const s of states) expect(s.dead).toBeNull()
    const exit = states.findIndex((s) => rowOf(s.z) >= RUN0 + 3)
    const d = states[exit].drift
    expect(d).toBeLessThan(0)
    // 판을 지난 뒤 drift는 그대로이고, 공은 실효 목표(0 + drift)에 멈춘다(되돌아오지 않는다).
    for (const s of states.slice(exit)) expect(s.drift).toBe(d)
    const end = last(states)
    expect(Math.abs(end.x - d)).toBeLessThan(5)
    expect(end.vx).toBe(0)
  })

  it('bank drift is mirrored, integer and clamped', () => {
    const rows = [J, ...rep('..___..', 4), ...rep('..<<<..', 5), ...rep('..___..', 20), J]
    const seg = parseSegment({ id: 'm', kind: 'obstacle', tier: 1, rows })
    const a = run(courseFromSegments([{ seg, mirrored: false }]), 150, 0)
    const b = run(courseFromSegments([{ seg, mirrored: true }]), 150, 0)
    expect(b.map((s) => [0 - s.x, 0 - s.drift])).toEqual(a.map((s) => [s.x, s.drift]))
    for (const s of a) expect(Number.isInteger(s.drift)).toBe(true)
    expect(a.some((s) => s.drift < 0)).toBe(true)
    // ±2·X_LIMIT에서 멈춘다.
    const onPlank = { ...initSim(), z: RUN0 * 1000 + 100 }
    expect(step({ ...onPlank, drift: -2 * X_LIMIT + 1 }, 0, plank('<', 6)).drift).toBe(-2 * X_LIMIT)
    expect(step({ ...onPlank, drift: 2 * X_LIMIT - 1 }, 0, plank('>', 6)).drift).toBe(2 * X_LIMIT)
  })

  it('bank does not push in the air', () => {
    // 오르막 6행 + 구멍 1행으로 뜬 뒤 기운 판 위를 지나간다. 공중에서는 밀리지 않는다.
    const c = course(J, ...rep(F, 4), ...rep('_/////_', 6), '_....._', ...rep('_<<<<<_', 4), ...rep(F, 18), J)
    const states = run(c, 120, (s) => s.x)
    const airOnBank = states.filter((s, i) => i > 0 && !states[i - 1].grounded && rowOf(s.z) >= 12 && rowOf(s.z) <= 15)
    expect(airOnBank.length).toBeGreaterThan(0)
    for (const s of airOnBank) {
      expect(s.x).toBe(0)
      expect(s.drift).toBe(0)
    }
    for (const s of states) expect(s.dead).toBeNull()
  })

  it('both track edges are symmetric', () => {
    // colOf(3500) = 4 (트랙 밖)이므로 오른쪽 끝은 X_LIMIT - 1까지만 간다.
    const c = course(J, ...rep(F, 60), J)
    const right = run(c, 200, X_LIMIT)
    expect(right).toHaveLength(200)
    expect(last(right).dead).toBeNull()
    expect(last(right).x).toBeGreaterThan(X_LIMIT - 10)
    for (const s of right) expect(s.x).toBeLessThanOrEqual(X_LIMIT - 1)
    const left = run(c, 200, -X_LIMIT)
    expect(left).toHaveLength(200)
    expect(last(left).dead).toBeNull()
    expect(last(left).x).toBeLessThan(-X_LIMIT + 10)
    for (const s of left) expect(s.x).toBeGreaterThanOrEqual(-X_LIMIT)
    // 0 쪽으로 버림이라 좌우 대칭: X_LIMIT - 1 끝 제한에 닿기 전까지는 반대 방향이 정확히 거울상이다.
    expect(run(c, 200, 3000).map((s) => -s.x)).toEqual(run(c, 200, -3000).map((s) => s.x))
    // 최고 속도로 끝에 닿아도 [-X_LIMIT, X_LIMIT - 1] 안에서 멈춘다.
    const r1 = step({ ...initSim(), x: X_LIMIT - 50, vx: VX_MAX }, X_LIMIT, c)
    expect(r1.x).toBe(X_LIMIT - 1)
    const l1 = step({ ...initSim(), x: -X_LIMIT + 50, vx: -VX_MAX }, -X_LIMIT, c)
    expect(l1.x).toBe(-X_LIMIT)
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
    // 관성으로 -25, -50, -75, -100, -117, -117 움직인 뒤 다음 열 경계(-501)에서 막힌다. 막히면 vx = 0.
    expect(last(states).x).toBe(-484)
    const blocked = states.filter((s, i) => i > 0 && s.x === states[i - 1].x && states[i - 1].vx !== 0 && s.z >= 7000)
    for (const s of blocked) expect(s.vx).toBe(0)
    expect(states.some((s) => s.x === -484 && s.vx === 0)).toBe(true)
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
    // 목표보다 최대 LAT_K - 1 mm 모자라게 멈출 수 있어 공 위치를 직접 정해 둔다.
    const at = (x: number): SimState => ({ ...initSim(), x })
    const a = run(c, 80, safe, at(safe))
    expect(a).toHaveLength(80)
    expect(last(a).x).toBe(safe)
    expect(last(a).dead).toBeNull()
    expect(last(a).z).toBeGreaterThan(7000 + R)
    const b = last(run(c, 80, safe + 2, at(safe + 2)))
    expect(b.x).toBe(safe + 2)
    expect(b.dead).toBe('hit')
    // 거리 정확히 R이면 겹침 아님(엄격한 <).
    expect(last(run(c, 80, safe + 1, at(safe + 1))).dead).toBeNull()
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

  it('speed rises at tunnels, start tunnel does not count', () => {
    const obst = parseSegment({ id: 'o', kind: 'obstacle', tier: 1, rows: [J, ...rep(F, 30), J] })
    const c = courseFromSegments([
      { seg: START_PARSED, mirrored: false }, { seg: obst, mirrored: false },
      { seg: START_PARSED, mirrored: false }, { seg: obst, mirrored: false },
    ])
    const t2 = START_PARSED.length + obst.length
    expect(c.segmentAt(t2).kind).toBe('tunnel')
    const states = run(c, 2000, 0)
    const i = states.findIndex((s) => rowOf(s.z) >= t2)
    expect(i).toBeGreaterThan(0)
    for (const s of states.slice(0, i)) {
      expect(s.speedLevel).toBe(0)
      expect(s.vz).toBe(SPEED_TABLE[0])
    }
    expect(states[i].speedLevel).toBe(1)
    expect(states[i].vz).toBe(SPEED_TABLE[1])
    // 이번 틱은 V0로 왔고, 다음 틱부터 빨라진다.
    expect(states[i].z - states[i - 1].z).toBe(SPEED_TABLE[0])
    expect(states[i + 1].z - states[i].z).toBe(SPEED_TABLE[1])
    expect(last(states).speedLevel).toBe(1)
    // 이미 더 빠른 단계면 낮추지 않는다.
    expect(step(initSim({ speedLevel: 5 }), 0, c).speedLevel).toBe(5)
  })

  it('drops down a ledge and lands alive', () => {
    const c = course(J, ...rep(F, 5), '.vvvvv.', ...rep(F, 10), J)
    const states = run(c, 120, 0)
    expect(states).toHaveLength(120)
    for (const s of states) expect(s.dead).toBeNull()
    const onLedge = states.filter((s) => rowOf(s.z) === 6)
    expect(onLedge.length).toBeGreaterThan(0)
    for (const s of onLedge) expect(s.grounded).toBe(false)
    const landed = states.findIndex((s) => rowOf(s.z) > 6 && s.grounded)
    expect(landed).toBeGreaterThan(0)
    expect(states[landed].y - R).toBe(-1000)
    expect(states[landed].lastFloor).toBe(-1000)
    expect(last(states).y - R).toBe(-1000)
    expect(last(states).grounded).toBe(true)
  })

  it('stays grounded on steep at top speed', () => {
    const c = course(J, ...rep(F, 4), ...rep('!!!!!!!', 8), ...rep(F, 10), J)
    const states = run(c, 60, 0, initSim({ speedLevel: SPEED_TABLE.length - 1 }))
    expect(states).toHaveLength(60)
    expect(last(states).z).toBeGreaterThan(14000)
    for (const s of states) {
      expect(s.grounded).toBe(true)
      expect(s.dead).toBeNull()
    }
    expect(last(states).y - R).toBe(-4000)
  })

  it('pillar is tall', () => {
    const p = course(J, ...rep(F, 4), '___P___', ...rep(F, 5), J)
    expect(last(run(p, 60, 0)).dead).toBe('hit')
    // 오르막 6행 + 구멍 1행으로 뛰어도 기둥은 못 넘는다.
    const jump = course(J, ...rep(F, 4), ...rep('_/////_', 6), '_....._', '___P___', ...rep(F, 18), J)
    const js = run(jump, 120, 0)
    expect(last(js).dead).toBe('hit')
    expect(rowOf(last(js).z + R)).toBe(12)
    // 블록 높이는 칸의 blockH: 바닥 위 1.2 m로 지나가면 블록(1 m)·문 기둥(1 m, 위 가로대는 화면용)은 넘고 기둥(3 m)에는 걸린다.
    const over = (row: string) => {
      const c = course(J, ...rep(F, 4), row, ...rep(F, 5), J)
      return step({ ...initSim(), z: 5000 - R - 100, y: R + BLOCK_H + 200, vy: 0, grounded: false }, 0, c)
    }
    expect(over('___B___').dead).toBeNull()
    expect(over('___P___').dead).toBe('hit')
    expect(over('___G___').dead).toBeNull()
    expect(GATE_H).toBe(BLOCK_H)
    expect(PILLAR_H).toBeGreaterThan(BLOCK_H + 200)
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
        expect(Number.isInteger(s.vx), `vx=${s.vx} at tick ${s.tick}`).toBe(true)
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

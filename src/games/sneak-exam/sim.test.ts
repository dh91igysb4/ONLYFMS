import { describe, expect, it } from 'vitest'
import { SUSP_MAX, TOOLS, TOTAL_TICKS } from './constants.ts'
import { getExam } from './exam.ts'
import { initProctor, type Face } from './proctor.ts'
import { applyCmd, canApply, gainOf, initSim, parseCmd, sees, step, zoneOf, type SimState } from './sim.ts'

const exam0 = { ...getExam('sim-test'), proctorType: 0 as const }
const exam1 = { ...exam0, proctorType: 1 as const }

function at(x: number, z: number, face: Face, extra: Partial<SimState> = {}, dozing = false): SimState {
  return { ...initSim(exam0), proctor: { ...initProctor(), x, z, face, mode: 'look', timer: 9999, dozing }, ...extra }
}
function run(s: SimState, n: number, exam = exam0): SimState {
  for (let i = 0; i < n; i++) s = step(s, exam)
  return s
}

describe('sim', () => {
  it('initSim', () => {
    const s = initSim(exam0)
    expect(s).toMatchObject({ tick: 0, rng: exam0.rng0, susp: 0, tool: 0, stow: 0, q: 0, end: null })
    expect(s.prog).toEqual(Array(8).fill(0))
    expect(s.marks).toEqual(Array(8).fill(-1))
  })

  it('zone boundaries', () => {
    expect(zoneOf(0, 1000)).toBe(0)
    expect(zoneOf(0, 2400)).toBe(1)
    expect(zoneOf(900, 2500)).toBe(0)
    expect(zoneOf(900, 4500)).toBe(1)
    expect(zoneOf(900, 4501)).toBe(2)
    expect(zoneOf(0, 8200)).toBe(2)
  })

  it('sight cone', () => {
    expect(sees(at(0, 8200, 0).proctor)).toBe(true)
    expect(sees(at(0, 8200, 1).proctor)).toBe(false)
    expect(sees(at(0, 2400, 0).proctor)).toBe(true)
    expect(sees(at(0, 1000, 0).proctor)).toBe(false)
    expect(sees(at(0, 1000, 3).proctor)).toBe(true)
    expect(sees(at(1800, 1000, 2).proctor)).toBe(true)
    expect(sees(at(1800, 1000, 3).proctor)).toBe(false)
    for (const f of [0, 1, 2, 3] as const) expect(sees(at(0, 8200, f, {}, true).proctor)).toBe(false)
  })

  it('gain table', () => {
    const spots = {
      seenNear: at(900, 2000, 0),
      seenMid: at(900, 3400, 0),
      seenFar: at(900, 8200, 0),
      blindNear: at(900, 2000, 1),
      blindMid: at(900, 3400, 1),
    }
    const want: Record<keyof typeof spots, number[]> = {
      seenNear: [60, 120, 250],
      seenMid: [10, 20, 80],
      seenFar: [0, 0, 15],
      blindNear: [0, 120, 40],
      blindMid: [0, 20, 0],
    }
    for (const k of Object.keys(spots) as (keyof typeof spots)[]) {
      for (const tool of [1, 2, 3] as const) {
        expect(gainOf({ ...spots[k], tool }, 0), `${k} tool${tool}`).toBe(want[k][tool - 1])
      }
    }
    // 표와 TOOLS 일치
    expect([1, 2, 3].map((t) => TOOLS[t]!.seen[0])).toEqual(want.seenNear)
    // 매의 눈: 보는 far
    expect(gainOf({ ...spots.seenFar, tool: 1 }, 1)).toBe(5)
    expect(gainOf({ ...spots.seenFar, tool: 3 }, 1)).toBe(30)
    // 도구 없음, 조는 중
    expect(gainOf({ ...spots.seenNear, tool: 0 }, 0)).toBe(0)
    for (const tool of [1, 2, 3] as const) expect(gainOf(at(900, 2000, 0, { tool }, true), 0)).toBe(0)
  })

  it('suspicion rises and decays', () => {
    const s = applyCmd(at(900, 2000, 0), ['t', 3])
    expect(step(s, exam0).susp).toBe(250)
    expect(step({ ...at(900, 2000, 0), susp: 250 }, exam0).susp).toBe(245)
    expect(step(at(900, 2000, 0), exam0).susp).toBe(0)
    expect(step({ ...at(900, 2000, 0), susp: 3 }, exam0).susp).toBe(0)
  })

  it('caught at max', () => {
    const s = run(applyCmd(at(900, 2000, 0), ['t', 3]), 40)
    expect(s.end).toBe('caught')
    expect(s.susp).toBe(SUSP_MAX)
    expect(step(s, exam0)).toBe(s)
  })

  it('progress per tool', () => {
    for (const [tool, n] of [[1, 600], [2, 300], [3, 120]] as const) {
      const base = at(0, 8200, 1, { tool })
      expect(run(base, n).prog[0]).toBe(3600)
      expect(run(base, n - 1).prog[0]).toBeLessThan(3600)
      expect(run(base, n + 50).prog[0]).toBe(3600)
    }
  })

  it('progress persists', () => {
    let s = at(0, 8200, 1, { tool: 3 })
    s = run(s, 60)
    s = applyCmd(s, ['q', 1])
    s = run(s, 10)
    s = applyCmd(s, ['q', 0])
    expect(s.prog[0]).toBe(1800)
    expect(s.prog[1]).toBe(300)
  })

  it('stowing', () => {
    let s = applyCmd(at(0, 8200, 0), ['t', 3])
    s = applyCmd(s, ['t', 0])
    expect(s.stow).toBe(40)
    const before = s.prog.slice()
    let bad = ''
    for (let i = 1; i <= 40; i++) {
      if (gainOf(s, 0) <= 0) bad ||= `gain ${i}`
      s = step(s, exam0)
      if (s.prog.some((v, j) => v !== before[j])) bad ||= `prog ${i}`
      if (i < 40 && s.tool !== 3) bad ||= `tool early ${i}`
    }
    expect(bad).toBe('')
    expect(s.tool).toBe(0)
    expect(s.end).toBe(null)
    const g = applyCmd(at(0, 8200, 0, { tool: 1 }), ['t', 0])
    expect(g.tool).toBe(0)
  })

  it('tool switching rules', () => {
    const phone = at(0, 8200, 0, { tool: 3 })
    expect(canApply(phone, ['t', 1])).toBe(false)
    expect(canApply(phone, ['t', 3])).toBe(true)
    expect(canApply(applyCmd(phone, ['t', 0]), ['t', 3])).toBe(false)
    expect(canApply(applyCmd(phone, ['t', 0]), ['t', 2])).toBe(false)
    expect(canApply(applyCmd(phone, ['t', 0]), ['t', 0])).toBe(true)
    expect(canApply(at(0, 8200, 0), ['t', 2])).toBe(true)
    expect(canApply(at(0, 8200, 0), ['t', 0])).toBe(true)
    expect(canApply({ ...phone, end: 'submit' }, ['q', 1])).toBe(false)
  })

  it('submit command', () => {
    const s = applyCmd(at(0, 8200, 0), ['x'])
    expect(s.end).toBe('submit')
  })

  it('timeout', () => {
    const s = run(initSim(exam0), TOTAL_TICKS)
    expect(s.end).toBe('timeout')
    expect(s.tick).toBe(7200)
  })

  it('parseCmd', () => {
    for (const bad of [['t', 4], ['q', 8], ['m', 0, 5], ['m', 0], ['x', 1], 'x', ['t', 1.5], null]) {
      expect(parseCmd(bad)).toBe(null)
    }
    for (const ok of [['t', 2], ['q', 7], ['m', 3, -1], ['x']]) expect(parseCmd(ok)).toEqual(ok)
  })

  it('does not mutate input', () => {
    const s = at(0, 8200, 0, { tool: 3 })
    const snap = JSON.stringify(s)
    step(s, exam0)
    applyCmd(s, ['m', 0, 2])
    applyCmd(s, ['q', 2])
    expect(JSON.stringify(s)).toBe(snap)
  })

  it('integers only', () => {
    let seed = 12345
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
      return seed % n
    }
    let s = initSim(exam1)
    let bad = ''
    for (let i = 0; i < TOTAL_TICKS && !s.end; i++) {
      const k = rnd(40)
      const cmd =
        k === 0 ? ['t', rnd(4)] : k === 1 ? ['q', rnd(8)] : k === 2 ? ['m', rnd(8), rnd(6) - 1] : null
      const c = cmd && parseCmd(cmd)
      if (c && canApply(s, c)) s = applyCmd(s, c)
      s = step(s, exam1)
      const nums = [s.tick, s.rng, s.susp, s.tool, s.stow, s.q, ...s.prog, ...s.marks,
        s.proctor.x, s.proctor.z, s.proctor.face, s.proctor.timer, s.proctor.tx, s.proctor.tz]
      if (!nums.every(Number.isInteger)) bad ||= `tick ${s.tick}`
    }
    expect(bad).toBe('')
  })

  it('idle never raises suspicion', () => {
    let bad = ''
    for (let i = 0; i < 30; i++) {
      const ex = getExam(`idle-${i}`)
      let s = initSim(ex)
      while (!s.end) {
        s = step(s, ex)
        if (s.susp !== 0) bad ||= `seed ${i} tick ${s.tick}`
      }
    }
    expect(bad).toBe('')
  })
})

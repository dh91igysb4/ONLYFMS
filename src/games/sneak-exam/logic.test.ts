import { describe, expect, it } from 'vitest'
import { getGame } from '../index.ts'
import { MAX_ACTION_TICKS, N_Q, PROG_MAX, TOTAL_TICKS } from './constants.ts'
import { getExam } from './exam.ts'
import { correctCount, logic, scoreOf } from './logic.ts'
import type { Action, State } from './logic.ts'
import { initSim } from './sim.ts'
import type { Cmd } from './sim.ts'
import * as mod from './logic.ts'

const ctx = { now: 0, startedAt: 0, deadline: null }
const SEED = '0123456789abcdef0123456789abcdef'
const puzzle = { seed: SEED }
const exam = getExam(SEED)
const fresh = (): State => logic.initState(puzzle, ctx)

function run(state: State, action: Action | { type: 'give_up' }): State {
  const r = logic.apply(puzzle, state, action, ctx)
  if ('error' in r) throw new Error(r.error)
  return r.state
}
const withSim = (patch: Partial<State['sim']>): State => {
  const s = fresh()
  return { ...s, sim: { ...s.sim, ...patch } }
}
const marked = (k: number, extra: Partial<State['sim']> = {}): State => {
  const marks = Array(N_Q).fill(-1)
  for (let i = 0; i < k; i++) marks[i] = exam.answers[i]
  return withSim({ marks, ...extra })
}

describe('sneak-exam logic', () => {
  it('pickPuzzle seed format', () => {
    const p = logic.pickPuzzle(Math.random, {})
    expect(p.seed).toMatch(/^[0-9a-f]{32}$/)
    expect(logic.puzzleKey(p)).toBe(p.seed)
  })

  it('validates actions', () => {
    const bad: unknown[] = [
      { type: 's', n: -1 },
      { type: 's', n: MAX_ACTION_TICKS + 1 },
      { type: 's', n: 1.5 },
      { type: 's', n: 0, c: ['t', 9] },
      { type: 'z' },
    ]
    for (const a of bad) {
      expect(logic.apply(puzzle, fresh(), a as Action, ctx)).toEqual({ error: 'invalid_input' })
    }
  })

  it('rejected command leaves state untouched', () => {
    const s = run(fresh(), { type: 's', n: 0, c: ['t', 3] })
    const before = structuredClone(s)
    expect(logic.apply(puzzle, s, { type: 's', n: 10, c: ['t', 1] }, ctx)).toEqual({ error: 'invalid_input' })
    expect(s).toEqual(before)
  })

  it('drops the command when the batch crosses the end', () => {
    const r = logic.apply(puzzle, withSim({ tick: 7150 }), { type: 's', n: 100, c: ['m', 0, 1] }, ctx)
    if ('error' in r) throw new Error(r.error)
    expect(r.state.sim.end).toBe('timeout')
    expect(r.state.sim.marks[0]).toBe(-1)
  })

  it('rejects actions after the end', () => {
    const s = run(fresh(), { type: 's', n: 0, c: ['x'] })
    expect(s.sim.end).toBe('submit')
    expect(logic.apply(puzzle, s, { type: 's', n: 1 }, ctx)).toEqual({ error: 'finished' })
    expect(logic.apply(puzzle, s, { type: 'give_up' }, ctx)).toEqual({ error: 'finished' })
  })

  it('score: guessing', () => {
    expect(logic.score(run(marked(8), { type: 's', n: 0, c: ['x'] }), ctx)).toBe(1600)
    expect(logic.score(run(marked(3), { type: 's', n: 0, c: ['x'] }), ctx)).toBe(600)
  })

  it('score: time bonus', () => {
    const s = marked(8, { tick: 4800 })
    expect(scoreOf({ ...s.sim, end: 'submit' }, exam)).toBe(8 * (100 + 33))
  })

  it('score: timeout has no bonus', () => {
    expect(scoreOf({ ...marked(5).sim, tick: TOTAL_TICKS, end: 'timeout' }, exam)).toBe(500)
    expect(logic.score(marked(4), ctx)).toBe(400)
    expect(logic.score(run(marked(6), { type: 'give_up' }), ctx)).toBe(600)
    expect(correctCount(marked(6).sim, exam)).toBe(6)
  })

  it('score: caught is zero', () => {
    expect(scoreOf({ ...marked(8).sim, end: 'caught' }, exam)).toBe(0)
  })

  it('publicState hides unrevealed answers', () => {
    expect(logic.publicState(fresh()).known).toEqual(Array(N_Q).fill(-1))
    const prog = Array(N_Q).fill(0)
    prog[2] = PROG_MAX
    const pub = logic.publicState(withSim({ prog }))
    expect(pub.known.map((v, i) => (i === 2 ? v === exam.answers[2] : v === -1)).every(Boolean)).toBe(true)
  })

  it('reveal returns answers and proctor type', () => {
    expect(logic.reveal(puzzle)).toEqual({ answers: exam.answers, proctorType: exam.proctorType })
  })

  it('determinism', () => {
    const cmds: Cmd[] = [['t', 3], ['q', 2], ['t', 0]]
    const play = (chunks: number[]): State => {
      let s = fresh()
      for (const n of chunks) s = run(s, { type: 's', n })
      return s
    }
    const a = run(run(run(fresh(), { type: 's', n: 60, c: cmds[0] }), { type: 's', n: 60, c: cmds[1] }), { type: 's', n: 5, c: cmds[2] })
    const b = run(run(run(fresh(), { type: 's', n: 60, c: cmds[0] }), { type: 's', n: 60, c: cmds[1] }), { type: 's', n: 5, c: cmds[2] })
    expect(a).toEqual(b)
    expect(play([30, 30])).toEqual(play([60]))
    // 같은 틱에 같은 명령이 닿으면 n을 어떻게 나눠도 결과가 같다
    const whole = run(fresh(), { type: 's', n: 40, c: ['t', 3] })
    const split = run(run(fresh(), { type: 's', n: 10 }), { type: 's', n: 30, c: ['t', 3] })
    expect(split).toEqual(whole)
  })

  it('registry', () => {
    const g = getGame('sneak-exam')
    expect(g?.logic).toBe(mod.logic)
    expect(g?.manifest.hidden).toBe(true)
    expect(initSim(exam).tick).toBe(0)
  })
})

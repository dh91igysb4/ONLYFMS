import { describe, expect, it } from 'vitest'
import { rngFromSeed } from '../../shared/rng.ts'
import type { Ctx } from '../types.ts'
import { getCourse } from './course.ts'
import { encodeHold } from './input.ts'
import { logic, type Action, type State } from './logic.ts'
import { manifest } from './manifest.ts'
import { initSim, scoreOf, step } from './sim.ts'

const ctx: Ctx = { now: 0, startedAt: 0, deadline: null }
const seedBytes = (n: number): Uint8Array => new Uint8Array(32).map((_, i) => (i * 7 + n) & 255)
const SEED = '0123456789abcdef0123456789abcdef'

const fresh = (seed = SEED): State => logic.initState({ seed }, ctx)
const ok = (r: { state: State } | { error: string }): State => {
  if ('error' in r) throw new Error(r.error)
  return r.state
}

describe('neon-rider logic', () => {
  it('pickPuzzle returns a 32-hex seed, deterministic per rng', () => {
    const p = logic.pickPuzzle(rngFromSeed(seedBytes(1)), {})
    expect(p.seed).toMatch(/^[0-9a-f]{32}$/)
    expect(logic.pickPuzzle(rngFromSeed(seedBytes(1)), {})).toEqual(p)
    expect(logic.pickPuzzle(rngFromSeed(seedBytes(2)), {})).not.toEqual(p)
    expect(logic.puzzleKey(p)).toBe(p.seed)
  })

  it('has version 5 and the spec manifest', () => {
    expect(logic.version).toBe(5)
    expect(manifest).toMatchObject({
      id: 'neon-rider', name: '네온 라이더', description: '누르면 달리고, 공중에서 누르면 돈다. 바퀴로 착지하라', options: [], hidden: false,
      freeStats: 'score', freeBestOnly: true, scoreMax: 9999, scoreDecimals: 0,
      modes: { daily: false, contest: false, free: true }, puzzleSource: 'generate', dailyTimeLimitSec: null,
    })
  })

  it('rejects bad input without changing state', () => {
    const s = fresh()
    const before = JSON.stringify(s)
    for (const d of [[121], [0, 0, 5], [], 'x', null, [1.5]]) {
      expect(logic.apply({ seed: SEED }, s, { type: 'i', d } as never, ctx)).toEqual({ error: 'invalid_input' })
    }
    expect(logic.apply({ seed: SEED }, s, { type: 'x' } as never, ctx)).toEqual({ error: 'invalid_input' })
    expect(JSON.stringify(s)).toBe(before)
  })

  it('20 applies of 30 ticks equal 600 steps', () => {
    const bits = Array.from({ length: 600 }, (_, i) => i % 50 < 30)
    let s = fresh()
    for (let k = 0; k < 20; k++) {
      if (logic.isFinished(s, ctx)) break
      s = ok(logic.apply({ seed: SEED }, s, { type: 'i', d: encodeHold(bits.slice(k * 30, k * 30 + 30)) } as Action, ctx))
    }
    const course = getCourse(SEED)
    let ref = initSim(course)
    for (let i = 0; i < 600 && ref.dead === null; i++) ref = step(ref, bits[i], course)
    expect(s.sim).toEqual(ref)
    expect(logic.score(s, ctx)).toBe(scoreOf(ref))
    expect(logic.actionCount(s)).toBe(ref.tick)
  })

  it('apply never mutates the input state', () => {
    const s = fresh()
    const before = JSON.stringify(s)
    ok(logic.apply({ seed: SEED }, s, { type: 'i', d: [0, 30] }, ctx))
    expect(JSON.stringify(s)).toBe(before)
    ok(logic.apply({ seed: SEED }, s, { type: 'give_up' }, ctx))
    expect(JSON.stringify(s)).toBe(before)
  })

  it('give_up finishes, then apply returns finished', () => {
    const s = ok(logic.apply({ seed: SEED }, fresh(), { type: 'give_up' }, ctx))
    expect(logic.isFinished(s, ctx)).toBe(true)
    expect(logic.apply({ seed: SEED }, s, { type: 'i', d: [0, 5] }, ctx)).toEqual({ error: 'finished' })
    expect(logic.reveal({ seed: SEED })).toBeNull()
  })

  it('끝난 상태에는 잘못된 행동도 { error: finished }', () => {
    const s = ok(logic.apply({ seed: SEED }, fresh(), { type: 'give_up' }, ctx))
    expect(logic.apply({ seed: SEED }, s, { type: 'nope' } as never, ctx)).toEqual({ error: 'finished' })
    expect(logic.apply({ seed: SEED }, s, { type: 'i', d: [-1] }, ctx)).toEqual({ error: 'finished' })
  })
})

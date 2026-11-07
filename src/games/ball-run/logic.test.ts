import { describe, expect, it } from 'vitest'
import { rngFromSeed } from '../../shared/rng.ts'
import type { Ctx } from '../types.ts'
import { getCourse } from './course.ts'
import { encodeInputs } from './input.ts'
import { logic, type Action, type State } from './logic.ts'
import { manifest } from './manifest.ts'
import { initSim, step } from './sim.ts'

const ctx: Ctx = { now: 0, startedAt: 0, deadline: null }
const seedBytes = (n: number): Uint8Array => new Uint8Array(32).map((_, i) => (i * 7 + n) & 255)
const SEED = '0123456789abcdef0123456789abcdef'

const fresh = (seed = SEED): State => logic.initState({ seed }, ctx)
const ok = (r: { state: State } | { error: string }): State => {
  if ('error' in r) throw new Error(r.error)
  return r.state
}
const send = (seed: string, s: State, targets: number[], chunks: number[]): State => {
  let i = 0
  for (const n of chunks) {
    const part = targets.slice(i, i + n)
    i += n
    if (part.length === 0 || logic.isFinished(s, ctx)) break
    s = ok(logic.apply({ seed }, s, { type: 'i', d: encodeInputs(part) } as Action, ctx))
  }
  return s
}

describe('ball-run logic', () => {
  it('pickPuzzle returns a 32-hex seed, deterministic per rng', () => {
    const p = logic.pickPuzzle(rngFromSeed(seedBytes(1)), {})
    expect(p.seed).toMatch(/^[0-9a-f]{32}$/)
    expect(logic.pickPuzzle(rngFromSeed(seedBytes(1)), {})).toEqual(p)
    expect(logic.pickPuzzle(rngFromSeed(seedBytes(2)), {})).not.toEqual(p)
    expect(logic.puzzleKey(p)).toBe(p.seed)
  })

  it('has version 1 and the spec manifest', () => {
    expect(logic.version).toBe(1)
    expect(manifest).toMatchObject({
      id: 'ball-run', name: '볼 런', description: '굴러가는 공을 좌우로 움직여 장애물을 피한다', options: [], hidden: true, freeStats: 'score', scoreMax: 99999, scoreDecimals: 0,
      modes: { daily: false, contest: false, free: true }, puzzleSource: 'generate', dailyTimeLimitSec: null,
    })
  })

  it('apply runs ticks', () => {
    const s = ok(logic.apply({ seed: SEED }, fresh(), { type: 'i', d: [0, 30] }, ctx))
    expect(s.sim.tick).toBe(30)
    expect(logic.actionCount(s)).toBe(30)
  })

  it('rejects bad input without changing state', () => {
    const s = fresh()
    expect(logic.apply({ seed: SEED }, s, { type: 'i', d: [0, 121] }, ctx)).toEqual({ error: 'invalid_input' })
    expect(logic.apply({ seed: SEED }, s, { type: 'x' } as never, ctx)).toEqual({ error: 'invalid_input' })
    expect(s).toEqual(fresh())
  })

  it('give_up ends', () => {
    const s = ok(logic.apply({ seed: SEED }, fresh(), { type: 'give_up' }, ctx))
    expect(logic.isFinished(s, ctx)).toBe(true)
    expect(s.sim.dead).toBe('give_up')
    expect(logic.apply({ seed: SEED }, s, { type: 'i', d: [0, 5] }, ctx)).toEqual({ error: 'finished' })
    expect(logic.apply({ seed: SEED }, s, { type: 'give_up' }, ctx)).toEqual({ error: 'finished' })
  })

  it('stops at death mid-batch', () => {
    // 가운데 열로 곧장 달려 처음 죽는 틱을 기준 시뮬로 찾는다.
    const course = getCourse(SEED)
    let r = initSim()
    while (r.dead === null && r.tick < 20000) r = step(r, 0, course)
    expect(r.dead).not.toBeNull()
    const deathTick = r.tick
    let s = fresh()
    let sent = 0
    while (!logic.isFinished(s, ctx)) {
      s = ok(logic.apply({ seed: SEED }, s, { type: 'i', d: [0, 120] }, ctx))
      sent += 120
      expect(sent).toBeLessThan(deathTick + 240)
    }
    expect(s.sim.tick).toBe(deathTick)
    expect(s.sim.dead).toBe(r.dead)
    expect(sent).toBeGreaterThan(deathTick) // 마지막 묶음 도중에 죽었다
    expect(logic.apply({ seed: SEED }, s, { type: 'i', d: [0, 5] }, ctx)).toEqual({ error: 'finished' })
  })

  it('batching does not change the result', () => {
    const targets: number[] = []
    // 의사 입력 1200틱 (이 시드는 약 209틱, 첫 내리막의 블록에서 죽으므로 사망 틱도 같아야 한다)
    for (let t = 0; t < 1200; t++) targets.push(Math.floor(t / 60) % 2 ? 1000 : -1000)
    const a = send(SEED, fresh(), targets, new Array(40).fill(30))
    const b = send(SEED, fresh(), targets, [7, 120, 7, 120, 7, 120, 7, 120, 7, 120, 7, 120, 7, 120, 7, 120, 7, 120, 7, 120, 7, 120, 7, 120, 7, 120])
    expect(a.sim.tick).toBeGreaterThan(150) // 시작 터널(120틱)을 지나 여러 묶음에 걸친다
    expect(a.sim.dead).not.toBeNull()
    expect(b).toEqual(a)
  })

  it('score is floor(z / 10000) capped', () => {
    const s = fresh()
    expect(logic.score({ ...s, sim: { ...s.sim, z: 5_839_999 } }, ctx)).toBe(583)
    expect(logic.score({ ...s, sim: { ...s.sim, z: 1_000_000_000_000 } }, ctx)).toBe(99999)
  })

  it('publicState is the state, reveal is null', () => {
    const s = fresh()
    expect(logic.publicState(s)).toBe(s)
    expect(logic.reveal({ seed: SEED })).toBeNull()
  })
})

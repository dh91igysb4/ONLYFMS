import { describe, expect, test } from 'vitest'
import { logic } from './logic.ts'
import type { Puzzle, State } from './logic.ts'

const ctx = { now: 0, startedAt: 0, deadline: null }
const P: Puzzle = { range: 100, answer: 42 }

function ok(r: { state: State } | { error: string }): State {
  if ('error' in r) throw new Error(r.error)
  return r.state
}
const guess = (s: State, value: number) => logic.apply(P, s, { type: 'guess', value }, ctx)
const init = () => logic.initState(P, ctx)

describe('number-guess logic', () => {
  test('version and puzzleKey', () => {
    expect(logic.version).toBe(1)
    expect(logic.puzzleKey(P)).toBe('100:42')
  })

  test('pickPuzzle respects range option', () => {
    const p = logic.pickPuzzle(() => 0.999, { range: '1000' })
    expect(p.range).toBe(1000)
    expect(p.answer).toBeGreaterThanOrEqual(1)
    expect(p.answer).toBeLessThanOrEqual(1000)
    expect(p.answer).toBe(1000)
  })

  test('pickPuzzle defaults to 100 for missing/invalid range, covers bounds', () => {
    expect(logic.pickPuzzle(() => 0, {}).range).toBe(100)
    expect(logic.pickPuzzle(() => 0, { range: 'x' }).range).toBe(100)
    expect(logic.pickPuzzle(() => 0, {}).answer).toBe(1)
    expect(logic.pickPuzzle(() => 0.999999, {}).answer).toBe(100)
  })

  test('feedback up/down/hit and finish', () => {
    let s = init()
    s = ok(guess(s, 10)); expect(s.feedback.at(-1)).toBe('up')
    s = ok(guess(s, 50)); expect(s.feedback.at(-1)).toBe('down')
    expect(logic.isFinished(s, ctx)).toBe(false)
    s = ok(guess(s, 42)); expect(s.feedback.at(-1)).toBe('hit')
    expect(logic.isFinished(s, ctx)).toBe(true)
    expect(logic.score(s, ctx)).toBe(8)
  })

  test('errors: out of range, repeated, non-integer, after finish', () => {
    const s = ok(guess(init(), 7))
    expect(guess(s, 0)).toHaveProperty('error')
    expect(guess(s, 101)).toHaveProperty('error')
    expect(guess(s, 7)).toHaveProperty('error')
    expect(guess(s, 1.5)).toHaveProperty('error')
    expect(guess(s, NaN)).toHaveProperty('error')
    const done = ok(guess(s, 42))
    expect(guess(done, 8)).toHaveProperty('error')
    expect(logic.apply(P, done, { type: 'hint' }, ctx)).toHaveProperty('error')
    expect(logic.apply(P, done, { type: 'give_up' }, ctx)).toHaveProperty('error')
  })

  test('range 1000 allows values up to 1000', () => {
    const P2: Puzzle = { range: 1000, answer: 900 }
    const s = logic.initState(P2, ctx)
    expect(logic.apply(P2, s, { type: 'guess', value: 1000 }, ctx)).toHaveProperty('state')
    expect(logic.apply(P2, s, { type: 'guess', value: 1001 }, ctx)).toHaveProperty('error')
  })

  test('score bounds: 1st=10, 8th=3, fail=0, give_up=0, hint -1', () => {
    expect(logic.score(ok(guess(init(), 42)), ctx)).toBe(10)

    // 8th guess hits
    let s = init()
    for (const v of [1, 2, 3, 4, 5, 6, 7]) s = ok(guess(s, v))
    s = ok(guess(s, 42))
    expect(logic.isFinished(s, ctx)).toBe(true)
    expect(logic.score(s, ctx)).toBe(3)

    // 8th guess hit with hint -> 2
    let h = ok(logic.apply(P, init(), { type: 'hint' }, ctx))
    for (const v of [1, 2, 3, 4, 5, 6, 7]) h = ok(guess(h, v))
    h = ok(guess(h, 42))
    expect(logic.score(h, ctx)).toBe(2)

    // fail
    let f = init()
    for (const v of [1, 2, 3, 4, 5, 6, 7, 8]) f = ok(guess(f, v))
    expect(logic.score(f, ctx)).toBe(0)

    // give up
    const g = ok(logic.apply(P, ok(guess(init(), 1)), { type: 'give_up' }, ctx))
    expect(logic.isFinished(g, ctx)).toBe(true)
    expect(logic.score(g, ctx)).toBe(0)

    // give up after hint is still 0 (floor)
    const gh = ok(logic.apply(P, ok(logic.apply(P, init(), { type: 'hint' }, ctx)), { type: 'give_up' }, ctx))
    expect(logic.score(gh, ctx)).toBe(0)
  })

  test('hint reveals parity once and costs 1 point', () => {
    let s = ok(logic.apply(P, init(), { type: 'hint' }, ctx))
    expect(s.parity).toBe('even')
    expect(s.hintUsed).toBe(true)
    expect(logic.apply(P, s, { type: 'hint' }, ctx)).toHaveProperty('error')
    s = ok(guess(s, 42))
    expect(logic.score(s, ctx)).toBe(9)
    const odd = ok(logic.apply({ range: 100, answer: 7 }, init(), { type: 'hint' }, ctx))
    expect(odd.parity).toBe('odd')
  })

  test('unfinished score equals give-up score (0)', () => {
    const s = ok(guess(init(), 1))
    expect(logic.score(s, ctx)).toBe(0)
  })

  test('8 misses finishes the game', () => {
    let s = init()
    for (const v of [1, 2, 3, 4, 5, 6, 7]) {
      s = ok(guess(s, v))
      expect(logic.isFinished(s, ctx)).toBe(false)
    }
    s = ok(guess(s, 8))
    expect(logic.isFinished(s, ctx)).toBe(true)
    expect(guess(s, 9)).toHaveProperty('error')
  })

  test('actionCount counts guesses only', () => {
    let s = ok(logic.apply(P, init(), { type: 'hint' }, ctx))
    expect(logic.actionCount(s)).toBe(0)
    s = ok(guess(s, 1))
    s = ok(guess(s, 2))
    expect(logic.actionCount(s)).toBe(2)
  })

  test('apply does not mutate input state; publicState has no answer; reveal returns answer', () => {
    const s = init()
    ok(guess(s, 5))
    expect(s.guesses).toEqual([])
    expect(JSON.stringify(logic.publicState(s))).not.toContain('42')
    expect(logic.reveal(P)).toEqual({ answer: 42 })
  })
})

import { describe, expect, test, vi } from 'vitest'
import type { GameLogic } from '../../../src/games/types.ts'
import { logic as numberGuess } from '../../../src/test-fixtures/test-guess/logic.ts'
import { pickFresh, step } from './engine.ts'

type P = { n: number }
// rng 값과 상관없이 seed 첫 바이트로 문제를 정하는 가짜 logic
function fakeLogic(): GameLogic<P, never, null, null> {
  return {
    version: 1,
    pickPuzzle: (rng) => ({ n: Math.floor(rng() * 0) }), // 항상 0 → 같은 키
    puzzleKey: (p) => `k${p.n}`,
    initState: () => null,
    apply: () => ({ error: 'x' }),
    isFinished: () => false,
    score: () => 0,
    actionCount: () => 0,
    publicState: () => null,
    reveal: () => null,
  }
}

const seed = (retry: number) => {
  const s = new Uint8Array(32)
  s[0] = retry + 1
  return Promise.resolve(s)
}

const ctx = { now: 1000, startedAt: 0, deadline: 10_000 }

describe('engine', () => {
  test('pickFresh avoids recent keys and stops at 20 retries', async () => {
    const seen: number[] = []
    const r = await pickFresh(fakeLogic(), {}, (retry) => { seen.push(retry); return seed(retry) }, new Set(['k0']))
    expect(r.retries).toBe(20)
    expect(r.key).toBe('k0')
    expect(r.puzzle).toEqual({ n: 0 })
    expect(seen).toEqual(Array.from({ length: 21 }, (_, i) => i))
  })

  test('pickFresh returns first non-recent puzzle', async () => {
    const first = await pickFresh(numberGuess, { range: '100' }, seed, new Set())
    expect(first.retries).toBe(0)
    const r = await pickFresh(numberGuess, { range: '100' }, seed, new Set([first.key]))
    expect(r.retries).toBe(1)
    expect(r.key).not.toBe(first.key)
    expect(numberGuess.puzzleKey(r.puzzle as never)).toBe(r.key)
  })

  test('step returns error without changing state', () => {
    const puzzle = { range: 100 as const, answer: 42 }
    const state = numberGuess.initState(puzzle, ctx)
    const before = JSON.stringify(state)
    const r = step(numberGuess, puzzle, state, { type: 'guess', value: 101 }, ctx)
    expect(r).toEqual({ ok: false, status: 400, error: '1~100 사이로 입력해 주세요' })
    expect(JSON.stringify(state)).toBe(before)
  })

  test('step hides exception messages from logic.apply', () => {
    const puzzle = { range: 100 as const, answer: 42 }
    const state = numberGuess.initState(puzzle, ctx)
    const throwing = { ...numberGuess, apply: () => { throw new Error('secret answer is 42') } }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = step(throwing, puzzle, state, { type: 'guess', value: 1 }, ctx)
    expect(r).toEqual({ ok: false, status: 400 })
    expect(JSON.stringify(r)).not.toContain('secret')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  test('step rejects malformed actions', () => {
    const puzzle = { range: 100 as const, answer: 42 }
    const state = numberGuess.initState(puzzle, ctx)
    expect(step(numberGuess, puzzle, state, null, ctx).ok).toBe(false)
    expect(step(numberGuess, puzzle, state, { value: 3 }, ctx).ok).toBe(false)
  })

  test('step stores give-up score while unfinished', () => {
    const puzzle = { range: 100 as const, answer: 42 }
    const s0 = numberGuess.initState(puzzle, ctx)
    const r = step(numberGuess, puzzle, s0, { type: 'guess', value: 10 }, ctx)
    if (!r.ok) throw new Error('expected ok')
    expect(r.finished).toBe(false)
    expect(r.score).toBe(numberGuess.score(r.state as never, ctx))
    expect(r.actionCount).toBe(1)
    const hit = step(numberGuess, puzzle, r.state, { type: 'guess', value: 42 }, ctx)
    if (!hit.ok) throw new Error('expected ok')
    expect(hit).toMatchObject({ finished: true, score: 9, actionCount: 2 })
  })
})

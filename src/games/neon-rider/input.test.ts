import { describe, expect, it } from 'vitest'
import { MAX_ACTION_TICKS, MAX_RUNS } from './constants.ts'
import { decodeHold, encodeHold } from './input.ts'

describe('neon-rider input codec', () => {
  it('round-trips unbiased random and fully alternating strings for every length 1..120', () => {
    let x = 12345
    const rnd = (): number => {
      x = (x * 1103515245 + 12345) & 0x7fffffff
      return x / 0x80000000
    }
    for (let len = 1; len <= MAX_ACTION_TICKS; len++) {
      const random = Array.from({ length: len }, () => rnd() < 0.5)
      const altFalse = Array.from({ length: len }, (_, i) => i % 2 === 1)
      const altTrue = Array.from({ length: len }, (_, i) => i % 2 === 0)
      for (const bits of [random, altFalse, altTrue]) {
        const enc = encodeHold(bits)
        expect(enc.length).toBeLessThanOrEqual(MAX_RUNS)
        expect(decodeHold(enc)).toEqual(bits)
      }
    }
  })

  it('first value is 0 when starting with a press', () => {
    expect(encodeHold([true, true, false])).toEqual([0, 2, 1])
    expect(encodeHold([false, true])).toEqual([1, 1])
  })

  it('rejects malformed input', () => {
    const bad: unknown[] = [null, 'x', [], [0], [-1, 3], [1.5], [0, 0, 5], [MAX_ACTION_TICKS + 1], [60, 61], Array.from({ length: MAX_RUNS + 1 }, () => 1), [1, 'a'], undefined, {}]
    for (const d of bad) expect(decodeHold(d)).toBeNull()
  })

  it('accepts boundaries and rejects MAX_RUNS + 1 runs', () => {
    expect(decodeHold([MAX_ACTION_TICKS])?.length).toBe(MAX_ACTION_TICKS)
    const maxRuns = [0, ...Array.from({ length: MAX_RUNS - 1 }, () => 1)]
    expect(decodeHold(maxRuns)?.length).toBe(MAX_RUNS - 1)
    expect(decodeHold([...maxRuns, 1])).toBeNull()
  })
})

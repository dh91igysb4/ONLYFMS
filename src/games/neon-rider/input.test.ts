import { describe, expect, it } from 'vitest'
import { MAX_ACTION_TICKS, MAX_RUNS } from './constants.ts'
import { decodeHold, encodeHold } from './input.ts'

describe('neon-rider input codec', () => {
  it('round-trips random bit strings of length 1..120', () => {
    let x = 12345
    const rnd = (): number => {
      x = (x * 1103515245 + 12345) & 0x7fffffff
      return x / 0x80000000
    }
    for (let len = 1; len <= MAX_ACTION_TICKS; len++) {
      // 런이 MAX_RUNS를 넘는 무작위 열은 규약상 거부되므로, 런이 적은 편향 열을 쓴다.
      for (const bias of [0.97, 0.03]) {
        const bits: boolean[] = []
        let cur = rnd() < 0.5
        for (let i = 0; i < len; i++) {
          if (rnd() > bias) cur = !cur
          bits.push(cur)
        }
        if (encodeHold(bits).length > MAX_RUNS) continue
        expect(decodeHold(encodeHold(bits))).toEqual(bits)
      }
    }
  })

  it('over-long run lists are rejected by decode', () => {
    const bits = Array.from({ length: 100 }, (_, i) => i % 2 === 0)
    expect(decodeHold(encodeHold(bits))).toBeNull()
  })

  it('first value is 0 when starting with a press', () => {
    expect(encodeHold([true, true, false])).toEqual([0, 2, 1])
    expect(encodeHold([false, true])).toEqual([1, 1])
  })

  it('rejects malformed input', () => {
    const bad: unknown[] = [null, 'x', [], [0], [-1, 3], [1.5], [0, 0, 5], [MAX_ACTION_TICKS + 1], [60, 61], Array.from({ length: MAX_RUNS + 1 }, () => 1), [1, 'a'], undefined, {}]
    for (const d of bad) expect(decodeHold(d)).toBeNull()
  })

  it('accepts boundaries', () => {
    expect(decodeHold([MAX_ACTION_TICKS])?.length).toBe(MAX_ACTION_TICKS)
    expect(decodeHold(Array.from({ length: MAX_RUNS }, () => 1))?.length).toBe(MAX_RUNS)
  })
})

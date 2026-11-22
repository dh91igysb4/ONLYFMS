import { describe, expect, it } from 'vitest'
import { nextRng, rngInt, seedInt } from './rng.ts'

describe('rng', () => {
  it('nextRng는 항상 0..2^32-1 정수', () => {
    let r = 12345
    for (let i = 0; i < 10000; i++) {
      r = nextRng(r)
      expect(Number.isInteger(r)).toBe(true)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThan(2 ** 32)
    }
  })

  it('rngInt(r, 5)는 0..4만 내고 다섯 값이 모두 나온다', () => {
    let r = seedInt('0123456789abcdef0123456789abcdef', 7)
    const seen = new Set<number>()
    for (let i = 0; i < 10000; i++) {
      r = nextRng(r)
      const v = rngInt(r, 5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(4)
      seen.add(v)
    }
    expect(seen.size).toBe(5)
  })

  it('seedInt는 salt가 다르면 다르고 같은 입력이면 같다', () => {
    const z = '0'.repeat(32)
    expect(seedInt(z, 1)).not.toBe(seedInt(z, 2))
    expect(seedInt(z, 1)).toBe(seedInt(z, 1))
    const s = 'deadbeefcafebabe0011223344556677'
    expect(seedInt(s, 3)).toBe(seedInt(s, 3))
    expect(Number.isInteger(seedInt(s, 3))).toBe(true)
  })
})

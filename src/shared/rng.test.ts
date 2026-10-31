import { expect, test } from 'vitest'
import { hmacSeed, rngFromSeed } from './rng.ts'

test('rng is deterministic per seed and in [0,1)', async () => {
  const s = await hmacSeed('k', 'c:1:0')
  const a = rngFromSeed(s), b = rngFromSeed(s)
  const xs = Array.from({ length: 100 }, a)
  expect(xs).toEqual(Array.from({ length: 100 }, b))
  expect(xs.every(x => x >= 0 && x < 1)).toBe(true)
  expect(rngFromSeed(await hmacSeed('k', 'c:1:1'))()).not.toBe(xs[0])
})

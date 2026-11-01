import { expect, test } from 'vitest'
import { newSeed, seedHex } from './seed.ts'

test('seed_hex_format', () => {
  const seed = newSeed()
  expect(seed.length).toBe(16)
  const hex = seedHex(seed)
  expect(hex).toHaveLength(32)
  expect(hex).toMatch(/^[0-9a-f]+$/)
  expect(seedHex(new Uint8Array(16).fill(255))).toBe('ff'.repeat(16))
})

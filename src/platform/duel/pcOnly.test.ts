import { expect, test } from 'vitest'
import { isPcCapable } from './pcOnly.ts'

test('touch-only device is not a PC', () => {
  expect(isPcCapable({ coarse: true, fine: false })).toBe(false)
})
test('mouse device is a PC', () => {
  expect(isPcCapable({ coarse: false, fine: true })).toBe(true)
})
test('touch laptop with a trackpad is a PC', () => {
  expect(isPcCapable({ coarse: true, fine: true })).toBe(true)
})

import { describe, expect, it } from 'vitest'
import { X_LIMIT } from './constants.ts'
import { clampX, decodeInputs, dragTarget, encodeInputs } from './input.ts'

describe('encodeInputs / decodeInputs', () => {
  it('round trips', () => {
    const targets = [0, 0, 0, 500, 500, -3500]
    expect(encodeInputs(targets)).toEqual([0, 3, 500, 2, -3500, 1])
    expect(decodeInputs(encodeInputs(targets))).toEqual(targets)
  })

  it('rejects invalid', () => {
    const invalid: unknown[] = [null, [], [1], [1, 0], [1, 1.5], [3501, 1], [0.5, 1], [0, 121], [0, 60, 0, 61], 'x']
    for (const d of invalid) expect(decodeInputs(d)).toBeNull()
  })

  it('accepts exactly MAX_ACTION_TICKS ticks', () => {
    expect(decodeInputs([0, 120])).toEqual(Array(120).fill(0))
  })
})

describe('drag mapping', () => {
  it('drag maps by screen fraction', () => {
    expect(dragTarget(0, 195, 390)).toBe(3000)
    expect(dragTarget(3000, 390, 390)).toBe(3500)
    expect(dragTarget(-1000, -39, 390)).toBe(-1600)
  })

  it('clampX limits to ±X_LIMIT', () => {
    expect(clampX(X_LIMIT + 1)).toBe(X_LIMIT)
    expect(clampX(-X_LIMIT - 1)).toBe(-X_LIMIT)
    expect(clampX(12.6)).toBe(13)
  })
})

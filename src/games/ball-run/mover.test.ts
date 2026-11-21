import { describe, expect, it } from 'vitest'
import { MOVER_PERIOD, VX_MAX } from './constants.ts'
import { moverX } from './mover.ts'

describe('moverX (shuttle block position, shared by sim and renderer)', () => {
  const m = { x0: -1000, x1: 1000, phase: 0, h: 0 }
  const half = MOVER_PERIOD / 2

  it('period is even and the block is clearly slower than the ball sideways', () => {
    expect(Number.isInteger(MOVER_PERIOD)).toBe(true)
    expect(MOVER_PERIOD % 2).toBe(0)
    expect(MOVER_PERIOD).toBeGreaterThanOrEqual(120)
    expect(MOVER_PERIOD).toBeLessThanOrEqual(140)
    let maxStep = 0
    for (let t = 0; t < 3 * MOVER_PERIOD; t++) maxStep = Math.max(maxStep, Math.abs(moverX(m, t + 1) - moverX(m, t)))
    expect(maxStep).toBeLessThanOrEqual(35)
    expect(maxStep * 3).toBeLessThan(VX_MAX)
  })

  it('is an integer triangle wave with exact endpoints and period', () => {
    expect(moverX(m, 0)).toBe(-1000)
    expect(moverX(m, half)).toBe(1000)
    expect(moverX(m, MOVER_PERIOD)).toBe(-1000)
    for (let t = 0; t < 4 * MOVER_PERIOD; t++) {
      const x = moverX(m, t)
      expect(Number.isInteger(x), `t=${t}`).toBe(true)
      expect(x).toBeGreaterThanOrEqual(-1000)
      expect(x).toBeLessThanOrEqual(1000)
      expect(moverX(m, t + MOVER_PERIOD)).toBe(x)
      // 오가는 길이 대칭(half 기준)
      expect(moverX(m, MOVER_PERIOD - (t % MOVER_PERIOD))).toBe(moverX(m, t % MOVER_PERIOD))
    }
    // 반 주기 동안 한쪽으로만 움직인다.
    for (let t = 0; t < half; t++) expect(moverX(m, t + 1)).toBeGreaterThan(moverX(m, t))
    for (let t = half; t < MOVER_PERIOD; t++) expect(moverX(m, t + 1)).toBeLessThan(moverX(m, t))
  })

  it('phase shifts time; negative ticks never happen but stay in range', () => {
    const p = { ...m, phase: 17 }
    for (let t = 0; t < 300; t++) expect(moverX(p, t)).toBe(moverX(m, t + 17))
    expect(moverX(m, -5)).toBe(moverX(m, MOVER_PERIOD - 5))
  })

  it('mirrored mover (x0, x1 negated) is the exact mirror image', () => {
    const mir = { ...m, x0: 1000, x1: -1000 }
    const off = { x0: -2000, x1: 0, phase: 33, h: -500 }
    const offMir = { ...off, x0: 2000, x1: 0 }
    for (let t = 0; t < 2 * MOVER_PERIOD; t++) {
      expect(moverX(mir, t)).toBe(0 - moverX(m, t))
      expect(moverX(offMir, t)).toBe(0 - moverX(off, t))
    }
  })
})

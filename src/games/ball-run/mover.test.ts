import { describe, expect, it } from 'vitest'
import { MOVER_DWELL, MOVER_PERIOD, MOVER_TRAVEL, VX_MAX } from './constants.ts'
import { moverX } from './mover.ts'

describe('moverX (shuttle block position, shared by sim and renderer)', () => {
  const m = { x0: -1000, x1: 1000, phase: 0, h: 0 }
  const half = MOVER_PERIOD / 2

  it('period = 2 travel + 2 dwell = 160; the block is clearly slower than the ball sideways', () => {
    expect(MOVER_TRAVEL).toBe(64)
    expect(MOVER_DWELL).toBe(16)
    expect(MOVER_PERIOD).toBe(2 * MOVER_TRAVEL + 2 * MOVER_DWELL)
    expect(MOVER_PERIOD).toBe(160)
    let maxStep = 0
    for (let t = 0; t < 3 * MOVER_PERIOD; t++) maxStep = Math.max(maxStep, Math.abs(moverX(m, t + 1) - moverX(m, t)))
    expect(maxStep).toBeLessThanOrEqual(35)
    expect(maxStep * 3).toBeLessThan(VX_MAX)
  })

  it('is an integer trapezoid wave: exact endpoints, dwell plateaus, exact period', () => {
    expect(moverX(m, 0)).toBe(-1000)
    expect(moverX(m, half)).toBe(1000)
    expect(moverX(m, MOVER_PERIOD)).toBe(-1000)
    for (let t = 0; t < 4 * MOVER_PERIOD; t++) {
      const x = moverX(m, t)
      expect(Number.isInteger(x), `t=${t}`).toBe(true)
      expect(x).toBeGreaterThanOrEqual(-1000)
      expect(x).toBeLessThanOrEqual(1000)
      expect(moverX(m, t + MOVER_PERIOD)).toBe(x)
      expect(moverX(m, MOVER_PERIOD - (t % MOVER_PERIOD))).toBe(moverX(m, t % MOVER_PERIOD))
    }
    // 끝에서 MOVER_DWELL틱 멈춘다(같은 값 DWELL + 1개 = 움직이지 않는 틱 간격 DWELL개), 그 사이는 한쪽으로만 움직인다.
    const D = MOVER_DWELL / 2
    for (let t = -D; t <= D; t++) expect(moverX(m, t), `left t=${t}`).toBe(-1000)
    for (let t = half - D; t <= half + D; t++) expect(moverX(m, t), `right t=${t}`).toBe(1000)
    expect(moverX(m, D + 1)).toBeGreaterThan(-1000)
    expect(moverX(m, -D - 1)).toBeGreaterThan(-1000)
    expect(moverX(m, half - D - 1)).toBeLessThan(1000)
    for (let t = D; t < half - D; t++) expect(moverX(m, t + 1)).toBeGreaterThan(moverX(m, t))
    for (let t = half + D; t < MOVER_PERIOD - D; t++) expect(moverX(m, t + 1)).toBeLessThan(moverX(m, t))
    let still = 0
    for (let t = 0; t < MOVER_PERIOD; t++) if (moverX(m, t + 1) === moverX(m, t)) still++
    expect(still).toBe(2 * MOVER_DWELL)
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

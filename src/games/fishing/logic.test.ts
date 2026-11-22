import { describe, expect, it } from 'vitest'
import { rngFromSeed } from '../../shared/rng.ts'
import { RODS, SPECIES } from './data.ts'
import { price, rollCatch, sizePercentile } from './logic.ts'

const seedBytes = (n: number): Uint8Array => new Uint8Array(32).map((_, i) => (i * 7 + n) & 255)
const byId = (id: string) => SPECIES.find((s) => s.id === id)!

describe('fishing data', () => {
  it('12 species, ids unique, sizes and prices sane', () => {
    expect(SPECIES).toHaveLength(12)
    expect(new Set(SPECIES.map((s) => s.id)).size).toBe(12)
    for (const s of SPECIES) {
      expect(s.minCm).toBeLessThan(s.maxCm)
      expect(s.basePrice).toBeGreaterThan(0)
    }
    expect(RODS.map((r) => r.price)).toEqual([0, 1500, 8000, 40000])
    for (const r of RODS) expect(Object.values(r.weights).reduce((a, b) => a + b)).toBe(100)
  })
})

describe('price', () => {
  it('min size, max size, perfect', () => {
    expect(price('anchovy', 8, false)).toBe(14)
    expect(price('anchovy', 15, false)).toBe(26)
    expect(price('grouper', 140, true)).toBe(4063)
  })
  it('sizePercentile is clamped to 0..1', () => {
    expect(sizePercentile('anchovy', 8)).toBe(0)
    expect(sizePercentile('anchovy', 15)).toBe(1)
    expect(sizePercentile('anchovy', 100)).toBe(1)
    expect(sizePercentile('anchovy', 0)).toBe(0)
  })
})

describe('rollCatch', () => {
  it('rod 1 never yields rare or legend (10k draws)', () => {
    const rng = rngFromSeed(seedBytes(1))
    for (let i = 0; i < 10000; i++) {
      const c = rollCatch(rng, 1, 0.5)
      expect(['rare', 'legend']).not.toContain(byId(c.species).rarity)
    }
  })
  it('rod 2 never yields grouper; rod 3 can', () => {
    const rng = rngFromSeed(seedBytes(2))
    for (let i = 0; i < 10000; i++) expect(rollCatch(rng, 2, 0.5).species).not.toBe('grouper')
    const rng3 = rngFromSeed(seedBytes(3))
    let seen = false
    for (let i = 0; i < 10000 && !seen; i++) seen = rollCatch(rng3, 3, 0.5).species === 'grouper'
    expect(seen).toBe(true)
  })
  it('size within species range; bite delay 1500~6000, rod 4 1200~4800', () => {
    for (const tier of [1, 4] as const) {
      const rng = rngFromSeed(seedBytes(4 + tier))
      const [lo, hi] = tier === 4 ? [1200, 4800] : [1500, 6000]
      for (let i = 0; i < 5000; i++) {
        const c = rollCatch(rng, tier, 0.5)
        const s = byId(c.species)
        expect(c.sizeCm).toBeGreaterThanOrEqual(s.minCm)
        expect(c.sizeCm).toBeLessThanOrEqual(s.maxCm)
        expect(c.biteDelayMs).toBeGreaterThanOrEqual(lo)
        expect(c.biteDelayMs).toBeLessThanOrEqual(hi)
      }
    }
  })
  it('higher power gives larger mean percentile (power 1 vs 0, 5k draws each)', () => {
    const mean = (power: number): number => {
      const rng = rngFromSeed(seedBytes(9))
      let sum = 0
      for (let i = 0; i < 5000; i++) {
        const c = rollCatch(rng, 3, power)
        sum += sizePercentile(c.species, c.sizeCm)
      }
      return sum / 5000
    }
    expect(mean(1)).toBeGreaterThan(mean(0))
  })
  it('deterministic for the same rng sequence', () => {
    const a = rngFromSeed(seedBytes(7))
    const b = rngFromSeed(seedBytes(7))
    for (let i = 0; i < 100; i++) expect(rollCatch(a, 3, 0.4)).toEqual(rollCatch(b, 3, 0.4))
  })
})

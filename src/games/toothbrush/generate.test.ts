import { describe, expect, it } from 'vitest'
import { rngFromSeed } from '../../shared/rng.ts'
import { W, H, ZONE_COUNT, ZONE_TOTAL, BLOBS } from './constants.ts'
import { isTooth } from './mask.ts'
import { generatePuzzle, puzzleKey } from './generate.ts'

function seedOf(k: number): Uint8Array {
  const s = new Uint8Array(16).fill(0x5a)
  new DataView(s.buffer).setUint32(0, k)
  return s
}

describe('generatePuzzle', () => {
  it('exact_zone_totals_1000_seeds', () => {
    for (let k = 0; k < 1000; k++) {
      const p = generatePuzzle(rngFromSeed(seedOf(k)))
      expect(p.zones.length).toBe(ZONE_COUNT)
      for (let z = 0; z < ZONE_COUNT; z++) {
        const a = p.zones[z]
        expect(a.length).toBe(W * H)
        let sum = 0
        for (let i = 0; i < a.length; i++) {
          const v = a[i]
          if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`bad value seed ${k} z ${z} i ${i}: ${v}`)
          if (!isTooth(z, i) && v !== 0) throw new Error(`non-tooth cell nonzero seed ${k} z ${z} i ${i}`)
          sum += v
        }
        if (sum !== ZONE_TOTAL[z]) throw new Error(`sum mismatch seed ${k} z ${z}: ${sum}`)
      }
    }
  })

  it('deterministic', () => {
    expect(generatePuzzle(rngFromSeed(seedOf(3)))).toEqual(generatePuzzle(rngFromSeed(seedOf(3))))
  })

  it('different_seeds_differ', () => {
    const a = puzzleKey(generatePuzzle(rngFromSeed(seedOf(1))))
    const b = puzzleKey(generatePuzzle(rngFromSeed(seedOf(2))))
    expect(a).not.toBe(b)
  })

  it('puzzle_key_snapshot', () => {
    const key = puzzleKey(generatePuzzle(rngFromSeed(new Uint8Array(16).fill(7))))
    expect(key).toMatch(/^[0-9a-f]{8}$/)
    expect(key).toMatchInlineSnapshot(`"b9228a7f"`)
  })

  it('rng_call_order', () => {
    const inner = rngFromSeed(seedOf(9))
    let n = 0
    generatePuzzle(() => { n++; return inner() })
    expect(n).toBe(ZONE_COUNT * BLOBS * 2)
    expect(n).toBe(72)
  })
})

import { describe, expect, it } from 'vitest'
import { RODS, SPECIES } from './data.ts'
import { SPRITES } from './sprites.ts'

const REQUIRED = [
  'player-idle',
  'player-cast',
  'player-reel',
  'water-0',
  'water-1',
  'pier-plank',
  'pier-post',
  'bobber',
  ...SPECIES.map((s) => `fish-${s.id}`),
  ...RODS.map((r) => `rod-${r.tier}`),
]

describe('SPRITES', () => {
  it('has every required key', () => {
    for (const key of REQUIRED) expect(SPRITES[key], key).toBeDefined()
  })

  it('every sprite matches its size and palette', () => {
    for (const [name, sp] of Object.entries(SPRITES)) {
      expect(sp.rows.length, `${name} rows`).toBe(sp.h)
      sp.rows.forEach((row, y) => {
        expect(row.length, `${name} row ${y} width`).toBe(sp.w)
        for (const ch of row) {
          if (ch !== '.') expect(sp.palette[ch], `${name} row ${y} char '${ch}'`).toBeDefined()
        }
      })
    }
  })

  it('fish fit in 16×16 and the player is 16×24', () => {
    for (const s of SPECIES) {
      const sp = SPRITES[`fish-${s.id}`]
      expect(sp.w, s.id).toBeLessThanOrEqual(16)
      expect(sp.h, s.id).toBeLessThanOrEqual(16)
    }
    for (const pose of ['player-idle', 'player-cast', 'player-reel']) {
      expect([SPRITES[pose].w, SPRITES[pose].h], pose).toEqual([16, 24])
    }
  })

  it('all 12 fish are drawn differently', () => {
    const drawings = SPECIES.map((s) => SPRITES[`fish-${s.id}`].rows.join('\n'))
    expect(new Set(drawings).size).toBe(SPECIES.length)
  })
})

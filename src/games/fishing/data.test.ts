import { describe, expect, it } from 'vitest'
import { inHours, isNight, type Conditions, type Season, type Weather } from './clock.ts'
import { AREAS, areaHasSpecies, DEFAULT_AREAS, RODS, SPECIES, speciesAvailable } from './data.ts'

const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']
const WEATHERS: Weather[] = ['sun', 'rain']
const cond = (season: Season, hour: number, weather: Weather = 'sun', minute = 0): Conditions => ({
  gameMinute: hour * 60 + minute,
  gameDay: 0,
  season,
  weather,
})
const byId = (id: string) => SPECIES.find((s) => s.id === id)!
const OLD_IDS = [
  'anchovy', 'goby', 'horse-mackerel', 'mackerel', 'mullet', 'rockfish',
  'flounder', 'squid', 'red-seabream', 'seabass', 'yellowtail', 'grouper',
]
const BEHAVIORS = ['mixed', 'smooth', 'dart', 'floater', 'sinker']

describe('fishing data', () => {
  it('16 species, ids unique, old 12 ids kept, sizes and prices sane', () => {
    expect(SPECIES).toHaveLength(16)
    expect(new Set(SPECIES.map((s) => s.id)).size).toBe(16)
    for (const id of OLD_IDS) expect(SPECIES.some((s) => s.id === id)).toBe(true)
    for (const s of SPECIES) {
      expect(s.minCm).toBeLessThan(s.maxCm)
      expect(s.basePrice).toBeGreaterThan(0)
      expect(BEHAVIORS).toContain(s.behavior)
      expect(AREAS.map((a) => a.id)).toContain(s.area)
    }
  })
  it('전설 등급과 legend 설정은 함께 다닌다', () => {
    for (const s of SPECIES) expect(s.rarity === 'legend', s.id).toBe(Boolean(s.legend))
  })
  it('초보 상시 물고기: 전갱이는 mixed, 멸치는 dart', () => {
    expect(byId('horse-mackerel').behavior).toBe('mixed')
    expect(byId('anchovy').behavior).toBe('dart')
  })
  it('areas and defaults', () => {
    expect(AREAS.map((a) => a.id)).toEqual(['village', 'river', 'forest', 'lake', 'cave', 'island'])
    expect(DEFAULT_AREAS).toEqual(['village', 'river', 'forest'])
  })
  it('spots are a subset of the area spots, hours are integers in 0..24', () => {
    for (const s of SPECIES) {
      const area = AREAS.find((a) => a.id === s.area)!
      for (const spot of s.spots ?? []) expect(area.spots).toContain(spot)
      if (s.hours) {
        for (const h of s.hours) {
          expect(Number.isInteger(h)).toBe(true)
          expect(h).toBeGreaterThanOrEqual(0)
          expect(h).toBeLessThanOrEqual(24)
        }
      }
    }
  })
  it('rod weights: only common/uncommon/rare, sum 100', () => {
    for (const r of RODS) {
      expect(Object.keys(r.weights).sort()).toEqual(['common', 'rare', 'uncommon'])
      expect(Object.values(r.weights).reduce((a, b) => a + b)).toBe(100)
    }
    expect(RODS.map((r) => r.price)).toEqual([0, 1500, 8000, 40000])
  })
})

describe('village rules', () => {
  it('guarantee: every spot x season x hour x weather has a common candidate at rod 1', () => {
    const village = AREAS.find((a) => a.id === 'village')!
    for (const spot of village.spots) {
      for (const season of SEASONS) {
        for (let h = 0; h < 24; h++) {
          for (const weather of WEATHERS) {
            const c = cond(season, h, weather)
            const ok = SPECIES.some((s) => s.rarity === 'common' && speciesAvailable(s, 'village', spot, c, 1))
            expect(ok, `${spot} ${season} ${h}h ${weather}`).toBe(true)
          }
        }
      }
    }
  })
  it('has night-only, rain, varied behaviors, unconditional commons', () => {
    const village = SPECIES.filter((s) => s.area === 'village')
    const nightOnly = village.filter((s) => s.hours &&
      Array.from({ length: 24 * 4 }, (_, i) => i * 15).filter((m) => inHours(m, s.hours!)).every((m) => isNight(m)))
    expect(nightOnly.length).toBeGreaterThanOrEqual(1)
    expect(village.filter((s) => s.weather === 'rain').length).toBeGreaterThanOrEqual(1)
    expect(new Set(village.map((s) => s.behavior)).size).toBeGreaterThanOrEqual(3)
    const free = village.filter((s) => s.rarity === 'common' && !s.seasons && !s.hours && !s.weather)
    expect(free.length).toBeGreaterThanOrEqual(2)
  })
})

describe('speciesAvailable', () => {
  it('grouper only at pier, winter, rod 3+', () => {
    const g = byId('grouper')
    expect(speciesAvailable(g, 'village', 'pier', cond('winter', 12), 3)).toBe(true)
    expect(speciesAvailable(g, 'village', 'shore', cond('winter', 12), 3)).toBe(false)
    expect(speciesAvailable(g, 'village', 'pier', cond('spring', 12), 3)).toBe(false)
    expect(speciesAvailable(g, 'village', 'pier', cond('winter', 12), 2)).toBe(false)
    expect(speciesAvailable(g, 'river', 'river', cond('winter', 12), 3)).toBe(false)
  })
  it('pufferfish only in sunny summer 12~16h', () => {
    const p = byId('pufferfish')
    expect(speciesAvailable(p, 'village', 'pier', cond('summer', 13), 1)).toBe(true)
    expect(speciesAvailable(p, 'village', 'pier', cond('summer', 13, 'rain'), 1)).toBe(false)
    expect(speciesAvailable(p, 'village', 'pier', cond('summer', 17), 1)).toBe(false)
    expect(speciesAvailable(p, 'village', 'pier', cond('autumn', 13), 1)).toBe(false)
  })
  it('squid crosses midnight: 1:00 yes, 2:00 no', () => {
    const q = byId('squid')
    expect(speciesAvailable(q, 'village', 'pier', cond('winter', 1), 1)).toBe(true)
    expect(speciesAvailable(q, 'village', 'pier', cond('winter', 2), 1)).toBe(false)
  })
})

describe('areaHasSpecies', () => {
  it('village has species, river has none yet', () => {
    expect(areaHasSpecies('village')).toBe(true)
    expect(areaHasSpecies('river')).toBe(false)
  })
})

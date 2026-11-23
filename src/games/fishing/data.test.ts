import { describe, expect, it } from 'vitest'
import { inHours, isNight, type Conditions, type Season, type Weather } from './clock.ts'
import { SPRITES } from './sprites.ts'
import { AREAS, areaHasSpecies, DEFAULT_AREAS, RODS, SPECIES, speciesAvailable, TACKLE_FX, TACKLES, tackleSlots, UNLOCKS } from './data.ts'

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
  it('33 species, ids unique, old 12 ids kept, sizes and prices sane', () => {
    expect(SPECIES).toHaveLength(33)
    expect(new Set(SPECIES.map((s) => s.id)).size).toBe(33)
    for (const id of OLD_IDS) expect(SPECIES.some((s) => s.id === id)).toBe(true)
    for (const s of SPECIES) {
      expect(s.minCm).toBeLessThan(s.maxCm)
      expect(s.basePrice).toBeGreaterThan(0)
      expect(BEHAVIORS).toContain(s.behavior)
      expect(AREAS.map((a) => a.id)).toContain(s.area)
    }
  })
  it('1단계 마을 16종 값은 그대로다(스냅숏)', () => {
    const village = SPECIES.filter((s) => s.area === 'village')
    expect(village).toHaveLength(16)
    expect(village).toMatchSnapshot()
  })
  it('모든 어종에 fish-<id> 스프라이트가 있다', () => {
    for (const s of SPECIES) expect(SPRITES[`fish-${s.id}`], s.id).toBeDefined()
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
  it('UNLOCKS: lake·cave·island, 가격 5000/15000/50000', () => {
    expect(Object.keys(UNLOCKS)).toEqual(['lake', 'cave', 'island'])
    expect(UNLOCKS.lake).toEqual({ price: 5000, name: '무너진 다리 수리' })
    expect(UNLOCKS.cave).toEqual({ price: 15000, name: '동굴 장비' })
    expect(UNLOCKS.island).toEqual({ price: 50000, name: '배' })
    for (const id of Object.keys(UNLOCKS)) expect(DEFAULT_AREAS).not.toContain(id)
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

const SPECIES_AREAS = AREAS.filter((a) => areaHasSpecies(a.id))
const nightOnly = (s: (typeof SPECIES)[number]) =>
  Boolean(s.hours) &&
  Array.from({ length: 24 * 4 }, (_, i) => i * 15).filter((m) => inHours(m, s.hours!)).every((m) => isNight(m))

describe('area guarantee', () => {
  it('어종이 있는 모든 지역 x 자리 x 계절 x 정각 x 날씨에서 rod 1 common이 하나 이상', () => {
    expect(SPECIES_AREAS.map((a) => a.id)).toEqual(['village', 'river', 'forest'])
    for (const area of SPECIES_AREAS) {
      for (const spot of area.spots) {
        for (const season of SEASONS) {
          for (let h = 0; h < 24; h++) {
            for (const weather of WEATHERS) {
              const c = cond(season, h, weather)
              const ok = SPECIES.some((s) => s.rarity === 'common' && speciesAvailable(s, area.id, spot, c, 1))
              expect(ok, `${area.id}/${spot} ${season} ${h}h ${weather}`).toBe(true)
            }
          }
        }
      }
    }
  })
})

describe('area rules', () => {
  it.each(['village', 'river', 'forest'] as const)('%s: 상시 common 2종 이상, 밤 전용·비 전용 1종 이상, 행동 유형 3가지 이상, 전설 정확히 1종', (id) => {
    const list = SPECIES.filter((s) => s.area === id)
    const free = list.filter((s) => s.rarity === 'common' && !s.seasons && !s.hours && !s.weather)
    expect(free.length).toBeGreaterThanOrEqual(2)
    expect(list.filter(nightOnly).length).toBeGreaterThanOrEqual(1)
    expect(list.filter((s) => s.weather === 'rain').length).toBeGreaterThanOrEqual(1)
    expect(new Set(list.map((s) => s.behavior)).size).toBeGreaterThanOrEqual(3)
    expect(list.filter((s) => s.rarity === 'legend')).toHaveLength(1)
  })
  it('지역별 어종 수: 마을 16, 강 9, 숲 8', () => {
    const n = (id: string) => SPECIES.filter((s) => s.area === id).length
    expect([n('village'), n('river'), n('forest')]).toEqual([16, 9, 8])
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
  it('village·river·forest true, lake false', () => {
    expect(areaHasSpecies('village')).toBe(true)
    expect(areaHasSpecies('river')).toBe(true)
    expect(areaHasSpecies('forest')).toBe(true)
    expect(areaHasSpecies('lake')).toBe(false)
  })
})

describe('찌', () => {
  it('TACKLES 5종 id·가격, 이름·설명 있음', () => {
    expect(TACKLES.map((t) => [t.id, t.price])).toEqual([['cork', 1000], ['trap', 1500], ['barbed', 2000], ['spinner', 1500], ['curious', 5000]])
    for (const t of TACKLES) {
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.desc.length).toBeGreaterThan(0)
    }
  })
  it('tackleSlots(1..4) = 0,0,1,2, 모르는 단계는 0', () => {
    expect([1, 2, 3, 4].map(tackleSlots)).toEqual([0, 0, 1, 2])
    expect(tackleSlots(99)).toBe(0)
  })
  it('TACKLE_FX 값', () => {
    expect(TACKLE_FX).toEqual({ corkBar: 1.2, trapDrain: 0.75, spinnerBite: 0.7, curiousRare: 1.5, curiousLegend: 1.5 })
  })
})

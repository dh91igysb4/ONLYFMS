import { describe, expect, it } from 'vitest'
import { inHours, isNight, type Conditions, type Season, type Weather } from './clock.ts'
import { SPRITES } from './sprites.ts'
import { AREAS, areaHasSpecies, CHALLENGES, DEFAULT_AREAS, TP_BASE, TP_PER_10, RODS, SPECIES, speciesAvailable, TACKLE_FX, TACKLES, tackleSlots, UNLOCKS } from './data.ts'

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
  it('56 species, ids unique, old 12 ids kept, sizes and prices sane', () => {
    expect(SPECIES).toHaveLength(56)
    expect(new Set(SPECIES.map((s) => s.id)).size).toBe(56)
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
  it('기존 33종(마을·강·숲) 값은 그대로다', () => {
    const old = SPECIES.filter((s) => ['village', 'river', 'forest'].includes(s.area))
    expect(old).toHaveLength(33)
    expect(SPECIES.slice(0, 33)).toEqual(old)
    expect(old).toMatchSnapshot()
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
    expect(RODS.map((r) => r.price)).toEqual([0, 1500, 8000, 40000, 280_000, 620_000])
  })
})

const SPECIES_AREAS = AREAS.filter((a) => areaHasSpecies(a.id))
const nightOnly = (s: (typeof SPECIES)[number]) =>
  Boolean(s.hours) &&
  Array.from({ length: 24 * 4 }, (_, i) => i * 15).filter((m) => inHours(m, s.hours!)).every((m) => isNight(m))

describe('area guarantee', () => {
  it('어종이 있는 모든 지역 x 자리 x 계절 x 정각 x 날씨에서 rod 1 common이 하나 이상', () => {
    expect(SPECIES_AREAS.map((a) => a.id)).toEqual(['village', 'river', 'forest', 'lake', 'cave', 'island'])
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
  it.each(['village', 'river', 'forest', 'lake', 'cave', 'island'] as const)('%s: 상시 common 2종 이상, 밤 전용·비 전용 1종 이상(동굴 제외), 행동 유형 3가지 이상, 전설 정확히 1종', (id) => {
    const list = SPECIES.filter((s) => s.area === id)
    const free = list.filter((s) => s.rarity === 'common' && !s.seasons && !s.hours && !s.weather)
    expect(free.length).toBeGreaterThanOrEqual(2)
    if (id !== 'cave') {
      expect(list.filter(nightOnly).length).toBeGreaterThanOrEqual(1)
      expect(list.filter((s) => s.weather === 'rain').length).toBeGreaterThanOrEqual(1)
    }
    expect(new Set(list.map((s) => s.behavior)).size).toBeGreaterThanOrEqual(3)
    expect(list.filter((s) => s.rarity === 'legend')).toHaveLength(1)
  })
  it('지역별 어종 수: 마을 16, 강 9, 숲 8, 호수 8, 동굴 7, 섬 8', () => {
    const n = (id: string) => SPECIES.filter((s) => s.area === id).length
    expect([n('village'), n('river'), n('forest'), n('lake'), n('cave'), n('island')]).toEqual([16, 9, 8, 8, 7, 8])
  })
  it('동굴 어종은 계절·시간·날씨 조건이 없고, 섬 어종은 계절 조건이 없다', () => {
    for (const s of SPECIES.filter((x) => x.area === 'cave')) {
      expect(s.seasons, s.id).toBeUndefined()
      expect(s.hours, s.id).toBeUndefined()
      expect(s.weather, s.id).toBeUndefined()
      expect(s.spots, s.id).toHaveLength(1)
    }
    for (const s of SPECIES.filter((x) => x.area === 'island')) {
      expect(s.seasons, s.id).toBeUndefined()
      expect(s.spots, s.id).toHaveLength(1)
    }
    for (const s of SPECIES.filter((x) => x.area === 'lake')) expect(s.spots, s.id).toBeUndefined()
  })
  it('호수·동굴·섬 전설: 값이 표와 같다', () => {
    expect(byId('silver-king-trout')).toMatchObject({ area: 'lake', seasons: ['autumn'], hours: [4, 7], minRod: 3, legend: { power: 0.95 } })
    expect(byId('fire-dragonfish')).toMatchObject({ area: 'cave', spots: ['cave3'], minRod: 4, legend: { power: 0.95 } })
    expect(byId('rainbow-marlin')).toMatchObject({ area: 'island', spots: ['sea'], weather: 'sun', hours: [11, 14], minRod: 4, legend: { power: 0.95 } })
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
  it('여섯 지역 모두 true', () => {
    expect(areaHasSpecies('village')).toBe(true)
    expect(areaHasSpecies('river')).toBe(true)
    expect(areaHasSpecies('forest')).toBe(true)
    for (const id of ['lake', 'cave', 'island'] as const) expect(areaHasSpecies(id)).toBe(true)
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
  it('tackleSlots(1..6) = 0,0,1,2,2,3, 모르는 단계는 0', () => {
    expect([1, 2, 3, 4, 5, 6].map(tackleSlots)).toEqual([0, 0, 1, 2, 2, 3])
    expect(tackleSlots(99)).toBe(0)
  })
  it('TACKLE_FX 값', () => {
    expect(TACKLE_FX).toEqual({ corkBar: 1.2, trapDrain: 0.75, spinnerBite: 0.7, curiousRare: 1.5, curiousLegend: 1.5 })
  })
})

describe('도전과제', () => {
  it('6개, 지역마다 하나(AREAS 순서), id 유일, 제목·설명 있음, count ≥ 1, spot은 그 지역 자리', () => {
    expect(CHALLENGES.map((c) => c.area)).toEqual(AREAS.map((a) => a.id))
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length)
    expect(CHALLENGES.map((c) => c.id)).toEqual(['pier-perfect', 'river-rain', 'forest-variety', 'lake-night', 'cave-deep', 'island-big'])
    for (const c of CHALLENGES) {
      expect(c.title.length, c.id).toBeGreaterThan(0)
      expect(c.desc.length, c.id).toBeGreaterThan(0)
      expect(Number.isInteger(c.count) && c.count >= 1, c.id).toBe(true)
      if (c.filter.spot) expect(AREAS.find((a) => a.id === c.area)!.spots, c.id).toContain(c.filter.spot)
      if (c.filter.minSizePct !== undefined) expect(c.filter.minSizePct > 0 && c.filter.minSizePct < 1, c.id).toBe(true)
    }
  })

  it('어떤 계절에도 깰 수 있다: 계절마다 rod 1로 조건(자리·날씨·밤)을 만족하는 어종이 있고, distinct면 count종 이상', () => {
    for (const c of CHALLENGES) {
      const area = AREAS.find((a) => a.id === c.area)!
      const spots = c.filter.spot ? [c.filter.spot] : area.spots
      const weathers: Weather[] = c.filter.weather ? [c.filter.weather] : WEATHERS
      const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) => !c.filter.night || isNight(h * 60))
      for (const season of SEASONS) {
        const found = new Set<string>()
        for (const spot of spots) for (const weather of weathers) for (const h of hours) {
          for (const s of SPECIES) if (!s.legend && speciesAvailable(s, c.area, spot, cond(season, h, weather), 1)) found.add(s.id)
        }
        expect(found.size, `${c.id} ${season}`).toBeGreaterThanOrEqual(c.filter.distinct ? c.count : 1)
      }
    }
  })

  it('순간이동 요금 상수', () => {
    expect([TP_BASE, TP_PER_10]).toEqual([30, 1])
  })
})

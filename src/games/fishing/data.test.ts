import { describe, expect, it } from 'vitest'
import { inHours, isNight, type Conditions, type Season, type Weather } from './clock.ts'
import { SPRITES } from './sprites.ts'
import { M1_FIXTURE, withTempData } from './testFixtures.ts'
import {
  AREAS, FISHING_AREAS, areaHasSpecies, areaMinRod, rodAtLeast, BUFF_FX, BUFFS, CHALLENGES, DEFAULT_AREAS, MYTHIC_CHANCE, TIDE_GRACE_MIN, TP_BASE, TP_PER_10, RODS, SPECIES,
  speciesAvailable, spotOpen, TACKLE_FX, TACKLES, tackleSlots, UNLOCKS, SHOES, shoeSpeed, type Species,
} from './data.ts'

const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']
const WEATHERS: Weather[] = ['sun', 'rain']
const cond = (season: Season, hour: number, weather: Weather = 'sun', minute = 0): Conditions => ({
  gameMinute: hour * 60 + minute,
  gameDay: 0,
  season,
  weather,
})
const byId = (id: string) => SPECIES.find((s) => s.id === id)!
/** 어종 확장(2026-11-25) 전부터 있던 앞 94종 */
const OLD94 = () => SPECIES.slice(0, 94)
const OLD_IDS = [
  'anchovy', 'goby', 'horse-mackerel', 'mackerel', 'mullet', 'rockfish',
  'flounder', 'squid', 'red-seabream', 'seabass', 'yellowtail', 'grouper',
]
const BEHAVIORS = ['mixed', 'smooth', 'dart', 'floater', 'sinker', 'surge']

describe('fishing data', () => {
  it('169 species, ids·names unique, old 12 ids kept, sizes and prices sane', () => {
    expect(SPECIES).toHaveLength(169)
    expect(new Set(SPECIES.map((s) => s.id)).size).toBe(169)
    expect(new Set(SPECIES.map((s) => s.name)).size).toBe(169)
    for (const id of OLD_IDS) expect(SPECIES.some((s) => s.id === id)).toBe(true)
    for (const s of SPECIES) {
      expect(s.minCm).toBeLessThan(s.maxCm)
      expect(s.basePrice).toBeGreaterThan(0)
      expect(BEHAVIORS).toContain(s.behavior)
      expect(AREAS.map((a) => a.id)).toContain(s.area)
    }
  })
  it('1단계 마을 16종 값은 그대로다(스냅숏)', () => {
    const village = OLD94().filter((s) => s.area === 'village')
    expect(village).toHaveLength(16)
    expect(village).toMatchSnapshot()
  })
  it('기존 33종(마을·강·숲) 값은 그대로다', () => {
    const old = OLD94().filter((s) => ['village', 'river', 'forest'].includes(s.area))
    expect(old).toHaveLength(33)
    expect(SPECIES.slice(0, 33)).toEqual(old)
    expect(old).toMatchSnapshot()
  })
  it('기존 56종 값은 그대로(앞 56종 순서·값), 새 19종(갯벌·늪지) 스냅숏', () => {
    const old = OLD94().filter((s) => !['tideflat', 'swamp', 'summit', 'wreck'].includes(s.area))
    expect(old).toHaveLength(56)
    expect(SPECIES.slice(0, 56)).toEqual(old)
    expect(old).toMatchSnapshot()
    expect(SPECIES.slice(56, 75)).toMatchSnapshot()
  })
  it('기존 75종 값은 그대로(앞 75종 순서·값), 새 19종(산정 호수·난파선) 스냅숏', () => {
    const old = OLD94().filter((s) => !['summit', 'wreck'].includes(s.area))
    expect(old).toHaveLength(75)
    expect(SPECIES.slice(0, 75)).toEqual(old)
    expect(SPECIES.slice(75, 94)).toHaveLength(19)
    expect(SPECIES.slice(75, 94)).toMatchSnapshot()
  })
  it('어종 확장(2026-11-25): 새 75종은 앞 94종 뒤에 지역 순서로, 조건 없는 흔함·드묾·희귀(스냅숏)', () => {
    const added = SPECIES.slice(94)
    expect(added).toHaveLength(75)
    const order = ['village', 'river', 'forest', 'lake', 'cave', 'tideflat', 'island', 'swamp', 'summit', 'wreck']
    const idx = added.map((s) => order.indexOf(s.area))
    expect(idx.every((v, i) => v >= 0 && (i === 0 || v >= idx[i - 1]))).toBe(true)
    for (const s of added) {
      expect([s.seasons, s.hours, s.weather, s.legend], s.id).toEqual([undefined, undefined, undefined, undefined])
      expect(['common', 'uncommon', 'rare'], s.id).toContain(s.rarity)
    }
    expect(added).toMatchSnapshot()
  })
  it('모든 자리·순간에 흔함 4·드묾 2·희귀 1 이상(물때 자리는 열린 시각만, 희귀는 낚싯대 4·난파선 5 기준)', () => {
    for (const a of FISHING_AREAS) {
      for (const spot of a.spots) {
        for (const season of SEASONS) {
          for (let hour = 0; hour < 24; hour++) {
            for (const weather of WEATHERS) {
              const k = cond(season, hour, weather)
              if (!spotOpen(a.id, spot, k.gameMinute)) continue
              const where = `${a.id}/${spot} ${season} ${hour}시 ${weather}`
              const count = (rarity: string, rod: number) =>
                SPECIES.filter((s) => !s.legend && s.rarity === rarity && speciesAvailable(s, a.id, spot, k, rod)).length
              expect(count('common', areaMinRod(a.id)), where).toBeGreaterThanOrEqual(4)
              expect(count('uncommon', areaMinRod(a.id)), where).toBeGreaterThanOrEqual(2)
              expect(count('rare', Math.max(areaMinRod(a.id), 4)), where).toBeGreaterThanOrEqual(1)
            }
          }
        }
      }
    }
  })
  it('모든 어종에 fish-<id> 스프라이트가 있다', () => {
    for (const s of SPECIES) expect(SPRITES[`fish-${s.id}`], s.id).toBeDefined()
  })
  it('legend 필드 ⇔ 등급 전설·신화, needs·buff ⇔ 신화, buff는 BUFFS id이고 신화마다 다르다', () => {
    const buffIds = BUFFS.map((b) => b.id) as string[]
    const legendIds = SPECIES.filter((s) => s.rarity === 'legend').map((s) => s.id)
    const used: string[] = []
    for (const s of SPECIES) {
      expect(s.rarity === 'legend' || s.rarity === 'mythic', s.id).toBe(Boolean(s.legend))
      const mythic = s.rarity === 'mythic'
      expect(Boolean(s.legend?.needs), s.id).toBe(mythic)
      expect(Boolean(s.legend?.buff), s.id).toBe(mythic)
      if (mythic) {
        expect(buffIds, s.id).toContain(s.legend!.buff)
        expect(s.legend!.needs!.length, s.id).toBeGreaterThan(0)
        for (const id of s.legend!.needs!) expect(legendIds, `${s.id} needs ${id}`).toContain(id)
        used.push(s.legend!.buff!)
      }
    }
    expect(new Set(used).size).toBe(used.length)
  })
  it('초보 상시 물고기: 전갱이는 mixed, 멸치는 dart', () => {
    expect(byId('horse-mackerel').behavior).toBe('mixed')
    expect(byId('anchovy').behavior).toBe('dart')
  })
  it('areas and defaults', () => {
    expect(AREAS.map((a) => a.id)).toEqual(['village', 'river', 'forest', 'lake', 'cave', 'island', 'tideflat', 'swamp', 'summit', 'wreck', 'hall', 'hall2', 'isle', 'home'])
    expect(FISHING_AREAS.map((a) => a.id)).toEqual(['village', 'river', 'forest', 'lake', 'cave', 'island', 'tideflat', 'swamp', 'summit', 'wreck'])
    expect(DEFAULT_AREAS).toEqual(['village', 'river', 'forest', 'hall', 'isle', 'home'])
    expect(AREAS.find((a) => a.id === 'isle')).toEqual({ id: 'isle', name: '내 섬', spots: [] })
    expect(AREAS.find((a) => a.id === 'hall')).toEqual({ id: 'hall', name: '마을회관', spots: [] })
  })
  it('UNLOCKS: lake·cave·island 5000/15000/50000, 갯벌·늪지 30000/132000, 산정·난파선 264000/330000(v15)(난파선은 백골 이상)', () => {
    expect(Object.keys(UNLOCKS)).toEqual(['lake', 'cave', 'island', 'tideflat', 'swamp', 'summit', 'wreck'])
    expect(UNLOCKS.summit).toEqual({ price: 264000, name: '등산 장비' })
    expect(UNLOCKS.wreck).toEqual({ price: 330000, name: '원양 어선', minRod: 5 })
    expect(AREAS.find((a) => a.id === 'summit')).toEqual({ id: 'summit', name: '산정 호수', spots: ['ice', 'hotspring'] })
    expect(AREAS.find((a) => a.id === 'wreck')).toEqual({ id: 'wreck', name: '난파선 앞바다', spots: ['wreck', 'abyss'], minRod: 5 })
    expect(UNLOCKS.tideflat).toEqual({ price: 30000, name: '갯벌 장화' })
    expect(UNLOCKS.swamp).toEqual({ price: 132000, name: '늪 나무 데크' })
    expect(AREAS.find((a) => a.id === 'tideflat')).toEqual({ id: 'tideflat', name: '갯벌', spots: ['estuary', 'creek'], tideSpots: ['creek'] })
    expect(AREAS.find((a) => a.id === 'swamp')).toEqual({ id: 'swamp', name: '늪지', spots: ['marsh', 'bog'] })
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
    expect(RODS.map((r) => r.price)).toEqual([0, 1500, 8000, 40000, 448_000, 992_000])
  })
})

const SPECIES_AREAS = AREAS.filter((a) => areaHasSpecies(a.id))
const nightOnly = (s: (typeof SPECIES)[number]) =>
  Boolean(s.hours) &&
  Array.from({ length: 24 * 4 }, (_, i) => i * 15).filter((m) => inHours(m, s.hours!)).every((m) => isNight(m))

describe('area guarantee', () => {
  it('어종이 있는 모든 지역 x 자리(열린 시각만) x 계절 x 정각 x 날씨에서 지역 최소 낚싯대로 common이 하나 이상', () => {
    expect(SPECIES_AREAS.map((a) => a.id)).toEqual(['village', 'river', 'forest', 'lake', 'cave', 'island', 'tideflat', 'swamp', 'summit', 'wreck'])
    for (const area of SPECIES_AREAS) {
      for (const spot of area.spots) {
        for (const season of SEASONS) {
          for (let h = 0; h < 24; h++) {
            for (const weather of WEATHERS) {
              const c = cond(season, h, weather)
              if (!spotOpen(area.id, spot, c.gameMinute)) continue
              const ok = SPECIES.some((s) => s.rarity === 'common' && speciesAvailable(s, area.id, spot, c, areaMinRod(area.id)))
              expect(ok, `${area.id}/${spot} ${season} ${h}h ${weather}`).toBe(true)
            }
          }
        }
      }
    }
  })
})

describe('area rules', () => {
  it.each(['village', 'river', 'forest', 'lake', 'cave', 'island', 'tideflat', 'swamp', 'summit', 'wreck'] as const)('%s: 상시 common 2종 이상, 밤 전용·비 전용 1종 이상(동굴 제외), 행동 유형 3가지 이상, 전설 정확히 1종', (id) => {
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
  it('지역별 어종 수: 마을 19, 강 12, 숲 19, 호수 13, 동굴 16, 섬 18, 갯벌 18, 늪지 16, 산정 18, 난파선 20', () => {
    const n = (id: string) => SPECIES.filter((s) => s.area === id).length
    expect([n('village'), n('river'), n('forest'), n('lake'), n('cave'), n('island'), n('tideflat'), n('swamp'), n('summit'), n('wreck')]).toEqual([19, 12, 19, 13, 16, 18, 18, 16, 18, 20])
  })
  it('산정 호수·난파선 어종은 계절 조건이 없고, 난파선 어종은 모두 낚싯대 5단계 이상(용왕은 6)', () => {
    for (const s of SPECIES.filter((x) => x.area === 'summit' || x.area === 'wreck')) expect(s.seasons, s.id).toBeUndefined()
    for (const s of SPECIES.filter((x) => x.area === 'wreck')) expect(s.minRod, s.id).toBeGreaterThanOrEqual(5)
    expect(byId('dragon-king').minRod).toBe(6)
  })
  it('산정·난파선 전설과 신화 둘: 값이 표와 같다', () => {
    expect(byId('snowwhite-taimen')).toMatchObject({ area: 'summit', rarity: 'legend', spots: ['ice'], hours: [5, 8], weather: 'sun', minRod: 4, legend: { power: 0.95 } })
    expect(byId('oarfish')).toMatchObject({ area: 'wreck', rarity: 'legend', spots: ['abyss'], hours: [22, 2], minRod: 5, legend: { power: 0.95 } })
    expect(byId('white-dragon')).toMatchObject({
      area: 'summit', rarity: 'mythic', basePrice: 24000, minRod: 5, behavior: 'surge', spots: ['ice'], hours: [0, 4], weather: 'sun',
      legend: { power: 0.95, needs: ['silver-king-trout', 'snowwhite-taimen'], buff: 'dragon-breath' },
    })
    expect(byId('dragon-king')).toMatchObject({
      area: 'wreck', rarity: 'mythic', basePrice: 30000, minRod: 6, behavior: 'surge', spots: ['abyss'], weather: 'rain',
      legend: { power: 0.98, needs: ['grouper', 'rainbow-marlin', 'oarfish'], buff: 'dragon-pearl' },
    })
  })
  it('늪지: 이무기·전설을 뺀 14종 중 비·밤 전용 5종(기존 8종), 새 6종은 상시', () => {
    const list = SPECIES.filter((s) => s.area === 'swamp' && !s.legend)
    expect(list).toHaveLength(14)
    expect(list.filter((s) => s.weather === 'rain' || nightOnly(s)).length).toBe(5)
  })
  it('갯벌·늪지 전설과 이무기: 값이 표와 같다', () => {
    expect(byId('king-croaker')).toMatchObject({ area: 'tideflat', rarity: 'legend', spots: ['creek'], seasons: ['summer'], hours: [2, 5], minRod: 4, legend: { power: 0.95 } })
    expect(byId('thousand-turtle')).toMatchObject({ area: 'swamp', rarity: 'legend', spots: ['bog'], hours: [4, 8], weather: 'rain', minRod: 4, legend: { power: 0.95 } })
    expect(byId('imugi')).toMatchObject({
      area: 'swamp', rarity: 'mythic', basePrice: 20000, minRod: 5, behavior: 'surge', spots: ['bog'], hours: [20, 5], weather: 'rain',
      legend: { power: 0.95, needs: ['century-snakehead', 'thousand-turtle'], buff: 'imugi-scale' },
    })
  })
  it('갯골 전설(왕민어)의 시간은 썰물 안이라 열린 갯골에서만 나온다', () => {
    const k = byId('king-croaker')
    for (let m = 0; m < 1440; m += 10) if (inHours(m, k.hours!)) expect(spotOpen('tideflat', 'creek', m), `${m}`).toBe(true)
  })
})

describe('신화 규칙 (동시 후보 없음)', () => {
  it('신화마다 그 지역·자리에서 나올 수 있는 모든 전설이 needs에 있다', () => {
    for (const m of SPECIES.filter((s) => s.rarity === 'mythic')) {
      const spots = m.spots ?? AREAS.find((a) => a.id === m.area)!.spots
      const legends = SPECIES.filter((s) => s.rarity === 'legend' && s.area === m.area && (s.spots ?? AREAS.find((a) => a.id === s.area)!.spots).some((x) => spots.includes(x)))
      expect(legends.length, m.id).toBeGreaterThan(0)
      for (const l of legends) expect(m.legend!.needs, `${m.id} needs ${l.id}`).toContain(l.id)
    }
  })
  it('신화 셋(늪지 이무기·산정 천지 백룡·난파선 용왕), 버프가 셋 모두 다르다', () => {
    expect(SPECIES.filter((s) => s.rarity === 'mythic').map((s) => [s.id, s.area, s.legend!.buff])).toEqual([
      ['imugi', 'swamp', 'imugi-scale'], ['white-dragon', 'summit', 'dragon-breath'], ['dragon-king', 'wreck', 'dragon-pearl'],
    ])
  })
  it('천지 백룡 needs ⊇ {설백 자치}, 용왕 needs ⊇ {산갈치}; needs는 모두 전설 id', () => {
    expect(byId('white-dragon').legend!.needs).toContain('snowwhite-taimen')
    expect(byId('dragon-king').legend!.needs).toContain('oarfish')
    for (const m of SPECIES.filter((s) => s.rarity === 'mythic')) for (const id of m.legend!.needs!) expect(byId(id).rarity, `${m.id} → ${id}`).toBe('legend')
  })
  it('동굴 어종은 계절·시간·날씨 조건이 없고, 섬 어종은 계절 조건이 없다', () => {
    for (const s of SPECIES.filter((x) => x.area === 'cave')) {
      expect(s.seasons, s.id).toBeUndefined()
      expect(s.hours, s.id).toBeUndefined()
      expect(s.weather, s.id).toBeUndefined()
      // 동굴 어종은 자리를 밝혀 둔다: 기존 94종은 한 자리, 확장(2026-11-25) 공용 어종은 세 자리 모두
      if (SPECIES.indexOf(s) < 94) expect(s.spots, s.id).toHaveLength(1)
      else expect(s.spots?.length, s.id).toBeGreaterThanOrEqual(1)
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
  it('모든 지역 true', () => {
    for (const a of FISHING_AREAS) expect(areaHasSpecies(a.id), a.id).toBe(true)
    expect(areaHasSpecies('hall')).toBe(false)
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
    expect(TACKLE_FX).toEqual({ corkBar: 1.2, trapDrain: 0.75, spinnerBite: 0.7, curiousRare: 1.5, curiousLegend: 1.5, curiousMythic: 1.5 })
  })
  it('호기심 찌 설명에 신화', () => {
    expect(TACKLES.find((t) => t.id === 'curious')!.desc).toBe('희귀·전설·신화 물고기가 더 잘 나와요')
  })
})

describe('도전과제', () => {
  it('10개, 지역마다 하나(AREAS 순서), id 유일, 제목·설명 있음, count ≥ 1, spot은 그 지역 자리', () => {
    expect(CHALLENGES.map((c) => c.area)).toEqual(FISHING_AREAS.map((a) => a.id))
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length)
    expect(CHALLENGES.map((c) => c.id)).toEqual(['pier-perfect', 'river-rain', 'forest-variety', 'lake-night', 'cave-deep', 'island-big', 'tideflat-creek', 'swamp-rain-night', 'summit-perfect', 'wreck-abyss-night'])
    expect(CHALLENGES.at(-2)).toEqual({ id: 'summit-perfect', area: 'summit', title: '얼음 위의 인내', desc: '얼음 구멍에서 완벽하게 3마리 낚기', count: 3, filter: { spot: 'ice', perfect: true }, freeBonusPct: 60 })
    expect(CHALLENGES.at(-1)).toEqual({ id: 'wreck-abyss-night', area: 'wreck', title: '심해의 밤', desc: '밤(20~5시) 심해에서 5마리 낚기', count: 5, filter: { spot: 'abyss', night: true }, freeBonusPct: 80 })
    expect(CHALLENGES.at(-4)).toEqual({ id: 'tideflat-creek', area: 'tideflat', title: '물때를 아는 사람', desc: '갯골에서 5마리 낚기', count: 5, filter: { spot: 'creek' }, freeBonusPct: 40 })
    expect(CHALLENGES.at(-3)).toEqual({ id: 'swamp-rain-night', area: 'swamp', title: '안개 속의 밤낚시', desc: '비 오는 밤 늪지에서 3마리 낚기', count: 3, filter: { weather: 'rain', night: true }, freeBonusPct: 40 })
    for (const c of CHALLENGES) {
      expect(c.title.length, c.id).toBeGreaterThan(0)
      expect(c.desc.length, c.id).toBeGreaterThan(0)
      expect(Number.isInteger(c.count) && c.count >= 1, c.id).toBe(true)
      if (c.filter.spot) expect(AREAS.find((a) => a.id === c.area)!.spots, c.id).toContain(c.filter.spot)
      if (c.filter.minSizePct !== undefined) expect(c.filter.minSizePct > 0 && c.filter.minSizePct < 1, c.id).toBe(true)
    }
  })

  it('어떤 계절에도 깰 수 있다: 계절마다 지역 최소 낚싯대로 조건(자리·날씨·밤)을 만족하는 어종이 있고(자리가 열린 시각만), distinct면 count종 이상', () => {
    for (const c of CHALLENGES) {
      const area = AREAS.find((a) => a.id === c.area)!
      const spots = c.filter.spot ? [c.filter.spot] : area.spots
      const weathers: Weather[] = c.filter.weather ? [c.filter.weather] : WEATHERS
      const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) => !c.filter.night || isNight(h * 60))
      for (const season of SEASONS) {
        const found = new Set<string>()
        for (const spot of spots) for (const weather of weathers) for (const h of hours) {
          if (!spotOpen(c.area, spot, h * 60)) continue
          for (const s of SPECIES) if (!s.legend && speciesAvailable(s, c.area, spot, cond(season, h, weather), areaMinRod(c.area))) found.add(s.id)
        }
        expect(found.size, `${c.id} ${season}`).toBeGreaterThanOrEqual(c.filter.distinct ? c.count : 1)
      }
    }
  })

  it('순간이동 요금 상수', () => {
    expect([TP_BASE, TP_PER_10]).toEqual([30, 1])
  })
})

describe('물때 자리·지역 최소 낚싯대', () => {
  it('spotOpen: tideSpots 없는 자리는 늘 열림, 갯골은 썰물(2~6시·14~18시)에만, 모르는 지역·자리는 false', () => {
    for (const a of AREAS) for (const spot of a.spots) {
      if (a.tideSpots?.includes(spot)) continue
      for (let m = 0; m < 1440; m += 30) expect(spotOpen(a.id, spot, m), `${a.id}/${spot}`).toBe(true)
    }
    const open = Array.from({ length: 24 }, (_, h) => h).filter((h) => spotOpen('tideflat', 'creek', h * 60 + 30))
    expect(open).toEqual([2, 3, 4, 5, 14, 15, 16, 17])
    expect(spotOpen('village', 'nowhere', 0)).toBe(false)
    expect(spotOpen('atlantis' as never, 'pier', 0)).toBe(false)
  })
  it('spotOpen: tideSpots 자리는 썰물에만 열린다(합성 지역)', () => {
    const areas = AREAS as unknown as { id: string; name: string; spots: string[]; tideSpots?: string[] }[]
    areas.push({ id: 'tmp-flat', name: '임시', spots: ['bank', 'gully'], tideSpots: ['gully'] })
    try {
      const id = 'tmp-flat' as never
      expect(spotOpen(id, 'gully', 3 * 60)).toBe(true)
      expect(spotOpen(id, 'gully', 6 * 60)).toBe(false)
      expect(spotOpen(id, 'gully', 15 * 60)).toBe(true)
      expect(spotOpen(id, 'bank', 6 * 60)).toBe(true)
    } finally {
      areas.pop()
    }
  })
  it('areaMinRod: 난파선만 5, 나머지 지역·모르는 지역은 1', () => {
    for (const a of AREAS) expect(areaMinRod(a.id), a.id).toBe(a.id === 'wreck' ? 5 : 1)
    expect(areaMinRod('atlantis' as never)).toBe(1)
  })
  it('rodAtLeast: 낚싯대 이름 + 이상, 모르는 단계는 n단계', () => {
    expect(rodAtLeast(5)).toBe('백골 낚싯대 이상')
    expect(rodAtLeast(6)).toBe('용왕의 낚싯대 이상')
    expect(rodAtLeast(9)).toBe('9단계 낚싯대 이상')
  })
  it('TIDE_GRACE_MIN 10, MYTHIC_CHANCE 0.02', () => {
    expect(TIDE_GRACE_MIN).toBe(10)
    expect(MYTHIC_CHANCE).toBe(0.02)
  })
})

describe('신화 버프', () => {
  it('BUFFS 3개 id·이름·설명', () => {
    expect(BUFFS).toEqual([
      { id: 'imugi-scale', name: '이무기의 비늘', desc: '입질이 15% 빨라져요' },
      { id: 'dragon-breath', name: '백룡의 숨결', desc: '낚시 바가 8% 길어져요' },
      { id: 'dragon-pearl', name: '용왕의 여의주', desc: '물고기를 8% 비싸게 팔아요' },
    ])
  })
  it('BUFF_FX 값', () => {
    expect(BUFF_FX).toEqual({ imugiBite: 0.85, dragonBar: 1.08, pearlSell: 108 })
  })
})

// 신화와 전설이 한 판에 동시에 후보가 될 수 없다(설계 §6.2, rollCatch가 r0를 함께 쓴다): 신화의 지역에서
// 자리가 겹치는(어느 한쪽이 자리 제한이 없으면 겹친다) 모든 전설이 그 신화의 needs에 있어야 한다.
function shadowingLegends(list: readonly Species[]): string[] {
  const out: string[] = []
  for (const m of list.filter((s) => s.rarity === 'mythic')) {
    for (const l of list.filter((s) => s.rarity === 'legend' && s.area === m.area)) {
      const overlap = !m.spots || !l.spots || m.spots.some((sp) => l.spots!.includes(sp))
      if (overlap && !(m.legend?.needs ?? []).includes(l.id)) out.push(`${m.id} must need ${l.id}`)
    }
  }
  return out
}

describe('신화·전설 동시 후보 없음', () => {
  it('실제 데이터', () => {
    expect(shadowingLegends(SPECIES)).toEqual([])
  })
  describe('합성 신화', () => {
    withTempData(M1_FIXTURE)
    it('M1_FIXTURE는 통과하고, 같은 자리 전설을 needs에서 빼면 걸린다', () => {
      expect(shadowingLegends(SPECIES)).toEqual([])
      const broken = SPECIES.map((s) => (s.id === 'tmp-mythic' ? { ...s, legend: { ...s.legend!, needs: ['grouper'] } } : s))
      expect(shadowingLegends(broken)).toEqual(['tmp-mythic must need tmp-legend'])
      // 자리 제한 없는 전설은 모든 자리와 겹친다
      const spotless = SPECIES.map((s) => (s.id === 'tmp-legend' ? { ...s, spots: undefined } : s))
      expect(shadowingLegends(spotless)).toEqual(['tmp-mythic2 must need tmp-legend'])
    })
  })
})

describe('신발 (2026-11-26)', () => {
  it('4단계: 기본 장화 무료 ×1, 운동화 1,000 ×1.25, 러닝화 6,000 ×1.5, 재원이의 군화 30,000 ×1.75', () => {
    expect(SHOES.map((s) => [s.tier, s.name, s.price, s.speed])).toEqual([
      [1, '기본 장화', 0, 1], [2, '운동화', 1000, 1.25], [3, '러닝화', 6000, 1.5], [4, '재원이의 군화', 30000, 1.75],
    ])
  })
  it('shoeSpeed: 단계별 배율, 모르는 단계는 1', () => {
    expect([1, 2, 3, 4].map(shoeSpeed)).toEqual([1, 1.25, 1.5, 1.75])
    for (const t of [0, 5, NaN, 2.5]) expect(shoeSpeed(t)).toBe(1)
  })
})

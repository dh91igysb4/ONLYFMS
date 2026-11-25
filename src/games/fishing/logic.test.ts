import { describe, expect, it } from 'vitest'
import { rngFromSeed } from '../../shared/rng.ts'
import { teleportFee, teleporterWorld } from './teleport.ts'
import { DEFAULT_OUTFIT, isShopItem, newlyEarned, ownsWear, unlockMet, WEAR, wearKey } from './wardrobe.ts'
import { SEASON_ANCHOR_MS, conditionsAt, type Conditions, type Season, type Weather } from './clock.ts'
import { AREAS, FISHING_AREAS, FRIDGE_SIZE, TP_BASE, TP_PER_10, BAGS, bagSize, BUFF_FX, CHALLENGES, DEFAULT_AREAS, HOOK_GRACE_MS, HOOK_WINDOW_MS, LEGEND_CHANCE, MIN_FIGHT_MS, MYTHIC_CHANCE, PIER_POWER_BONUS, RODS, SPECIES, speciesAvailable, TACKLE_FX, TACKLES, UNLOCKS, type AreaId, type Species, type TackleId } from './data.ts'
import { challengeMatches, decayedSale, discardFee, freeBonus, kstDay, sellRatePct, soldToday, LAST_GOLD_IN_SAVE, logic, pickPool, price, progressChallenges, rollCatch, PREVIEW_AREAS_KEY, sellPrice, sizePercentile, teleporterOpen, type Action, type CastCtx, type Fish, type Pending, type State, type View } from './logic.ts'
import { M1_FIXTURE, SPECIES_BEFORE_EXPANSION, TMP_DEEP, TMP_FLAT, TMP_MYTH, withSpeciesPrefix, withTempData } from './testFixtures.ts'

const seedBytes = (n: number): Uint8Array => new Uint8Array(32).map((_, i) => (i * 7 + n) & 255)
const byId = (id: string) => SPECIES.find((s) => s.id === id)!
/** 그 지역·자리에 나올 수 있는 일반·전설 어종 id(조건 무시) */
const spotIds = (area: string, spot: string) => SPECIES.filter((s) => s.area === area && (!s.spots || s.spots.includes(spot))).map((s) => s.id)

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

const cond = (season: Season, hour: number, weather: Weather = 'sun'): Conditions => ({ gameMinute: hour * 60, gameDay: 100, season, weather })
const WEEK = 7 * 86_400_000
// weeks주째 계절(0 봄, 1 여름, 2 가을, 3 겨울)의 KST 자정 뒤 hour*60초 = 게임 hour시
const nowAt = (weeks: number, hour: number): number => SEASON_ANCHOR_MS + weeks * WEEK + hour * 60 * 1000
const ctxOf = (over: Partial<CastCtx> = {}): CastCtx => ({
  rodTier: 1, power: 0.5, sizeBonus: 0, area: 'village', spot: 'shore', cond: cond('spring', 12), legends: [], equipped: [], ...over,
})
const sequence = (...vals: number[]) => {
  let i = 0
  return () => vals[Math.min(i++, vals.length - 1)]
}
const counting = (inner: () => number) => {
  const f = Object.assign(() => (f.n++, inner()), { n: 0 })
  return f
}

describe('rollCatch', () => {
  it('조건에 맞는 어종만 낸다 (마을, 봄 낮 맑음, rod 1, 5k회)', () => {
    const rng = rngFromSeed(seedBytes(1))
    const c = ctxOf()
    for (let i = 0; i < 5000; i++) {
      const s = byId(rollCatch(rng, c).species)
      expect(speciesAvailable(s, 'village', 'shore', c.cond, 1)).toBe(true)
      expect(['rare', 'legend']).not.toContain(s.rarity)
    }
  })
  it('rod 1 겨울 밤: uncommon을 뽑아도 결과는 후보 안, 예외 없음', () => {
    const c = ctxOf({ cond: cond('winter', 22) })
    const allowed = new Set(SPECIES.filter((s) => speciesAvailable(s, 'village', 'shore', c.cond, 1)).map((s) => s.id))
    // 어종 확장(v19): 노래미·학꽁치·넙치가 늘 나온다
    expect([...allowed].sort()).toEqual(['goby', 'greenling', 'hairtail', 'halfbeak', 'horse-mackerel', 'olive-flounder', 'rockfish', 'squid'])
    const rng = rngFromSeed(seedBytes(2))
    for (let i = 0; i < 5000; i++) expect(allowed.has(rollCatch(rng, c).species)).toBe(true)
    // r1=0.99 → uncommon
    expect(allowed.has(rollCatch(sequence(0.5, 0.99, 0.5, 0.5, 0.5), c).species)).toBe(true)
  })
  it('size within species range; bite delay 1500~6000, rod 4 1200~4800', () => {
    for (const tier of [1, 4] as const) {
      const rng = rngFromSeed(seedBytes(4 + tier))
      const [lo, hi] = tier === 4 ? [1200, 4800] : [1500, 6000]
      for (let i = 0; i < 5000; i++) {
        const c = rollCatch(rng, ctxOf({ rodTier: tier }))
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
        const c = rollCatch(rng, ctxOf({ rodTier: 3, power }))
        sum += sizePercentile(c.species, c.sizeCm)
      }
      return sum / 5000
    }
    expect(mean(1)).toBeGreaterThan(mean(0))
  })
  it('rng를 항상 5번 부른다 (전설 후보 있음/없음/이미 잡음, rod 1 겨울 밤)', () => {
    const winter = { cond: cond('winter', 12), rodTier: 3 as const, spot: 'pier', power: 0.95 }
    const cases: [string, CastCtx][] = [
      ['전설 후보 있음', ctxOf(winter)],
      ['전설 후보 없음', ctxOf({ ...winter, spot: 'shore' })],
      ['이미 잡음', ctxOf({ ...winter, legends: ['grouper'] })],
      // rod 1 겨울 밤: 전설 후보 없이 common·uncommon만 뽑히는 경우(r1=0.999 → uncommon)
      ['rod 1 겨울 밤', ctxOf({ cond: cond('winter', 22) })],
    ]
    for (const [, c] of cases) {
      for (const r0 of [0.01, 0.5]) {
        for (const r1 of [0.01, 0.999]) {
          const rng = counting(sequence(r0, r1, 0.3, 0.6, 0.4))
          rollCatch(rng, c)
          expect(rng.n).toBe(5)
        }
      }
      const real = counting(rngFromSeed(seedBytes(21)))
      for (let i = 0; i < 50; i++) rollCatch(real, c)
      expect(real.n).toBe(250)
    }
  })
  it('pier 보너스(sizeBonus)는 rng 호출 수를 바꾸지 않는다', () => {
    const n = (sizeBonus: number): number => {
      const rng = counting(rngFromSeed(seedBytes(22)))
      for (let i = 0; i < 20; i++) rollCatch(rng, ctxOf({ sizeBonus }))
      return rng.n
    }
    expect(n(PIER_POWER_BONUS)).toBe(n(0))
  })
  it('deterministic for the same rng sequence', () => {
    const a = rngFromSeed(seedBytes(7))
    const b = rngFromSeed(seedBytes(7))
    for (let i = 0; i < 100; i++) expect(rollCatch(a, ctxOf({ rodTier: 3 }))).toEqual(rollCatch(b, ctxOf({ rodTier: 3 })))
  })

  describe('전설', () => {
    const base = { area: 'village' as const, spot: 'pier', cond: cond('winter', 12), rodTier: 3 as const, power: 0.95 }
    const roll = (over: Partial<CastCtx>, r0: number) => rollCatch(sequence(r0, 0.5, 0.5, 0.5, 0.5), ctxOf({ ...base, ...over })).species
    it('pier·겨울·rod 3·power 0.95·r0=0.01 → grouper', () => {
      expect(roll({}, 0.01)).toBe('grouper')
      expect(roll({}, LEGEND_CHANCE - 1e-9)).toBe('grouper')
    })
    it('power 0.94, shore, 이미 잡음, r0=0.5, 낮은 rod, 다른 계절 → grouper 아님', () => {
      expect(roll({ power: 0.94 }, 0.01)).not.toBe('grouper')
      expect(roll({ spot: 'shore' }, 0.01)).not.toBe('grouper')
      expect(roll({ legends: ['grouper'] }, 0.01)).not.toBe('grouper')
      expect(roll({}, 0.5)).not.toBe('grouper')
      expect(roll({}, LEGEND_CHANCE)).not.toBe('grouper')
      expect(roll({ rodTier: 2 }, 0.01)).not.toBe('grouper')
      expect(roll({ cond: cond('summer', 12) }, 0.01)).not.toBe('grouper')
    })
    it('황금 쏘가리: 여름·비·rod 3·power 0.95·r0 작음에서만', () => {
      const r = { area: 'river' as const, spot: 'river', cond: cond('summer', 12, 'rain'), rodTier: 3 as const, power: 0.95 }
      expect(roll(r, 0.01)).toBe('golden-mandarin')
      expect(roll({ ...r, power: 0.94 }, 0.01)).not.toBe('golden-mandarin')
      expect(roll({ ...r, cond: cond('summer', 12) }, 0.01)).not.toBe('golden-mandarin')
      expect(roll({ ...r, cond: cond('spring', 12, 'rain') }, 0.01)).not.toBe('golden-mandarin')
      expect(roll({ ...r, rodTier: 2 }, 0.01)).not.toBe('golden-mandarin')
      expect(roll({ ...r, legends: ['golden-mandarin'] }, 0.01)).not.toBe('golden-mandarin')
      expect(roll(r, 0.5)).not.toBe('golden-mandarin')
    })
    it('은빛 대왕송어: 호수·가을 4~7시·rod 3·power 0.95에서만', () => {
      const r = { area: 'lake' as const, spot: 'lake', cond: cond('autumn', 5), rodTier: 3 as const, power: 0.95 }
      expect(roll(r, 0.01)).toBe('silver-king-trout')
      expect(roll({ ...r, power: 0.94 }, 0.01)).not.toBe('silver-king-trout')
      expect(roll({ ...r, cond: cond('spring', 5) }, 0.01)).not.toBe('silver-king-trout')
      expect(roll({ ...r, cond: cond('autumn', 8) }, 0.01)).not.toBe('silver-king-trout')
      expect(roll({ ...r, rodTier: 2 }, 0.01)).not.toBe('silver-king-trout')
      expect(roll({ ...r, legends: ['silver-king-trout'] }, 0.01)).not.toBe('silver-king-trout')
    })
    it('화룡어: cave3·rod 4·power 0.95에서만', () => {
      const r = { area: 'cave' as const, spot: 'cave3', cond: cond('spring', 12), rodTier: 4 as const, power: 0.95 }
      expect(roll(r, 0.01)).toBe('fire-dragonfish')
      expect(roll({ ...r, spot: 'cave2' }, 0.01)).not.toBe('fire-dragonfish')
      expect(roll({ ...r, spot: 'cave1' }, 0.01)).not.toBe('fire-dragonfish')
      expect(roll({ ...r, rodTier: 3 }, 0.01)).not.toBe('fire-dragonfish')
      expect(roll({ ...r, power: 0.94 }, 0.01)).not.toBe('fire-dragonfish')
    })
    it('무지개 청새치: sea·맑음·11~14시·rod 4·power 0.95에서만', () => {
      const r = { area: 'island' as const, spot: 'sea', cond: cond('summer', 12), rodTier: 4 as const, power: 0.95 }
      expect(roll(r, 0.01)).toBe('rainbow-marlin')
      expect(roll({ ...r, spot: 'lagoon' }, 0.01)).not.toBe('rainbow-marlin')
      expect(roll({ ...r, cond: cond('summer', 12, 'rain') }, 0.01)).not.toBe('rainbow-marlin')
      expect(roll({ ...r, cond: cond('summer', 14) }, 0.01)).not.toBe('rainbow-marlin')
      expect(roll({ ...r, cond: cond('summer', 10) }, 0.01)).not.toBe('rainbow-marlin')
      expect(roll({ ...r, rodTier: 3 }, 0.01)).not.toBe('rainbow-marlin')
    })
    it('백년 가물치: power 0.1에서도 봄 밤 연못 rod 3이면 후보(power 0), 그 외 조건은 아님', () => {
      const f = { area: 'forest' as const, spot: 'pond', cond: cond('spring', 22), rodTier: 3 as const, power: 0.1 }
      expect(roll(f, 0.01)).toBe('century-snakehead')
      expect(roll({ ...f, power: 0 }, 0.01)).toBe('century-snakehead')
      expect(roll({ ...f, spot: 'waterfall' }, 0.01)).not.toBe('century-snakehead')
      expect(roll({ ...f, cond: cond('spring', 12) }, 0.01)).not.toBe('century-snakehead')
      expect(roll({ ...f, cond: cond('summer', 22) }, 0.01)).not.toBe('century-snakehead')
      expect(roll({ ...f, rodTier: 2 }, 0.01)).not.toBe('century-snakehead')
    })
    it('전설 크기는 sizeBonus·power 식을 따른다', () => {
      const g = byId('grouper')
      const c = rollCatch(sequence(0.01, 0.5, 0.5, 0, 0.5), ctxOf({ ...base }))
      expect(c.sizeCm).toBe(g.minCm)
    })
  })

  it('equipped에 서버 효과가 없는 찌(cork·trap·barbed)만 있어도 결과는 같다', () => {
    const rng = (): (() => number) => rngFromSeed(seedBytes(61))
    const a = rng(), b = rng()
    for (let i = 0; i < 200; i++) {
      expect(rollCatch(a, ctxOf({ rodTier: 4, equipped: ['cork', 'trap'] }))).toEqual(rollCatch(b, ctxOf({ rodTier: 4 })))
    }
  })
  it('spinner: 같은 rng에서 입질 지연이 ×0.7(반올림 ±1), 어종·크기는 그대로', () => {
    for (const rodTier of [1, 3, 4] as const) {
      for (const r4 of [0, 0.3, 0.77, 0.999]) {
        const base = rollCatch(sequence(0.5, 0.5, 0.5, 0.5, r4), ctxOf({ rodTier }))
        const fast = rollCatch(sequence(0.5, 0.5, 0.5, 0.5, r4), ctxOf({ rodTier, equipped: ['spinner'] }))
        const exact = (1500 + r4 * 4500) * RODS.find((r) => r.tier === rodTier)!.biteScale * TACKLE_FX.spinnerBite
        expect(Math.abs(fast.biteDelayMs - exact)).toBeLessThanOrEqual(0.5)
        expect(fast.biteDelayMs).toBeLessThanOrEqual(Math.round(base.biteDelayMs * 0.7) + 1)
        expect(fast.biteDelayMs).toBeGreaterThanOrEqual(Math.round(base.biteDelayMs * 0.7) - 1)
        expect({ ...fast, biteDelayMs: 0 }).toEqual({ ...base, biteDelayMs: 0 })
      }
    }
  })
  it('curious: rod 3에서 r1이 rare 경계 바로 위일 때 장착하면 rare, 아니면 uncommon', () => {
    // rod 3 가중치 50/34/16: rare 경계 r1=0.84, curious는 50/34/24(합 108)라 r1=0.7778부터 rare
    const rarity = (r1: number, equipped: TackleId[]) =>
      byId(rollCatch(sequence(0.5, r1, 0.5, 0.5, 0.5), ctxOf({ rodTier: 3, equipped })).species).rarity
    expect(rarity(0.8, [])).toBe('uncommon')
    expect(rarity(0.8, ['curious'])).toBe('rare')
    expect(rarity(0.7, ['curious'])).toBe('uncommon')
    expect(rarity(0.4, ['curious'])).toBe('common')
    expect(rarity(0.8, ['spinner'])).toBe('uncommon')
  })
  it('curious: 전설 조건에서 r0 = LEGEND_CHANCE×1.2이면 장착 없으면 전설 아님, 장착하면 전설', () => {
    const base = { area: 'village' as const, spot: 'pier', cond: cond('winter', 12), rodTier: 3 as const, power: 0.95 }
    const species = (r0: number, equipped: TackleId[]) => rollCatch(sequence(r0, 0.5, 0.5, 0.5, 0.5), ctxOf({ ...base, equipped })).species
    const r0 = LEGEND_CHANCE * 1.2
    expect(species(r0, [])).not.toBe('grouper')
    expect(species(r0, ['curious'])).toBe('grouper')
    expect(species(LEGEND_CHANCE * TACKLE_FX.curiousLegend, ['curious'])).not.toBe('grouper')
  })
  it('rng 호출은 찌 조합과 상관없이 항상 5번', () => {
    const combos: TackleId[][] = [[], ['spinner'], ['curious'], ['spinner', 'curious']]
    const legendCtx = { area: 'village' as const, spot: 'pier', cond: cond('winter', 12), rodTier: 3 as const, power: 0.95 }
    for (const equipped of combos) {
      for (const over of [{}, legendCtx, { rodTier: 4 as const }]) {
        for (const r0 of [0.01, 0.5]) {
          const rng = counting(sequence(r0, 0.5, 0.5, 0.5, 0.5))
          rollCatch(rng, ctxOf({ ...over, equipped }))
          expect(rng.n).toBe(5)
        }
      }
    }
  })
})

describe('rollCatch 옛 데이터 고정', () => {
  // 어종 확장(v19) 뒤에도 v4 판정과 같음을 보려고 앞 94종으로 잘라서 돈다
  withSpeciesPrefix(SPECIES_BEFORE_EXPANSION)
  it('찌 없음(equipped []): 고정 rng 열의 결과가 v4 코드와 같다', () => {
    const c = (rodTier: CastCtx['rodTier'], power: number, sizeBonus: number, area: CastCtx['area'], spot: string, k: Conditions) =>
      ctxOf({ rodTier, power, sizeBonus, area, spot, cond: k })
    const ctxs = [
      c(1, 0.5, 0, 'village', 'shore', cond('spring', 12)),
      c(3, 0.95, 0.25, 'village', 'pier', cond('winter', 12)),
      c(4, 0.3, 0, 'river', 'river', cond('summer', 22)),
      c(3, 0.1, 0, 'forest', 'pond', cond('spring', 22)),
    ]
    const rows = [[0.01, 0.5, 0.5, 0.5, 0.5], [0.5, 0.1, 0.2, 0.3, 0.4], [0.5, 0.45, 0.9, 0.7, 0.0], [0.5, 0.99, 0.5, 0.25, 0.99], [0.09, 0.84, 0.1, 0.8, 0.6]]
    const got = ctxs.flatMap((x) => rows.map((r) => { const o = rollCatch(sequence(...r), x); return [o.species, o.sizeCm, o.biteDelayMs] }))
    // 이 값은 찌 도입 전(logic.version 4) 코드로 계산한 것이다. 바꾸지 말 것.
    expect(got).toEqual([["goby",14,3750],["anchovy",10,3300],["horse-mackerel",29,1500],["rockfish",28,5955],["mullet",62,4200],["grouper",129,3750],["goby",16,3300],["mackerel",43,1500],["yellowtail",93,5955],["yellowtail",107,4200],["aucha-perch",18,3000],["pale-chub",10,2640],["dark-chub",15,1200],["eel",49,4764],["mandarin-fish",48,3360],["century-snakehead",113,3750],["crucian",14,3300],["carp",60,1500],["carp",37,5955],["crucian",25,4200]])
  })
})

describe('어종 확장(2026-11-25): 대나무 낚싯대', () => {
  it('대나무 낚싯대(1단계)에서는 새 희귀도 나오지 않는다', () => {
    for (const spot of ['pond', 'waterfall']) {
      for (const r1 of [0.5, 0.9, 0.999]) {
        const s = byId(rollCatch(sequence(0.5, r1, 0.5, 0.5, 0.5), ctxOf({ rodTier: 1, area: 'forest', spot, cond: cond('spring', 12) })).species)
        expect(s.rarity, `${spot} ${r1}`).not.toBe('rare')
      }
    }
  })
})

describe('pickPool', () => {
  const sp = (id: string): Species => ({ id } as Species)
  const pools = (c: string[], u: string[], r: string[]) => ({ common: c.map(sp), uncommon: u.map(sp), rare: r.map(sp) })
  const ids = (l: Species[]) => l.map((s) => s.id)
  it('뽑힌 등급에 후보가 있으면 그대로', () => {
    expect(ids(pickPool(pools(['c'], ['u'], ['r']), 'uncommon'))).toEqual(['u'])
  })
  it('rare가 비면 uncommon, uncommon도 비면 common', () => {
    expect(ids(pickPool(pools(['c'], ['u'], []), 'rare'))).toEqual(['u'])
    expect(ids(pickPool(pools(['c'], [], []), 'rare'))).toEqual(['c'])
    expect(ids(pickPool(pools(['c'], [], ['r']), 'uncommon'))).toEqual(['c'])
  })
  it('아래가 모두 비면 위로', () => {
    expect(ids(pickPool(pools([], ['u'], ['r']), 'common'))).toEqual(['u'])
    expect(ids(pickPool(pools([], [], ['r']), 'common'))).toEqual(['r'])
    expect(ids(pickPool(pools([], [], ['r']), 'uncommon'))).toEqual(['r'])
  })
  it('전부 비면 []', () => {
    expect(pickPool(pools([], [], []), 'rare')).toEqual([])
  })
})

// ---------------------------------------------------------------- WorldLogic
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}
const T0 = 1_000_000
const fixedRng = () => 0.5
const ctx = (now = T0, gold = 0) => ({ now, rng: fixedRng, gold })
/**
 * 시험용 지갑 모의(world 핸들러와 같은 규칙): v14부터 골드는 세이브가 아니라 지갑에 있다.
 * 아래 기존 시험은 "세이브 + 그 사람 지갑 잔액"을 한 객체(WS의 gold)로 적고, play가 잔액을 ctx.gold로 넘긴 뒤
 * 돌려받은 증감(gold)을 더해 다시 붙인다. 지갑 계약 자체는 'v14 지갑 계약' 시험이 logic.apply로 직접 본다.
 */
type WS = State & { gold?: number }
type Played = { state: WS; result?: unknown; gold?: number } | { error: string }
const fresh = (over: Partial<WS> = {}): WS => ({ ...logic.init(), ...over })
function play(s: WS, action: Action | unknown, c: { now: number; rng: () => number; gold?: number }): Played {
  const { gold: inState, ...state } = s
  const gold = inState ?? c.gold ?? 0
  const r = logic.apply(state as State, action as Action, { ...c, gold })
  if ('error' in r) return r
  expect(r.state, 'v14 세이브에는 gold가 없다').not.toHaveProperty('gold')
  const delta = r.gold ?? 0
  expect(Number.isSafeInteger(delta), `gold 증감은 정수: ${delta}`).toBe(true)
  expect(gold + delta, '지갑이 음수가 되는 증감은 없다').toBeGreaterThanOrEqual(0)
  return { ...r, state: { ...r.state, gold: gold + delta } }
}
/** 지갑 모의 view: WS의 gold를 잔액으로 넘긴다 */
const viewW = (s: WS, c: { now: number }): View => {
  const { gold = 0, ...state } = s
  return logic.view(state as State, { now: c.now, gold })
}
/**
 * 시험용 migrate + 지갑 이전 모의(world 핸들러 순서: legacyGold로 옛 골드를 지갑에 옮긴 뒤 migrate).
 * 기존 migrate 시험은 "세이브 + 지갑"을 WS 한 객체로 비교한다. migrate 결과에는 gold가 없어야 한다.
 */
function migrateW(raw: unknown, from: number): WS {
  const m = logic.migrate(raw, from)
  expect(m, 'v14 migrate 결과에는 gold가 없다').not.toHaveProperty('gold')
  return { ...m, gold: logic.legacyGold!(raw, from) }
}
/** v9 이하 세이브가 v10 migrate에서 받는 옷장 기본값 */
// v10 옷장 기본값 + v15 판매 마릿수(옛 세이브는 0마리)
// + v20 신발(옛 세이브는 기본 장화)
const W0 = { wardrobe: [] as string[], outfit: { ...DEFAULT_OUTFIT }, sold: { day: '', n: 0 }, fridge: [] as Fish[], shoesTier: 1 }
const ok = (r: Played) => {
  if ('error' in r) throw new Error(`unexpected error ${r.error}`)
  return r
}
const err = (r: Played) => {
  if (!('error' in r)) throw new Error('expected error')
  return r.error
}
const withPending = (over: Partial<WS> = {}): WS =>
  fresh({ pending: { species: 'anchovy', sizeCm: 12, biteDelayMs: 3000, startedAt: T0, hookedAt: null, area: 'village', spot: 'shore', cond: cond('spring', 12), power: 0.5 }, ...over })
const BITE = T0 + 3000
const withHooked = (over: Partial<WS> = {}): WS =>
  fresh({ pending: { species: 'anchovy', sizeCm: 12, biteDelayMs: 3000, startedAt: T0, hookedAt: BITE, area: 'village', spot: 'shore', cond: cond('spring', 12), power: 0.5 }, ...over })

describe('fishing WorldLogic', () => {
  it('init and version', () => {
    expect(logic.version).toBe(21)
    expect(logic.init()).toEqual({
      totalEarned: 0, rodTier: 1, bagTier: 1, areas: [...DEFAULT_AREAS], bag: [], dex: {}, legends: [], tackles: [], equipped: [], challenges: {}, buffs: [], pending: null, ...W0,
    })
  })

  it('cast sets pending and replaces an old one', () => {
    const r1 = ok(play(fresh(), { type: 'cast', area: 'pier', power: 0.5 }, ctx(T0)))
    expect(r1.state.pending).toMatchObject({ startedAt: T0, hookedAt: null })
    expect(r1.result).toEqual(viewW(r1.state, { now: T0 }).pending)
    const old = withPending()
    const r2 = ok(play(old, { type: 'cast', area: 'pier', power: 0.5 }, ctx(T0 + 5000)))
    expect(r2.state.pending?.startedAt).toBe(T0 + 5000)
    expect(r2.state.pending).not.toBe(old.pending)
  })

  it('cast with full bag -> bag_full, no pending', () => {
    const bag: Fish[] = Array.from({ length: bagSize(1) }, () => ({ species: 'anchovy', sizeCm: 10, perfect: false }))
    const s = deepFreeze(fresh({ bag }))
    expect(err(play(s, { type: 'cast', area: 'pier', power: 0.5 }, ctx()))).toBe('bag_full')
    expect(s.pending).toBeNull()
  })

  it("cast without spot and with spot 'shore' give identical pending (same seed)", () => {
    const pend = (spot?: string) => {
      const rng = rngFromSeed(seedBytes(31))
      const action = { type: 'cast', area: 'village', power: 0.5, ...(spot === undefined ? {} : { spot }) } as unknown as Action
      return ok(play(fresh(), action, { now: T0, rng })).state.pending
    }
    expect(pend('shore')).toEqual(pend())
    expect(pend('shore')?.spot).toBe('shore')
  })

  it("cast { area: 'pier', spot: 'pier' }는 village로 정상 처리되고 부두 보너스가 붙는다", () => {
    const r = ok(play(fresh(), { type: 'cast', area: 'pier', power: 0.5, spot: 'pier' }, ctx()))
    expect(r.state.pending).toMatchObject({ area: 'village', spot: 'pier' })
    // 같은 rng 값이면 부두가 더 큰 크기 백분위를 낸다
    const pct = (spot: string) => {
      const rng = sequence(0.5, 0.5, 0.5, 0.5, 0.5)
      const p = ok(play(fresh(), { type: 'cast', area: 'village', power: 0.5, spot }, { now: nowAt(1, 12), rng })).state.pending!
      return sizePercentile(p.species, p.sizeCm)
    }
    expect(pct('pier')).toBeGreaterThan(pct('shore'))
  })

  it("cast area 'lake'(안 열림) → bad_area; spot 'zzz' → bad_spot; 오류 시 상태 불변", () => {
    const s = deepFreeze(fresh())
    const before = JSON.stringify(s)
    expect(err(play(s, { type: 'cast', area: 'lake', power: 0.5 }, ctx()))).toBe('bad_area')
    for (const spot of ['zzz', 'river', 1, null]) {
      expect(err(play(s, { type: 'cast', area: 'village', power: 0.5, spot } as unknown as Action, ctx()))).toBe('bad_spot')
    }
    expect(JSON.stringify(s)).toBe(before)
  })

  it('pending은 던질 때의 area·spot·cond·power를 저장하고, view의 pending에는 그 필드가 없다', () => {
    const now = nowAt(3, 12)
    const r = ok(play(fresh(), { type: 'cast', area: 'village', power: 0.7, spot: 'pier' }, { now, rng: fixedRng }))
    expect(r.state.pending).toMatchObject({ area: 'village', spot: 'pier', power: 0.7, cond: conditionsAt(now) })
    for (const v of [viewW(r.state, { now }).pending, r.result]) {
      expect(Object.keys(v as object).sort()).toEqual(['biteDelayMs', 'hooked', 'sizeCm', 'species', 'startedAt'])
    }
  })

  it('던진 뒤 now가 다음 게임 날·다른 계절이 되어도 resolve는 저장된 어종을 그대로 넣는다', () => {
    const now = nowAt(3, 12)
    const cast = ok(play(fresh(), { type: 'cast', area: 'village', power: 0.5, spot: 'shore' }, { now, rng: fixedRng })).state
    const p = cast.pending!
    const hooked = ok(play(cast, { type: 'hook' }, ctx(now + p.biteDelayMs))).state
    const later = now + 2 * WEEK + 5_000_000
    expect(conditionsAt(later).season).not.toBe(p.cond.season)
    expect(conditionsAt(later).gameDay).not.toBe(p.cond.gameDay)
    const r = ok(play(hooked, { type: 'resolve', success: true, perfect: false }, ctx(later)))
    expect(r.state.bag).toEqual([{ species: p.species, sizeCm: p.sizeCm, perfect: false }])
  })

  it('resolve로 전설을 잡으면 legends에 추가, 이후 같은 조건·r0=0에서도 다시 안 나옴; 놓치면 legends 그대로', () => {
    const now = nowAt(3, 12)
    const legendRng = () => sequence(0, 0.5, 0.5, 0.5, 0.5)
    const act = { type: 'cast', area: 'village', power: 1, spot: 'pier' } as const
    const cast = ok(play(fresh({ rodTier: 3 }), act, { now, rng: legendRng() })).state
    expect(cast.pending?.species).toBe('grouper')
    const hooked = ok(play(cast, { type: 'hook' }, ctx(now + cast.pending!.biteDelayMs))).state
    const miss = ok(play(hooked, { type: 'resolve', success: false, perfect: false }, ctx(now + 1e5)))
    expect(miss.state.legends).toEqual([])
    const caught = ok(play(hooked, { type: 'resolve', success: true, perfect: false }, ctx(now + 1e5))).state
    expect(caught.legends).toEqual(['grouper'])
    expect(caught.dex.grouper.count).toBe(1)
    const again = ok(play(caught, act, { now, rng: legendRng() })).state
    expect(again.pending?.species).not.toBe('grouper')
    // 일반 어종을 잡아도 legends는 그대로
    const norm = ok(play(withHooked(), { type: 'resolve', success: true, perfect: false }, ctx(T0 + 1e5))).state
    expect(norm.legends).toEqual([])
  })

  it('pier spot raises mean size percentile', () => {
    const mean = (spot: string): number => {
      const rng = rngFromSeed(seedBytes(32))
      let sum = 0
      for (let i = 0; i < 3000; i++) {
        const p = ok(play(fresh({ rodTier: 3 }), { type: 'cast', area: 'pier', power: 0.5, spot }, { now: T0, rng })).state.pending!
        sum += sizePercentile(p.species, p.sizeCm)
      }
      return sum / 3000
    }
    expect(mean('pier')).toBeGreaterThan(mean('shore') + 0.05)
  })

  it('buyBag 1->2 at 800 gold leaves 0 gold, bagTier 2, totalEarned unchanged', () => {
    const r = ok(play(fresh({ gold: 800, totalEarned: 900 }), { type: 'buyBag', tier: 2, price: 800 }, ctx()))
    expect(r.state).toMatchObject({ gold: 0, bagTier: 2, totalEarned: 900 })
  })

  it('buyBag 2->3 costs 5000; 799 gold -> not_enough_gold', () => {
    expect(err(play(fresh({ gold: 799 }), { type: 'buyBag', tier: 2, price: 800 }, ctx()))).toBe('not_enough_gold')
    expect(ok(play(fresh({ gold: 5000, bagTier: 2 }), { type: 'buyBag', tier: 3, price: 5000 }, ctx())).state).toMatchObject({ gold: 0, bagTier: 3 })
  })

  it('buyBag rejects skipped, malformed, current and beyond-max tiers', () => {
    const rich = deepFreeze(fresh({ gold: 1e6 }))
    for (const tier of [3, '2', 2.5, 1, 0, NaN, null, 4]) {
      expect(err(play(rich, { type: 'buyBag', tier } as unknown as Action, ctx()))).toBe('bad_tier')
    }
    const max = deepFreeze(fresh({ gold: 1e6, bagTier: 5 }))
    expect(err(play(max, { type: 'buyBag', tier: 6 }, ctx()))).toBe('bad_tier')
  })

  it('고급 가방: 3 → 4(50칸, 80,000), 4 → 5(60칸, 160,000) (v15 가격)', () => {
    expect(err(play(fresh({ gold: 49_999, bagTier: 3 }), { type: 'buyBag', tier: 4, price: 80000 }, ctx()))).toBe('not_enough_gold')
    expect(ok(play(fresh({ gold: 80_000, bagTier: 3 }), { type: 'buyBag', tier: 4, price: 80000 }, ctx())).state).toMatchObject({ gold: 0, bagTier: 4 })
    expect(ok(play(fresh({ gold: 160_000, bagTier: 4 }), { type: 'buyBag', tier: 5, price: 160000 }, ctx())).state).toMatchObject({ gold: 0, bagTier: 5 })
    // 60칸이면 60마리째까지 던지고 61번째는 bag_full
    const fish = (n: number): Fish[] => Array.from({ length: n }, () => ({ species: 'anchovy', sizeCm: 10, perfect: false }))
    expect('state' in play(fresh({ bagTier: 5, bag: fish(59) }), { type: 'cast', area: 'village', power: 0.5 }, ctx())).toBe(true)
    expect(err(play(fresh({ bagTier: 5, bag: fish(60) }), { type: 'cast', area: 'village', power: 0.5 }, ctx()))).toBe('bag_full')
  })

  it('bagTier 2 allows the 21st..30th fish and rejects the 31st cast with bag_full', () => {
    const fish = (n: number): Fish[] => Array.from({ length: n }, () => ({ species: 'anchovy', sizeCm: 10, perfect: false }))
    for (const n of [20, 29]) {
      expect(ok(play(fresh({ bagTier: 2, bag: fish(n) }), { type: 'cast', area: 'pier', power: 0.5 }, ctx()))).toBeTruthy()
    }
    expect(err(play(fresh({ bagTier: 2, bag: fish(30) }), { type: 'cast', area: 'pier', power: 0.5 }, ctx()))).toBe('bag_full')
    expect(BAGS.map((b) => [b.size, b.price])).toEqual([[20, 0], [30, 800], [40, 5000], [50, 80_000], [60, 160_000]])
    expect(bagSize(99)).toBe(20)
  })

  describe('호수·동굴·섬 던지기', () => {
    const open = (rodTier: State['rodTier'] = 4) => fresh({ rodTier, areas: [...DEFAULT_AREAS, 'lake', 'cave', 'island'] })
    const cast = (s: State, area: string, spot: string | undefined, seed: number) => {
      const action = { type: 'cast', area, power: 0.5, ...(spot === undefined ? {} : { spot }) } as unknown as Action
      return ok(play(s, action, { now: nowAt(seed % 4, seed % 24), rng: rngFromSeed(seedBytes(seed)) })).state.pending!
    }
    it("lake가 열린 세이브에서 {area:'lake'} 정상 → {area:'lake', spot:'lake'}, 안 열린 세이브는 bad_area", () => {
      const p = cast(fresh({ areas: [...DEFAULT_AREAS, 'lake'] }), 'lake', undefined, 3)
      expect(p).toMatchObject({ area: 'lake', spot: 'lake' })
      expect(byId(p.species).area).toBe('lake')
      expect(err(play(fresh(), { type: 'cast', area: 'lake', power: 0.5 }, ctx()))).toBe('bad_area')
      // cave만 열린 세이브는 lake가 안 열려 있다
      expect(err(play(fresh({ areas: [...DEFAULT_AREAS, 'cave'] }), { type: 'cast', area: 'lake', power: 0.5 }, ctx()))).toBe('bad_area')
    })
    it('{area:"cave", spot:"cave3"} → 불꽃잉어·용암장어·화룡어만, 열린 세이브 필요', () => {
      const seen = new Set<string>()
      for (let seed = 0; seed < 400; seed++) seen.add(cast(open(), 'cave', 'cave3', seed).species)
      // 어종 확장(v19): 용암 자리에 확장 어종(동굴새우·석순고기·숯망둑·등불고기·용암게)도 나온다
      expect([...seen].every((id) => spotIds('cave', 'cave3').includes(id))).toBe(true)
      expect(seen.has('ember-carp')).toBe(true)
      const low = new Set<string>()
      for (let seed = 0; seed < 300; seed++) low.add(cast(open(2), 'cave', 'cave3', seed).species)
      expect(low.has('ember-carp')).toBe(true)
      expect(low.has('lava-eel') || low.has('fire-dragonfish')).toBe(false)
      const mid = new Set<string>()
      for (let seed = 0; seed < 400; seed++) mid.add(cast(open(3), 'cave', 'cave3', seed).species)
      expect(mid.has('lava-eel')).toBe(true)
      expect(mid.has('fire-dragonfish')).toBe(false)
      expect(err(play(fresh(), { type: 'cast', area: 'cave', power: 0.5, spot: 'cave3' }, ctx()))).toBe('bad_area')
    })
    it('동굴 cave1·cave2는 각 자리 어종만', () => {
      const ids = (spot: string) => {
        const seen = new Set<string>()
        for (let seed = 0; seed < 300; seed++) seen.add(cast(open(1), 'cave', spot, seed).species)
        return [...seen].sort()
      }
      // 어종 확장(v19): 공용 동굴 어종과 자리별 확장 어종이 더해졌다. 다른 자리 전용 어종은 안 나온다
      expect(ids('cave1').every((id) => spotIds('cave', 'cave1').includes(id))).toBe(true)
      expect(ids('cave2').every((id) => spotIds('cave', 'cave2').includes(id))).toBe(true)
      expect(ids('cave1')).not.toContain('crystal-fry')
      expect(ids('cave2')).not.toContain('blind-fish')
    })
    it('섬 lagoon·sea는 각 자리 어종만', () => {
      for (const spot of ['lagoon', 'sea']) {
        const seen = new Set<string>()
        for (let seed = 0; seed < 400; seed++) {
          const p = cast(open(), 'island', spot, seed)
          expect(speciesAvailable(byId(p.species), 'island', spot, p.cond, 4)).toBe(true)
          seen.add(p.species)
        }
        expect(seen.size).toBeGreaterThanOrEqual(2)
        for (const id of seen) expect(byId(id).spots).toContain(spot)
      }
    })
    it('섬에서 자리를 생략하면 spot은 첫 자리(sea)', () => {
      expect(cast(open(), 'island', undefined, 5).spot).toBe('sea')
      expect(cast(open(), 'cave', undefined, 5).spot).toBe('cave1')
    })
  })

  describe('강·숲 던지기', () => {
    const castAt = (area: string, spot: string | undefined, seed: number, rodTier: State['rodTier'] = 3) => {
      const action = { type: 'cast', area, power: 0.5, ...(spot === undefined ? {} : { spot }) } as unknown as Action
      return ok(play(fresh({ rodTier }), action, { now: nowAt(seed % 4, seed % 24), rng: rngFromSeed(seedBytes(seed)) })).state.pending!
    }
    it("{area:'river', spot:'river'} 정상: 조건에 맞는 강 어종만", () => {
      for (let seed = 0; seed < 300; seed++) {
        const p = castAt('river', 'river', seed)
        const s = byId(p.species)
        expect(s.area).toBe('river')
        expect(speciesAvailable(s, 'river', 'river', p.cond, 3)).toBe(true)
      }
    })
    it("{area:'forest', spot:'waterfall'} → 버들치·열목어만", () => {
      const seen = new Set<string>()
      for (let seed = 0; seed < 400; seed++) seen.add(castAt('forest', 'waterfall', seed).species)
      // 어종 확장(v19): 폭포 확장 어종(쉬리·참종개·퉁가리·미유기·둑중개·금송어)도 나온다. 연못 어종은 안 나온다
      expect([...seen].every((id) => spotIds('forest', 'waterfall').includes(id))).toBe(true)
      expect(seen.has('stream-minnow')).toBe(true)
      expect(seen.has('crucian')).toBe(false)
    })
    it("{area:'forest'} 자리 생략 → pond, {area:'forest', spot:'river'} → bad_spot, {area:'lake'} → bad_area", () => {
      expect(castAt('forest', undefined, 1).spot).toBe('pond')
      const s = fresh()
      expect(err(play(s, { type: 'cast', area: 'forest', power: 0.5, spot: 'river' } as unknown as Action, ctx()))).toBe('bad_spot')
      expect(err(play(s, { type: 'cast', area: 'lake', power: 0.5 }, ctx()))).toBe('bad_area')
    })
  })

  it('migrate v1 save without bagTier -> bagTier 1, gold/dex/rodTier kept; bad bagTier -> 1', () => {
    const m = migrateW({ gold: 70, rodTier: 2, dex: { goby: { count: 1, maxCm: 10 } } }, 1)
    expect(m).toMatchObject({ bagTier: 1, gold: 70, rodTier: 2, dex: { goby: { count: 1, maxCm: 10 } } })
    expect(migrateW({ bagTier: 7 }, 1).bagTier).toBe(1)
    expect(migrateW({ bagTier: 3 }, 2).bagTier).toBe(3)
  })

  it('migrate keeps every fish the bag can hold: a v1 save with 20 fish keeps 20, a bagTier 3 save with 40 keeps 40', () => {
    const fish = (n: number): Fish[] => Array.from({ length: n }, (_, i) => ({ species: 'anchovy', sizeCm: 10 + (i % 5), perfect: i % 2 === 0 }))
    const v1 = fish(20)
    expect(migrateW({ gold: 5, bag: v1 }, 1).bag).toEqual(v1)
    const full = fish(40)
    expect(migrateW({ bagTier: 3, bag: full }, 2).bag).toEqual(full)
  })

  it('view exposes bagTier', () => {
    expect(viewW(fresh({ bagTier: 2 }), { now: T0 }).bagTier).toBe(2)
  })

  it('cast rejects bad payloads', () => {
    const s = deepFreeze(fresh())
    for (const power of [NaN, -0.1, 2, '1', Infinity, null, undefined]) {
      expect(err(play(s, { type: 'cast', area: 'pier', power } as unknown as Action, ctx()))).toBe('bad_power')
    }
    for (const area of ['ocean', 1, null, undefined, 'lake']) {
      expect(err(play(s, { type: 'cast', area, power: 0.5 } as unknown as Action, ctx()))).toBe('bad_area')
    }
    // 경계값 0과 1은 허용
    for (const power of [0, 1]) ok(play(s, { type: 'cast', area: 'pier', power }, ctx()))
  })

  it('resolve success before hookedAt + 2000ms -> too_early, pending kept; boundary succeeds', () => {
    const s = deepFreeze(withHooked())
    const edge = BITE + MIN_FIGHT_MS
    expect(err(play(s, { type: 'resolve', success: true, perfect: false }, ctx(edge - 1)))).toBe('too_early')
    expect(s.pending).not.toBeNull()
    const r = ok(play(s, { type: 'resolve', success: true, perfect: false }, ctx(edge)))
    expect(r.state.pending).toBeNull()
    expect(r.state.bag).toHaveLength(1)
  })

  it('resolve success without hook -> not_hooked, pending kept', () => {
    const s = deepFreeze(withPending())
    expect(err(play(s, { type: 'resolve', success: true, perfect: false }, ctx(T0 + 1e6)))).toBe('not_hooked')
  })

  it('a pending without hookedAt is treated as not hooked', () => {
    const s = deepFreeze(fresh({
      pending: { species: 'anchovy', sizeCm: 12, biteDelayMs: 3000, startedAt: T0 } as unknown as State['pending'],
    }))
    expect(viewW(s, { now: BITE }).pending).toMatchObject({ hooked: false, species: null, sizeCm: null })
    expect(err(play(s, { type: 'resolve', success: true, perfect: false }, ctx(T0 + 1e6)))).toBe('not_hooked')
    const r = ok(play(s, { type: 'hook' }, ctx(BITE)))
    expect(r.state.pending?.hookedAt).toBe(BITE)
  })

  it('hook before the bite -> too_early; at exactly startedAt + biteDelayMs succeeds', () => {
    const s = deepFreeze(withPending())
    expect(err(play(s, { type: 'hook' }, ctx(BITE - 1)))).toBe('too_early')
    const r = ok(play(s, { type: 'hook' }, ctx(BITE)))
    expect(r.state.pending?.hookedAt).toBe(BITE)
    expect(r.result).toEqual({ species: 'anchovy', sizeCm: 12 })
  })

  it('hook after bite + 800 + 1500 -> too_late; exactly at that bound succeeds', () => {
    const s = deepFreeze(withPending())
    const last = BITE + HOOK_WINDOW_MS + HOOK_GRACE_MS
    expect(err(play(s, { type: 'hook' }, ctx(last + 1)))).toBe('too_late')
    ok(play(s, { type: 'hook' }, ctx(last)))
  })

  it('hook twice -> bad_action; hook without pending -> no_pending', () => {
    expect(err(play(deepFreeze(withHooked()), { type: 'hook' }, ctx(BITE + 1)))).toBe('bad_action')
    expect(err(play(fresh(), { type: 'hook' }, ctx()))).toBe('no_pending')
  })

  it('view hides species and size until hooked', () => {
    const cast = ok(play(fresh(), { type: 'cast', area: 'pier', power: 0.5 }, ctx(T0)))
    const v = viewW(cast.state, { now: T0 })
    expect(v.pending).toMatchObject({ species: null, sizeCm: null, hooked: false, startedAt: T0 })
    expect(cast.result).toMatchObject({ species: null, sizeCm: null, hooked: false })
    expect(JSON.stringify(v)).not.toContain(cast.state.pending!.species)
    const at = T0 + cast.state.pending!.biteDelayMs
    const hooked = ok(play(cast.state, { type: 'hook' }, ctx(at)))
    const hv = viewW(hooked.state, { now: at })
    expect(hv.pending).toMatchObject({ species: cast.state.pending!.species, sizeCm: cast.state.pending!.sizeCm, hooked: true })
  })

  it('recasting never reveals species', () => {
    let s = fresh()
    for (let i = 0; i < 200; i++) {
      const r = ok(play(s, { type: 'cast', area: 'pier', power: 0.5 }, { now: T0 + i, rng: rngFromSeed(seedBytes(i)) }))
      s = r.state
      expect(viewW(s, { now: T0 }).pending).toMatchObject({ species: null, sizeCm: null })
      expect(r.result).toMatchObject({ species: null, sizeCm: null })
    }
  })

  it('resolve failure clears pending without adding fish (no time limit)', () => {
    const s = deepFreeze(withPending())
    const r = ok(play(s, { type: 'resolve', success: false, perfect: false }, ctx(T0)))
    expect(r.state.pending).toBeNull()
    expect(r.state.bag).toEqual([])
    expect(r.state.dex).toEqual({})
    expect(r.result).toEqual({ caught: null })
    const h = ok(play(deepFreeze(withHooked()), { type: 'resolve', success: false, perfect: false }, ctx(BITE)))
    expect(h.state.pending).toBeNull()
    expect(h.state.bag).toEqual([])
  })

  it('resolve success adds to bag and dex; maxCm keeps the larger', () => {
    const late = ctx(T0 + 100_000)
    let s = withHooked({ dex: { anchovy: { count: 1, maxCm: 14 } } })
    let r = ok(play(s, { type: 'resolve', success: true, perfect: true }, late))
    expect(r.result).toEqual({ caught: { species: 'anchovy', sizeCm: 12, perfect: true } })
    expect(r.state.bag).toEqual([{ species: 'anchovy', sizeCm: 12, perfect: true }])
    expect(r.state.dex.anchovy).toEqual({ count: 2, maxCm: 14 })
    s = withHooked({
      pending: { species: 'anchovy', sizeCm: 15, biteDelayMs: 1500, startedAt: T0, hookedAt: T0 + 1500, area: 'village', spot: 'shore', cond: cond('spring', 12), power: 0.5 },
      dex: { anchovy: { count: 2, maxCm: 14 } },
    })
    r = ok(play(s, { type: 'resolve', success: true, perfect: false }, late))
    expect(r.state.dex.anchovy).toEqual({ count: 3, maxCm: 15 })
  })

  it('resolve without pending -> no_pending; non-boolean flags -> bad_action', () => {
    expect(err(play(fresh(), { type: 'resolve', success: true, perfect: false }, ctx()))).toBe('no_pending')
    const s = withHooked()
    for (const a of [{ success: 'true', perfect: false }, { success: true, perfect: 1 }, { success: true }]) {
      expect(err(play(s, { type: 'resolve', ...a } as unknown as Action, ctx(T0 + 1e6)))).toBe('bad_action')
    }
  })

  it('sell adds exact price sum to gold and totalEarned, empties bag; empty -> bag_empty', () => {
    const bag: Fish[] = [
      { species: 'anchovy', sizeCm: 8, perfect: false },
      { species: 'grouper', sizeCm: 140, perfect: true },
    ]
    const s = deepFreeze(fresh({ gold: 10, totalEarned: 5, bag }))
    const sum = price('anchovy', 8, false) + price('grouper', 140, true)
    const r = ok(play(s, { type: 'sell' }, ctx()))
    expect(r.result).toEqual({ earned: sum })
    expect(r.state.gold).toBe(10 + sum)
    expect(r.state.totalEarned).toBe(5 + sum)
    expect(r.state.bag).toEqual([])
    expect(err(play(fresh(), { type: 'sell' }, ctx()))).toBe('bag_empty')
  })

  it('buyRod: 1->2 at 1500 gold leaves 0 and keeps totalEarned; 1499 -> not_enough_gold; bad tiers', () => {
    const r = ok(play(fresh({ gold: 1500, totalEarned: 2000 }), { type: 'buyRod', tier: 2, price: 1500 }, ctx()))
    expect(r.state.rodTier).toBe(2)
    expect(r.state.gold).toBe(0)
    expect(r.state.totalEarned).toBe(2000)
    expect(err(play(fresh({ gold: 1499 }), { type: 'buyRod', tier: 2, price: 1500 }, ctx()))).toBe('not_enough_gold')
    const rich = deepFreeze(fresh({ gold: 1e6 }))
    for (const tier of [3, '2', 2.5, 1, 0, NaN, null, 5]) {
      expect(err(play(rich, { type: 'buyRod', tier } as unknown as Action, ctx()))).toBe('bad_tier')
    }
  })

  it('고급 낚싯대: 4 → 5(448,000), 5 → 6(992,000), 6에서 더 없음 (v15 가격)', () => {
    expect(err(play(fresh({ gold: 279_999, rodTier: 4 }), { type: 'buyRod', tier: 5, price: 448000 }, ctx()))).toBe('not_enough_gold')
    expect(ok(play(fresh({ gold: 448_000, rodTier: 4 }), { type: 'buyRod', tier: 5, price: 448000 }, ctx())).state).toMatchObject({ gold: 0, rodTier: 5 })
    expect(ok(play(fresh({ gold: 992_000, rodTier: 5 }), { type: 'buyRod', tier: 6, price: 992000 }, ctx())).state).toMatchObject({ gold: 0, rodTier: 6 })
    expect(err(play(fresh({ gold: 1e9, rodTier: 6 }), { type: 'buyRod', tier: 7 }, ctx()))).toBe('bad_tier')
  })

  it('6단계 낚싯대는 찌 3칸, 5단계는 2칸', () => {
    const all = ['cork', 'spinner', 'curious']
    expect(ok(play(fresh({ rodTier: 6, tackles: ['cork', 'spinner', 'curious'] }), { type: 'equip', ids: all }, ctx())).state.equipped).toEqual(all)
    expect(err(play(fresh({ rodTier: 5, tackles: ['cork', 'spinner', 'curious'] }), { type: 'equip', ids: all }, ctx()))).toBe('too_many')
  })

  it('5·6단계 낚싯대로도 4단계와 같은 규칙으로 던진다(전설 포함)', () => {
    for (const rodTier of [5, 6] as const) {
      const c = rollCatch(() => 0.01, { rodTier, power: 0.95, sizeBonus: 0, area: 'island', spot: 'sea', cond: cond('summer', 12), legends: [], equipped: [] })
      expect(c.species).toBe('rainbow-marlin')
    }
  })

  it('rare species only after rod 2 (5k casts at rod 1)', () => {
    const rare = new Set(SPECIES.filter((s) => s.rarity === 'rare' || s.rarity === 'legend').map((s) => s.id))
    const rng = rngFromSeed(seedBytes(11))
    const s = fresh()
    for (let i = 0; i < 5000; i++) {
      const r = ok(play(s, { type: 'cast', area: 'pier', power: 0.5 }, { now: T0, rng }))
      expect(rare.has(r.state.pending!.species)).toBe(false)
    }
  })

  it('errors never mutate the input state', () => {
    const full: Fish[] = Array.from({ length: bagSize(1) }, () => ({ species: 'anchovy', sizeCm: 10, perfect: false }))
    const cases: [State, unknown, number?][] = [
      [fresh(), { type: 'cast', area: 'x', power: 0.5 }],
      [fresh(), { type: 'cast', area: 'pier', power: 9 }],
      [fresh({ bag: full }), { type: 'cast', area: 'pier', power: 0.5 }],
      [fresh(), { type: 'resolve', success: true, perfect: false }],
      [withHooked(), { type: 'resolve', success: true, perfect: false }, BITE],
      [withPending(), { type: 'resolve', success: true, perfect: false }, T0 + 1e6],
      [withHooked(), { type: 'resolve', success: 1, perfect: false }, T0 + 1e6],
      [fresh(), { type: 'hook' }],
      [withPending(), { type: 'hook' }, BITE - 1],
      [withPending(), { type: 'hook' }, BITE + HOOK_WINDOW_MS + HOOK_GRACE_MS + 1],
      [withHooked(), { type: 'hook' }, BITE + 1],
      [fresh(), { type: 'sell' }],
      [fresh(), { type: 'buyRod', tier: 3, price: 8000 }],
      [fresh({ gold: 5 }), { type: 'buyRod', tier: 2, price: 1500 }],
      [fresh(), { type: 'buyBag', tier: 3, price: 5000 }],
      [fresh({ gold: 799 }), { type: 'buyBag', tier: 2, price: 800 }],
      [fresh({ gold: 1e6 }), { type: 'buyBag', tier: '2' }],
      [fresh(), { type: 'dance' }],
      [fresh(), null],
      [fresh(), 'cast'],
      [fresh(), 7],
      [fresh(), []],
    ]
    for (const [state, action, now] of cases) {
      const before = JSON.stringify(state)
      deepFreeze(state)
      expect(() => play(state, action as Action, ctx(now))).not.toThrow()
      expect('error' in play(state, action as Action, ctx(now))).toBe(true)
      expect(JSON.stringify(state)).toBe(before)
    }
    expect(err(play(fresh(), { type: 'dance' } as unknown as Action, ctx()))).toBe('bad_action')
    expect(err(play(fresh(), null as unknown as Action, ctx()))).toBe('bad_action')
  })

  it('migrate fills missing fields and keeps gold/dex', () => {
    const m = migrateW({ gold: 500, dex: { anchovy: { count: 2, maxCm: 12 } } }, 0)
    expect(m).toEqual({ ...logic.init(), gold: 500, dex: { anchovy: { count: 2, maxCm: 12 } } })
    expect(logic.migrate(null, 1)).toEqual(logic.init())
    expect(logic.migrate('x', 1)).toEqual(logic.init())
    expect(logic.migrate([], 1)).toEqual(logic.init())
  })

  it('migrate v2(areas [pier], dex에 grouper) → areas 기본값, legends [grouper], 골드·가방·도감 유지', () => {
    const bag = [{ species: 'anchovy', sizeCm: 10, perfect: true }]
    const dex = { grouper: { count: 1, maxCm: 100 }, goby: { count: 2, maxCm: 12 } }
    const m = migrateW({ gold: 300, totalEarned: 900, rodTier: 3, bagTier: 2, areas: ['pier'], bag, dex }, 2)
    expect(m).toEqual({ gold: 300, totalEarned: 900, rodTier: 3, bagTier: 2, areas: [...DEFAULT_AREAS], bag, dex, legends: ['grouper'], tackles: [], equipped: [], challenges: {}, pending: null, ...W0, buffs: [], wardrobe: ['hat:crown'] })
    expect(migrateW({ dex: { goby: { count: 1, maxCm: 10 } }, areas: ['pier'] }, 2).legends).toEqual([])
  })

  it('migrate v3 세이브 → v4 그대로(골드·가방·도감·areas·legends), v2 세이브도 지금 규칙 그대로', () => {
    const bag = [{ species: 'anchovy', sizeCm: 10, perfect: true }, { species: 'catfish', sizeCm: 50, perfect: false }]
    const dex = { grouper: { count: 1, maxCm: 100 }, catfish: { count: 1, maxCm: 50 }, 'golden-mandarin': { count: 1, maxCm: 70 } }
    const v3 = { gold: 300, totalEarned: 900, rodTier: 3, bagTier: 2, areas: ['village', 'river', 'forest', 'lake'], bag, dex, legends: ['grouper', 'golden-mandarin'], pending: null }
    expect(migrateW(v3, 3)).toEqual({ ...v3, areas: [...DEFAULT_AREAS, 'lake'], tackles: [], equipped: [], challenges: {}, ...W0, buffs: [], wardrobe: ['hat:crown'] })
    const v2 = { gold: 300, totalEarned: 900, rodTier: 3, bagTier: 2, areas: ['pier'], bag, dex }
    expect(migrateW(v2, 2)).toEqual({ ...v3, tackles: [], equipped: [], challenges: {}, areas: [...DEFAULT_AREAS], ...W0, buffs: [], wardrobe: ['hat:crown'] })
  })

  it('migrate legends: 모르는 id·비전설 id는 버리고, 기본 지역은 항상 포함, 알려진 추가 지역은 유지', () => {
    const m = migrateW({ legends: ['grouper', 'kraken', 'goby', 3], areas: ['lake', 'zzz', 'village'] }, 3)
    expect(m.legends).toEqual(['grouper'])
    expect(m.areas).toEqual([...DEFAULT_AREAS, 'lake'])
    expect(migrateW({ legends: 'grouper' }, 3).legends).toEqual([])
  })

  it('migrate drops unknown species, bad fields, and pending', () => {
    const m = migrateW(
      {
        gold: 'lots', totalEarned: 40, rodTier: 9, areas: ['pier', 3],
        bag: [{ species: 'anchovy', sizeCm: 10, perfect: true }, { species: 'kraken', sizeCm: 9, perfect: false }, 'junk'],
        dex: { goby: { count: 1, maxCm: 10 }, kraken: { count: 1, maxCm: 99 }, mackerel: { count: 'x', maxCm: 1 } },
        pending: { species: 'anchovy', sizeCm: 10, biteDelayMs: 1, startedAt: 1 },
      },
      1,
    )
    expect(m.gold).toBe(0)
    expect(m.totalEarned).toBe(40)
    expect(m.rodTier).toBe(1)
    expect(m.areas).toEqual([...DEFAULT_AREAS])
    expect(m.bag).toEqual([{ species: 'anchovy', sizeCm: 10, perfect: true }])
    expect(m.dex).toEqual({ goby: { count: 1, maxCm: 10 } })
    expect(m.pending).toBeNull()
  })

  it("records: empty state -> 0, 0, '0/169'; after a catch biggest detail is the species name", () => {
    expect(logic.records(logic.init())).toEqual([
      { key: 'total_earned', value: 0 },
      { key: 'biggest', value: 0 },
      { key: 'dex', value: 0, detail: '0/169' },
      { key: 'challenges', value: 0, detail: '0/10' },
    ])
    const s = fresh({ totalEarned: 70, dex: { anchovy: { count: 1, maxCm: 12 }, grouper: { count: 1, maxCm: 100 } } })
    expect(logic.records(s)).toEqual([
      { key: 'total_earned', value: 70 },
      { key: 'biggest', value: 100, detail: '다금바리' },
      { key: 'dex', value: 2, detail: '2/169' },
      { key: 'challenges', value: 0, detail: '0/10' },
    ])
  })

  it('view passes everything but pending through', () => {
    const s = withHooked({ gold: 7 })
    const v = viewW(s, { now: T0 })
    expect(v.gold).toBe(7)
    expect(v.pending).toEqual({ biteDelayMs: 3000, startedAt: T0, hooked: true, species: 'anchovy', sizeCm: 12 })
    expect(viewW(fresh(), { now: T0 }).pending).toBeNull()
  })

  describe('찌', () => {
    it('buyTackle cork: 골드 1200 → 200, tackles [cork]; 다시 → already_owned', () => {
      const r = ok(play(fresh({ gold: 1200, totalEarned: 5 }), { type: 'buyTackle', id: 'cork' }, ctx()))
      expect(r.state).toMatchObject({ gold: 200, tackles: ['cork'], totalEarned: 5 })
      expect(err(play(deepFreeze(r.state), { type: 'buyTackle', id: 'cork' }, ctx()))).toBe('already_owned')
    })
    it('buyTackle: 골드 부족 → not_enough_gold(불변), 모르는 id → bad_tackle', () => {
      const s = deepFreeze(fresh({ gold: 999 }))
      expect(err(play(s, { type: 'buyTackle', id: 'cork' }, ctx()))).toBe('not_enough_gold')
      for (const id of ['zzz', 1, null, undefined]) {
        expect(err(play(s, { type: 'buyTackle', id } as unknown as Action, ctx()))).toBe('bad_tackle')
      }
      expect(s.gold).toBe(999)
      expect(s.tackles).toEqual([])
    })
    it('buyTackle: 5종 가격 그대로 빠지고 낚시 중에도 살 수 있다', () => {
      for (const t of TACKLES) {
        const r = ok(play(withPending({ gold: t.price }), { type: 'buyTackle', id: t.id }, ctx()))
        expect(r.state.gold).toBe(0)
        expect(r.state.tackles).toEqual([t.id])
      }
    })
    const owned = (rodTier: State['rodTier'], over: Partial<State> = {}) =>
      deepFreeze(fresh({ rodTier, tackles: ['cork', 'trap', 'spinner'], ...over }))
    it('equip: rod 3에 [cork] 성공, [] 성공(전부 해제)', () => {
      const r = ok(play(owned(3), { type: 'equip', ids: ['cork'] }, ctx()))
      expect(r.state.equipped).toEqual(['cork'])
      expect(ok(play(deepFreeze(r.state), { type: 'equip', ids: [] }, ctx())).state.equipped).toEqual([])
    })
    it('equip: rod 3에 [cork, trap] → too_many, rod 1·2는 한 개도 too_many', () => {
      expect(err(play(owned(3), { type: 'equip', ids: ['cork', 'trap'] }, ctx()))).toBe('too_many')
      expect(err(play(owned(1), { type: 'equip', ids: ['cork'] }, ctx()))).toBe('too_many')
      expect(err(play(owned(2), { type: 'equip', ids: ['cork'] }, ctx()))).toBe('too_many')
      ok(play(owned(1), { type: 'equip', ids: [] }, ctx()))
    })
    it('equip: 안 산 찌 → not_owned, [cork, cork]·모르는 id·배열 아님 → bad_tackle', () => {
      expect(err(play(owned(4), { type: 'equip', ids: ['curious'] }, ctx()))).toBe('not_owned')
      expect(err(play(owned(4), { type: 'equip', ids: ['cork', 'cork'] }, ctx()))).toBe('bad_tackle')
      expect(err(play(owned(4), { type: 'equip', ids: ['zzz'] }, ctx()))).toBe('bad_tackle')
      expect(err(play(owned(4), { type: 'equip', ids: 'cork' } as unknown as Action, ctx()))).toBe('bad_tackle')
      expect(err(play(owned(4), { type: 'equip', ids: [1] } as unknown as Action, ctx()))).toBe('bad_tackle')
    })
    it('equip: pending이 있으면 busy(상태 불변)', () => {
      const s = deepFreeze(withPending({ rodTier: 4, tackles: ['cork'] }))
      expect(err(play(s, { type: 'equip', ids: ['cork'] }, ctx()))).toBe('busy')
      expect(s.equipped).toEqual([])
    })
    it('equip: rod 4에 2개 성공, 순서 유지, 오류 시 equipped 불변', () => {
      const s = owned(4, { equipped: ['spinner'] })
      expect(ok(play(s, { type: 'equip', ids: ['trap', 'cork'] }, ctx())).state.equipped).toEqual(['trap', 'cork'])
      expect(err(play(s, { type: 'equip', ids: ['cork', 'trap', 'spinner'] }, ctx()))).toBe('too_many')
      expect(s.equipped).toEqual(['spinner'])
    })
    it('cast는 state.equipped를 CastCtx로 넘긴다: spinner 장착 세이브의 입질 지연이 짧다', () => {
      const act = { type: 'cast', area: 'village', power: 0.5 } as const
      const rng = () => sequence(0.5, 0.5, 0.5, 0.5, 0.5)
      const plain = ok(play(fresh({ rodTier: 3 }), act, { now: T0, rng: rng() })).state.pending!
      const fast = ok(play(fresh({ rodTier: 3, tackles: ['spinner'], equipped: ['spinner'] }), act, { now: T0, rng: rng() })).state.pending!
      expect(plain.biteDelayMs).toBe(3750)
      expect(fast.biteDelayMs).toBe(Math.round(3750 * 0.7))
      // 산 것만으로는 효과가 없다
      const bought = ok(play(fresh({ rodTier: 3, tackles: ['spinner'] }), act, { now: T0, rng: rng() })).state.pending!
      expect(bought.biteDelayMs).toBe(3750)
    })
    it('view는 tackles·equipped를 내보낸다', () => {
      const v = viewW(fresh({ rodTier: 3, tackles: ['cork', 'trap'], equipped: ['cork'] }), { now: T0 })
      expect(v.tackles).toEqual(['cork', 'trap'])
      expect(v.equipped).toEqual(['cork'])
    })
    it('migrate v4 세이브 → tackles [], equipped [], 나머지 그대로', () => {
      const bag = [{ species: 'anchovy', sizeCm: 10, perfect: true }]
      const dex = { grouper: { count: 1, maxCm: 100 } }
      const v4 = { gold: 300, totalEarned: 900, rodTier: 4, bagTier: 2, areas: ['village', 'river', 'forest', 'lake'], bag, dex, legends: ['grouper'], pending: null }
      expect(migrateW(v4, 4)).toEqual({ ...v4, areas: [...DEFAULT_AREAS, 'lake'], tackles: [], equipped: [], challenges: {}, ...W0, buffs: [], wardrobe: ['hat:crown'] })
    })
    it('migrate v5: 모르는 id·중복 제거, 미보유 장착 제거, 칸 초과분은 뒤에서 자른다', () => {
      const m = (raw: Record<string, unknown>) => migrateW(raw, 5)
      expect(m({ rodTier: 4, tackles: ['cork', 'zzz', 'cork', 3, 'trap'], equipped: ['trap'] })).toMatchObject({ tackles: ['cork', 'trap'], equipped: ['trap'] })
      expect(m({ rodTier: 4, tackles: ['cork'], equipped: ['trap', 'cork', 'cork', 'zzz'] }).equipped).toEqual(['cork'])
      expect(m({ rodTier: 4, tackles: ['cork', 'trap', 'spinner'], equipped: ['spinner', 'cork', 'trap'] }).equipped).toEqual(['spinner', 'cork'])
      expect(m({ rodTier: 3, tackles: ['cork', 'trap'], equipped: ['trap', 'cork'] }).equipped).toEqual(['trap'])
      expect(m({ rodTier: 2, tackles: ['cork'], equipped: ['cork'] })).toMatchObject({ tackles: ['cork'], equipped: [] })
      expect(m({ tackles: 'cork', equipped: 7 })).toMatchObject({ tackles: [], equipped: [] })
    })
  })
})

describe('지역 해금', () => {
  const unlock = (area: string) => ({ type: 'unlockArea', area, price: UNLOCKS[area as AreaId]?.price }) as unknown as Action
  it('unlockArea lake: 골드 6000 → 1000, areas에 lake, totalEarned 그대로; 다시 → already_open', () => {
    const r = ok(play(deepFreeze(fresh({ gold: 6000, totalEarned: 9000 })), unlock('lake'), ctx()))
    expect(r.state.gold).toBe(1000)
    expect(r.state.totalEarned).toBe(9000)
    expect(r.state.areas).toEqual([...DEFAULT_AREAS, 'lake'])
    expect(err(play(deepFreeze(r.state), unlock('lake'), ctx()))).toBe('already_open')
  })
  it('unlockArea: 골드 4999 → not_enough_gold(불변)', () => {
    const s = deepFreeze(fresh({ gold: 4999 }))
    expect(err(play(s, unlock('lake'), ctx()))).toBe('not_enough_gold')
    expect(s.gold).toBe(4999)
    expect(s.areas).toEqual([...DEFAULT_AREAS])
  })
  it('unlockArea: 기본 지역·모르는 id·프로토타입 키·비문자열 → bad_area', () => {
    const s = deepFreeze(fresh({ gold: 99999 }))
    for (const a of ['village', 'river', 'forest', 'zzz', '__proto__', 'constructor', 'toString', '', 3, null, undefined]) {
      expect(err(play(s, { type: 'unlockArea', area: a } as unknown as Action, ctx()))).toBe('bad_area')
    }
  })
  it('unlockArea: pending이 있으면 busy', () => {
    expect(err(play(deepFreeze(withPending({ gold: 99999 })), unlock('lake'), ctx()))).toBe('busy')
  })
  it('unlockArea cave·island 가격', () => {
    expect(ok(play(fresh({ gold: 15000 }), unlock('cave'), ctx())).state.gold).toBe(0)
    expect(ok(play(fresh({ gold: 50000 }), unlock('island'), ctx())).state.gold).toBe(0)
  })
  it('unlockArea lake 뒤 areas에 lake가 들어간다', () => {
    const s = ok(play(fresh({ gold: 5000 }), unlock('lake'), ctx())).state
    expect(s.areas).toContain('lake')
  })
  it('migrate v6 세이브(장비·잠금·해금 지역 포함)는 그대로', () => {
    const v6 = {
      gold: 10, totalEarned: 70000, rodTier: 3, bagTier: 2, areas: [...DEFAULT_AREAS, 'lake', 'cave', 'island'],
      bag: [{ species: 'anchovy', sizeCm: 10, perfect: false, locked: true }], dex: { anchovy: { count: 1, maxCm: 10 } },
      legends: [], tackles: ['cork'], equipped: ['cork'], pending: null,
    }
    expect(migrateW(v6, 6)).toEqual({ ...v6, challenges: {}, ...W0, buffs: [] })
  })
})

describe('가방 잠금', () => {
  const anchovy: Fish = { species: 'anchovy', sizeCm: 8, perfect: false }
  const grouper: Fish = { species: 'grouper', sizeCm: 140, perfect: true }
  const mackerel: Fish = { species: 'mackerel', sizeCm: 30, perfect: false }

  it('lock: 고른 칸만 잠그고, 풀면 locked 필드가 사라진다; 낚시 중에도 된다', () => {
    const s = deepFreeze(withPending({ gold: 7, bag: [anchovy, mackerel] }))
    const r = ok(play(s, { type: 'lock', index: 1, locked: true }, ctx()))
    expect(r.state.bag).toEqual([anchovy, { ...mackerel, locked: true }])
    expect(r.state.gold).toBe(7)
    expect(r.state.pending).toEqual(s.pending)
    const back = ok(play(deepFreeze(r.state), { type: 'lock', index: 1, locked: false }, ctx()))
    expect(back.state.bag).toEqual([anchovy, mackerel])
    expect('locked' in back.state.bag[1]).toBe(false)
  })

  it('lock: 잘못된 index·locked → bad_action', () => {
    const s = deepFreeze(fresh({ bag: [anchovy, mackerel] }))
    const bad = [
      { index: -1, locked: true }, { index: 2, locked: true }, { index: 0.5, locked: true },
      { index: '0', locked: true }, { index: 0, locked: 'yes' }, { index: 0 }, { locked: true },
    ]
    for (const a of bad) expect(err(play(s, { type: 'lock', ...a } as unknown as Action, ctx()))).toBe('bad_action')
  })

  it('sell: 잠긴 물고기는 남기고 값에 넣지 않는다; 전부 잠겨 있으면 bag_empty', () => {
    const locked: Fish = { ...grouper, locked: true }
    const s = deepFreeze(fresh({ gold: 10, totalEarned: 5, bag: [anchovy, locked, mackerel] }))
    const sum = price('anchovy', 8, false) + price('mackerel', 30, false)
    const r = ok(play(s, { type: 'sell' }, ctx()))
    expect(r.result).toEqual({ earned: sum })
    expect(r.state.gold).toBe(10 + sum)
    expect(r.state.totalEarned).toBe(5 + sum)
    expect(r.state.bag).toEqual([locked])
    expect(err(play(deepFreeze(r.state), { type: 'sell' }, ctx()))).toBe('bag_empty')
  })

  it('resolve: 전설은 잠긴 채 가방에 들어가고, 일반 어종은 잠기지 않는다', () => {
    const p = withHooked().pending!
    const legend = withHooked({ pending: { ...p, species: 'grouper', sizeCm: 120 } })
    const r = ok(play(legend, { type: 'resolve', success: true, perfect: false }, ctx(T0 + 1e6)))
    const fish = { species: 'grouper', sizeCm: 120, perfect: false, locked: true }
    expect(r.state.bag).toEqual([fish])
    expect(r.result).toEqual({ caught: fish })
    const n = ok(play(withHooked(), { type: 'resolve', success: true, perfect: false }, ctx(T0 + 1e6)))
    expect(n.state.bag).toEqual([{ species: 'anchovy', sizeCm: 12, perfect: false }])
  })

  it('migrate: v4 이하 가방의 전설은 잠그고, v5 세이브의 잠금은 저장된 그대로(true만 인정)', () => {
    expect(migrateW({ bag: [anchovy, grouper] }, 4).bag).toEqual([anchovy, { ...grouper, locked: true }])
    expect(migrateW({ bag: [anchovy, grouper] }, 2).bag).toEqual([anchovy, { ...grouper, locked: true }])
    const v5 = [{ ...anchovy, locked: true }, grouper, { ...mackerel, locked: 'x' }, { ...mackerel, locked: false }]
    expect(migrateW({ bag: v5 }, 5).bag).toEqual([{ ...anchovy, locked: true }, grouper, mackerel, mackerel])
  })

  it('migrate: 잠금만 있던 v5 세이브(찌 필드 없음) → v6에서 잠금은 그대로, 찌는 빈 목록', () => {
    const m = migrateW({ gold: 900, rodTier: 3, bag: [{ ...grouper, locked: true }, anchovy] }, 5)
    expect(m.bag).toEqual([{ ...grouper, locked: true }, anchovy])
    expect(m.tackles).toEqual([])
    expect(m.equipped).toEqual([])
    expect(m.gold).toBe(900)
  })
})

describe('도전과제', () => {
  const ALL_OPEN = [...DEFAULT_AREAS, 'lake', 'cave', 'island'] as State['areas']
  /** 챈 상태: 던질 때 지역·자리·조건은 p로 정한다 */
  const hooked = (p: Partial<Pending>, over: Partial<State> = {}): State =>
    fresh({
      areas: ALL_OPEN,
      pending: { species: 'goby', sizeCm: 10, biteDelayMs: 3000, startedAt: T0, hookedAt: BITE, area: 'village', spot: 'shore', cond: cond('spring', 12), power: 0.5, ...p },
      ...over,
    })
  /** 잡기 성공. now는 어느 계절·날씨여도 판정은 던질 때 조건으로 */
  const land = (s: State, perfect = false, now = BITE + MIN_FIGHT_MS) => ok(play(deepFreeze(s), { type: 'resolve', success: true, perfect }, ctx(now)))
  /** 같은 조건으로 n번 잡는다 */
  const landTimes = (p: Partial<Pending>, n: number, perfect = false, start: State['challenges'] = {}) => {
    let challenges = start
    let last: ReturnType<typeof land> | null = null
    for (let i = 0; i < n; i++) {
      last = land(hooked(p, { challenges }), perfect)
      challenges = last.state.challenges
    }
    return { challenges, last: last! }
  }

  it('init: challenges {}', () => {
    expect(logic.init().challenges).toEqual({})
  })

  it('부두 완벽: 해안·완벽 아님은 안 세고, 3마리째에 done과 completed, 깬 뒤에는 더 세지 않는다', () => {
    expect(land(hooked({ spot: 'shore' }), true).state.challenges).toEqual({})
    expect(land(hooked({ spot: 'pier' }), false).state.challenges).toEqual({})
    const one = land(hooked({ spot: 'pier' }), true)
    expect(one.state.challenges['pier-perfect']).toEqual({ progress: 1, done: false })
    expect(one.result).toEqual({ caught: { species: 'goby', sizeCm: 10, perfect: true } })
    const { challenges, last } = landTimes({ spot: 'pier' }, 3, true)
    expect(challenges['pier-perfect']).toEqual({ progress: 3, done: true })
    expect(last.result).toEqual({ caught: { species: 'goby', sizeCm: 10, perfect: true }, completed: ['pier-perfect'] })
    const more = land(hooked({ spot: 'pier' }, { challenges }), true)
    expect(more.state.challenges['pier-perfect']).toEqual({ progress: 3, done: true })
    expect(more.result).toEqual({ caught: { species: 'goby', sizeCm: 10, perfect: true } })
  })

  it('강 비: 비 오는 날 던지고 맑은 날 거둬도 센다; 맑은 날 던지고 비 올 때 거두면 안 센다', () => {
    const rainCast = hooked({ area: 'river', spot: 'river', species: 'pale-chub', cond: cond('summer', 12, 'rain') })
    // 거두는 시각(now)은 맑은 날·다른 계절이어도 된다
    const sunnyNow = nowAt(5, 9)
    expect(conditionsAt(sunnyNow).weather === 'sun' || conditionsAt(sunnyNow).season !== 'summer').toBe(true)
    expect(land(rainCast, false, sunnyNow).state.challenges['river-rain']).toEqual({ progress: 1, done: false })
    const sunCast = hooked({ area: 'river', spot: 'river', species: 'pale-chub', cond: cond('summer', 12, 'sun') })
    expect(land(sunCast).state.challenges).toEqual({})
    expect(landTimes({ area: 'river', spot: 'river', species: 'pale-chub', cond: cond('winter', 3, 'rain') }, 5).challenges['river-rain']).toEqual({ progress: 5, done: true })
  })

  it('숲 3종: 같은 어종 두 번은 하나, 다른 어종이면 늘고 seen에 쌓인다', () => {
    const at = (species: string, spot: string) => ({ area: 'forest' as const, spot, species, cond: cond('winter', 12) })
    let s = land(hooked(at('crucian', 'pond'))).state.challenges
    s = land(hooked(at('crucian', 'pond'), { challenges: s })).state.challenges
    expect(s['forest-variety']).toEqual({ progress: 1, seen: ['crucian'], done: false })
    s = land(hooked(at('carp', 'pond'), { challenges: s })).state.challenges
    const r = land(hooked(at('stream-minnow', 'waterfall'), { challenges: s }))
    expect(r.state.challenges['forest-variety']).toEqual({ progress: 3, seen: ['crucian', 'carp', 'stream-minnow'], done: true })
    expect((r.result as { completed?: string[] }).completed).toEqual(['forest-variety'])
  })

  it('산 호수 밤: 20~5시에 던진 것만', () => {
    const at = (hour: number) => ({ area: 'lake' as const, spot: 'lake', species: 'rainbow-trout', cond: cond('autumn', hour) })
    expect(land(hooked(at(12))).state.challenges).toEqual({})
    expect(land(hooked(at(19))).state.challenges).toEqual({})
    expect(land(hooked(at(20))).state.challenges['lake-night']).toEqual({ progress: 1, done: false })
    expect(land(hooked(at(4))).state.challenges['lake-night']).toEqual({ progress: 1, done: false })
    expect(land(hooked(at(5))).state.challenges).toEqual({})
  })

  it('동굴 용암: cave3만', () => {
    expect(land(hooked({ area: 'cave', spot: 'cave1', species: 'blind-fish' })).state.challenges).toEqual({})
    expect(land(hooked({ area: 'cave', spot: 'cave3', species: 'ember-carp' })).state.challenges['cave-deep']).toEqual({ progress: 1, done: false })
  })

  it('섬 대물: 크기 백분위 0.7 이상만', () => {
    // 청줄돔 8~18cm: 15cm → 0.7, 14cm → 0.6
    expect(sizePercentile('blue-damsel', 15)).toBeCloseTo(0.7)
    expect(land(hooked({ area: 'island', spot: 'sea', species: 'blue-damsel', sizeCm: 14 })).state.challenges).toEqual({})
    expect(land(hooked({ area: 'island', spot: 'sea', species: 'blue-damsel', sizeCm: 15 })).state.challenges['island-big']).toEqual({ progress: 1, done: false })
  })

  it('실패 resolve와 다른 지역 잡이는 세지 않는다', () => {
    const miss = ok(play(hooked({ spot: 'pier' }), { type: 'resolve', success: false, perfect: false }, ctx(BITE + MIN_FIGHT_MS)))
    expect(miss.state.challenges).toEqual({})
    // 강에서 비 오는 날 완벽하게 잡아도 마을 과제(부두)·숲 과제는 그대로
    const r = land(hooked({ area: 'river', spot: 'river', species: 'pale-chub', cond: cond('spring', 12, 'rain') }), true)
    expect(Object.keys(r.state.challenges)).toEqual(['river-rain'])
  })

  it('pending에 cond·area가 없는(비정상) 상태: 물고기는 들어오고 과제만 그대로', () => {
    const base = hooked({ spot: 'pier' })
    const { cond: _c, area: _a, ...rest } = base.pending!
    const broken = { ...base, pending: rest as unknown as Pending }
    const r = land(broken, true)
    expect(r.state.bag).toEqual([{ species: 'goby', sizeCm: 10, perfect: true }])
    expect(r.state.challenges).toEqual({})
  })

  it('progressChallenges·challengeMatches는 순수: 이전 객체를 바꾸지 않는다', () => {
    const prev = deepFreeze({ 'pier-perfect': { progress: 1, done: false } })
    const facts = { area: 'village' as const, spot: 'pier', cond: cond('spring', 12), species: 'goby', sizeCm: 10, perfect: true }
    expect(challengeMatches(CHALLENGES.find((c) => c.id === 'pier-perfect')!, facts)).toBe(true)
    const out = progressChallenges(prev, facts)
    expect(out.challenges['pier-perfect']).toEqual({ progress: 2, done: false })
    expect(out.completed).toEqual([])
    expect(prev['pier-perfect'].progress).toBe(1)
  })

  it('teleporterOpen: 과제 done이고 지역이 열려 있을 때만', () => {
    const done = { 'cave-deep': { progress: 5, done: true } }
    expect(teleporterOpen({ areas: ALL_OPEN, challenges: done }, 'cave')).toBe(true)
    expect(teleporterOpen({ areas: [...DEFAULT_AREAS], challenges: done }, 'cave')).toBe(false)
    expect(teleporterOpen({ areas: ALL_OPEN, challenges: { 'cave-deep': { progress: 4, done: false } } }, 'cave')).toBe(false)
    expect(teleporterOpen({ areas: ALL_OPEN, challenges: {} }, 'village')).toBe(false)
  })

  it('migrate v7 세이브(던진 중 포함) → challenges {}, pending null, 나머지 그대로', () => {
    const v7 = {
      gold: 10, totalEarned: 70000, rodTier: 3, bagTier: 2, areas: ALL_OPEN,
      bag: [{ species: 'anchovy', sizeCm: 10, perfect: false, locked: true }], dex: { anchovy: { count: 1, maxCm: 10 } },
      legends: [], tackles: ['cork'], equipped: ['cork'],
      pending: { species: 'anchovy', sizeCm: 12, biteDelayMs: 3000, startedAt: T0, hookedAt: BITE, area: 'village', spot: 'pier', cond: cond('spring', 12), power: 0.5 },
    }
    expect(migrateW(v7, 7)).toEqual({ ...v7, pending: null, challenges: {}, ...W0, buffs: [] })
    expect(migrateW({ ...v7, pending: { species: 'anchovy' } }, 2).challenges).toEqual({})
  })

  it('migrate v8 세이브: challenges를 정리해 유지(모르는 id·잘못된 값 버림, done 유지)', () => {
    const raw = {
      challenges: {
        'pier-perfect': { progress: 3, done: true },
        'forest-variety': { progress: 2, seen: ['crucian', 'zzz', 'crucian', 'carp'], done: false },
        'river-rain': { progress: -1, done: 'yes' },
        'lake-night': { progress: 2.5, done: false },
        'cave-deep': 'x',
        zzz: { progress: 1, done: true },
        ['__proto__']: { progress: 1, done: true },
      },
    }
    expect(migrateW(raw, 8).challenges).toEqual({
      'pier-perfect': { progress: 3, done: true },
      'forest-variety': { progress: 2, seen: ['crucian', 'carp'], done: false },
      'river-rain': { progress: 0, done: false },
      'lake-night': { progress: 2, done: false },
    })
  })

  it('migrate v8 → v9: 세이브 그대로(고급 장비만 더해졌다)', () => {
    const v8 = {
      gold: 123_456, totalEarned: 999_999, rodTier: 4, bagTier: 3, areas: ALL_OPEN,
      bag: [{ species: 'grouper', sizeCm: 100, perfect: true, locked: true }, { species: 'anchovy', sizeCm: 10, perfect: false }],
      dex: { grouper: { count: 1, maxCm: 100 }, anchovy: { count: 3, maxCm: 12 } },
      legends: ['grouper'], tackles: ['cork', 'spinner', 'curious'], equipped: ['spinner', 'curious'],
      challenges: { 'pier-perfect': { progress: 3, done: true }, 'forest-variety': { progress: 1, seen: ['carp'], done: false } },
      pending: null,
    }
    // 전설 1마리·부두 과제를 이미 이룬 세이브는 migrate에서 업적 옷(왕관·산호 낚싯대)을 받는다
    expect(migrateW(v8, 8)).toEqual({ ...v8, ...W0, buffs: [], wardrobe: ['hat:crown', 'rodSkin:coral'] })
    // v9 세이브(고급 장비)도 그대로 읽는다
    const v9 = { ...v8, rodTier: 6, bagTier: 5, equipped: ['cork', 'spinner', 'curious'] }
    expect(migrateW(v9, 9)).toEqual({ ...v9, ...W0, buffs: [], wardrobe: ['hat:crown', 'rodSkin:coral'] })
  })

  it('records: 도전과제 n/10', () => {
    expect(logic.records(logic.init()).at(-1)).toEqual({ key: 'challenges', value: 0, detail: '0/10' })
    const s = fresh({ challenges: { 'pier-perfect': { progress: 3, done: true }, 'river-rain': { progress: 2, done: false } } })
    expect(logic.records(s).at(-1)).toEqual({ key: 'challenges', value: 1, detail: '1/10' })
  })
})

describe('순간이동', () => {
  const ALL_OPEN = [...DEFAULT_AREAS, 'lake', 'cave', 'island'] as State['areas']
  const DONE = { progress: 9, done: true }
  const allDone = Object.fromEntries(CHALLENGES.map((c) => [c.id, DONE]))
  const tp = (from: unknown, to: unknown) => ({ type: 'teleport', from, to }) as unknown as Action
  const rich = (over: Partial<WS> = {}) => deepFreeze(fresh({ gold: 10_000, totalEarned: 777, areas: ALL_OPEN, challenges: allDone, ...over }))

  it('village → river: 요금만큼 골드가 줄고 totalEarned 그대로, result {from, to, fee}', () => {
    const fee = teleportFee('village', 'river')
    const r = ok(play(rich(), tp('village', 'river'), ctx()))
    expect(r.state.gold).toBe(10_000 - fee)
    expect(r.state.totalEarned).toBe(777)
    expect(r.result).toEqual({ from: 'village', to: 'river', fee })
    // 요금이 딱 맞으면 0이 된다
    expect(ok(play(rich({ gold: fee }), tp('village', 'river'), ctx())).state.gold).toBe(0)
  })

  it('모르는 id·프로토타입 키·문자열 아님 → bad_teleporter', () => {
    const s = rich()
    for (const [from, to] of [['zzz', 'river'], ['village', 'zzz'], ['__proto__', 'river'], ['village', 'constructor'], [3, 'river'], ['village', null], [undefined, undefined]]) {
      expect(err(play(s, tp(from, to), ctx())), `${String(from)}→${String(to)}`).toBe('bad_teleporter')
    }
  })

  it('같은 곳 → same, 낚시 중 → busy', () => {
    expect(err(play(rich(), tp('river', 'river'), ctx()))).toBe('same')
    const p = withPending().pending
    expect(err(play(rich({ pending: p }), tp('village', 'river'), ctx()))).toBe('busy')
  })

  it('꺼진 이동기(과제 미완, 또는 과제는 깼지만 지역이 안 열림) → not_open', () => {
    const partial = { ...allDone, 'river-rain': { progress: 4, done: false } }
    expect(err(play(rich({ challenges: partial }), tp('village', 'river'), ctx()))).toBe('not_open')
    expect(err(play(rich({ challenges: partial }), tp('river', 'village'), ctx()))).toBe('not_open')
    expect(err(play(rich({ areas: [...DEFAULT_AREAS, 'lake'] }), tp('village', 'island'), ctx()))).toBe('not_open')
    expect(err(play(rich({ challenges: {} }), tp('village', 'river'), ctx()))).toBe('not_open')
  })

  it('골드가 요금보다 1 모자라면 not_enough_gold, 상태 불변', () => {
    const fee = teleportFee('cave', 'island')
    const s = rich({ gold: fee - 1 })
    expect(err(play(s, tp('cave', 'island'), ctx()))).toBe('not_enough_gold')
    expect(s.gold).toBe(fee - 1)
  })

  it('섬으로 가는 요금은 마을→강의 세 배보다 비싸다', () => {
    const toIsland = ok(play(rich(), tp('village', 'island'), ctx())).result as { fee: number }
    const toRiver = ok(play(rich(), tp('village', 'river'), ctx())).result as { fee: number }
    expect(toIsland.fee).toBeGreaterThan(3 * toRiver.fee)
  })
})

describe('옷장 (logic.version 10)', () => {
  it('buyWear: 골드를 빼고 옷장에 넣고 바로 입는다', () => {
    const s = deepFreeze(fresh({ gold: 25_000 }))
    const r = ok(play(s, { type: 'buyWear', slot: 'hat', id: 'straw' }, ctx()))
    expect(r.state.gold).toBe(5_000)
    expect(r.state.wardrobe).toEqual(['hat:straw'])
    expect(r.state.outfit).toEqual({ ...DEFAULT_OUTFIT, hat: 'straw' })
    // 다른 부위의 같은 id(검정)는 따로 산다
    const r2 = ok(play(r.state, { type: 'buyWear', slot: 'bottom', id: 'black' }, ctx()))
    expect(r2.state.wardrobe).toEqual(['hat:straw', 'bottom:black'])
    expect(r2.state.outfit.bottom).toBe('black')
    expect(r2.state.outfit.hairColor).toBe('brown')
  })

  it('buyWear 오류: 이미 가짐·무료·업적·모르는 것·골드 부족', () => {
    const s = deepFreeze(fresh({ gold: 1_000_000, wardrobe: ['hat:straw'] }))
    expect(err(play(s, { type: 'buyWear', slot: 'hat', id: 'straw' }, ctx()))).toBe('already_owned')
    expect(err(play(s, { type: 'buyWear', slot: 'hat', id: 'none' }, ctx()))).toBe('already_owned')
    expect(err(play(s, { type: 'buyWear', slot: 'hat', id: 'crown' }, ctx()))).toBe('not_for_sale')
    expect(err(play(s, { type: 'buyWear', slot: 'hat', id: 'zzz' }, ctx()))).toBe('bad_wear')
    expect(err(play(s, { type: 'buyWear', slot: 'shoes', id: 'straw' }, ctx()))).toBe('bad_wear')
    expect(err(play(s, { type: 'buyWear', slot: 'top', id: 'straw' }, ctx()))).toBe('bad_wear')
    expect(err(play(s, { type: 'buyWear', slot: 'hat', id: 7 } as unknown as Action, ctx()))).toBe('bad_wear')
    expect(err(play(fresh({ gold: 19_999 }), { type: 'buyWear', slot: 'hat', id: 'straw' }, ctx()))).toBe('not_enough_gold')
  })

  it('모든 상점 품목을 살 수 있고, 업적 품목은 하나도 못 산다', () => {
    let s = fresh({ gold: 10_000_000 })
    for (const w of WEAR) {
      const r = play(s, { type: 'buyWear', slot: w.slot, id: w.id }, ctx())
      if (w.unlock) expect(err(r)).toBe('not_for_sale')
      else if (w.price === 0) expect(err(r)).toBe('already_owned')
      else s = ok(r).state
    }
    expect(s.gold).toBe(10_000_000 - 1_340_000)
  })

  it('wear: 가진 것만, 부위가 맞아야 한다', () => {
    const s = deepFreeze(fresh({ wardrobe: [wearKey('top', 'kit-stripes')] }))
    expect(ok(play(s, { type: 'wear', slot: 'top', id: 'kit-stripes' }, ctx())).state.outfit.top).toBe('kit-stripes')
    expect(ok(play(s, { type: 'wear', slot: 'hat', id: 'none' }, ctx())).state.outfit.hat).toBe('none')
    expect(err(play(s, { type: 'wear', slot: 'top', id: 'kit-red' }, ctx()))).toBe('not_owned')
    expect(err(play(s, { type: 'wear', slot: 'hat', id: 'kit-stripes' }, ctx()))).toBe('bad_wear')
    expect(err(play(s, { type: 'wear', slot: 'zzz', id: 'none' }, ctx()))).toBe('bad_wear')
    expect(err(play(s, { type: 'wear', slot: 'hat', id: 'crown' }, ctx()))).toBe('not_owned')
  })

  it('업적 옷은 조건을 채운 행동에서 바로 저장되고, 그다음 입는다', () => {
    // 전설을 잡는 resolve에서 왕관을 얻는다
    const hooked = withHooked()
    const legendHooked = { ...hooked, pending: { ...hooked.pending!, species: 'grouper', sizeCm: 100, spot: 'pier', cond: cond('winter', 12) } }
    const caught = ok(play(legendHooked, { type: 'resolve', success: true, perfect: false }, ctx(BITE + MIN_FIGHT_MS)))
    expect(caught.state.wardrobe).toEqual(['hat:crown'])
    expect(ok(play(caught.state, { type: 'wear', slot: 'hat', id: 'crown' }, ctx())).state.outfit.hat).toBe('crown')
    // 과제 6개를 다 깬 세이브: 아무 행동 하나로 저장된다(무지개 + 과제별 업적 옷)
    const all = Object.fromEntries(CHALLENGES.map((c) => [c.id, { progress: c.count, done: true }]))
    const s1 = ok(play(fresh({ challenges: all }), { type: 'wear', slot: 'hat', id: 'none' }, ctx())).state
    expect(s1.wardrobe).toEqual(expect.arrayContaining(['rodSkin:rainbow', 'rodSkin:coral', 'rodSkin:ice', 'top:lava-suit', 'top:moss-vest', 'bottom:wave', 'hairColor:rain']))
    expect(ok(play(s1, { type: 'wear', slot: 'rodSkin', id: 'rainbow' }, ctx())).state.outfit.rodSkin).toBe('rainbow')
    // 한 지역 도감
    const dex = Object.fromEntries(SPECIES.filter((s) => s.area === 'river').map((s) => [s.id, { count: 1, maxCm: s.minCm }]))
    expect(ok(play(fresh({ dex }), { type: 'wear', slot: 'hat', id: 'none' }, ctx())).state.wardrobe).toContain('hat:fish-hat')
    // 저장 안 된(조건만 채운) 상태에서 곧장 입기는 거부된다 — 실제 세이브는 행동·migrate에서 이미 저장돼 있다
    expect(err(play(fresh({ legends: ['grouper'] }), { type: 'wear', slot: 'hat', id: 'crown' }, ctx()))).toBe('not_owned')
  })

  it('얻은 업적 옷은 과제·어종이 늘어도(다음 확장) 잃지 않는다', () => {
    const all = Object.fromEntries(CHALLENGES.map((c) => [c.id, { progress: c.count, done: true }]))
    const s = ok(play(fresh({ challenges: all }), { type: 'wear', slot: 'hat', id: 'none' }, ctx())).state
    const worn = ok(play(s, { type: 'wear', slot: 'rodSkin', id: 'rainbow' }, ctx())).state
    // 7번째 과제가 생긴 데이터에서는 조건이 거짓이 된다
    const grown = { challenges: [...CHALLENGES, { id: 'new-7' }], species: SPECIES }
    expect(unlockMet(worn, { kind: 'allChallenges' }, grown)).toBe(false)
    expect(newlyEarned({ ...worn, wardrobe: [] }, grown)).not.toContain('rodSkin:rainbow')
    // 그래도 저장된 옷은 가진 것이고, migrate(v10 → v10, 다음 버전도 같은 길)가 입은 채로 둔다
    expect(ownsWear(worn, 'rodSkin', 'rainbow')).toBe(true)
    const again = migrateW(JSON.parse(JSON.stringify(worn)), 10)
    expect(again.wardrobe).toContain('rodSkin:rainbow')
    expect(again.outfit.rodSkin).toBe('rainbow')
    // 어종이 늘어 지역 도감이 다시 미완성이 돼도 물고기 모자는 남는다
    const dex = Object.fromEntries(SPECIES.filter((x) => x.area === 'river').map((x) => [x.id, { count: 1, maxCm: x.minCm }]))
    const withHat = ok(play(fresh({ dex }), { type: 'wear', slot: 'hat', id: 'none' }, ctx())).state
    const moreFish = { challenges: CHALLENGES, species: [...SPECIES, { id: 'new-river-fish', area: 'river' }] }
    expect(unlockMet(withHat, { kind: 'areaDex' }, { ...moreFish, species: moreFish.species.filter((x) => x.area === 'river') })).toBe(false)
    expect(ownsWear(withHat, 'hat', 'fish-hat')).toBe(true)
    expect(migrateW(withHat, 10).wardrobe).toContain('hat:fish-hat')
  })

  it('옷은 낚시 중에도 바꿀 수 있고 pending을 건드리지 않는다', () => {
    const s = withPending()
    const r = ok(play(s, { type: 'wear', slot: 'hat', id: 'none' }, ctx()))
    expect(r.state.pending).toBe(s.pending)
  })

  it('migrate v9 → v10: 빈 옷장, 기본 옷차림', () => {
    const m = migrateW({ gold: 5, rodTier: 6 }, 9)
    expect(m.wardrobe).toEqual([])
    expect(m.outfit).toEqual(DEFAULT_OUTFIT)
  })

  it('migrate v10: 모르는 키·중복·안 가진 옷·다른 부위 id는 정리한다', () => {
    const m = migrateW({
      wardrobe: ['hat:straw', 'hat:straw', 'hat:zzz', 'hat:none', 'hat:crown', 'top:kit-red', 3, 'straw'],
      outfit: { hat: 'straw', top: 'kit-stripes', bottom: 'zzz', hair: 'afro', hairColor: 'gold', rodSkin: 'bamboo', extra: 'x' },
    }, 10)
    // 저장된 업적 옷 키(hat:crown)는 조건과 상관없이 남는다(저장된 것이 곧 소유)
    expect(m.wardrobe).toEqual(['hat:straw', 'hat:crown', 'top:kit-red'])
    expect(m.outfit).toEqual({ ...DEFAULT_OUTFIT, hat: 'straw' })
    expect(migrateW({ outfit: 'x' }, 10).outfit).toEqual(DEFAULT_OUTFIT)
    // 업적 옷은 조건을 채웠으면 그대로 남는다
    expect(migrateW({ legends: ['grouper'], outfit: { hat: 'crown' } }, 10).outfit.hat).toBe('crown')
  })

  it('avatar: 옷차림 JSON', () => {
    const s = fresh({ outfit: { ...DEFAULT_OUTFIT, hat: 'straw' } })
    expect(JSON.parse(logic.avatar!(s))).toEqual({ ...DEFAULT_OUTFIT, hat: 'straw' })
  })

  it('view에 wardrobe·outfit이 나간다', () => {
    const v = viewW(fresh({ wardrobe: ['hat:cap'], outfit: { ...DEFAULT_OUTFIT, hat: 'cap' } }), { now: T0 })
    expect(v.wardrobe).toEqual(['hat:cap'])
    expect(v.outfit.hat).toBe('cap')
  })
})

// ---------------------------------------------------------------- 낚시 5부 M1: 신화·버프·물때·지역 최소 낚싯대
describe('신화 추첨 (합성 지역)', () => {
  withTempData(M1_FIXTURE)
  const myth = (over: Partial<CastCtx> = {}): CastCtx =>
    ctxOf({ area: TMP_MYTH, spot: 'den', rodTier: 5, power: 0.95, cond: cond('spring', 12), ...over })
  const pick = (r0: number, over: Partial<CastCtx> = {}) => rollCatch(sequence(r0, 0.1, 0.1, 0.5, 0.5), myth(over)).species
  const BOTH = ['tmp-legend', 'grouper']

  it('rng 5번: 신화 후보가 있을 때도, 뽑힐 때도', () => {
    for (const r0 of [0, 0.01, 0.5]) {
      for (const over of [{}, { legends: BOTH }, { legends: BOTH, equipped: ['curious'] as TackleId[] }, { spot: 'lair', legends: ['grouper'] }]) {
        const rng = counting(sequence(r0, 0.5, 0.5, 0.5, 0.5))
        rollCatch(rng, myth(over))
        expect(rng.n).toBe(5)
      }
    }
  })
  it('needs를 다 잡기 전에는 r0 = 0이어도 신화가 안 나온다(같은 자리 전설이 대신 후보)', () => {
    expect(pick(0)).toBe('tmp-legend')
    expect(pick(0, { legends: ['tmp-legend'] })).toBe('tmp-common')
    expect(pick(0, { legends: ['grouper'] })).toBe('tmp-legend')
  })
  it('같은 자리 전설이 후보면 전설 확률로 전설: r0 = MYTHIC_CHANCE와 LEGEND_CHANCE 사이에서 전설', () => {
    expect(pick((MYTHIC_CHANCE + LEGEND_CHANCE) / 2)).toBe('tmp-legend')
  })
  it('needs를 다 잡으면 r0 < MYTHIC_CHANCE에서 신화, r0 = MYTHIC_CHANCE면 일반', () => {
    expect(pick(0, { legends: BOTH })).toBe('tmp-mythic')
    expect(pick(MYTHIC_CHANCE - 1e-9, { legends: BOTH })).toBe('tmp-mythic')
    expect(pick(MYTHIC_CHANCE, { legends: BOTH })).toBe('tmp-common')
  })
  it('호기심 찌면 신화 확률 ×curiousMythic', () => {
    const r0 = MYTHIC_CHANCE * 1.2
    expect(pick(r0, { legends: BOTH })).toBe('tmp-common')
    expect(pick(r0, { legends: BOTH, equipped: ['curious'] })).toBe('tmp-mythic')
    expect(pick(MYTHIC_CHANCE * TACKLE_FX.curiousMythic, { legends: BOTH, equipped: ['curious'] })).toBe('tmp-common')
  })
  it('힘 미달·낚싯대 미달·이미 잡음이면 안 나온다', () => {
    expect(pick(0, { legends: BOTH, power: 0.94 })).toBe('tmp-common')
    expect(pick(0, { legends: BOTH, rodTier: 4 })).toBe('tmp-common')
    expect(pick(0, { legends: [...BOTH, 'tmp-mythic'] })).toBe('tmp-common')
  })
  it('전설이 없는 자리: needs(다른 지역 전설)만 채우면 신화, 힘 0이면 power 무관', () => {
    expect(pick(0, { spot: 'lair', power: 0.1 })).toBe('tmp-common')
    expect(pick(0, { spot: 'lair', power: 0.1, legends: ['grouper'] })).toBe('tmp-mythic2')
  })
  it('일반 등급 추첨에 신화·전설이 섞이지 않는다(5k회, 예외 없음)', () => {
    const rng = rngFromSeed(seedBytes(71))
    for (let i = 0; i < 5000; i++) {
      const s = byId(rollCatch(rng, myth({ legends: [...BOTH, 'tmp-mythic'] })).species)
      expect(s.rarity).not.toBe('mythic')
      expect(s.rarity).not.toBe('legend')
    }
  })
  it('기존 지역 골든: 합성 신화가 있어도·buffs []여도 v4 골든 열 그대로', () => {
    const k = (rodTier: CastCtx['rodTier'], power: number, sizeBonus: number, area: CastCtx['area'], spot: string, c: Conditions) =>
      ctxOf({ rodTier, power, sizeBonus, area, spot, cond: c, buffs: [] })
    const ctxs = [k(1, 0.5, 0, 'village', 'shore', cond('spring', 12)), k(3, 0.95, 0.25, 'village', 'pier', cond('winter', 12))]
    const rows = [[0.01, 0.5, 0.5, 0.5, 0.5], [0.5, 0.1, 0.2, 0.3, 0.4], [0.5, 0.45, 0.9, 0.7, 0.0]]
    // 어종 확장(v19) 75종(앞 94종 뒤, 합성 어종 앞)을 잠시 빼고 옛 데이터로 돈다
    const cut = (SPECIES as Species[]).splice(SPECIES_BEFORE_EXPANSION, 75)
    try {
      const got = ctxs.flatMap((x) => rows.map((r) => { const o = rollCatch(sequence(...r), x); return [o.species, o.sizeCm, o.biteDelayMs] }))
      expect(got).toEqual([["goby",14,3750],["anchovy",10,3300],["horse-mackerel",29,1500],["grouper",129,3750],["goby",16,3300],["mackerel",43,1500]])
    } finally {
      ;(SPECIES as Species[]).splice(SPECIES_BEFORE_EXPANSION, 0, ...cut)
    }
  })
  it('imugi-scale: 같은 rng에서 입질 ×0.85(반올림), 어종·크기 같음; 회전 찌와 곱', () => {
    for (const rodTier of [1, 4, 6] as const) {
      for (const r4 of [0, 0.3, 0.77, 0.999]) {
        for (const equipped of [[], ['spinner']] as TackleId[][]) {
          const base = rollCatch(sequence(0.5, 0.5, 0.5, 0.5, r4), ctxOf({ rodTier, equipped }))
          const fast = rollCatch(sequence(0.5, 0.5, 0.5, 0.5, r4), ctxOf({ rodTier, equipped, buffs: ['imugi-scale'] }))
          const exact = (1500 + r4 * 4500) * RODS.find((r) => r.tier === rodTier)!.biteScale * (equipped.length ? TACKLE_FX.spinnerBite : 1) * BUFF_FX.imugiBite
          expect(fast.biteDelayMs).toBe(Math.round(exact))
          expect({ ...fast, biteDelayMs: 0 }).toEqual({ ...base, biteDelayMs: 0 })
        }
      }
    }
  })
  it('다른 버프(dragon-breath·dragon-pearl)는 추첨에 영향이 없다', () => {
    const a = rngFromSeed(seedBytes(72)), b = rngFromSeed(seedBytes(72))
    for (let i = 0; i < 200; i++) expect(rollCatch(a, ctxOf({ rodTier: 4, buffs: ['dragon-breath', 'dragon-pearl'] }))).toEqual(rollCatch(b, ctxOf({ rodTier: 4 })))
  })
})

describe('신화 잡기·버프·판매 (합성 지역)', () => {
  withTempData(M1_FIXTURE)
  const hooked = (species: string, over: Partial<State> = {}): State =>
    fresh({ pending: { species, sizeCm: 400, biteDelayMs: 3000, startedAt: T0, hookedAt: BITE, area: TMP_MYTH, spot: 'den', cond: cond('spring', 12), power: 0.95 }, ...over })
  const win = (s: State) => ok(play(s, { type: 'resolve', success: true, perfect: false }, ctx(BITE + MIN_FIGHT_MS)))

  it('신화를 잡으면 legends·buffs에 들어가고 잠긴 채 가방에, result.buff', () => {
    const r = win(hooked('tmp-mythic', { legends: ['tmp-legend', 'grouper'] }))
    expect(r.state.legends).toEqual(['tmp-legend', 'grouper', 'tmp-mythic'])
    expect(r.state.buffs).toEqual(['imugi-scale'])
    expect(r.state.bag.at(-1)).toEqual({ species: 'tmp-mythic', sizeCm: 400, perfect: false, locked: true })
    expect(r.result).toMatchObject({ buff: 'imugi-scale' })
    expect(viewW(r.state, { now: T0 }).buffs).toEqual(['imugi-scale'])
  })
  it('두 번째 신화는 버프가 겹치고 BUFFS 순서로 정리된다; 전설·일반 잡이는 buff가 없다', () => {
    const r = win(hooked('tmp-mythic2', { buffs: ['imugi-scale'] }))
    expect(r.state.buffs).toEqual(['imugi-scale', 'dragon-pearl'])
    const r2 = win(hooked('tmp-mythic', { buffs: ['dragon-pearl'] }))
    expect(r2.state.buffs).toEqual(['imugi-scale', 'dragon-pearl'])
    const r3 = win(hooked('tmp-legend'))
    expect(r3.state.buffs).toEqual([])
    expect(r3.result).not.toHaveProperty('buff')
  })
  it('이미 있는 버프면 result.buff 없이 그대로', () => {
    const r = win(hooked('tmp-mythic', { buffs: ['imugi-scale'] }))
    expect(r.state.buffs).toEqual(['imugi-scale'])
    expect(r.result).not.toHaveProperty('buff')
  })
  it('cast는 state.buffs를 추첨에 넘긴다: imugi-scale 세이브의 입질이 짧다', () => {
    const at = (buffs: State['buffs']) => ok(play(fresh({ buffs }), { type: 'cast', area: 'village', power: 0.5 }, { now: T0, rng: () => 0.5 })).state.pending!.biteDelayMs
    expect(at(['imugi-scale'])).toBe(Math.round(at([]) * BUFF_FX.imugiBite))
  })
  it('sellPrice: dragon-pearl이면 ×1.08 반올림, 아니면 price', () => {
    const f: Fish = { species: 'grouper', sizeCm: 140, perfect: true }
    expect(sellPrice(f, [])).toBe(price('grouper', 140, true))
    expect(sellPrice(f, ['imugi-scale', 'dragon-breath'])).toBe(price('grouper', 140, true))
    expect(sellPrice(f, ['dragon-pearl'])).toBe(Math.round((price('grouper', 140, true) * 108) / 100))
  })
  it('sell: dragon-pearl이면 물고기마다 반올림한 합, 없으면 지금과 같음', () => {
    const bag: Fish[] = [{ species: 'anchovy', sizeCm: 8, perfect: false }, { species: 'goby', sizeCm: 13, perfect: true }, { species: 'grouper', sizeCm: 100, perfect: false }]
    const plain = bag.reduce((n, f) => n + price(f.species, f.sizeCm, f.perfect), 0)
    const pearl = bag.reduce((n, f) => n + Math.round((price(f.species, f.sizeCm, f.perfect) * 108) / 100), 0)
    expect(ok(play(fresh({ bag }), { type: 'sell' }, ctx())).result).toEqual({ earned: plain })
    const r = ok(play(fresh({ bag, buffs: ['dragon-pearl'] }), { type: 'sell' }, ctx()))
    expect(r.result).toEqual({ earned: pearl })
    expect(r.state.gold).toBe(pearl)
    expect(r.state.totalEarned).toBe(pearl)
  })
})

describe('지역 최소 낚싯대·물때 자리 (합성 지역)', () => {
  withTempData(M1_FIXTURE)
  const castAt = (s: State, area: string, spot: string, now: number) =>
    play(s, { type: 'cast', area, power: 0.5, spot } as unknown as Action, { now, rng: () => 0.5 })

  it('cast need_rod: minRod 5 지역, rodTier 4 → need_rod(상태 불변), 5 → 정상', () => {
    const s4 = deepFreeze(fresh({ rodTier: 4, areas: [...DEFAULT_AREAS, TMP_DEEP] }))
    expect(err(castAt(s4, TMP_DEEP, 'abyss', T0))).toBe('need_rod')
    const p = ok(castAt(fresh({ rodTier: 5, areas: [...DEFAULT_AREAS, TMP_DEEP] }), TMP_DEEP, 'abyss', T0)).state.pending!
    expect(p.species).toBe('tmp-deep-a')
  })
  it('cast spot_closed: 밀물 → spot_closed; 썰물 끝 5초 뒤 → 받음(여유); 15초 뒤 → spot_closed; 썰물 → 정상; 늘 열린 자리는 밀물에도 정상', () => {
    const s = deepFreeze(fresh({ areas: [...DEFAULT_AREAS, TMP_FLAT] }))
    expect(err(castAt(s, TMP_FLAT, 'gully', nowAt(0, 10)))).toBe('spot_closed')
    expect(err(castAt(s, TMP_FLAT, 'gully', nowAt(0, 1) + 50 * 1000))).toBe('spot_closed')
    expect(ok(castAt(s, TMP_FLAT, 'gully', nowAt(0, 6) + 5_000)).state.pending!.spot).toBe('gully')
    expect(ok(castAt(s, TMP_FLAT, 'gully', nowAt(0, 6) + 9_000)).state.pending!.spot).toBe('gully')
    expect(err(castAt(s, TMP_FLAT, 'gully', nowAt(0, 6) + 15_000))).toBe('spot_closed')
    expect(ok(castAt(s, TMP_FLAT, 'gully', nowAt(0, 3))).state.pending!.spot).toBe('gully')
    expect(ok(castAt(s, TMP_FLAT, 'gully', nowAt(0, 15))).state.pending!.spot).toBe('gully')
    expect(ok(castAt(s, TMP_FLAT, 'bank', nowAt(0, 10))).state.pending!.spot).toBe('bank')
  })
  it('기존 지역은 어떤 시각에도 spot_closed·need_rod가 없다', () => {
    const s = fresh({ rodTier: 1 })
    for (let h = 0; h < 24; h++) for (const [area, spot] of [['village', 'pier'], ['river', 'river'], ['forest', 'waterfall']]) {
      expect('error' in castAt(s, area, spot, nowAt(0, h))).toBe(false)
    }
  })
  it('unlockArea need_rod: minRod 5 지역, rodTier 4 + 골드 충분 → need_rod(상태 불변), 골드 부족이어도 need_rod가 먼저, 5 → 열림', () => {
    const s4 = deepFreeze(fresh({ rodTier: 4, gold: 5000 }))
    expect(err(play(s4, { type: 'unlockArea', area: TMP_DEEP }, ctx()))).toBe('need_rod')
    expect(err(play(fresh({ rodTier: 4, gold: 0 }), { type: 'unlockArea', area: TMP_DEEP }, ctx()))).toBe('need_rod')
    const r = ok(play(fresh({ rodTier: 5, gold: 5000 }), { type: 'unlockArea', area: TMP_DEEP, price: UNLOCKS[TMP_DEEP as AreaId]!.price }, ctx()))
    expect(r.state.areas).toContain(TMP_DEEP)
    expect(r.state.gold).toBe(4000)
    expect(err(play(fresh({ rodTier: 5, gold: 999 }), { type: 'unlockArea', area: TMP_DEEP, price: UNLOCKS[TMP_DEEP as AreaId]!.price }, ctx()))).toBe('not_enough_gold')
  })
})

describe('migrate 버프 (v11)', () => {
  const v9 = {
    gold: 10, totalEarned: 20, rodTier: 4, bagTier: 3, areas: [...DEFAULT_AREAS, 'lake'],
    bag: [], dex: { grouper: { count: 1, maxCm: 100 } }, legends: ['grouper'], tackles: [], equipped: [], challenges: {}, pending: null,
  }
  it('v9 세이브 → buffs [], 옷장은 v10 규칙대로(전설 1마리면 왕관), 나머지 그대로', () => {
    expect(migrateW(v9, 9)).toEqual({ ...v9, ...W0, wardrobe: ['hat:crown'], buffs: [] })
  })
  it('v10(옷장) 세이브: 산 옷·업적 옷·입은 옷이 그대로 남고 buffs []', () => {
    const v10 = { ...v9, wardrobe: ['hat:straw', 'top:marine', 'hat:crown'], outfit: { ...DEFAULT_OUTFIT, hat: 'straw', top: 'marine' } }
    expect(migrateW(v10, 10)).toEqual({ ...v10, buffs: [], sold: { day: '', n: 0 }, fridge: [], shoesTier: 1 })
    // 옷장 행동은 v11에서도 그대로
    const s = migrateW(v10, 10)
    const r = play(s, { type: 'wear', slot: 'hat', id: 'crown' }, { now: T0, rng: fixedRng })
    expect('error' in r ? r.error : r.state.outfit.hat).toBe('crown')
    expect(logic.avatar!(s)).toBe(JSON.stringify(v10.outfit))
  })
  it('buffs의 모르는 id·중복·문자열 아님은 걸러지고 BUFFS 순서로', () => {
    expect(migrateW({ ...v9, buffs: ['dragon-pearl', 'zzz', 'imugi-scale', 'dragon-pearl', 3, null] }, 11).buffs).toEqual(['imugi-scale', 'dragon-pearl'])
    expect(migrateW({ ...v9, buffs: 'imugi-scale' }, 11).buffs).toEqual([])
  })
  describe('합성 신화', () => {
    withTempData(M1_FIXTURE)
    it('legends에 신화가 있는데 buffs가 비었으면 다시 생긴다; 도감에만 있어도', () => {
      expect(migrateW({ ...v9, legends: ['grouper', 'tmp-mythic2'], buffs: [] }, 11).buffs).toEqual(['dragon-pearl'])
      expect(migrateW({ ...v9, dex: { ...v9.dex, 'tmp-mythic': { count: 1, maxCm: 400 } } }, 11)).toMatchObject({
        legends: ['grouper', 'tmp-mythic'], buffs: ['imugi-scale'],
      })
    })
  })
})

// ---------------------------------------------------------------- 낚시 5부 M2: 갯벌·늪지 (logic.version 12)
describe('갯벌·늪지 (logic.version 12)', () => {
  const castAt = (s: State, area: string, spot: string, now: number, rng: () => number = () => 0.5) =>
    play(s, { type: 'cast', area, power: 0.5, spot } as unknown as Action, { now, rng })
  const flat = (over: Partial<State> = {}) => fresh({ areas: [...DEFAULT_AREAS, 'tideflat'], ...over })

  it('갯골: 썰물(3시)이면 갯골 어종, 밀물(10시) → spot_closed, 하구는 밀물에도 정상', () => {
    const creekIds = SPECIES.filter((x) => x.area === 'tideflat' && (!x.spots || x.spots.includes('creek'))).map((x) => x.id)
    for (let seed = 0; seed < 20; seed++) {
      const p = ok(castAt(flat(), 'tideflat', 'creek', nowAt(0, 3), rngFromSeed(seedBytes(seed)))).state.pending!
      expect(creekIds).toContain(p.species)
    }
    expect(err(castAt(deepFreeze(flat()), 'tideflat', 'creek', nowAt(0, 10)))).toBe('spot_closed')
    const e = ok(castAt(flat(), 'tideflat', 'estuary', nowAt(0, 10))).state.pending!
    expect(SPECIES.find((x) => x.id === e.species)!.area).toBe('tideflat')
  })
  it('잠긴 갯벌·늪지에는 던질 수 없다', () => {
    expect('error' in castAt(fresh(), 'tideflat', 'estuary', nowAt(0, 10))).toBe(true)
    expect('error' in castAt(fresh(), 'swamp', 'marsh', nowAt(0, 10))).toBe(true)
  })
  it('unlockArea: 갯벌 30,000·늪지 132,000(v15 가격)', () => {
    const r = ok(play(fresh({ gold: 162000 }), { type: 'unlockArea', area: 'tideflat', price: 30000 }, ctx()))
    expect(r.state.gold).toBe(132000)
    const r2 = ok(play(r.state, { type: 'unlockArea', area: 'swamp', price: 132000 }, ctx()))
    expect(r2.state.gold).toBe(0)
    expect(r2.state.areas).toEqual([...DEFAULT_AREAS, 'tideflat', 'swamp'])
    expect(err(play(fresh({ gold: 131999 }), { type: 'unlockArea', area: 'swamp', price: 132000 }, ctx()))).toBe('not_enough_gold')
  })
  it('이무기: 늪지 수렁 비 오는 밤, rod 5 + 백년 가물치·천년 자라 잡음 + 힘 0.95 + r0 0 → 이무기', () => {
    const night = { area: 'swamp' as const, spot: 'bog', cond: cond('spring', 22, 'rain'), power: 0.95 }
    expect(rollCatch(sequence(0, 0.5, 0.5, 0.5, 0.5), ctxOf({ ...night, rodTier: 5, legends: ['century-snakehead', 'thousand-turtle'] })).species).toBe('imugi')
    // 전설 하나라도 남으면, 낚싯대 4면, 맑으면, 낮이면, 힘이 모자라면 안 나온다
    expect(rollCatch(sequence(0, 0.5, 0.5, 0.5, 0.5), ctxOf({ ...night, rodTier: 5, legends: ['thousand-turtle'] })).species).not.toBe('imugi')
    expect(rollCatch(sequence(0, 0.5, 0.5, 0.5, 0.5), ctxOf({ ...night, rodTier: 4, legends: ['century-snakehead', 'thousand-turtle'] })).species).not.toBe('imugi')
    expect(rollCatch(sequence(0, 0.5, 0.5, 0.5, 0.5), ctxOf({ ...night, cond: cond('spring', 22), rodTier: 5, legends: ['century-snakehead', 'thousand-turtle'] })).species).not.toBe('imugi')
    expect(rollCatch(sequence(0, 0.5, 0.5, 0.5, 0.5), ctxOf({ ...night, cond: cond('spring', 12, 'rain'), rodTier: 5, legends: ['century-snakehead', 'thousand-turtle'] })).species).not.toBe('imugi')
    expect(rollCatch(sequence(0, 0.5, 0.5, 0.5, 0.5), ctxOf({ ...night, power: 0.9, rodTier: 5, legends: ['century-snakehead', 'thousand-turtle'] })).species).not.toBe('imugi')
    // r0가 신화 확률 이상이면 일반 등급
    expect(rollCatch(sequence(MYTHIC_CHANCE, 0.5, 0.5, 0.5, 0.5), ctxOf({ ...night, rodTier: 5, legends: ['century-snakehead', 'thousand-turtle'] })).species).not.toBe('imugi')
  })
  it('천년 자라가 남았으면 같은 판에서 천년 자라가 후보(이무기 아님): 비 오는 4시', () => {
    const c = ctxOf({ area: 'swamp', spot: 'bog', cond: cond('spring', 4, 'rain'), power: 0.95, rodTier: 5, legends: ['century-snakehead'] })
    expect(rollCatch(sequence(0, 0.5, 0.5, 0.5, 0.5), c).species).toBe('thousand-turtle')
  })
  it('이무기를 잡으면 legends·buffs(imugi-scale)', () => {
    const pending = { species: 'imugi', sizeCm: 400, biteDelayMs: 3000, startedAt: T0, hookedAt: BITE, area: 'swamp' as const, spot: 'bog', cond: cond('spring', 22, 'rain'), power: 0.95 }
    const r = ok(play(fresh({ areas: [...DEFAULT_AREAS, 'swamp'], legends: ['century-snakehead', 'thousand-turtle'], pending }), { type: 'resolve', success: true, perfect: false }, ctx(BITE + MIN_FIGHT_MS)))
    expect(r.state.legends).toEqual(['century-snakehead', 'thousand-turtle', 'imugi'])
    expect(r.state.buffs).toEqual(['imugi-scale'])
    expect(r.result).toMatchObject({ buff: 'imugi-scale' })
  })
  it('migrate v11 세이브(갯벌 해금은 아직 없음·버프) → 그대로; v12 세이브(갯벌·늪지·새 어종 도감·이무기) → 그대로', () => {
    const v11 = { ...logic.init(), gold: 1234, areas: [...DEFAULT_AREAS, 'lake'], dex: { goby: { count: 2, maxCm: 15 } }, legends: [], buffs: [] }
    expect(migrateW(JSON.parse(JSON.stringify(v11)), 11)).toEqual(v11)
    const v12 = {
      ...logic.init(), gold: 5, areas: [...DEFAULT_AREAS, 'tideflat', 'swamp'],
      dex: { mudskipper: { count: 3, maxCm: 18 }, imugi: { count: 1, maxCm: 500 }, 'century-snakehead': { count: 1, maxCm: 120 }, 'thousand-turtle': { count: 1, maxCm: 80 } },
      legends: ['century-snakehead', 'thousand-turtle', 'imugi'], buffs: ['imugi-scale'],
      bag: [{ species: 'imugi', sizeCm: 500, perfect: false, locked: true }],
    }
    const m = migrateW(JSON.parse(JSON.stringify(v12)), 12)
    expect(m.areas).toEqual(v12.areas)
    expect(m.dex).toEqual(v12.dex)
    expect(m.legends).toEqual(v12.legends)
    expect(m.buffs).toEqual(['imugi-scale'])
    expect(m.bag).toEqual(v12.bag)
  })
})

describe('갯벌·늪지 도전과제·순간이동기 (낚시 5부 M2)', () => {
  const castAt = (s: State, area: string, spot: string, now: number) =>
    play(s, { type: 'cast', area, power: 0.5, spot } as unknown as Action, { now, rng: () => 0.5 })
  it('갯골에서 잡으면 tideflat-creek 진행, 하구는 세지 않는다', () => {
    const s = fresh({ areas: [...DEFAULT_AREAS, 'tideflat'] })
    const catchAt = (st: State, spot: string, now: number) => {
      const cast = ok(castAt(st, 'tideflat', spot, now)).state
      const hooked = ok(play(cast, { type: 'hook' }, ctx(now + cast.pending!.biteDelayMs))).state
      return ok(play(hooked, { type: 'resolve', success: true, perfect: false }, ctx(now + cast.pending!.biteDelayMs + MIN_FIGHT_MS))).state
    }
    const a = catchAt(s, 'creek', nowAt(0, 3))
    expect(a.challenges['tideflat-creek']).toEqual({ progress: 1, done: false })
    const b = catchAt(a, 'estuary', nowAt(0, 10))
    expect(b.challenges['tideflat-creek']).toEqual({ progress: 1, done: false })
  })
  it('과제를 깨면 갯벌·늪지 이동기가 켜지고 요금은 거리대로', () => {
    const done = { 'pier-perfect': { progress: 3, done: true }, 'tideflat-creek': { progress: 5, done: true } }
    const s = fresh({ gold: 100, areas: [...DEFAULT_AREAS, 'tideflat'], challenges: done })
    expect(teleporterOpen(s, 'tideflat')).toBe(true)
    expect(teleporterOpen({ ...s, challenges: { 'pier-perfect': done['pier-perfect'] } }, 'tideflat')).toBe(false)
    const r = ok(play(s, { type: 'teleport', from: 'village', to: 'tideflat' } as unknown as Action, ctx()))
    expect(r.result).toEqual({ from: 'village', to: 'tideflat', fee: teleportFee('village', 'tideflat') })
    expect(teleporterOpen(fresh({ areas: [...DEFAULT_AREAS, 'swamp'], challenges: { 'swamp-rain-night': { progress: 3, done: true } } }), 'swamp')).toBe(true)
  })
})


// ---------------------------------------------------------------- 낚시 5부 M3: 산정 호수·난파선 (logic.version 13)
describe('산정 호수·난파선 (logic.version 13)', () => {
  const castAt = (s: State, area: string, spot: string, now: number, rng: () => number = () => 0.5) =>
    play(s, { type: 'cast', area, power: 0.5, spot } as unknown as Action, { now, rng })

  it('난파선: 열린 세이브 + 백골 → 심해·난파선 낚시 정상(난파선 어종), 명장(꼬인 세이브) → need_rod', () => {
    const ids = SPECIES.filter((x) => x.area === 'wreck').map((x) => x.id)
    for (const spot of ['abyss', 'wreck']) {
      for (let seed = 0; seed < 10; seed++) {
        const p = ok(castAt(fresh({ rodTier: 5, areas: [...DEFAULT_AREAS, 'island', 'wreck'] }), 'wreck', spot, nowAt(0, 10), rngFromSeed(seedBytes(seed)))).state.pending!
        expect(ids).toContain(p.species)
      }
    }
    expect(err(castAt(deepFreeze(fresh({ rodTier: 4, areas: [...DEFAULT_AREAS, 'island', 'wreck'] })), 'wreck', 'abyss', nowAt(0, 10)))).toBe('need_rod')
  })
  it('unlockArea: 산정 264,000; 난파선 330,000은 (v15 가격) 백골 이상(명장 + 골드 충분 → need_rod, 상태 그대로)', () => {
    const r = ok(play(fresh({ gold: 264000, areas: [...DEFAULT_AREAS, 'lake'] }), { type: 'unlockArea', area: 'summit', price: 264000 }, ctx()))
    expect(r.state.gold).toBe(0)
    expect(r.state.areas).toEqual([...DEFAULT_AREAS, 'lake', 'summit'])
    const poor = deepFreeze(fresh({ gold: 999999, rodTier: 4, areas: [...DEFAULT_AREAS, 'island'] }))
    expect(err(play(poor, { type: 'unlockArea', area: 'wreck', price: 330000 }, ctx()))).toBe('need_rod')
    const r2 = ok(play(fresh({ gold: 330000, rodTier: 5, areas: [...DEFAULT_AREAS, 'island'] }), { type: 'unlockArea', area: 'wreck', price: 330000 }, ctx()))
    expect(r2.state.gold).toBe(0)
    expect(r2.state.areas).toEqual([...DEFAULT_AREAS, 'island', 'wreck'])
  })
  it('산정: 얼음 구멍(ice)·온천(hotspring) 모두 정상, 어느 계절에나 같은 후보(서버는 구멍을 모른다)', () => {
    const s = fresh({ areas: [...DEFAULT_AREAS, 'lake', 'summit'] })
    for (const spot of ['ice', 'hotspring']) {
      const p = ok(castAt(s, 'summit', spot, nowAt(0, 10))).state.pending!
      const sp = SPECIES.find((x) => x.id === p.species)!
      expect(sp.area).toBe('summit')
      expect(sp.spots).toContain(spot)
    }
  })
  it('천지 백룡: 맑은 0~4시 얼음 구멍, 백골 + 은빛 대왕송어·설백 자치 + 힘 0.95 + r0 0 → 백룡; 하나라도 빠지면 아니다', () => {
    const base = { area: 'summit' as const, spot: 'ice', cond: cond('summer', 2), power: 0.95, rodTier: 5 as const, legends: ['silver-king-trout', 'snowwhite-taimen'] }
    const roll = (over: Partial<CastCtx> = {}, r0 = 0) => rollCatch(sequence(r0, 0.5, 0.5, 0.5, 0.5), ctxOf({ ...base, ...over })).species
    expect(roll()).toBe('white-dragon')
    expect(roll({ cond: cond('winter', 2) })).toBe('white-dragon')
    expect(roll({ legends: ['snowwhite-taimen'] })).not.toBe('white-dragon')
    expect(roll({ rodTier: 4 })).not.toBe('white-dragon')
    expect(roll({ cond: cond('summer', 2, 'rain') })).not.toBe('white-dragon')
    expect(roll({ cond: cond('summer', 5) })).not.toBe('white-dragon')
    expect(roll({ spot: 'hotspring' })).not.toBe('white-dragon')
    expect(roll({}, MYTHIC_CHANCE)).not.toBe('white-dragon')
  })
  it('설백 자치가 남았으면 같은 자리에서 설백 자치가 후보(맑은 6시)', () => {
    const c = ctxOf({ area: 'summit', spot: 'ice', cond: cond('spring', 6), power: 0.95, rodTier: 5, legends: ['silver-king-trout'] })
    expect(rollCatch(sequence(0, 0.5, 0.5, 0.5, 0.5), c).species).toBe('snowwhite-taimen')
  })
  it('용왕: 비 오는 심해, 용왕의 낚싯대 + 다금바리·무지개 청새치·산갈치 + 힘 0.98 → 용왕; 백골·힘 0.95·맑음이면 아니다', () => {
    const base = { area: 'wreck' as const, spot: 'abyss', cond: cond('autumn', 12, 'rain'), power: 0.98, rodTier: 6 as const, legends: ['grouper', 'rainbow-marlin', 'oarfish'] }
    const roll = (over: Partial<CastCtx> = {}) => rollCatch(sequence(0, 0.5, 0.5, 0.5, 0.5), ctxOf({ ...base, ...over })).species
    expect(roll()).toBe('dragon-king')
    expect(roll({ rodTier: 5 })).not.toBe('dragon-king')
    expect(roll({ power: 0.95 })).not.toBe('dragon-king')
    expect(roll({ cond: cond('autumn', 12) })).not.toBe('dragon-king')
    expect(roll({ legends: ['grouper', 'rainbow-marlin'] })).not.toBe('dragon-king')
  })
  it('천지 백룡을 잡으면 dragon-breath, 용왕을 잡으면 dragon-pearl(버프가 겹친다)', () => {
    const pend = (species: string, area: 'summit' | 'wreck', spot: string) =>
      ({ species, sizeCm: 300, biteDelayMs: 3000, startedAt: T0, hookedAt: BITE, area, spot, cond: cond('spring', 2), power: 0.98 })
    const a = ok(play(fresh({ areas: [...DEFAULT_AREAS, 'lake', 'summit'], legends: ['silver-king-trout', 'snowwhite-taimen'], buffs: ['imugi-scale'], pending: pend('white-dragon', 'summit', 'ice') }), { type: 'resolve', success: true, perfect: false }, ctx(BITE + MIN_FIGHT_MS)))
    expect(a.state.buffs).toEqual(['imugi-scale', 'dragon-breath'])
    expect(a.result).toMatchObject({ buff: 'dragon-breath' })
    const b = ok(play({ ...a.state, legends: [...a.state.legends, 'grouper', 'rainbow-marlin', 'oarfish'], pending: pend('dragon-king', 'wreck', 'abyss') }, { type: 'resolve', success: true, perfect: false }, ctx(BITE + MIN_FIGHT_MS)))
    expect(b.state.buffs).toEqual(['imugi-scale', 'dragon-breath', 'dragon-pearl'])
    expect(b.state.legends).toContain('dragon-king')
  })
  it('records: dex n/169', () => {
    expect(logic.records(logic.init()).find((r) => r.key === 'dex')).toEqual({ key: 'dex', value: 0, detail: '0/169' })
  })
  it('migrate v12 세이브(갯벌·늪지·이무기) → 그대로; v13 세이브(산정·난파선·새 신화·버프 셋) → 그대로, version 13', () => {
    const v12 = {
      ...logic.init(), gold: 77, areas: [...DEFAULT_AREAS, 'tideflat', 'swamp'], rodTier: 5,
      dex: { mudskipper: { count: 3, maxCm: 18 }, imugi: { count: 1, maxCm: 500 } },
      legends: ['century-snakehead', 'thousand-turtle', 'imugi'], buffs: ['imugi-scale'],
    }
    // 전설 셋을 잡은 세이브라 옷장 업적 옷(왕관·금빛 머리)이 함께 생긴다(옷장 규칙, logic.version 10)
    const m12 = migrateW(JSON.parse(JSON.stringify(v12)), 12)
    expect({ ...m12, wardrobe: [] }).toEqual(v12)
    expect(m12.wardrobe).toEqual(['hat:crown', 'hairColor:gold'])
    const v13 = {
      ...logic.init(), gold: 5, rodTier: 6, areas: [...DEFAULT_AREAS, 'lake', 'island', 'summit', 'wreck'],
      dex: { char: { count: 2, maxCm: 30 }, 'white-dragon': { count: 1, maxCm: 300 }, 'dragon-king': { count: 1, maxCm: 800 }, skipjack: { count: 4, maxCm: 70 } },
      legends: ['grouper', 'silver-king-trout', 'rainbow-marlin', 'snowwhite-taimen', 'white-dragon', 'oarfish', 'dragon-king'],
      buffs: [],
      bag: [{ species: 'dragon-king', sizeCm: 800, perfect: false, locked: true }],
    }
    const m = migrateW(JSON.parse(JSON.stringify(v13)), 13)
    expect(m.areas).toEqual(v13.areas)
    expect(m.dex).toEqual(v13.dex)
    expect(m.legends).toEqual(v13.legends)
    expect(m.bag).toEqual(v13.bag)
    // 버프는 legends의 신화에서 다시 만든다(BUFFS 순서)
    expect(m.buffs).toEqual(['dragon-breath', 'dragon-pearl'])
  })
})

describe('산정 호수·난파선 도전과제·순간이동기 (낚시 5부 M3)', () => {
  const castAt = (s: State, area: string, spot: string, now: number) =>
    play(s, { type: 'cast', area, power: 0.5, spot } as unknown as Action, { now, rng: () => 0.5 })
  const catchAt = (st: State, area: string, spot: string, now: number, perfect: boolean) => {
    const cast = ok(castAt(st, area, spot, now)).state
    const hooked = ok(play(cast, { type: 'hook' }, ctx(now + cast.pending!.biteDelayMs))).state
    return ok(play(hooked, { type: 'resolve', success: true, perfect }, ctx(now + cast.pending!.biteDelayMs + MIN_FIGHT_MS))).state
  }
  it('얼음 구멍에서 완벽하게 잡으면 summit-perfect 진행, 완벽하지 않거나 온천이면 세지 않는다(어느 계절에나)', () => {
    let s = fresh({ areas: [...DEFAULT_AREAS, 'lake', 'summit'] })
    s = catchAt(s, 'summit', 'ice', nowAt(1, 10), true)
    expect(s.challenges['summit-perfect']).toEqual({ progress: 1, done: false })
    s = catchAt(s, 'summit', 'ice', nowAt(3, 10), false)
    s = catchAt(s, 'summit', 'hotspring', nowAt(3, 11), true)
    expect(s.challenges['summit-perfect']).toEqual({ progress: 1, done: false })
  })
  it('밤 심해에서 잡으면 wreck-abyss-night 진행, 낮이나 난파선 곁은 세지 않는다', () => {
    let s = fresh({ rodTier: 5, areas: [...DEFAULT_AREAS, 'island', 'wreck'] })
    s = catchAt(s, 'wreck', 'abyss', nowAt(0, 23), false)
    expect(s.challenges['wreck-abyss-night']).toEqual({ progress: 1, done: false })
    s = catchAt(s, 'wreck', 'abyss', nowAt(0, 12), false)
    s = catchAt(s, 'wreck', 'wreck', nowAt(0, 22), false)
    expect(s.challenges['wreck-abyss-night']).toEqual({ progress: 1, done: false })
  })
  it('과제를 깨면 산정·난파선 이동기가 켜지고 요금은 거리대로(순간이동은 낚싯대를 보지 않는다)', () => {
    const done = { 'pier-perfect': { progress: 3, done: true }, 'wreck-abyss-night': { progress: 5, done: true } }
    const s = fresh({ gold: 500, rodTier: 4, areas: [...DEFAULT_AREAS, 'island', 'wreck'], challenges: done })
    expect(teleporterOpen(s, 'wreck')).toBe(true)
    const r = ok(play(s, { type: 'teleport', from: 'village', to: 'wreck' } as unknown as Action, ctx()))
    expect(r.result).toEqual({ from: 'village', to: 'wreck', fee: teleportFee('village', 'wreck') })
    expect(teleporterOpen(fresh({ areas: [...DEFAULT_AREAS, 'lake', 'summit'], challenges: { 'summit-perfect': { progress: 3, done: true } } }), 'summit')).toBe(true)
  })
})

// ---------------------------------------------------------------- 지갑 (logic.version 14, 지갑 계획 Task 4)
// 위 시험들은 play/migrateW 모의로 "세이브 + 지갑"을 함께 본다. 여기서는 계약 자체를 logic.apply·view·migrate·legacyGold로 직접 본다.
describe('v14 지갑 계약', () => {
  const apply = (s: State, a: unknown, gold: number) => logic.apply(s, a as Action, { now: T0, rng: fixedRng, gold })
  const base = (over: Partial<State> = {}): State => deepFreeze({ ...logic.init(), ...over })
  /** 값을 내는 행동마다 [이름, 상태, 행동, 값] — 부족(값 − 1)이면 not_enough_gold, 딱 맞으면 gold: −값 */
  const DONE = { progress: 9, done: true }
  const allDone = Object.fromEntries(CHALLENGES.map((c) => [c.id, DONE]))
  const tpAreas = AREAS.map((a) => a.id).filter((id) => teleporterWorld(id) !== null)
  const spends: [string, State, unknown, number][] = [
    ...RODS.filter((r) => r.tier > 1).map((r): [string, State, unknown, number] => [`buyRod ${r.tier}`, base({ rodTier: (r.tier - 1) as State['rodTier'] }), { type: 'buyRod', tier: r.tier, price: r.price }, r.price]),
    ...BAGS.filter((b) => b.tier > 1).map((b): [string, State, unknown, number] => [`buyBag ${b.tier}`, base({ bagTier: (b.tier - 1) as State['bagTier'] }), { type: 'buyBag', tier: b.tier, price: b.price }, b.price]),
    ...TACKLES.map((t): [string, State, unknown, number] => [`buyTackle ${t.id}`, base(), { type: 'buyTackle', id: t.id }, t.price]),
    ...(Object.entries(UNLOCKS) as [AreaId, { price: number; minRod?: number }][]).map(([area, u]): [string, State, unknown, number] => [
      `unlockArea ${area}`, base({ rodTier: (u.minRod ?? 1) as State['rodTier'] }), { type: 'unlockArea', area, price: u.price }, u.price,
    ]),
    ['teleport village→river', base({ areas: [...DEFAULT_AREAS, 'lake', 'cave', 'island'], challenges: allDone }), { type: 'teleport', from: 'village', to: 'river' }, teleportFee('village', 'river')],
    ...WEAR.filter(isShopItem).map((w): [string, State, unknown, number] => [`buyWear ${w.slot}:${w.id}`, base(), { type: 'buyWear', slot: w.slot, id: w.id }, w.price]),
  ]

  it('version 14 이상(v14 지갑 계약 유지), wallet: true, LAST_GOLD_IN_SAVE 13, init·view 세이브에 gold 없음, view.gold = ctx.gold', () => {
    expect(logic.version).toBeGreaterThanOrEqual(14)
    expect(logic.wallet).toBe(true)
    expect(LAST_GOLD_IN_SAVE).toBe(13)
    expect(logic.init()).not.toHaveProperty('gold')
    expect(logic.view(logic.init(), { now: T0, gold: 1234 }).gold).toBe(1234)
    expect(logic.view(logic.init(), { now: T0, gold: 0 }).gold).toBe(0)
  })

  it('값을 내는 행동 목록이 빠짐없다(낚싯대 5·가방 4·찌·해금 7·순간이동·상점 옷)', () => {
    expect(spends.filter(([n]) => n.startsWith('buyRod'))).toHaveLength(5)
    expect(spends.filter(([n]) => n.startsWith('buyBag'))).toHaveLength(4)
    expect(spends.filter(([n]) => n.startsWith('unlockArea'))).toHaveLength(7)
    expect(spends.filter(([n]) => n.startsWith('buyWear')).length).toBeGreaterThan(10)
    expect(tpAreas).toContain('village')
    for (const [, , , price] of spends) expect(price).toBeGreaterThan(0)
  })

  it.each(spends)('%s: 잔액 = 값 − 1 → not_enough_gold, 잔액 = 값 → gold: −값(세이브에 gold 없음)', (_n, s, a, price) => {
    expect(apply(s, a, price - 1)).toEqual({ error: 'not_enough_gold' })
    expect(apply(s, a, 0)).toEqual({ error: 'not_enough_gold' })
    const r = apply(s, a, price)
    if ('error' in r) throw new Error(r.error)
    expect(r.gold).toBe(-price)
    expect(r.state).not.toHaveProperty('gold')
    expect(r.state.totalEarned).toBe(s.totalEarned)
    // 잔액이 넉넉해도 증감은 값만큼
    const rich = apply(s, a, price * 10 + 7)
    if ('error' in rich) throw new Error(rich.error)
    expect(rich.gold).toBe(-price)
  })

  it('다른 오류는 잔액 검사보다 먼저다(잔액 0이어도 그 오류)', () => {
    expect(apply(base(), { type: 'buyRod', tier: 3, price: 8000 }, 0)).toEqual({ error: 'bad_tier' })
    expect(apply(base(), { type: 'buyBag', tier: 9 }, 0)).toEqual({ error: 'bad_tier' })
    expect(apply(base({ tackles: ['cork'] }), { type: 'buyTackle', id: 'cork' }, 0)).toEqual({ error: 'already_owned' })
    expect(apply(base(), { type: 'buyTackle', id: 'zzz' }, 0)).toEqual({ error: 'bad_tackle' })
    expect(apply(base({ rodTier: 4 }), { type: 'unlockArea', area: 'wreck', price: 330000 }, 0)).toEqual({ error: 'need_rod' })
    expect(apply(base({ areas: [...DEFAULT_AREAS, 'lake'] }), { type: 'unlockArea', area: 'lake', price: 5000 }, 0)).toEqual({ error: 'already_open' })
    expect(apply(withPending() as State, { type: 'unlockArea', area: 'lake', price: 5000 }, 0)).toEqual({ error: 'busy' })
    expect(apply(base(), { type: 'teleport', from: 'village', to: 'village' }, 0)).toEqual({ error: 'same' })
    expect(apply(base(), { type: 'teleport', from: 'village', to: 'river' }, 0)).toEqual({ error: 'not_open' })
    expect(apply(base(), { type: 'buyWear', slot: 'hat', id: 'zzz' }, 0)).toEqual({ error: 'bad_wear' })
  })

  it('sell → gold: +earned, totalEarned += earned, 잠긴 물고기는 남는다; 용왕의 여의주면 물고기마다 ×1.08', () => {
    const bag: Fish[] = [
      { species: 'anchovy', sizeCm: 12, perfect: false },
      { species: 'mackerel', sizeCm: 30, perfect: true },
      { species: 'grouper', sizeCm: 100, perfect: false, locked: true },
    ]
    const sum = price('anchovy', 12, false) + price('mackerel', 30, true)
    const r = apply(base({ bag, totalEarned: 5 }), { type: 'sell' }, 999)
    if ('error' in r) throw new Error(r.error)
    expect(r.gold).toBe(sum)
    expect(r.result).toEqual({ earned: sum })
    expect(r.state.totalEarned).toBe(5 + sum)
    expect(r.state.bag).toEqual([bag[2]])
    expect(r.state).not.toHaveProperty('gold')
    const pearl = apply(base({ bag, buffs: ['dragon-pearl'] }), { type: 'sell' }, 0)
    if ('error' in pearl) throw new Error(pearl.error)
    const want = sellPrice(bag[0], ['dragon-pearl']) + sellPrice(bag[1], ['dragon-pearl'])
    expect(want).toBeGreaterThan(sum)
    expect(pearl.gold).toBe(want)
    expect(pearl.result).toEqual({ earned: want })
    expect(apply(base({ bag: [bag[2]] }), { type: 'sell' }, 0)).toEqual({ error: 'bag_empty' })
  })

  it('골드와 무관한 행동은 증감이 없다(cast·hook·resolve·lock·equip·wear)', () => {
    const noGold = (r: ReturnType<typeof logic.apply>) => {
      if ('error' in r) throw new Error(r.error)
      expect(r.gold ?? 0).toBe(0)
      expect(r.state).not.toHaveProperty('gold')
      return r.state
    }
    const c = (now: number) => ({ now, rng: fixedRng, gold: 50 })
    const cast = noGold(logic.apply(base(), { type: 'cast', area: 'village', power: 0.5 } as Action, c(T0)))
    const at = T0 + cast.pending!.biteDelayMs
    const hooked = noGold(logic.apply(cast, { type: 'hook' }, c(at)))
    const caught = noGold(logic.apply(hooked, { type: 'resolve', success: true, perfect: false }, c(at + MIN_FIGHT_MS)))
    noGold(logic.apply(caught, { type: 'lock', index: 0, locked: true } as Action, c(at)))
    noGold(logic.apply(base({ rodTier: 3, tackles: ['cork'] }), { type: 'equip', ids: ['cork'] } as Action, c(at)))
    noGold(logic.apply(base({ wardrobe: ['hat:cap'] }), { type: 'wear', slot: 'hat', id: 'cap' } as Action, c(at)))
  })

  describe('legacyGold (지갑 이전, Review Focus 1)', () => {
    const lg = (raw: unknown, from: number) => logic.legacyGold!(raw, from)
    it('v13 세이브 {gold: 12345.7} → 12345 (소수 내림)', () => {
      expect(lg({ gold: 12345.7 }, 13)).toBe(12345)
      expect(lg({ ...logic.init(), gold: 800 }, LAST_GOLD_IN_SAVE)).toBe(800)
    })
    it('그보다 옛 세이브(v12·v9·v2·v0)도 raw.gold 그대로', () => {
      for (const v of [12, 9, 5, 2, 1, 0]) expect(lg({ gold: 70 }, v), `v${v}`).toBe(70)
    })
    it('음수·NaN·Infinity·문자열·없음·객체 아님 → 0', () => {
      for (const g of [-1, NaN, Infinity, -Infinity, '500', null, true, [5], { n: 5 }]) expect(lg({ gold: g }, 13), String(g)).toBe(0)
      expect(lg({}, 13)).toBe(0)
      expect(lg(null, 13)).toBe(0)
      expect(lg('x', 13)).toBe(0)
      expect(lg([1, 2], 13)).toBe(0)
      expect(lg({ gold: 0 }, 13)).toBe(0)
    })
    it('v14 이상 세이브는 gold가 남아 있어도 0 (두 번 옮기지 않는다)', () => {
      expect(lg({ gold: 999 }, 14)).toBe(0)
      expect(lg({ gold: 999 }, 15)).toBe(0)
    })
  })

  it('migrate(v13 전체 세이브) → gold만 빠지고 나머지 필드는 그대로(가방 잠금·장비·지역·도감·전설·과제·옷장·버프)', () => {
    const v13 = {
      gold: 123_456, totalEarned: 999_999, rodTier: 6, bagTier: 5,
      areas: [...DEFAULT_AREAS, 'lake', 'cave', 'island', 'tideflat', 'swamp', 'summit', 'wreck'],
      bag: [{ species: 'anchovy', sizeCm: 12, perfect: false, locked: true }, { species: 'mackerel', sizeCm: 30, perfect: true }],
      dex: { anchovy: { count: 3, maxCm: 14 }, mackerel: { count: 1, maxCm: 30 } },
      legends: [], tackles: ['cork', 'spinner', 'curious'], equipped: ['spinner', 'curious'],
      challenges: { 'river-rain': { progress: 4, done: false } },
      wardrobe: ['hat:cap'], outfit: { ...DEFAULT_OUTFIT, hat: 'cap' }, buffs: [], pending: null,
    }
    const m = logic.migrate(JSON.parse(JSON.stringify(v13)), 13)
    const { gold: _g, ...rest } = v13
    expect(m).not.toHaveProperty('gold')
    expect(m).toEqual({ ...rest, sold: { day: '', n: 0 }, fridge: [], shoesTier: 1 })
    expect(logic.legacyGold!(v13, 13)).toBe(123_456)
    // 이전 뒤(v14) 세이브를 다시 읽어도 같고, 골드는 다시 나오지 않는다
    expect(logic.migrate(JSON.parse(JSON.stringify(m)), 14)).toEqual(m)
    expect(logic.legacyGold!(m, 14)).toBe(0)
  })
})

// ---------------------------------------------------------------- 도전과제 보너스 (지갑 설계 §7.5)
describe('freeBonus: 깬 도전과제의 미니게임 골드 보너스', () => {
  const done = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { progress: 9, done: true }]))
  it('지역마다 하나, 10 단위, 합 400(×5)', () => {
    expect(CHALLENGES.map((c) => c.area)).toEqual(FISHING_AREAS.map((a) => a.id))
    for (const c of CHALLENGES) {
      expect(c.freeBonusPct % 10, c.id).toBe(0)
      expect(c.freeBonusPct, c.id).toBeGreaterThan(0)
    }
    expect(CHALLENGES.reduce((a, c) => a + c.freeBonusPct, 0)).toBe(400)
  })
  it('깬 것(done: true)만 더한다; 진행 중·모르는 id는 0', () => {
    expect(freeBonus({ challenges: {} })).toBe(0)
    expect(freeBonus({ challenges: { 'pier-perfect': { progress: 2, done: false }, zzz: { progress: 9, done: true } } })).toBe(0)
    expect(freeBonus({ challenges: done(['pier-perfect', 'cave-deep']) })).toBe(80)
    expect(freeBonus({ challenges: done(CHALLENGES.map((c) => c.id)) })).toBe(400)
  })
  it('logic.freeBonus가 world 함수에 연결돼 있고, 과제를 깨는 resolve 뒤 값이 오른다', () => {
    expect(logic.freeBonus).toBe(freeBonus)
    const s = fresh({ challenges: { 'pier-perfect': { progress: 2, done: false } } })
    expect(logic.freeBonus!(s)).toBe(0)
    expect(logic.freeBonus!(fresh({ challenges: done(['pier-perfect']) }))).toBe(20)
  })
})

describe('previewData (메인 미리보기 설계 §6)', () => {
  it('처음 세이브 → { areas: 기본 지역 쉼표 목록 }, 키는 PREVIEW_AREAS_KEY', () => {
    expect(PREVIEW_AREAS_KEY).toBe('areas')
    expect(logic.previewData?.(logic.init())).toEqual({ areas: DEFAULT_AREAS.join(',') })
  })
  it('지역을 연 상태 → 그 id가 목록에 들어간다', () => {
    const s = { ...logic.init(), areas: [...DEFAULT_AREAS, 'lake' as AreaId] }
    expect(logic.previewData?.(s)?.areas.split(',')).toContain('lake')
  })
})

// ---------------------------------------------------------------- 판매 마릿수 감쇠 (설계 2026-11-25-fishing-sell-decay-design.md, v15)
describe('판매 마릿수 감쇠', () => {
  // 2026-11-25 12:00 KST = 03:00 UTC
  const NOON = Date.UTC(2026, 10, 25, 3, 0, 0)
  const anchovy = (sizeCm = 15): Fish => ({ species: 'anchovy', sizeCm, perfect: false })
  const nOf = (n: number) => Array.from({ length: n }, () => anchovy())

  it('kstDay: KST 자정 기준 날짜', () => {
    expect(kstDay(Date.UTC(2026, 10, 24, 14, 59, 59))).toBe('2026-11-24')
    expect(kstDay(Date.UTC(2026, 10, 24, 15, 0, 0))).toBe('2026-11-25')
  })

  it('sellRatePct: 1~150 100, 151~300 50, 301~450 20, 그 뒤 5', () => {
    expect([1, 150, 151, 300, 301, 450, 451, 9999].map(sellRatePct)).toEqual([100, 100, 50, 50, 20, 20, 5, 5])
  })

  it('soldToday: 날짜가 오늘이 아니면 0', () => {
    expect(soldToday({ day: '2026-11-25', n: 7 }, NOON)).toBe(7)
    expect(soldToday({ day: '2026-11-24', n: 7 }, NOON)).toBe(0)
    expect(soldToday({ day: '', n: 0 }, NOON)).toBe(0)
  })

  it('decayedSale: 경계를 넘는 판매는 한 마리씩 배율, 물고기마다 반올림', () => {
    const p = sellPrice(anchovy())
    const r = decayedSale(nOf(3), [], 149)
    expect(r.earned).toBe(p + 2 * Math.round((p * 50) / 100))
    expect(r.count).toBe(3)
    expect(decayedSale(nOf(2), [], 450).earned).toBe(2 * Math.round((p * 5) / 100))
  })

  it('sell: 오늘 판 수를 세고 감쇠를 적용, totalEarned에는 감쇠 뒤 금액', () => {
    const p = sellPrice(anchovy())
    const s = fresh({ bag: nOf(2), sold: { day: '2026-11-25', n: 150 }, totalEarned: 10 })
    const r = ok(play(s, { type: 'sell' }, ctx(NOON)))
    const want = 2 * Math.round((p * 50) / 100)
    expect(r.result).toEqual({ earned: want })
    expect(r.state.sold).toEqual({ day: '2026-11-25', n: 152 })
    expect(r.state.totalEarned).toBe(10 + want)
  })

  it('sell: 날짜가 바뀌면 0부터 다시 센다', () => {
    const p = sellPrice(anchovy())
    const s = fresh({ bag: nOf(1), sold: { day: '2026-11-24', n: 999 } })
    const r = ok(play(s, { type: 'sell' }, ctx(NOON)))
    expect(r.result).toEqual({ earned: p })
    expect(r.state.sold).toEqual({ day: '2026-11-25', n: 1 })
  })

  it('init·migrate: 옛 세이브는 { day: "", n: 0 }, 저장된 값은 검증해 유지', () => {
    expect(logic.init().sold).toEqual({ day: '', n: 0 })
    expect(logic.migrate({ rodTier: 2 }, 14).sold).toEqual({ day: '', n: 0 })
    expect(logic.migrate({ ...logic.init(), sold: { day: '2026-11-25', n: 12 } }, 15).sold).toEqual({ day: '2026-11-25', n: 12 })
    for (const bad of [{ day: 5, n: 1 }, { day: '2026-11-25', n: -1 }, { day: '2026-11-25', n: 1.5 }, { day: 'x', n: 1 }, null]) {
      expect(logic.migrate({ ...logic.init(), sold: bad }, 15).sold).toEqual({ day: '', n: 0 })
    }
  })

  it('version 15 이상(판매 마릿수 감쇠)', () => {
    expect(logic.version).toBeGreaterThanOrEqual(15)
  })
})

// 배포 사이 옛 화면이 옛 가격을 보고 사지 않게(v15 리뷰): 낚싯대·가방·지역 해금은 화면이 본 가격을 함께 보내고 다르면 거절
describe('구매 가격 확인 (v15)', () => {
  it('price가 없거나 서버 가격과 다르면 price_changed, 상태·골드 그대로', () => {
    const s = fresh({ gold: 1_000_000, rodTier: 4, bagTier: 3, areas: [...DEFAULT_AREAS, 'lake'] })
    for (const a of [
      { type: 'buyRod', tier: 5 }, { type: 'buyRod', tier: 5, price: 280_000 }, { type: 'buyRod', tier: 5, price: '448000' },
      { type: 'buyBag', tier: 4 }, { type: 'buyBag', tier: 4, price: 50_000 },
      { type: 'unlockArea', area: 'summit' }, { type: 'unlockArea', area: 'summit', price: 120_000 },
    ]) expect(err(play(s, a, ctx())), JSON.stringify(a)).toBe('price_changed')
  })
  it('맞는 가격이면 산다', () => {
    const s = fresh({ gold: 1_000_000, rodTier: 4, bagTier: 3, areas: [...DEFAULT_AREAS, 'lake'] })
    expect(ok(play(s, { type: 'buyRod', tier: 5, price: 448_000 }, ctx())).state).toMatchObject({ rodTier: 5, gold: 552_000 })
    expect(ok(play(s, { type: 'buyBag', tier: 4, price: 80_000 }, ctx())).state).toMatchObject({ bagTier: 4, gold: 920_000 })
    expect(ok(play(s, { type: 'unlockArea', area: 'summit', price: 264_000 }, ctx())).state.gold).toBe(736_000)
  })
})

// ---------------------------------------------------------------- 버리기·환경부담금 (설계 2026-11-25-fishing-brag-discard, v16)
describe('여러 마리 버리기 discardMany (logic.version 21)', () => {
  const f = (species: string, sizeCm: number, extra: Partial<Fish> = {}): Fish => ({ species, sizeCm, perfect: false, ...extra })
  const bag = [f('mackerel', 40), f('anchovy', 12), f('mackerel', 30, { locked: true }), f('goby', 15)]
  const item = (i: number) => ({ index: i, species: bag[i].species, sizeCm: bag[i].sizeCm })
  const feeOf = (idx: number[], at: 'bag' | 'trash' = 'bag') => idx.reduce((a, i) => a + discardFee(bag[i], [], at), 0)
  const many = (idx: number[], over: Record<string, unknown> = {}) => ({ type: 'discardMany', items: idx.map(item), fee: feeOf(idx), at: 'bag', ...over }) as unknown as Action
  it('두 마리를 한 번에: 남은 물고기 순서 그대로, 골드 −합계, result {fee, n}', () => {
    const fee = feeOf([0, 3])
    const r = ok(play(deepFreeze(fresh({ gold: fee, bag })), many([0, 3]), ctx()))
    expect(r.state.bag).toEqual([bag[1], bag[2]])
    expect(r.state.gold).toBe(0)
    expect(r.result).toEqual({ fee, n: 2 })
  })
  it('쓰레기통(at trash)은 마리마다 5% 요금의 합', () => {
    const fee = feeOf([0, 1, 3], 'trash')
    const r = ok(play(fresh({ gold: 1e6, bag }), many([3, 0, 1], { fee, at: 'trash' }), ctx()))
    expect(r.state.bag).toEqual([bag[2]])
    expect(r.result).toEqual({ fee, n: 3 })
  })
  it('중복 칸·빈 목록·형식 오류·범위 밖·잘못된 at은 bad_action', () => {
    const s = deepFreeze(fresh({ gold: 1e6, bag }))
    expect(err(play(s, many([0, 0]), ctx()))).toBe('bad_action')
    expect(err(play(s, many([]), ctx()))).toBe('bad_action')
    expect(err(play(s, { type: 'discardMany', items: 'x', fee: 1, at: 'bag' } as unknown as Action, ctx()))).toBe('bad_action')
    expect(err(play(s, { type: 'discardMany', items: [{ index: 9, species: 'goby', sizeCm: 15 }], fee: 1, at: 'bag' } as unknown as Action, ctx()))).toBe('bad_action')
    expect(err(play(s, { type: 'discardMany', items: [null], fee: 1, at: 'bag' } as unknown as Action, ctx()))).toBe('bad_action')
    expect(err(play(s, many([0], { at: 'sea' }), ctx()))).toBe('bad_action')
  })
  it('하나라도 틀리면 아무것도 버리지 않는다: 칸 다름 bag_changed, 잠김 locked, 합계 다름 price_changed, 골드 모자람 not_enough_gold', () => {
    const s = deepFreeze(fresh({ gold: 1e6, bag }))
    expect(err(play(s, { type: 'discardMany', items: [item(0), { index: 1, species: 'goby', sizeCm: 12 }], fee: feeOf([0, 1]), at: 'bag' } as unknown as Action, ctx()))).toBe('bag_changed')
    expect(err(play(s, many([0, 2]), ctx()))).toBe('locked')
    expect(err(play(s, many([0, 1], { fee: feeOf([0, 1]) - 1 }), ctx()))).toBe('price_changed')
    expect(err(play(deepFreeze(fresh({ gold: feeOf([0, 1]) - 1, bag })), many([0, 1]), ctx()))).toBe('not_enough_gold')
  })
})

describe('버리기', () => {
  const mack = (sizeCm = 40): Fish => ({ species: 'mackerel', sizeCm, perfect: false })
  it('discardFee(v18): 가방은 판매가(감쇠 전, 버프 포함)의 50% 올림, 쓰레기통은 5% 올림, 최소 1', () => {
    expect(discardFee(mack(), [])).toBe(Math.max(1, Math.ceil(sellPrice(mack()) / 2)))
    expect(discardFee(mack(), [], 'bag')).toBe(discardFee(mack(), []))
    expect(discardFee(mack(), [], 'trash')).toBe(Math.max(1, Math.ceil(sellPrice(mack()) / 20)))
    expect(discardFee({ species: 'anchovy', sizeCm: 8, perfect: false }, [], 'trash')).toBeGreaterThanOrEqual(1)
    const g = { species: 'grouper', sizeCm: 140, perfect: true }
    expect(discardFee(g, ['dragon-pearl'])).toBe(Math.ceil(sellPrice(g, ['dragon-pearl']) / 2))
    expect(discardFee(g, ['dragon-pearl'], 'trash')).toBe(Math.ceil(sellPrice(g, ['dragon-pearl']) / 20))
  })
  it('discard at: trash면 5%, 없으면 가방 50%, 옛 10% 요금은 price_changed, 모르는 at은 bad_action', () => {
    const s = fresh({ gold: 10 ** 6, bag: [mack()] })
    const base = { type: 'discard', index: 0, species: 'mackerel', sizeCm: 40 }
    expect(ok(play(s, { ...base, at: 'trash', fee: discardFee(mack(), [], 'trash') }, ctx())).result).toEqual({ fee: discardFee(mack(), [], 'trash') })
    expect(ok(play(s, { ...base, fee: discardFee(mack(), []) }, ctx())).result).toEqual({ fee: discardFee(mack(), []) })
    expect(err(play(s, { ...base, fee: Math.max(1, Math.ceil(sellPrice(mack()) / 10)) }, ctx()))).toBe('price_changed')
    expect(err(play(s, { ...base, at: 'bag', fee: discardFee(mack(), [], 'trash') }, ctx()))).toBe('price_changed')
    expect(err(play(s, { ...base, at: 'zzz', fee: discardFee(mack(), []) }, ctx()))).toBe('bad_action')
  })
  it('discard: 그 칸만 빠지고 골드에서 부담금, 판 마릿수·totalEarned 그대로', () => {
    const fee = discardFee(mack(), [])
    const s = fresh({ gold: 100, bag: [mack(30), mack(), mack(35)], sold: { day: '2026-11-25', n: 3 }, totalEarned: 7 })
    const r = ok(play(s, { type: 'discard', index: 1, fee, species: 'mackerel', sizeCm: 40 }, ctx()))
    expect(r.state.bag).toEqual([mack(30), mack(35)])
    expect(r.state.gold).toBe(100 - fee)
    expect(r.state.sold).toEqual({ day: '2026-11-25', n: 3 })
    expect(r.state.totalEarned).toBe(7)
    expect(r.result).toEqual({ fee })
  })
  it('discard 거절: 잠김 locked, 골드 부족 not_enough_gold, 부담금 다름·없음 price_changed, 칸 잘못 bad_action', () => {
    const fee = discardFee(mack(), [])
    const s = fresh({ gold: 100, bag: [mack(), { ...mack(), locked: true }] })
    expect(err(play(s, { type: 'discard', index: 1, fee, species: 'mackerel', sizeCm: 40 }, ctx()))).toBe('locked')
    expect(err(play(fresh({ gold: fee - 1, bag: [mack()] }), { type: 'discard', index: 0, fee, species: 'mackerel', sizeCm: 40 }, ctx()))).toBe('not_enough_gold')
    expect(err(play(s, { type: 'discard', index: 0, fee: fee + 1, species: 'mackerel', sizeCm: 40 }, ctx()))).toBe('price_changed')
    expect(err(play(s, { type: 'discard', index: 0, species: 'mackerel', sizeCm: 40 }, ctx()))).toBe('price_changed')
    for (const index of [-1, 2, 0.5, '0', undefined]) expect(err(play(s, { type: 'discard', index, fee }, ctx())), String(index)).toBe('bad_action')
  })
  it('discard: 보낸 어종·크기가 그 칸과 다르면 bag_changed(옛 화면이 다른 물고기를 버리지 않게)', () => {
    const fee = discardFee(mack(), [])
    const s = fresh({ gold: 100, bag: [mack(30), mack()] })
    expect(err(play(s, { type: 'discard', index: 0, fee: discardFee(mack(30), []), species: 'mackerel', sizeCm: 40 }, ctx()))).toBe('bag_changed')
    expect(err(play(s, { type: 'discard', index: 1, fee, species: 'anchovy', sizeCm: 40 }, ctx()))).toBe('bag_changed')
    expect(ok(play(s, { type: 'discard', index: 1, fee, species: 'mackerel', sizeCm: 40 }, ctx())).state.bag).toEqual([mack(30)])
  })
  it('version 21', () => {
    expect(logic.version).toBe(21)
  })
})

describe('신발 (logic.version 20)', () => {
  it('buyShoes 1→2 at 1,000 gold: shoesTier 2, 골드 -1,000, 다른 값 그대로', () => {
    const r = ok(play(fresh({ gold: 1000, totalEarned: 900 }), { type: 'buyShoes', tier: 2, price: 1000 }, ctx()))
    expect(r.state).toMatchObject({ gold: 0, shoesTier: 2, totalEarned: 900, bagTier: 1, rodTier: 1 })
  })
  it('buyShoes: 2→3 6,000, 3→4 30,000; 모자라면 not_enough_gold, 다른 가격이면 price_changed', () => {
    expect(ok(play(fresh({ gold: 6000, shoesTier: 2 }), { type: 'buyShoes', tier: 3, price: 6000 }, ctx())).state).toMatchObject({ gold: 0, shoesTier: 3 })
    expect(ok(play(fresh({ gold: 30000, shoesTier: 3 }), { type: 'buyShoes', tier: 4, price: 30000 }, ctx())).state).toMatchObject({ gold: 0, shoesTier: 4 })
    expect(err(play(fresh({ gold: 999 }), { type: 'buyShoes', tier: 2, price: 1000 }, ctx()))).toBe('not_enough_gold')
    expect(err(play(fresh({ gold: 1e6 }), { type: 'buyShoes', tier: 2, price: 900 }, ctx()))).toBe('price_changed')
  })
  it('buyShoes: 건너뛰기·형식 오류·지금 단계·최고 다음은 bad_tier', () => {
    const rich = deepFreeze(fresh({ gold: 1e6 }))
    for (const tier of [3, '2', 2.5, 1, 0, NaN, null, 5]) {
      expect(err(play(rich, { type: 'buyShoes', tier, price: 1000 } as unknown as Action, ctx()))).toBe('bad_tier')
    }
    expect(err(play(deepFreeze(fresh({ gold: 1e6, shoesTier: 4 })), { type: 'buyShoes', tier: 5, price: 0 }, ctx()))).toBe('bad_tier')
  })
  it('migrate: v19 세이브(신발 없음)는 기본 장화, 저장된 단계는 그대로, 모르는 값은 1', () => {
    const v19 = { ...logic.init() } as Record<string, unknown>
    delete v19.shoesTier
    expect(logic.migrate(structuredClone(v19), 19)).toEqual({ ...logic.init(), shoesTier: 1 })
    expect(logic.migrate({ ...logic.init(), shoesTier: 3 }, 20).shoesTier).toBe(3)
    for (const bad of [0, 5, '2', 2.5, null]) expect(logic.migrate({ ...logic.init(), shoesTier: bad }, 20).shoesTier).toBe(1)
  })
})

describe('어종 확장 (logic.version 19)', () => {
  const hookedOn = (species: string, sizeCm: number, area: AreaId, spot: string): WS =>
    fresh({ pending: { species, sizeCm, biteDelayMs: 3000, startedAt: T0, hookedAt: BITE, area, spot, cond: cond('spring', 12), power: 0.5 } })
  it('migrate: v18 세이브의 진행 중 낚시(pending)는 그대로 남아 v19에서 끝까지 낚인다', () => {
    const v18 = { ...hookedOn('mackerel', 40, 'village', 'shore'), bag: [{ species: 'koi', sizeCm: 50, perfect: false }] } as WS
    const m = logic.migrate(structuredClone(v18), 18)
    expect(m).toEqual(v18)
    const r = ok(play({ ...m, gold: 0 } as WS, { type: 'resolve', success: true, perfect: false }, ctx(BITE + MIN_FIGHT_MS)))
    expect(r.state.bag).toEqual([{ species: 'koi', sizeCm: 50, perfect: false }, { species: 'mackerel', sizeCm: 40, perfect: false }])
  })
  it('migrate: pending은 v18 이상 형식이고 모르는 어종·지역·깨진 값이 없을 때만 남긴다', () => {
    const good = hookedOn('mackerel', 40, 'village', 'shore')
    expect(logic.migrate(structuredClone(good), 17).pending).toBeNull()
    const bad = (p: Record<string, unknown>) => logic.migrate({ ...structuredClone(good), pending: { ...good.pending!, ...p } }, 18).pending
    expect(bad({ species: 'zzz' })).toBeNull()
    expect(bad({ area: 'nowhere' })).toBeNull()
    expect(bad({ spot: 'river' })).toBeNull()
    expect(bad({ sizeCm: 'big' })).toBeNull()
    expect(bad({ hookedAt: 'x' })).toBeNull()
    expect(bad({ cond: { gameMinute: 1, gameDay: 1, season: 'monsoon', weather: 'sun' } })).toBeNull()
    expect(bad({ hookedAt: null })).toEqual({ ...good.pending!, hookedAt: null })
    expect(logic.migrate({ ...structuredClone(good), pending: 'x' }, 18).pending).toBeNull()
  })
  it('새 어종을 잡으면 dex·가방에 들어가고 판매가가 0보다 크다', () => {
    const r = ok(play(hookedOn('koi', 60, 'forest', 'pond'), { type: 'resolve', success: true, perfect: false }, ctx(BITE + MIN_FIGHT_MS)))
    expect(r.state.bag).toEqual([{ species: 'koi', sizeCm: 60, perfect: false }])
    expect(r.state.dex).toHaveProperty('koi')
    expect(sellPrice({ species: 'koi', sizeCm: 60, perfect: false })).toBeGreaterThan(0)
  })
})

describe('냉장고 (logic.version 18)', () => {
  const f = (sizeCm: number, extra: Partial<Fish> = {}): Fish => ({ species: 'mackerel', sizeCm, perfect: false, ...extra })
  const store = (index: unknown, fish: Fish) => ({ type: 'store', index, species: fish.species, sizeCm: fish.sizeCm })
  const takeOut = (index: unknown, fish: Fish) => ({ type: 'takeOut', index, species: fish.species, sizeCm: fish.sizeCm })
  it('FRIDGE_SIZE 15, 처음엔 빈 냉장고, view에 fridge', () => {
    expect(FRIDGE_SIZE).toBe(15)
    expect(logic.init().fridge).toEqual([])
    expect(logic.view(fresh({ fridge: [f(30)] }), { gold: 0 } as never).fridge).toEqual([f(30)])
  })
  it('store: 가방 칸을 빼서 냉장고 끝에(잠금 유지), takeOut: 냉장고 칸을 빼서 가방 끝에', () => {
    const s = fresh({ bag: [f(30), f(40, { locked: true })], fridge: [f(50)] })
    const a = ok(play(s, store(1, f(40)), ctx())).state
    expect(a.bag).toEqual([f(30)])
    expect(a.fridge).toEqual([f(50), f(40, { locked: true })])
    const b = ok(play(a, takeOut(0, f(50)), ctx())).state
    expect(b.fridge).toEqual([f(40, { locked: true })])
    expect(b.bag).toEqual([f(30), f(50)])
  })
  it('가득 참: 냉장고 15칸이면 fridge_full, 가방이 bagSize면 bag_full', () => {
    const full = Array.from({ length: 15 }, (_, i) => f(10 + i))
    expect(err(play(fresh({ bag: [f(99)], fridge: full }), store(0, f(99)), ctx()))).toBe('fridge_full')
    const bag = Array.from({ length: bagSize(1) }, (_, i) => f(10 + i))
    expect(err(play(fresh({ bag, fridge: [f(99)] }), takeOut(0, f(99)), ctx()))).toBe('bag_full')
  })
  it('오래된 칸: 가방이 다르면 bag_changed, 냉장고가 다르면 fridge_changed, 범위 밖은 bad_action', () => {
    const s = fresh({ bag: [f(30)], fridge: [f(50)] })
    expect(err(play(s, store(0, f(31)), ctx()))).toBe('bag_changed')
    expect(err(play(s, takeOut(0, f(51)), ctx()))).toBe('fridge_changed')
    for (const i of [-1, 1, 0.5, '0', undefined]) {
      expect(err(play(s, store(i, f(30)), ctx())), `store ${String(i)}`).toBe('bad_action')
      expect(err(play(s, takeOut(i, f(50)), ctx())), `takeOut ${String(i)}`).toBe('bad_action')
    }
  })
  it('낚는 중에는 넣기·꺼내기 busy', () => {
    const s = withPending({ bag: [f(30)], fridge: [f(50)] })
    expect(err(play(s, store(0, f(30)), ctx()))).toBe('busy')
    expect(err(play(s, takeOut(0, f(50)), ctx()))).toBe('busy')
  })
  it('migrate: v17 → fridge [], 저장된 냉장고는 가방 규칙(모르는 어종 버림, 잠금 유지), 15개까지', () => {
    expect(migrateW({ ...logic.init(), fridge: undefined }, 17).fridge).toEqual([])
    const saved = [{ species: 'zzz', sizeCm: 1, perfect: false }, ...Array.from({ length: 16 }, (_, i) => f(10 + i, i === 0 ? { locked: true } : {}))]
    const m = migrateW({ ...logic.init(), fridge: saved }, 18)
    expect(m.fridge).toHaveLength(15)
    expect(m.fridge[0]).toEqual(f(10, { locked: true }))
  })
})


describe('마을회관 지역 (logic.version 17)', () => {
  it('v16 세이브 migrate → areas에 hall', () => {
    const v16 = { ...logic.init(), areas: ['village', 'river', 'forest', 'lake'] }
    expect(logic.migrate(v16, 16).areas).toEqual(expect.arrayContaining(['hall', 'lake']))
  })
  it('기본 지역에 hall', () => { expect(DEFAULT_AREAS).toContain('hall') })
  it('hall에서 cast는 거절', () => {
    expect(err(play(fresh(), { type: 'cast', area: 'hall', power: 0.5, spot: 'x' } as unknown as Action, ctx()))).toBeTruthy()
    expect(err(play(fresh(), { type: 'cast', area: 'hall', power: 0.5 } as unknown as Action, ctx()))).toBeTruthy()
  })
  it('회관 이동기는 과제 없이 켜지고(v18), 마을과 오가는 요금은 TP 공식', () => {
    expect(teleporterOpen(fresh(), 'hall')).toBe(true)
    expect(teleporterOpen({ areas: ['village'], challenges: {} }, 'hall')).toBe(false)
    const p = teleporterWorld('village')!
    const q = teleporterWorld('hall')!
    expect(teleportFee('village', 'hall')).toBe(TP_BASE + Math.ceil(Math.hypot(p.x - q.x, p.y - q.y) / 10) * TP_PER_10)
    const done = { 'pier-perfect': { progress: 5, done: true } }
    const r = ok(play(fresh({ gold: 10_000, challenges: done }), { type: 'teleport', from: 'village', to: 'hall' }, ctx()))
    expect(r.result).toEqual({ from: 'village', to: 'hall', fee: teleportFee('village', 'hall') })
  })
  it('hall은 돈으로 여는 지역이 아니다', () => {
    expect(err(play(fresh(), { type: 'unlockArea', area: 'hall', price: 0 } as unknown as Action, ctx(T0, 10 ** 9)))).toBeTruthy()
  })
})

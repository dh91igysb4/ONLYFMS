import { describe, expect, it } from 'vitest'
import { rngFromSeed } from '../../shared/rng.ts'
import { SEASON_ANCHOR_MS, conditionsAt, type Conditions, type Season, type Weather } from './clock.ts'
import { BAGS, bagSize, CHALLENGES, DEFAULT_AREAS, HOOK_GRACE_MS, HOOK_WINDOW_MS, LEGEND_CHANCE, MIN_FIGHT_MS, PIER_POWER_BONUS, RODS, SPECIES, speciesAvailable, TACKLE_FX, TACKLES, type Species, type TackleId } from './data.ts'
import { challengeMatches, logic, pickPool, price, progressChallenges, rollCatch, sizePercentile, teleporterOpen, type Action, type CastCtx, type Fish, type Pending, type State } from './logic.ts'

const seedBytes = (n: number): Uint8Array => new Uint8Array(32).map((_, i) => (i * 7 + n) & 255)
const byId = (id: string) => SPECIES.find((s) => s.id === id)!

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
    expect([...allowed].sort()).toEqual(['goby', 'hairtail', 'horse-mackerel', 'rockfish', 'squid'])
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
const ctx = (now = T0) => ({ now, rng: fixedRng })
const fresh = (over: Partial<State> = {}): State => ({ ...logic.init(), ...over })
const ok = (r: ReturnType<typeof logic.apply>) => {
  if ('error' in r) throw new Error(`unexpected error ${r.error}`)
  return r
}
const err = (r: ReturnType<typeof logic.apply>) => {
  if (!('error' in r)) throw new Error('expected error')
  return r.error
}
const withPending = (over: Partial<State> = {}): State =>
  fresh({ pending: { species: 'anchovy', sizeCm: 12, biteDelayMs: 3000, startedAt: T0, hookedAt: null, area: 'village', spot: 'shore', cond: cond('spring', 12), power: 0.5 }, ...over })
const BITE = T0 + 3000
const withHooked = (over: Partial<State> = {}): State =>
  fresh({ pending: { species: 'anchovy', sizeCm: 12, biteDelayMs: 3000, startedAt: T0, hookedAt: BITE, area: 'village', spot: 'shore', cond: cond('spring', 12), power: 0.5 }, ...over })

describe('fishing WorldLogic', () => {
  it('init and version', () => {
    expect(logic.version).toBe(8)
    expect(logic.init()).toEqual({
      gold: 0, totalEarned: 0, rodTier: 1, bagTier: 1, areas: [...DEFAULT_AREAS], bag: [], dex: {}, legends: [], tackles: [], equipped: [], challenges: {}, pending: null,
    })
  })

  it('cast sets pending and replaces an old one', () => {
    const r1 = ok(logic.apply(fresh(), { type: 'cast', area: 'pier', power: 0.5 }, ctx(T0)))
    expect(r1.state.pending).toMatchObject({ startedAt: T0, hookedAt: null })
    expect(r1.result).toEqual(logic.view(r1.state, { now: T0 }).pending)
    const old = withPending()
    const r2 = ok(logic.apply(old, { type: 'cast', area: 'pier', power: 0.5 }, ctx(T0 + 5000)))
    expect(r2.state.pending?.startedAt).toBe(T0 + 5000)
    expect(r2.state.pending).not.toBe(old.pending)
  })

  it('cast with full bag -> bag_full, no pending', () => {
    const bag: Fish[] = Array.from({ length: bagSize(1) }, () => ({ species: 'anchovy', sizeCm: 10, perfect: false }))
    const s = deepFreeze(fresh({ bag }))
    expect(err(logic.apply(s, { type: 'cast', area: 'pier', power: 0.5 }, ctx()))).toBe('bag_full')
    expect(s.pending).toBeNull()
  })

  it("cast without spot and with spot 'shore' give identical pending (same seed)", () => {
    const pend = (spot?: string) => {
      const rng = rngFromSeed(seedBytes(31))
      const action = { type: 'cast', area: 'village', power: 0.5, ...(spot === undefined ? {} : { spot }) } as unknown as Action
      return ok(logic.apply(fresh(), action, { now: T0, rng })).state.pending
    }
    expect(pend('shore')).toEqual(pend())
    expect(pend('shore')?.spot).toBe('shore')
  })

  it("cast { area: 'pier', spot: 'pier' }는 village로 정상 처리되고 부두 보너스가 붙는다", () => {
    const r = ok(logic.apply(fresh(), { type: 'cast', area: 'pier', power: 0.5, spot: 'pier' }, ctx()))
    expect(r.state.pending).toMatchObject({ area: 'village', spot: 'pier' })
    // 같은 rng 값이면 부두가 더 큰 크기 백분위를 낸다
    const pct = (spot: string) => {
      const rng = sequence(0.5, 0.5, 0.5, 0.5, 0.5)
      const p = ok(logic.apply(fresh(), { type: 'cast', area: 'village', power: 0.5, spot }, { now: nowAt(1, 12), rng })).state.pending!
      return sizePercentile(p.species, p.sizeCm)
    }
    expect(pct('pier')).toBeGreaterThan(pct('shore'))
  })

  it("cast area 'lake'(안 열림) → bad_area; spot 'zzz' → bad_spot; 오류 시 상태 불변", () => {
    const s = deepFreeze(fresh())
    const before = JSON.stringify(s)
    expect(err(logic.apply(s, { type: 'cast', area: 'lake', power: 0.5 }, ctx()))).toBe('bad_area')
    for (const spot of ['zzz', 'river', 1, null]) {
      expect(err(logic.apply(s, { type: 'cast', area: 'village', power: 0.5, spot } as unknown as Action, ctx()))).toBe('bad_spot')
    }
    expect(JSON.stringify(s)).toBe(before)
  })

  it('pending은 던질 때의 area·spot·cond·power를 저장하고, view의 pending에는 그 필드가 없다', () => {
    const now = nowAt(3, 12)
    const r = ok(logic.apply(fresh(), { type: 'cast', area: 'village', power: 0.7, spot: 'pier' }, { now, rng: fixedRng }))
    expect(r.state.pending).toMatchObject({ area: 'village', spot: 'pier', power: 0.7, cond: conditionsAt(now) })
    for (const v of [logic.view(r.state, { now }).pending, r.result]) {
      expect(Object.keys(v as object).sort()).toEqual(['biteDelayMs', 'hooked', 'sizeCm', 'species', 'startedAt'])
    }
  })

  it('던진 뒤 now가 다음 게임 날·다른 계절이 되어도 resolve는 저장된 어종을 그대로 넣는다', () => {
    const now = nowAt(3, 12)
    const cast = ok(logic.apply(fresh(), { type: 'cast', area: 'village', power: 0.5, spot: 'shore' }, { now, rng: fixedRng })).state
    const p = cast.pending!
    const hooked = ok(logic.apply(cast, { type: 'hook' }, ctx(now + p.biteDelayMs))).state
    const later = now + 2 * WEEK + 5_000_000
    expect(conditionsAt(later).season).not.toBe(p.cond.season)
    expect(conditionsAt(later).gameDay).not.toBe(p.cond.gameDay)
    const r = ok(logic.apply(hooked, { type: 'resolve', success: true, perfect: false }, ctx(later)))
    expect(r.state.bag).toEqual([{ species: p.species, sizeCm: p.sizeCm, perfect: false }])
  })

  it('resolve로 전설을 잡으면 legends에 추가, 이후 같은 조건·r0=0에서도 다시 안 나옴; 놓치면 legends 그대로', () => {
    const now = nowAt(3, 12)
    const legendRng = () => sequence(0, 0.5, 0.5, 0.5, 0.5)
    const act = { type: 'cast', area: 'village', power: 1, spot: 'pier' } as const
    const cast = ok(logic.apply(fresh({ rodTier: 3 }), act, { now, rng: legendRng() })).state
    expect(cast.pending?.species).toBe('grouper')
    const hooked = ok(logic.apply(cast, { type: 'hook' }, ctx(now + cast.pending!.biteDelayMs))).state
    const miss = ok(logic.apply(hooked, { type: 'resolve', success: false, perfect: false }, ctx(now + 1e5)))
    expect(miss.state.legends).toEqual([])
    const caught = ok(logic.apply(hooked, { type: 'resolve', success: true, perfect: false }, ctx(now + 1e5))).state
    expect(caught.legends).toEqual(['grouper'])
    expect(caught.dex.grouper.count).toBe(1)
    const again = ok(logic.apply(caught, act, { now, rng: legendRng() })).state
    expect(again.pending?.species).not.toBe('grouper')
    // 일반 어종을 잡아도 legends는 그대로
    const norm = ok(logic.apply(withHooked(), { type: 'resolve', success: true, perfect: false }, ctx(T0 + 1e5))).state
    expect(norm.legends).toEqual([])
  })

  it('pier spot raises mean size percentile', () => {
    const mean = (spot: string): number => {
      const rng = rngFromSeed(seedBytes(32))
      let sum = 0
      for (let i = 0; i < 3000; i++) {
        const p = ok(logic.apply(fresh({ rodTier: 3 }), { type: 'cast', area: 'pier', power: 0.5, spot }, { now: T0, rng })).state.pending!
        sum += sizePercentile(p.species, p.sizeCm)
      }
      return sum / 3000
    }
    expect(mean('pier')).toBeGreaterThan(mean('shore') + 0.05)
  })

  it('buyBag 1->2 at 800 gold leaves 0 gold, bagTier 2, totalEarned unchanged', () => {
    const r = ok(logic.apply(fresh({ gold: 800, totalEarned: 900 }), { type: 'buyBag', tier: 2 }, ctx()))
    expect(r.state).toMatchObject({ gold: 0, bagTier: 2, totalEarned: 900 })
  })

  it('buyBag 2->3 costs 5000; 799 gold -> not_enough_gold', () => {
    expect(err(logic.apply(fresh({ gold: 799 }), { type: 'buyBag', tier: 2 }, ctx()))).toBe('not_enough_gold')
    expect(ok(logic.apply(fresh({ gold: 5000, bagTier: 2 }), { type: 'buyBag', tier: 3 }, ctx())).state).toMatchObject({ gold: 0, bagTier: 3 })
  })

  it('buyBag rejects skipped, malformed, current and beyond-max tiers', () => {
    const rich = deepFreeze(fresh({ gold: 1e6 }))
    for (const tier of [3, '2', 2.5, 1, 0, NaN, null, 4]) {
      expect(err(logic.apply(rich, { type: 'buyBag', tier } as unknown as Action, ctx()))).toBe('bad_tier')
    }
    const max = deepFreeze(fresh({ gold: 1e6, bagTier: 3 }))
    expect(err(logic.apply(max, { type: 'buyBag', tier: 4 }, ctx()))).toBe('bad_tier')
  })

  it('bagTier 2 allows the 21st..30th fish and rejects the 31st cast with bag_full', () => {
    const fish = (n: number): Fish[] => Array.from({ length: n }, () => ({ species: 'anchovy', sizeCm: 10, perfect: false }))
    for (const n of [20, 29]) {
      expect(ok(logic.apply(fresh({ bagTier: 2, bag: fish(n) }), { type: 'cast', area: 'pier', power: 0.5 }, ctx()))).toBeTruthy()
    }
    expect(err(logic.apply(fresh({ bagTier: 2, bag: fish(30) }), { type: 'cast', area: 'pier', power: 0.5 }, ctx()))).toBe('bag_full')
    expect(BAGS.map((b) => [b.size, b.price])).toEqual([[20, 0], [30, 800], [40, 5000]])
    expect(bagSize(99)).toBe(20)
  })

  describe('호수·동굴·섬 던지기', () => {
    const open = (rodTier: State['rodTier'] = 4) => fresh({ rodTier, areas: [...DEFAULT_AREAS, 'lake', 'cave', 'island'] })
    const cast = (s: State, area: string, spot: string | undefined, seed: number) => {
      const action = { type: 'cast', area, power: 0.5, ...(spot === undefined ? {} : { spot }) } as unknown as Action
      return ok(logic.apply(s, action, { now: nowAt(seed % 4, seed % 24), rng: rngFromSeed(seedBytes(seed)) })).state.pending!
    }
    it("lake가 열린 세이브에서 {area:'lake'} 정상 → {area:'lake', spot:'lake'}, 안 열린 세이브는 bad_area", () => {
      const p = cast(fresh({ areas: [...DEFAULT_AREAS, 'lake'] }), 'lake', undefined, 3)
      expect(p).toMatchObject({ area: 'lake', spot: 'lake' })
      expect(byId(p.species).area).toBe('lake')
      expect(err(logic.apply(fresh(), { type: 'cast', area: 'lake', power: 0.5 }, ctx()))).toBe('bad_area')
      // cave만 열린 세이브는 lake가 안 열려 있다
      expect(err(logic.apply(fresh({ areas: [...DEFAULT_AREAS, 'cave'] }), { type: 'cast', area: 'lake', power: 0.5 }, ctx()))).toBe('bad_area')
    })
    it('{area:"cave", spot:"cave3"} → 불꽃잉어·용암장어·화룡어만, 열린 세이브 필요', () => {
      const seen = new Set<string>()
      for (let seed = 0; seed < 400; seed++) seen.add(cast(open(), 'cave', 'cave3', seed).species)
      expect([...seen].every((id) => ['ember-carp', 'lava-eel', 'fire-dragonfish'].includes(id))).toBe(true)
      expect(seen.has('ember-carp')).toBe(true)
      const low = new Set<string>()
      for (let seed = 0; seed < 300; seed++) low.add(cast(open(2), 'cave', 'cave3', seed).species)
      expect([...low]).toEqual(['ember-carp'])
      const mid = new Set<string>()
      for (let seed = 0; seed < 400; seed++) mid.add(cast(open(3), 'cave', 'cave3', seed).species)
      expect(mid.has('lava-eel')).toBe(true)
      expect(mid.has('fire-dragonfish')).toBe(false)
      expect(err(logic.apply(fresh(), { type: 'cast', area: 'cave', power: 0.5, spot: 'cave3' }, ctx()))).toBe('bad_area')
    })
    it('동굴 cave1·cave2는 각 자리 어종만', () => {
      const ids = (spot: string) => {
        const seen = new Set<string>()
        for (let seed = 0; seed < 300; seed++) seen.add(cast(open(1), 'cave', spot, seed).species)
        return [...seen].sort()
      }
      expect(ids('cave1').every((id) => ['blind-fish', 'cave-crayfish'].includes(id))).toBe(true)
      expect(ids('cave2').every((id) => ['crystal-fry', 'bat-catfish'].includes(id))).toBe(true)
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
      return ok(logic.apply(fresh({ rodTier }), action, { now: nowAt(seed % 4, seed % 24), rng: rngFromSeed(seedBytes(seed)) })).state.pending!
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
      expect([...seen].every((id) => ['stream-minnow', 'lenok'].includes(id))).toBe(true)
      expect(seen.has('stream-minnow')).toBe(true)
    })
    it("{area:'forest'} 자리 생략 → pond, {area:'forest', spot:'river'} → bad_spot, {area:'lake'} → bad_area", () => {
      expect(castAt('forest', undefined, 1).spot).toBe('pond')
      const s = fresh()
      expect(err(logic.apply(s, { type: 'cast', area: 'forest', power: 0.5, spot: 'river' } as unknown as Action, ctx()))).toBe('bad_spot')
      expect(err(logic.apply(s, { type: 'cast', area: 'lake', power: 0.5 }, ctx()))).toBe('bad_area')
    })
  })

  it('migrate v1 save without bagTier -> bagTier 1, gold/dex/rodTier kept; bad bagTier -> 1', () => {
    const m = logic.migrate({ gold: 70, rodTier: 2, dex: { goby: { count: 1, maxCm: 10 } } }, 1)
    expect(m).toMatchObject({ bagTier: 1, gold: 70, rodTier: 2, dex: { goby: { count: 1, maxCm: 10 } } })
    expect(logic.migrate({ bagTier: 7 }, 1).bagTier).toBe(1)
    expect(logic.migrate({ bagTier: 3 }, 2).bagTier).toBe(3)
  })

  it('migrate keeps every fish the bag can hold: a v1 save with 20 fish keeps 20, a bagTier 3 save with 40 keeps 40', () => {
    const fish = (n: number): Fish[] => Array.from({ length: n }, (_, i) => ({ species: 'anchovy', sizeCm: 10 + (i % 5), perfect: i % 2 === 0 }))
    const v1 = fish(20)
    expect(logic.migrate({ gold: 5, bag: v1 }, 1).bag).toEqual(v1)
    const full = fish(40)
    expect(logic.migrate({ bagTier: 3, bag: full }, 2).bag).toEqual(full)
  })

  it('view exposes bagTier', () => {
    expect(logic.view(fresh({ bagTier: 2 }), { now: T0 }).bagTier).toBe(2)
  })

  it('cast rejects bad payloads', () => {
    const s = deepFreeze(fresh())
    for (const power of [NaN, -0.1, 2, '1', Infinity, null, undefined]) {
      expect(err(logic.apply(s, { type: 'cast', area: 'pier', power } as unknown as Action, ctx()))).toBe('bad_power')
    }
    for (const area of ['ocean', 1, null, undefined, 'lake']) {
      expect(err(logic.apply(s, { type: 'cast', area, power: 0.5 } as unknown as Action, ctx()))).toBe('bad_area')
    }
    // 경계값 0과 1은 허용
    for (const power of [0, 1]) ok(logic.apply(s, { type: 'cast', area: 'pier', power }, ctx()))
  })

  it('resolve success before hookedAt + 2000ms -> too_early, pending kept; boundary succeeds', () => {
    const s = deepFreeze(withHooked())
    const edge = BITE + MIN_FIGHT_MS
    expect(err(logic.apply(s, { type: 'resolve', success: true, perfect: false }, ctx(edge - 1)))).toBe('too_early')
    expect(s.pending).not.toBeNull()
    const r = ok(logic.apply(s, { type: 'resolve', success: true, perfect: false }, ctx(edge)))
    expect(r.state.pending).toBeNull()
    expect(r.state.bag).toHaveLength(1)
  })

  it('resolve success without hook -> not_hooked, pending kept', () => {
    const s = deepFreeze(withPending())
    expect(err(logic.apply(s, { type: 'resolve', success: true, perfect: false }, ctx(T0 + 1e6)))).toBe('not_hooked')
  })

  it('a pending without hookedAt is treated as not hooked', () => {
    const s = deepFreeze(fresh({
      pending: { species: 'anchovy', sizeCm: 12, biteDelayMs: 3000, startedAt: T0 } as unknown as State['pending'],
    }))
    expect(logic.view(s, { now: BITE }).pending).toMatchObject({ hooked: false, species: null, sizeCm: null })
    expect(err(logic.apply(s, { type: 'resolve', success: true, perfect: false }, ctx(T0 + 1e6)))).toBe('not_hooked')
    const r = ok(logic.apply(s, { type: 'hook' }, ctx(BITE)))
    expect(r.state.pending?.hookedAt).toBe(BITE)
  })

  it('hook before the bite -> too_early; at exactly startedAt + biteDelayMs succeeds', () => {
    const s = deepFreeze(withPending())
    expect(err(logic.apply(s, { type: 'hook' }, ctx(BITE - 1)))).toBe('too_early')
    const r = ok(logic.apply(s, { type: 'hook' }, ctx(BITE)))
    expect(r.state.pending?.hookedAt).toBe(BITE)
    expect(r.result).toEqual({ species: 'anchovy', sizeCm: 12 })
  })

  it('hook after bite + 800 + 1500 -> too_late; exactly at that bound succeeds', () => {
    const s = deepFreeze(withPending())
    const last = BITE + HOOK_WINDOW_MS + HOOK_GRACE_MS
    expect(err(logic.apply(s, { type: 'hook' }, ctx(last + 1)))).toBe('too_late')
    ok(logic.apply(s, { type: 'hook' }, ctx(last)))
  })

  it('hook twice -> bad_action; hook without pending -> no_pending', () => {
    expect(err(logic.apply(deepFreeze(withHooked()), { type: 'hook' }, ctx(BITE + 1)))).toBe('bad_action')
    expect(err(logic.apply(fresh(), { type: 'hook' }, ctx()))).toBe('no_pending')
  })

  it('view hides species and size until hooked', () => {
    const cast = ok(logic.apply(fresh(), { type: 'cast', area: 'pier', power: 0.5 }, ctx(T0)))
    const v = logic.view(cast.state, { now: T0 })
    expect(v.pending).toMatchObject({ species: null, sizeCm: null, hooked: false, startedAt: T0 })
    expect(cast.result).toMatchObject({ species: null, sizeCm: null, hooked: false })
    expect(JSON.stringify(v)).not.toContain(cast.state.pending!.species)
    const at = T0 + cast.state.pending!.biteDelayMs
    const hooked = ok(logic.apply(cast.state, { type: 'hook' }, ctx(at)))
    const hv = logic.view(hooked.state, { now: at })
    expect(hv.pending).toMatchObject({ species: cast.state.pending!.species, sizeCm: cast.state.pending!.sizeCm, hooked: true })
  })

  it('recasting never reveals species', () => {
    let s = fresh()
    for (let i = 0; i < 200; i++) {
      const r = ok(logic.apply(s, { type: 'cast', area: 'pier', power: 0.5 }, { now: T0 + i, rng: rngFromSeed(seedBytes(i)) }))
      s = r.state
      expect(logic.view(s, { now: T0 }).pending).toMatchObject({ species: null, sizeCm: null })
      expect(r.result).toMatchObject({ species: null, sizeCm: null })
    }
  })

  it('resolve failure clears pending without adding fish (no time limit)', () => {
    const s = deepFreeze(withPending())
    const r = ok(logic.apply(s, { type: 'resolve', success: false, perfect: false }, ctx(T0)))
    expect(r.state.pending).toBeNull()
    expect(r.state.bag).toEqual([])
    expect(r.state.dex).toEqual({})
    expect(r.result).toEqual({ caught: null })
    const h = ok(logic.apply(deepFreeze(withHooked()), { type: 'resolve', success: false, perfect: false }, ctx(BITE)))
    expect(h.state.pending).toBeNull()
    expect(h.state.bag).toEqual([])
  })

  it('resolve success adds to bag and dex; maxCm keeps the larger', () => {
    const late = ctx(T0 + 100_000)
    let s = withHooked({ dex: { anchovy: { count: 1, maxCm: 14 } } })
    let r = ok(logic.apply(s, { type: 'resolve', success: true, perfect: true }, late))
    expect(r.result).toEqual({ caught: { species: 'anchovy', sizeCm: 12, perfect: true } })
    expect(r.state.bag).toEqual([{ species: 'anchovy', sizeCm: 12, perfect: true }])
    expect(r.state.dex.anchovy).toEqual({ count: 2, maxCm: 14 })
    s = withHooked({
      pending: { species: 'anchovy', sizeCm: 15, biteDelayMs: 1500, startedAt: T0, hookedAt: T0 + 1500, area: 'village', spot: 'shore', cond: cond('spring', 12), power: 0.5 },
      dex: { anchovy: { count: 2, maxCm: 14 } },
    })
    r = ok(logic.apply(s, { type: 'resolve', success: true, perfect: false }, late))
    expect(r.state.dex.anchovy).toEqual({ count: 3, maxCm: 15 })
  })

  it('resolve without pending -> no_pending; non-boolean flags -> bad_action', () => {
    expect(err(logic.apply(fresh(), { type: 'resolve', success: true, perfect: false }, ctx()))).toBe('no_pending')
    const s = withHooked()
    for (const a of [{ success: 'true', perfect: false }, { success: true, perfect: 1 }, { success: true }]) {
      expect(err(logic.apply(s, { type: 'resolve', ...a } as unknown as Action, ctx(T0 + 1e6)))).toBe('bad_action')
    }
  })

  it('sell adds exact price sum to gold and totalEarned, empties bag; empty -> bag_empty', () => {
    const bag: Fish[] = [
      { species: 'anchovy', sizeCm: 8, perfect: false },
      { species: 'grouper', sizeCm: 140, perfect: true },
    ]
    const s = deepFreeze(fresh({ gold: 10, totalEarned: 5, bag }))
    const sum = price('anchovy', 8, false) + price('grouper', 140, true)
    const r = ok(logic.apply(s, { type: 'sell' }, ctx()))
    expect(r.result).toEqual({ earned: sum })
    expect(r.state.gold).toBe(10 + sum)
    expect(r.state.totalEarned).toBe(5 + sum)
    expect(r.state.bag).toEqual([])
    expect(err(logic.apply(fresh(), { type: 'sell' }, ctx()))).toBe('bag_empty')
  })

  it('buyRod: 1->2 at 1500 gold leaves 0 and keeps totalEarned; 1499 -> not_enough_gold; bad tiers', () => {
    const r = ok(logic.apply(fresh({ gold: 1500, totalEarned: 2000 }), { type: 'buyRod', tier: 2 }, ctx()))
    expect(r.state.rodTier).toBe(2)
    expect(r.state.gold).toBe(0)
    expect(r.state.totalEarned).toBe(2000)
    expect(err(logic.apply(fresh({ gold: 1499 }), { type: 'buyRod', tier: 2 }, ctx()))).toBe('not_enough_gold')
    const rich = deepFreeze(fresh({ gold: 1e6 }))
    for (const tier of [3, '2', 2.5, 1, 0, NaN, null, 5]) {
      expect(err(logic.apply(rich, { type: 'buyRod', tier } as unknown as Action, ctx()))).toBe('bad_tier')
    }
  })

  it('rare species only after rod 2 (5k casts at rod 1)', () => {
    const rare = new Set(SPECIES.filter((s) => s.rarity === 'rare' || s.rarity === 'legend').map((s) => s.id))
    const rng = rngFromSeed(seedBytes(11))
    const s = fresh()
    for (let i = 0; i < 5000; i++) {
      const r = ok(logic.apply(s, { type: 'cast', area: 'pier', power: 0.5 }, { now: T0, rng }))
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
      [fresh(), { type: 'buyRod', tier: 3 }],
      [fresh({ gold: 5 }), { type: 'buyRod', tier: 2 }],
      [fresh(), { type: 'buyBag', tier: 3 }],
      [fresh({ gold: 799 }), { type: 'buyBag', tier: 2 }],
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
      expect(() => logic.apply(state, action as Action, ctx(now))).not.toThrow()
      expect('error' in logic.apply(state, action as Action, ctx(now))).toBe(true)
      expect(JSON.stringify(state)).toBe(before)
    }
    expect(err(logic.apply(fresh(), { type: 'dance' } as unknown as Action, ctx()))).toBe('bad_action')
    expect(err(logic.apply(fresh(), null as unknown as Action, ctx()))).toBe('bad_action')
  })

  it('migrate fills missing fields and keeps gold/dex', () => {
    const m = logic.migrate({ gold: 500, dex: { anchovy: { count: 2, maxCm: 12 } } }, 0)
    expect(m).toEqual({ ...logic.init(), gold: 500, dex: { anchovy: { count: 2, maxCm: 12 } } })
    expect(logic.migrate(null, 1)).toEqual(logic.init())
    expect(logic.migrate('x', 1)).toEqual(logic.init())
    expect(logic.migrate([], 1)).toEqual(logic.init())
  })

  it('migrate v2(areas [pier], dex에 grouper) → areas 기본값, legends [grouper], 골드·가방·도감 유지', () => {
    const bag = [{ species: 'anchovy', sizeCm: 10, perfect: true }]
    const dex = { grouper: { count: 1, maxCm: 100 }, goby: { count: 2, maxCm: 12 } }
    const m = logic.migrate({ gold: 300, totalEarned: 900, rodTier: 3, bagTier: 2, areas: ['pier'], bag, dex }, 2)
    expect(m).toEqual({ gold: 300, totalEarned: 900, rodTier: 3, bagTier: 2, areas: [...DEFAULT_AREAS], bag, dex, legends: ['grouper'], tackles: [], equipped: [], challenges: {}, pending: null })
    expect(logic.migrate({ dex: { goby: { count: 1, maxCm: 10 } }, areas: ['pier'] }, 2).legends).toEqual([])
  })

  it('migrate v3 세이브 → v4 그대로(골드·가방·도감·areas·legends), v2 세이브도 지금 규칙 그대로', () => {
    const bag = [{ species: 'anchovy', sizeCm: 10, perfect: true }, { species: 'catfish', sizeCm: 50, perfect: false }]
    const dex = { grouper: { count: 1, maxCm: 100 }, catfish: { count: 1, maxCm: 50 }, 'golden-mandarin': { count: 1, maxCm: 70 } }
    const v3 = { gold: 300, totalEarned: 900, rodTier: 3, bagTier: 2, areas: ['village', 'river', 'forest', 'lake'], bag, dex, legends: ['grouper', 'golden-mandarin'], pending: null }
    expect(logic.migrate(v3, 3)).toEqual({ ...v3, tackles: [], equipped: [], challenges: {} })
    const v2 = { gold: 300, totalEarned: 900, rodTier: 3, bagTier: 2, areas: ['pier'], bag, dex }
    expect(logic.migrate(v2, 2)).toEqual({ ...v3, tackles: [], equipped: [], challenges: {}, areas: [...DEFAULT_AREAS] })
  })

  it('migrate legends: 모르는 id·비전설 id는 버리고, 기본 지역은 항상 포함, 알려진 추가 지역은 유지', () => {
    const m = logic.migrate({ legends: ['grouper', 'kraken', 'goby', 3], areas: ['lake', 'zzz', 'village'] }, 3)
    expect(m.legends).toEqual(['grouper'])
    expect(m.areas).toEqual([...DEFAULT_AREAS, 'lake'])
    expect(logic.migrate({ legends: 'grouper' }, 3).legends).toEqual([])
  })

  it('migrate drops unknown species, bad fields, and pending', () => {
    const m = logic.migrate(
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

  it("records: empty state -> 0, 0, '0/56'; after a catch biggest detail is the species name", () => {
    expect(logic.records(logic.init())).toEqual([
      { key: 'total_earned', value: 0 },
      { key: 'biggest', value: 0 },
      { key: 'dex', value: 0, detail: '0/56' },
      { key: 'challenges', value: 0, detail: '0/6' },
    ])
    const s = fresh({ totalEarned: 70, dex: { anchovy: { count: 1, maxCm: 12 }, grouper: { count: 1, maxCm: 100 } } })
    expect(logic.records(s)).toEqual([
      { key: 'total_earned', value: 70 },
      { key: 'biggest', value: 100, detail: '다금바리' },
      { key: 'dex', value: 2, detail: '2/56' },
      { key: 'challenges', value: 0, detail: '0/6' },
    ])
  })

  it('view passes everything but pending through', () => {
    const s = withHooked({ gold: 7 })
    const v = logic.view(s, { now: T0 })
    expect(v.gold).toBe(7)
    expect(v.pending).toEqual({ biteDelayMs: 3000, startedAt: T0, hooked: true, species: 'anchovy', sizeCm: 12 })
    expect(logic.view(fresh(), { now: T0 }).pending).toBeNull()
  })

  describe('찌', () => {
    it('buyTackle cork: 골드 1200 → 200, tackles [cork]; 다시 → already_owned', () => {
      const r = ok(logic.apply(fresh({ gold: 1200, totalEarned: 5 }), { type: 'buyTackle', id: 'cork' }, ctx()))
      expect(r.state).toMatchObject({ gold: 200, tackles: ['cork'], totalEarned: 5 })
      expect(err(logic.apply(deepFreeze(r.state), { type: 'buyTackle', id: 'cork' }, ctx()))).toBe('already_owned')
    })
    it('buyTackle: 골드 부족 → not_enough_gold(불변), 모르는 id → bad_tackle', () => {
      const s = deepFreeze(fresh({ gold: 999 }))
      expect(err(logic.apply(s, { type: 'buyTackle', id: 'cork' }, ctx()))).toBe('not_enough_gold')
      for (const id of ['zzz', 1, null, undefined]) {
        expect(err(logic.apply(s, { type: 'buyTackle', id } as unknown as Action, ctx()))).toBe('bad_tackle')
      }
      expect(s.gold).toBe(999)
      expect(s.tackles).toEqual([])
    })
    it('buyTackle: 5종 가격 그대로 빠지고 낚시 중에도 살 수 있다', () => {
      for (const t of TACKLES) {
        const r = ok(logic.apply(withPending({ gold: t.price }), { type: 'buyTackle', id: t.id }, ctx()))
        expect(r.state.gold).toBe(0)
        expect(r.state.tackles).toEqual([t.id])
      }
    })
    const owned = (rodTier: State['rodTier'], over: Partial<State> = {}) =>
      deepFreeze(fresh({ rodTier, tackles: ['cork', 'trap', 'spinner'], ...over }))
    it('equip: rod 3에 [cork] 성공, [] 성공(전부 해제)', () => {
      const r = ok(logic.apply(owned(3), { type: 'equip', ids: ['cork'] }, ctx()))
      expect(r.state.equipped).toEqual(['cork'])
      expect(ok(logic.apply(deepFreeze(r.state), { type: 'equip', ids: [] }, ctx())).state.equipped).toEqual([])
    })
    it('equip: rod 3에 [cork, trap] → too_many, rod 1·2는 한 개도 too_many', () => {
      expect(err(logic.apply(owned(3), { type: 'equip', ids: ['cork', 'trap'] }, ctx()))).toBe('too_many')
      expect(err(logic.apply(owned(1), { type: 'equip', ids: ['cork'] }, ctx()))).toBe('too_many')
      expect(err(logic.apply(owned(2), { type: 'equip', ids: ['cork'] }, ctx()))).toBe('too_many')
      ok(logic.apply(owned(1), { type: 'equip', ids: [] }, ctx()))
    })
    it('equip: 안 산 찌 → not_owned, [cork, cork]·모르는 id·배열 아님 → bad_tackle', () => {
      expect(err(logic.apply(owned(4), { type: 'equip', ids: ['curious'] }, ctx()))).toBe('not_owned')
      expect(err(logic.apply(owned(4), { type: 'equip', ids: ['cork', 'cork'] }, ctx()))).toBe('bad_tackle')
      expect(err(logic.apply(owned(4), { type: 'equip', ids: ['zzz'] }, ctx()))).toBe('bad_tackle')
      expect(err(logic.apply(owned(4), { type: 'equip', ids: 'cork' } as unknown as Action, ctx()))).toBe('bad_tackle')
      expect(err(logic.apply(owned(4), { type: 'equip', ids: [1] } as unknown as Action, ctx()))).toBe('bad_tackle')
    })
    it('equip: pending이 있으면 busy(상태 불변)', () => {
      const s = deepFreeze(withPending({ rodTier: 4, tackles: ['cork'] }))
      expect(err(logic.apply(s, { type: 'equip', ids: ['cork'] }, ctx()))).toBe('busy')
      expect(s.equipped).toEqual([])
    })
    it('equip: rod 4에 2개 성공, 순서 유지, 오류 시 equipped 불변', () => {
      const s = owned(4, { equipped: ['spinner'] })
      expect(ok(logic.apply(s, { type: 'equip', ids: ['trap', 'cork'] }, ctx())).state.equipped).toEqual(['trap', 'cork'])
      expect(err(logic.apply(s, { type: 'equip', ids: ['cork', 'trap', 'spinner'] }, ctx()))).toBe('too_many')
      expect(s.equipped).toEqual(['spinner'])
    })
    it('cast는 state.equipped를 CastCtx로 넘긴다: spinner 장착 세이브의 입질 지연이 짧다', () => {
      const act = { type: 'cast', area: 'village', power: 0.5 } as const
      const rng = () => sequence(0.5, 0.5, 0.5, 0.5, 0.5)
      const plain = ok(logic.apply(fresh({ rodTier: 3 }), act, { now: T0, rng: rng() })).state.pending!
      const fast = ok(logic.apply(fresh({ rodTier: 3, tackles: ['spinner'], equipped: ['spinner'] }), act, { now: T0, rng: rng() })).state.pending!
      expect(plain.biteDelayMs).toBe(3750)
      expect(fast.biteDelayMs).toBe(Math.round(3750 * 0.7))
      // 산 것만으로는 효과가 없다
      const bought = ok(logic.apply(fresh({ rodTier: 3, tackles: ['spinner'] }), act, { now: T0, rng: rng() })).state.pending!
      expect(bought.biteDelayMs).toBe(3750)
    })
    it('view는 tackles·equipped를 내보낸다', () => {
      const v = logic.view(fresh({ rodTier: 3, tackles: ['cork', 'trap'], equipped: ['cork'] }), { now: T0 })
      expect(v.tackles).toEqual(['cork', 'trap'])
      expect(v.equipped).toEqual(['cork'])
    })
    it('migrate v4 세이브 → tackles [], equipped [], 나머지 그대로', () => {
      const bag = [{ species: 'anchovy', sizeCm: 10, perfect: true }]
      const dex = { grouper: { count: 1, maxCm: 100 } }
      const v4 = { gold: 300, totalEarned: 900, rodTier: 4, bagTier: 2, areas: ['village', 'river', 'forest', 'lake'], bag, dex, legends: ['grouper'], pending: null }
      expect(logic.migrate(v4, 4)).toEqual({ ...v4, tackles: [], equipped: [], challenges: {} })
    })
    it('migrate v5: 모르는 id·중복 제거, 미보유 장착 제거, 칸 초과분은 뒤에서 자른다', () => {
      const m = (raw: Record<string, unknown>) => logic.migrate(raw, 5)
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
  const unlock = (area: string) => ({ type: 'unlockArea', area }) as unknown as Action
  it('unlockArea lake: 골드 6000 → 1000, areas에 lake, totalEarned 그대로; 다시 → already_open', () => {
    const r = ok(logic.apply(deepFreeze(fresh({ gold: 6000, totalEarned: 9000 })), unlock('lake'), ctx()))
    expect(r.state.gold).toBe(1000)
    expect(r.state.totalEarned).toBe(9000)
    expect(r.state.areas).toEqual([...DEFAULT_AREAS, 'lake'])
    expect(err(logic.apply(deepFreeze(r.state), unlock('lake'), ctx()))).toBe('already_open')
  })
  it('unlockArea: 골드 4999 → not_enough_gold(불변)', () => {
    const s = deepFreeze(fresh({ gold: 4999 }))
    expect(err(logic.apply(s, unlock('lake'), ctx()))).toBe('not_enough_gold')
    expect(s.gold).toBe(4999)
    expect(s.areas).toEqual([...DEFAULT_AREAS])
  })
  it('unlockArea: 기본 지역·모르는 id·프로토타입 키·비문자열 → bad_area', () => {
    const s = deepFreeze(fresh({ gold: 99999 }))
    for (const a of ['village', 'river', 'forest', 'zzz', '__proto__', 'constructor', 'toString', '', 3, null, undefined]) {
      expect(err(logic.apply(s, { type: 'unlockArea', area: a } as unknown as Action, ctx()))).toBe('bad_area')
    }
  })
  it('unlockArea: pending이 있으면 busy', () => {
    expect(err(logic.apply(deepFreeze(withPending({ gold: 99999 })), unlock('lake'), ctx()))).toBe('busy')
  })
  it('unlockArea cave·island 가격', () => {
    expect(ok(logic.apply(fresh({ gold: 15000 }), unlock('cave'), ctx())).state.gold).toBe(0)
    expect(ok(logic.apply(fresh({ gold: 50000 }), unlock('island'), ctx())).state.gold).toBe(0)
  })
  it('unlockArea lake 뒤 areas에 lake가 들어간다', () => {
    const s = ok(logic.apply(fresh({ gold: 5000 }), unlock('lake'), ctx())).state
    expect(s.areas).toContain('lake')
  })
  it('migrate v6 세이브(장비·잠금·해금 지역 포함)는 그대로', () => {
    const v6 = {
      gold: 10, totalEarned: 70000, rodTier: 3, bagTier: 2, areas: [...DEFAULT_AREAS, 'lake', 'cave', 'island'],
      bag: [{ species: 'anchovy', sizeCm: 10, perfect: false, locked: true }], dex: { anchovy: { count: 1, maxCm: 10 } },
      legends: [], tackles: ['cork'], equipped: ['cork'], pending: null,
    }
    expect(logic.migrate(v6, 6)).toEqual({ ...v6, challenges: {} })
  })
})

describe('가방 잠금', () => {
  const anchovy: Fish = { species: 'anchovy', sizeCm: 8, perfect: false }
  const grouper: Fish = { species: 'grouper', sizeCm: 140, perfect: true }
  const mackerel: Fish = { species: 'mackerel', sizeCm: 30, perfect: false }

  it('lock: 고른 칸만 잠그고, 풀면 locked 필드가 사라진다; 낚시 중에도 된다', () => {
    const s = deepFreeze(withPending({ gold: 7, bag: [anchovy, mackerel] }))
    const r = ok(logic.apply(s, { type: 'lock', index: 1, locked: true }, ctx()))
    expect(r.state.bag).toEqual([anchovy, { ...mackerel, locked: true }])
    expect(r.state.gold).toBe(7)
    expect(r.state.pending).toEqual(s.pending)
    const back = ok(logic.apply(deepFreeze(r.state), { type: 'lock', index: 1, locked: false }, ctx()))
    expect(back.state.bag).toEqual([anchovy, mackerel])
    expect('locked' in back.state.bag[1]).toBe(false)
  })

  it('lock: 잘못된 index·locked → bad_action', () => {
    const s = deepFreeze(fresh({ bag: [anchovy, mackerel] }))
    const bad = [
      { index: -1, locked: true }, { index: 2, locked: true }, { index: 0.5, locked: true },
      { index: '0', locked: true }, { index: 0, locked: 'yes' }, { index: 0 }, { locked: true },
    ]
    for (const a of bad) expect(err(logic.apply(s, { type: 'lock', ...a } as unknown as Action, ctx()))).toBe('bad_action')
  })

  it('sell: 잠긴 물고기는 남기고 값에 넣지 않는다; 전부 잠겨 있으면 bag_empty', () => {
    const locked: Fish = { ...grouper, locked: true }
    const s = deepFreeze(fresh({ gold: 10, totalEarned: 5, bag: [anchovy, locked, mackerel] }))
    const sum = price('anchovy', 8, false) + price('mackerel', 30, false)
    const r = ok(logic.apply(s, { type: 'sell' }, ctx()))
    expect(r.result).toEqual({ earned: sum })
    expect(r.state.gold).toBe(10 + sum)
    expect(r.state.totalEarned).toBe(5 + sum)
    expect(r.state.bag).toEqual([locked])
    expect(err(logic.apply(deepFreeze(r.state), { type: 'sell' }, ctx()))).toBe('bag_empty')
  })

  it('resolve: 전설은 잠긴 채 가방에 들어가고, 일반 어종은 잠기지 않는다', () => {
    const p = withHooked().pending!
    const legend = withHooked({ pending: { ...p, species: 'grouper', sizeCm: 120 } })
    const r = ok(logic.apply(legend, { type: 'resolve', success: true, perfect: false }, ctx(T0 + 1e6)))
    const fish = { species: 'grouper', sizeCm: 120, perfect: false, locked: true }
    expect(r.state.bag).toEqual([fish])
    expect(r.result).toEqual({ caught: fish })
    const n = ok(logic.apply(withHooked(), { type: 'resolve', success: true, perfect: false }, ctx(T0 + 1e6)))
    expect(n.state.bag).toEqual([{ species: 'anchovy', sizeCm: 12, perfect: false }])
  })

  it('migrate: v4 이하 가방의 전설은 잠그고, v5 세이브의 잠금은 저장된 그대로(true만 인정)', () => {
    expect(logic.migrate({ bag: [anchovy, grouper] }, 4).bag).toEqual([anchovy, { ...grouper, locked: true }])
    expect(logic.migrate({ bag: [anchovy, grouper] }, 2).bag).toEqual([anchovy, { ...grouper, locked: true }])
    const v5 = [{ ...anchovy, locked: true }, grouper, { ...mackerel, locked: 'x' }, { ...mackerel, locked: false }]
    expect(logic.migrate({ bag: v5 }, 5).bag).toEqual([{ ...anchovy, locked: true }, grouper, mackerel, mackerel])
  })

  it('migrate: 잠금만 있던 v5 세이브(찌 필드 없음) → v6에서 잠금은 그대로, 찌는 빈 목록', () => {
    const m = logic.migrate({ gold: 900, rodTier: 3, bag: [{ ...grouper, locked: true }, anchovy] }, 5)
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
  const land = (s: State, perfect = false, now = BITE + MIN_FIGHT_MS) => ok(logic.apply(deepFreeze(s), { type: 'resolve', success: true, perfect }, ctx(now)))
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
    const miss = ok(logic.apply(hooked({ spot: 'pier' }), { type: 'resolve', success: false, perfect: false }, ctx(BITE + MIN_FIGHT_MS)))
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
    expect(logic.migrate(v7, 7)).toEqual({ ...v7, pending: null, challenges: {} })
    expect(logic.migrate({ ...v7, pending: { species: 'anchovy' } }, 2).challenges).toEqual({})
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
    expect(logic.migrate(raw, 8).challenges).toEqual({
      'pier-perfect': { progress: 3, done: true },
      'forest-variety': { progress: 2, seen: ['crucian', 'carp'], done: false },
      'river-rain': { progress: 0, done: false },
      'lake-night': { progress: 2, done: false },
    })
  })

  it('records: 도전과제 n/6', () => {
    expect(logic.records(logic.init()).at(-1)).toEqual({ key: 'challenges', value: 0, detail: '0/6' })
    const s = fresh({ challenges: { 'pier-perfect': { progress: 3, done: true }, 'river-rain': { progress: 2, done: false } } })
    expect(logic.records(s).at(-1)).toEqual({ key: 'challenges', value: 1, detail: '1/6' })
  })
})

import { describe, expect, it } from 'vitest'
import { rngFromSeed } from '../../shared/rng.ts'
import { BAG_SIZE, HOOK_GRACE_MS, HOOK_WINDOW_MS, MIN_FIGHT_MS, RODS, SPECIES } from './data.ts'
import { logic, price, rollCatch, sizePercentile, type Action, type Fish, type State } from './logic.ts'

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
  fresh({ pending: { species: 'anchovy', sizeCm: 12, biteDelayMs: 3000, startedAt: T0, hookedAt: null }, ...over })
const BITE = T0 + 3000
const withHooked = (over: Partial<State> = {}): State =>
  fresh({ pending: { species: 'anchovy', sizeCm: 12, biteDelayMs: 3000, startedAt: T0, hookedAt: BITE }, ...over })

describe('fishing WorldLogic', () => {
  it('init and version', () => {
    expect(logic.version).toBe(1)
    expect(logic.init()).toEqual({
      gold: 0, totalEarned: 0, rodTier: 1, areas: ['pier'], bag: [], dex: {}, pending: null,
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
    const bag: Fish[] = Array.from({ length: BAG_SIZE }, () => ({ species: 'anchovy', sizeCm: 10, perfect: false }))
    const s = deepFreeze(fresh({ bag }))
    expect(err(logic.apply(s, { type: 'cast', area: 'pier', power: 0.5 }, ctx()))).toBe('bag_full')
    expect(s.pending).toBeNull()
  })

  it('cast rejects bad payloads', () => {
    const s = deepFreeze(fresh())
    for (const power of [NaN, -0.1, 2, '1', Infinity, null, undefined]) {
      expect(err(logic.apply(s, { type: 'cast', area: 'pier', power } as unknown as Action, ctx()))).toBe('bad_power')
    }
    for (const area of ['ocean', 1, null, undefined]) {
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
      pending: { species: 'anchovy', sizeCm: 15, biteDelayMs: 1500, startedAt: T0, hookedAt: T0 + 1500 },
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
    const full: Fish[] = Array.from({ length: BAG_SIZE }, () => ({ species: 'anchovy', sizeCm: 10, perfect: false }))
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
    expect(m.areas).toEqual(['pier'])
    expect(m.bag).toEqual([{ species: 'anchovy', sizeCm: 10, perfect: true }])
    expect(m.dex).toEqual({ goby: { count: 1, maxCm: 10 } })
    expect(m.pending).toBeNull()
  })

  it("records: empty state -> 0, 0, '0/12'; after a catch biggest detail is the species name", () => {
    expect(logic.records(logic.init())).toEqual([
      { key: 'total_earned', value: 0 },
      { key: 'biggest', value: 0 },
      { key: 'dex', value: 0, detail: '0/12' },
    ])
    const s = fresh({ totalEarned: 70, dex: { anchovy: { count: 1, maxCm: 12 }, grouper: { count: 1, maxCm: 100 } } })
    expect(logic.records(s)).toEqual([
      { key: 'total_earned', value: 70 },
      { key: 'biggest', value: 100, detail: '다금바리' },
      { key: 'dex', value: 2, detail: '2/12' },
    ])
  })

  it('view passes everything but pending through', () => {
    const s = withHooked({ gold: 7 })
    const v = logic.view(s, { now: T0 })
    expect(v.gold).toBe(7)
    expect(v.pending).toEqual({ biteDelayMs: 3000, startedAt: T0, hooked: true, species: 'anchovy', sizeCm: 12 })
    expect(logic.view(fresh(), { now: T0 }).pending).toBeNull()
  })
})

// 경제 P2(v27, 경제 설계 r4): 기증·영구 전시, 지역 재료 추출, B단계 포션, 전시관 확장. 플래그를 켠 규칙(꺼진 상태는 econOff.test.ts).
import { describe, expect, it, vi } from 'vitest'
vi.mock('./research.ts', async (orig) => {
  const m = await orig<typeof import('./research.ts')>()
  return { ...m, ECONOMY_FLAGS: { bait: true, research: true, exhibit: true, alchemy: true }, featureOn: () => true }
})
import { MIN_FIGHT_MS, SPECIES } from './data.ts'
import { fishSellPrice, logic, rollCatch, type Fish, type State } from './logic.ts'
import { conditionsAt } from './clock.ts'
import { ACTIVE_CAP_MS, ADV_DOSE_MS, EXPANSIONS, GOLD_BUDGET, POTION_MS, PROJECTS, SPECIAL_IDS, newGallery, stageB, stageC, type Gallery } from './gallery.ts'

const T0 = Date.UTC(2026, 10, 28, 3)
type R = { state: State; result?: unknown; gold?: number } | { error: string }
const act = (s: State, a: unknown, o: { now?: number; gold?: number; rng?: () => number } = {}): R =>
  logic.apply(s, a as never, { now: o.now ?? T0, rng: o.rng ?? (() => 0.5), gold: o.gold ?? 10_000_000 }) as R
const ok = (r: R) => { if ('error' in r) throw new Error(r.error); return r }
const err = (r: R) => ('error' in r ? r.error : null)
const fish = (id: number, species: string, extra: Partial<Fish> = {}): Fish => ({ id, origin: 'normal', species, sizeCm: SPECIES.find((s) => s.id === species)!.minCm, perfect: false, ...extra })
const st = (over: Partial<State> = {}, g: Partial<Gallery> = {}): State => ({ ...logic.init(), ...over, gallery: { ...newGallery(), ...g } })
const B = { exhibits: ['imugi'] } // 첫 신화(이무기) 전시 = B단계

describe('기증·영구 전시', () => {
  it('재포획만 기증, 2마리가 차면 더 못 하고, 일반·최초 개체는 안 된다', () => {
    const s = st({ legends: ['grouper'], bag: [fish(1, 'grouper', { origin: 'recatch' }), fish(2, 'grouper', { origin: 'recatch' }), fish(3, 'grouper', { origin: 'first' })], nextFishId: 4 })
    const one = ok(act(s, { type: 'donate', index: 0, id: 1 }))
    expect(one.state.gallery.donated).toEqual({ grouper: 1 })
    expect(one.state.bag.map((f) => f.id)).toEqual([2, 3])
    const two = ok(act(one.state, { type: 'donate', index: 0, id: 2 }))
    expect(two.state.gallery.donated).toEqual({ grouper: 2 })
    expect(err(act(two.state, { type: 'donate', index: 0, id: 3 }))).toBe('not_recatch')
    expect(err(act({ ...two.state, bag: [fish(4, 'grouper', { origin: 'recatch' })] }, { type: 'donate', index: 0, id: 4 }))).toBe('donated_full')
  })
  it('전시: 기증 2 + 전설 10만·신화 25만, 기증 기록은 지운다, 두 번은 안 된다', () => {
    expect(err(act(st({ legends: ['grouper'] }, { donated: { grouper: 1 } }), { type: 'exhibit', species: 'grouper', price: 100_000 }))).toBe('need_donation')
    const s = st({ legends: ['grouper', 'imugi'] }, { donated: { grouper: 2, imugi: 2 } })
    expect(err(act(s, { type: 'exhibit', species: 'grouper', price: 200_000 }))).toBe('price_changed')
    const r = ok(act(s, { type: 'exhibit', species: 'grouper', price: 100_000 }))
    expect([r.gold, r.state.gallery.exhibits, r.state.gallery.donated]).toEqual([-100_000, ['grouper'], { imugi: 2 }])
    expect(err(act(r.state, { type: 'exhibit', species: 'grouper', price: 100_000 }))).toBe('exhibited')
    const m = ok(act(r.state, { type: 'exhibit', species: 'imugi', price: 250_000 }))
    expect([m.gold, stageB(m.state.gallery)]).toEqual([-250_000, true])
    expect(err(act(s, { type: 'exhibit', species: 'grouper', price: 100_000 }, { gold: 99_999 }))).toBe('not_enough_gold')
  })
  it('13종 전시 합계 175만 G, 모두 전시하면 C단계', () => {
    const fees = SPECIAL_IDS.map((id) => (SPECIES.find((s) => s.id === id)!.rarity === 'mythic' ? 250_000 : 100_000))
    expect([SPECIAL_IDS.length, fees.reduce((a, b) => a + b, 0)]).toEqual([13, 1_750_000])
    expect(stageC({ exhibits: [...SPECIAL_IDS] })).toBe(true)
    expect(stageC({ exhibits: SPECIAL_IDS.slice(1) })).toBe(false)
  })
})

describe('지역 재료 추출', () => {
  it('첫 신화 전시 전에는 안 되고, 뒤에는 그 지역 재료 흔함 1·드묾 2·희귀 3', () => {
    const rareVillage = SPECIES.find((s) => s.area === 'village' && s.rarity === 'rare' && !s.legend)!
    const bag = [fish(1, 'anchovy'), fish(2, rareVillage.id), fish(3, 'grouper', { origin: 'first' })]
    expect(err(act(st({ bag, nextFishId: 4 }), { type: 'extract', items: [{ index: 0, id: 1 }] }))).toBe('need_mythic_exhibit')
    const r = ok(act(st({ bag, nextFishId: 4 }, B), { type: 'extract', items: [{ index: 0, id: 1 }, { index: 1, id: 2 }] }))
    expect(r.state.gallery.mats).toEqual({ village: 4 })
    expect(r.state.bag.map((f) => f.id)).toEqual([3])
    expect(err(act(st({ bag, nextFishId: 4 }, B), { type: 'extract', items: [{ index: 2, id: 3 }] }))).toBe('not_ordinary')
  })
})

describe('B단계 포션', () => {
  const mats = { forest: 9, river: 9, lake: 9, village: 9, tideflat: 9, cave: 9, swamp: 9, summit: 9 }
  it('행운 6,000G·숲3+강2+호수1 → 10분, 두 번째 20분, 세 번째는 potion_full', () => {
    const one = ok(act(st({}, { ...B, mats }), { type: 'brew', potion: 'luck', price: 6000 }))
    expect([one.gold, one.state.gallery.potions.luck, one.state.gallery.mats.forest]).toEqual([-6000, POTION_MS, 6])
    const two = ok(act(one.state, { type: 'brew', potion: 'luck', price: 6000 }))
    expect(two.state.gallery.potions.luck).toBe(2 * POTION_MS)
    expect(err(act(two.state, { type: 'brew', potion: 'luck', price: 6000 }))).toBe('potion_full')
  })
  it('안정 대체 재료(산정 1)는 alt, 금전은 예산 3,000G를 더한다, 재료가 모자라면 거절', () => {
    const calm = ok(act(st({}, { ...B, mats: { river: 2, forest: 2, summit: 1 } }), { type: 'brew', potion: 'calm', price: 6000, alt: true }))
    expect(calm.state.gallery.mats).toEqual({})
    expect(err(act(st({}, { ...B, mats: { river: 2, forest: 2, summit: 1 } }), { type: 'brew', potion: 'calm', price: 6000 }))).toBe('not_enough_mats')
    const g = ok(act(st({}, { ...B, mats }), { type: 'brew', potion: 'gold', price: 1000 }))
    expect(g.state.gallery.goldBudget).toBe(GOLD_BUDGET)
    expect(err(act(st({}, { mats }), { type: 'brew', potion: 'luck', price: 6000 }))).toBe('need_mythic_exhibit')
  })
  it('활동 시간: 투척~거두기만, 한 번에 최대 90초 줄고, 0이 되면 사라진다', () => {
    const base = st({}, { ...B, potions: { luck: 100_000, calm: 30_000 } })
    const p = { species: 'anchovy', sizeCm: 12, biteDelayMs: 3000, startedAt: T0, hookedAt: T0 + 3000, area: 'village' as const, spot: 'shore', cond: conditionsAt(T0), power: 0.5 }
    const r = ok(act({ ...base, pending: p }, { type: 'resolve', success: true, perfect: false }, { now: T0 + 3000 + MIN_FIGHT_MS }))
    expect(r.state.gallery.potions).toEqual({ luck: 95_000, calm: 25_000 })
    const long = ok(act({ ...base, pending: p }, { type: 'resolve', success: false, perfect: false }, { now: T0 + 10 * 60_000 }))
    expect(long.state.gallery.potions).toEqual({ luck: 100_000 - ACTIVE_CAP_MS })
  })
  it('금전: 켜진 동안 잡은 일반 개체에 15% 보너스(예산까지), 판매가에 더해진다. 전설·신화는 없다', () => {
    const p = { species: 'mackerel', sizeCm: 40, biteDelayMs: 3000, startedAt: T0, hookedAt: T0 + 3000, area: 'village' as const, spot: 'shore', cond: conditionsAt(T0), power: 0.5 }
    const s = st({ pending: p }, { ...B, potions: { gold: POTION_MS }, goldBudget: 5 })
    const r = ok(act(s, { type: 'resolve', success: true, perfect: false }, { now: T0 + 5000 }))
    const f = r.state.bag[0]
    expect(f.bonus).toBe(5)
    expect(r.state.gallery.goldBudget).toBe(0)
    expect(fishSellPrice(f)).toBe(fishSellPrice({ ...f, bonus: undefined }) + 5)
    const big = ok(act({ ...s, gallery: { ...s.gallery, goldBudget: GOLD_BUDGET } }, { type: 'resolve', success: true, perfect: false }, { now: T0 + 5000 }))
    expect(big.state.bag[0].bonus).toBe(Math.round(fishSellPrice({ ...big.state.bag[0], bonus: undefined }) * 0.15))
  })
  it('행운: 일반 rare 가중치를 더 곱한다(집어 미끼와 함께 ×1.44)', () => {
    const c = { rodTier: 4 as const, power: 0.5, sizeBonus: 0, area: 'village' as const, spot: 'shore', cond: conditionsAt(T0), legends: [], equipped: [] }
    const rare = (m?: number, r1 = 0) => SPECIES.find((s) => s.id === rollCatch((() => { const v = [0.99, r1, 0, 0.5, 0.5]; let i = 0; return () => v[Math.min(i++, 4)] })(), { ...c, ...(m ? { rareMult: m } : {}) }).species)!.rarity === 'rare'
    let hit = false
    for (let r1 = 0.5; r1 < 1; r1 += 0.005) if (rare(1.44, r1) && !rare(1.2, r1)) hit = true
    expect(hit).toBe(true)
  })
})

describe('전시관 확장', () => {
  const mats = (n: number) => ({ village: n, river: n, forest: n, lake: n, cave: n, tideflat: n })
  it('r4 가격 9만·24만·45만·90만·180만, 단계마다 6지역 6·12·18·24·30', () => {
    expect(EXPANSIONS.map((e) => [e.gold, e.mats])).toEqual([[90_000, 6], [240_000, 12], [450_000, 18], [900_000, 24], [1_800_000, 30]])
    const r = ok(act(st({}, { ...B, mats: mats(10) }), { type: 'expand', stage: 1, price: 90_000 }))
    expect([r.gold, r.state.gallery.expansions, r.state.gallery.mats.village]).toEqual([-90_000, 1, 4])
    expect(err(act(r.state, { type: 'expand', stage: 2, price: 240_000 }))).toBe('not_enough_mats')
    expect(err(act(r.state, { type: 'expand', stage: 3, price: 450_000 }))).toBe('bad_tier')
    expect(err(act(st({}, { mats: mats(10) }), { type: 'expand', stage: 1, price: 90_000 }))).toBe('need_mythic_exhibit')
  })
})

describe('migrate v27 gallery', () => {
  it('발견한 13종만 전시·기증으로 남기고, 범위 밖 값은 자른다. 두 번 migrate해도 같다', () => {
    const raw = { ...logic.init(), legends: ['grouper', 'imugi'], gallery: { exhibits: ['imugi', 'imugi', 'anchovy', 'white-dragon'], donated: { grouper: 5, imugi: 1, x: 2 }, mats: { village: 3, hall: 4, river: -1 }, potions: { luck: 5_000_000, gold: 10 }, goldBudget: 99_999, expansions: 9 } }
    const m = logic.migrate(raw, 27)
    expect(m.gallery).toEqual({ exhibits: ['imugi'], donated: { grouper: 2 }, mats: { village: 3 }, potions: { luck: 2_400_000, gold: 10 }, goldBudget: 12_000, expansions: 5, stock: {}, projects: [], theme: null })
    expect(logic.migrate(JSON.parse(JSON.stringify(m)), 27)).toEqual(m)
    expect(logic.migrate({ ...logic.init(), gallery: undefined }, 26).gallery).toEqual(newGallery())
  })
  it('잡을 때 붙은 금전 보너스는 v27 세이브에서 남는다', () => {
    const raw = { ...logic.init(), bag: [{ id: 1, origin: 'normal', species: 'anchovy', sizeCm: 10, perfect: false, bonus: 7 }, { id: 2, origin: 'normal', species: 'anchovy', sizeCm: 10, perfect: false, bonus: -3 }], nextFishId: 3 }
    expect(logic.migrate(raw, 27).bag.map((f) => f.bonus)).toEqual([7, undefined])
  })
})

const C = { exhibits: [...SPECIAL_IDS] } // 13종 전시 = C단계
const allMats = (n: number) => ({ village: n, river: n, forest: n, lake: n, cave: n, island: n, tideflat: n, swamp: n, summit: n, wreck: n })

describe('C단계 제작법(P3)', () => {
  it('13종 전시 전에는 안 되고, 뒤에는 행운 3,000G·숲1+강1+호수1 → 3병', () => {
    expect(err(act(st({}, { ...B, mats: allMats(9) }), { type: 'brew', potion: 'luck', price: 3000, adv: true }))).toBe('need_all_exhibits')
    const r = ok(act(st({}, { ...C, mats: allMats(9) }), { type: 'brew', potion: 'luck', price: 3000, adv: true }))
    expect([r.gold, r.state.gallery.stock, r.state.gallery.mats.forest, r.state.gallery.potions]).toEqual([-3000, { luck: 3 }, 8, {}])
  })
  it('한 병 20분, 같은 포션 최대 40분(세 번째 병은 potion_full), 금전은 병당 6,000G 예산', () => {
    const s = st({}, { ...C, stock: { luck: 3, gold: 1 } })
    const one = ok(act(s, { type: 'drink', potion: 'luck' }))
    const two = ok(act(one.state, { type: 'drink', potion: 'luck' }))
    expect([two.state.gallery.potions.luck, two.state.gallery.stock.luck]).toEqual([2 * ADV_DOSE_MS, 1])
    expect(err(act(two.state, { type: 'drink', potion: 'luck' }))).toBe('potion_full')
    const g = ok(act(s, { type: 'drink', potion: 'gold' }))
    expect([g.state.gallery.goldBudget, g.state.gallery.stock.gold]).toEqual([6000, undefined])
    expect(err(act(st({}, C), { type: 'drink', potion: 'calm' }))).toBe('no_potion')
  })
  it('C단계 안정 대체(산정 1) 1,500G, 금전 4,500G', () => {
    expect(ok(act(st({}, { ...C, mats: { summit: 1 } }), { type: 'brew', potion: 'calm', price: 1500, adv: true, alt: true })).state.gallery.stock).toEqual({ calm: 3 })
    expect(ok(act(st({}, { ...C, mats: allMats(1) }), { type: 'brew', potion: 'gold', price: 4500, adv: true })).gold).toBe(-4500)
  })
})

describe('완료 후 목표(P4)', () => {
  it('21개: 테마 18(6 × 배경 6만·바닥 16만·조명 80만) + 시설 3(40만·100만·200만) = 952만 G', () => {
    expect(PROJECTS).toHaveLength(21)
    expect(PROJECTS.reduce((a, p) => a + p.gold, 0)).toBe(9_520_000)
    expect(PROJECTS.find((p) => p.id === 'sea-light')!.mats).toEqual({ village: 30, tideflat: 30 })
    expect(PROJECTS.find((p) => p.id === 'observatory')!.mats).toEqual({ wreck: 60, cave: 60, lake: 60 })
  })
  it('13종 전시 뒤에만, 재료·골드를 내고 영구 소유, 두 번은 안 된다', () => {
    expect(err(act(st({}, { ...B, mats: allMats(99) }), { type: 'buyProject', id: 'sea-bg', price: 60_000 }))).toBe('need_all_exhibits')
    const r = ok(act(st({}, { ...C, mats: allMats(9) }), { type: 'buyProject', id: 'sea-bg', price: 60_000 }))
    expect([r.gold, r.state.gallery.projects, r.state.gallery.mats.village, r.state.gallery.mats.tideflat]).toEqual([-60_000, ['sea-bg'], 3, 3])
    expect(err(act(r.state, { type: 'buyProject', id: 'sea-bg', price: 60_000 }))).toBe('already_owned')
    expect(err(act(r.state, { type: 'buyProject', id: 'sea-floor', price: 160_000 }))).toBe('not_enough_mats')
  })
  it('테마 적용은 배경을 산 테마만, 무료, null이면 기본', () => {
    const s = st({}, { ...C, projects: ['sea-bg'] })
    expect(ok(act(s, { type: 'setTheme', theme: 'sea' })).state.gallery.theme).toBe('sea')
    expect(err(act(s, { type: 'setTheme', theme: 'forest' }))).toBe('not_owned')
    expect(ok(act({ ...s, gallery: { ...s.gallery, theme: 'sea' } }, { type: 'setTheme', theme: null })).state.gallery.theme).toBe(null)
  })
  it('C단계 행운은 ×1.25로 강해진다(집어 미끼와 ×1.5)', async () => {
    const { luckRare } = await import('./gallery.ts')
    expect([luckRare(B), luckRare(C)]).toEqual([1.2, 1.25])
  })
})

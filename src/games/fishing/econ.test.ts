// 경제 P1(v27, 경제 설계 r4): 어분·미끼·연구 해금·연구 낚시·재포획 판매가·지역 가격 보정.
// 기능 플래그는 운영에서 꺼져 있다. 이 파일은 플래그를 켠 상태의 규칙을 본다(꺼진 상태는 econOff.test.ts).
import { describe, expect, it, vi } from 'vitest'
vi.mock('./research.ts', async (orig) => {
  const m = await orig<typeof import('./research.ts')>()
  return { ...m, ECONOMY_FLAGS: { bait: true, research: true }, featureOn: () => true }
})
import { MIN_FIGHT_MS, SPECIES } from './data.ts'
import { fishSellPrice, logic, rollCatch, sellPrice, type Fish, type State } from './logic.ts'
import { conditionsAt } from './clock.ts'
import { AUTO_MEAL_MAX, MAX_BAIT_BATCH, maxBait, newEcon, researchChance } from './research.ts'

const T0 = Date.UTC(2026, 10, 28, 3)
type R = { state: State; result?: unknown; gold?: number } | { error: string }
const seq = (...v: number[]) => { let i = 0; return () => v[Math.min(i++, v.length - 1)] }
const act = (s: State, a: unknown, o: { now?: number; rng?: () => number; gold?: number } = {}): R =>
  logic.apply(s, a as never, { now: o.now ?? T0, rng: o.rng ?? seq(0.5), gold: o.gold ?? 1_000_000 }) as R
const ok = (r: R) => { if ('error' in r) throw new Error(r.error); return r }
const err = (r: R) => ('error' in r ? r.error : null)
const fish = (id: number, species: string, extra: Partial<Fish> = {}): Fish => ({ id, origin: 'normal', species, sizeCm: SPECIES.find((s) => s.id === species)!.minCm, perfect: false, ...extra })
const base = (over: Partial<State> = {}): State => ({ ...logic.init(), ...over })
// 다금바리: 마을 부두, 낚싯대 3, 힘 0.95, 겨울만(연구 낚시는 계절을 완화한다)
const grouperReady = (over: Partial<State> = {}): State =>
  base({ rodTier: 3, legends: ['grouper'], econ: { ...newEcon(), license: true, baits: { attractor: 0, legend: 3, mythic: 0 } }, ...over })
const researchCast = { type: 'cast', area: 'village', spot: 'pier', power: 0.95, bait: 'legend', target: 'grouper' }

describe('지역 가격 보정(r4)', () => {
  it('섬·갯벌·산정 호수만 오르고 전설·신화 가격은 그대로', () => {
    const want: Record<string, number> = { clownfish: 100, stingray: 850, mahi: 980, 'horseshoe-crab': 1030, 'river-puffer': 1080, taimen: 1500, arowana: 1500, hammerhead: 910 }
    for (const [id, p] of Object.entries(want)) expect(SPECIES.find((s) => s.id === id)!.basePrice, id).toBe(p)
    expect(SPECIES.filter((s) => s.legend).map((s) => [s.id, s.basePrice])).toMatchSnapshot()
  })
})

describe('어분(grind)', () => {
  it('일반 물고기를 어분으로, 고른 것만 가방에서 빠진다', () => {
    const s = base({ bag: [fish(1, 'anchovy'), fish(2, 'goby'), fish(3, 'mackerel')], nextFishId: 4 })
    const r = ok(act(s, { type: 'grind', items: [{ index: 0, id: 1 }, { index: 2, id: 3 }] }))
    expect(r.state.bag.map((f) => f.id)).toEqual([2])
    expect(r.state.econ.meal).toBe(2)
    expect(r.gold).toBeUndefined()
  })
  it('잠긴·전설·id가 다른·같은 칸 두 번은 거절하고 아무것도 바뀌지 않는다', () => {
    const s = base({ bag: [fish(1, 'anchovy', { locked: true }), fish(2, 'grouper', { origin: 'first' }), fish(3, 'goby')], nextFishId: 4 })
    expect(err(act(s, { type: 'grind', items: [{ index: 0, id: 1 }] }))).toBe('locked')
    expect(err(act(s, { type: 'grind', items: [{ index: 1, id: 2 }] }))).toBe('not_ordinary')
    expect(err(act(s, { type: 'grind', items: [{ index: 2, id: 9 }] }))).toBe('bag_changed')
    expect(err(act(s, { type: 'grind', items: [{ index: 2 }, { index: 2 }] }))).toBe('bad_action')
    expect(err(act(s, { type: 'grind', items: [] }))).toBe('bad_action')
  })
})

describe('미끼 만들기·연구 해금', () => {
  it('집어 미끼: 50G + 어분 1 → 1개, 화면 가격이 다르면 price_changed', () => {
    const s = base({ econ: { ...newEcon(), meal: 1 } })
    const r = ok(act(s, { type: 'makeBait', kind: 'attractor', price: 50 }))
    expect(r.gold).toBe(-50)
    expect(r.state.econ).toEqual({ ...newEcon(), meal: 0, baits: { attractor: 1, legend: 0, mythic: 0 } })
    expect(err(act(s, { type: 'makeBait', kind: 'attractor', price: 40 }))).toBe('price_changed')
    expect(err(act(base(), { type: 'makeBait', kind: 'attractor', price: 50 }))).toBe('no_meal')
    expect(err(act(s, { type: 'makeBait', kind: 'attractor', price: 50 }, { gold: 49 }))).toBe('not_enough_gold')
  })
  it('전설 미끼 600G·어분 1, 신화 미끼 1,200G·어분 2: 연구 해금과 그 등급 발견이 있어야 한다', () => {
    const s = base({ legends: ['grouper'], econ: { ...newEcon(), meal: 5 } })
    expect(err(act(s, { type: 'makeBait', kind: 'legend', price: 600 }))).toBe('no_license')
    const lic = { ...s, econ: { ...s.econ, license: true } }
    expect(ok(act(lic, { type: 'makeBait', kind: 'legend', price: 600 })).gold).toBe(-600)
    expect(err(act(lic, { type: 'makeBait', kind: 'mythic', price: 1200 }))).toBe('not_discovered')
    const myth = { ...lic, legends: ['grouper', 'imugi'] }
    const r = ok(act(myth, { type: 'makeBait', kind: 'mythic', price: 1200 }))
    expect([r.gold, r.state.econ.meal, r.state.econ.baits.mythic]).toEqual([-1200, 3, 1])
  })
  it('연구 해금 50,000G: 전설 1종 발견, 계정당 한 번', () => {
    expect(err(act(base(), { type: 'buyLicense', price: 50_000 }))).toBe('need_legend')
    const r = ok(act(base({ legends: ['grouper'] }), { type: 'buyLicense', price: 50_000 }))
    expect([r.gold, r.state.econ.license]).toEqual([-50_000, true])
    expect(err(act(r.state, { type: 'buyLicense', price: 50_000 }))).toBe('owned')
    expect(err(act(base({ legends: ['grouper'] }), { type: 'buyLicense', price: 50_000 }, { gold: 49_999 }))).toBe('not_enough_gold')
  })
})

describe('집어 미끼 투척', () => {
  it('유효 투척이면 1개 쓰고 pending에 남긴다. 없으면 no_bait(맨 낚시는 그대로)', () => {
    const s = base({ econ: { ...newEcon(), baits: { attractor: 1, legend: 0, mythic: 0 } } })
    const r = ok(act(s, { type: 'cast', area: 'village', spot: 'shore', power: 0.5, bait: 'attractor' }))
    expect(r.state.econ.baits.attractor).toBe(0)
    expect(r.state.pending?.bait).toBe('attractor')
    expect(err(act(r.state, { type: 'cast', area: 'village', spot: 'shore', power: 0.5, bait: 'attractor' }))).not.toBe(null)
    expect(err(act(base(), { type: 'cast', area: 'village', spot: 'shore', power: 0.5, bait: 'attractor' }))).toBe('no_bait')
  })
  it('rare 가중치만 ×1.2(전설·신화 후보 확률은 그대로)', () => {
    const c = { rodTier: 4 as const, power: 0.5, sizeBonus: 0, area: 'village' as const, spot: 'shore', cond: conditionsAt(T0), legends: [], equipped: [] }
    // r1을 rare 경계 바로 위로 잡으면 미끼가 있을 때만 rare가 나온다
    const rarity = (rareMult?: number, r1 = 0.0) => SPECIES.find((s) => s.id === rollCatch(seq(0.99, r1, 0, 0.5, 0.5), { ...c, ...(rareMult ? { rareMult } : {}) }).species)!.rarity
    let hit = false
    for (let r1 = 0.6; r1 < 1; r1 += 0.005) if (rarity(1.2, r1) === 'rare' && rarity(undefined, r1) !== 'rare') hit = true
    expect(hit).toBe(true)
  })
})

describe('연구 낚시', () => {
  it('계절이 달라도 던질 수 있고, 미끼 1개를 쓰고 대상 보장 카운터를 올린다', () => {
    const r = ok(act(grouperReady(), researchCast))
    expect(r.state.econ.baits.legend).toBe(2)
    expect(r.state.econ.pity).toEqual({ grouper: 1 })
    expect(r.state.pending?.target).toBe('grouper')
  })
  it('거절된 투척은 미끼를 쓰지 않는다(해금 없음·발견 안 함·다른 자리·힘 부족·미끼 종류 틀림)', () => {
    expect(err(act(grouperReady({ econ: { ...grouperReady().econ, license: false } }), researchCast))).toBe('no_license')
    expect(err(act(grouperReady({ legends: [] }), researchCast))).toBe('not_discovered')
    expect(err(act(grouperReady(), { ...researchCast, spot: 'shore' }))).toBe('wrong_place')
    expect(err(act(grouperReady(), { ...researchCast, power: 0.5 }))).toBe('need_power')
    expect(err(act(grouperReady(), { ...researchCast, bait: 'mythic' }))).toBe('no_bait')
    expect(err(act(grouperReady({ econ: { ...grouperReady().econ, baits: { attractor: 0, legend: 1, mythic: 1 } } }), { ...researchCast, bait: 'mythic' }))).toBe('bad_target')
  })
  it('50번째 유효 투척은 대상이 입질한다(보장). 잡으면 recatch·잠금, 카운터 0', () => {
    const s = grouperReady({ econ: { ...grouperReady().econ, pity: { grouper: 49 } } })
    const cast = ok(act(s, researchCast, { rng: seq(0.999, 0.5, 0.5, 0.5, 0) }))
    expect(cast.state.pending?.species).toBe('grouper')
    expect(cast.state.econ.pity.grouper).toBe(50)
    const p = cast.state.pending!
    const hooked = ok(act(cast.state, { type: 'hook' }, { now: p.startedAt + p.biteDelayMs }))
    const res = ok(act(hooked.state, { type: 'resolve', success: true, perfect: false }, { now: p.startedAt + p.biteDelayMs + MIN_FIGHT_MS }))
    const got = res.state.bag.at(-1)!
    expect([got.species, got.origin, got.locked]).toEqual(['grouper', 'recatch', true])
    expect(res.state.econ.pity).toEqual({})
    expect(res.state.legends).toEqual(['grouper'])
  })
  it('대상을 놓치면 카운터는 그대로, 49번째까지는 3% 추첨(r0가 높으면 일반 물고기)', () => {
    const s = grouperReady({ econ: { ...grouperReady().econ, pity: { grouper: 48 } } })
    const miss = ok(act(s, researchCast, { rng: seq(0.999, 0.5, 0.5, 0.5, 0) }))
    expect(miss.state.pending?.species).not.toBe('grouper')
    expect(miss.state.econ.pity.grouper).toBe(49)
    const hit = ok(act(s, researchCast, { rng: seq(0.01, 0.5, 0.5, 0.5, 0) }))
    expect(hit.state.pending?.species).toBe('grouper')
    const lost = ok(act(hit.state, { type: 'resolve', success: false, perfect: false }))
    expect(lost.state.econ.pity.grouper).toBe(49)
  })
})

describe('재포획 판매가', () => {
  it('recatch는 round(판매가 × 50%), legacy·first·normal은 그대로. 전부 팔기도 같은 값', () => {
    const f = fish(1, 'grouper', { sizeCm: 100 })
    const full = sellPrice(f)
    expect(fishSellPrice({ ...f, origin: 'recatch' })).toBe(Math.round(full / 2))
    for (const o of ['legacy', 'first', 'normal'] as const) expect(fishSellPrice({ ...f, origin: o })).toBe(full)
    const r = ok(act(base({ bag: [{ ...f, origin: 'recatch' }], nextFishId: 2 }), { type: 'sell' }))
    expect(r.gold).toBe(Math.round(full / 2))
  })
})

describe('미끼 여러 개 한 번에 (logic.version 29)', () => {
  it('count만큼 만들고 골드·어분을 그만큼 쓴다. count 없으면 1개', () => {
    const s = base({ econ: { ...newEcon(), meal: 10 } })
    const r = ok(act(s, { type: 'makeBait', kind: 'attractor', price: 50, count: 7 }))
    expect(r.gold).toBe(-350)
    expect([r.state.econ.meal, r.state.econ.baits.attractor]).toEqual([3, 7])
    expect(ok(act(s, { type: 'makeBait', kind: 'attractor', price: 50 })).state.econ.baits.attractor).toBe(1)
  })
  it('어분·골드가 count만큼 없으면 거절(일부만 만들지 않는다), count는 1 이상 정수', () => {
    const s = base({ econ: { ...newEcon(), meal: 5 } })
    expect(err(act(s, { type: 'makeBait', kind: 'attractor', price: 50, count: 6 }))).toBe('no_meal')
    expect(err(act(s, { type: 'makeBait', kind: 'attractor', price: 50, count: 5 }, { gold: 249 }))).toBe('not_enough_gold')
    for (const count of [0, -1, 1.5, '3', MAX_BAIT_BATCH + 1]) {
      expect(err(act(s, { type: 'makeBait', kind: 'attractor', price: 50, count } as never))).toBe('bad_action')
    }
  })
  it('신화 미끼는 개당 어분 2: 어분 5면 최대 2개', () => {
    const s = base({ legends: ['grouper', 'imugi'], econ: { ...newEcon(), meal: 5, license: true } })
    expect(maxBait('mythic', 5, 10_000)).toBe(2)
    const r = ok(act(s, { type: 'makeBait', kind: 'mythic', price: 1200, count: 2 }))
    expect([r.gold, r.state.econ.meal, r.state.econ.baits.mythic]).toEqual([-2400, 1, 2])
  })
  it('maxBait: 어분·골드 중 모자란 쪽까지, 상한 MAX_BAIT_BATCH', () => {
    expect(maxBait('attractor', 10, 120)).toBe(2)
    expect(maxBait('attractor', 3, 1_000_000)).toBe(3)
    expect(maxBait('attractor', 0, 1_000_000)).toBe(0)
    expect(maxBait('attractor', 1_000_000, 1_000_000_000)).toBe(MAX_BAIT_BATCH)
  })
  it('v28 세이브는 그대로 읽는다(세이브 형식은 28과 같다)', () => {
    const raw = { ...logic.init(), legends: ['grouper'], econ: { meal: 4, baits: { attractor: 3, legend: 1, mythic: 0 }, license: true, pity: { grouper: 9 } } }
    const m = logic.migrate(JSON.parse(JSON.stringify(raw)), 28)
    expect(m.econ).toEqual(raw.econ)
    expect(logic.migrate(JSON.parse(JSON.stringify(m)), 28)).toEqual(m)
  })
})

describe('자동 어분 (logic.version 30)', () => {
  const HOOK = T0 + 3000
  // 멸치 12cm(기본 20G 근처) 를 낚아 거두기 직전 상태
  const hooked = (over: Partial<State> = {}, sizeCm = 12, species = 'anchovy'): State => base({
    pending: { species, sizeCm, biteDelayMs: 3000, startedAt: T0, hookedAt: HOOK, area: 'village', spot: 'shore', cond: conditionsAt(T0), power: 0.5 },
    ...over,
  })
  const reel = (s: State) => ok(act(s, { type: 'resolve', success: true, perfect: false }, { now: HOOK + MIN_FIGHT_MS }))
  const price = (s: State, sizeCm = 12, species = 'anchovy') => fishSellPrice({ origin: 'normal', species, sizeCm, perfect: false }, s.buffs ?? [])
  const seen = (maxCm = 14) => ({ anchovy: { count: 3, maxCm } })

  it('setAutoMeal: 판매가 기준(1 이상 정수, AUTO_MEAL_MAX 이하)을 저장하고, null이면 끈다', () => {
    const on = ok(act(base(), { type: 'setAutoMeal', price: 30 }))
    expect(on.state.econ.autoMeal).toBe(30)
    const off = ok(act(on.state, { type: 'setAutoMeal', price: null }))
    expect(off.state.econ.autoMeal).toBeUndefined()
    for (const price of [0, -1, 1.5, '30', AUTO_MEAL_MAX + 1]) expect(err(act(base(), { type: 'setAutoMeal', price } as never))).toBe('bad_action')
  })
  it('기준 이하 일반 물고기는 가방에 안 들어가고 어분 1개. 도감·과제 기록은 남는다', () => {
    const s0 = hooked({ dex: seen(), econ: { ...newEcon(), autoMeal: 1000 } })
    const r = reel(s0)
    expect(r.state.bag).toEqual([])
    expect(r.state.econ.meal).toBe(1)
    expect(r.state.dex.anchovy.count).toBe(4)
    expect(r.result).toMatchObject({ caught: { species: 'anchovy' }, autoMeal: true })
    expect(r.state.nextFishId).toBe(s0.nextFishId + 1)
  })
  it('기준보다 비싸면 가방에 넣는다(기준과 같으면 어분)', () => {
    const s0 = hooked({ dex: seen() })
    const p = price(s0)
    expect(reel({ ...s0, econ: { ...newEcon(), autoMeal: p - 1 } }).state.bag).toHaveLength(1)
    expect(reel({ ...s0, econ: { ...newEcon(), autoMeal: p } }).state.bag).toHaveLength(0)
  })
  it('처음 잡은 어종, 최대 크기 기록을 새로 쓴 물고기는 기준 이하여도 가방에 남긴다', () => {
    const econ = { ...newEcon(), autoMeal: 1000 }
    expect(reel(hooked({ econ })).state.bag).toHaveLength(1)
    expect(reel(hooked({ econ, dex: seen(11) })).state.bag).toHaveLength(1)
    expect(reel(hooked({ econ, dex: seen(12) })).state.bag).toHaveLength(0)
  })
  it('전설·신화는 자동 어분이 되지 않는다, 기준이 없으면 그대로', () => {
    const econ = { ...newEcon(), autoMeal: AUTO_MEAL_MAX }
    const g = hooked({ econ, legends: ['grouper'], dex: { grouper: { count: 1, maxCm: 999 } } }, 100, 'grouper')
    expect(reel(g).state.bag).toHaveLength(1)
    expect(reel(hooked({ dex: seen() })).state.bag).toHaveLength(1)
  })
  it('v29 세이브: autoMeal 없음은 그대로, 깨진 값은 버리고 맞는 값은 살린다', () => {
    const raw = (autoMeal: unknown) => ({ ...logic.init(), econ: { meal: 2, baits: { attractor: 0, legend: 0, mythic: 0 }, license: false, pity: {}, autoMeal } })
    expect(logic.migrate(raw(undefined), 29).econ.autoMeal).toBeUndefined()
    expect(logic.migrate(raw(-3), 29).econ.autoMeal).toBeUndefined()
    expect(logic.migrate(raw(250), 30).econ.autoMeal).toBe(250)
    const m = logic.migrate(raw(250), 30)
    expect(logic.migrate(JSON.parse(JSON.stringify(m)), 30)).toEqual(m)
  })
})

describe('migrate v27', () => {
  it('v26 세이브는 빈 econ, v27 econ은 알려진 값만 살린다', () => {
    const v26 = { ...logic.init(), econ: undefined }
    expect(logic.migrate(v26, 26).econ).toEqual(newEcon())
    const raw = { ...logic.init(), legends: ['grouper'], econ: { meal: 3, baits: { attractor: 2, legend: -1, mythic: 1.5 }, license: true, pity: { grouper: 7, imugi: 4, anchovy: 2 } } }
    expect(logic.migrate(raw, 27).econ).toEqual({ meal: 3, baits: { attractor: 2, legend: 0, mythic: 0 }, license: true, pity: { grouper: 7 } })
  })
  it('던진 중인 연구 투척(pending의 bait·target)은 v27 세이브에서 이어진다', () => {
    const cast = ok(act(grouperReady(), researchCast))
    const again = logic.migrate(JSON.parse(JSON.stringify(cast.state)), 27)
    expect([again.pending?.bait, again.pending?.target]).toEqual(['legend', 'grouper'])
    expect(logic.migrate(again, 27)).toEqual(again)
  })
})

describe('연구 낚시 확률(v28: 전설 1.5%·신화 0.75%)', () => {
  it('대상 입질 확률, 호기심 찌 ×1.5, 보장 횟수에서 1', () => {
    expect(researchChance('grouper', 0, false)).toBeCloseTo(0.015, 10)
    expect(researchChance('grouper', 0, true)).toBeCloseTo(0.0225, 10)
    expect(researchChance('imugi', 0, false)).toBeCloseTo(0.0075, 10)
    expect(researchChance('imugi', 0, true)).toBeCloseTo(0.01125, 10)
    expect(researchChance('grouper', 48, false)).toBeCloseTo(0.015, 10)
    expect(researchChance('grouper', 49, false)).toBe(1)
    expect(researchChance('imugi', 98, false)).toBeCloseTo(0.0075, 10)
    expect(researchChance('imugi', 99, false)).toBe(1)
  })
  it('r0이 1.5% 이상이면 대상이 아니다(옛 3% 경계 사이 값)', () => {
    const miss = ok(act(grouperReady(), researchCast, { rng: seq(0.02, 0.5, 0.5, 0.5, 0) }))
    expect((miss.state.pending as { species: string }).species).not.toBe('grouper')
    const hit = ok(act(grouperReady(), researchCast, { rng: seq(0.0149, 0.5, 0.5, 0.5, 0) }))
    expect((hit.state.pending as { species: string }).species).toBe('grouper')
  })
  it('v27 세이브는 그대로 읽는다(형식 같음)', () => {
    const raw = JSON.parse(JSON.stringify({ ...grouperReady(), econ: { ...newEcon(), license: true, pity: { grouper: 12 } } }))
    const m = logic.migrate(raw, 27)
    expect(m.econ.pity).toEqual({ grouper: 12 })
    expect(m.econ.license).toBe(true)
  })
})


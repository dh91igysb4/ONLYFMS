// 낚시 추첨·가격. 순수 함수만, 외부 의존 없음.
import type { WorldLogic, WorldRecord } from '../types.ts'
import { conditionsAt, type Conditions } from './clock.ts'
import {
  AREAS, areaHasSpecies, BAGS, bagSize, DEFAULT_AREAS, HOOK_GRACE_MS, HOOK_WINDOW_MS, LEGEND_CHANCE, MIN_FIGHT_MS,
  PIER_POWER_BONUS, RODS, SPECIES, speciesAvailable, type AreaId, type Rod, type Species,
} from './data.ts'

export type Catch = { species: string; sizeCm: number; biteDelayMs: number }
export type CastCtx = {
  rodTier: 1 | 2 | 3 | 4
  power: number
  sizeBonus: number
  area: AreaId
  spot: string
  cond: Conditions
  /** 이미 잡은 전설 어종 id. 다시 나오지 않는다 */
  legends: readonly string[]
}

type NormalRarity = keyof Rod['weights']
const RARITIES: NormalRarity[] = ['common', 'uncommon', 'rare']

function speciesById(id: string): Species {
  const s = SPECIES.find((x) => x.id === id)
  if (!s) throw new Error(`unknown species: ${id}`)
  return s
}

// 뽑힌 등급에 후보가 없을 때: 아래 등급으로 차례로(common까지), 그래도 없으면 위 등급으로. 전부 비면 [].
export function pickPool(byRarity: Record<NormalRarity, Species[]>, rarity: NormalRarity): Species[] {
  const i = RARITIES.indexOf(rarity)
  const order = [...RARITIES.slice(0, i + 1).reverse(), ...RARITIES.slice(i + 1)]
  for (const r of order) if (byRarity[r].length > 0) return byRarity[r]
  return []
}

// rng 호출 순서 고정, 항상 5번: 전설 판정(r0) → 등급(r1) → 등급 안 어종(r2) → 크기(r3) → 입질(r4).
// 전설이 뽑혀도 r1·r2는 쓰지 않고 소비한다.
export function rollCatch(rng: () => number, c: CastCtx): Catch {
  const rod = RODS.find((r) => r.tier === c.rodTier)
  if (!rod) throw new Error(`unknown rod tier: ${c.rodTier}`)
  const available = SPECIES.filter((s) => speciesAvailable(s, c.area, c.spot, c.cond, c.rodTier))

  const r0 = rng()
  const r1 = rng()
  const r2 = rng()
  const legend = available.find((s) => s.legend && c.power >= s.legend.power && !c.legends.includes(s.id))

  let species: Species
  if (legend && r0 < LEGEND_CHANCE) {
    species = legend
  } else {
    const total = RARITIES.reduce((sum, r) => sum + rod.weights[r], 0)
    let pick = r1 * total
    let rarity: NormalRarity = RARITIES[RARITIES.length - 1]
    for (const r of RARITIES) {
      if (pick < rod.weights[r]) {
        rarity = r
        break
      }
      pick -= rod.weights[r]
    }
    const byRarity: Record<NormalRarity, Species[]> = { common: [], uncommon: [], rare: [] }
    for (const s of available) if (s.rarity !== 'legend') byRarity[s.rarity].push(s)
    const pool = pickPool(byRarity, rarity)
    if (pool.length === 0) throw new Error(`no species for ${c.area}/${c.spot} at rod ${c.rodTier}`)
    species = pool[Math.floor(r2 * pool.length)]
  }

  const p = rng() ** (1.5 - Math.min(1.25, c.power + c.sizeBonus))
  const sizeCm = Math.round(species.minCm + p * (species.maxCm - species.minCm))
  const biteDelayMs = Math.round((1500 + rng() * 4500) * rod.biteScale)
  return { species: species.id, sizeCm, biteDelayMs }
}

export function sizePercentile(speciesId: string, sizeCm: number): number {
  const s = speciesById(speciesId)
  const p = (sizeCm - s.minCm) / (s.maxCm - s.minCm)
  return Math.min(1, Math.max(0, p))
}

export function price(speciesId: string, sizeCm: number, perfect: boolean): number {
  const s = speciesById(speciesId)
  // 0.7 + 0.6p, 1.25를 정수(70 + 60p, 125/100)로 곱해 부동소수 오차로 .5 경계가 어긋나지 않게 한다.
  const scaled = s.basePrice * (70 + 60 * sizePercentile(speciesId, sizeCm)) * (perfect ? 125 : 100)
  return Math.round(scaled / 10000)
}

// ---------------------------------------------------------------- WorldLogic
/** locked: 가방에서 잠근 물고기. "전부 팔기"에서 빠진다. 잠기지 않았으면 필드가 없다. */
export type Fish = { species: string; sizeCm: number; perfect: boolean; locked?: true }
export type Pending = {
  species: string
  sizeCm: number
  biteDelayMs: number
  startedAt: number
  /** 챈 시각. null이면 아직 입질에 반응하지 않아 어종·크기를 브라우저에 보내지 않는다 */
  hookedAt: number | null
  /** 던질 때의 지역·자리·조건·힘. 브라우저에 보내지 않는다 */
  area: AreaId
  spot: string
  cond: Conditions
  power: number
}
export type PendingView = {
  biteDelayMs: number
  startedAt: number
  hooked: boolean
  species: string | null
  sizeCm: number | null
}
export type State = {
  gold: number
  totalEarned: number
  rodTier: 1 | 2 | 3 | 4
  bagTier: 1 | 2 | 3
  areas: AreaId[]
  bag: Fish[]
  dex: Record<string, { count: number; maxCm: number }>
  /** 이미 잡은 전설 어종 id */
  legends: string[]
  pending: Pending | null
}
export type Action =
  | { type: 'cast'; area: string; power: number; spot?: string }
  | { type: 'hook' }
  | { type: 'resolve'; success: boolean; perfect: boolean }
  | { type: 'sell' }
  | { type: 'lock'; index: number; locked: boolean }
  | { type: 'buyRod'; tier: number }
  | { type: 'buyBag'; tier: number }
// pending의 어종·크기는 `hook` 뒤에만 내보낸다. 다시 던져 어종을 고르는 것을 막는다.
export type View = Omit<State, 'pending'> & { pending: PendingView | null }

type Out = { state: State; result?: unknown } | { error: string }

function pendingView(p: Pending): PendingView {
  const hooked = p.hookedAt != null
  return {
    biteDelayMs: p.biteDelayMs,
    startedAt: p.startedAt,
    hooked,
    species: hooked ? p.species : null,
    sizeCm: hooked ? p.sizeCm : null,
  }
}

const init = (): State => ({
  gold: 0,
  totalEarned: 0,
  rodTier: 1,
  bagTier: 1,
  areas: [...DEFAULT_AREAS],
  bag: [],
  dex: {},
  legends: [],
  pending: null,
})

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const knownSpecies = (id: unknown): id is string => typeof id === 'string' && SPECIES.some((s) => s.id === id)

function cast(state: State, a: Record<string, unknown>, ctx: { now: number; rng: () => number }): Out {
  // 구버전 화면은 지역 'pier'를 보낸다
  const areaId = a.area === 'pier' ? 'village' : a.area
  const area = AREAS.find((x) => x.id === areaId)
  if (!area || !state.areas.includes(area.id) || !areaHasSpecies(area.id)) return { error: 'bad_area' }
  const spot = a.spot === undefined ? (area.id === 'village' ? 'shore' : area.spots[0]) : a.spot
  if (typeof spot !== 'string' || !area.spots.includes(spot)) return { error: 'bad_spot' }
  if (!isNum(a.power) || a.power < 0 || a.power > 1) return { error: 'bad_power' }
  if (state.bag.length >= bagSize(state.bagTier)) return { error: 'bag_full' }
  const cond = conditionsAt(ctx.now)
  const c = rollCatch(ctx.rng, {
    rodTier: state.rodTier,
    power: a.power,
    sizeBonus: spot === 'pier' ? PIER_POWER_BONUS : 0,
    area: area.id,
    spot,
    cond,
    legends: state.legends,
  })
  const pending: Pending = { ...c, startedAt: ctx.now, hookedAt: null, area: area.id, spot, cond, power: a.power }
  return { state: { ...state, pending }, result: pendingView(pending) }
}

function hook(state: State, now: number): Out {
  const p = state.pending
  if (!p) return { error: 'no_pending' }
  if (p.hookedAt != null) return { error: 'bad_action' }
  const bite = p.startedAt + p.biteDelayMs
  if (now < bite) return { error: 'too_early' }
  if (now > bite + HOOK_WINDOW_MS + HOOK_GRACE_MS) return { error: 'too_late' }
  return { state: { ...state, pending: { ...p, hookedAt: now } }, result: { species: p.species, sizeCm: p.sizeCm } }
}

function resolve(state: State, a: Record<string, unknown>, now: number): Out {
  const p = state.pending
  if (!p) return { error: 'no_pending' }
  if (typeof a.success !== 'boolean' || typeof a.perfect !== 'boolean') return { error: 'bad_action' }
  if (!a.success) return { state: { ...state, pending: null }, result: { caught: null } }
  if (p.hookedAt == null) return { error: 'not_hooked' }
  if (now < p.hookedAt + MIN_FIGHT_MS) return { error: 'too_early' }
  const isLegend = !!speciesById(p.species).legend
  // 전설은 다시 잡을 수 없으니 실수로 팔리지 않게 잠근 채 넣는다 (가방에서 풀 수 있다)
  const fish: Fish = { species: p.species, sizeCm: p.sizeCm, perfect: a.perfect, ...(isLegend ? { locked: true as const } : {}) }
  const prev = state.dex[p.species]
  const dex = {
    ...state.dex,
    [p.species]: { count: (prev?.count ?? 0) + 1, maxCm: Math.max(prev?.maxCm ?? 0, p.sizeCm) },
  }
  const legends = isLegend && !state.legends.includes(p.species) ? [...state.legends, p.species] : state.legends
  return { state: { ...state, bag: [...state.bag, fish], dex, legends, pending: null }, result: { caught: fish } }
}

function sell(state: State): Out {
  // 잠긴 물고기는 팔지 않고 순서 그대로 남긴다
  const selling = state.bag.filter((f) => !f.locked)
  if (selling.length === 0) return { error: 'bag_empty' }
  const earned = selling.reduce((sum, f) => sum + price(f.species, f.sizeCm, f.perfect), 0)
  return {
    state: { ...state, gold: state.gold + earned, totalEarned: state.totalEarned + earned, bag: state.bag.filter((f) => f.locked) },
    result: { earned },
  }
}

function lock(state: State, a: Record<string, unknown>): Out {
  const i = a.index
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= state.bag.length) return { error: 'bad_action' }
  if (typeof a.locked !== 'boolean') return { error: 'bad_action' }
  const { locked: _was, ...rest } = state.bag[i]
  const fish: Fish = a.locked ? { ...rest, locked: true } : rest
  return { state: { ...state, bag: state.bag.map((f, j) => (j === i ? fish : f)) } }
}

function buyRod(state: State, a: Record<string, unknown>): Out {
  if (!Number.isInteger(a.tier) || a.tier !== state.rodTier + 1) return { error: 'bad_tier' }
  const rod = RODS.find((r) => r.tier === a.tier)
  if (!rod) return { error: 'bad_tier' }
  if (state.gold < rod.price) return { error: 'not_enough_gold' }
  return { state: { ...state, rodTier: rod.tier, gold: state.gold - rod.price } }
}

function buyBag(state: State, a: Record<string, unknown>): Out {
  if (!Number.isInteger(a.tier) || a.tier !== state.bagTier + 1) return { error: 'bad_tier' }
  const bag = BAGS.find((b) => b.tier === a.tier)
  if (!bag) return { error: 'bad_tier' }
  if (state.gold < bag.price) return { error: 'not_enough_gold' }
  return { state: { ...state, bagTier: bag.tier, gold: state.gold - bag.price } }
}

function migrate(raw: unknown, fromVersion: number): State {
  const base = init()
  if (!isObj(raw)) return base
  const nonNeg = (v: unknown, d: number) => (isNum(v) && v >= 0 ? v : d)
  const rodTier = RODS.some((r) => r.tier === raw.rodTier) ? (raw.rodTier as State['rodTier']) : base.rodTier
  const bagTier = BAGS.some((b) => b.tier === raw.bagTier) ? (raw.bagTier as State['bagTier']) : base.bagTier
  // 알려진 지역만 남기고 기본 지역은 항상 포함한다
  const knownAreas = AREAS.map((x) => x.id) as string[]
  const extra = Array.isArray(raw.areas)
    ? raw.areas.filter((x): x is AreaId => typeof x === 'string' && knownAreas.includes(x))
    : []
  const areas = [...new Set<AreaId>([...DEFAULT_AREAS, ...extra])]
  const bag: Fish[] = []
  if (Array.isArray(raw.bag)) {
    for (const f of raw.bag) {
      if (isObj(f) && knownSpecies(f.species) && isNum(f.sizeCm) && typeof f.perfect === 'boolean') {
        // v4까지는 잠금이 없었다: 가방에 있던 전설은 잠가 둔다. v5부터는 저장된 잠금 그대로.
        const locked = fromVersion < 5 ? !!speciesById(f.species).legend : f.locked === true
        bag.push({ species: f.species, sizeCm: f.sizeCm, perfect: f.perfect, ...(locked ? { locked: true as const } : {}) })
      }
    }
  }
  const dex: State['dex'] = {}
  if (isObj(raw.dex)) {
    for (const [id, e] of Object.entries(raw.dex)) {
      if (knownSpecies(id) && isObj(e) && isNum(e.count) && isNum(e.maxCm)) dex[id] = { count: e.count, maxCm: e.maxCm }
    }
  }
  // 전설은 저장된 목록 + 도감에 있는 전설 어종 (v2 세이브에는 목록이 없다)
  const legendIds = new Set(SPECIES.filter((s) => s.legend).map((s) => s.id))
  const savedLegends = Array.isArray(raw.legends) ? raw.legends : []
  const legends = [...legendIds].filter((id) => savedLegends.includes(id) || id in dex)
  return {
    gold: nonNeg(raw.gold, base.gold),
    totalEarned: nonNeg(raw.totalEarned, base.totalEarned),
    rodTier,
    bagTier,
    areas,
    bag: bag.slice(0, bagSize(bagTier)),
    dex,
    legends,
    pending: null,
  }
}

function records(state: State): WorldRecord[] {
  let best: { id: string; maxCm: number } | null = null
  for (const [id, e] of Object.entries(state.dex)) if (!best || e.maxCm > best.maxCm) best = { id, maxCm: e.maxCm }
  const biggest: WorldRecord = { key: 'biggest', value: best?.maxCm ?? 0 }
  const name = best && SPECIES.find((s) => s.id === best!.id)?.name
  if (name) biggest.detail = name
  const found = Object.keys(state.dex).length
  return [
    { key: 'total_earned', value: state.totalEarned },
    biggest,
    { key: 'dex', value: found, detail: `${found}/${SPECIES.length}` },
  ]
}

export const logic: WorldLogic<State, Action, View> = {
  version: 5,
  init,
  migrate,
  // action은 네트워크에서 온 JSON이라 unknown으로 다루고 필드마다 검증한다.
  apply(state, action: unknown, ctx) {
    if (!isObj(action)) return { error: 'bad_action' }
    switch (action.type) {
      case 'cast':
        return cast(state, action, ctx)
      case 'hook':
        return hook(state, ctx.now)
      case 'resolve':
        return resolve(state, action, ctx.now)
      case 'sell':
        return sell(state)
      case 'lock':
        return lock(state, action)
      case 'buyRod':
        return buyRod(state, action)
      case 'buyBag':
        return buyBag(state, action)
      default:
        return { error: 'bad_action' }
    }
  },
  view: (state): View => ({ ...state, pending: state.pending && pendingView(state.pending) }),
  records,
}

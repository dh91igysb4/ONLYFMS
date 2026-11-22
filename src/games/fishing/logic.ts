// 낚시 추첨·가격. 순수 함수만, 외부 의존 없음.
import type { WorldLogic, WorldRecord } from '../types.ts'
import { AREAS, BAG_SIZE, MIN_FIGHT_MS, RODS, SPECIES, type Rarity, type Species } from './data.ts'

export type Catch = { species: string; sizeCm: number; biteDelayMs: number }

const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'legend']

function speciesById(id: string): Species {
  const s = SPECIES.find((x) => x.id === id)
  if (!s) throw new Error(`unknown species: ${id}`)
  return s
}

// rng 호출 순서 고정: 등급 → 등급 안 어종 → 크기 → 입질.
export function rollCatch(rng: () => number, rodTier: 1 | 2 | 3 | 4, power: number): Catch {
  const rod = RODS.find((r) => r.tier === rodTier)
  if (!rod) throw new Error(`unknown rod tier: ${rodTier}`)

  const total = RARITIES.reduce((sum, r) => sum + rod.weights[r], 0)
  let pick = rng() * total
  let rarity: Rarity = RARITIES[RARITIES.length - 1]
  for (const r of RARITIES) {
    if (pick < rod.weights[r]) {
      rarity = r
      break
    }
    pick -= rod.weights[r]
  }

  const pool = SPECIES.filter((s) => s.rarity === rarity && s.minRod <= rodTier)
  if (pool.length === 0) throw new Error(`no species for rarity ${rarity} at rod ${rodTier}`)
  const species = pool[Math.floor(rng() * pool.length)]

  const p = rng() ** (1.5 - power)
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
export type Fish = { species: string; sizeCm: number; perfect: boolean }
export type Pending = { species: string; sizeCm: number; biteDelayMs: number; startedAt: number }
export type State = {
  gold: number
  totalEarned: number
  rodTier: 1 | 2 | 3 | 4
  areas: string[]
  bag: Fish[]
  dex: Record<string, { count: number; maxCm: number }>
  pending: Pending | null
}
export type Action =
  | { type: 'cast'; area: string; power: number }
  | { type: 'resolve'; success: boolean; perfect: boolean }
  | { type: 'sell' }
  | { type: 'buyRod'; tier: number }
// 숨길 값 없음. pending의 어종은 미니게임 난이도에 필요해 그대로 보낸다.
export type View = State

type Out = { state: State; result?: unknown } | { error: string }

const init = (): State => ({
  gold: 0,
  totalEarned: 0,
  rodTier: 1,
  areas: ['pier'],
  bag: [],
  dex: {},
  pending: null,
})

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const knownSpecies = (id: unknown): id is string => typeof id === 'string' && SPECIES.some((s) => s.id === id)

function cast(state: State, a: Record<string, unknown>, ctx: { now: number; rng: () => number }): Out {
  if (typeof a.area !== 'string' || !state.areas.includes(a.area)) return { error: 'bad_area' }
  if (!isNum(a.power) || a.power < 0 || a.power > 1) return { error: 'bad_power' }
  if (state.bag.length >= BAG_SIZE) return { error: 'bag_full' }
  const c = rollCatch(ctx.rng, state.rodTier, a.power)
  const pending: Pending = { ...c, startedAt: ctx.now }
  return { state: { ...state, pending }, result: pending }
}

function resolve(state: State, a: Record<string, unknown>, now: number): Out {
  const p = state.pending
  if (!p) return { error: 'no_pending' }
  if (typeof a.success !== 'boolean' || typeof a.perfect !== 'boolean') return { error: 'bad_action' }
  if (!a.success) return { state: { ...state, pending: null }, result: { caught: null } }
  if (now < p.startedAt + p.biteDelayMs + MIN_FIGHT_MS) return { error: 'too_early' }
  const fish: Fish = { species: p.species, sizeCm: p.sizeCm, perfect: a.perfect }
  const prev = state.dex[p.species]
  const dex = {
    ...state.dex,
    [p.species]: { count: (prev?.count ?? 0) + 1, maxCm: Math.max(prev?.maxCm ?? 0, p.sizeCm) },
  }
  return { state: { ...state, bag: [...state.bag, fish], dex, pending: null }, result: { caught: fish } }
}

function sell(state: State): Out {
  if (state.bag.length === 0) return { error: 'bag_empty' }
  const earned = state.bag.reduce((sum, f) => sum + price(f.species, f.sizeCm, f.perfect), 0)
  return {
    state: { ...state, gold: state.gold + earned, totalEarned: state.totalEarned + earned, bag: [] },
    result: { earned },
  }
}

function buyRod(state: State, a: Record<string, unknown>): Out {
  if (!Number.isInteger(a.tier) || a.tier !== state.rodTier + 1) return { error: 'bad_tier' }
  const rod = RODS.find((r) => r.tier === a.tier)
  if (!rod) return { error: 'bad_tier' }
  if (state.gold < rod.price) return { error: 'not_enough_gold' }
  return { state: { ...state, rodTier: rod.tier, gold: state.gold - rod.price } }
}

function migrate(raw: unknown, _fromVersion: number): State {
  const base = init()
  if (!isObj(raw)) return base
  const nonNeg = (v: unknown, d: number) => (isNum(v) && v >= 0 ? v : d)
  const rodTier = RODS.some((r) => r.tier === raw.rodTier) ? (raw.rodTier as State['rodTier']) : base.rodTier
  const knownAreas = AREAS.map((x) => x.id) as string[]
  const areas = Array.isArray(raw.areas)
    ? raw.areas.filter((x): x is string => typeof x === 'string' && knownAreas.includes(x))
    : []
  const bag: Fish[] = []
  if (Array.isArray(raw.bag)) {
    for (const f of raw.bag) {
      if (isObj(f) && knownSpecies(f.species) && isNum(f.sizeCm) && typeof f.perfect === 'boolean') {
        bag.push({ species: f.species, sizeCm: f.sizeCm, perfect: f.perfect })
      }
    }
  }
  const dex: State['dex'] = {}
  if (isObj(raw.dex)) {
    for (const [id, e] of Object.entries(raw.dex)) {
      if (knownSpecies(id) && isObj(e) && isNum(e.count) && isNum(e.maxCm)) dex[id] = { count: e.count, maxCm: e.maxCm }
    }
  }
  return {
    gold: nonNeg(raw.gold, base.gold),
    totalEarned: nonNeg(raw.totalEarned, base.totalEarned),
    rodTier,
    areas: areas.length > 0 ? areas : base.areas,
    bag: bag.slice(0, BAG_SIZE),
    dex,
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
  version: 1,
  init,
  migrate,
  // action은 네트워크에서 온 JSON이라 unknown으로 다루고 필드마다 검증한다.
  apply(state, action: unknown, ctx) {
    if (!isObj(action)) return { error: 'bad_action' }
    switch (action.type) {
      case 'cast':
        return cast(state, action, ctx)
      case 'resolve':
        return resolve(state, action, ctx.now)
      case 'sell':
        return sell(state)
      case 'buyRod':
        return buyRod(state, action)
      default:
        return { error: 'bad_action' }
    }
  },
  view: (state) => state,
  records,
}

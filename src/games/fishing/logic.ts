// 낚시 추첨·가격. 순수 함수만, 외부 의존 없음.
import type { WorldLogic, WorldRecord } from '../types.ts'
import { conditionsAt, isNight, type Conditions } from './clock.ts'
import {
  AREAS, areaHasSpecies, BAGS, bagSize, CHALLENGES, DEFAULT_AREAS, HOOK_GRACE_MS, HOOK_WINDOW_MS, LEGEND_CHANCE, MIN_FIGHT_MS,
  PIER_POWER_BONUS, RODS, SPECIES, speciesAvailable, TACKLE_FX, tackleSlots, TACKLES, UNLOCKS,
  type AreaId, type BagTier, type Challenge, type Rod, type RodTier, type Species, type TackleId,
} from './data.ts'
import { teleportFee, teleporterWorld } from './teleport.ts'
import { DEFAULT_OUTFIT, isShopItem, isWearSlot, newlyEarned, ownsWear, WEAR, WEAR_SLOTS, wearItem, wearKey, type Outfit } from './wardrobe.ts'

export type Catch = { species: string; sizeCm: number; biteDelayMs: number }
export type CastCtx = {
  rodTier: RodTier
  power: number
  sizeBonus: number
  area: AreaId
  spot: string
  cond: Conditions
  /** 이미 잡은 전설 어종 id. 다시 나오지 않는다 */
  legends: readonly string[]
  /** 장착한 찌. 서버 추첨에 쓰이는 건 spinner·curious */
  equipped: readonly TackleId[]
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

  const spinner = c.equipped.includes('spinner')
  const curious = c.equipped.includes('curious')
  const r0 = rng()
  const r1 = rng()
  const r2 = rng()
  const legend = available.find((s) => s.legend && c.power >= s.legend.power && !c.legends.includes(s.id))

  let species: Species
  if (legend && r0 < LEGEND_CHANCE * (curious ? TACKLE_FX.curiousLegend : 1)) {
    species = legend
  } else {
    const weight = (r: NormalRarity) => rod.weights[r] * (curious && r === 'rare' ? TACKLE_FX.curiousRare : 1)
    const total = RARITIES.reduce((sum, r) => sum + weight(r), 0)
    let pick = r1 * total
    let rarity: NormalRarity = RARITIES[RARITIES.length - 1]
    for (const r of RARITIES) {
      if (pick < weight(r)) {
        rarity = r
        break
      }
      pick -= weight(r)
    }
    const byRarity: Record<NormalRarity, Species[]> = { common: [], uncommon: [], rare: [] }
    // 전설·신화(legend 필드)는 일반 등급 추첨에 넣지 않는다
    for (const s of available) if (!s.legend && s.rarity !== 'legend' && s.rarity !== 'mythic') byRarity[s.rarity].push(s)
    const pool = pickPool(byRarity, rarity)
    if (pool.length === 0) throw new Error(`no species for ${c.area}/${c.spot} at rod ${c.rodTier}`)
    species = pool[Math.floor(r2 * pool.length)]
  }

  const p = rng() ** (1.5 - Math.min(1.25, c.power + c.sizeBonus))
  const sizeCm = Math.round(species.minCm + p * (species.maxCm - species.minCm))
  const biteDelayMs = Math.round((1500 + rng() * 4500) * rod.biteScale * (spinner ? TACKLE_FX.spinnerBite : 1))
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

// ---------------------------------------------------------------- 도전과제
/** 과제 하나의 진행. seen은 distinct 과제가 센 어종 id. done은 한 번 true가 되면 되돌아가지 않는다 */
export type ChallengeProgress = { progress: number; seen?: string[]; done: boolean }
/** 잡은 물고기 하나와 던질 때의 지역·자리·조건 */
export type CatchFacts = { area: AreaId; spot: string; cond: Conditions; species: string; sizeCm: number; perfect: boolean }

/** 이 잡이가 과제 조건을 모두 만족하는가 (distinct의 "새 어종" 여부는 보지 않는다) */
export function challengeMatches(ch: Challenge, c: CatchFacts): boolean {
  const f = ch.filter
  if (ch.area !== c.area) return false
  if (f.spot !== undefined && f.spot !== c.spot) return false
  if (f.perfect && !c.perfect) return false
  if (f.weather !== undefined && f.weather !== c.cond.weather) return false
  if (f.night && !isNight(c.cond.gameMinute)) return false
  if (f.minSizePct !== undefined && sizePercentile(c.species, c.sizeCm) < f.minSizePct) return false
  return true
}

/** 잡이 하나로 과제 진행을 센다. 깬 과제는 건드리지 않는다. completed는 이번에 깬 과제 id(CHALLENGES 순서) */
export function progressChallenges(
  prev: Readonly<Record<string, ChallengeProgress>>,
  c: CatchFacts,
): { challenges: Record<string, ChallengeProgress>; completed: string[] } {
  const challenges: Record<string, ChallengeProgress> = { ...prev }
  const completed: string[] = []
  for (const ch of CHALLENGES) {
    const old = prev[ch.id]
    if (old?.done || !challengeMatches(ch, c)) continue
    let next: ChallengeProgress
    if (ch.filter.distinct) {
      const seen = old?.seen ?? []
      if (seen.includes(c.species)) continue
      const more = [...seen, c.species]
      next = { progress: more.length, seen: more, done: false }
    } else {
      next = { progress: (old?.progress ?? 0) + 1, done: false }
    }
    if (next.progress >= ch.count) {
      next.done = true
      completed.push(ch.id)
    }
    challenges[ch.id] = next
  }
  return { challenges, completed }
}

/** 그 지역 순간이동기가 켜져 있는가: 지역이 열려 있고 그 지역 과제를 깼다 */
export function teleporterOpen(state: Pick<State, 'areas' | 'challenges'>, area: AreaId): boolean {
  const ch = CHALLENGES.find((c) => c.area === area)
  return !!ch && state.areas.includes(area) && state.challenges[ch.id]?.done === true
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
  rodTier: RodTier
  bagTier: BagTier
  areas: AreaId[]
  bag: Fish[]
  dex: Record<string, { count: number; maxCm: number }>
  /** 이미 잡은 전설 어종 id */
  legends: string[]
  /** 산 찌(영구). 장착은 equipped */
  tackles: TackleId[]
  /** 장착한 찌. 칸 수(tackleSlots) 이하, 산 것만, 중복 없음 */
  equipped: TackleId[]
  /** 도전과제 진행(과제 id → 진행). 배포 뒤부터 센다 */
  challenges: Record<string, ChallengeProgress>
  /** 가진 옷 `부위:id`(영구, 중복 없음): 산 옷 + 조건을 채워 얻은 업적 옷. 무료 기본은 넣지 않는다 (logic.version 10) */
  wardrobe: string[]
  /** 입은 옷. 부위마다 가진 품목 */
  outfit: Outfit
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
  | { type: 'buyTackle'; id: string }
  | { type: 'equip'; ids: string[] }
  | { type: 'unlockArea'; area: string }
  | { type: 'teleport'; from: string; to: string }
  | { type: 'buyWear'; slot: string; id: string }
  | { type: 'wear'; slot: string; id: string }
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
  tackles: [],
  equipped: [],
  challenges: {},
  wardrobe: [],
  outfit: { ...DEFAULT_OUTFIT },
  pending: null,
})

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const knownTackle = (id: unknown): id is TackleId => typeof id === 'string' && TACKLES.some((t) => t.id === id)
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
    equipped: state.equipped,
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
  // 과제는 던질 때 저장한 지역·자리·조건으로 센다. 그 값이 없는(비정상) pending이면 과제만 건너뛴다
  const facts = catchFacts(p, a.perfect)
  const judged = facts ? progressChallenges(state.challenges, facts) : { challenges: state.challenges, completed: [] }
  return {
    state: { ...state, bag: [...state.bag, fish], dex, legends, challenges: judged.challenges, pending: null },
    result: judged.completed.length > 0 ? { caught: fish, completed: judged.completed } : { caught: fish },
  }
}

function catchFacts(p: Pending, perfect: boolean): CatchFacts | null {
  const raw = p as Partial<Pending>
  if (!AREAS.some((x) => x.id === raw.area) || typeof raw.spot !== 'string' || !isObj(raw.cond)) return null
  const cond = raw.cond as Conditions
  if (!isNum(cond.gameMinute) || typeof cond.weather !== 'string') return null
  return { area: raw.area as AreaId, spot: raw.spot, cond, species: p.species, sizeCm: p.sizeCm, perfect }
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

function buyTackle(state: State, a: Record<string, unknown>): Out {
  const t = TACKLES.find((x) => x.id === a.id)
  if (!t) return { error: 'bad_tackle' }
  if (state.tackles.includes(t.id)) return { error: 'already_owned' }
  if (state.gold < t.price) return { error: 'not_enough_gold' }
  return { state: { ...state, gold: state.gold - t.price, tackles: [...state.tackles, t.id] } }
}

function unlockArea(state: State, a: Record<string, unknown>): Out {
  const id = a.area
  // 프로토타입 키(__proto__ 등)가 걸리지 않게 자기 키만 본다
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(UNLOCKS, id)) return { error: 'bad_area' }
  const area = id as AreaId
  const u = UNLOCKS[area]!
  if (state.pending) return { error: 'busy' }
  if (state.areas.includes(area)) return { error: 'already_open' }
  if (state.gold < u.price) return { error: 'not_enough_gold' }
  return { state: { ...state, gold: state.gold - u.price, areas: [...state.areas, area] } }
}

/** 이동기가 있는 알려진 지역 id인가(자기 키만 본다: '__proto__' 같은 키가 걸리지 않게) */
function teleporterArea(id: unknown): id is AreaId {
  return typeof id === 'string' && AREAS.some((a) => a.id === id) && teleporterWorld(id as AreaId) !== null
}

// 화면이 알려 준 from을 믿는다(설계 §8.4). 둘 다 켜진 이동기이고 골드가 요금 이상이면 요금을 뺀다.
function teleport(state: State, a: Record<string, unknown>): Out {
  const { from, to } = a
  if (!teleporterArea(from) || !teleporterArea(to)) return { error: 'bad_teleporter' }
  if (from === to) return { error: 'same' }
  if (state.pending) return { error: 'busy' }
  if (!teleporterOpen(state, from) || !teleporterOpen(state, to)) return { error: 'not_open' }
  const fee = teleportFee(from, to)
  if (state.gold < fee) return { error: 'not_enough_gold' }
  return { state: { ...state, gold: state.gold - fee }, result: { from, to, fee } }
}

function equip(state: State, a: Record<string, unknown>): Out {
  if (state.pending) return { error: 'busy' }
  const ids = a.ids
  if (!Array.isArray(ids) || !ids.every(knownTackle) || new Set(ids).size !== ids.length) return { error: 'bad_tackle' }
  if (!ids.every((id) => state.tackles.includes(id))) return { error: 'not_owned' }
  if (ids.length > tackleSlots(state.rodTier)) return { error: 'too_many' }
  return { state: { ...state, equipped: [...ids] } }
}

// 옷 사기(설계 옷장 §5.2). 지갑이 들어오면 골드를 빼는 이 자리만 지갑으로 옮긴다(다른 낚시 구매와 같다).
function buyWear(state: State, a: Record<string, unknown>): Out {
  if (!isWearSlot(a.slot)) return { error: 'bad_wear' }
  const w = wearItem(a.slot, a.id)
  if (!w) return { error: 'bad_wear' }
  if (w.unlock) return { error: 'not_for_sale' }
  if (!isShopItem(w) || ownsWear(state, w.slot, w.id)) return { error: 'already_owned' }
  if (state.gold < w.price) return { error: 'not_enough_gold' }
  return {
    state: {
      ...state,
      gold: state.gold - w.price,
      wardrobe: [...state.wardrobe, wearKey(w.slot, w.id)],
      outfit: { ...state.outfit, [w.slot]: w.id },
    },
  }
}

// 옷 입기. 성능과 무관해서 낚시 중에도 된다
function wear(state: State, a: Record<string, unknown>): Out {
  if (!isWearSlot(a.slot)) return { error: 'bad_wear' }
  const w = wearItem(a.slot, a.id)
  if (!w) return { error: 'bad_wear' }
  if (!ownsWear(state, w.slot, w.id)) return { error: 'not_owned' }
  return { state: { ...state, outfit: { ...state.outfit, [w.slot]: w.id } } }
}

/** 조건을 채운 업적 옷을 wardrobe에 넣는다(한 번 얻으면 데이터가 늘어도 잃지 않게). 새로 얻은 게 없으면 같은 객체 */
function grantEarned(state: State): State {
  const earned = newlyEarned(state)
  return earned.length === 0 ? state : { ...state, wardrobe: [...state.wardrobe, ...earned] }
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
  // v4 이하에는 찌가 없다. 알려진 id만, 중복 없이. 장착은 산 것만, 칸 수까지(앞에서부터 남긴다)
  const uniqueTackles = (v: unknown): TackleId[] => (Array.isArray(v) ? [...new Set(v.filter(knownTackle))] : [])
  const tackles = uniqueTackles(raw.tackles)
  const equipped = uniqueTackles(raw.equipped).filter((id) => tackles.includes(id)).slice(0, tackleSlots(rodTier))
  // v7 이하에는 과제가 없다(배포 뒤부터 센다). 알려진 과제만, 진행은 0 이상 정수, seen은 distinct 과제의 알려진 어종만
  const challenges: State['challenges'] = {}
  if (isObj(raw.challenges)) {
    for (const ch of CHALLENGES) {
      if (!Object.prototype.hasOwnProperty.call(raw.challenges, ch.id)) continue
      const e = raw.challenges[ch.id]
      if (!isObj(e)) continue
      const entry: ChallengeProgress = { progress: isNum(e.progress) && e.progress >= 0 ? Math.floor(e.progress) : 0, done: e.done === true }
      if (ch.filter.distinct) {
        const seen = Array.isArray(e.seen) ? [...new Set(e.seen.filter(knownSpecies))] : []
        entry.progress = seen.length
        entry.seen = seen
      }
      challenges[ch.id] = entry
    }
  }
  // v9 이하에는 옷장이 없다. 알려진 상점 품목 키만 중복 없이. 입은 옷은 부위마다 가진 품목만, 아니면 기본값
  // wardrobe는 알려진 상점·업적 품목 키만(업적 옷은 저장된 것이 곧 소유). 그다음 지금 조건을 채운 업적 옷을 더한다(v9 세이브 포함)
  const ownable = new Set(WEAR.filter((w) => isShopItem(w) || w.unlock).map((w) => wearKey(w.slot, w.id)))
  const kept = Array.isArray(raw.wardrobe) ? [...new Set(raw.wardrobe.filter((k): k is string => typeof k === 'string' && ownable.has(k)))] : []
  const wardrobe = [...kept, ...newlyEarned({ wardrobe: kept, legends, challenges, dex })]
  const facts = { wardrobe, legends, challenges, dex }
  const rawOutfit = isObj(raw.outfit) ? raw.outfit : {}
  const outfit = { ...DEFAULT_OUTFIT }
  for (const slot of WEAR_SLOTS) {
    const id = Object.prototype.hasOwnProperty.call(rawOutfit, slot) ? rawOutfit[slot] : undefined
    if (typeof id === 'string' && ownsWear(facts, slot, id)) outfit[slot] = id
  }
  return {
    gold: nonNeg(raw.gold, base.gold),
    totalEarned: nonNeg(raw.totalEarned, base.totalEarned),
    rodTier,
    bagTier,
    areas,
    bag: bag.slice(0, bagSize(bagTier)),
    dex,
    legends,
    tackles,
    equipped,
    challenges,
    wardrobe,
    outfit,
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
  const done = CHALLENGES.filter((c) => state.challenges[c.id]?.done).length
  return [
    { key: 'total_earned', value: state.totalEarned },
    biggest,
    { key: 'dex', value: found, detail: `${found}/${SPECIES.length}` },
    { key: 'challenges', value: done, detail: `${done}/${CHALLENGES.length}` },
  ]
}

export const logic: WorldLogic<State, Action, View> = {
  // 9: 고급 장비(5·6단계 낚싯대, 50·60칸 가방). 세이브 형식은 8과 같다
  // 10: 옷장(wardrobe·outfit, buyWear·wear). v9 세이브는 빈 옷장·기본 옷차림
  version: 10,
  init,
  migrate,
  // action은 네트워크에서 온 JSON이라 unknown으로 다루고 필드마다 검증한다.
  apply(state, action: unknown, ctx) {
    const r = applyAction(state, action, ctx)
    // 행동으로 업적 조건을 채웠으면(잡기·과제 깨기 등) 그 자리에서 옷을 저장한다
    return 'error' in r ? r : { ...r, state: grantEarned(r.state) }
  },
  view: (state): View => ({ ...state, pending: state.pending && pendingView(state.pending) }),
  records,
  // 프로필 캐릭터(설계 옷장 §7): 입은 옷 JSON. 화면 Avatar가 읽는다
  avatar: (state) => JSON.stringify(state.outfit),
}

function applyAction(state: State, action: unknown, ctx: { now: number; rng: () => number }): Out {
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
    case 'buyTackle':
      return buyTackle(state, action)
    case 'equip':
      return equip(state, action)
    case 'unlockArea':
      return unlockArea(state, action)
    case 'teleport':
      return teleport(state, action)
    case 'buyWear':
      return buyWear(state, action)
    case 'wear':
      return wear(state, action)
    default:
      return { error: 'bad_action' }
  }
}

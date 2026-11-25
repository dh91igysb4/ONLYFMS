// 낚시 추첨·가격. 순수 함수만, 외부 의존 없음.
import type { WorldLogic, WorldRecord } from '../types.ts'
import { conditionsAt, isNight, type Conditions } from './clock.ts'
import {
  AREAS, areaHasSpecies, areaMinRod, BAGS, bagSize, BUFF_FX, BUFFS, CHALLENGES, DEFAULT_AREAS, HOOK_GRACE_MS, HOOK_WINDOW_MS, isBuffId,
  LEGEND_CHANCE, MIN_FIGHT_MS, MYTHIC_CHANCE, PIER_POWER_BONUS, RODS, SELL_DECAY, SPECIES, speciesAvailable, spotOpen, TACKLE_FX, tackleSlots, TACKLES,
  TIDE_GRACE_MIN, UNLOCKS,
  type AreaId, type BagTier, type BuffId, type Challenge, type Rod, type RodTier, type Species, type TackleId,
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
  /** 신화 버프. 서버 추첨에 쓰이는 건 imugi-scale(입질). 없으면 빈 목록 */
  buffs?: readonly BuffId[]
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

// rng 호출 순서 고정, 항상 5번: 전설·신화 판정(r0) → 등급(r1) → 등급 안 어종(r2) → 크기(r3) → 입질(r4).
// 전설·신화가 뽑혀도 r1·r2는 쓰지 않고 소비한다.
// 신화는 r0를 전설과 함께 쓴다: 후보 = 자격 있는 전설 ?? 자격 있는 신화(needs를 모두 잡음). 신화의 needs에 그 자리
// 전설이 모두 들어 있어(data.test) 둘이 동시에 후보일 수 없으므로, 신화가 없는 기존 판의 결과는 그대로다.
export function rollCatch(rng: () => number, c: CastCtx): Catch {
  const rod = RODS.find((r) => r.tier === c.rodTier)
  if (!rod) throw new Error(`unknown rod tier: ${c.rodTier}`)
  const available = SPECIES.filter((s) => speciesAvailable(s, c.area, c.spot, c.cond, c.rodTier))

  const spinner = c.equipped.includes('spinner')
  const curious = c.equipped.includes('curious')
  const r0 = rng()
  const r1 = rng()
  const r2 = rng()
  const special = specialCandidate(available, c)
  const chance = !special
    ? 0
    : special.rarity === 'mythic'
      ? MYTHIC_CHANCE * (curious ? TACKLE_FX.curiousMythic : 1)
      : LEGEND_CHANCE * (curious ? TACKLE_FX.curiousLegend : 1)

  let species: Species
  if (special && r0 < chance) {
    species = special
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
  const imugi = c.buffs?.includes('imugi-scale') ?? false
  const biteDelayMs = Math.round((1500 + rng() * 4500) * rod.biteScale * (spinner ? TACKLE_FX.spinnerBite : 1) * (imugi ? BUFF_FX.imugiBite : 1))
  return { species: species.id, sizeCm, biteDelayMs }
}

/** 이 판의 전설·신화 후보 하나: 자격 있는 전설(힘·안 잡음), 없으면 자격 있는 신화(힘·안 잡음·needs 모두 잡음) */
function specialCandidate(available: readonly Species[], c: CastCtx): Species | undefined {
  const eligible = (s: Species) => !!s.legend && c.power >= s.legend.power && !c.legends.includes(s.id)
  return (
    available.find((s) => s.rarity === 'legend' && eligible(s)) ??
    available.find((s) => s.rarity === 'mythic' && eligible(s) && (s.legend!.needs ?? []).every((id) => c.legends.includes(id)))
  )
}

export function sizePercentile(speciesId: string, sizeCm: number): number {
  const s = speciesById(speciesId)
  const p = (sizeCm - s.minCm) / (s.maxCm - s.minCm)
  return Math.min(1, Math.max(0, p))
}

/** 실제로 팔리는 값: 용왕의 여의주(dragon-pearl)면 물고기마다 ×1.08 반올림. 화면 예상가도 이 함수를 쓴다 */
export function sellPrice(f: { species: string; sizeCm: number; perfect: boolean }, buffs: readonly BuffId[] = []): number {
  const p = price(f.species, f.sizeCm, f.perfect)
  return buffs.includes('dragon-pearl') ? Math.round((p * BUFF_FX.pearlSell) / 100) : p
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
// 골드는 세이브에 없다(logic.version 14, 지갑 설계 §6): 플랫폼 지갑이 원본이고 ctx.gold로 읽고 apply의 gold로 증감한다.
export type State = {
  /** 판매로 번 골드 누계(기록 total_earned). 사이트 하루 상한으로 줄기 전 금액이다 */
  totalEarned: number
  rodTier: RodTier
  bagTier: BagTier
  areas: AreaId[]
  bag: Fish[]
  dex: Record<string, { count: number; maxCm: number }>
  /** 이미 잡은 전설·신화 어종 id (세이브당 한 마리) */
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
  /** 신화 버프(영구, 늘 켜짐). BUFFS 순서, 중복 없음. 신화를 잡는 resolve에서 더한다 */
  buffs: BuffId[]
  /** 오늘(KST) 판 마릿수(판매 마릿수 감쇠, v15). day가 오늘이 아니면 0으로 본다 */
  sold: Sold
  pending: Pending | null
}
export type Action =
  | { type: 'cast'; area: string; power: number; spot?: string }
  | { type: 'hook' }
  | { type: 'resolve'; success: boolean; perfect: boolean }
  | { type: 'sell' }
  | { type: 'lock'; index: number; locked: boolean }
  // fee: 화면이 본 환경부담금(v16). 서버 값과 다르면 price_changed. species·sizeCm이 그 칸과 다르면 bag_changed
  | { type: 'discard'; index: number; fee: number; species: string; sizeCm: number }
  // price: 화면이 본 가격(v15). 서버 가격과 다르면 price_changed — 배포 사이 옛 화면이 옛 가격을 보고 사지 않게
  | { type: 'buyRod'; tier: number; price: number }
  | { type: 'buyBag'; tier: number; price: number }
  | { type: 'buyTackle'; id: string }
  | { type: 'equip'; ids: string[] }
  | { type: 'unlockArea'; area: string; price: number }
  | { type: 'teleport'; from: string; to: string }
  | { type: 'buyWear'; slot: string; id: string }
  | { type: 'wear'; slot: string; id: string }
// pending의 어종·크기는 `hook` 뒤에만 내보낸다. 다시 던져 어종을 고르는 것을 막는다.
// buffs는 v11 서버부터 나간다: 옛 서버 응답에는 없으니 화면은 없으면 빈 목록으로 본다.
// gold는 지갑 잔액(ctx.gold). v13까지는 세이브의 골드였고 화면은 그대로 view.gold를 읽는다.
// sold는 v15 서버부터 나간다: 옛 서버 응답에는 없으니 화면은 없으면 0마리로 본다.
export type View = Omit<State, 'pending' | 'buffs' | 'sold'> & { pending: PendingView | null; buffs?: BuffId[]; sold?: Sold; gold: number }

type Out = { state: State; result?: unknown; gold?: number } | { error: string }
type Ctx = { now: number; rng: () => number; gold: number }

/** 세이브에 gold를 두던 마지막 버전. 이 버전 이하 세이브의 gold는 world 핸들러가 legacyGold로 지갑에 한 번 옮긴다 */
export const LAST_GOLD_IN_SAVE = 13

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
  buffs: [],
  sold: { day: '', n: 0 },
  pending: null,
})

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const knownTackle = (id: unknown): id is TackleId => typeof id === 'string' && TACKLES.some((t) => t.id === id)
const knownSpecies = (id: unknown): id is string => typeof id === 'string' && SPECIES.some((s) => s.id === id)

function cast(state: State, a: Record<string, unknown>, ctx: Ctx): Out {
  // 구버전 화면은 지역 'pier'를 보낸다
  const areaId = a.area === 'pier' ? 'village' : a.area
  const area = AREAS.find((x) => x.id === areaId)
  if (!area || !state.areas.includes(area.id) || !areaHasSpecies(area.id)) return { error: 'bad_area' }
  const spot = a.spot === undefined ? (area.id === 'village' ? 'shore' : area.spots[0]) : a.spot
  if (typeof spot !== 'string' || !area.spots.includes(spot)) return { error: 'bad_spot' }
  const cond = conditionsAt(ctx.now)
  const closed = castClosed(state, area.id, spot, cond.gameMinute)
  if (closed) return { error: closed }
  if (!isNum(a.power) || a.power < 0 || a.power > 1) return { error: 'bad_power' }
  if (state.bag.length >= bagSize(state.bagTier)) return { error: 'bag_full' }
  const c = rollCatch(ctx.rng, {
    rodTier: state.rodTier,
    power: a.power,
    sizeBonus: spot === 'pier' ? PIER_POWER_BONUS : 0,
    area: area.id,
    spot,
    cond,
    legends: state.legends,
    equipped: state.equipped,
    buffs: state.buffs ?? [],
  })
  const pending: Pending = { ...c, startedAt: ctx.now, hookedAt: null, area: area.id, spot, cond, power: a.power }
  return { state: { ...state, pending }, result: pendingView(pending) }
}

/**
 * 지역 최소 낚싯대(need_rod)와 물때 자리(spot_closed). 화면·서버 시계 차이를 봐주려고 TIDE_GRACE_MIN분 전에
 * 열려 있었어도 받는다(추첨은 실제 now 조건).
 */
function castClosed(state: State, area: AreaId, spot: string, gameMinute: number): 'need_rod' | 'spot_closed' | null {
  if (state.rodTier < areaMinRod(area)) return 'need_rod'
  if (!spotOpen(area, spot, gameMinute) && !spotOpen(area, spot, gameMinute - TIDE_GRACE_MIN)) return 'spot_closed'
  return null
}

/** 잡은 어종이 주는 신화 버프(아직 없을 때만). 버프 목록은 BUFFS 순서 */
function gainBuff(buffs: readonly BuffId[], speciesId: string): { buffs: BuffId[]; buff?: BuffId } {
  const b = speciesById(speciesId).legend?.buff
  if (!b || buffs.includes(b)) return { buffs: [...buffs] }
  return { buffs: orderBuffs([...buffs, b]), buff: b }
}
const orderBuffs = (ids: readonly BuffId[]): BuffId[] => BUFFS.map((b) => b.id).filter((id) => ids.includes(id))

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
  const gained = gainBuff(state.buffs ?? [], p.species)
  return {
    state: { ...state, bag: [...state.bag, fish], dex, legends, challenges: judged.challenges, buffs: gained.buffs, pending: null },
    result: {
      caught: fish,
      ...(judged.completed.length > 0 ? { completed: judged.completed } : {}),
      ...(gained.buff ? { buff: gained.buff } : {}),
    },
  }
}

function catchFacts(p: Pending, perfect: boolean): CatchFacts | null {
  const raw = p as Partial<Pending>
  if (!AREAS.some((x) => x.id === raw.area) || typeof raw.spot !== 'string' || !isObj(raw.cond)) return null
  const cond = raw.cond as Conditions
  if (!isNum(cond.gameMinute) || typeof cond.weather !== 'string') return null
  return { area: raw.area as AreaId, spot: raw.spot, cond, species: p.species, sizeCm: p.sizeCm, perfect }
}

// ---------------------------------------------------------------- 판매 마릿수 감쇠 (설계 2026-11-25, v15)
export type Sold = { day: string; n: number }
const KST_MS = 9 * 3600 * 1000
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** now(ms)의 KST 날짜 'YYYY-MM-DD' */
export function kstDay(now: number): string {
  return new Date(now + KST_MS).toISOString().slice(0, 10)
}

/** 오늘(KST) 판 마릿수. 저장된 날짜가 오늘이 아니면 0 */
export function soldToday(sold: Sold, now: number): number {
  return sold.day === kstDay(now) ? sold.n : 0
}

/** 오늘 nth번째(1부터) 판 물고기의 판매가 배율(%) */
export function sellRatePct(nth: number): number {
  for (const [upTo, pct] of SELL_DECAY) if (nth <= upTo) return pct
  return SELL_DECAY[SELL_DECAY.length - 1][1]
}

/** 오늘 이미 before마리 판 뒤 fish를 순서대로 팔 때의 합. 물고기마다 round(sellPrice × 배율 / 100). 화면 예상가도 이 함수를 쓴다 */
export function decayedSale(fish: readonly Pick<Fish, 'species' | 'sizeCm' | 'perfect'>[], buffs: readonly BuffId[], before: number): { earned: number; count: number } {
  let earned = 0
  fish.forEach((f, i) => {
    earned += Math.round((sellPrice(f, buffs) * sellRatePct(before + i + 1)) / 100)
  })
  return { earned, count: fish.length }
}

function parseSold(v: unknown): Sold {
  if (isObj(v) && typeof v.day === 'string' && DAY_RE.test(v.day) && isNum(v.n) && Number.isInteger(v.n) && v.n >= 0) return { day: v.day, n: v.n }
  return { day: '', n: 0 }
}

function sell(state: State, now: number): Out {
  // 잠긴 물고기는 팔지 않고 순서 그대로 남긴다
  const selling = state.bag.filter((f) => !f.locked)
  if (selling.length === 0) return { error: 'bag_empty' }
  const before = soldToday(state.sold, now)
  const { earned } = decayedSale(selling, state.buffs ?? [], before)
  return {
    state: {
      ...state,
      totalEarned: state.totalEarned + earned,
      bag: state.bag.filter((f) => f.locked),
      sold: { day: kstDay(now), n: before + selling.length },
    },
    result: { earned },
    gold: earned,
  }
}

/** 버리기 환경부담금(설계 2026-11-25-fishing-brag-discard): 판매가(감쇠 전, 버프 포함)의 10% 올림, 최소 1 G. 화면도 이 함수를 쓴다 */
export function discardFee(f: Pick<Fish, 'species' | 'sizeCm' | 'perfect'>, buffs: readonly BuffId[]): number {
  return Math.max(1, Math.ceil(sellPrice(f, buffs) / 10))
}

function discard(state: State, a: Record<string, unknown>, gold: number): Out {
  const i = a.index
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= state.bag.length) return { error: 'bad_action' }
  const f = state.bag[i]
  // 화면이 본 물고기와 다르면(다른 탭·응답 유실로 칸이 밀림) 버리지 않는다
  if (a.species !== f.species || a.sizeCm !== f.sizeCm) return { error: 'bag_changed' }
  if (f.locked) return { error: 'locked' }
  const fee = discardFee(f, state.buffs ?? [])
  if (a.fee !== fee) return { error: 'price_changed' }
  if (gold < fee) return { error: 'not_enough_gold' }
  return { state: { ...state, bag: state.bag.filter((_, j) => j !== i) }, result: { fee }, gold: -fee }
}

function lock(state: State, a: Record<string, unknown>): Out {
  const i = a.index
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= state.bag.length) return { error: 'bad_action' }
  if (typeof a.locked !== 'boolean') return { error: 'bad_action' }
  const { locked: _was, ...rest } = state.bag[i]
  const fish: Fish = a.locked ? { ...rest, locked: true } : rest
  return { state: { ...state, bag: state.bag.map((f, j) => (j === i ? fish : f)) } }
}

function buyRod(state: State, a: Record<string, unknown>, gold: number): Out {
  if (!Number.isInteger(a.tier) || a.tier !== state.rodTier + 1) return { error: 'bad_tier' }
  const rod = RODS.find((r) => r.tier === a.tier)
  if (!rod) return { error: 'bad_tier' }
  if (a.price !== rod.price) return { error: 'price_changed' }
  if (gold < rod.price) return { error: 'not_enough_gold' }
  return { state: { ...state, rodTier: rod.tier }, gold: -rod.price }
}

function buyBag(state: State, a: Record<string, unknown>, gold: number): Out {
  if (!Number.isInteger(a.tier) || a.tier !== state.bagTier + 1) return { error: 'bad_tier' }
  const bag = BAGS.find((b) => b.tier === a.tier)
  if (!bag) return { error: 'bad_tier' }
  if (a.price !== bag.price) return { error: 'price_changed' }
  if (gold < bag.price) return { error: 'not_enough_gold' }
  return { state: { ...state, bagTier: bag.tier }, gold: -bag.price }
}

function buyTackle(state: State, a: Record<string, unknown>, gold: number): Out {
  const t = TACKLES.find((x) => x.id === a.id)
  if (!t) return { error: 'bad_tackle' }
  if (state.tackles.includes(t.id)) return { error: 'already_owned' }
  if (gold < t.price) return { error: 'not_enough_gold' }
  return { state: { ...state, tackles: [...state.tackles, t.id] }, gold: -t.price }
}

function unlockArea(state: State, a: Record<string, unknown>, gold: number): Out {
  const id = a.area
  // 프로토타입 키(__proto__ 등)가 걸리지 않게 자기 키만 본다
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(UNLOCKS, id)) return { error: 'bad_area' }
  const area = id as AreaId
  const u = UNLOCKS[area]!
  if (state.pending) return { error: 'busy' }
  if (state.areas.includes(area)) return { error: 'already_open' }
  if (u.minRod !== undefined && state.rodTier < u.minRod) return { error: 'need_rod' }
  if (a.price !== u.price) return { error: 'price_changed' }
  if (gold < u.price) return { error: 'not_enough_gold' }
  return { state: { ...state, areas: [...state.areas, area] }, gold: -u.price }
}

/** 이동기가 있는 알려진 지역 id인가(자기 키만 본다: '__proto__' 같은 키가 걸리지 않게) */
function teleporterArea(id: unknown): id is AreaId {
  return typeof id === 'string' && AREAS.some((a) => a.id === id) && teleporterWorld(id as AreaId) !== null
}

// 화면이 알려 준 from을 믿는다(설계 §8.4). 둘 다 켜진 이동기이고 골드가 요금 이상이면 요금을 뺀다.
function teleport(state: State, a: Record<string, unknown>, gold: number): Out {
  const { from, to } = a
  if (!teleporterArea(from) || !teleporterArea(to)) return { error: 'bad_teleporter' }
  if (from === to) return { error: 'same' }
  if (state.pending) return { error: 'busy' }
  if (!teleporterOpen(state, from) || !teleporterOpen(state, to)) return { error: 'not_open' }
  const fee = teleportFee(from, to)
  if (gold < fee) return { error: 'not_enough_gold' }
  return { state, result: { from, to, fee }, gold: -fee }
}

function equip(state: State, a: Record<string, unknown>): Out {
  if (state.pending) return { error: 'busy' }
  const ids = a.ids
  if (!Array.isArray(ids) || !ids.every(knownTackle) || new Set(ids).size !== ids.length) return { error: 'bad_tackle' }
  if (!ids.every((id) => state.tackles.includes(id))) return { error: 'not_owned' }
  if (ids.length > tackleSlots(state.rodTier)) return { error: 'too_many' }
  return { state: { ...state, equipped: [...ids] } }
}

// 옷 사기(설계 옷장 §5.2). 다른 낚시 구매처럼 지갑에서 뺀다(logic.version 14).
function buyWear(state: State, a: Record<string, unknown>, gold: number): Out {
  if (!isWearSlot(a.slot)) return { error: 'bad_wear' }
  const w = wearItem(a.slot, a.id)
  if (!w) return { error: 'bad_wear' }
  if (w.unlock) return { error: 'not_for_sale' }
  if (!isShopItem(w) || ownsWear(state, w.slot, w.id)) return { error: 'already_owned' }
  if (gold < w.price) return { error: 'not_enough_gold' }
  return {
    gold: -w.price,
    state: {
      ...state,
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

/**
 * v13 이하 세이브에 들어 있던 골드(0 이상 정수, 소수는 내림). world 핸들러가 migrate 직전에 한 번 지갑으로 옮긴다
 * (장부 unique (user, 'migrate', 'fishing')가 두 번 들어가지 않게 지킨다). v14부터는 세이브에 골드가 없어 0.
 */
function legacyGold(raw: unknown, fromVersion: number): number {
  if (fromVersion > LAST_GOLD_IN_SAVE || !isObj(raw)) return 0
  const g = raw.gold
  return isNum(g) && g >= 0 ? Math.floor(g) : 0
}

// 옛 세이브의 gold는 읽지 않는다(legacyGold가 지갑으로 옮긴다).
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
  const buffs = migrateBuffs(raw.buffs, legends)
  return {
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
    buffs,
    sold: parseSold(raw.sold),
    pending: null,
  }
}

/** 버프 = 저장된 알려진 BuffId ∪ legends에 든 신화의 buff (v10 이하에는 없다: 전설 목록이 근거라 잃지 않는다) */
function migrateBuffs(saved: unknown, legends: readonly string[]): BuffId[] {
  const fromSave = Array.isArray(saved) ? saved.filter(isBuffId) : []
  const fromLegends = legends.flatMap((id) => {
    const b = SPECIES.find((s) => s.id === id)?.legend?.buff
    return b ? [b] : []
  })
  return orderBuffs([...fromSave, ...fromLegends])
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

/** 메인 미리보기용 열린 지역 기록의 키(game_records, detail = 쉼표로 이은 지역 id). 메인 미리보기 설계 §6 */
export const PREVIEW_AREAS_KEY = 'areas'

export const logic: WorldLogic<State, Action, View> = {
  // 9: 고급 장비(5·6단계 낚싯대, 50·60칸 가방). 세이브 형식은 8과 같다
  // 10: 옷장(wardrobe·outfit, buyWear·wear). v9 세이브는 빈 옷장·기본 옷차림
  // 11: 신화 등급·버프 상태(buffs), 물때 자리(spot_closed)·지역 최소 낚싯대(need_rod) 확인
  // 12: 갯벌·늪지 지역과 어종 19종(신화 이무기). 세이브 형식은 11과 같다(migrate가 새 지역·어종 id를 알게 됨)
  // 13: 산정 호수·난파선 앞바다 지역과 어종 19종(신화 천지 백룡·용왕). 세이브 형식은 12와 같다
  // 14: 골드를 플랫폼 지갑으로(지갑 설계 §6). 세이브에서 gold를 빼고, 판매·구매는 apply의 gold 증감, view.gold는 지갑 잔액.
  //     v13 이하 세이브의 gold는 legacyGold로 한 번 옮긴다(LAST_GOLD_IN_SAVE)
  // 15: 판매 마릿수 감쇠(세이브 sold, 옛 세이브는 0마리)와 후반 가격 조정(설계 2026-11-25-fishing-sell-decay-design.md)
  // 16: 버리기(discard, 환경부담금). 세이브 형식은 15와 같다(설계 2026-11-25-fishing-brag-discard-design.md)
  version: 17,
  wallet: true,
  init,
  migrate,
  legacyGold,
  // action은 네트워크에서 온 JSON이라 unknown으로 다루고 필드마다 검증한다.
  apply(state, action: unknown, ctx) {
    const r = applyAction(state, action, ctx)
    // 행동으로 업적 조건을 채웠으면(잡기·과제 깨기 등) 그 자리에서 옷을 저장한다
    return 'error' in r ? r : { ...r, state: grantEarned(r.state) }
  },
  view: (state, ctx): View => ({ ...state, gold: ctx.gold, pending: state.pending && pendingView(state.pending) }),
  records,
  // 프로필 캐릭터(설계 옷장 §7): 입은 옷 JSON. 화면 Avatar가 읽는다
  avatar: (state) => JSON.stringify(state.outfit),
  previewData: (state) => ({ [PREVIEW_AREAS_KEY]: state.areas.join(',') }),
  freeBonus,
}

/** 깬 도전과제의 미니게임 골드 보너스 합(%, 지갑 설계 §7.5). 열 개 다 깨면 400 */
export function freeBonus(state: Pick<State, 'challenges'>): number {
  return CHALLENGES.reduce((sum, c) => sum + (state.challenges[c.id]?.done === true ? c.freeBonusPct : 0), 0)
}

function applyAction(state: State, action: unknown, ctx: Ctx): Out {
  if (!isObj(action)) return { error: 'bad_action' }
  switch (action.type) {
    case 'cast':
      return cast(state, action, ctx)
    case 'hook':
      return hook(state, ctx.now)
    case 'resolve':
      return resolve(state, action, ctx.now)
    case 'sell':
      return sell(state, ctx.now)
    case 'lock':
      return lock(state, action)
    case 'discard':
      return discard(state, action, ctx.gold)
    case 'buyRod':
      return buyRod(state, action, ctx.gold)
    case 'buyBag':
      return buyBag(state, action, ctx.gold)
    case 'buyTackle':
      return buyTackle(state, action, ctx.gold)
    case 'equip':
      return equip(state, action)
    case 'unlockArea':
      return unlockArea(state, action, ctx.gold)
    case 'teleport':
      return teleport(state, action, ctx.gold)
    case 'buyWear':
      return buyWear(state, action, ctx.gold)
    case 'wear':
      return wear(state, action)
    default:
      return { error: 'bad_action' }
  }
}

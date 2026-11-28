// 낚시 추첨·가격. 순수 함수만, 외부 의존 없음.
import type { WorldLogic, WorldRecord } from '../types.ts'
import { conditionsAt, isNight, type Conditions } from './clock.ts'
import {
  AREAS, areaHasSpecies, areaMinRod, BAGS, bagSize, BUFF_FX, BUFFS, CHALLENGES, DEFAULT_AREAS, FRIDGE_SIZE, ISLE_LAYOUTS, type IsleLayoutId, HOOK_GRACE_MS, HOOK_WINDOW_MS, isBuffId,
  LEGEND_CHANCE, MAX_FIGHT_MS, MIN_FIGHT_MS, MYTHIC_CHANCE, PERFECT_MAX_MS, PIER_POWER_BONUS, RODS, SELL_DECAY, SPECIES, speciesAvailable, spotOpen, TACKLE_FX, tackleSlots, TACKLES,
  TIDE_GRACE_MIN, UNLOCKS,
  type AreaId, type BagTier, type BuffId, type Challenge, type Rod, type RodTier, type Species, type TackleId, SHOES, type ShoeTier } from './data.ts'
import { teleportFee, teleporterWorld } from './teleport.ts'
import { DEFAULT_OUTFIT, isShopItem, isWearSlot, newlyEarned, ownsWear, WEAR, WEAR_SLOTS, wearItem, wearKey, type Outfit } from './wardrobe.ts'
import { canDecorate, isleNodes } from './isle.ts'
import { ownedFacilities } from './facility.ts'
import { DECOS, DECO_MAX, isDecoId, type DecoId, type DecoPlaced } from './deco.ts'
import { HOUSE_MAX, ISLE_ZONES, MAT_CAP, TOOL_IDS, TOOL_MAX, clearCost, houseCost, houseNeedsCleared, toolCost, zoneNeeds, type Mats, type ToolId } from './isleEcon.ts'
import { FURNITURE, ROOM_MAX, canPlace, isFurnId, type FurnId, type Placed } from './home.ts'
/** 가구 종류마다 보관함 최대 개수 */
const FURN_CAP = 99
import type { NodeKind } from './map.ts'
import {
  ATTRACTOR_RARE, BAIT_KINDS, BAIT_RECIPES, AUTO_MEAL_MAX, LICENSE_PRICE, MAX_BAIT_BATCH, RECATCH_SALE_PCT, baitMatches, featureOn, isOrdinary, newEcon, researchChance, researchEligibility,
  type BaitKind, type Econ,
} from './research.ts'
import {
  ACTIVE_CAP_MS, CALM_ALT, DONATE_NEED, EXPANSIONS, GOLD_BUDGET, GOLD_PCT, MAT_AREAS, MAT_MAX, POTION_IDS, POTION_MAX_MS, POTION_MS, POTIONS, SPECIAL_IDS,
  ADV_CALM_ALT, ADV_DOSE_MS, ADV_DOSES, ADV_GOLD_BUDGET, ADV_POTIONS, STOCK_MAX, THEMES, luckRare, potionCap, projectById, stageC, type ThemeId,
  drainPotions, exhibitFee, expansionMats, extractYield, hasMats as hasAreaMats, minusMats as minusAreaMats, newGallery, potionOn, stageB, type Gallery, type MatArea, type PotionId,
} from './gallery.ts'

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
  /** 집어 미끼(P1): 일반 rare 가중치에 더 곱하는 배율. 없으면 1 */
  rareMult?: number
  /** 연구 낚시(P1): 대상과 이번 투척의 대상 입질 확률. 있으면 다른 전설·신화 최초 발견 후보는 없다 */
  research?: { target: string; chance: number }
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
  const special = c.research ? speciesById(c.research.target) : specialCandidate(available, c)
  const chance = !special
    ? 0
    : c.research
      ? c.research.chance
      : special.rarity === 'mythic'
      ? MYTHIC_CHANCE * (curious ? TACKLE_FX.curiousMythic : 1)
      : LEGEND_CHANCE * (curious ? TACKLE_FX.curiousLegend : 1)

  let species: Species
  if (special && r0 < chance) {
    species = special
  } else {
    const weight = (r: NormalRarity) => rod.weights[r] * (r === 'rare' ? (curious ? TACKLE_FX.curiousRare : 1) * (c.rareMult ?? 1) : 1)
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

/** 개체 판매가(P1): 연구로 다시 잡은 전설·신화(origin recatch)는 round(판매가 × 50%). 판매·버리기 요금·화면 예상가가 쓴다 */
export function fishSellPrice(f: { species: string; sizeCm: number; perfect: boolean; origin?: FishOrigin; bonus?: number }, buffs: readonly BuffId[] = []): number {
  const p = sellPrice(f, buffs)
  return (f.origin === 'recatch' ? Math.round((p * RECATCH_SALE_PCT) / 100) : p) + (f.bonus ?? 0)
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

/**
 * 그 지역 순간이동기가 켜져 있는가: 지역이 열려 있고 그 지역 과제를 깼다.
 * 과제가 없는 지역(마을회관)은 이동기가 있으면 열려 있는 것만으로 켜진다(v18).
 */
export function teleporterOpen(state: Pick<State, 'areas' | 'challenges'>, area: AreaId): boolean {
  if (!state.areas.includes(area)) return false
  const ch = CHALLENGES.find((c) => c.area === area)
  if (!ch) return teleporterWorld(area) !== null
  return state.challenges[ch.id]?.done === true
}

// ---------------------------------------------------------------- WorldLogic
/**
 * 물고기 출처(v26, 경제 설계 2026-11-27-fishing-economy-design.md §4.2). 판매가·전시 자격을 가른다.
 * legacy: v25 이하 세이브에 있던 개체, first: 최초로 잡은 전설·신화, normal: 그 밖의 새 개체, recatch: 연구로 다시 잡은 전설·신화(P1)
 */
export type FishOrigin = 'legacy' | 'first' | 'normal' | 'recatch'
export const FISH_ORIGINS: readonly FishOrigin[] = ['legacy', 'first', 'normal', 'recatch']
/**
 * id: 세이브 안에서 유일한 양의 정수(v26). 화면이 행동에 함께 보내 스테일 화면이 다른 개체를 건드리지 않게 한다.
 * locked: 가방에서 잠근 물고기. "전부 팔기"에서 빠진다. 잠기지 않았으면 필드가 없다.
 */
export type Fish = {
  id: number
  origin: FishOrigin
  species: string
  sizeCm: number
  perfect: boolean
  locked?: true
  /** 금전 포션이 잡을 때 붙인 판매 보너스(G, v27). 감쇠 전에 더한다 */
  bonus?: number
}
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
  /** 이 투척에 쓴 미끼(P1, v27). 없으면 맨 낚시 */
  bait?: BaitKind
  /** 연구 낚시 대상 어종(전설·신화 미끼일 때) */
  target?: string
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
  /** 신발 단계(v20). 걷기 속도는 화면이 shoeSpeed로 곱한다 */
  shoesTier: ShoeTier
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
  /** 마을회관 냉장고(보관만, FRIDGE_SIZE칸, v18). 잠금 표시는 그대로 둔다 */
  fridge: Fish[]
  /** 내 섬(v22): 고른 섬 모양. 처음 배를 타기 전엔 null */
  isle: IsleState | null
  pending: Pending | null
  /** 다음 물고기 id(v26). 가방·냉장고의 어떤 id보다 크다 */
  nextFishId: number
  /** 경제 P1(v27): 어분·미끼·연구 해금·대상별 연구 보장 카운터 */
  econ: Econ
  /** 경제 P2(v27): 기증·전시·지역 재료·포션·전시관 확장 */
  gallery: Gallery
}
/** 버리는 곳(v18): 가방(어디서나, 50%)·마을회관 쓰레기통(5%) */
export type DiscardAt = 'bag' | 'trash'
export type Action =
  | { type: 'cast'; area: string; power: number; spot?: string; bait?: BaitKind; target?: string }
  // 경제 P1(v27, 기능 플래그): 일반 물고기 → 어분, 미끼 만들기(price는 화면이 본 골드), 연구 해금
  | { type: 'grind'; items: { index: number; id?: number }[] }
  | { type: 'makeBait'; kind: BaitKind; price: number; count?: number }
  | { type: 'setAutoMeal'; price: number | null }
  | { type: 'buyLicense'; price: number }
  // 경제 P2(v27, 플래그 exhibit·alchemy): 재포획 기증, 영구 전시, 지역 재료 추출, 포션 만들어 마시기, 전시관 확장
  | { type: 'donate'; index: number; id?: number }
  | { type: 'exhibit'; species: string; price: number }
  | { type: 'extract'; items: { index: number; id?: number }[] }
  | { type: 'brew'; potion: PotionId; price: number; alt?: boolean; adv?: boolean }
  // 경제 P3(C단계 제작법으로 만든 병 마시기)·P4(완료 후 목표 사기, 테마 적용)
  | { type: 'drink'; potion: PotionId }
  | { type: 'buyProject'; id: string; price: number }
  | { type: 'setTheme'; theme: ThemeId | null }
  | { type: 'expand'; stage: number; price: number }
  | { type: 'hook' }
  | { type: 'resolve'; success: boolean; perfect: boolean }
  | { type: 'sell' }
  | { type: 'lock'; index: number; id?: number; locked: boolean }
  // fee: 화면이 본 환경부담금(v16). 서버 값과 다르면 price_changed. species·sizeCm이 그 칸과 다르면 bag_changed
  | { type: 'discard'; index: number; id?: number; fee: number; species: string; sizeCm: number; at?: DiscardAt }
  // 여러 마리 한 번에(v21): fee는 합계. 하나라도 틀리면 아무것도 버리지 않는다
  | { type: 'discardMany'; items: { index: number; id?: number; species: string; sizeCm: number }[]; fee: number; at?: DiscardAt }
  // 마을회관 냉장고(v18): species·sizeCm이 그 칸과 다르면 bag_changed / fridge_changed
  | { type: 'store'; index: number; id?: number; species: string; sizeCm: number }
  | { type: 'takeOut'; index: number; id?: number; species: string; sizeCm: number }
  // price: 화면이 본 가격(v15). 서버 가격과 다르면 price_changed — 배포 사이 옛 화면이 옛 가격을 보고 사지 않게
  | { type: 'buyRod'; tier: number; price: number }
  | { type: 'buyBag'; tier: number; price: number }
  | { type: 'buyShoes'; tier: number; price: number }
  | { type: 'buyTackle'; id: string }
  | { type: 'equip'; ids: string[] }
  | { type: 'unlockArea'; area: string; price: number }
  | { type: 'teleport'; from: string; to: string }
  | { type: 'buyWear'; slot: string; id: string }
  | { type: 'wear'; slot: string; id: string }
  // 내 섬(v22): 섬 모양 고르기(한 번만, 무료)
  | { type: 'isleChoose'; layout: string }
  // 내 섬 B(v23): 자원 칸 캐기(하루 한 번), 도구 올리기, 다음 구역 개간
  | { type: 'gather'; id: string }
  | { type: 'craft'; tool: string; tier: number; price: number }
  | { type: 'clear'; zone: number; price: number }
  // 내 섬 C(v24): 집 짓기, 가구 만들기·놓기·치우기
  | { type: 'build'; level: number; price: number }
  | { type: 'makeFurn'; id: string; price: number }
  | { type: 'place'; id: string; tx: number; ty: number }
  | { type: 'pickUp'; tx: number; ty: number }
  // 내 섬 D(v25): 바깥 꾸미기 만들기·놓기·치우기
  | { type: 'makeDeco'; id: string; price: number }
  | { type: 'decorate'; id: string; tx: number; ty: number }
  | { type: 'undecorate'; tx: number; ty: number }
// pending의 어종·크기는 `hook` 뒤에만 내보낸다. 다시 던져 어종을 고르는 것을 막는다.
// buffs는 v11 서버부터 나간다: 옛 서버 응답에는 없으니 화면은 없으면 빈 목록으로 본다.
// gold는 지갑 잔액(ctx.gold). v13까지는 세이브의 골드였고 화면은 그대로 view.gold를 읽는다.
// sold는 v15 서버부터 나간다: 옛 서버 응답에는 없으니 화면은 없으면 0마리로 본다.
// shoesTier는 v20, isle은 v22 서버부터 나간다: 옛 서버 응답에는 없으니 화면은 없으면 기본 장화(1)·섬 없음(null)으로 본다.
/** 내 섬 상태(v22 A: layout, v23 B: 개간·도구·재료·오늘 캔 칸) */
export type IsleState = {
  layout: IsleLayoutId
  /** 치운 구역 수 0..ISLE_ZONES(순서대로) */
  cleared: number
  /** 도구 단계 1..TOOL_MAX(처음 1) */
  tools: Record<ToolId, number>
  /** 재료 0..MAT_CAP. 팔 수 없다 */
  mats: Mats
  /** 오늘(KST) 캔 자원 칸 id */
  gathered: { day: string; ids: string[] }
  /** 집 단계 0..HOUSE_MAX(v24, 0 텐트) */
  house: number
  /** 만들고 놓지 않은 가구 개수(0 없는 키는 지운다) */
  furniture: Partial<Record<FurnId, number>>
  /** 집 안 놓인 가구 */
  placed: Placed[]
  /** 만들고 놓지 않은 바깥 꾸미기 개수(v25) */
  decoBox: Partial<Record<DecoId, number>>
  /** 섬에 놓인 바깥 꾸미기 */
  deco: DecoPlaced[]
}
export const newIsle = (layout: IsleLayoutId): IsleState => ({
  layout, cleared: 0, tools: { axe: 1, pick: 1, shovel: 1 }, mats: { wood: 0, stone: 0, iron: 0 }, gathered: { day: '', ids: [] },
  house: 0, furniture: {}, placed: [], decoBox: {}, deco: [],
})
// econ은 v27 서버부터 나간다: 옛 서버 응답에는 없으니 화면은 없으면 newEcon()으로 본다.
export type View = Omit<State, 'pending' | 'buffs' | 'sold' | 'fridge' | 'shoesTier' | 'isle' | 'nextFishId' | 'econ' | 'gallery'> & { pending: PendingView | null; buffs?: BuffId[]; sold?: Sold; fridge?: Fish[]; shoesTier?: ShoeTier; isle?: State['isle']; econ?: Econ; gallery?: Gallery; gold: number }

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
  shoesTier: 1,
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
  fridge: [],
  isle: null,
  pending: null,
  nextFishId: 1,
  econ: newEcon(),
  gallery: newGallery(),
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
  const used = castBait(state, a, area.id, spot)
  if ('error' in used) return used
  const { bait, target } = used
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
    ...rareMultOf(state, bait),
    ...(target ? { research: { target, chance: researchChance(target, state.econ.pity[target] ?? 0, state.equipped.includes('curious')) } } : {}),
  })
  const pending: Pending = { ...c, startedAt: ctx.now, hookedAt: null, area: area.id, spot, cond, power: a.power, ...(bait ? { bait } : {}), ...(target ? { target } : {}) }
  // 유효 투척이면 미끼 1개를 쓰고, 연구 대상의 보장 카운터를 1 올린다(놓쳐도 유지, 대상을 잡으면 resolve가 0으로)
  const econ: Econ = !bait
    ? state.econ
    : {
        ...state.econ,
        baits: { ...state.econ.baits, [bait]: state.econ.baits[bait] - 1 },
        pity: target ? { ...state.econ.pity, [target]: (state.econ.pity[target] ?? 0) + 1 } : state.econ.pity,
      }
  return { state: { ...state, pending, econ }, result: pendingView(pending) }
}

/** 일반 rare 가중치 배율: 집어 미끼 ×1.2, 행운 포션 ×1.2(곱해 ×1.44). 1이면 넣지 않는다 */
function rareMultOf(state: State, bait: BaitKind | undefined): { rareMult?: number } {
  const m = (bait === 'attractor' ? ATTRACTOR_RARE : 1) * (featureOn('alchemy') && potionOn(state.gallery, 'luck') ? luckRare(state.gallery) : 1)
  return m === 1 ? {} : { rareMult: m }
}

/** cast의 미끼(P1): 없으면 맨 낚시. 거절(플래그 꺼짐·미끼 없음·자격 없음)이면 미끼를 쓰지 않는다 */
function castBait(state: State, a: Record<string, unknown>, area: AreaId, spot: string): { bait?: BaitKind; target?: string } | { error: string } {
  if (a.bait === undefined) return {}
  const bait = a.bait
  if (typeof bait !== 'string' || !BAIT_KINDS.includes(bait as BaitKind)) return { error: 'bad_action' }
  const kind = bait as BaitKind
  if (!featureOn(kind === 'attractor' ? 'bait' : 'research')) return { error: 'feature_off' }
  if (state.econ.baits[kind] < 1) return { error: 'no_bait' }
  if (kind === 'attractor') return { bait: kind }
  if (!state.econ.license) return { error: 'no_license' }
  if (typeof a.target !== 'string' || !baitMatches(kind, a.target)) return { error: 'bad_target' }
  const why = researchEligibility(a.target, { legends: state.legends, area, spot, rodTier: state.rodTier, power: a.power as number })
  if (why) return { error: why }
  return { bait: kind, target: a.target }
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
  // 포션 활동 시간(§6.3 잠정): 투척에서 거두기까지, 한 번에 최대 ACTIVE_CAP_MS
  const gallery0 = { ...state.gallery, potions: drainPotions(state.gallery.potions, Math.max(0, Math.min(ACTIVE_CAP_MS, now - p.startedAt))) }
  if (!a.success) return { state: { ...state, pending: null, gallery: gallery0 }, result: { caught: null } }
  if (p.hookedAt == null) return { error: 'not_hooked' }
  if (now < p.hookedAt + MIN_FIGHT_MS) return { error: 'too_early' }
  // 서버 싸움 시간 검사(§6.1): 너무 늦은 성공은 놓친 것, 늦은 퍼펙트는 일반 포획
  if (now > p.hookedAt + MAX_FIGHT_MS) return { state: { ...state, pending: null, gallery: gallery0 }, result: { caught: null, rejected: 'fight_time' } }
  const perfect = a.perfect && now <= p.hookedAt + PERFECT_MAX_MS
  const isLegend = !!speciesById(p.species).legend
  // 연구 낚시로 대상을 잡았으면 recatch(판매가 50%), 대상 보장 카운터는 0. 놓치면(위 success false) 카운터 유지
  const recatch = isLegend && p.target === p.species
  // 전설·신화는 실수로 팔리지 않게 잠근 채 넣는다 (가방에서 풀 수 있다)
  const fish: Fish = {
    id: state.nextFishId,
    origin: recatch ? 'recatch' : isLegend ? 'first' : 'normal',
    species: p.species,
    sizeCm: p.sizeCm,
    perfect,
    ...(isLegend ? { locked: true as const } : {}),
  }
  const prev = state.dex[p.species]
  // 자동 어분(v30): 기준 판매가 이하 일반 물고기는 가방 대신 어분 1개. 처음 잡은 어종과 최대 크기 기록 갱신은 남긴다
  const autoMeal = featureOn('bait') && state.econ.autoMeal !== undefined && !isLegend && isOrdinary(p.species)
    && prev !== undefined && p.sizeCm <= prev.maxCm && fishSellPrice(fish, state.buffs ?? []) <= state.econ.autoMeal
  // 금전 포션(이 투척 동안 켜져 있었으면): 일반 개체에 판매가 15% 보너스, 남은 예산까지(어분이 될 물고기는 쓰지 않는다)
  let gallery = gallery0
  if (!autoMeal && !isLegend && featureOn('alchemy') && potionOn(state.gallery, 'gold') && state.gallery.goldBudget > 0) {
    const bonus = Math.min(state.gallery.goldBudget, Math.round((fishSellPrice(fish, state.buffs ?? []) * GOLD_PCT) / 100))
    if (bonus > 0) {
      fish.bonus = bonus
      gallery = { ...gallery, goldBudget: state.gallery.goldBudget - bonus }
    }
  }
  const dex = {
    ...state.dex,
    [p.species]: { count: (prev?.count ?? 0) + 1, maxCm: Math.max(prev?.maxCm ?? 0, p.sizeCm) },
  }
  const legends = isLegend && !state.legends.includes(p.species) ? [...state.legends, p.species] : state.legends
  // 과제는 던질 때 저장한 지역·자리·조건으로 센다. 그 값이 없는(비정상) pending이면 과제만 건너뛴다
  const facts = catchFacts(p, perfect)
  const judged = facts ? progressChallenges(state.challenges, facts) : { challenges: state.challenges, completed: [] }
  const gained = gainBuff(state.buffs ?? [], p.species)
  let econ = state.econ
  if (recatch) {
    const { [p.species]: _done, ...pity } = state.econ.pity
    econ = { ...state.econ, pity }
  }
  if (autoMeal) econ = { ...econ, meal: econ.meal + 1 }
  return {
    state: { ...state, bag: autoMeal ? state.bag : [...state.bag, fish], nextFishId: state.nextFishId + 1, dex, legends, challenges: judged.challenges, buffs: gained.buffs, pending: null, econ, gallery },
    result: {
      caught: fish,
      ...(autoMeal ? { autoMeal: true } : {}),
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
export function decayedSale(fish: readonly (Pick<Fish, 'species' | 'sizeCm' | 'perfect'> & { origin?: FishOrigin })[], buffs: readonly BuffId[], before: number): { earned: number; count: number } {
  let earned = 0
  fish.forEach((f, i) => {
    earned += Math.round((fishSellPrice(f, buffs) * sellRatePct(before + i + 1)) / 100)
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

/**
 * 버리기 환경부담금(마을회관 설계 §5, v18): 판매가(감쇠 전, 버프 포함)의 가방 50%·쓰레기통 5% 올림, 최소 1 G.
 * 화면도 이 함수를 쓴다.
 */
export function discardFee(f: Pick<Fish, 'species' | 'sizeCm' | 'perfect'> & { origin?: FishOrigin }, buffs: readonly BuffId[], at: DiscardAt = 'bag'): number {
  return Math.max(1, Math.ceil(fishSellPrice(f, buffs) / (at === 'trash' ? 20 : 2)))
}

function discard(state: State, a: Record<string, unknown>, gold: number): Out {
  const i = a.index
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= state.bag.length) return { error: 'bad_action' }
  const f = state.bag[i]
  // 화면이 본 물고기와 다르면(다른 탭·응답 유실로 칸이 밀림) 버리지 않는다
  if (a.species !== f.species || a.sizeCm !== f.sizeCm || !sameId(a.id, f)) return { error: 'bag_changed' }
  if (f.locked) return { error: 'locked' }
  if (a.at !== undefined && a.at !== 'bag' && a.at !== 'trash') return { error: 'bad_action' }
  const fee = discardFee(f, state.buffs ?? [], a.at === 'trash' ? 'trash' : 'bag')
  if (a.fee !== fee) return { error: 'price_changed' }
  if (gold < fee) return { error: 'not_enough_gold' }
  return { state: { ...state, bag: state.bag.filter((_, j) => j !== i) }, result: { fee }, gold: -fee }
}

const validIndex = (i: unknown, len: number): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < len
/** 화면이 물고기 id를 보냈으면 그 칸의 개체와 같아야 한다. 안 보냈으면(v25 화면) 위치·어종·크기만 본다 */
const sameId = (id: unknown, f: Fish): boolean => id === undefined || id === f.id

/**
 * 여러 마리 한 번에 버리기(v21). 요청 한 번(마리마다 보내면 요청이 많아진다). 모두 검사하고 하나라도 틀리면 아무것도 버리지 않는다.
 * fee는 화면이 본 합계(마리마다 discardFee를 더한 값)
 */
function discardMany(state: State, a: Record<string, unknown>, gold: number): Out {
  if (!Array.isArray(a.items) || a.items.length === 0) return { error: 'bad_action' }
  if (a.at !== undefined && a.at !== 'bag' && a.at !== 'trash') return { error: 'bad_action' }
  const at: DiscardAt = a.at === 'trash' ? 'trash' : 'bag'
  const picked = new Set<number>()
  let fee = 0
  for (const it of a.items as unknown[]) {
    if (!isObj(it) || !validIndex(it.index, state.bag.length) || picked.has(it.index)) return { error: 'bad_action' }
    const f = state.bag[it.index]
    if (it.species !== f.species || it.sizeCm !== f.sizeCm || !sameId(it.id, f)) return { error: 'bag_changed' }
    if (f.locked) return { error: 'locked' }
    picked.add(it.index)
    fee += discardFee(f, state.buffs ?? [], at)
  }
  if (a.fee !== fee) return { error: 'price_changed' }
  if (gold < fee) return { error: 'not_enough_gold' }
  return { state: { ...state, bag: state.bag.filter((_, j) => !picked.has(j)) }, result: { fee, n: picked.size }, gold: -fee }
}

/** 가방 칸 → 냉장고 끝(잠금 유지) */
function store(state: State, a: Record<string, unknown>): Out {
  if (state.pending) return { error: 'busy' }
  if (!validIndex(a.index, state.bag.length)) return { error: 'bad_action' }
  const f = state.bag[a.index]
  if (a.species !== f.species || a.sizeCm !== f.sizeCm || !sameId(a.id, f)) return { error: 'bag_changed' }
  if (state.fridge.length >= FRIDGE_SIZE) return { error: 'fridge_full' }
  const i = a.index
  return { state: { ...state, bag: state.bag.filter((_, j) => j !== i), fridge: [...state.fridge, f] } }
}

/** 냉장고 칸 → 가방 끝 */
function takeOut(state: State, a: Record<string, unknown>): Out {
  if (state.pending) return { error: 'busy' }
  if (!validIndex(a.index, state.fridge.length)) return { error: 'bad_action' }
  const f = state.fridge[a.index]
  if (a.species !== f.species || a.sizeCm !== f.sizeCm || !sameId(a.id, f)) return { error: 'fridge_changed' }
  if (state.bag.length >= bagSize(state.bagTier)) return { error: 'bag_full' }
  const i = a.index
  return { state: { ...state, fridge: state.fridge.filter((_, j) => j !== i), bag: [...state.bag, f] } }
}

function lock(state: State, a: Record<string, unknown>): Out {
  const i = a.index
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= state.bag.length) return { error: 'bad_action' }
  if (typeof a.locked !== 'boolean') return { error: 'bad_action' }
  if (!sameId(a.id, state.bag[i])) return { error: 'bag_changed' }
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

function buyShoes(state: State, a: Record<string, unknown>, gold: number): Out {
  if (!Number.isInteger(a.tier) || a.tier !== state.shoesTier + 1) return { error: 'bad_tier' }
  const shoes = SHOES.find((s) => s.tier === a.tier)
  if (!shoes) return { error: 'bad_tier' }
  if (a.price !== shoes.price) return { error: 'price_changed' }
  if (gold < shoes.price) return { error: 'not_enough_gold' }
  return { state: { ...state, shoesTier: shoes.tier }, gold: -shoes.price }
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
  const fishList = (v: unknown): Fish[] => {
    const out: Fish[] = []
    if (!Array.isArray(v)) return out
    for (const f of v) {
      if (isObj(f) && knownSpecies(f.species) && isNum(f.sizeCm) && typeof f.perfect === 'boolean') {
        // v4까지는 잠금이 없었다: 가방에 있던 전설은 잠가 둔다. v5부터는 저장된 잠금 그대로.
        const locked = fromVersion < 5 ? !!speciesById(f.species).legend : f.locked === true
        // v25 이하 개체는 모두 legacy. id는 아래 numberFish가 붙인다(v26부터는 저장된 id·origin을 먼저 살린다)
        const origin: FishOrigin = fromVersion >= FISH_ID_VERSION && FISH_ORIGINS.includes(f.origin as FishOrigin) ? (f.origin as FishOrigin) : 'legacy'
        const id = fromVersion >= FISH_ID_VERSION && isNum(f.id) ? f.id : 0
        const bonus = fromVersion >= 27 && isNum(f.bonus) && Number.isInteger(f.bonus) && f.bonus > 0 ? f.bonus : 0
        out.push({ id, origin, species: f.species, sizeCm: f.sizeCm, perfect: f.perfect, ...(locked ? { locked: true as const } : {}), ...(bonus ? { bonus } : {}) })
      }
    }
    return out
  }
  const bag = fishList(raw.bag)
  // v17 이하에는 냉장고가 없다
  const fridge = fishList(raw.fridge).slice(0, FRIDGE_SIZE)
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
  const numbered = numberFish(bag.slice(0, bagSize(bagTier)), fridge, fromVersion >= FISH_ID_VERSION ? raw.nextFishId : undefined)
  return {
    totalEarned: nonNeg(raw.totalEarned, base.totalEarned),
    rodTier,
    bagTier,
    shoesTier: SHOES.some((x) => x.tier === raw.shoesTier) ? (raw.shoesTier as ShoeTier) : base.shoesTier,
    areas,
    bag: numbered.bag,
    dex,
    legends,
    tackles,
    equipped,
    challenges,
    wardrobe,
    outfit,
    buffs,
    sold: parseSold(raw.sold),
    fridge: numbered.fridge,
    // v21 이하에는 섬이 없다. 모르는 모양도 null(다시 고른다)
    isle: migrateIsle(raw.isle),
    pending: migratePending(raw.pending, fromVersion),
    nextFishId: numbered.nextFishId,
    econ: fromVersion >= ECON_VERSION ? migrateEcon(raw.econ, legends) : newEcon(),
    gallery: fromVersion >= ECON_VERSION ? migrateGallery(raw.gallery, legends) : newGallery(),
  }
}

/** v27 gallery: 알려진 칸만. 전시·기증은 발견한 13종만, 재료·시간·예산은 범위 안 정수 */
function migrateGallery(raw: unknown, legends: readonly string[]): Gallery {
  const base = newGallery()
  if (!isObj(raw)) return base
  const int = (v: unknown, max: number) => (isNum(v) && Number.isInteger(v) && v > 0 ? Math.min(v, max) : 0)
  const exhibits = Array.isArray(raw.exhibits) ? [...new Set(raw.exhibits.filter((id): id is string => typeof id === 'string' && SPECIAL_IDS.includes(id) && legends.includes(id)))] : []
  const donated: Gallery['donated'] = {}
  if (isObj(raw.donated)) for (const [id, n] of Object.entries(raw.donated)) if (SPECIAL_IDS.includes(id) && legends.includes(id) && !exhibits.includes(id) && int(n, DONATE_NEED) > 0) donated[id] = int(n, DONATE_NEED)
  const mats: Gallery['mats'] = {}
  if (isObj(raw.mats)) for (const a of MAT_AREAS) if (int(raw.mats[a], MAT_MAX) > 0) mats[a as MatArea] = int(raw.mats[a], MAT_MAX)
  const potions: Gallery['potions'] = {}
  if (isObj(raw.potions)) for (const id of POTION_IDS) if (int(raw.potions[id], 2 * POTION_MAX_MS) > 0) potions[id] = int(raw.potions[id], 2 * POTION_MAX_MS)
  const stock: Gallery['stock'] = {}
  if (isObj(raw.stock)) for (const id of POTION_IDS) if (int(raw.stock[id], STOCK_MAX) > 0) stock[id] = int(raw.stock[id], STOCK_MAX)
  const projects = Array.isArray(raw.projects) ? [...new Set(raw.projects.filter((id): id is string => typeof id === 'string' && !!projectById(id)))] : []
  const theme = typeof raw.theme === 'string' && projects.includes(`${raw.theme}-bg`) ? (raw.theme as ThemeId) : null
  return { donated, exhibits, mats, potions, goldBudget: int(raw.goldBudget, 2 * ADV_GOLD_BUDGET), expansions: int(raw.expansions, EXPANSIONS.length), stock, projects, theme }
}

/** 경제 P1이 생긴 버전 */
const ECON_VERSION = 27

/** v27 이상 econ: 알려진 칸만, 음이 아닌 정수만. 보장 카운터는 발견한 전설·신화만 */
function migrateEcon(raw: unknown, legends: readonly string[]): Econ {
  const base = newEcon()
  if (!isObj(raw)) return base
  const count = (v: unknown) => (isNum(v) && Number.isInteger(v) && v >= 0 ? v : 0)
  const baits = isObj(raw.baits) ? raw.baits : {}
  const pity: Econ['pity'] = {}
  if (isObj(raw.pity)) for (const [id, n] of Object.entries(raw.pity)) if (legends.includes(id) && count(n) > 0) pity[id] = count(n)
  return {
    meal: count(raw.meal),
    baits: { attractor: count(baits.attractor), legend: count(baits.legend), mythic: count(baits.mythic) },
    license: raw.license === true,
    pity,
    ...(isNum(raw.autoMeal) && Number.isInteger(raw.autoMeal) && raw.autoMeal >= 1 && raw.autoMeal <= AUTO_MEAL_MAX ? { autoMeal: raw.autoMeal } : {}),
  }
}

/** 물고기 id·출처가 생긴 버전 */
const FISH_ID_VERSION = 26

/**
 * 가방 → 냉장고 순서로 물고기 id를 정리한다(v26). 저장된 id가 양의 정수이고 앞에서 안 쓰였으면 그대로,
 * 아니면(v25 이하·깨진 값·중복) 새 번호를 붙인다. 새 번호는 저장된 nextFishId와 남은 id 중 큰 값 다음부터라
 * 두 번 migrate해도 같은 결과이고, 지운 개체의 번호를 다시 쓰지 않는다.
 */
function numberFish(bag: Fish[], fridge: Fish[], savedNext: unknown): { bag: Fish[]; fridge: Fish[]; nextFishId: number } {
  const all = [...bag, ...fridge]
  const valid = (id: number) => Number.isSafeInteger(id) && id > 0
  const seen = new Set<number>()
  const keep = all.map((f) => {
    if (!valid(f.id) || seen.has(f.id)) return false
    seen.add(f.id)
    return true
  })
  let next = Math.max(1, isNum(savedNext) && Number.isSafeInteger(savedNext) ? savedNext : 1, ...[...seen].map((id) => id + 1))
  const fixed = all.map((f, i) => (keep[i] ? f : { ...f, id: next++ }))
  return { bag: fixed.slice(0, bag.length), fridge: fixed.slice(bag.length), nextFishId: next }
}

/**
 * 놓인 꾸미기를 지금 섬 상태 기준으로 순서대로 다시 놓아 본다(canDecorate). 안 되는 것은 보관함으로(상한 없이 — 잃지 않게).
 * migrate와 개간(clear) 뒤에 쓴다: 개간으로 새로 생긴 땅·자원 칸을 막는 꾸미기가 남지 않게.
 */
function replayDeco(shape: { layout: IsleLayoutId; cleared: number; house: number }, list: readonly DecoPlaced[], box: Partial<Record<DecoId, number>>) {
  const decoBox = { ...box }
  const deco: DecoPlaced[] = []
  for (const d of list) {
    if (deco.length < DECO_MAX && canDecorate({ ...shape, deco }, d.tx, d.ty, d.id)) deco.push({ id: d.id, tx: d.tx, ty: d.ty })
    else decoBox[d.id] = (decoBox[d.id] ?? 0) + 1
  }
  return { deco, decoBox }
}

/** 내 섬: v21 이하에는 없다(null), v22는 {layout}만(B 기본값), 모르는 모양은 null. 깨진 값은 기본값·범위 안으로 */
function migrateIsle(raw: unknown): IsleState | null {
  if (!isObj(raw) || !ISLE_LAYOUTS.some((l) => l.id === raw.layout)) return null
  const base = newIsle(raw.layout as IsleLayoutId)
  const int = (v: unknown, lo: number, hi: number, d: number) => (isNum(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : d)
  const t = isObj(raw.tools) ? raw.tools : {}
  const m = isObj(raw.mats) ? raw.mats : {}
  const g = isObj(raw.gathered) ? raw.gathered : {}
  const known = new Set(isleNodes(base.layout).map((n) => n.id))
  // 집(v24): 단계, 보관함(0~99, 모르는 가구 버림), 놓인 가구(방 안·겹침 없이 canPlace 순서대로, 안 되는 것은 보관함으로)
  const house = int(raw.house, 0, HOUSE_MAX, 0)
  const furniture: Partial<Record<FurnId, number>> = {}
  const addFurn = (id: FurnId, n: number) => {
    const v = Math.min(FURN_CAP, (furniture[id] ?? 0) + n)
    if (v > 0) furniture[id] = v
  }
  if (isObj(raw.furniture)) for (const [id, n] of Object.entries(raw.furniture)) if (isFurnId(id)) addFurn(id, int(n, 0, FURN_CAP, 0))
  const placed: Placed[] = []
  if (Array.isArray(raw.placed)) {
    for (const p of raw.placed) {
      if (!isObj(p) || !isFurnId(p.id)) continue
      if (placed.length < ROOM_MAX && isNum(p.tx) && isNum(p.ty) && canPlace(house, placed, p.tx, p.ty)) placed.push({ id: p.id, tx: p.tx, ty: p.ty })
      else addFurn(p.id, 1)
    }
  }
  const cleared = int(raw.cleared, 0, ISLE_ZONES, 0)
  // 바깥 꾸미기(v25): 보관함, 놓인 것(지금 섬 모양·개간·집 기준 canDecorate 순서대로, 안 되는 것은 보관함으로)
  const box: Partial<Record<DecoId, number>> = {}
  if (isObj(raw.decoBox)) for (const [id, n] of Object.entries(raw.decoBox)) if (isDecoId(id) && int(n, 0, FURN_CAP, 0) > 0) box[id] = int(n, 0, FURN_CAP, 0)
  const listed: DecoPlaced[] = Array.isArray(raw.deco)
    ? raw.deco.filter((d): d is DecoPlaced => isObj(d) && isDecoId(d.id) && Number.isInteger(d.tx) && Number.isInteger(d.ty))
    : []
  const { deco, decoBox } = replayDeco({ layout: base.layout, cleared, house }, listed, box)
  return {
    layout: base.layout,
    cleared,
    tools: { axe: int(t.axe, 1, TOOL_MAX, 1), pick: int(t.pick, 1, TOOL_MAX, 1), shovel: int(t.shovel, 1, TOOL_MAX, 1) },
    mats: { wood: int(m.wood, 0, MAT_CAP, 0), stone: int(m.stone, 0, MAT_CAP, 0), iron: int(m.iron, 0, MAT_CAP, 0) },
    gathered: {
      day: typeof g.day === 'string' && DAY_RE.test(g.day) ? g.day : '',
      ids: Array.isArray(g.ids) ? [...new Set(g.ids.filter((id): id is string => typeof id === 'string' && known.has(id)))] : [],
    },
    house,
    furniture,
    placed,
    decoBox,
    deco,
  }
}

/** pending 형식이 지금과 같아진 버전(v18). 그 전 세이브의 진행 중 낚시는 버린다 */
const PENDING_FORMAT_SINCE = 18
const SEASON_IDS: readonly string[] = ['spring', 'summer', 'autumn', 'winter']
const WEATHER_IDS: readonly string[] = ['sun', 'rain']
/**
 * 진행 중 낚시를 버전이 바뀌어도 이어 준다(어종 확장 v19, 배포 순간 낚던 물고기를 잃지 않게).
 * 형식이 같은 버전(PENDING_FORMAT_SINCE 이상)이고 어종·지역·자리를 알고 값이 모두 온전할 때만, 아니면 null
 */
function migratePending(raw: unknown, fromVersion: number): Pending | null {
  if (fromVersion < PENDING_FORMAT_SINCE || !isObj(raw)) return null
  const { species, sizeCm, biteDelayMs, startedAt, hookedAt, area, spot, cond, power } = raw
  const a = AREAS.find((x) => x.id === area)
  if (!knownSpecies(species) || !a || typeof spot !== 'string' || !a.spots.includes(spot)) return null
  if (![sizeCm, biteDelayMs, startedAt, power].every(isNum) || !(hookedAt === null || isNum(hookedAt))) return null
  if (!isObj(cond) || !isNum(cond.gameMinute) || !isNum(cond.gameDay) || !SEASON_IDS.includes(cond.season as string) || !WEATHER_IDS.includes(cond.weather as string)) return null
  return {
    species,
    sizeCm: sizeCm as number,
    biteDelayMs: biteDelayMs as number,
    startedAt: startedAt as number,
    hookedAt: hookedAt as number | null,
    area: a.id,
    spot,
    cond: { gameMinute: cond.gameMinute, gameDay: cond.gameDay, season: cond.season as Conditions['season'], weather: cond.weather as Conditions['weather'] },
    power: power as number,
    // v27: 미끼·연구 대상(알려진 값일 때만)
    ...(fromVersion >= 27 && BAIT_KINDS.includes(raw.bait as BaitKind) ? { bait: raw.bait as BaitKind } : {}),
    ...(fromVersion >= 27 && knownSpecies(raw.target) && speciesById(raw.target).legend ? { target: raw.target } : {}),
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
    // 0구역은 기록하지 않는다(섬만 고른 사람이 명예의 전당 0구역 줄에 몰리지 않게)
    // 꾸미기를 하나라도 가진 적이 있으면 0도 기록한다(모두 치우면 기록이 줄어야 해서)
    ...(state.isle && (state.isle.deco.length > 0 || Object.keys(state.isle.decoBox).length > 0) ? [{ key: 'deco', value: state.isle.deco.length }] : []),
    ...(state.isle && state.isle.house > 0 ? [{ key: 'house', value: state.isle.house, detail: `${state.isle.house}/${HOUSE_MAX}` }] : []),
    ...(state.isle && state.isle.cleared > 0 ? [{ key: 'isle_cleared', value: state.isle.cleared, detail: `${state.isle.cleared}/${ISLE_ZONES}` }] : []),
  ]
}

/** 메인 미리보기용 열린 지역 기록의 키(game_records, detail = 쉼표로 이은 지역 id). 메인 미리보기 설계 §6 */
export const PREVIEW_AREAS_KEY = 'areas'
/** 섬이 있는 사람 기록의 키(game_records, detail = 섬 모양). 고른 뒤에만 쓴다. 친구 섬 목록(world_players)이 읽는다. 내 섬 설계 §5.4 */
export const PREVIEW_ISLE_KEY = 'isle'

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
  // 19: 어종 확장 75종(같은 rng에서 추첨 결과가 달라진다). 세이브 형식은 18과 같다(설계 2026-11-25-fishing-species-expansion-design.md)
  // 20: 신발(shoesTier·buyShoes). 옛 세이브는 기본 장화(설계 2026-11-26-fishing-shoes-design.md)
  // 21: 여러 마리 버리기(discardMany). 세이브 형식은 20과 같다(설계 2026-11-26-fishing-discard-many-design.md)
  // 22: 내 섬 A단계(isle 지역, 세이브 isle, isleChoose, publicView). 옛 세이브는 isle null(설계 2026-11-25-my-island-design.md)
  // 23: 내 섬 B단계(개간·재료·작업대: gather·craft·clear, isle에 cleared·tools·mats·gathered). v22 섬은 기본값(설계 2026-11-26-my-isle-b-design.md)
  // 24: 내 섬 C단계(집: build·makeFurn·place·pickUp, isle에 house·furniture·placed, 지역 home). v23 섬은 집 0(설계 2026-11-26-my-isle-c-design.md)
  // 25: 내 섬 D단계(바깥 꾸미기: makeDeco·decorate·undecorate, isle에 decoBox·deco). v24 섬은 꾸미기 없음(설계 2026-11-26-my-isle-d-design.md)
  // 26: 물고기 id·출처(Fish.id·origin, nextFishId). v25 이하 개체는 legacy, 가방 → 냉장고 순서로 1부터. 행동은 id를 받으면 확인
  //     (경제 설계 2026-11-27-fishing-economy-design.md §4.2). 판매가·확률은 그대로
  // 27: 서버 싸움 시간 검사(챈 뒤 180초 넘은 성공은 놓침, 12초 넘은 퍼펙트는 일반), 경제 P1(econ: 어분·미끼·연구 해금·대상별 보장, cast의 bait·target, grind·makeBait·buyLicense, recatch 판매가 50%)과
  //     지역 가격 보정(섬·갯벌·산정 호수 일반 50종), 경제 P2(gallery: 기증·전시·재료·포션·확장, Fish.bonus).
  //     새 행동은 research.ts 기능 플래그가 켜져야 동작(경제 설계 r4)
  // 28: 연구 낚시 대상 입질 확률 전설 3% → 1.5%, 신화 1% → 0.75%(보장 50·100번은 그대로). 세이브 형식은 27과 같다
  // 29: makeBait의 count(미끼 여러 개 한 번에, 최대 MAX_BAIT_BATCH). count 없으면 1개로 28과 같다. 세이브 형식은 28과 같다
  // 30: 자동 어분(econ.autoMeal, setAutoMeal). 기준 판매가 이하 일반 물고기는 잡는 순간 어분, 처음 잡은 어종·최대 크기 갱신은 가방에.
  //     autoMeal이 없는 v29 세이브는 그대로(꺼짐)
  version: 30,
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
  view: (state, ctx): View => {
    // 다음 물고기 번호는 화면에 필요 없다
    const { nextFishId: _next, ...rest } = state
    return { ...rest, gold: ctx.gold, pending: state.pending && pendingView(state.pending) }
  },
  records,
  // 프로필 캐릭터(설계 옷장 §7): 입은 옷 JSON. 화면 Avatar가 읽는다
  avatar: (state) => JSON.stringify(state.outfit),
  previewData: (state) => ({
    [PREVIEW_AREAS_KEY]: state.areas.join(','),
    // 섬 모양:치운 구역 수(v23). 옛 값은 모양만이고 화면은 0으로 읽는다
    ...(state.isle ? { [PREVIEW_ISLE_KEY]: `${state.isle.layout}:${state.isle.cleared}:${state.isle.house}` } : {}),
  }),
  // 남의 섬 구경(world visit): 섬 모양과 옷차림만
  // 재료·도구·오늘 캔 칸은 남에게 보이지 않는다
  publicView: (state) => ({
    isle: state.isle && { layout: state.isle.layout, cleared: state.isle.cleared, house: state.isle.house, placed: state.isle.placed, deco: state.isle.deco },
    outfit: state.outfit,
    // 섬 시설 외형(facility.ts). 남의 섬에서도 보이게
    facilities: ownedFacilities(state.gallery.projects),
  }),
  freeBonus,
}

/** 깬 도전과제의 미니게임 JWD 보너스 합(%, 지갑 설계 §7.5). 열 개 다 깨면 400 */
export function freeBonus(state: Pick<State, 'challenges'>): number {
  return CHALLENGES.reduce((sum, c) => sum + (state.challenges[c.id]?.done === true ? c.freeBonusPct : 0), 0)
}

function isleChoose(state: State, a: Record<string, unknown>): Out {
  if (state.pending) return { error: 'busy' }
  if (state.isle) return { error: 'already_chosen' }
  const layout = ISLE_LAYOUTS.find((l) => l.id === a.layout)
  if (!layout) return { error: 'bad_layout' }
  return { state: { ...state, isle: newIsle(layout.id) } }
}

const MAT_OF: Readonly<Record<NodeKind, keyof Mats>> = { tree: 'wood', rock: 'stone', iron: 'iron' }
const hasMats = (have: Mats, need: Mats) => have.wood >= need.wood && have.stone >= need.stone && have.iron >= need.iron
const minusMats = (have: Mats, need: Mats): Mats => ({ wood: have.wood - need.wood, stone: have.stone - need.stone, iron: have.iron - need.iron })

/** 자원 칸 캐기: 오늘 처음이면 도구 단계만큼 재료(나무 → 도끼, 돌·철 → 곡괭이) */
function gather(state: State, a: Record<string, unknown>, now: number): Out {
  if (state.pending) return { error: 'busy' }
  const isle = state.isle
  if (!isle) return { error: 'no_isle' }
  const node = isleNodes(isle.layout).find((n) => n.id === a.id)
  if (!node) return { error: 'bad_node' }
  if (node.zone > isle.cleared) return { error: 'node_locked' }
  const day = kstDay(now)
  const ids = isle.gathered.day === day ? isle.gathered.ids : []
  if (ids.includes(node.id)) return { error: 'gathered' }
  const res = MAT_OF[node.kind]
  const n = node.kind === 'tree' ? isle.tools.axe : isle.tools.pick
  if (isle.mats[res] + n > MAT_CAP) return { error: 'mats_full' }
  return {
    state: { ...state, isle: { ...isle, mats: { ...isle.mats, [res]: isle.mats[res] + n }, gathered: { day, ids: [...ids, node.id] } } },
    result: { res, n },
  }
}

/** 작업대에서 도구를 한 단계 올린다 */
function craft(state: State, a: Record<string, unknown>, gold: number): Out {
  if (state.pending) return { error: 'busy' }
  const isle = state.isle
  if (!isle) return { error: 'no_isle' }
  if (!TOOL_IDS.includes(a.tool as ToolId)) return { error: 'bad_tool' }
  const tool = a.tool as ToolId
  if (!Number.isInteger(a.tier) || a.tier !== isle.tools[tool] + 1) return { error: 'bad_tier' }
  const cost = toolCost(a.tier as number)
  if (!cost) return { error: 'bad_tier' }
  if (a.price !== cost.gold) return { error: 'price_changed' }
  if (!hasMats(isle.mats, cost)) return { error: 'not_enough_mats' }
  if (gold < cost.gold) return { error: 'not_enough_gold' }
  return { state: { ...state, isle: { ...isle, tools: { ...isle.tools, [tool]: a.tier as number }, mats: minusMats(isle.mats, cost) } }, gold: -cost.gold }
}

/** 다음 구역 개간 */
function clearZone(state: State, a: Record<string, unknown>, gold: number): Out {
  if (state.pending) return { error: 'busy' }
  const isle = state.isle
  if (!isle) return { error: 'no_isle' }
  if (!Number.isInteger(a.zone) || a.zone !== isle.cleared + 1 || isle.cleared >= ISLE_ZONES) return { error: 'bad_zone' }
  const k = a.zone as number
  const need = zoneNeeds(k)
  if (TOOL_IDS.some((t) => isle.tools[t] < need[t])) return { error: 'need_tool' }
  const cost = clearCost(k)
  if (a.price !== cost.gold) return { error: 'price_changed' }
  if (!hasMats(isle.mats, cost)) return { error: 'not_enough_mats' }
  if (gold < cost.gold) return { error: 'not_enough_gold' }
  // 새로 드러난 땅·자원 칸을 막는 꾸미기는 보관함으로(D)
  const { deco, decoBox } = replayDeco({ layout: isle.layout, cleared: k, house: isle.house }, isle.deco, isle.decoBox)
  return { state: { ...state, isle: { ...isle, cleared: k, mats: minusMats(isle.mats, cost), deco, decoBox } }, gold: -cost.gold, result: { cleared: k } }
}

/** 집을 한 단계 올린다 */
function build(state: State, a: Record<string, unknown>, gold: number): Out {
  if (state.pending) return { error: 'busy' }
  const isle = state.isle
  if (!isle) return { error: 'no_isle' }
  if (!Number.isInteger(a.level) || a.level !== isle.house + 1 || isle.house >= HOUSE_MAX) return { error: 'bad_level' }
  const n = a.level as number
  if (isle.cleared < houseNeedsCleared(n)) return { error: 'need_clear' }
  const cost = houseCost(n)
  if (a.price !== cost.gold) return { error: 'price_changed' }
  if (!hasMats(isle.mats, cost)) return { error: 'not_enough_mats' }
  if (gold < cost.gold) return { error: 'not_enough_gold' }
  return { state: { ...state, isle: { ...isle, house: n, mats: minusMats(isle.mats, cost) } }, gold: -cost.gold, result: { house: n } }
}

/** 가구 하나를 만들어 보관함에 */
function makeFurn(state: State, a: Record<string, unknown>, gold: number): Out {
  if (state.pending) return { error: 'busy' }
  const isle = state.isle
  if (!isle) return { error: 'no_isle' }
  const f = FURNITURE.find((x) => x.id === a.id)
  if (!f) return { error: 'bad_furn' }
  if ((isle.furniture[f.id] ?? 0) >= FURN_CAP) return { error: 'furn_full' }
  if (a.price !== f.cost.gold) return { error: 'price_changed' }
  if (!hasMats(isle.mats, f.cost)) return { error: 'not_enough_mats' }
  if (gold < f.cost.gold) return { error: 'not_enough_gold' }
  return {
    state: { ...state, isle: { ...isle, mats: minusMats(isle.mats, f.cost), furniture: { ...isle.furniture, [f.id]: (isle.furniture[f.id] ?? 0) + 1 } } },
    gold: -f.cost.gold,
  }
}

/** 보관함 가구를 집 안 칸에 놓는다 */
function placeFurn(state: State, a: Record<string, unknown>): Out {
  const isle = state.isle
  if (!isle) return { error: 'no_isle' }
  if (isle.house < 1) return { error: 'no_house' }
  if (!isFurnId(a.id)) return { error: 'bad_furn' }
  const id = a.id
  if ((isle.furniture[id] ?? 0) < 1) return { error: 'no_furn' }
  if (isle.placed.length >= ROOM_MAX) return { error: 'room_full' }
  if (!Number.isInteger(a.tx) || !Number.isInteger(a.ty) || !canPlace(isle.house, isle.placed, a.tx as number, a.ty as number)) return { error: 'bad_spot' }
  const furniture = { ...isle.furniture, [id]: (isle.furniture[id] ?? 0) - 1 }
  if (furniture[id] === 0) delete furniture[id]
  return { state: { ...state, isle: { ...isle, furniture, placed: [...isle.placed, { id, tx: a.tx as number, ty: a.ty as number }] } } }
}

/** 집 안 칸의 가구를 보관함으로 */
function pickUp(state: State, a: Record<string, unknown>): Out {
  const isle = state.isle
  if (!isle) return { error: 'no_isle' }
  const i = isle.placed.findIndex((p) => p.tx === a.tx && p.ty === a.ty)
  if (i < 0) return { error: 'no_furn_here' }
  const id = isle.placed[i].id
  if ((isle.furniture[id] ?? 0) >= FURN_CAP) return { error: 'furn_full' }
  return { state: { ...state, isle: { ...isle, placed: isle.placed.filter((_, j) => j !== i), furniture: { ...isle.furniture, [id]: (isle.furniture[id] ?? 0) + 1 } } } }
}

/** 바깥 꾸미기 하나를 만들어 보관함에 */
function makeDeco(state: State, a: Record<string, unknown>, gold: number): Out {
  if (state.pending) return { error: 'busy' }
  const isle = state.isle
  if (!isle) return { error: 'no_isle' }
  const d = DECOS.find((x) => x.id === a.id)
  if (!d) return { error: 'bad_deco' }
  if ((isle.decoBox[d.id] ?? 0) >= FURN_CAP) return { error: 'deco_full' }
  if (a.price !== d.cost.gold) return { error: 'price_changed' }
  if (!hasMats(isle.mats, d.cost)) return { error: 'not_enough_mats' }
  if (gold < d.cost.gold) return { error: 'not_enough_gold' }
  return {
    state: { ...state, isle: { ...isle, mats: minusMats(isle.mats, d.cost), decoBox: { ...isle.decoBox, [d.id]: (isle.decoBox[d.id] ?? 0) + 1 } } },
    gold: -d.cost.gold,
  }
}

/** 보관함 꾸미기를 섬 칸에 놓는다 */
function decorate(state: State, a: Record<string, unknown>): Out {
  const isle = state.isle
  if (!isle) return { error: 'no_isle' }
  if (!isDecoId(a.id)) return { error: 'bad_deco' }
  const id = a.id
  if ((isle.decoBox[id] ?? 0) < 1) return { error: 'no_deco' }
  if (isle.deco.length >= DECO_MAX) return { error: 'isle_full' }
  if (!Number.isInteger(a.tx) || !Number.isInteger(a.ty) || !canDecorate(isle, a.tx as number, a.ty as number, id)) return { error: 'bad_spot' }
  const decoBox = { ...isle.decoBox, [id]: (isle.decoBox[id] ?? 0) - 1 }
  if (decoBox[id] === 0) delete decoBox[id]
  return { state: { ...state, isle: { ...isle, decoBox, deco: [...isle.deco, { id, tx: a.tx as number, ty: a.ty as number }] } } }
}

/** 섬 칸의 꾸미기를 보관함으로 */
function undecorate(state: State, a: Record<string, unknown>): Out {
  const isle = state.isle
  if (!isle) return { error: 'no_isle' }
  const i = isle.deco.findIndex((d) => d.tx === a.tx && d.ty === a.ty)
  if (i < 0) return { error: 'no_deco_here' }
  const id = isle.deco[i].id
  if ((isle.decoBox[id] ?? 0) >= FURN_CAP) return { error: 'deco_full' }
  return { state: { ...state, isle: { ...isle, deco: isle.deco.filter((_, j) => j !== i), decoBox: { ...isle.decoBox, [id]: (isle.decoBox[id] ?? 0) + 1 } } } }
}

/** 일반 물고기 → 어분(P1, 플래그 bait). 잠긴·전설·신화는 안 된다. 하나라도 틀리면 아무것도 갈지 않는다 */
function grind(state: State, a: Record<string, unknown>): Out {
  if (!featureOn('bait')) return { error: 'feature_off' }
  if (!Array.isArray(a.items) || a.items.length === 0 || a.items.length > state.bag.length) return { error: 'bad_action' }
  const picked = new Set<number>()
  for (const it of a.items as unknown[]) {
    if (!isObj(it) || !validIndex(it.index, state.bag.length) || picked.has(it.index)) return { error: 'bad_action' }
    const f = state.bag[it.index]
    if (!sameId(it.id, f)) return { error: 'bag_changed' }
    if (f.locked) return { error: 'locked' }
    if (!isOrdinary(f.species)) return { error: 'not_ordinary' }
    picked.add(it.index)
  }
  return {
    state: { ...state, bag: state.bag.filter((_, j) => !picked.has(j)), econ: { ...state.econ, meal: state.econ.meal + picked.size } },
    result: { meal: picked.size },
  }
}

/** 자동 어분 기준(v30, 플래그 bait): 1..AUTO_MEAL_MAX 정수 G, null이면 끈다 */
function setAutoMeal(state: State, a: Record<string, unknown>): Out {
  if (!featureOn('bait')) return { error: 'feature_off' }
  if (a.price === null) {
    const { autoMeal: _off, ...econ } = state.econ
    return { state: { ...state, econ } }
  }
  const p = a.price
  if (typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p > AUTO_MEAL_MAX) return { error: 'bad_action' }
  return { state: { ...state, econ: { ...state.econ, autoMeal: p } } }
}

/** 미끼 만들기(P1): count개(없으면 1, v29). 모자라면 하나도 만들지 않는다. 집어는 플래그 bait, 전설·신화는 research + 연구 해금 + 그 등급 발견 */
function makeBait(state: State, a: Record<string, unknown>, gold: number): Out {
  if (typeof a.kind !== 'string' || !BAIT_KINDS.includes(a.kind as BaitKind)) return { error: 'bad_action' }
  const kind = a.kind as BaitKind
  if (!featureOn(kind === 'attractor' ? 'bait' : 'research')) return { error: 'feature_off' }
  const r = BAIT_RECIPES[kind]
  const n = a.count === undefined ? 1 : a.count
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_BAIT_BATCH) return { error: 'bad_action' }
  if (a.price !== r.gold) return { error: 'price_changed' }
  if (kind !== 'attractor') {
    if (!state.econ.license) return { error: 'no_license' }
    if (!state.legends.some((id) => speciesById(id).rarity === kind)) return { error: 'not_discovered' }
  }
  if (state.econ.meal < r.meal * n) return { error: 'no_meal' }
  if (gold < r.gold * n) return { error: 'not_enough_gold' }
  const econ: Econ = { ...state.econ, meal: state.econ.meal - r.meal * n, baits: { ...state.econ.baits, [kind]: state.econ.baits[kind] + n } }
  return { state: { ...state, econ }, gold: -r.gold * n }
}

/** 연구 해금(P1, 플래그 research): 계정당 한 번, 전설 1종 이상 발견 */
function buyLicense(state: State, a: Record<string, unknown>, gold: number): Out {
  if (!featureOn('research')) return { error: 'feature_off' }
  if (state.econ.license) return { error: 'owned' }
  if (a.price !== LICENSE_PRICE) return { error: 'price_changed' }
  if (!state.legends.some((id) => speciesById(id).rarity === 'legend')) return { error: 'need_legend' }
  if (gold < LICENSE_PRICE) return { error: 'not_enough_gold' }
  return { state: { ...state, econ: { ...state.econ, license: true } }, gold: -LICENSE_PRICE }
}

/** 재포획 기증(P2, 플래그 exhibit): 연구로 다시 잡은 전설·신화 1마리를 그 어종 전시 준비에 귀속(되팔 수 없다) */
function donate(state: State, a: Record<string, unknown>): Out {
  if (!featureOn('exhibit')) return { error: 'feature_off' }
  if (!validIndex(a.index, state.bag.length)) return { error: 'bad_action' }
  const f = state.bag[a.index]
  if (!sameId(a.id, f)) return { error: 'bag_changed' }
  if (f.origin !== 'recatch') return { error: 'not_recatch' }
  const g = state.gallery
  if (g.exhibits.includes(f.species)) return { error: 'exhibited' }
  const n = g.donated[f.species] ?? 0
  if (n >= DONATE_NEED) return { error: 'donated_full' }
  const i = a.index
  return {
    state: { ...state, bag: state.bag.filter((_, j) => j !== i), gallery: { ...g, donated: { ...g.donated, [f.species]: n + 1 } } },
    result: { donated: n + 1 },
  }
}

/** 영구 전시(P2): 최초 발견 + 기증 2마리 + 전시료(전설 10만·신화 25만) */
function exhibit(state: State, a: Record<string, unknown>, gold: number): Out {
  if (!featureOn('exhibit')) return { error: 'feature_off' }
  if (typeof a.species !== 'string' || !SPECIAL_IDS.includes(a.species)) return { error: 'bad_action' }
  const id = a.species
  const g = state.gallery
  if (g.exhibits.includes(id)) return { error: 'exhibited' }
  if (!state.legends.includes(id)) return { error: 'not_discovered' }
  if ((g.donated[id] ?? 0) < DONATE_NEED) return { error: 'need_donation' }
  const fee = exhibitFee(id)!
  if (a.price !== fee) return { error: 'price_changed' }
  if (gold < fee) return { error: 'not_enough_gold' }
  const { [id]: _d, ...donated } = g.donated
  return { state: { ...state, gallery: { ...g, donated, exhibits: [...g.exhibits, id] } }, gold: -fee }
}

/** 지역 재료 추출(P2, 플래그 alchemy, 첫 신화 전시 뒤): 일반 물고기 → 그 지역 재료 1·2·3 */
function extract(state: State, a: Record<string, unknown>): Out {
  if (!featureOn('alchemy')) return { error: 'feature_off' }
  if (!stageB(state.gallery)) return { error: 'need_mythic_exhibit' }
  if (!Array.isArray(a.items) || a.items.length === 0 || a.items.length > state.bag.length) return { error: 'bad_action' }
  const picked = new Set<number>()
  const mats: Gallery['mats'] = { ...state.gallery.mats }
  for (const it of a.items as unknown[]) {
    if (!isObj(it) || !validIndex(it.index, state.bag.length) || picked.has(it.index)) return { error: 'bad_action' }
    const f = state.bag[it.index]
    if (!sameId(it.id, f)) return { error: 'bag_changed' }
    if (f.locked) return { error: 'locked' }
    const y = extractYield(f.species)
    if (!y) return { error: 'not_ordinary' }
    if ((mats[y.area] ?? 0) + y.n > MAT_MAX) return { error: 'mats_full' }
    mats[y.area] = (mats[y.area] ?? 0) + y.n
    picked.add(it.index)
  }
  return { state: { ...state, bag: state.bag.filter((_, j) => !picked.has(j)), gallery: { ...state.gallery, mats } }, result: { mats } }
}

/** 포션 만들어 바로 마시기(P2, B단계 1병 10분): 같은 포션은 시간만 늘어 최대 20분 */
function brew(state: State, a: Record<string, unknown>, gold: number): Out {
  if (!featureOn('alchemy')) return { error: 'feature_off' }
  if (!stageB(state.gallery)) return { error: 'need_mythic_exhibit' }
  if (typeof a.potion !== 'string' || !POTION_IDS.includes(a.potion as PotionId)) return { error: 'bad_action' }
  const id = a.potion as PotionId
  if (a.alt !== undefined && (a.alt !== true || id !== 'calm')) return { error: 'bad_action' }
  if (a.adv !== undefined && a.adv !== true) return { error: 'bad_action' }
  const g = state.gallery
  // C단계 제작법(13종 전시 뒤): 3병을 보관함에 넣는다(마시기는 drink)
  if (a.adv === true) {
    if (!stageC(g)) return { error: 'need_all_exhibits' }
    const r = a.alt === true ? ADV_CALM_ALT : ADV_POTIONS[id]
    if (a.price !== r.gold) return { error: 'price_changed' }
    if ((g.stock[id] ?? 0) + ADV_DOSES > STOCK_MAX) return { error: 'stock_full' }
    if (!hasAreaMats(g.mats, r.mats)) return { error: 'not_enough_mats' }
    if (gold < r.gold) return { error: 'not_enough_gold' }
    return { state: { ...state, gallery: { ...g, mats: minusAreaMats(g.mats, r.mats), stock: { ...g.stock, [id]: (g.stock[id] ?? 0) + ADV_DOSES } } }, gold: -r.gold }
  }
  const r = a.alt === true ? CALM_ALT : POTIONS[id]
  if (a.price !== r.gold) return { error: 'price_changed' }
  if ((g.potions[id] ?? 0) + POTION_MS > potionCap(g)) return { error: 'potion_full' }
  if (!hasAreaMats(g.mats, r.mats)) return { error: 'not_enough_mats' }
  if (gold < r.gold) return { error: 'not_enough_gold' }
  return {
    state: {
      ...state,
      gallery: { ...g, mats: minusAreaMats(g.mats, r.mats), potions: { ...g.potions, [id]: (g.potions[id] ?? 0) + POTION_MS }, goldBudget: g.goldBudget + (id === 'gold' ? GOLD_BUDGET : 0) },
    },
    gold: -r.gold,
  }
}

/** C단계 병 마시기(P3): 20분, 같은 포션 최대 40분. 금전은 병당 예산 6,000G */
function drink(state: State, a: Record<string, unknown>): Out {
  if (!featureOn('alchemy')) return { error: 'feature_off' }
  if (typeof a.potion !== 'string' || !POTION_IDS.includes(a.potion as PotionId)) return { error: 'bad_action' }
  const id = a.potion as PotionId
  const g = state.gallery
  if ((g.stock[id] ?? 0) < 1) return { error: 'no_potion' }
  if ((g.potions[id] ?? 0) + ADV_DOSE_MS > potionCap(g)) return { error: 'potion_full' }
  const left = (g.stock[id] ?? 0) - 1
  const { [id]: _s, ...rest } = g.stock
  return {
    state: {
      ...state,
      gallery: { ...g, stock: left > 0 ? { ...rest, [id]: left } : rest, potions: { ...g.potions, [id]: (g.potions[id] ?? 0) + ADV_DOSE_MS }, goldBudget: g.goldBudget + (id === 'gold' ? ADV_GOLD_BUDGET : 0) },
    },
  }
}

/** 완료 후 목표 사기(P4, 13종 전시 뒤): 테마 부품·시설, r4 가격·재료. 영구 소유 */
function buyProject(state: State, a: Record<string, unknown>, gold: number): Out {
  if (!featureOn('exhibit')) return { error: 'feature_off' }
  if (!stageC(state.gallery)) return { error: 'need_all_exhibits' }
  const p = typeof a.id === 'string' ? projectById(a.id) : undefined
  if (!p) return { error: 'bad_action' }
  const g = state.gallery
  if (g.projects.includes(p.id)) return { error: 'already_owned' }
  if (a.price !== p.gold) return { error: 'price_changed' }
  if (!hasAreaMats(g.mats, p.mats)) return { error: 'not_enough_mats' }
  if (gold < p.gold) return { error: 'not_enough_gold' }
  return { state: { ...state, gallery: { ...g, mats: minusAreaMats(g.mats, p.mats), projects: [...g.projects, p.id] } }, gold: -p.gold }
}

/** 테마 적용(P4, 무료): 그 테마 배경을 가졌을 때. null이면 기본 */
function setTheme(state: State, a: Record<string, unknown>): Out {
  if (!featureOn('exhibit')) return { error: 'feature_off' }
  if (a.theme !== null && !(typeof a.theme === 'string' && THEMES.some((t) => t.id === a.theme))) return { error: 'bad_action' }
  const theme = a.theme as ThemeId | null
  if (theme && !state.gallery.projects.includes(`${theme}-bg`)) return { error: 'not_owned' }
  return { state: { ...state, gallery: { ...state.gallery, theme } } }
}

/** 전시관 확장(P2, r4 가격): 첫 신화 전시 뒤, 앞 단계 다음. 6지역 재료를 그 단계 양만큼 */
function expand(state: State, a: Record<string, unknown>, gold: number): Out {
  if (!featureOn('exhibit')) return { error: 'feature_off' }
  if (!stageB(state.gallery)) return { error: 'need_mythic_exhibit' }
  const g = state.gallery
  if (a.stage !== g.expansions + 1 || g.expansions >= EXPANSIONS.length) return { error: 'bad_tier' }
  const e = EXPANSIONS[g.expansions]
  if (a.price !== e.gold) return { error: 'price_changed' }
  const need = expansionMats(g.expansions + 1)
  if (!hasAreaMats(g.mats, need)) return { error: 'not_enough_mats' }
  if (gold < e.gold) return { error: 'not_enough_gold' }
  return { state: { ...state, gallery: { ...g, mats: minusAreaMats(g.mats, need), expansions: g.expansions + 1 } }, gold: -e.gold }
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
    case 'store':
      return store(state, action)
    case 'takeOut':
      return takeOut(state, action)
    case 'discard':
      return discard(state, action, ctx.gold)
    case 'discardMany':
      return discardMany(state, action, ctx.gold)
    case 'buyRod':
      return buyRod(state, action, ctx.gold)
    case 'buyBag':
      return buyBag(state, action, ctx.gold)
    case 'buyShoes':
      return buyShoes(state, action, ctx.gold)
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
    case 'isleChoose':
      return isleChoose(state, action)
    case 'gather':
      return gather(state, action, ctx.now)
    case 'craft':
      return craft(state, action, ctx.gold)
    case 'clear':
      return clearZone(state, action, ctx.gold)
    case 'build':
      return build(state, action, ctx.gold)
    case 'makeFurn':
      return makeFurn(state, action, ctx.gold)
    case 'place':
      return placeFurn(state, action)
    case 'pickUp':
      return pickUp(state, action)
    case 'makeDeco':
      return makeDeco(state, action, ctx.gold)
    case 'decorate':
      return decorate(state, action)
    case 'undecorate':
      return undecorate(state, action)
    case 'grind':
      return grind(state, action)
    case 'makeBait':
      return makeBait(state, action, ctx.gold)
    case 'setAutoMeal':
      return setAutoMeal(state, action)
    case 'buyLicense':
      return buyLicense(state, action, ctx.gold)
    case 'donate':
      return donate(state, action)
    case 'exhibit':
      return exhibit(state, action, ctx.gold)
    case 'extract':
      return extract(state, action)
    case 'brew':
      return brew(state, action, ctx.gold)
    case 'expand':
      return expand(state, action, ctx.gold)
    case 'drink':
      return drink(state, action)
    case 'buyProject':
      return buyProject(state, action, ctx.gold)
    case 'setTheme':
      return setTheme(state, action)
    default:
      return { error: 'bad_action' }
  }
}

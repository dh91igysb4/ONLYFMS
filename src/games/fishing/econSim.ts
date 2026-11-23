// 낚시 경제 시뮬레이션(결정적). 실제 어종·낚싯대·찌 데이터와 price()로 시간당 수입과
// "장비·해금을 다 사기까지 걸리는 플레이 시간"을 계산한다. 테스트(gold.test.ts)가 이 값을 고정해
// 데이터·가격이 바뀌어 진행 속도가 목표(지갑 설계 §4.1: 하루 1시간 + 사이트 하루 상한으로 약 30일)에서 벗어나면 실패한다.
// 서버·화면 어디서도 import하지 않는다(world 번들에 들어가지 않는다). 순수 함수만.
//
// 가정은 지갑 설계 §4의 REF 계산과 같다.
// - 조건 평균: 계절 4개 균등, 게임 시각 0~1439분 10분 간격 균등, 날씨 맑음 75%·비 25%(RAIN_CHANCE).
// - 추첨: rollCatch와 같은 규칙(등급 가중치, 후보 없는 등급은 pickPool, 등급 안 균등). 전설은 빼고 센다
//   (세이브당 한 번뿐인 수입이라 시간당 수입에 넣지 않는다 — 다 사는 시간을 조금 길게 잡는 쪽).
// - 크기: 던지기 힘 0.8(부두는 +PIER_POWER_BONUS) → p = u^(1.5 − min(1.25, 힘)), price() 그대로(cm 반올림 포함).
//   성공한 물고기의 20%가 퍼펙트.
// - 시간: 던질 때마다 평균 입질 지연 (1500 + 4500/2) × biteScale(× 회전 찌 0.7) + 미니게임 8초 + 다음 던지기 3초.
//   성공률 80%(난이도·바 크기·화면 찌와 무관한 고정값. 진행 속도 고정 검사는 이 가정에 기댄다:
//   동굴 수입의 대부분인 용암장어(난이도 0.9)는 실제로는 낚싯대가 낮을수록 덜 잡힌다). 가방이 찰 때마다 상점 왕복 TRIP_SEC[지역]초.
import { RAIN_CHANCE, type Conditions, type Season } from './clock.ts'
import {
  AREAS, BAGS, PIER_POWER_BONUS, RODS, SPECIES, speciesAvailable, TACKLE_FX, tackleSlots, TACKLES, UNLOCKS,
  type AreaId, type BagTier, type Rod, type RodTier, type Species, type TackleId,
} from './data.ts'
import { pickPool, price } from './logic.ts'

export const SIM = {
  power: 0.8,
  perfectRate: 0.2,
  successRate: 0.8,
  fightSec: 8,
  recastSec: 3,
} as const
/** 가방이 찼을 때 상점(마을)까지 다녀오는 시간(초). 마을 물가 30초는 REF 계산과 같다. 먼 곳은 걷거나 배·순간이동 */
export const TRIP_SEC: Record<AreaId, number> = { village: 30, river: 45, forest: 60, lake: 60, cave: 90, island: 75 }

const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter']
type NormalRarity = keyof Rod['weights']
const RARITIES: NormalRarity[] = ['common', 'uncommon', 'rare']
const SIZE_STEPS = 400

const sizeCache = new Map<string, number>()
/** 성공한 한 마리의 기대 판매가(크기 분포·퍼펙트 20% 평균) */
function expectedPrice(s: Species, spot: string): number {
  const bonus = spot === 'pier' ? PIER_POWER_BONUS : 0
  const key = `${s.id}|${bonus}`
  const hit = sizeCache.get(key)
  if (hit !== undefined) return hit
  const e = 1.5 - Math.min(1.25, SIM.power + bonus)
  let sum = 0
  for (let i = 0; i < SIZE_STEPS; i++) {
    const p = ((i + 0.5) / SIZE_STEPS) ** e
    const cm = Math.round(s.minCm + p * (s.maxCm - s.minCm))
    sum += (1 - SIM.perfectRate) * price(s.id, cm, false) + SIM.perfectRate * price(s.id, cm, true)
  }
  const v = sum / SIZE_STEPS
  sizeCache.set(key, v)
  return v
}

export type Gear = { rodTier: RodTier; bagTier: BagTier; equipped: readonly TackleId[] }

/** 한 자리에서 성공한 한 마리의 기대 판매가(조건 평균, 전설 제외) */
export function fishValue(area: AreaId, spot: string, rodTier: Gear['rodTier'], equipped: readonly TackleId[]): number {
  const rod = RODS.find((r) => r.tier === rodTier)!
  const curious = equipped.includes('curious')
  const weight = (r: NormalRarity) => rod.weights[r] * (curious && r === 'rare' ? TACKLE_FX.curiousRare : 1)
  const total = RARITIES.reduce((a, r) => a + weight(r), 0)
  let sum = 0
  let wsum = 0
  for (const season of SEASONS) {
    for (let gameMinute = 0; gameMinute < 1440; gameMinute += 10) {
      for (const weather of ['sun', 'rain'] as const) {
        const w = weather === 'rain' ? RAIN_CHANCE : 1 - RAIN_CHANCE
        const cond: Conditions = { gameMinute, gameDay: 0, season, weather }
        const byRarity: Record<NormalRarity, Species[]> = { common: [], uncommon: [], rare: [] }
        for (const s of SPECIES) {
          if (!s.legend && s.rarity !== 'legend' && s.rarity !== 'mythic' && speciesAvailable(s, area, spot, cond, rodTier)) byRarity[s.rarity].push(s)
        }
        let v = 0
        for (const r of RARITIES) {
          const pool = pickPool(byRarity, r)
          if (pool.length === 0) continue
          v += (weight(r) / total) * (pool.reduce((a, s) => a + expectedPrice(s, spot), 0) / pool.length)
        }
        sum += w * v
        wsum += w
      }
    }
  }
  return sum / wsum
}

/** 한 자리의 기대 시간당 판매 수입(G/h) */
export function hourlyIncome(area: AreaId, spot: string, gear: Gear): number {
  const rod = RODS.find((r) => r.tier === gear.rodTier)!
  const spinner = gear.equipped.includes('spinner')
  const biteSec = ((1500 + 4500 / 2) / 1000) * rod.biteScale * (spinner ? TACKLE_FX.spinnerBite : 1)
  const castSec = biteSec + SIM.fightSec + SIM.recastSec
  const bag = BAGS.find((b) => b.tier === gear.bagTier)!.size
  const secPerFish = castSec / SIM.successRate + TRIP_SEC[area] / bag
  return (3600 / secPerFish) * fishValue(area, spot, gear.rodTier, gear.equipped)
}

/**
 * 열린 지역 가운데 가장 많이 버는 자리와 그 수입. 찌는 칸 수 안에서 가장 좋은 조합으로 낀다.
 * 찌 조합은 2개까지만 본다: 수입에 닿는 찌가 회전·호기심 둘뿐이라서다. 서버 효과 찌가 늘면 3개 조합도 보게 고친다.
 */
export function bestSpot(areas: readonly AreaId[], rodTier: RodTier, bagTier: BagTier, owned: readonly TackleId[]) {
  const slots = tackleSlots(rodTier)
  const combos: TackleId[][] = [[]]
  for (const a of owned) {
    combos.push([a])
    for (const b of owned) if (a < b) combos.push([a, b])
  }
  let best = { area: 'village' as AreaId, spot: 'shore', equipped: [] as TackleId[], income: 0 }
  for (const area of AREAS) {
    if (!areas.includes(area.id)) continue
    for (const spot of area.spots) {
      for (const equipped of combos) {
        if (equipped.length > slots) continue
        const income = hourlyIncome(area.id, spot, { rodTier, bagTier, equipped })
        if (income > best.income) best = { area: area.id, spot, equipped, income }
      }
    }
  }
  return best
}

export type Purchase =
  | { kind: 'rod'; tier: Exclude<RodTier, 1> }
  | { kind: 'bag'; tier: Exclude<BagTier, 1> }
  | { kind: 'unlock'; area: AreaId }
  | { kind: 'tackle'; id: TackleId }

/**
 * 시뮬레이션의 구매 순서. 기존 장비(1~4단계 낚싯대, 40칸까지 가방, 찌 5종, 지역 3곳)는 지도 진행대로
 * 수입을 올리는 것부터(화면 찌는 버는 양을 바꾸지 않아 마지막), 그다음 고급 장비(5·6단계 낚싯대, 50·60칸 가방).
 */
export const BUY_ORDER: readonly Purchase[] = [
  { kind: 'rod', tier: 2 },
  { kind: 'bag', tier: 2 },
  { kind: 'unlock', area: 'lake' },
  { kind: 'rod', tier: 3 },
  { kind: 'tackle', id: 'spinner' },
  { kind: 'unlock', area: 'cave' },
  { kind: 'bag', tier: 3 },
  { kind: 'tackle', id: 'curious' },
  { kind: 'rod', tier: 4 },
  { kind: 'unlock', area: 'island' },
  { kind: 'tackle', id: 'cork' },
  { kind: 'tackle', id: 'trap' },
  { kind: 'tackle', id: 'barbed' },
  { kind: 'rod', tier: 5 },
  { kind: 'bag', tier: 4 },
  { kind: 'rod', tier: 6 },
  { kind: 'bag', tier: 5 },
]

export function purchasePrice(p: Purchase): number {
  switch (p.kind) {
    case 'rod':
      return RODS.find((r) => r.tier === p.tier)!.price
    case 'bag':
      return BAGS.find((b) => b.tier === p.tier)!.price
    case 'unlock':
      return UNLOCKS[p.area]!.price
    case 'tackle':
      return TACKLES.find((t) => t.id === p.id)!.price
  }
}

export function purchaseLabel(p: Purchase): string {
  switch (p.kind) {
    case 'rod':
      return RODS.find((r) => r.tier === p.tier)!.name
    case 'bag':
      return `가방 ${BAGS.find((b) => b.tier === p.tier)!.size}칸`
    case 'unlock':
      return `${AREAS.find((a) => a.id === p.area)!.name} 해금`
    case 'tackle':
      return TACKLES.find((t) => t.id === p.id)!.name
  }
}

/** 낚시에서 한 번 사면 끝나는 것 전부의 합계(낚싯대·가방·찌·지역 해금). 순간이동 요금은 넣지 않는다 */
export function totalSinks(): number {
  return (
    RODS.reduce((a, r) => a + r.price, 0) +
    BAGS.reduce((a, b) => a + b.price, 0) +
    TACKLES.reduce((a, t) => a + t.price, 0) +
    Object.values(UNLOCKS).reduce((a, u) => a + (u?.price ?? 0), 0)
  )
}

export type Milestone = { label: string; price: number; atHours: number; atDay: number; incomeAfter: number; where: string }
/** 하루 플레이 시간과 사이트 하루 상한(지갑 설계 §5.6: 하루 cap까지는 다, 넘은 몫은 rate만). 없으면 상한 없이 이어서 플레이 */
export type DayPlan = { hoursPerDay: number; cap: number; rate: number }

/**
 * 처음(대나무·20칸·기본 지역·0 G)부터 order대로 산다. 살 수 있게 되는 순간 바로 산다.
 * 그 사이에는 그때 가진 것으로 가장 많이 버는 자리에서 낚시한다. 각 구매 시각(플레이 시간, day가 있으면 날짜)을 돌려준다.
 * 시간은 STEP_H(0.01시간) 단위로 나아간다.
 */
export function simulate(order: readonly Purchase[] = BUY_ORDER, day?: DayPlan): Milestone[] {
  const STEP_H = 0.01
  let rodTier: RodTier = 1
  let bagTier: BagTier = 1
  const areas: AreaId[] = ['village', 'river', 'forest']
  const owned: TackleId[] = []
  let gold = 0
  let steps = 0
  let earnedToday = 0
  const out: Milestone[] = []
  let now = bestSpot(areas, rodTier, bagTier, owned)
  for (const p of order) {
    const cost = purchasePrice(p)
    while (gold < cost) {
      const raw = now.income * STEP_H
      if (day) {
        const room = Math.max(day.cap - earnedToday, 0)
        const got = Math.min(raw, room) + Math.max(raw - room, 0) * day.rate
        earnedToday += got
        gold += got
      } else gold += raw
      steps++
      if (day && Math.round(steps * STEP_H * 1e6) % Math.round(day.hoursPerDay * 1e6) === 0) earnedToday = 0
    }
    gold -= cost
    if (p.kind === 'rod') rodTier = p.tier
    else if (p.kind === 'bag') bagTier = p.tier
    else if (p.kind === 'unlock') areas.push(p.area)
    else owned.push(p.id)
    now = bestSpot(areas, rodTier, bagTier, owned)
    const hours = steps * STEP_H
    out.push({
      label: purchaseLabel(p),
      price: cost,
      atHours: hours,
      atDay: day ? hours / day.hoursPerDay : hours,
      incomeAfter: now.income,
      where: `${now.area}/${now.spot}`,
    })
  }
  return out
}

// 낚시 경제 P1(경제 설계 2026-11-27-fishing-economy-design.md §2, 개정 r4): 어분·미끼·연구 해금·연구 낚시 규칙.
// 순수 함수와 상수만. logic.ts가 행동(grind·makeBait·buyLicense·cast의 bait)을 이 규칙으로 판정한다.
import { SPECIES, type AreaId, type Species } from './data.ts'

/** 경제 기능 플래그. 꺼져 있으면 새 행동은 feature_off. 켜려면 이 값을 바꾸고 world를 다시 배포한다 */
export const ECONOMY_FLAGS = { bait: false, research: false } as const
export type EconomyFeature = keyof typeof ECONOMY_FLAGS
export function featureOn(f: EconomyFeature, flags: Readonly<Record<EconomyFeature, boolean>> = ECONOMY_FLAGS): boolean {
  return flags[f] === true
}

export type BaitKind = 'attractor' | 'legend' | 'mythic'
export const BAIT_KINDS: readonly BaitKind[] = ['attractor', 'legend', 'mythic']
/** 미끼 제작 1회 = 1개. 골드와 어분을 제작 때 내고, 유효 투척 때 1개를 쓴다(투척비 없음) */
export const BAIT_RECIPES: Readonly<Record<BaitKind, { gold: number; meal: number }>> = {
  attractor: { gold: 50, meal: 1 },
  legend: { gold: 600, meal: 1 },
  mythic: { gold: 1200, meal: 2 },
}
/** 연구 해금(계정당 한 번). 전설 1종 이상 발견해야 살 수 있다 */
export const LICENSE_PRICE = 50_000
/** 집어 미끼: 그 투척 1회의 일반 rare 등급 가중치 배율. 전설·신화 확률에는 영향 없다 */
export const ATTRACTOR_RARE = 1.2
/** 연구 낚시: 대상 입질 확률(호기심 찌면 ×1.5)과 대상별 입질 보장 횟수 */
export const RESEARCH = {
  legend: { chance: 0.03, guarantee: 50 },
  mythic: { chance: 0.01, guarantee: 100 },
} as const
export const RESEARCH_CURIOUS = 1.5
/** 다시 잡은 전설·신화(origin recatch) 판매가 배율: round(판매가 × 0.5) */
export const RECATCH_SALE_PCT = 50

export type Econ = {
  /** 어분 개수 */
  meal: number
  /** 만든 미끼 개수 */
  baits: Record<BaitKind, number>
  /** 연구 해금 여부 */
  license: boolean
  /** 대상별 유효 미끼 투척 수(대상을 잡으면 0, 놓치면 유지). 0인 키는 두지 않는다 */
  pity: Record<string, number>
}
export const newEcon = (): Econ => ({ meal: 0, baits: { attractor: 0, legend: 0, mythic: 0 }, license: false, pity: {} })

const speciesOf = (id: string): Species | undefined => SPECIES.find((s) => s.id === id)
export const isSpecial = (id: string): boolean => !!speciesOf(id)?.legend

/** 어분 재료가 되는 일반 물고기(전설·신화가 아님) */
export const isOrdinary = (id: string): boolean => !!speciesOf(id) && !isSpecial(id)

/** 연구 미끼 종류가 대상 등급과 맞는지 */
export function baitMatches(kind: BaitKind, target: string): boolean {
  const s = speciesOf(target)
  if (!s?.legend) return false
  return (kind === 'legend' && s.rarity === 'legend') || (kind === 'mythic' && s.rarity === 'mythic')
}

/**
 * 연구 낚시 자격(계절·시간·날씨만 완화): 발견한 대상, 같은 지역·자리, 낚싯대 단계, 던진 힘.
 * 물때(자리 열림)는 cast의 castClosed가 먼저 본다. 맞지 않으면 거절 이유(미끼를 쓰지 않는다).
 */
export function researchEligibility(
  target: string,
  c: { legends: readonly string[]; area: AreaId; spot: string; rodTier: number; power: number },
): 'not_discovered' | 'wrong_place' | 'need_rod' | 'need_power' | null {
  const s = speciesOf(target)
  if (!s?.legend || !c.legends.includes(target)) return 'not_discovered'
  if (s.area !== c.area || (s.spots && !s.spots.includes(c.spot))) return 'wrong_place'
  if (c.rodTier < s.minRod) return 'need_rod'
  if (c.power < s.legend.power) return 'need_power'
  return null
}

/** 이번 유효 투척의 대상 입질 확률. pityBefore+1이 보장 횟수 이상이면 1(입질 보장, 포획 보장 아님) */
export function researchChance(target: string, pityBefore: number, curious: boolean): number {
  const s = speciesOf(target)
  if (!s?.legend) return 0
  const r = s.rarity === 'mythic' ? RESEARCH.mythic : RESEARCH.legend
  if (pityBefore + 1 >= r.guarantee) return 1
  return r.chance * (curious ? RESEARCH_CURIOUS : 1)
}

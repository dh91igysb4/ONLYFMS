// 내 섬 B단계 가격(설계 docs/superpowers/specs/2026-11-26-my-isle-b-design.md §5.4). 순수 모듈.
// 완만한 곡선 base × n^p + 항목마다 최고 단계(상위 설계 §2). 재료는 팔 수 없고, 여기 어떤 값도 골드를 주지 않는다.
import { REF } from '../economy.ts'

/** 개간 구역 수(최고 단계) */
export const ISLE_ZONES = 8
/** 재료마다 가질 수 있는 최대 개수 */
export const MAT_CAP = 999
/** 도구 최고 단계 */
export const TOOL_MAX = 3

export type Mats = { wood: number; stone: number; iron: number }
export type Cost = Mats & { gold: number }
export type ToolId = 'axe' | 'pick' | 'shovel'
export const TOOL_IDS: readonly ToolId[] = ['axe', 'pick', 'shovel']

const floor10 = (v: number) => Math.floor(v / 10) * 10

/** 구역 k(1..8)를 치우는 값: 골드 floor10(REF/4 × k^1.7), 나무 8k, 돌 6k, 철 3(k−2)(k ≥ 3) */
export function clearCost(k: number): Cost {
  return { gold: floor10((REF / 4) * k ** 1.7), wood: 8 * k, stone: 6 * k, iron: k >= 3 ? 3 * (k - 2) : 0 }
}

/** 구역 k를 치우는 데 필요한 도구 단계 */
export function zoneNeeds(k: number): Record<ToolId, number> {
  return { axe: k >= 5 ? 2 : 1, pick: k >= 5 ? 2 : 1, shovel: k >= 7 ? 2 : 1 }
}

/** 도구를 tier 단계로 올리는 값. 1단계는 처음부터 가진다(null) */
export function toolCost(tier: number): Cost | null {
  if (tier === 2) return { gold: 4000, wood: 10, stone: 0, iron: 5 }
  if (tier === 3) return { gold: 16000, wood: 20, stone: 0, iron: 15 }
  return null
}

/** B단계 골드 총액(개간 8구역 + 도구 셋 2·3단계) */
export const B_GOLD_TOTAL: number =
  Array.from({ length: ISLE_ZONES }, (_, i) => clearCost(i + 1).gold).reduce((a, b) => a + b, 0) +
  TOOL_IDS.length * (toolCost(2)!.gold + toolCost(3)!.gold)

// ---------------------------------------------------------------- 집(C단계, 설계 2026-11-26-my-isle-c §4.2)
/** 집 최고 단계(0 텐트, 1 오두막, 2 작은 집, 3 집, 4 큰 집) */
export const HOUSE_MAX = 4

/** 집을 n(1..4) 단계로 올리는 값: 골드 floor10(REF × 1.7 × n^1.8), 나무 30n, 돌 20n, 철 10(n−1) */
export function houseCost(n: number): Cost {
  return { gold: floor10(REF * 1.7 * n ** 1.8), wood: 30 * n, stone: 20 * n, iron: 10 * (n - 1) }
}

/** 집 n단계에 필요한 개간 구역 수 */
export function houseNeedsCleared(n: number): number {
  return n >= 4 ? ISLE_ZONES : n >= 3 ? 4 : 0
}

/** 집 골드 총액(1~4단계) */
export const HOUSE_GOLD_TOTAL: number = Array.from({ length: HOUSE_MAX }, (_, i) => houseCost(i + 1).gold).reduce((a, b) => a + b, 0)

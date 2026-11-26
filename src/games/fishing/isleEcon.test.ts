import { describe, expect, it } from 'vitest'
import { REF } from '../economy.ts'
import { B_GOLD_TOTAL, ISLE_ZONES, MAT_CAP, clearCost, toolCost, zoneNeeds } from './isleEcon.ts'

describe('내 섬 B 가격 (설계 2026-11-26-my-isle-b §5.4)', () => {
  it('개간 구역 골드는 floor10(REF/4 × k^1.7), 재료 나무 8k·돌 6k·철 3(k−2)', () => {
    expect(ISLE_ZONES).toBe(8)
    expect(MAT_CAP).toBe(999)
    expect([1, 2, 3, 8].map((k) => clearCost(k).gold)).toEqual([5120, 16650, 33170, 175770])
    expect(clearCost(1)).toEqual({ gold: 5120, wood: 8, stone: 6, iron: 0 })
    expect(clearCost(3)).toEqual({ gold: 33170, wood: 24, stone: 18, iron: 3 })
    expect(clearCost(8)).toMatchObject({ wood: 64, stone: 48, iron: 18 })
  })
  it('구역 5부터 도끼·곡괭이 2, 7부터 삽 2', () => {
    expect(zoneNeeds(4)).toEqual({ axe: 1, pick: 1, shovel: 1 })
    expect(zoneNeeds(5)).toEqual({ axe: 2, pick: 2, shovel: 1 })
    expect(zoneNeeds(7)).toEqual({ axe: 2, pick: 2, shovel: 2 })
  })
  it('도구 2·3단계 가격, 1단계는 없음', () => {
    expect(toolCost(2)).toEqual({ gold: 4000, wood: 10, stone: 0, iron: 5 })
    expect(toolCost(3)).toEqual({ gold: 16000, wood: 20, stone: 0, iron: 15 })
    expect(toolCost(1)).toBeNull()
    expect(toolCost(4)).toBeNull()
  })
  it('B 골드 총액은 REF × 30 ±15%', () => {
    let sum = 0
    for (let k = 1; k <= ISLE_ZONES; k++) sum += clearCost(k).gold
    sum += 3 * (toolCost(2)!.gold + toolCost(3)!.gold)
    expect(B_GOLD_TOTAL).toBe(sum)
    expect(sum).toBeGreaterThanOrEqual(REF * 30 * 0.85)
    expect(sum).toBeLessThanOrEqual(REF * 30 * 1.15)
  })
})

describe('집 단계 가격 (설계 2026-11-26-my-isle-c §4.2)', () => {
  it('단계 n 골드 floor10(REF×1.7×n^1.8), 나무 30n·돌 20n·철 10(n−1), 개간 조건', async () => {
    const { HOUSE_MAX, houseCost, houseNeedsCleared, HOUSE_GOLD_TOTAL } = await import('./isleEcon.ts')
    expect(HOUSE_MAX).toBe(4)
    expect([1, 2, 3, 4].map((n) => houseCost(n).gold)).toEqual([34850, 121350, 251770, 422580])
    expect(houseCost(2)).toEqual({ gold: 121350, wood: 60, stone: 40, iron: 10 })
    expect([1, 2, 3, 4].map(houseNeedsCleared)).toEqual([0, 0, 4, 8])
    expect(HOUSE_GOLD_TOTAL).toBe(830550)
    expect(HOUSE_GOLD_TOTAL).toBeGreaterThanOrEqual(REF * 40 * 0.85)
    expect(HOUSE_GOLD_TOTAL).toBeLessThanOrEqual(REF * 40 * 1.15)
  })
})

// 낚시 어종·낚싯대 데이터. 순수 데이터, 외부 의존 없음(브라우저·Deno 공용).
import { inHours, type Conditions, type Season, type Weather } from './clock.ts'

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legend'
export type AreaId = 'village' | 'river' | 'forest' | 'lake' | 'cave' | 'island'
export type Behavior = 'mixed' | 'smooth' | 'dart' | 'floater' | 'sinker'
export type Species = {
  id: string
  name: string
  rarity: Rarity
  basePrice: number
  minCm: number
  maxCm: number
  difficulty: number
  minRod: 1 | 2 | 3 | 4
  behavior: Behavior
  area: AreaId
  /** 없으면 그 지역의 모든 자리 */
  spots?: readonly string[]
  /** 없으면 사계절 */
  seasons?: readonly Season[]
  /** [시작시, 끝시). 끝이 시작보다 작으면 자정을 넘는다. 없으면 하루 종일 */
  hours?: readonly [number, number]
  /** 없으면 날씨 무관 */
  weather?: Weather
  /** 전설 어종. power는 이 어종이 나오는 데 필요한 최소 던지기 힘 (rollCatch가 확인한다) */
  legend?: { power: number }
}
export type Rod = {
  tier: 1 | 2 | 3 | 4
  name: string
  price: number
  barBonus: number
  biteScale: number
  weights: Record<'common' | 'uncommon' | 'rare', number>
}

export const AREAS: readonly { id: AreaId; name: string; spots: readonly string[] }[] = [
  { id: 'village', name: '바닷가 마을', spots: ['pier', 'shore'] },
  { id: 'river', name: '마을 강', spots: ['river'] },
  { id: 'forest', name: '숲', spots: ['pond', 'waterfall'] },
  { id: 'lake', name: '산 호수', spots: ['lake'] },
  { id: 'cave', name: '동굴', spots: ['cave1', 'cave2', 'cave3'] },
  { id: 'island', name: '섬', spots: ['sea', 'lagoon'] },
]
export const DEFAULT_AREAS: readonly AreaId[] = ['village', 'river', 'forest']
export const LEGEND_CHANCE = 0.08

export const SPECIES: Species[] = [
  { id: 'anchovy', name: '멸치', rarity: 'common', basePrice: 20, minCm: 8, maxCm: 15, difficulty: 0.15, minRod: 1, behavior: 'dart', area: 'village', seasons: ['spring', 'autumn'] },
  { id: 'goby', name: '망둥어', rarity: 'common', basePrice: 25, minCm: 8, maxCm: 20, difficulty: 0.2, minRod: 1, behavior: 'mixed', area: 'village' },
  { id: 'horse-mackerel', name: '전갱이', rarity: 'common', basePrice: 30, minCm: 15, maxCm: 35, difficulty: 0.2, minRod: 1, behavior: 'mixed', area: 'village' },
  { id: 'mackerel', name: '고등어', rarity: 'common', basePrice: 50, minCm: 25, maxCm: 45, difficulty: 0.3, minRod: 1, behavior: 'mixed', area: 'village', seasons: ['summer', 'autumn', 'winter'], hours: [6, 19] },
  { id: 'mullet', name: '숭어', rarity: 'uncommon', basePrice: 80, minCm: 30, maxCm: 70, difficulty: 0.4, minRod: 1, behavior: 'smooth', area: 'village', seasons: ['spring', 'winter'], hours: [6, 19] },
  { id: 'rockfish', name: '우럭', rarity: 'uncommon', basePrice: 110, minCm: 20, maxCm: 50, difficulty: 0.45, minRod: 1, behavior: 'sinker', area: 'village' },
  { id: 'flounder', name: '도다리', rarity: 'uncommon', basePrice: 130, minCm: 20, maxCm: 45, difficulty: 0.45, minRod: 1, behavior: 'sinker', area: 'village', seasons: ['spring', 'summer'] },
  { id: 'squid', name: '오징어', rarity: 'uncommon', basePrice: 150, minCm: 20, maxCm: 40, difficulty: 0.5, minRod: 1, behavior: 'mixed', area: 'village', seasons: ['winter'], hours: [18, 2] },
  { id: 'hairtail', name: '갈치', rarity: 'uncommon', basePrice: 120, minCm: 60, maxCm: 120, difficulty: 0.55, minRod: 1, behavior: 'dart', area: 'village', seasons: ['autumn', 'winter'], hours: [20, 5] },
  { id: 'conger', name: '붕장어', rarity: 'uncommon', basePrice: 110, minCm: 40, maxCm: 90, difficulty: 0.6, minRod: 1, behavior: 'smooth', area: 'village', seasons: ['spring', 'autumn'], hours: [16, 2], weather: 'rain' },
  { id: 'pufferfish', name: '복어', rarity: 'uncommon', basePrice: 140, minCm: 15, maxCm: 35, difficulty: 0.72, minRod: 1, behavior: 'floater', area: 'village', seasons: ['summer'], hours: [12, 16], weather: 'sun' },
  { id: 'red-seabream', name: '참돔', rarity: 'rare', basePrice: 300, minCm: 40, maxCm: 90, difficulty: 0.65, minRod: 2, behavior: 'mixed', area: 'village', seasons: ['spring', 'autumn'] },
  { id: 'seabass', name: '농어', rarity: 'rare', basePrice: 400, minCm: 50, maxCm: 100, difficulty: 0.7, minRod: 2, behavior: 'dart', area: 'village', seasons: ['summer', 'autumn'] },
  { id: 'yellowtail', name: '방어', rarity: 'rare', basePrice: 600, minCm: 60, maxCm: 110, difficulty: 0.75, minRod: 2, behavior: 'smooth', area: 'village', seasons: ['winter'] },
  { id: 'octopus', name: '문어', rarity: 'rare', basePrice: 350, minCm: 30, maxCm: 90, difficulty: 0.85, minRod: 2, behavior: 'sinker', area: 'village', seasons: ['summer'], hours: [6, 13] },
  { id: 'grouper', name: '다금바리', rarity: 'legend', basePrice: 2500, minCm: 80, maxCm: 140, difficulty: 0.95, minRod: 3, behavior: 'mixed', area: 'village', spots: ['pier'], seasons: ['winter'], legend: { power: 0.95 } },
]

export const RODS: Rod[] = [
  { tier: 1, name: '대나무 낚싯대', price: 0, barBonus: 0, biteScale: 1, weights: { common: 70, uncommon: 30, rare: 0 } },
  { tier: 2, name: '유리섬유 낚싯대', price: 1500, barBonus: 0.15, biteScale: 1, weights: { common: 55, uncommon: 33, rare: 12 } },
  { tier: 3, name: '카본 낚싯대', price: 8000, barBonus: 0.3, biteScale: 1, weights: { common: 50, uncommon: 34, rare: 16 } },
  { tier: 4, name: '명장의 낚싯대', price: 40000, barBonus: 0.45, biteScale: 0.8, weights: { common: 46, uncommon: 34, rare: 20 } },
]

/** 지역·자리·계절·시간·날씨·낚싯대 조건을 모두 만족하는가. legend.power는 보지 않는다. */
export function speciesAvailable(s: Species, area: AreaId, spot: string, cond: Conditions, rodTier: number): boolean {
  if (s.area !== area) return false
  if (s.spots && !s.spots.includes(spot)) return false
  if (s.seasons && !s.seasons.includes(cond.season)) return false
  if (s.hours && !inHours(cond.gameMinute, s.hours)) return false
  if (s.weather && s.weather !== cond.weather) return false
  return s.minRod <= rodTier
}

export function areaHasSpecies(area: AreaId): boolean {
  return SPECIES.some((s) => s.area === area)
}

export const BAGS: readonly { tier: 1 | 2 | 3; size: number; price: number }[] = [
  { tier: 1, size: 20, price: 0 },
  { tier: 2, size: 30, price: 800 },
  { tier: 3, size: 40, price: 5000 },
]
/** 모르는 tier는 기본 가방(20칸) */
export function bagSize(tier: number): number {
  return BAGS.find((b) => b.tier === tier)?.size ?? BAGS[0].size
}
/** 부두에서 던지면 크기 추첨 힘에 더해지는 값 */
export const PIER_POWER_BONUS = 0.25
export const MIN_FIGHT_MS = 2000
export const HOOK_WINDOW_MS = 800
/** 챔 창이 끝난 뒤 서버가 더 받아 주는 네트워크 지연 여유 */
export const HOOK_GRACE_MS = 1500

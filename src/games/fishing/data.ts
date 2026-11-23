// 낚시 어종·낚싯대 데이터. 순수 데이터, 외부 의존 없음(브라우저·Deno 공용).
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legend'
export type Species = {
  id: string
  name: string
  rarity: Rarity
  basePrice: number
  minCm: number
  maxCm: number
  difficulty: number
  minRod: 1 | 2 | 3 | 4
}
export type Rod = {
  tier: 1 | 2 | 3 | 4
  name: string
  price: number
  barBonus: number
  biteScale: number
  weights: Record<Rarity, number>
}

export const SPECIES: Species[] = [
  { id: 'anchovy', name: '멸치', rarity: 'common', basePrice: 20, minCm: 8, maxCm: 15, difficulty: 0.15, minRod: 1 },
  { id: 'goby', name: '망둥어', rarity: 'common', basePrice: 25, minCm: 8, maxCm: 20, difficulty: 0.2, minRod: 1 },
  { id: 'horse-mackerel', name: '전갱이', rarity: 'common', basePrice: 30, minCm: 15, maxCm: 35, difficulty: 0.2, minRod: 1 },
  { id: 'mackerel', name: '고등어', rarity: 'common', basePrice: 50, minCm: 25, maxCm: 45, difficulty: 0.3, minRod: 1 },
  { id: 'mullet', name: '숭어', rarity: 'uncommon', basePrice: 80, minCm: 30, maxCm: 70, difficulty: 0.4, minRod: 1 },
  { id: 'rockfish', name: '우럭', rarity: 'uncommon', basePrice: 110, minCm: 20, maxCm: 50, difficulty: 0.45, minRod: 1 },
  { id: 'flounder', name: '도다리', rarity: 'uncommon', basePrice: 130, minCm: 20, maxCm: 45, difficulty: 0.45, minRod: 1 },
  { id: 'squid', name: '오징어', rarity: 'uncommon', basePrice: 150, minCm: 20, maxCm: 40, difficulty: 0.5, minRod: 1 },
  { id: 'red-seabream', name: '참돔', rarity: 'rare', basePrice: 300, minCm: 40, maxCm: 90, difficulty: 0.65, minRod: 2 },
  { id: 'seabass', name: '농어', rarity: 'rare', basePrice: 400, minCm: 50, maxCm: 100, difficulty: 0.7, minRod: 2 },
  { id: 'yellowtail', name: '방어', rarity: 'rare', basePrice: 600, minCm: 60, maxCm: 110, difficulty: 0.75, minRod: 2 },
  { id: 'grouper', name: '다금바리', rarity: 'legend', basePrice: 2500, minCm: 80, maxCm: 140, difficulty: 0.95, minRod: 3 },
]

export const RODS: Rod[] = [
  { tier: 1, name: '대나무 낚싯대', price: 0, barBonus: 0, biteScale: 1, weights: { common: 70, uncommon: 30, rare: 0, legend: 0 } },
  { tier: 2, name: '유리섬유 낚싯대', price: 1500, barBonus: 0.15, biteScale: 1, weights: { common: 55, uncommon: 33, rare: 12, legend: 0 } },
  { tier: 3, name: '카본 낚싯대', price: 8000, barBonus: 0.3, biteScale: 1, weights: { common: 48, uncommon: 34, rare: 16, legend: 2 } },
  { tier: 4, name: '명장의 낚싯대', price: 40000, barBonus: 0.45, biteScale: 0.8, weights: { common: 42, uncommon: 34, rare: 20, legend: 4 } },
]

export const AREAS = [{ id: 'pier', name: '부두' }] as const
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

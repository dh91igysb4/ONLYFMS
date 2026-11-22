// 낚시 추첨·가격. 순수 함수만, 외부 의존 없음.
import { RODS, SPECIES, type Rarity, type Species } from './data.ts'

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

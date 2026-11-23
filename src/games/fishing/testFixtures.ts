// 테스트 전용: 실제 데이터에 아직 없는 신화·물때 자리·최소 낚싯대 지역을 잠시 넣는다(낚시 5부 M1).
// SPECIES·AREAS·UNLOCKS 배열·객체를 그 자리에서 바꾸고 afterEach에서 되돌린다. 운영 코드는 import하지 않는다.
import { afterEach, beforeEach } from 'vitest'
import { AREAS, SPECIES, UNLOCKS, type AreaDef, type AreaId, type Species } from './data.ts'

export type TempData = { species?: Species[]; areas?: AreaDef[]; unlocks?: Partial<Record<string, { price: number; name: string; minRod?: AreaDef['minRod'] }>> }

/** 바로 넣고 되돌리는 함수를 돌려준다 */
export function installTempData(d: TempData): () => void {
  const species = SPECIES as Species[]
  const areas = AREAS as AreaDef[]
  const unlocks = UNLOCKS as Record<string, unknown>
  const nS = species.length
  const nA = areas.length
  species.push(...(d.species ?? []))
  areas.push(...(d.areas ?? []))
  const added = Object.keys(d.unlocks ?? {})
  for (const k of added) unlocks[k] = d.unlocks![k]
  return () => {
    species.length = nS
    areas.length = nA
    for (const k of added) delete unlocks[k]
  }
}

/** describe 안에서 부른다: 각 테스트 앞에 넣고 뒤에 뺀다 */
export function withTempData(d: TempData): void {
  let restore: (() => void) | null = null
  beforeEach(() => {
    restore = installTempData(d)
  })
  afterEach(() => {
    restore?.()
    restore = null
  })
}

export const TMP_MYTH = 'tmp-myth' as AreaId
export const TMP_FLAT = 'tmp-flat' as AreaId
export const TMP_DEEP = 'tmp-deep' as AreaId

const base = { minCm: 10, maxCm: 30, difficulty: 0.3, behavior: 'mixed' as const }
/**
 * 합성 지역 셋:
 * - tmp-myth(자리 den·lair): 흔한 어종, den에 전설 tmp-legend(rod 3, 힘 0.95),
 *   den에 신화 tmp-mythic(rod 5, 힘 0.95, needs [tmp-legend, grouper], imugi-scale),
 *   lair에 신화 tmp-mythic2(rod 5, 힘 0, needs [grouper], dragon-pearl). lair에는 전설이 없다.
 * - tmp-flat(자리 bank·gully, gully는 썰물만): 흔한 어종 둘.
 * - tmp-deep(자리 abyss, 최소 낚싯대 5, 해금 minRod 5): 흔한 어종(minRod 5).
 */
export const M1_FIXTURE: Required<Pick<TempData, 'species' | 'areas' | 'unlocks'>> = {
  areas: [
    { id: TMP_MYTH, name: '신화 시험장', spots: ['den', 'lair'] },
    { id: TMP_FLAT, name: '물때 시험장', spots: ['bank', 'gully'], tideSpots: ['gully'] },
    { id: TMP_DEEP, name: '심해 시험장', spots: ['abyss'], minRod: 5 },
  ],
  unlocks: { [TMP_DEEP]: { price: 1000, name: '시험 배', minRod: 5 } },
  species: [
    { ...base, id: 'tmp-common', name: '시험 붕어', rarity: 'common', basePrice: 100, minRod: 1, area: TMP_MYTH },
    { ...base, id: 'tmp-legend', name: '시험 전설', rarity: 'legend', basePrice: 5000, minRod: 3, area: TMP_MYTH, spots: ['den'], legend: { power: 0.95 } },
    {
      ...base, id: 'tmp-mythic', name: '시험 신화', rarity: 'mythic', basePrice: 20000, minCm: 300, maxCm: 600, difficulty: 0.97, behavior: 'surge',
      minRod: 5, area: TMP_MYTH, spots: ['den'], legend: { power: 0.95, needs: ['tmp-legend', 'grouper'], buff: 'imugi-scale' },
    },
    {
      ...base, id: 'tmp-mythic2', name: '시험 신화 둘', rarity: 'mythic', basePrice: 30000, minCm: 400, maxCm: 900, difficulty: 1, behavior: 'surge',
      minRod: 5, area: TMP_MYTH, spots: ['lair'], legend: { power: 0, needs: ['grouper'], buff: 'dragon-pearl' },
    },
    { ...base, id: 'tmp-flat-a', name: '시험 망둑', rarity: 'common', basePrice: 50, minRod: 1, area: TMP_FLAT },
    { ...base, id: 'tmp-flat-b', name: '시험 짱뚱', rarity: 'common', basePrice: 60, minRod: 1, area: TMP_FLAT, spots: ['gully'] },
    { ...base, id: 'tmp-deep-a', name: '시험 다랑어', rarity: 'common', basePrice: 200, minRod: 5, area: TMP_DEEP },
  ],
}

// 낚시 경제 P2(경제 설계 r4 §2.2·2.4·2.5): 기증·영구 전시, 지역 재료 추출, B단계 포션, 전시관 확장.
// 순수 함수와 상수만. logic.ts가 행동(donate·exhibit·extract·brew·expand)을 이 규칙으로 판정한다. 기능 플래그는 research.ts.
import { SPECIES, type AreaId, type Species } from './data.ts'

/** 영구 전시료(r4: r3의 절반). 같은 어종 새 재포획 2마리를 먼저 기증해야 한다 */
export const EXHIBIT_FEE = { legend: 100_000, mythic: 250_000 } as const
export const DONATE_NEED = 2
/** 13종: 전설 10 + 신화 3 */
export const SPECIAL_IDS: readonly string[] = SPECIES.filter((s) => s.legend).map((s) => s.id)

/** 재료가 나오는 지역(낚시 지역 10곳) */
export type MatArea = 'village' | 'river' | 'forest' | 'lake' | 'cave' | 'island' | 'tideflat' | 'swamp' | 'summit' | 'wreck'
export const MAT_AREAS: readonly MatArea[] = ['village', 'river', 'forest', 'lake', 'cave', 'island', 'tideflat', 'swamp', 'summit', 'wreck']
export const isMatArea = (a: string): a is MatArea => (MAT_AREAS as readonly string[]).includes(a)
/** 일반 물고기 1마리 → 그 지역 재료(흔함 1·드묾 2·희귀 3) */
export const MAT_YIELD = { common: 1, uncommon: 2, rare: 3 } as const
/** 재료 칸마다 최대 개수 */
export const MAT_MAX = 9999

/** 전시관 확장 5단계(r4: r3 × 0.3). 재료는 6지역 각각, 그 단계에서 쓰는 양(누적 아님) */
export const EXPANSION_AREAS: readonly MatArea[] = ['village', 'river', 'forest', 'lake', 'cave', 'tideflat']
export const EXPANSIONS: readonly { gold: number; mats: number }[] = [
  { gold: 90_000, mats: 6 },
  { gold: 240_000, mats: 12 },
  { gold: 450_000, mats: 18 },
  { gold: 900_000, mats: 24 },
  { gold: 1_800_000, mats: 30 },
]

/** B단계 포션(1회 1병, 10분). 같은 포션은 시간만 늘어 최대 20분 */
export type PotionId = 'luck' | 'gold' | 'calm'
export const POTION_IDS: readonly PotionId[] = ['luck', 'gold', 'calm']
export type Recipe = { gold: number; mats: Partial<Record<MatArea, number>> }
export const POTIONS: Readonly<Record<PotionId, Recipe>> = {
  luck: { gold: 6000, mats: { forest: 3, river: 2, lake: 1 } },
  gold: { gold: 1000, mats: { village: 3, tideflat: 2, cave: 1 } },
  calm: { gold: 6000, mats: { river: 2, forest: 2, swamp: 1 } },
}
/** 안정 포션 대체 재료: 늪 1 대신 산정 1(산정만 연 사람이 늪을 살 필요 없게) */
export const CALM_ALT: Recipe = { gold: 6000, mats: { river: 2, forest: 2, summit: 1 } }
export const POTION_MS = 600_000
export const POTION_MAX_MS = 1_200_000
/**
 * 포션 활동 시간(설계 §6.3, 2026-11-28 잠정): 투척에서 거두기까지 서버가 잰 시간만 줄인다. 한 번에 최대 90초.
 * 방치·오프라인·메뉴에서는 줄지 않는다.
 */
export const ACTIVE_CAP_MS = 90_000
/** 행운: 일반 rare 가중치 ×1.2(집어 미끼와 곱해 ×1.44, 장비 뒤 추가 상한 1.5 안) */
export const LUCK_RARE = 1.2
/** 금전: 켜진 동안 새로 잡은 일반 개체에 판매가 15% 보너스, 병당 3,000G까지(감쇠 전) */
export const GOLD_PCT = 15
export const GOLD_BUDGET = 3000
/** 안정: 미니게임 바 기본폭 ×1.10(화면만, 서버는 판정하지 않는다) */
export const CALM_BAR = 1.1

export type Gallery = {
  /** 어종별 기증한 재포획 마릿수(0..2, 전시하면 지운다) */
  donated: Record<string, number>
  /** 영구 전시한 어종(13종 중) */
  exhibits: string[]
  /** 지역 재료 */
  mats: Partial<Record<MatArea, number>>
  /** 남은 포션 활동 시간(ms). 0이면 키를 두지 않는다 */
  potions: Partial<Record<PotionId, number>>
  /** 금전 포션 남은 보너스 예산(G) */
  goldBudget: number
  /** 전시관 확장 단계 0..5 */
  expansions: number
}
export const newGallery = (): Gallery => ({ donated: {}, exhibits: [], mats: {}, potions: {}, goldBudget: 0, expansions: 0 })

const speciesOf = (id: string): Species | undefined => SPECIES.find((s) => s.id === id)
/** 첫 신화 영구 전시(B단계 해금) */
export const stageB = (g: Pick<Gallery, 'exhibits'>): boolean => g.exhibits.some((id) => speciesOf(id)?.rarity === 'mythic')
/** 13종 모두 영구 전시(C단계 해금) */
export const stageC = (g: Pick<Gallery, 'exhibits'>): boolean => SPECIAL_IDS.every((id) => g.exhibits.includes(id))
export const exhibitFee = (id: string): number | null => {
  const s = speciesOf(id)
  return !s?.legend ? null : s.rarity === 'mythic' ? EXHIBIT_FEE.mythic : EXHIBIT_FEE.legend
}
/** 재료 추출 결과: 그 어종 지역과 개수. 전설·신화·재료 없는 지역이면 null */
export function extractYield(id: string): { area: MatArea; n: number } | null {
  const s = speciesOf(id)
  if (!s || s.legend || !isMatArea(s.area)) return null
  const n = MAT_YIELD[s.rarity as keyof typeof MAT_YIELD]
  return n ? { area: s.area, n } : null
}
export const hasMats = (have: Gallery['mats'], need: Recipe['mats']): boolean => Object.entries(need).every(([a, n]) => (have[a as MatArea] ?? 0) >= (n ?? 0))
export function minusMats(have: Gallery['mats'], need: Recipe['mats']): Gallery['mats'] {
  const out: Gallery['mats'] = { ...have }
  for (const [a, n] of Object.entries(need)) {
    const left = (out[a as MatArea] ?? 0) - (n ?? 0)
    if (left > 0) out[a as MatArea] = left
    else delete out[a as MatArea]
  }
  return out
}
export const expansionMats = (stage: number): Recipe['mats'] => Object.fromEntries(EXPANSION_AREAS.map((a) => [a, EXPANSIONS[stage - 1].mats]))
/** 활동 시간만큼 포션을 줄인다(0이 되면 지운다) */
export function drainPotions(p: Gallery['potions'], activeMs: number): Gallery['potions'] {
  const out: Gallery['potions'] = {}
  for (const id of POTION_IDS) {
    const left = (p[id] ?? 0) - activeMs
    if (left > 0) out[id] = left
  }
  return out
}
export const potionOn = (g: Pick<Gallery, 'potions'>, id: PotionId): boolean => (g.potions[id] ?? 0) > 0
/** 쓸 수 있는 땅 어종인가(AreaId 중 재료 지역) */
export const matAreaOf = (a: AreaId): MatArea | null => (isMatArea(a) ? a : null)

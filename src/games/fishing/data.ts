// 낚시 어종·낚싯대 데이터. 순수 데이터, 외부 의존 없음(브라우저·Deno 공용).
import { inHours, tideAt, type Conditions, type Season, type Weather } from './clock.ts'

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legend' | 'mythic'
/** 신화 버프(신화를 잡으면 얻는 영구 강화). 신화마다 서로 다른 하나 */
export type BuffId = 'imugi-scale' | 'dragon-breath' | 'dragon-pearl'
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
  minRod: RodTier
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
  /**
   * 전설·신화 어종(세이브당 한 마리). power는 이 어종이 나오는 데 필요한 최소 던지기 힘 (rollCatch가 확인한다).
   * needs·buff는 신화만: needs는 먼저 잡아야 할 전설 id(그 자리 전설을 모두 넣는다), buff는 잡으면 얻는 버프.
   */
  legend?: { power: number; needs?: readonly string[]; buff?: BuffId }
}
/** 낚싯대 단계. 5·6단계는 6단계 마무리에서 더한 고급 장비(지금 어종 minRod는 1~4. 5부 난파선·신화가 5·6을 쓴다) */
export type RodTier = 1 | 2 | 3 | 4 | 5 | 6
export type Rod = {
  tier: RodTier
  name: string
  price: number
  barBonus: number
  biteScale: number
  weights: Record<'common' | 'uncommon' | 'rare', number>
}

/** tideSpots: 썰물에만 열리는 자리(spotOpen). minRod: 들어가고 던지는 데 필요한 낚싯대 단계(areaMinRod, 없으면 1) */
export type AreaDef = { id: AreaId; name: string; spots: readonly string[]; tideSpots?: readonly string[]; minRod?: RodTier }
export const AREAS: readonly AreaDef[] = [
  { id: 'village', name: '바닷가 마을', spots: ['pier', 'shore'] },
  { id: 'river', name: '마을 강', spots: ['river'] },
  { id: 'forest', name: '숲', spots: ['pond', 'waterfall'] },
  { id: 'lake', name: '산 호수', spots: ['lake'] },
  { id: 'cave', name: '동굴', spots: ['cave1', 'cave2', 'cave3'] },
  { id: 'island', name: '섬', spots: ['sea', 'lagoon'] },
]
export const DEFAULT_AREAS: readonly AreaId[] = ['village', 'river', 'forest']
// 돈으로 여는 지역. 기본 지역(DEFAULT_AREAS)은 여기 없다.
// minRod: 이 단계 이상 낚싯대가 있어야 살 수 있다(서버 unlockArea가 확인)
export const UNLOCKS: Readonly<Partial<Record<AreaId, { price: number; name: string; minRod?: RodTier }>>> = {
  lake: { price: 5000, name: '무너진 다리 수리' },
  cave: { price: 15000, name: '동굴 장비' },
  island: { price: 50000, name: '배' },
}
export const LEGEND_CHANCE = 0.08

// ---------------------------------------------------------------- 물때 자리·지역 최소 낚싯대·신화 (낚시 5부)
/** 화면·서버 시계 차이를 봐주는 여유: 이만큼(게임 분) 전에 열려 있었으면 던지기를 받는다 */
export const TIDE_GRACE_MIN = 10
/** 그 자리가 지금 열려 있는가. tideSpots 자리는 썰물에만. 모르는 지역·자리는 false */
export function spotOpen(area: AreaId, spot: string, gameMinute: number): boolean {
  const a = AREAS.find((x) => x.id === area)
  if (!a || !a.spots.includes(spot)) return false
  return !a.tideSpots?.includes(spot) || tideAt(gameMinute) === 'low'
}
/** 그 지역에 들어가 던지는 데 필요한 낚싯대 단계. 없으면 1 */
export function areaMinRod(area: AreaId): RodTier {
  return AREAS.find((x) => x.id === area)?.minRod ?? 1
}
/** 신화 판정 확률(r0와 비교). 자격 있는 전설이 없을 때만 후보가 된다 */
export const MYTHIC_CHANCE = 0.02
export const BUFFS: readonly { id: BuffId; name: string; desc: string }[] = [
  { id: 'imugi-scale', name: '이무기의 비늘', desc: '입질이 15% 빨라져요' },
  { id: 'dragon-breath', name: '백룡의 숨결', desc: '낚시 바가 8% 길어져요' },
  { id: 'dragon-pearl', name: '용왕의 여의주', desc: '물고기를 8% 비싸게 팔아요' },
]
/** imugiBite: 입질 지연 배율, dragonBar: 바 크기 배율, pearlSell: 판매가 정수 백분율(반올림 오차를 피하려고 정수) */
export const BUFF_FX = { imugiBite: 0.85, dragonBar: 1.08, pearlSell: 108 } as const
export const isBuffId = (v: unknown): v is BuffId => typeof v === 'string' && BUFFS.some((b) => b.id === v)

// ---------------------------------------------------------------- 도전과제·순간이동기
/**
 * 도전과제 판정 조건. 모두 만족해야 센다(과제 지역에서 잡은 것만).
 * spot: 그 자리, perfect: 완벽하게, weather: 그 날씨, night: 밤(20~5시, isNight), minSizePct: 크기 백분위 이상,
 * distinct: 서로 다른 어종 수를 센다. 조건은 모두 던질 때(pending) 기준이다.
 */
export type ChallengeFilter = { spot?: string; perfect?: true; weather?: 'rain'; night?: true; minSizePct?: number; distinct?: true }
export type Challenge = { id: string; area: AreaId; title: string; desc: string; count: number; filter: ChallengeFilter }
// 지역마다 하나(AREAS 순서). 어떤 계절에도 깰 수 있어야 한다(계절 한정 어종을 요구하지 않는다, data.test가 확인).
// 숲은 설계 초안 "폭포에서 3종"이 폭포 어종 2종뿐이라 깰 수 없어 "숲에서 3종"으로 바꿨다.
export const CHALLENGES: readonly Challenge[] = [
  { id: 'pier-perfect', area: 'village', title: '부두의 명수', desc: '부두에서 완벽하게 3마리 낚기', count: 3, filter: { spot: 'pier', perfect: true } },
  { id: 'river-rain', area: 'river', title: '빗속의 강태공', desc: '비 오는 날 강에서 5마리 낚기', count: 5, filter: { weather: 'rain' } },
  { id: 'forest-variety', area: 'forest', title: '숲의 탐험가', desc: '숲에서 서로 다른 물고기 3종 낚기', count: 3, filter: { distinct: true } },
  { id: 'lake-night', area: 'lake', title: '호수의 밤', desc: '밤(20~5시)에 산 호수에서 5마리 낚기', count: 5, filter: { night: true } },
  { id: 'cave-deep', area: 'cave', title: '용암 낚시꾼', desc: '동굴 가장 깊은 용암에서 5마리 낚기', count: 5, filter: { spot: 'cave3' } },
  { id: 'island-big', area: 'island', title: '섬의 대물', desc: '섬에서 크기 상위 30% 물고기 3마리 낚기', count: 3, filter: { minSizePct: 0.7 } },
]
/** 순간이동 요금 = TP_BASE + ceil(두 이동기 세계 거리(칸) / 10) * TP_PER_10 */
export const TP_BASE = 30
export const TP_PER_10 = 1

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
  // 마을 강
  { id: 'pale-chub', name: '피라미', rarity: 'common', basePrice: 20, minCm: 8, maxCm: 15, difficulty: 0.2, minRod: 1, behavior: 'dart', area: 'river' },
  { id: 'dark-chub', name: '갈겨니', rarity: 'common', basePrice: 25, minCm: 10, maxCm: 18, difficulty: 0.25, minRod: 1, behavior: 'mixed', area: 'river' },
  { id: 'skin-carp', name: '누치', rarity: 'common', basePrice: 45, minCm: 25, maxCm: 50, difficulty: 0.3, minRod: 1, behavior: 'smooth', area: 'river', seasons: ['spring', 'summer', 'autumn'], hours: [6, 19] },
  { id: 'aucha-perch', name: '꺽지', rarity: 'uncommon', basePrice: 90, minCm: 12, maxCm: 25, difficulty: 0.45, minRod: 1, behavior: 'sinker', area: 'river' },
  { id: 'sweetfish', name: '은어', rarity: 'uncommon', basePrice: 120, minCm: 15, maxCm: 30, difficulty: 0.5, minRod: 1, behavior: 'dart', area: 'river', seasons: ['summer'], hours: [6, 19] },
  { id: 'catfish', name: '메기', rarity: 'uncommon', basePrice: 130, minCm: 30, maxCm: 80, difficulty: 0.55, minRod: 1, behavior: 'mixed', area: 'river', seasons: ['spring', 'summer', 'autumn'], weather: 'rain' },
  { id: 'mandarin-fish', name: '쏘가리', rarity: 'rare', basePrice: 350, minCm: 25, maxCm: 55, difficulty: 0.7, minRod: 2, behavior: 'mixed', area: 'river' },
  { id: 'eel', name: '뱀장어', rarity: 'rare', basePrice: 400, minCm: 40, maxCm: 90, difficulty: 0.75, minRod: 2, behavior: 'smooth', area: 'river', seasons: ['summer', 'autumn'], hours: [20, 5] },
  { id: 'golden-mandarin', name: '황금 쏘가리', rarity: 'legend', basePrice: 3000, minCm: 50, maxCm: 80, difficulty: 0.92, minRod: 3, behavior: 'mixed', area: 'river', seasons: ['summer'], weather: 'rain', legend: { power: 0.95 } },
  // 숲
  { id: 'crucian', name: '붕어', rarity: 'common', basePrice: 25, minCm: 10, maxCm: 30, difficulty: 0.2, minRod: 1, behavior: 'mixed', area: 'forest', spots: ['pond'] },
  { id: 'carp', name: '잉어', rarity: 'common', basePrice: 40, minCm: 30, maxCm: 80, difficulty: 0.25, minRod: 1, behavior: 'smooth', area: 'forest', spots: ['pond'] },
  { id: 'bluegill', name: '블루길', rarity: 'common', basePrice: 15, minCm: 8, maxCm: 20, difficulty: 0.15, minRod: 1, behavior: 'mixed', area: 'forest', spots: ['pond'], seasons: ['spring', 'summer', 'autumn'], hours: [6, 19] },
  { id: 'loach', name: '미꾸라지', rarity: 'uncommon', basePrice: 60, minCm: 8, maxCm: 18, difficulty: 0.4, minRod: 1, behavior: 'sinker', area: 'forest', spots: ['pond'], seasons: ['spring', 'summer', 'autumn'], weather: 'rain' },
  { id: 'snakehead', name: '가물치', rarity: 'uncommon', basePrice: 150, minCm: 40, maxCm: 90, difficulty: 0.65, minRod: 1, behavior: 'mixed', area: 'forest', spots: ['pond'], seasons: ['summer', 'autumn'], hours: [20, 5] },
  { id: 'stream-minnow', name: '버들치', rarity: 'common', basePrice: 20, minCm: 6, maxCm: 12, difficulty: 0.25, minRod: 1, behavior: 'dart', area: 'forest', spots: ['waterfall'] },
  { id: 'lenok', name: '열목어', rarity: 'rare', basePrice: 380, minCm: 30, maxCm: 70, difficulty: 0.72, minRod: 2, behavior: 'dart', area: 'forest', spots: ['waterfall'], seasons: ['autumn', 'winter'] },
  { id: 'century-snakehead', name: '백년 가물치', rarity: 'legend', basePrice: 2800, minCm: 90, maxCm: 150, difficulty: 0.9, minRod: 3, behavior: 'sinker', area: 'forest', spots: ['pond'], seasons: ['spring'], hours: [20, 5], legend: { power: 0 } },
  // 산 호수
  { id: 'rainbow-trout', name: '무지개송어', rarity: 'common', basePrice: 60, minCm: 25, maxCm: 60, difficulty: 0.35, minRod: 1, behavior: 'mixed', area: 'lake' },
  { id: 'largemouth-bass', name: '큰입배스', rarity: 'common', basePrice: 70, minCm: 25, maxCm: 55, difficulty: 0.4, minRod: 1, behavior: 'mixed', area: 'lake' },
  { id: 'smelt', name: '빙어', rarity: 'common', basePrice: 30, minCm: 8, maxCm: 15, difficulty: 0.3, minRod: 1, behavior: 'dart', area: 'lake', seasons: ['winter'] },
  { id: 'masu-salmon', name: '산천어', rarity: 'uncommon', basePrice: 180, minCm: 20, maxCm: 40, difficulty: 0.55, minRod: 1, behavior: 'dart', area: 'lake', seasons: ['autumn', 'winter'], hours: [6, 19] },
  { id: 'skygazer', name: '강준치', rarity: 'uncommon', basePrice: 160, minCm: 40, maxCm: 90, difficulty: 0.6, minRod: 1, behavior: 'smooth', area: 'lake', seasons: ['spring', 'summer'], weather: 'rain' },
  { id: 'israeli-carp', name: '향어', rarity: 'uncommon', basePrice: 150, minCm: 40, maxCm: 80, difficulty: 0.5, minRod: 1, behavior: 'smooth', area: 'lake', hours: [20, 5] },
  { id: 'sturgeon', name: '철갑상어', rarity: 'rare', basePrice: 700, minCm: 80, maxCm: 160, difficulty: 0.85, minRod: 2, behavior: 'sinker', area: 'lake', seasons: ['summer', 'winter'], hours: [6, 19] },
  { id: 'silver-king-trout', name: '은빛 대왕송어', rarity: 'legend', basePrice: 4000, minCm: 70, maxCm: 120, difficulty: 0.95, minRod: 3, behavior: 'dart', area: 'lake', seasons: ['autumn'], hours: [4, 7], legend: { power: 0.95 } },
  // 동굴
  { id: 'blind-fish', name: '장님고기', rarity: 'common', basePrice: 60, minCm: 8, maxCm: 20, difficulty: 0.3, minRod: 1, behavior: 'mixed', area: 'cave', spots: ['cave1'] },
  { id: 'cave-crayfish', name: '돌가재어', rarity: 'common', basePrice: 70, minCm: 10, maxCm: 25, difficulty: 0.35, minRod: 1, behavior: 'sinker', area: 'cave', spots: ['cave1'] },
  { id: 'crystal-fry', name: '수정치어', rarity: 'common', basePrice: 90, minCm: 6, maxCm: 14, difficulty: 0.45, minRod: 1, behavior: 'dart', area: 'cave', spots: ['cave2'] },
  { id: 'bat-catfish', name: '박쥐메기', rarity: 'uncommon', basePrice: 220, minCm: 30, maxCm: 70, difficulty: 0.65, minRod: 1, behavior: 'smooth', area: 'cave', spots: ['cave2'] },
  { id: 'ember-carp', name: '불꽃잉어', rarity: 'common', basePrice: 150, minCm: 30, maxCm: 60, difficulty: 0.6, minRod: 1, behavior: 'mixed', area: 'cave', spots: ['cave3'] },
  { id: 'lava-eel', name: '용암장어', rarity: 'rare', basePrice: 900, minCm: 60, maxCm: 120, difficulty: 0.9, minRod: 3, behavior: 'mixed', area: 'cave', spots: ['cave3'] },
  { id: 'fire-dragonfish', name: '화룡어', rarity: 'legend', basePrice: 6000, minCm: 90, maxCm: 150, difficulty: 0.98, minRod: 4, behavior: 'dart', area: 'cave', spots: ['cave3'], legend: { power: 0.95 } },
  // 섬
  { id: 'clownfish', name: '흰동가리', rarity: 'common', basePrice: 80, minCm: 6, maxCm: 11, difficulty: 0.35, minRod: 1, behavior: 'mixed', area: 'island', spots: ['lagoon'] },
  { id: 'butterflyfish', name: '나비고기', rarity: 'common', basePrice: 90, minCm: 10, maxCm: 20, difficulty: 0.35, minRod: 1, behavior: 'dart', area: 'island', spots: ['lagoon'] },
  { id: 'blue-damsel', name: '청줄돔', rarity: 'common', basePrice: 85, minCm: 8, maxCm: 18, difficulty: 0.3, minRod: 1, behavior: 'smooth', area: 'island', spots: ['sea'] },
  { id: 'lionfish', name: '쏠배감펭', rarity: 'uncommon', basePrice: 260, minCm: 20, maxCm: 38, difficulty: 0.6, minRod: 1, behavior: 'smooth', area: 'island', spots: ['lagoon'], hours: [20, 5] },
  { id: 'moray', name: '곰치', rarity: 'uncommon', basePrice: 280, minCm: 60, maxCm: 150, difficulty: 0.65, minRod: 1, behavior: 'sinker', area: 'island', spots: ['sea'], weather: 'rain' },
  { id: 'stingray', name: '가오리', rarity: 'rare', basePrice: 650, minCm: 50, maxCm: 120, difficulty: 0.8, minRod: 2, behavior: 'sinker', area: 'island', spots: ['lagoon'] },
  { id: 'mahi', name: '만새기', rarity: 'rare', basePrice: 750, minCm: 60, maxCm: 140, difficulty: 0.82, minRod: 2, behavior: 'dart', area: 'island', spots: ['sea'], hours: [6, 19] },
  { id: 'rainbow-marlin', name: '무지개 청새치', rarity: 'legend', basePrice: 8000, minCm: 150, maxCm: 300, difficulty: 0.98, minRod: 4, behavior: 'dart', area: 'island', spots: ['sea'], hours: [11, 14], weather: 'sun', legend: { power: 0.95 } },
]

export const RODS: Rod[] = [
  { tier: 1, name: '대나무 낚싯대', price: 0, barBonus: 0, biteScale: 1, weights: { common: 70, uncommon: 30, rare: 0 } },
  { tier: 2, name: '유리섬유 낚싯대', price: 1500, barBonus: 0.15, biteScale: 1, weights: { common: 55, uncommon: 33, rare: 12 } },
  { tier: 3, name: '카본 낚싯대', price: 8000, barBonus: 0.3, biteScale: 1, weights: { common: 50, uncommon: 34, rare: 16 } },
  { tier: 4, name: '명장의 낚싯대', price: 40000, barBonus: 0.45, biteScale: 0.8, weights: { common: 46, uncommon: 34, rare: 20 } },
  // 고급 장비(6단계 마무리): 어떤 어종에도 필요 없고, 버는 속도만 조금씩 올린다(효과는 갈수록 작게)
  { tier: 5, name: '백골 낚싯대', price: 280000, barBonus: 0.48, biteScale: 0.72, weights: { common: 44, uncommon: 34, rare: 22 } },
  { tier: 6, name: '용왕의 낚싯대', price: 620000, barBonus: 0.5, biteScale: 0.66, weights: { common: 42, uncommon: 34, rare: 24 } },
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

export type BagTier = 1 | 2 | 3 | 4 | 5
export const BAGS: readonly { tier: BagTier; size: number; price: number }[] = [
  { tier: 1, size: 20, price: 0 },
  { tier: 2, size: 30, price: 800 },
  { tier: 3, size: 40, price: 5000 },
  // 고급 가방(6단계 마무리)
  { tier: 4, size: 50, price: 50000 },
  { tier: 5, size: 60, price: 100000 },
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

// ---------------------------------------------------------------- 찌
export type TackleId = 'cork' | 'trap' | 'barbed' | 'spinner' | 'curious'
export type Tackle = { id: TackleId; name: string; price: number; desc: string }
export const TACKLES: readonly Tackle[] = [
  { id: 'cork', name: '코르크 찌', price: 1000, desc: '낚시 바가 20% 길어져요' },
  { id: 'trap', name: '함정 찌', price: 1500, desc: '물고기가 바 밖일 때 진행도가 25% 덜 줄어요' },
  { id: 'barbed', name: '가시 바늘', price: 2000, desc: '물고기가 바 안에 있으면 바가 물고기 쪽으로 끌려요' },
  { id: 'spinner', name: '회전 찌', price: 1500, desc: '입질이 30% 빨리 와요' },
  { id: 'curious', name: '호기심 찌', price: 5000, desc: '희귀·전설·신화 물고기가 더 잘 나와요' },
]
/** 낚싯대 단계별 찌 칸 수. 1·2단계 0칸, 카본 1칸, 명장·백골 2칸, 용왕 3칸 */
export function tackleSlots(rodTier: number): number {
  return rodTier === 3 ? 1 : rodTier === 4 || rodTier === 5 ? 2 : rodTier === 6 ? 3 : 0
}
export const TACKLE_FX = { corkBar: 1.2, trapDrain: 0.75, spinnerBite: 0.7, curiousRare: 1.5, curiousLegend: 1.5, curiousMythic: 1.5 } as const

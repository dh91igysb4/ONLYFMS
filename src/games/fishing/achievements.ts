// 업적(데일리 과제·업적 설계 2026-11-28 §6, 목록 §2). 순수 모듈.
// 진행값은 세이브(도감·전설·섬·전시관·통계)에서 계산하고, 새로 넘은 단계마다 골드·점수를 준다. 마지막 단계에서 칭호.
import { AREAS, BAGS, RODS, SHOES, SPECIES, TACKLES } from './data.ts'
import { THEMES, THEME_PARTS } from './gallery.ts'
import { ownedFacilities } from './facility.ts'
import type { State } from './logic.ts'

export type AchvCat = 'collect' | 'skill' | 'record' | 'explore' | 'economy' | 'isle' | 'gallery' | 'daily' | 'hidden'
export type AchvDef = {
  id: string
  cat: AchvCat
  name: string
  /** 단계 기준값(오름차순). 단일·숨은 업적은 [1] */
  tiers: readonly number[]
  gold: readonly number[]
  score: readonly number[]
  /** 마지막 단계에서 얻는 칭호 */
  title: string
  /** 기준값 단위(화면 "25/75/169종") */
  unit: string
  /** 숨은 업적 조건 문구(깨기 전엔 ???) */
  hint?: string
}
export type Achv = { tiers: Record<string, number>; title: string | null }
export const newAchv = (): Achv => ({ tiers: {}, title: null })

const T3 = [10, 25, 50] as const
const def = (id: string, cat: AchvCat, name: string, tiers: readonly number[], gold: readonly number[], title: string, unit: string): AchvDef =>
  ({ id, cat, name, tiers, gold, score: tiers.length === 1 ? [30] : T3, title, unit })
const hidden = (id: string, hint: string, title: string): AchvDef =>
  ({ id, cat: 'hidden', name: title, tiers: [1], gold: [20_000], score: [40], title, unit: '', hint })

export const CAT_NAMES: Record<AchvCat, string> = {
  collect: '수집', skill: '숙련', record: '기록', explore: '탐험', economy: '경제', isle: '섬', gallery: '전시관', daily: '데일리', hidden: '숨은 업적',
}

export const ACHIEVEMENTS: readonly AchvDef[] = [
  def('a-dex', 'collect', '도감 채우기', [25, 75, SPECIES.length], [2000, 15000, 80000], '살아 있는 도감', '종'),
  def('a-dex-area', 'collect', '지역 도감 완성', [1, 5, 10], [3000, 15000, 60000], '열 바다의 주인', '지역'),
  def('a-rare-all', 'collect', '희귀 전부', [1, 5, 10], [3000, 12000, 40000], '희귀종 사냥꾼', '지역'),
  def('a-legend', 'collect', '전설 수집', [1, 5, 10], [5000, 20000, 60000], '전설의 낚시꾼', '종'),
  def('a-mythic', 'collect', '신화 수집', [1, 2, 3], [10000, 25000, 80000], '용을 낚은 자', '종'),
  def('a-catch', 'skill', '총 포획', [500, 3000, 10000], [2000, 10000, 40000], '쉬지 않는 손', '마리'),
  def('a-perfect', 'skill', '퍼펙트', [100, 1000, 5000], [2000, 12000, 50000], '완벽주의자', '번'),
  def('a-perfect-run', 'skill', '퍼펙트 연속', [5, 15, 30], [3000, 10000, 30000], '흔들림 없는 바', '번'),
  def('a-legend-perfect', 'skill', '전설·신화를 퍼펙트로', [1, 5, 13], [5000, 20000, 60000], '전설과 한 몸', '종'),
  def('a-big', 'record', '대물(크기 상위 10%)', [10, 50, 150], [2000, 10000, 40000], '대물 낚시꾼', '종'),
  def('a-max', 'record', '최대 크기(상위 1%)', [1, 10, 30], [3000, 15000, 50000], '기록 제조기', '종'),
  def('a-day', 'record', '하루 포획', [100, 200, 300], [2000, 6000, 15000], '새벽부터 밤까지', '마리'),
  def('a-areas', 'explore', '지역 열기', [5, 8, 10], [3000, 10000, 30000], '개척자', '곳'),
  def('a-seasons', 'explore', '네 계절 모두 낚기', [4], [10000], '사계절 낚시꾼', '계절'),
  def('a-tide', 'explore', '갯골 낚시', [10, 50, 200], [2000, 6000, 20000], '물때를 읽는 자', '마리'),
  def('a-ice', 'explore', '얼음 구멍', [50, 200, 500], [3000, 10000, 25000], '얼음 위의 장인', '마리'),
  def('a-abyss', 'explore', '심해', [50, 200, 500], [5000, 15000, 40000], '심연을 본 자', '마리'),
  def('a-teleport', 'explore', '순간이동', [10, 50, 200], [1000, 4000, 10000], '순간이동 마니아', '번'),
  def('a-earned', 'economy', '누적 판매 수입', [100_000, 1_000_000, 10_000_000], [2000, 15000, 60000], '큰손', 'JWD'),
  def('a-sell-clean', 'economy', '감쇠 없이 하루 150마리 팔기', [1, 10, 30], [2000, 8000, 20000], '장사꾼', '일'),
  def('a-gear', 'economy', '장비 다 사기', [1, 2, 3], [3000, 10000, 40000], '장비 수집가', '단계'),
  def('a-research', 'economy', '연구 낚시로 다시 잡기', [5, 20, 26], [5000, 20000, 50000], '연구원', '마리'),
  def('a-clear', 'isle', '개간', [2, 5, 8], [2000, 10000, 30000], '개간왕', '구역'),
  def('a-house', 'isle', '집', [1, 3, 4], [3000, 12000, 40000], '섬의 집주인', '단계'),
  def('a-deco', 'isle', '꾸미기 놓기', [10, 50, 150], [1000, 6000, 20000], '정원사', '개'),
  def('a-furn', 'isle', '가구 놓기', [5, 20, 40], [1000, 5000, 15000], '인테리어 장인', '개'),
  def('a-gather', 'isle', '자원 캐기', [50, 300, 1000], [1000, 6000, 20000], '부지런한 손', '번'),
  def('a-exhibit', 'gallery', '영구 전시', [1, 7, 13], [5000, 25000, 80000], '관장', '종'),
  def('a-expand', 'gallery', '전시관 확장', [1, 3, 5], [5000, 20000, 60000], '건축주', '단계'),
  def('a-theme', 'gallery', '테마 완성', [1, 3, 6], [10000, 30000, 80000], '큐레이터', '테마'),
  def('a-facility', 'gallery', '섬 시설', [1, 2, 3], [10000, 25000, 60000], '섬의 랜드마크', '개'),
  def('a-potion', 'gallery', '포션 마시기', [10, 50, 200], [1000, 5000, 15000], '연금술사', '병'),
  def('a-daily', 'daily', '데일리 셋 다 완료한 날', [7, 30, 100], [3000, 15000, 50000], '성실한 낚시꾼', '일'),
  def('a-weekly', 'daily', '주간 보너스', [4, 12, 30], [3000, 12000, 40000], '꾸준함의 상징', '주'),
  hidden('h-dawn-turtle', '비 오는 새벽(4~8시) 수렁에서 천년 자라', '안개 속의 자라'),
  hidden('h-dragon-perfect', '용왕을 퍼펙트로', '용왕의 벗'),
  hidden('h-two-mythic', '같은 날 신화 2마리', '신화의 날'),
  hidden('h-tiny', '그 종 최소 크기(하위 1%) 물고기 10종', '꼬마 수집가'),
  hidden('h-midnight', '게임 자정대(0~1시)에 전설', '자정의 기적'),
  hidden('h-full-bag', '가방 60칸 가득 채우기', '짐꾼'),
  hidden('h-trash', '쓰레기통에 100마리 버리기', '환경 지킴이'),
  hidden('h-snow-night', '겨울 눈 오는 밤 얼음 구멍에서 퍼펙트', '설야의 낚시꾼'),
]

const FISHING = AREAS.filter((a) => a.spots.length > 0).map((a) => a.id)
const rarity = (id: string) => SPECIES.find((s) => s.id === id)?.rarity
const has = (s: State, id: string) => Object.prototype.hasOwnProperty.call(s.dex, id)

/** 업적 진행값(숨은 업적은 조건을 채웠으면 1) */
export function achvValue(s: State, id: string): number {
  const st = s.stats
  switch (id) {
    case 'a-dex': return SPECIES.filter((x) => has(s, x.id)).length
    case 'a-dex-area': return FISHING.filter((a) => SPECIES.filter((x) => x.area === a).every((x) => has(s, x.id))).length
    case 'a-rare-all': return FISHING.filter((a) => SPECIES.filter((x) => x.area === a && x.rarity === 'rare').every((x) => has(s, x.id))).length
    case 'a-legend': return s.legends.filter((x) => rarity(x) === 'legend').length
    case 'a-mythic': return s.legends.filter((x) => rarity(x) === 'mythic').length
    case 'a-catch': return st.catches
    case 'a-perfect': return st.perfects
    case 'a-perfect-run': return st.perfectBest
    case 'a-legend-perfect': return st.legendPerfect.length
    case 'a-big': return st.big.length
    case 'a-max': return st.max.length
    case 'a-day': return st.dayBest
    case 'a-areas': return FISHING.filter((a) => s.areas.includes(a)).length
    case 'a-seasons': return st.seasons.length
    case 'a-tide': return st.bySpot['tideflat:creek'] ?? 0
    case 'a-ice': return st.bySpot['summit:ice'] ?? 0
    case 'a-abyss': return st.bySpot['wreck:abyss'] ?? 0
    case 'a-teleport': return st.teleports
    case 'a-earned': return s.totalEarned
    case 'a-sell-clean': return st.cleanDays
    case 'a-gear': {
      const topBag = Math.max(...BAGS.map((b) => b.tier))
      const topShoe = Math.max(...SHOES.map((x) => x.tier))
      const topRod = Math.max(...RODS.map((r) => r.tier))
      if (s.rodTier < 4) return 0
      if (s.bagTier < topBag || s.shoesTier < topShoe) return 1
      return s.rodTier >= topRod && TACKLES.every((t) => s.tackles.includes(t.id)) ? 3 : 2
    }
    case 'a-research': return st.researchCatches
    case 'a-clear': return s.isle?.cleared ?? 0
    case 'a-house': return s.isle?.house ?? 0
    case 'a-deco': return s.isle?.deco.length ?? 0
    case 'a-furn': return s.isle?.placed.length ?? 0
    case 'a-gather': return st.gathers
    case 'a-exhibit': return s.gallery.exhibits.length
    case 'a-expand': return s.gallery.expansions
    case 'a-theme': return THEMES.filter((t) => THEME_PARTS.every((p) => s.gallery.projects.includes(`${t.id}-${p.part}`))).length
    case 'a-facility': return ownedFacilities(s.gallery.projects).length
    case 'a-potion': return st.potions
    case 'a-daily': return st.dailyDays
    case 'a-weekly': return st.weeklies
    default: return st.hidden.includes(id) ? 1 : 0
  }
}

/** 진행값으로 닿은 단계(0..단계 수) */
export const reachedTier = (d: AchvDef, v: number): number => d.tiers.filter((t) => v >= t).length

/** 새로 넘은 단계를 지급한다: 단계를 올리고 골드 합계와 받은 목록을 돌려준다 */
export function grantAchievements(s: State): { state: State; gold: number; got: { id: string; tier: number; gold: number }[] } {
  let tiers = s.achv.tiers
  let gold = 0
  const got: { id: string; tier: number; gold: number }[] = []
  for (const d of ACHIEVEMENTS) {
    const have = tiers[d.id] ?? 0
    const reach = reachedTier(d, achvValue(s, d.id))
    if (reach <= have) continue
    for (let t = have + 1; t <= reach; t++) {
      gold += d.gold[t - 1]
      got.push({ id: d.id, tier: t, gold: d.gold[t - 1] })
    }
    tiers = { ...tiers, [d.id]: reach }
  }
  return got.length === 0 ? { state: s, gold: 0, got } : { state: { ...s, achv: { ...s.achv, tiers } }, gold, got }
}

/** 업적 점수 합계·받은 단계 수 */
export function achvScore(a: Achv): { score: number; count: number } {
  let score = 0
  let count = 0
  for (const d of ACHIEVEMENTS) {
    const t = a.tiers[d.id] ?? 0
    for (let i = 0; i < t; i++) score += d.score[i]
    count += t
  }
  return { score, count }
}

/** 칭호를 가졌는가(그 업적 마지막 단계) */
export const hasTitle = (a: Achv, id: string): boolean => {
  const d = ACHIEVEMENTS.find((x) => x.id === id)
  return !!d && (a.tiers[id] ?? 0) >= d.tiers.length
}
export const titleText = (id: string | null): string | null => (id ? ACHIEVEMENTS.find((x) => x.id === id)?.title ?? null : null)

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
/** 세이브에서 읽기: 알려진 업적 id·단계 범위만, 칭호는 가진 것만 */
export function migrateAchv(raw: unknown): Achv {
  if (!isObj(raw)) return newAchv()
  const tiers: Record<string, number> = {}
  if (isObj(raw.tiers)) for (const d of ACHIEVEMENTS) {
    const v = raw.tiers[d.id]
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) tiers[d.id] = Math.min(v, d.tiers.length)
  }
  const a: Achv = { tiers, title: null }
  return typeof raw.title === 'string' && hasTitle(a, raw.title) ? { ...a, title: raw.title } : a
}

/** 모든 단계를 받은 업적 상태(시험에서 업적 골드를 빼고 보고 싶을 때) */
export const DONE_ACHV: Achv = { tiers: Object.fromEntries(ACHIEVEMENTS.map((d) => [d.id, d.tiers.length])), title: null }

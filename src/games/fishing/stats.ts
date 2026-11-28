// 낚시 통계(데일리 과제·업적 설계 2026-11-28 §3). 순수 모듈.
// 사건(goalEvents.ts)으로만 갱신한다. 업적 진행값과 숨은 업적 판정의 원본이다.
import { isNight, type Conditions, type Season } from './clock.ts'
import { SPECIES, type AreaId } from './data.ts'

const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter']
const KST_MS = 9 * 3600 * 1000

/** 한국 시간 날짜 'YYYY-MM-DD'(logic.kstDay와 같다) */
export const kstDayOf = (now: number): string => new Date(now + KST_MS).toISOString().slice(0, 10)

/** 크기 백분위 0..1(logic.sizePercentile과 같다). 모르는 어종은 0 */
export function sizePct(speciesId: string, sizeCm: number): number {
  const s = SPECIES.find((x) => x.id === speciesId)
  if (!s) return 0
  return Math.min(1, Math.max(0, (sizeCm - s.minCm) / (s.maxCm - s.minCm)))
}

/** 행동 하나에서 뽑은 사건(goalEvents.ts). 데일리·통계·숨은 업적이 이것만 본다 */
export type GoalEvent =
  | {
      k: 'catch'; species: string; sizeCm: number; perfect: boolean; area: AreaId; spot: string; cond: Conditions
      /** 연구 투척으로 대상을 잡음(origin recatch) */
      research: boolean
      /** 던진 동안 포션이 하나라도 켜져 있었음 */
      potion: boolean
      /** 잡은 뒤 가방이 가득 참 */
      bagFull: boolean
      /** 가방 크기(칸) */
      bagCap: number
    }
  | { k: 'miss' }
  | { k: 'sell'; n: number; income: number; soldBefore: number }
  | { k: 'meal'; n: number }
  | { k: 'gather' }
  | { k: 'teleport' }
  | { k: 'trash'; n: number }
  | { k: 'potion' }
  | { k: 'extract'; n: number }
  | { k: 'researchCast' }

export type StatsDay = { day: string; catches: number; income: number; sold: number; mythics: number }
export type Stats = {
  catches: number
  perfects: number
  /** 지금 이어지는 퍼펙트 연속(퍼펙트 아닌 포획·놓침이면 0) */
  perfectRun: number
  perfectBest: number
  /** 'area:spot' → 마릿수 */
  bySpot: Record<string, number>
  /** 크기 상위 10%(≥ 0.9)로 잡아 본 어종 */
  big: string[]
  /** 상위 1%(≥ 0.99) */
  max: string[]
  /** 하위 1%(≤ 0.01) */
  tiny: string[]
  seasons: Season[]
  day: StatsDay
  /** 하루 포획 최고 */
  dayBest: number
  /** 감쇠 없이 150마리를 판 날 수 */
  cleanDays: number
  teleports: number
  trash: number
  gathers: number
  potions: number
  researchCatches: number
  /** 퍼펙트로 잡은 전설·신화 */
  legendPerfect: string[]
  /** 데일리 셋 다 완료한 날 수 · 주간 보너스 받은 수 */
  dailyDays: number
  weeklies: number
  /** 조건을 채운 숨은 업적 id */
  hidden: string[]
}

/** 감쇠 없는 판매 마릿수(SELL_DECAY 첫 단). cleanDays가 센다 */
export const CLEAN_SELL = 150

export const newDay = (day = ''): StatsDay => ({ day, catches: 0, income: 0, sold: 0, mythics: 0 })
export const newStats = (): Stats => ({
  catches: 0, perfects: 0, perfectRun: 0, perfectBest: 0, bySpot: {}, big: [], max: [], tiny: [], seasons: [],
  day: newDay(), dayBest: 0, cleanDays: 0, teleports: 0, trash: 0, gathers: 0, potions: 0, researchCatches: 0,
  legendPerfect: [], dailyDays: 0, weeklies: 0, hidden: [],
})

const add = (list: readonly string[], id: string): string[] => (list.includes(id) ? [...list] : [...list, id])
const rarityOf = (id: string) => SPECIES.find((s) => s.id === id)?.rarity

/** 숨은 업적 조건(설계 §6). 사건 하나와 갱신된 통계로 판정한다 */
function hiddenMet(e: GoalEvent, s: Stats): string[] {
  const out: string[] = []
  if (e.k === 'trash' && s.trash >= 100) out.push('h-trash')
  if (e.k !== 'catch') return out
  const h = e.cond.gameMinute / 60
  const rain = e.cond.weather === 'rain'
  if (e.species === 'thousand-turtle' && rain && h >= 4 && h < 8) out.push('h-dawn-turtle')
  if (e.species === 'dragon-king' && e.perfect) out.push('h-dragon-perfect')
  if (s.day.mythics >= 2) out.push('h-two-mythic')
  if (s.tiny.length >= 10) out.push('h-tiny')
  if (rarityOf(e.species) === 'legend' && h < 1) out.push('h-midnight')
  if (e.bagFull && e.bagCap >= 60) out.push('h-full-bag')
  if (e.spot === 'ice' && e.perfect && e.cond.season === 'winter' && rain && isNight(e.cond.gameMinute)) out.push('h-snow-night')
  return out
}

/** 사건들로 통계를 갱신한다. now는 하루(KST) 경계에만 쓴다 */
export function applyStats(s0: Stats, events: readonly GoalEvent[], now: number): Stats {
  const today = kstDayOf(now)
  let s: Stats = { ...s0, day: s0.day.day === today ? { ...s0.day } : newDay(today) }
  for (const e of events) {
    switch (e.k) {
      case 'catch': {
        const p = sizePct(e.species, e.sizeCm)
        const key = `${e.area}:${e.spot}`
        const special = rarityOf(e.species) === 'legend' || rarityOf(e.species) === 'mythic'
        const run = e.perfect ? s.perfectRun + 1 : 0
        const day = { ...s.day, catches: s.day.catches + 1, mythics: s.day.mythics + (rarityOf(e.species) === 'mythic' ? 1 : 0) }
        s = {
          ...s,
          catches: s.catches + 1,
          perfects: s.perfects + (e.perfect ? 1 : 0),
          perfectRun: run,
          perfectBest: Math.max(s.perfectBest, run),
          bySpot: { ...s.bySpot, [key]: (s.bySpot[key] ?? 0) + 1 },
          big: p >= 0.9 ? add(s.big, e.species) : s.big,
          max: p >= 0.99 ? add(s.max, e.species) : s.max,
          tiny: p <= 0.01 ? add(s.tiny, e.species) : s.tiny,
          seasons: s.seasons.includes(e.cond.season) ? s.seasons : SEASONS.filter((x) => x === e.cond.season || s.seasons.includes(x)),
          day,
          dayBest: Math.max(s.dayBest, day.catches),
          researchCatches: s.researchCatches + (e.research ? 1 : 0),
          legendPerfect: special && e.perfect ? add(s.legendPerfect, e.species) : s.legendPerfect,
        }
        break
      }
      case 'miss':
        s = { ...s, perfectRun: 0 }
        break
      case 'sell': {
        const sold = s.day.sold + e.n
        // 그날 판 마릿수가 처음으로 CLEAN_SELL에 닿는 판매에서 한 번 센다(감쇠 없이 150마리 판 날)
        const clean = s.day.sold < CLEAN_SELL && sold >= CLEAN_SELL && e.soldBefore < CLEAN_SELL
        s = { ...s, day: { ...s.day, sold, income: s.day.income + e.income }, cleanDays: s.cleanDays + (clean ? 1 : 0) }
        break
      }
      case 'gather':
        s = { ...s, gathers: s.gathers + 1 }
        break
      case 'teleport':
        s = { ...s, teleports: s.teleports + 1 }
        break
      case 'trash':
        s = { ...s, trash: s.trash + e.n }
        break
      case 'potion':
        s = { ...s, potions: s.potions + 1 }
        break
      default:
        break
    }
    for (const id of hiddenMet(e, s)) if (!s.hidden.includes(id)) s = { ...s, hidden: [...s.hidden, id] }
  }
  return s
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0)
const known = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && SPECIES.some((s) => s.id === x)))] : [])

/**
 * 세이브에서 읽기(v31). 처음(v30 이하)이면 도감으로 소급한다: 총 포획 = 도감 count 합, 대물·최대 = 도감 maxCm 백분위,
 * 연구 재포획 = 기증 수 + 전시 수 × 2. 나머지는 0부터.
 */
export function migrateStats(raw: unknown, dex: Record<string, { count: number; maxCm: number }>, gallery: { donated: Record<string, number>; exhibits: readonly string[] }): Stats {
  const base = newStats()
  if (!isObj(raw)) {
    const entries = Object.entries(dex)
    return {
      ...base,
      catches: entries.reduce((a, [, e]) => a + e.count, 0),
      big: entries.filter(([id, e]) => sizePct(id, e.maxCm) >= 0.9).map(([id]) => id),
      max: entries.filter(([id, e]) => sizePct(id, e.maxCm) >= 0.99).map(([id]) => id),
      researchCatches: Object.values(gallery.donated).reduce((a, n) => a + n, 0) + gallery.exhibits.length * 2,
    }
  }
  const d = isObj(raw.day) ? raw.day : {}
  const bySpot: Record<string, number> = {}
  if (isObj(raw.bySpot)) for (const [k, v] of Object.entries(raw.bySpot)) if (/^[a-z0-9]+:[a-z0-9]+$/.test(k) && int(v) > 0) bySpot[k] = int(v)
  const hiddenIds = ['h-dawn-turtle', 'h-dragon-perfect', 'h-two-mythic', 'h-tiny', 'h-midnight', 'h-full-bag', 'h-trash', 'h-snow-night']
  return {
    catches: int(raw.catches), perfects: int(raw.perfects), perfectRun: int(raw.perfectRun), perfectBest: int(raw.perfectBest),
    bySpot, big: known(raw.big), max: known(raw.max), tiny: known(raw.tiny),
    seasons: Array.isArray(raw.seasons) ? SEASONS.filter((x) => (raw.seasons as unknown[]).includes(x)) : [],
    day: { day: typeof d.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.day) ? d.day : '', catches: int(d.catches), income: int(d.income), sold: int(d.sold), mythics: int(d.mythics) },
    dayBest: int(raw.dayBest), cleanDays: int(raw.cleanDays), teleports: int(raw.teleports), trash: int(raw.trash),
    gathers: int(raw.gathers), potions: int(raw.potions), researchCatches: int(raw.researchCatches),
    legendPerfect: known(raw.legendPerfect), dailyDays: int(raw.dailyDays), weeklies: int(raw.weeklies),
    hidden: Array.isArray(raw.hidden) ? hiddenIds.filter((x) => (raw.hidden as unknown[]).includes(x)) : [],
  }
}

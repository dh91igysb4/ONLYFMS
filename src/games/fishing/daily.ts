// 데일리 과제(데일리 과제·업적 설계 2026-11-28 §5, 목록 §0·§1). 순수 모듈.
// 한국 시간 하루 첫 행동 때 그 사람이 할 수 있는 과제만 쉬움·보통·어려움 하나씩 뽑아 세이브에 둔다. 보상은 골드 없이 어분·미끼·재료.
import { conditionsAt, GAME_DAY_MS, weatherOf, type Season } from './clock.ts'
import { AREAS, SPECIES, type AreaId } from './data.ts'
import { MAT_MAX, stageB, type MatArea } from './gallery.ts'
import { MAT_CAP, type Mats } from './isleEcon.ts'
import { isleNodes } from './isle.ts'
import { featureOn, type BaitKind } from './research.ts'
import { kstDayOf, sizePct, type GoalEvent } from './stats.ts'
import type { State } from './logic.ts'

export type Tier = 'easy' | 'normal' | 'hard'
export const TIERS: readonly Tier[] = ['easy', 'normal', 'hard']
export type Reward = { meal?: number; baits?: Partial<Record<BaitKind, number>>; mats?: Partial<Record<MatArea, number>>; isle?: Partial<Mats> }
export type DailyTask = {
  id: string
  tier: Tier
  target: number
  progress: number
  done: boolean
  area?: AreaId
  spot?: string
  species?: string
  /** d-variety: 이 자리에서 잡은 어종 */
  seen?: string[]
  /** d-two-areas: 지역별 마릿수 */
  perArea?: Record<string, number>
  /** d-perfect-run: 오늘 지금 이어지는 연속 퍼펙트 */
  run?: number
  reward: Reward
}
export type Daily = {
  day: string
  tasks: DailyTask[]
  rerolled: boolean
  allDone: boolean
  week: { start: string; days: number; claimed: boolean }
}
export const newDaily = (): Daily => ({ day: '', tasks: [], rerolled: false, allDone: false, week: { start: '', days: 0, claimed: false } })

/** 진행 단계(보상 품목): P0 허가증 없음, P1 허가증 있음, P2 첫 신화 전시(B단계) */
export type Stage = 0 | 1 | 2
export const stageOf = (s: Pick<State, 'econ' | 'gallery'>): Stage => (stageB(s.gallery) ? 2 : s.econ.license ? 1 : 0)

/** 진행 단계별 낚싯대 시간당 판매 수입(감쇠 전, econSim.bestSpot ±5%, daily.test가 지킨다). d-income 목표 = 이 값 × 0.5 */
export const INCOME_REF: Readonly<Record<number, number>> = { 1: 12600, 2: 21500, 3: 55300, 4: 90200, 5: 141300, 6: 161300 }
/** 셋 다 완료한 날이 주에 이만큼이면 주간 보너스 */
export const WEEK_NEED = 5

const FISHING = AREAS.filter((a) => a.spots.length > 0).map((a) => a.id)
const DEEP: readonly [AreaId, string][] = [['cave', 'cave3'], ['summit', 'ice'], ['wreck', 'abyss']]
const AREA_NAME = Object.fromEntries(AREAS.map((a) => [a.id, a.name])) as Record<AreaId, string>

type Ctx = { rod: number; areas: AreaId[]; season: Season; rainToday: boolean; isleNodes: number; stage: Stage }
type Picked = { area?: AreaId; spot?: string; species?: string }
type Cand = {
  id: string
  tier: Tier
  /** 낚싯대 1 → 6 목표(선형, 반올림). 같으면 고정 */
  n: readonly [number, number]
  ok: (s: State, c: Ctx) => boolean
  /** 인자 고르기. null이면 이 후보는 못 뽑는다 */
  pick?: (s: State, c: Ctx, rng: () => number) => Picked | null
  extra?: (s: State, p: Picked) => Reward
}
const any = <T>(xs: readonly T[], rng: () => number): T | null => (xs.length ? xs[Math.floor(rng() * xs.length)] : null)
const always = () => true
/** 그 사람 낚싯대로 오늘 계절에 그 자리에서 나오는 일반 어종(시간·날씨는 하루 안에 온다고 본다) */
function spotSpecies(area: AreaId, spot: string, c: Ctx): string[] {
  return SPECIES.filter((s) => s.area === area && !s.legend && s.minRod <= c.rod && (!s.spots || s.spots.includes(spot)) && (!s.seasons || s.seasons.includes(c.season))).map((s) => s.id)
}
const spotsOf = (area: AreaId) => AREAS.find((a) => a.id === area)?.spots ?? []
const lowestIsle = (s: State): keyof Mats => (s.isle && s.isle.mats.stone < s.isle.mats.wood ? 'stone' : 'wood')

export const CANDIDATES: readonly Cand[] = [
  { id: 'd-any', tier: 'easy', n: [15, 25], ok: always },
  { id: 'd-area', tier: 'easy', n: [8, 12], ok: always, pick: (_s, c, rng) => ({ area: any(c.areas, rng)! }) },
  {
    id: 'd-species', tier: 'easy', n: [1, 1], ok: always,
    pick: (_s, c, rng) => {
      const pool = SPECIES.filter((s) => c.areas.includes(s.area) && (s.rarity === 'common' || s.rarity === 'uncommon') && s.minRod <= c.rod && (!s.seasons || s.seasons.includes(c.season)))
      const sp = any(pool, rng)
      return sp ? { species: sp.id, area: sp.area } : null
    },
  },
  { id: 'd-perfect', tier: 'easy', n: [3, 5], ok: always },
  { id: 'd-sell', tier: 'easy', n: [20, 40], ok: always },
  { id: 'd-gather', tier: 'easy', n: [3, 6], ok: (s, c) => !!s.isle && c.isleNodes >= 6, extra: (s) => ({ isle: { [lowestIsle(s)]: 2 } }) },
  { id: 'd-potion', tier: 'easy', n: [10, 10], ok: (_s, c) => c.stage === 2 && featureOn('alchemy') },
  { id: 'd-uncommon', tier: 'normal', n: [4, 8], ok: always, extra: () => ({ meal: 3 }) },
  { id: 'd-big', tier: 'normal', n: [3, 5], ok: always },
  {
    id: 'd-variety', tier: 'normal', n: [3, 5], ok: always,
    pick: (_s, c, rng) => {
      const need = target([3, 5], c.rod)
      const spots = c.areas.flatMap((a) => spotsOf(a).map((spot) => [a, spot] as const)).filter(([a, spot]) => spotSpecies(a, spot, c).length >= need + 2)
      const p = any(spots, rng)
      return p ? { area: p[0], spot: p[1] } : null
    },
  },
  { id: 'd-night', tier: 'normal', n: [5, 10], ok: always },
  { id: 'd-rain', tier: 'normal', n: [5, 8], ok: (_s, c) => c.rainToday },
  { id: 'd-pier', tier: 'normal', n: [5, 5], ok: always },
  { id: 'd-grind', tier: 'normal', n: [5, 15], ok: () => featureOn('bait'), extra: () => ({ baits: { attractor: 2 } }) },
  { id: 'd-tide', tier: 'normal', n: [5, 5], ok: (_s, c) => c.areas.includes('tideflat') },
  { id: 'd-extract', tier: 'normal', n: [10, 10], ok: (_s, c) => c.stage === 2 && featureOn('alchemy'), extra: () => ({ mats: { forest: 3 } }) },
  { id: 'd-rare', tier: 'hard', n: [2, 4], ok: (_s, c) => c.rod >= 2, extra: () => ({ baits: { attractor: 3 } }) },
  { id: 'd-perfect-run', tier: 'hard', n: [3, 5], ok: always },
  { id: 'd-perfect-rare', tier: 'hard', n: [3, 3], ok: (_s, c) => c.rod >= 3 },
  {
    id: 'd-deep', tier: 'hard', n: [5, 10], ok: (_s, c) => DEEP.some(([a]) => c.areas.includes(a)),
    pick: (_s, c, rng) => {
      const d = any(DEEP.filter(([a]) => c.areas.includes(a)), rng)
      return d ? { area: d[0], spot: d[1] } : null
    },
    extra: (_s, p) => ({ mats: { [p.area as MatArea]: 3 } }),
  },
  { id: 'd-income', tier: 'hard', n: [0, 0], ok: always },
  { id: 'd-two-areas', tier: 'hard', n: [3, 3], ok: (_s, c) => c.areas.length >= 4 },
  { id: 'd-research', tier: 'hard', n: [5, 5], ok: (s) => s.econ.license && featureOn('research'), extra: () => ({ baits: { legend: 1 } }) },
]

/** 낚싯대 단계로 목표 수 */
export function target(n: readonly [number, number], rod: number): number {
  return Math.round(n[0] + ((n[1] - n[0]) * (Math.min(6, Math.max(1, rod)) - 1)) / 5)
}

/** 난이도·진행 단계별 기본 보상(목록 §0) */
export function baseReward(tier: Tier, stage: Stage, area: MatArea): Reward {
  if (tier === 'easy') return { meal: 3 }
  if (tier === 'normal') return stage === 2 ? { meal: 5, mats: { [area]: 5 } } : { meal: 5, baits: { attractor: 2 } }
  return stage === 0 ? { baits: { attractor: 5 } } : stage === 1 ? { baits: { legend: 1 } } : { baits: { legend: 1 }, mats: { [area]: 5 } }
}
/** 셋 다 완료 보너스 */
export function allDoneReward(stage: Stage, s: Pick<State, 'isle'>): Reward {
  if (stage === 0) return s.isle ? { isle: { [s.isle.mats.stone < s.isle.mats.wood ? 'stone' : 'wood']: 5 } } : { meal: 5 }
  return stage === 1 ? { baits: { legend: 1 }, meal: 5 } : { baits: { mythic: 1 }, meal: 5 }
}
/** 주간 보너스(7일 중 WEEK_NEED일) */
export function weeklyReward(stage: Stage, s: Pick<State, 'isle'>): Reward {
  if (stage === 0) return s.isle ? { baits: { attractor: 10 }, isle: { iron: 5 } } : { baits: { attractor: 10 }, meal: 10 }
  return stage === 1 ? { baits: { legend: 3 } } : { baits: { mythic: 2 }, mats: { village: 10 } }
}

function mergeReward(a: Reward, b: Reward): Reward {
  const out: Reward = {}
  const sum = <K extends string>(x?: Partial<Record<K, number>>, y?: Partial<Record<K, number>>) => {
    const m: Partial<Record<K, number>> = { ...(x ?? {}) }
    for (const [k, v] of Object.entries(y ?? {}) as [K, number][]) m[k] = (m[k] ?? 0) + v
    return Object.keys(m).length ? m : undefined
  }
  const meal = (a.meal ?? 0) + (b.meal ?? 0)
  if (meal) out.meal = meal
  const baits = sum(a.baits, b.baits); if (baits) out.baits = baits
  const mats = sum(a.mats, b.mats); if (mats) out.mats = mats
  const isle = sum(a.isle, b.isle); if (isle) out.isle = isle
  return out
}

/** 그 KST 날짜(게임 날 60일) 중 비 오는 게임 날이 있는가 */
export function rainOnDay(day: string): boolean {
  // 게임 날 번호는 floor((now + 9시간) / 게임 하루)라, KST 날짜의 자정을 UTC처럼 읽은 값이 그날 첫 게임 날의 기준이다
  const start = Date.parse(`${day}T00:00:00Z`)
  const first = Math.floor(start / GAME_DAY_MS)
  const last = Math.floor((start + 86_400_000 - 1) / GAME_DAY_MS)
  for (let d = first; d <= last; d++) if (weatherOf(d) === 'rain') return true
  return false
}
/** 그 KST 날짜가 속한 주의 월요일 */
export function weekStart(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`)
  const dow = (new Date(t).getUTCDay() + 6) % 7
  return new Date(t - dow * 86_400_000).toISOString().slice(0, 10)
}

function ctxOf(s: State, now: number): Ctx {
  const isle = s.isle
  return {
    rod: s.rodTier,
    areas: FISHING.filter((a) => s.areas.includes(a)),
    season: conditionsAt(now).season,
    rainToday: rainOnDay(kstDayOf(now)),
    isleNodes: isle ? isleNodes(isle.layout).filter((n) => n.zone <= isle.cleared).length : 0,
    stage: stageOf(s),
  }
}

function makeTask(s: State, c: Ctx, cand: Cand, rng: () => number): DailyTask | null {
  if (!cand.ok(s, c)) return null
  const p = cand.pick ? cand.pick(s, c, rng) : {}
  if (!p) return null
  const goal = cand.id === 'd-income' ? Math.max(100, Math.round((INCOME_REF[c.rod] * 0.5) / 100) * 100) : target(cand.n, c.rod)
  const area = (p.area ?? 'village') as MatArea
  const reward = mergeReward(baseReward(cand.tier, c.stage, area), cand.extra ? cand.extra(s, p) : {})
  return { id: cand.id, tier: cand.tier, target: goal, progress: 0, done: false, ...p, reward }
}

function drawTask(s: State, c: Ctx, tier: Tier, used: readonly string[], rng: () => number): DailyTask | null {
  const pool = CANDIDATES.filter((x) => x.tier === tier && !used.includes(x.id))
  // 순서를 섞어 하나씩 시도한다(인자 고르기가 실패하는 후보를 건너뛴다)
  const order = pool.map((x) => ({ x, r: rng() })).sort((a, b) => a.r - b.r).map((o) => o.x)
  for (const cand of order) {
    const t = makeTask(s, c, cand, rng)
    if (t) return t
  }
  return null
}

/**
 * 오늘 과제가 없으면 뽑는다. 주가 바뀌었으면 주간 집계를 새로 시작한다.
 * logic.apply는 행동을 처리한 **뒤에** 서버 난수로 부른다(행동의 낚시 판정 난수 순서를 바꾸지 않게). 그래서 그날 첫 행동의 사건은 새 과제에 세지 않는다
 * (화면이 낚시 화면을 열 때 dailyOpen을 먼저 보낸다).
 */
export function ensureDaily(s: State, now: number, rng: () => number): State {
  const day = kstDayOf(now)
  if (s.daily.day === day) return s
  const c = ctxOf(s, now)
  const tasks: DailyTask[] = []
  for (const tier of TIERS) {
    const t = drawTask(s, c, tier, tasks.map((x) => x.id), rng)
    if (t) tasks.push(t)
  }
  const ws = weekStart(day)
  const week = s.daily.week.start === ws ? s.daily.week : { start: ws, days: 0, claimed: false }
  return { ...s, daily: { day, tasks, rerolled: false, allDone: false, week } }
}

/** 리롤: 하루 1번, 끝나지 않은 과제 하나를 같은 난이도의 오늘 안 나온 후보로 */
export function rerollDaily(s: State, index: unknown, now: number, rng: () => number): { state: State } | { error: string } {
  const d = s.daily
  if (d.day !== kstDayOf(now)) return { error: 'daily_stale' }
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= d.tasks.length) return { error: 'bad_action' }
  if (d.rerolled) return { error: 'rerolled' }
  const old = d.tasks[index]
  if (old.done) return { error: 'task_done' }
  const used = d.tasks.map((t) => t.id)
  const t = drawTask(s, ctxOf(s, now), old.tier, used, rng)
  if (!t) return { error: 'no_reroll' }
  const tasks = d.tasks.map((x, i) => (i === index ? t : x))
  return { state: { ...s, daily: { ...d, tasks, rerolled: true } } }
}

/** 사건 하나가 과제에 더하는 진행. 특수 집계(서로 다른 종·지역별·연속)는 과제를 바꿔 돌려준다 */
function step(t: DailyTask, e: GoalEvent): DailyTask {
  const inc = (n: number) => ({ ...t, progress: t.progress + n })
  const r = e.k === 'catch' ? SPECIES.find((x) => x.id === e.species)?.rarity : undefined
  const night = e.k === 'catch' && (e.cond.gameMinute >= 20 * 60 || e.cond.gameMinute < 5 * 60)
  switch (t.id) {
    case 'd-any':
      return e.k === 'catch' ? inc(1) : t
    case 'd-area':
    case 'd-tide':
      return e.k === 'catch' && e.area === (t.id === 'd-tide' ? 'tideflat' : t.area) && (t.id !== 'd-tide' || e.spot === 'creek') ? inc(1) : t
    case 'd-deep':
      return e.k === 'catch' && e.area === t.area && e.spot === t.spot ? inc(1) : t
    case 'd-species':
      return e.k === 'catch' && e.species === t.species ? inc(1) : t
    case 'd-perfect':
      return e.k === 'catch' && e.perfect ? inc(1) : t
    case 'd-perfect-rare':
      return e.k === 'catch' && e.perfect && r !== 'common' ? inc(1) : t
    case 'd-perfect-run': {
      if (e.k !== 'catch' && e.k !== 'miss') return t
      const run = e.k === 'catch' && e.perfect ? (t.run ?? 0) + 1 : 0
      return { ...t, run, progress: Math.max(t.progress, run) }
    }
    case 'd-uncommon':
      return e.k === 'catch' && r !== 'common' ? inc(1) : t
    case 'd-rare':
      return e.k === 'catch' && (r === 'rare' || r === 'legend' || r === 'mythic') ? inc(1) : t
    case 'd-big':
      return e.k === 'catch' && sizePct(e.species, e.sizeCm) >= 0.7 ? inc(1) : t
    case 'd-pier':
      return e.k === 'catch' && e.spot === 'pier' && sizePct(e.species, e.sizeCm) >= 0.5 ? inc(1) : t
    case 'd-variety': {
      if (e.k !== 'catch' || e.area !== t.area || e.spot !== t.spot) return t
      const seen = (t.seen ?? []).includes(e.species) ? t.seen ?? [] : [...(t.seen ?? []), e.species]
      return { ...t, seen, progress: seen.length }
    }
    case 'd-night':
      return e.k === 'catch' && night ? inc(1) : t
    case 'd-rain':
      return e.k === 'catch' && e.cond.weather === 'rain' ? inc(1) : t
    case 'd-two-areas': {
      if (e.k !== 'catch') return t
      const perArea = { ...(t.perArea ?? {}), [e.area]: ((t.perArea ?? {})[e.area] ?? 0) + 1 }
      return { ...t, perArea, progress: Object.values(perArea).filter((n) => n >= 5).length }
    }
    case 'd-sell':
      return e.k === 'sell' ? inc(e.n) : t
    case 'd-income':
      return e.k === 'sell' ? inc(e.income) : t
    case 'd-grind':
      return e.k === 'meal' ? inc(e.n) : t
    case 'd-gather':
      return e.k === 'gather' ? inc(1) : t
    case 'd-extract':
      return e.k === 'extract' ? inc(e.n) : t
    case 'd-research':
      return e.k === 'researchCast' ? inc(1) : t
    case 'd-potion':
      return e.k === 'catch' && e.potion ? inc(1) : t
    default:
      return t
  }
}

/** 보상을 세이브에 더한다. 상한을 넘는 만큼은 버리고 실제로 받은 양을 돌려준다 */
export function grantReward(s: State, r: Reward): { state: State; got: Reward } {
  let state = s
  const got: Reward = {}
  if (r.meal) {
    state = { ...state, econ: { ...state.econ, meal: state.econ.meal + r.meal } }
    got.meal = r.meal
  }
  if (r.baits) {
    const baits = { ...state.econ.baits }
    for (const [k, v] of Object.entries(r.baits) as [BaitKind, number][]) baits[k] = (baits[k] ?? 0) + v
    state = { ...state, econ: { ...state.econ, baits } }
    got.baits = { ...r.baits }
  }
  if (r.mats) {
    const mats = { ...state.gallery.mats }
    const g: Partial<Record<MatArea, number>> = {}
    for (const [k, v] of Object.entries(r.mats) as [MatArea, number][]) {
      const before = mats[k] ?? 0
      mats[k] = Math.min(MAT_MAX, before + v)
      if (mats[k]! - before > 0) g[k] = mats[k]! - before
    }
    state = { ...state, gallery: { ...state.gallery, mats } }
    if (Object.keys(g).length) got.mats = g
  }
  if (r.isle && state.isle) {
    const mats = { ...state.isle.mats }
    const g: Partial<Mats> = {}
    for (const [k, v] of Object.entries(r.isle) as [keyof Mats, number][]) {
      const before = mats[k]
      mats[k] = Math.min(MAT_CAP, before + v)
      if (mats[k] - before > 0) g[k] = mats[k] - before
    }
    state = { ...state, isle: { ...state.isle, mats } }
    if (Object.keys(g).length) got.isle = g
  }
  return { state, got }
}

export type DailyOutcome = { state: State; done: string[]; rewards: Reward[]; allDone: boolean; weekly: boolean }

/** 사건으로 오늘 과제 진행. 완료 순간 보상, 셋 다 완료·주간 보너스도 여기서 */
export function progressDaily(s0: State, events: readonly GoalEvent[], now: number): DailyOutcome {
  const d = s0.daily
  if (d.day !== kstDayOf(now) || d.tasks.length === 0 || events.length === 0) return { state: s0, done: [], rewards: [], allDone: false, weekly: false }
  let s = s0
  const done: string[] = []
  const rewards: Reward[] = []
  const tasks = d.tasks.map((t0) => {
    if (t0.done) return t0
    let t = t0
    for (const e of events) t = step(t, e)
    if (t.progress >= t.target) {
      t = { ...t, progress: t.target, done: true }
      const g = grantReward(s, t.reward)
      s = g.state
      done.push(t.id)
      rewards.push(g.got)
    }
    return t
  })
  let daily: Daily = { ...d, tasks }
  let allDone = false
  let weekly = false
  if (!d.allDone && tasks.length === 3 && tasks.every((t) => t.done)) {
    allDone = true
    const stage = stageOf(s)
    const g = grantReward(s, allDoneReward(stage, s))
    s = g.state
    rewards.push(g.got)
    const week = { ...daily.week, days: daily.week.days + 1 }
    s = { ...s, stats: { ...s.stats, dailyDays: s.stats.dailyDays + 1 } }
    if (week.days >= WEEK_NEED && !week.claimed) {
      weekly = true
      const w = grantReward(s, weeklyReward(stage, s))
      s = w.state
      rewards.push(w.got)
      week.claimed = true
      s = { ...s, stats: { ...s.stats, weeklies: s.stats.weeklies + 1 } }
    }
    daily = { ...daily, allDone: true, week }
  }
  return { state: { ...s, daily }, done, rewards, allDone, weekly }
}

/** 과제 문구(화면·알림) */
export function taskText(t: Pick<DailyTask, 'id' | 'target' | 'area' | 'spot' | 'species'>): string {
  const area = t.area ? AREA_NAME[t.area] : ''
  const spotName: Record<string, string> = { cave3: '용암', ice: '얼음 구멍', abyss: '심해' }
  const sp = t.species ? SPECIES.find((x) => x.id === t.species)?.name ?? t.species : ''
  switch (t.id) {
    case 'd-any': return `아무 물고기 ${t.target}마리`
    case 'd-area': return `${area}에서 ${t.target}마리`
    case 'd-species': return `오늘의 어종: ${sp} 잡기`
    case 'd-perfect': return `퍼펙트 ${t.target}번`
    case 'd-sell': return `물고기 ${t.target}마리 팔기`
    case 'd-gather': return `섬 자원 칸 ${t.target}번 캐기`
    case 'd-potion': return `포션을 마신 채 ${t.target}마리`
    case 'd-uncommon': return `드묾 이상 ${t.target}마리`
    case 'd-big': return `크기 상위 30% 물고기 ${t.target}마리`
    case 'd-variety': return `${area} 한 자리에서 서로 다른 ${t.target}종`
    case 'd-night': return `밤(20~5시)에 ${t.target}마리`
    case 'd-rain': return `비 올 때 ${t.target}마리`
    case 'd-pier': return `부두에서 크기 상위 50% ${t.target}마리`
    case 'd-grind': return `어분 ${t.target}개 만들기`
    case 'd-tide': return `갯골에서 ${t.target}마리`
    case 'd-extract': return `지역 재료 ${t.target}개 만들기`
    case 'd-rare': return `희귀 이상 ${t.target}마리`
    case 'd-perfect-run': return `퍼펙트 ${t.target}번 연속`
    case 'd-perfect-rare': return `드묾 이상을 퍼펙트로 ${t.target}번`
    case 'd-deep': return `${area} ${t.spot ? spotName[t.spot] ?? '' : ''}에서 ${t.target}마리`
    case 'd-income': return `오늘 판매 수입 ${t.target.toLocaleString('ko-KR')} JWD`
    case 'd-two-areas': return `서로 다른 지역 ${t.target}곳에서 각 5마리`
    case 'd-research': return `연구 낚시 ${t.target}번 던지기`
    default: return t.id
  }
}

/** 보상 문구 */
export function rewardText(r: Reward): string {
  const parts: string[] = []
  const baitName: Record<BaitKind, string> = { attractor: '집어 미끼', legend: '전설 미끼', mythic: '신화 미끼' }
  const isleName: Record<keyof Mats, string> = { wood: '나무', stone: '돌', iron: '철' }
  if (r.meal) parts.push(`어분 ${r.meal}`)
  for (const [k, v] of Object.entries(r.baits ?? {}) as [BaitKind, number][]) parts.push(`${baitName[k]} ${v}`)
  for (const [k, v] of Object.entries(r.mats ?? {}) as [MatArea, number][]) parts.push(`${AREA_NAME[k as AreaId]} 재료 ${v}`)
  for (const [k, v] of Object.entries(r.isle ?? {}) as [keyof Mats, number][]) parts.push(`${isleName[k]} ${v}`)
  return parts.join(', ')
}

/** 시드로 정해지는 난수(테스트용) */
export function dailyRng(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const nat = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0)
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
function cleanCounts<K extends string>(v: unknown, keys: readonly K[]): Partial<Record<K, number>> | undefined {
  if (!isObj(v)) return undefined
  const out: Partial<Record<K, number>> = {}
  for (const k of keys) if (nat(v[k]) > 0) out[k] = nat(v[k])
  return Object.keys(out).length ? out : undefined
}
function cleanReward(v: unknown): Reward {
  if (!isObj(v)) return {}
  const r: Reward = {}
  if (nat(v.meal) > 0) r.meal = nat(v.meal)
  const baits = cleanCounts(v.baits, ['attractor', 'legend', 'mythic'] as const); if (baits) r.baits = baits
  const mats = cleanCounts(v.mats, AREAS.filter((a) => a.spots.length > 0).map((a) => a.id as MatArea)); if (mats) r.mats = mats
  const isle = cleanCounts(v.isle, ['wood', 'stone', 'iron'] as const); if (isle) r.isle = isle
  return r
}
/** 세이브에서 읽기(v31): 알려진 후보·범위 안 값만. 모양이 틀리면 빈 데일리(다음 행동에 다시 뽑힌다) */
export function migrateDaily(raw: unknown): Daily {
  if (!isObj(raw) || typeof raw.day !== 'string' || !DAY_RE.test(raw.day) || !Array.isArray(raw.tasks)) return newDaily()
  const tasks: DailyTask[] = []
  for (const t of raw.tasks) {
    if (!isObj(t)) continue
    const cand = CANDIDATES.find((c) => c.id === t.id)
    if (!cand || t.tier !== cand.tier || nat(t.target) < 1) continue
    const task: DailyTask = { id: cand.id, tier: cand.tier, target: nat(t.target), progress: Math.min(nat(t.progress), nat(t.target)), done: t.done === true, reward: cleanReward(t.reward) }
    if (AREAS.some((a) => a.id === t.area)) task.area = t.area as AreaId
    if (typeof t.spot === 'string') task.spot = t.spot
    if (SPECIES.some((x) => x.id === t.species)) task.species = t.species as string
    if (Array.isArray(t.seen)) task.seen = t.seen.filter((x): x is string => typeof x === 'string' && SPECIES.some((sp) => sp.id === x))
    if (isObj(t.perArea)) task.perArea = Object.fromEntries(Object.entries(t.perArea).filter(([k, n]) => AREAS.some((a) => a.id === k) && nat(n) > 0).map(([k, n]) => [k, nat(n)]))
    if (t.run !== undefined) task.run = nat(t.run)
    tasks.push(task)
  }
  if (tasks.length > 3) return newDaily()
  const w = isObj(raw.week) ? raw.week : {}
  return {
    day: raw.day, tasks, rerolled: raw.rerolled === true, allDone: raw.allDone === true,
    week: { start: typeof w.start === 'string' && DAY_RE.test(w.start) ? w.start : '', days: Math.min(7, nat(w.days)), claimed: w.claimed === true },
  }
}

// 데일리 과제·업적(설계 2026-11-28-fishing-daily-achievements-design.md): 통계·사건·데일리·업적·logic 연결(v31).
import { describe, expect, it } from 'vitest'
import { conditionsAt } from './clock.ts'
import { MIN_FIGHT_MS, SPECIES, type AreaId } from './data.ts'
import { logic, type State } from './logic.ts'
import { applyStats, migrateStats, newStats, type GoalEvent } from './stats.ts'
import { goalEvents } from './goalEvents.ts'
import {
  CANDIDATES, INCOME_REF, TIERS, allDoneReward, baseReward, dailyRng, ensureDaily, grantReward, migrateDaily, newDaily, progressDaily, rainOnDay,
  rerollDaily, stageOf, target, taskText, weekStart, weeklyReward, type DailyTask,
} from './daily.ts'
import { ACHIEVEMENTS, DONE_ACHV, achvScore, achvValue, grantAchievements, hasTitle, migrateAchv, newAchv, reachedTier } from './achievements.ts'
import { bestSpot, hourlyIncome } from './econSim.ts'
import { newEcon } from './research.ts'
import { newGallery } from './gallery.ts'

const T = Date.UTC(2026, 10, 28, 3) // KST 2026-11-28 12:00
const DAY = 86_400_000
const base = (over: Partial<State> = {}): State => ({ ...logic.init(), ...over })
const ok = (r: ReturnType<typeof logic.apply>) => { if ('error' in r) throw new Error(r.error); return r }
const hooked = (species: string, sizeCm: number, area: AreaId, spot: string, over: Partial<State> = {}, at = T): State =>
  base({ ...over, pending: { species, sizeCm, biteDelayMs: 3000, startedAt: at, hookedAt: at + 3000, area, spot, cond: conditionsAt(at), power: 0.5 } })
const catchAt = (s: State, perfect = false, at = T) => ok(logic.apply(s, { type: 'resolve', success: true, perfect }, { now: at + 3000 + MIN_FIGHT_MS, rng: () => 0.5, gold: 0 }))
const catchEv = (over: Partial<Extract<GoalEvent, { k: 'catch' }>> = {}): GoalEvent => ({
  k: 'catch', species: 'anchovy', sizeCm: 10, perfect: false, area: 'village', spot: 'shore', cond: conditionsAt(T), research: false, potion: false, bagFull: false, bagCap: 20, ...over,
})

describe('통계(stats.ts)', () => {
  it('포획·퍼펙트 연속·자리·대물/최대/최소·계절·하루', () => {
    const big = SPECIES.find((x) => x.id === 'mackerel')!
    let s = applyStats(newStats(), [catchEv({ perfect: true }), catchEv({ perfect: true }), catchEv({ species: 'mackerel', sizeCm: big.maxCm })], T)
    expect([s.catches, s.perfects, s.perfectRun, s.perfectBest]).toEqual([3, 2, 0, 2])
    expect(s.bySpot).toEqual({ 'village:shore': 3 })
    expect(s.big).toEqual(['mackerel'])
    expect(s.max).toEqual(['mackerel'])
    expect(s.tiny).toEqual([]) // 멸치 10cm는 하위 1%가 아니다
    expect(applyStats(newStats(), [catchEv({ sizeCm: SPECIES.find((x) => x.id === 'anchovy')!.minCm })], T).tiny).toEqual(['anchovy'])
    expect(s.seasons).toEqual([conditionsAt(T).season])
    expect(s.day).toMatchObject({ day: '2026-11-28', catches: 3 })
    s = applyStats(s, [{ k: 'miss' }, catchEv()], T + DAY)
    expect(s.day).toMatchObject({ day: '2026-11-29', catches: 1 })
    expect(s.dayBest).toBe(3)
  })
  it('감쇠 없이 150마리 판 날은 한 번만 센다', () => {
    let s = applyStats(newStats(), [{ k: 'sell', n: 100, income: 1000, soldBefore: 0 }], T)
    s = applyStats(s, [{ k: 'sell', n: 60, income: 500, soldBefore: 100 }], T)
    s = applyStats(s, [{ k: 'sell', n: 60, income: 500, soldBefore: 160 }], T)
    expect(s.cleanDays).toBe(1)
    expect(s.day).toMatchObject({ sold: 220, income: 2000 })
  })
  it('숨은 업적 조건', () => {
    const night = { ...conditionsAt(T), gameMinute: 30, season: 'winter' as const, weather: 'rain' as const }
    const s = applyStats(newStats(), [
      catchEv({ species: 'dragon-king', perfect: true }),
      catchEv({ species: 'grouper', cond: { ...conditionsAt(T), gameMinute: 20 } }),
      catchEv({ spot: 'ice', area: 'summit', species: 'arctic-char', perfect: true, cond: night }),
      catchEv({ bagFull: true, bagCap: 60 }),
    ], T)
    expect(s.hidden.sort()).toEqual(['h-dragon-perfect', 'h-full-bag', 'h-midnight', 'h-snow-night'].sort())
    expect(applyStats(newStats(), [{ k: 'trash', n: 100 }], T).hidden).toEqual(['h-trash'])
  })
  it('v30 소급: 총 포획 = 도감 count 합, 대물·최대 = 도감 maxCm, 연구 재포획 = 기증 + 전시×2', () => {
    const mk = SPECIES.find((x) => x.id === 'mackerel')!
    const m = migrateStats(undefined, { anchovy: { count: 5, maxCm: 9 }, mackerel: { count: 2, maxCm: mk.maxCm } }, { donated: { grouper: 1 }, exhibits: ['imugi'] })
    expect([m.catches, m.big, m.max, m.researchCatches]).toEqual([7, ['mackerel'], ['mackerel'], 3])
    const again = migrateStats(JSON.parse(JSON.stringify(m)), {}, { donated: {}, exhibits: [] })
    expect(again).toEqual(m)
  })
})

describe('사건(goalEvents.ts)', () => {
  it('잡기는 던질 때 지역·자리·조건, 놓치면 miss, 팔기·쓰레기통·어분 증가', () => {
    const s = hooked('anchovy', 10, 'village', 'shore', { econ: { ...newEcon(), meal: 0 } })
    const r = catchAt(s, true)
    const ev = goalEvents(s, r.state, { type: 'resolve' }, r.result, T)
    expect(ev[0]).toMatchObject({ k: 'catch', species: 'anchovy', area: 'village', spot: 'shore', perfect: true })
    expect(goalEvents(s, { ...s, pending: null }, { type: 'resolve' }, { caught: null }, T)).toEqual([{ k: 'miss' }])
    const bag = [{ id: 1, origin: 'normal' as const, species: 'anchovy', sizeCm: 10, perfect: false }]
    expect(goalEvents(base({ bag }), base(), { type: 'sell' }, { earned: 30 }, T)).toEqual([{ k: 'sell', n: 1, income: 30, soldBefore: 0 }])
    expect(goalEvents(base({ bag }), base(), { type: 'discard', at: 'trash' }, {}, T)).toEqual([{ k: 'trash', n: 1 }])
    expect(goalEvents(base(), base({ econ: { ...newEcon(), meal: 3 } }), { type: 'grind' }, {}, T)).toEqual([{ k: 'meal', n: 3 }])
  })
})

describe('데일리(daily.ts)', () => {
  const draw = (s: State, seed = 'a') => ensureDaily(s, T, dailyRng(seed))
  it('쉬움·보통·어려움 하나씩, 같은 id 없음, 하루 안에는 그대로, 다음 날 새로', () => {
    for (let i = 0; i < 30; i++) {
      const d = draw(base(), `s${i}`).daily
      expect(d.tasks.map((t) => t.tier)).toEqual(TIERS)
      expect(new Set(d.tasks.map((t) => t.id)).size).toBe(3)
      expect(d.day).toBe('2026-11-28')
    }
    const s = draw(base())
    expect(ensureDaily(s, T + 3600_000, dailyRng('other'))).toBe(s)
    expect(ensureDaily(s, T + DAY, dailyRng('b')).daily.day).toBe('2026-11-29')
  })
  it('할 수 없는 과제는 안 나온다: 새 계정(대나무·기본 지역·섬 없음·허가증 없음)', () => {
    const banned = ['d-gather', 'd-potion', 'd-extract', 'd-tide', 'd-rare', 'd-perfect-rare', 'd-deep', 'd-two-areas', 'd-research']
    for (let i = 0; i < 200; i++) for (const t of draw(base(), `n${i}`).daily.tasks) expect(banned, t.id).not.toContain(t.id)
  })
  it('d-area·d-species는 연 지역, d-species는 오늘 계절·낚싯대로 잡히는 흔함·드묾', () => {
    const season = conditionsAt(T).season
    for (let i = 0; i < 300; i++) {
      for (const t of draw(base(), `p${i}`).daily.tasks) {
        if (t.id === 'd-area') expect(['village', 'river', 'forest']).toContain(t.area)
        if (t.id === 'd-species') {
          const sp = SPECIES.find((x) => x.id === t.species)!
          expect(['common', 'uncommon']).toContain(sp.rarity)
          expect(sp.minRod).toBe(1)
          expect(!sp.seasons || sp.seasons.includes(season)).toBe(true)
        }
      }
    }
  })
  it('목표 N은 낚싯대 1 → 6 선형, d-income은 INCOME_REF × 0.5', () => {
    expect([1, 6].map((r) => target([15, 25], r))).toEqual([15, 25])
    expect(target([3, 5], 3.5)).toBe(4)
    // 설계 §0 표를 잰 단계 설정(econSim.bestSpot, 감쇠 전 시간당 수입)과 ±5%
    const all: AreaId[] = ['village', 'river', 'forest', 'lake', 'cave', 'island', 'tideflat', 'swamp', 'summit', 'wreck']
    const stages: [number, number][] = [
      [1, bestSpot(all.slice(0, 3), 1, 1, []).income],
      [2, hourlyIncome('village', 'shore', { rodTier: 2, bagTier: 1, equipped: [] })],
      [3, bestSpot(all.slice(0, 5), 3, 3, ['cork']).income],
      [4, bestSpot(all.slice(0, 7), 4, 4, ['cork', 'curious']).income],
      [5, bestSpot(all, 5, 5, ['cork', 'curious']).income],
      [6, bestSpot(all, 6, 5, ['cork', 'curious', 'barbed']).income],
    ]
    for (const [rod, inc] of stages) expect(Math.abs(INCOME_REF[rod] - inc) / inc, `낚싯대 ${rod}`).toBeLessThan(0.05)
  })
  it('진행: 후보마다 맞는 사건만 센다, 완료 순간 보상', () => {
    const mk = (t: Partial<DailyTask>): State => base({ daily: { ...newDaily(), day: '2026-11-28', tasks: [{ id: 'd-any', tier: 'easy', target: 2, progress: 0, done: false, reward: { meal: 3 }, ...t }] } })
    let o = progressDaily(mk({}), [catchEv(), { k: 'miss' }], T)
    expect(o.state.daily.tasks[0].progress).toBe(1)
    o = progressDaily(o.state, [catchEv()], T)
    expect([o.done, o.state.daily.tasks[0].done, o.state.econ.meal]).toEqual([['d-any'], true, 3])
    // 끝난 과제는 더 세지 않는다
    expect(progressDaily(o.state, [catchEv()], T).done).toEqual([])
    const run = progressDaily(mk({ id: 'd-perfect-run', tier: 'hard', target: 3 }), [catchEv({ perfect: true }), catchEv({ perfect: true }), { k: 'miss' }, catchEv({ perfect: true })], T)
    expect(run.state.daily.tasks[0]).toMatchObject({ progress: 2, run: 1, done: false })
    const v = progressDaily(mk({ id: 'd-variety', tier: 'normal', target: 2, area: 'village', spot: 'shore' }), [catchEv(), catchEv(), catchEv({ species: 'goby' }), catchEv({ species: 'koi', spot: 'pier' })], T)
    expect(v.state.daily.tasks[0]).toMatchObject({ progress: 2, done: true })
    const two = progressDaily(mk({ id: 'd-two-areas', tier: 'hard', target: 2 }), [...Array(5)].flatMap(() => [catchEv(), catchEv({ area: 'river', spot: 'river' })]), T)
    expect(two.state.daily.tasks[0].done).toBe(true)
    const inc = progressDaily(mk({ id: 'd-income', tier: 'hard', target: 1000 }), [{ k: 'sell', n: 3, income: 1200, soldBefore: 0 }], T)
    expect(inc.state.daily.tasks[0].done).toBe(true)
    // 다른 날짜의 과제는 진행하지 않는다
    expect(progressDaily(mk({}), [catchEv(), catchEv()], T + DAY).done).toEqual([])
  })
  it('셋 다 완료 보너스, 주간 5일째 한 번만', () => {
    const t = (id: string, tier: DailyTask['tier']): DailyTask => ({ id, tier, target: 1, progress: 0, done: false, reward: {} })
    let s = base({ daily: { ...newDaily(), day: '2026-11-28', tasks: [t('d-any', 'easy'), t('d-perfect', 'normal'), t('d-perfect-run', 'hard')], week: { start: '2026-11-23', days: 4, claimed: false } } })
    const o = progressDaily(s, [catchEv({ perfect: true })], T)
    expect([o.allDone, o.weekly]).toEqual([true, true])
    expect(o.state.daily.week).toEqual({ start: '2026-11-23', days: 5, claimed: true })
    expect(o.state.stats).toMatchObject({ dailyDays: 1, weeklies: 1 })
    expect(o.state.econ.baits.attractor).toBe(10) // P0 주간: 집어 미끼 10(섬 없으면 + 어분 10)
    s = { ...o.state, daily: { ...o.state.daily, allDone: false, tasks: o.state.daily.tasks.map((x) => ({ ...x, done: false, progress: 0 })) } }
    expect(progressDaily(s, [catchEv({ perfect: true })], T).weekly).toBe(false)
  })
  it('보상 표: 진행 단계별, 상한 넘는 재료는 버린다', () => {
    expect(stageOf(base())).toBe(0)
    expect(stageOf(base({ econ: { ...newEcon(), license: true } }))).toBe(1)
    expect(stageOf(base({ gallery: { ...newGallery(), exhibits: ['imugi'] } }))).toBe(2)
    expect(baseReward('hard', 2, 'cave')).toEqual({ baits: { legend: 1 }, mats: { cave: 5 } })
    expect(allDoneReward(2, base())).toEqual({ baits: { mythic: 1 }, meal: 5 })
    expect(weeklyReward(1, base())).toEqual({ baits: { legend: 3 } })
    const g = grantReward(base({ gallery: { ...newGallery(), mats: { cave: 9998 } } }), { mats: { cave: 5 } })
    expect([g.state.gallery.mats.cave, g.got]).toEqual([9999, { mats: { cave: 1 } }])
  })
  it('리롤: 하루 한 번, 끝난 과제는 안 된다, 같은 난이도·새 후보', () => {
    const s = draw(base())
    const r = rerollDaily(s, 0, T, dailyRng('r'))
    if ('error' in r) throw new Error(r.error)
    expect(r.state.daily.tasks[0].tier).toBe('easy')
    expect(s.daily.tasks.map((t) => t.id)).not.toContain(r.state.daily.tasks[0].id)
    expect(rerollDaily(r.state, 1, T, dailyRng('r'))).toEqual({ error: 'rerolled' })
    const done = { ...s, daily: { ...s.daily, tasks: s.daily.tasks.map((t, i) => (i === 1 ? { ...t, done: true } : t)) } }
    expect(rerollDaily(done, 1, T, dailyRng('r'))).toEqual({ error: 'task_done' })
    expect(rerollDaily(s, 0, T + DAY, dailyRng('r'))).toEqual({ error: 'daily_stale' })
  })
  it('비 오는 게임 날 확인·주 시작(월요일)·문구·migrate', () => {
    expect(typeof rainOnDay('2026-11-28')).toBe('boolean')
    expect(weekStart('2026-11-28')).toBe('2026-11-23')
    expect(weekStart('2026-11-23')).toBe('2026-11-23')
    for (const c of CANDIDATES) expect(taskText({ id: c.id, target: 3, area: 'cave', spot: 'cave3', species: 'anchovy' }), c.id).not.toBe(c.id)
    const s = draw(base())
    expect(migrateDaily(JSON.parse(JSON.stringify(s.daily)))).toEqual(s.daily)
    expect(migrateDaily({ day: 'x', tasks: [] })).toEqual(newDaily())
    expect(migrateDaily({ ...s.daily, tasks: [{ id: 'zzz' }] }).tasks).toEqual([])
  })
})

describe('업적(achievements.ts)', () => {
  it('표: 단계 오름차순, 골드·점수 길이, 단계형 34·숨은 8, 골드 합계 2,132,000', () => {
    expect(ACHIEVEMENTS.filter((d) => d.cat !== 'hidden')).toHaveLength(34)
    expect(ACHIEVEMENTS.filter((d) => d.cat === 'hidden')).toHaveLength(8)
    for (const d of ACHIEVEMENTS) {
      expect(d.gold.length, d.id).toBe(d.tiers.length)
      expect(d.score.length, d.id).toBe(d.tiers.length)
      for (let i = 1; i < d.tiers.length; i++) expect(d.tiers[i]).toBeGreaterThan(d.tiers[i - 1])
    }
    expect(new Set(ACHIEVEMENTS.map((d) => d.id)).size).toBe(ACHIEVEMENTS.length)
    expect(ACHIEVEMENTS.reduce((a, d) => a + d.gold.reduce((x, y) => x + y, 0), 0)).toBe(2_132_000)
  })
  it('새로 넘은 단계마다 골드, 같은 단계는 두 번 안 준다', () => {
    const s = base({ totalEarned: 1_500_000 })
    const g = grantAchievements(s)
    expect(g.got.filter((x) => x.id === 'a-earned')).toEqual([{ id: 'a-earned', tier: 1, gold: 2000 }, { id: 'a-earned', tier: 2, gold: 15000 }])
    expect(grantAchievements(g.state).got).toEqual([])
    expect(reachedTier(ACHIEVEMENTS.find((d) => d.id === 'a-earned')!, 10_000_000)).toBe(3)
  })
  it('진행값: 도감·전설/신화·지역·장비·섬·전시관', () => {
    const s = base({ legends: ['grouper', 'imugi'], rodTier: 6, bagTier: 5, shoesTier: 4, tackles: ['cork', 'trap', 'barbed', 'spinner', 'curious'], areas: ['village', 'river', 'forest', 'lake', 'cave', 'hall'] })
    expect([achvValue(s, 'a-legend'), achvValue(s, 'a-mythic'), achvValue(s, 'a-areas'), achvValue(s, 'a-gear')]).toEqual([1, 1, 5, 3])
    expect(achvValue(base({ rodTier: 4 }), 'a-gear')).toBe(1)
    expect(achvValue(base({ gallery: { ...newGallery(), projects: ['sea-bg', 'sea-floor', 'sea-light', 'forest-bg', 'lighthouse'] } }), 'a-theme')).toBe(1)
    expect(achvValue(base({ gallery: { ...newGallery(), projects: ['lighthouse', 'spring'] } }), 'a-facility')).toBe(2)
  })
  it('칭호는 마지막 단계에서, 점수 합계, migrate는 가진 칭호만', () => {
    const a = { tiers: { 'a-mythic': 3, 'a-dex': 1, 'h-tiny': 1 }, title: null }
    expect([hasTitle(a, 'a-mythic'), hasTitle(a, 'a-dex'), hasTitle(a, 'h-tiny')]).toEqual([true, false, true])
    expect(achvScore(a)).toEqual({ score: 10 + 25 + 50 + 10 + 40, count: 5 })
    expect(migrateAchv({ ...a, title: 'a-dex' })).toEqual({ ...a, title: null })
    expect(migrateAchv({ ...a, title: 'a-mythic', tiers: { ...a.tiers, zzz: 3, 'a-dex': 9 } })).toEqual({ tiers: { 'a-mythic': 3, 'a-dex': 3, 'h-tiny': 1 }, title: 'a-mythic' })
    expect(migrateAchv(null)).toEqual(newAchv())
  })
})

describe('logic 연결(v31)', () => {
  it('dailyOpen: 오늘 과제가 없으면 뽑고(서버 난수), 행동 자체는 아무것도 바꾸지 않는다', () => {
    const r = ok(logic.apply(base({ achv: DONE_ACHV }), { type: 'dailyOpen' }, { now: T, rng: () => 0.3, gold: 0 }))
    expect(r.state.daily.tasks).toHaveLength(3)
    expect(r.gold ?? 0).toBe(0)
  })
  it('업적 골드는 행동 gold에 합쳐지고 result.goals에 알린다', () => {
    const s = base({ totalEarned: 99_990, bag: [{ id: 1, origin: 'normal', species: 'anchovy', sizeCm: 15, perfect: true }], achv: { ...DONE_ACHV, tiers: { ...DONE_ACHV.tiers, 'a-earned': 0 } } })
    const r = ok(logic.apply(s, { type: 'sell' }, { now: T, rng: () => 0.5, gold: 0 }))
    const earned = (r.result as { earned: number }).earned
    expect(r.gold).toBe(earned + 2000)
    expect((r.result as { goals: { achv: unknown[] } }).goals.achv).toEqual([{ id: 'a-earned', tier: 1, gold: 2000 }])
  })
  it('잡으면 통계·데일리가 같이 움직인다', () => {
    const day = ok(logic.apply(base({ achv: DONE_ACHV }), { type: 'dailyOpen' }, { now: T, rng: () => 0.3, gold: 0 })).state
    const s = { ...hooked('anchovy', 10, 'village', 'shore'), daily: day.daily, achv: DONE_ACHV }
    const r = catchAt(s, true)
    expect(r.state.stats).toMatchObject({ catches: 1, perfects: 1 })
    expect(r.state.daily.tasks.some((t) => t.progress > 0)).toBe(true)
  })
  it('setTitle: 가진 칭호만, null로 끄기, avatar에 칭호', () => {
    const s = base({ achv: { tiers: { 'a-mythic': 3 }, title: null } })
    expect(logic.apply(s, { type: 'setTitle', id: 'a-dex' }, { now: T, rng: () => 0.5, gold: 0 })).toEqual({ error: 'no_title' })
    const r = ok(logic.apply(s, { type: 'setTitle', id: 'a-mythic' }, { now: T, rng: () => 0.5, gold: 0 }))
    expect(r.state.achv.title).toBe('a-mythic')
    expect(JSON.parse(logic.avatar!(r.state))).toMatchObject({ title: '용을 낚은 자' })
    expect(ok(logic.apply(r.state, { type: 'setTitle', id: null }, { now: T, rng: () => 0.5, gold: 0 })).state.achv.title).toBeNull()
  })
  it('records: 업적 점수(한 단계라도 받았을 때)', () => {
    expect(logic.records(base()).some((r) => r.key === 'achv')).toBe(false)
    expect(logic.records(base({ achv: { tiers: { 'a-dex': 1 }, title: null } })).find((r) => r.key === 'achv')).toEqual({ key: 'achv', value: 10, detail: '1단계' })
  })
  it('v30 세이브 → 통계 소급, 다음 행동에 업적 단계를 한꺼번에 지급', () => {
    const raw = { ...base(), dex: { anchovy: { count: 30, maxCm: 9 } }, totalEarned: 200_000, legends: [] }
    const { stats: _s, daily: _d, achv: _a, ...v30 } = raw
    const m = logic.migrate(JSON.parse(JSON.stringify(v30)), 30)
    expect(m.stats.catches).toBe(30)
    expect(m.achv).toEqual(newAchv())
    const r = ok(logic.apply(m, { type: 'dailyOpen' }, { now: T, rng: () => 0.5, gold: 0 }))
    expect(r.gold).toBe(2000) // 누적 수입 10만 동
    expect(r.state.achv.tiers['a-earned']).toBe(1)
  })
})

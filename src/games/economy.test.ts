import { expect, test } from 'vitest'
import {
  DAILY_PRIZE_RATES,
  DAILY_PRIZES,
  dailyBudgetOk,
  dailyPrize,
  DAILY_SOFT_CAP,
  FEE_MAX,
  STAKE_MAX,
  DAILY_SOFT_CAP_2,
  FISHING_SINK_TARGET,
  FREE_DAILY_CAP,
  FREE_GAP_SEC,
  FREE_REF,
  FREE_PLAY_CAP_MAX,
  FREE_AVG_PLAY_MAX,
  freeGold,
  hourlyGold,
  REF,
  SOFT_CAP_RATE,
  SOFT_CAP_RATE_2,
  SOFT_CAP_TIERS,
  softCap,
  FREE_BONUS_MAX_PCT,
  clampBonusPct,
  withBonus,
} from './economy.ts'
import { games } from './index.ts'

test('경제 상수 (설계 §4)', () => {
  expect(REF).toBe(20500)
  expect(DAILY_SOFT_CAP).toBe(30750)
  expect(SOFT_CAP_RATE).toBe(0.2)
  expect(DAILY_SOFT_CAP_2).toBe(41000)
  expect(SOFT_CAP_RATE_2).toBe(0.04)
  expect(SOFT_CAP_TIERS).toEqual([[30750, 1], [41000, 0.2], [Infinity, 0.04]])
})

test('softCap: _gold_move와 같은 식 (설계 §5.6)', () => {
  expect(softCap(20000, 0)).toBe(20000)
  expect(softCap(20000, 20000)).toBe(12600)
  expect(softCap(100, 32600)).toBe(20)
  expect(softCap(4, 40000)).toBe(0)
  expect(softCap(0, 0)).toBe(0)
  expect(softCap(-5, 0)).toBe(0)
  expect(softCap(1000, 30000)).toBe(800)
  expect(softCap(Number.NaN, 0)).toBe(0)
})

test('softCap: 2단 상한 (설계 §5.6, 2026-11-24 개정)', () => {
  // 들어간 합계 41,000까지는 20%, 그 위는 4%
  expect(softCap(1000, 41000)).toBe(40)
  expect(softCap(1000, 50000)).toBe(40)
  expect(softCap(24, 41000)).toBe(0) // floor(0.96)
  expect(softCap(25, 41000)).toBe(1)
  // 40,900에서 1,000: 20%로 100 들어갈 자리(원래 500)까지 다 쓰고 나머지 500의 4% = 20
  expect(softCap(1000, 40900)).toBe(120)
  // 한 번에 세 칸을 다 지나감: 30,750 + 10,250(원래 51,250) + (100,000 − 30,750 − 51,250) × 0.04 = 720
  expect(softCap(100000, 0)).toBe(41720)
  // 이어서 나눠 받아도 한 번에 받은 것과 거의 같다(내림 차이만)
  const a = softCap(60000, 0)
  expect(a + softCap(40000, a)).toBeGreaterThanOrEqual(41720 - 1)
  expect(a + softCap(40000, a)).toBeLessThanOrEqual(41720)
})

test('softCap = SOFT_CAP_TIERS 구간 적분의 내림', () => {
  const exact = (d: number, s: number) => {
    let got = 0
    let left = d
    for (const [upTo, rate] of SOFT_CAP_TIERS) {
      if (left <= 0) break
      const use = Math.min(left, Math.max(upTo - s - got, 0) / rate)
      got += use * rate
      left -= use
    }
    return got
  }
  for (let i = 0; i < 2000; i++) {
    const d = Math.floor(((i * 7919) % 997) * 137.3)
    const s = Math.floor(((i * 104729) % 1009) * 61.7)
    expect(softCap(d, s), `d=${d} s=${s}`).toBe(Math.floor(exact(d, s) + 1e-9))
  }
})

test('softCap: 효과 표 고정 (설계 §4.1)', () => {
  expect(softCap(24600, 0)).toBe(24600) // 하루 1시간
  expect(softCap(106600, 0)).toBe(41984) // 하루 5시간: 30,750 + 10,250 + 24,600 × 0.04
  expect(softCap(209100, 0)).toBe(46084) // 하루 10시간: 41,000 + 127,100 × 0.04
})

/** 마이그레이션을 이름순으로 읽어 가장 마지막 _economy() 정의의 JSON 리터럴을 꺼낸다 */
function lastEconomy(files: Record<string, string>): unknown {
  let body: string | null = null
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?_economy\s*\(\s*\)[\s\S]*?\$\$([\s\S]*?)\$\$/gi
  for (const name of Object.keys(files).sort()) {
    for (const m of files[name].matchAll(re)) body = m[1]
  }
  if (body === null) return null
  const lit = body.match(/'(\{[\s\S]*?\})'/)
  return lit ? JSON.parse(lit[1]) : null
}

test('SQL 사본 _economy()가 economy.ts와 같다 (설계 §12)', () => {
  const sqlFiles = import.meta.glob('../../supabase/migrations/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
  const eco = lastEconomy(sqlFiles)
  expect(eco, '_economy()가 마이그레이션에 없다').not.toBeNull()
  expect(eco).toEqual({
    daily_soft_cap: DAILY_SOFT_CAP,
    soft_cap_rate: SOFT_CAP_RATE,
    daily_soft_cap_2: DAILY_SOFT_CAP_2,
    soft_cap_rate_2: SOFT_CAP_RATE_2,
    daily_prizes: DAILY_PRIZES,
    stake_max: STAKE_MAX,
    fee_max: FEE_MAX,
    free_bonus_max_pct: FREE_BONUS_MAX_PCT,
  })
})

test('도전과제 보너스: 판당·게임별 하루 상한에 곱하고 사이트 상한은 그대로 (설계 §7.5)', () => {
  expect(FREE_BONUS_MAX_PCT).toBe(400)
  expect(clampBonusPct(-5)).toBe(0)
  expect(clampBonusPct(NaN)).toBe(0)
  expect(clampBonusPct(140.9)).toBe(140)
  expect(clampBonusPct(900)).toBe(400)
  expect(withBonus(1000, 140)).toBe(2400)
  expect(withBonus(999, 15)).toBe(1148) // floor(999 × 1.15) = 1148.85 → 1148
  expect(withBonus(1000, 900)).toBe(5000)
  const g = { perPoint: 10, playCap: 1000, dailyCap: 20500 }
  // 판당: least(floor(80 × 10), 1000) = 800 → × 2.4 = 1920
  expect(freeGold(80, g, 0, 0, 140)).toEqual({ asked: 1920, got: 1920 })
  // 판당 상한도 보너스 뒤: 1000 × 5 = 5000
  expect(freeGold(500, g, 0, 0, 400).asked).toBe(5000)
  // 게임별 하루 상한 20,500 × 2.4 = 49,200. 오늘 48,000을 받았으면 남은 1,200만
  expect(freeGold(80, g, 48_000, 0, 140).asked).toBe(1200)
  expect(freeGold(80, g, 49_200, 0, 140).asked).toBe(0)
  // 보너스 없음은 지금과 같다
  expect(freeGold(80, g, 0, 0)).toEqual(freeGold(80, g, 0, 0, 0))
  // 사이트 하루 상한(softCap)은 보너스 뒤 금액에 그대로
  expect(freeGold(80, g, 0, 30_000, 140)).toEqual({ asked: 1920, got: softCap(1920, 30_000) })
})

test('lastEconomy: 이름순 마지막 정의를 쓴다', () => {
  const files = {
    'b.sql': `create or replace function public._economy() returns jsonb language sql immutable as $$ select '{"a": 2}'::jsonb $$;`,
    'a.sql': `create or replace function public._economy() returns jsonb language sql immutable as $$ select '{"a": 1}'::jsonb $$;`,
  }
  expect(lastEconomy(files)).toEqual({ a: 2 })
  expect(lastEconomy({ 'a.sql': 'select 1;' })).toBeNull()
  expect(lastEconomy({ ...files, 'c.sql': `create function public._economy() returns jsonb language sql as $$ select '{"a": 3}'::jsonb $$;` })).toEqual({ a: 3 })
})

test('자유 플레이 상수 (설계 §4, §7.3)', () => {
  expect(FREE_REF).toBe(2050)
  expect(FREE_DAILY_CAP).toBe(2050)
  expect(FREE_PLAY_CAP_MAX).toBe(200)
  expect(FREE_AVG_PLAY_MAX).toBe(100)
  expect(FREE_GAP_SEC).toBe(5)
  expect(FISHING_SINK_TARGET).toBe(820000)
  expect(FREE_DAILY_CAP).toBeLessThan(DAILY_SOFT_CAP)
})

test('freeGold: 판당 상한 → 게임별 남은 몫 → 사이트 상한 (설계 §7.2, §7.4)', () => {
  const g = { perPoint: 64, playCap: 1860, dailyCap: 20500 }
  expect(freeGold(7.5, g, 0, 0)).toEqual({ asked: 480, got: 480 })
  expect(freeGold(100, g, 0, 0)).toEqual({ asked: 1860, got: 1860 })
  expect(freeGold(7.5, g, 20400, 0)).toEqual({ asked: 100, got: 100 })
  expect(freeGold(7.5, g, 20500, 0)).toEqual({ asked: 0, got: 0 })
  expect(freeGold(7.5, g, 30000, 0)).toEqual({ asked: 0, got: 0 })
  expect(freeGold(7.5, g, 0, 30700)).toEqual({ asked: 480, got: 136 })
  expect(freeGold(7.5, g, 0, 40000)).toEqual({ asked: 480, got: 96 })
  expect(freeGold(7.5, g, 20400, 40000)).toEqual({ asked: 100, got: 20 })
  expect(freeGold(7.5, g, 0, 41000)).toEqual({ asked: 480, got: 19 }) // 2단: floor(480 × 0.04)
  expect(freeGold(-1, g, 0, 0)).toEqual({ asked: 0, got: 0 })
  expect(freeGold(Number.NaN, g, 0, 0)).toEqual({ asked: 0, got: 0 })
  expect(freeGold(7.5, undefined, 0, 0)).toEqual({ asked: 0, got: 0 })
  expect(freeGold(3.75, { perPoint: 10, playCap: 50, dailyCap: 120 }, 0, 0)).toEqual({ asked: 37, got: 37 })
  // 부동소수: 0.62 × 921 = 571.02 → 571, 0.29 × 100 = 28.999…가 아니라 29
  expect(freeGold(921, { perPoint: 0.62, playCap: 2860, dailyCap: 20500 }, 0, 0).asked).toBe(571)
  expect(freeGold(100, { perPoint: 0.29, playCap: 99999, dailyCap: 99999 }, 0, 0).asked).toBe(29)
})

test('hourlyGold: 3600 / (playSec + 5) × floor(avgScore × perPoint)', () => {
  expect(Math.abs(hourlyGold(5.81, 60, 64) - 20548)).toBeLessThanOrEqual(1)
  expect(hourlyGold(0, 60, 64)).toBe(0)
})

// ---------------------------------------------------------------- 데일리 상금·판돈·참가비 (설계 §8.1, §9, §10, 지갑 3단계)

test('데일리 상금 표: REF × [0.3 … 0.1]을 10 단위 내림 (설계 §4, §8.1)', () => {
  expect(DAILY_PRIZE_RATES).toEqual([0.3, 0.25, 0.2, 0.15, 0.12, 0.1])
  expect(DAILY_PRIZES).toEqual([6150, 5120, 4100, 3070, 2460, 2050])
})

test('dailyPrize: 등수별 상금, 6등 이하는 마지막 값', () => {
  expect(dailyPrize(1)).toBe(6150)
  expect(dailyPrize(2)).toBe(5120)
  expect(dailyPrize(6)).toBe(2050)
  expect(dailyPrize(7)).toBe(2050)
  expect(dailyPrize(100)).toBe(2050)
  expect(dailyPrize(0)).toBe(0)
  expect(dailyPrize(-1)).toBe(0)
  expect(dailyPrize(1.5)).toBe(0)
  expect(dailyPrize(Number.NaN)).toBe(0)
})

test('판돈·참가비 상한 REF × 2 (설계 §9, §10)', () => {
  expect(STAKE_MAX).toBe(41000)
  expect(FEE_MAX).toBe(41000)
})

test('dailyBudgetOk: 모든 데일리 1등 합계 ≤ REF (설계 §8.1)', () => {
  expect(dailyBudgetOk(1)).toBe(true)
  expect(dailyBudgetOk(3)).toBe(true) // 18,450
  expect(dailyBudgetOk(4)).toBe(false) // 24,600
})

test('데일리 게임 수 × 1등 상금 ≤ REF (등록부 기준, 숨김 포함)', () => {
  const n = games.filter((g) => g.manifest.modes.daily).length
  expect(n).toBeGreaterThan(0)
  expect(dailyBudgetOk(n), `데일리 게임 ${n}개: 데일리 게임이 늘었다 — 설계 §8.1대로 상금 표를 줄인다`).toBe(true)
})

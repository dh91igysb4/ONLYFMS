import { expect, test } from 'vitest'
import { DAILY_SOFT_CAP, DAILY_SOFT_CAP_2, REF, SOFT_CAP_RATE, SOFT_CAP_RATE_2, SOFT_CAP_TIERS, softCap } from './economy.ts'

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
  })
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

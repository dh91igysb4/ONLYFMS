import { expect, test } from 'vitest'
import { DAILY_SOFT_CAP, REF, SOFT_CAP_RATE, softCap } from './economy.ts'

test('경제 상수 (설계 §4)', () => {
  expect(REF).toBe(20500)
  expect(DAILY_SOFT_CAP).toBe(30750)
  expect(SOFT_CAP_RATE).toBe(0.2)
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

test('softCap: 효과 표 고정 (설계 §4.1)', () => {
  expect(softCap(24600, 0)).toBe(24600) // 하루 1시간
  expect(softCap(106600, 0)).toBe(45920) // 하루 5시간
  expect(softCap(209100, 0)).toBe(66420) // 하루 10시간
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
  expect(eco).toEqual({ daily_soft_cap: DAILY_SOFT_CAP, soft_cap_rate: SOFT_CAP_RATE })
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

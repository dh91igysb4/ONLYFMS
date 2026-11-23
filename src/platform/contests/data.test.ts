import { beforeEach, expect, test, vi } from 'vitest'

// supabase.from(...).select(cols)... 체인을 흉내 낸다. select에 넘긴 열에 따라 결과를 정한다
const selects: string[] = []
let respond: (cols: string) => { data: unknown; error: { code?: string; message?: string } | null }
function chain(cols: string) {
  const res = respond(cols)
  const c: Record<string, unknown> = {}
  for (const k of ['eq', 'neq', 'gt', 'order', 'limit', 'in']) c[k] = () => c
  c.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res).then(ok, bad)
  return c
}
vi.mock('../../lib/supabase.ts', () => ({
  supabase: { from: () => ({ select: (cols: string) => { selects.push(cols); return chain(cols) } }) },
  supabaseUrl: 'x', supabaseKey: 'k',
}))

import { getContest, getEntryCounts, listContests } from './data.ts'

beforeEach(() => { selects.length = 0 })

test('entry_fee 열을 함께 읽는다', async () => {
  respond = () => ({ data: [{ id: 'c1', entry_fee: 500 }], error: null })
  expect(await getContest('c1')).toEqual({ id: 'c1', entry_fee: 500 })
  expect(selects[0]).toContain('entry_fee')
})

test('옛 DB(열 없음 42703)면 entry_fee 없이 다시 읽는다', async () => {
  respond = (cols) => (cols.includes('entry_fee')
    ? { data: null, error: { code: '42703', message: 'column contests.entry_fee does not exist' } }
    : { data: [{ id: 'c1' }], error: null })
  expect(await listContests(Date.now())).toEqual([{ id: 'c1' }])
  expect(selects).toHaveLength(2)
  expect(selects[1]).not.toContain('entry_fee')
})

test('getEntryCounts: 대회별 참가자 수, 실패하면 빈 Map', async () => {
  respond = () => ({ data: [{ contest_id: 'a' }, { contest_id: 'a' }, { contest_id: 'b' }], error: null })
  expect([...(await getEntryCounts(['a', 'b']))]).toEqual([['a', 2], ['b', 1]])
  respond = () => ({ data: null, error: { code: '42501' } })
  expect((await getEntryCounts(['a'])).size).toBe(0)
  expect((await getEntryCounts([])).size).toBe(0)
})

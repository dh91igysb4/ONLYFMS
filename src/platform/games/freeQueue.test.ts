import { beforeEach, expect, test, vi } from 'vitest'

const upsert = vi.fn()
vi.mock('../../lib/supabase.ts', () => ({
  supabase: { from: (t: string) => ({ upsert: (...a: unknown[]) => upsert(t, ...a) }) },
}))

import { flush, resetFreeQueue, submit, type FreePlayRow } from './freeQueue.ts'

const row = (id: string): FreePlayRow => ({
  client_id: id, user_id: 'u1', game_id: 'test-guess', options: { range: '100' },
  logic_version: 1, solved: true, score: 7, action_count: 4,
})
const stored = () => JSON.parse(localStorage.getItem('onlyfms:freeQueue') ?? '[]') as FreePlayRow[]

beforeEach(() => {
  upsert.mockReset()
  localStorage.clear()
  resetFreeQueue()
  vi.restoreAllMocks()
})

test('queues_on_failure_and_flushes_later', async () => {
  upsert.mockResolvedValueOnce({ error: { message: 'x' } })
  await submit(row('a'))
  expect(stored().map((r) => r.client_id)).toEqual(['a'])
  upsert.mockResolvedValue({ error: null })
  await flush()
  expect(stored()).toEqual([])
  expect(upsert).toHaveBeenLastCalledWith('free_plays', expect.objectContaining({ client_id: 'a' }), { onConflict: 'client_id', ignoreDuplicates: true })
})

test('success on first submit leaves queue empty', async () => {
  upsert.mockResolvedValue({ error: null })
  await submit(row('a'))
  expect(stored()).toEqual([])
})

test('network throw is treated as failure', async () => {
  upsert.mockRejectedValue(new TypeError('Failed to fetch'))
  await submit(row('a'))
  expect(stored()).toHaveLength(1)
})

test('caps_at_50_dropping_oldest', async () => {
  upsert.mockResolvedValue({ error: { message: 'offline' } })
  for (let i = 0; i < 53; i++) await submit(row(`c${i}`))
  const ids = stored().map((r) => r.client_id)
  expect(ids).toHaveLength(50)
  expect(ids[0]).toBe('c3')
  expect(ids.at(-1)).toBe('c52')
})

test('queue_resend_is_idempotent', async () => {
  // 서버는 저장했지만 응답이 유실된 경우: 같은 client_id로 다시 보낸다.
  upsert.mockResolvedValueOnce({ error: { message: 'lost' } })
  await submit(row('same'))
  upsert.mockResolvedValueOnce({ error: null }) // 서버가 중복을 무시하고 성공
  await flush()
  await flush() // 큐가 비었으니 더 보내지 않는다
  const ids = upsert.mock.calls.map((c) => (c[1] as FreePlayRow).client_id)
  expect(ids).toEqual(['same', 'same'])
  expect(stored()).toEqual([])
})

test('submitting the same client_id twice keeps one queued row', async () => {
  upsert.mockResolvedValue({ error: { message: 'x' } })
  await submit(row('d'))
  await submit(row('d'))
  expect(stored()).toHaveLength(1)
})

test('localStorage_unavailable_does_not_throw', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  upsert.mockResolvedValue({ error: null })
  await expect(submit(row('e'))).resolves.toBe(true)
  await expect(flush()).resolves.toBeUndefined()
  expect(upsert).toHaveBeenCalled()
})

test('submit_returns_whether_this_row_was_saved', async () => {
  upsert.mockResolvedValueOnce({ error: null })
  expect(await submit(row('ok'))).toBe(true)
  upsert.mockResolvedValueOnce({ error: { message: 'offline' } })
  expect(await submit(row('fail'))).toBe(false)
  expect(stored().map((r) => r.client_id)).toEqual(['fail'])
  // 앞서 남은 행이 다시 실패해도 이번 행이 들어갔으면 true
  upsert.mockResolvedValueOnce({ error: { message: 'still' } }).mockResolvedValueOnce({ error: null })
  expect(await submit(row('next'))).toBe(true)
  expect(stored().map((r) => r.client_id)).toEqual(['fail'])
})

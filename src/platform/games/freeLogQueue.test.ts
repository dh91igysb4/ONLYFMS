import { beforeEach, expect, test, vi } from 'vitest'

const upsert = vi.fn()
vi.mock('../../lib/supabase.ts', () => ({
  supabase: { from: (t: string) => ({ upsert: (...a: unknown[]) => upsert(t, ...a) }) },
}))
const pending = vi.fn<() => Set<string>>(() => new Set())
vi.mock('./freeQueue.ts', () => ({ pendingIds: () => pending() }))

import { flushLogs, LOG_KEY, MAX_LOG_QUEUE, resetFreeLogQueue, submitLog, type FreeLogRow } from './freeLogQueue.ts'

const row = (id: string): Omit<FreeLogRow, 'attempts'> => ({
  client_id: id, user_id: 'u1', seed: '03'.repeat(16), actions: [{ type: 'guess', value: 1 }],
})
const stored = () => JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as FreeLogRow[]
const done = Promise.resolve()

beforeEach(() => {
  upsert.mockReset()
  pending.mockReset()
  pending.mockReturnValue(new Set())
  localStorage.clear()
  resetFreeLogQueue()
  vi.restoreAllMocks()
})

test('sends_after_score_row', async () => {
  upsert.mockResolvedValue({ error: null })
  let release!: () => void
  const after = new Promise<void>((r) => { release = r })
  const p = submitLog(row('a'), after)
  await Promise.resolve()
  expect(upsert).not.toHaveBeenCalled()
  release()
  await p
  expect(upsert).toHaveBeenCalledTimes(1)
  const [table, sent, opts] = upsert.mock.calls[0]
  expect(table).toBe('free_play_logs')
  expect(opts).toEqual({ onConflict: 'client_id', ignoreDuplicates: true })
  expect(sent).toEqual(row('a'))
  expect(sent).not.toHaveProperty('attempts')
  expect(stored()).toEqual([])
})

test('sends_after_score_failure_too', async () => {
  upsert.mockResolvedValue({ error: null })
  await submitLog(row('a'), Promise.reject(new Error('x')))
  expect(upsert).toHaveBeenCalledTimes(1)
})

test('skips_while_score_pending', async () => {
  pending.mockReturnValue(new Set(['a']))
  await submitLog(row('a'), done)
  expect(upsert).not.toHaveBeenCalled()
  expect(stored().map((r) => r.client_id)).toEqual(['a'])
  expect(stored()[0].attempts).toBe(0)
})

test('fk_error_three_strikes', async () => {
  upsert.mockResolvedValue({ error: { code: '23503' } })
  await submitLog(row('a'), done)
  expect(stored()[0].attempts).toBe(1)
  await flushLogs()
  expect(stored()[0].attempts).toBe(2)
  await flushLogs()
  expect(stored()).toEqual([])
})

test.each(['42501', '23514'])('drops_on_rls_or_check %s', async (code) => {
  upsert.mockResolvedValue({ error: { code } })
  await submitLog(row('a'), done)
  expect(stored()).toEqual([])
  await flushLogs()
  expect(upsert).toHaveBeenCalledTimes(1)
})

test('keeps_on_network_error', async () => {
  upsert.mockRejectedValue(new TypeError('Failed to fetch'))
  await submitLog(row('a'), done)
  expect(stored()).toHaveLength(1)
  upsert.mockResolvedValue({ error: { message: 'x' } })
  await flushLogs()
  expect(stored()).toHaveLength(1)
  expect(stored()[0].attempts).toBe(0)
})

test('max_10', async () => {
  upsert.mockRejectedValue(new TypeError('offline'))
  for (let i = 0; i < 12; i++) await submitLog(row(`c${i}`), done)
  const ids = stored().map((r) => r.client_id)
  expect(ids).toHaveLength(MAX_LOG_QUEUE)
  expect(ids[0]).toBe('c2')
  expect(ids[9]).toBe('c11')
})

test('storage_failure_isolated', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  upsert.mockResolvedValue({ error: null })
  await expect(submitLog(row('a'), done)).resolves.toBeUndefined()
  expect(upsert).toHaveBeenCalledTimes(1)
  expect(localStorage.getItem('onlyfms:freeQueue')).toBeNull()
})

test('flush_during_flush_reruns', async () => {
  let release!: (v: { error: null }) => void
  upsert.mockReturnValueOnce(new Promise((r) => { release = r }))
  upsert.mockResolvedValue({ error: null })
  const p1 = submitLog(row('a'), done)
  await new Promise((r) => setTimeout(r, 0))
  const p2 = submitLog(row('b'), done)
  release({ error: null })
  await Promise.all([p1, p2])
  expect(upsert.mock.calls.map((c) => c[1].client_id)).toEqual(['a', 'b'])
  expect(stored()).toEqual([])
})

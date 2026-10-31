import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('./supabase.ts', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  },
  supabaseUrl: 'http://sb.test',
  supabaseKey: 'pub',
}))

import { ApiError, duel, duelErrorMessage, errorMessage, play, rpc } from './api.ts'

beforeEach(() => { rpcMock.mockReset() })
afterEach(() => vi.unstubAllGlobals())

async function err(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p
  } catch (e) {
    return e as ApiError
  }
  throw new Error('did not throw')
}

test('rpc P0001 -> code = message', async () => {
  rpcMock.mockResolvedValue({ data: null, error: { message: 'handle_taken', code: 'P0001' } })
  const e = await err(rpc('set_handle', { new_handle: 'x' }))
  expect(e).toBeInstanceOf(ApiError)
  expect([e.code, e.status]).toEqual(['handle_taken', 400])
})

test('rpc fetch-failure shape -> network/0', async () => {
  rpcMock.mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } })
  const e = await err(rpc('my_profile'))
  expect([e.code, e.status]).toEqual(['network', 0])
})

test('rpc thrown -> network/0', async () => {
  rpcMock.mockImplementation(() => Promise.reject(new TypeError('x')))
  const e = await err(rpc('my_profile'))
  expect([e.code, e.status]).toEqual(['network', 0])
})

test('rpc 42501 -> forbidden', async () => {
  rpcMock.mockResolvedValue({ data: null, error: { message: 'permission denied for table x', code: '42501' } })
  expect((await err(rpc('x'))).code).toBe('forbidden')
})

test('rpc other postgres error -> unknown', async () => {
  rpcMock.mockResolvedValue({ data: null, error: { message: 'relation does not exist', code: '42P01' } })
  expect((await err(rpc('x'))).code).toBe('unknown')
})

test('rpc success returns data', async () => {
  rpcMock.mockResolvedValue({ data: 'kane', error: null })
  expect(await rpc('set_handle')).toBe('kane')
})

test('play non-2xx -> ApiError(body.error, status, body)', async () => {
  const body = { error: 'stale', view: { item_id: 'i' } }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 409 })))
  const e = await err(play({ op: 'act' }))
  expect([e.code, e.status, e.body]).toEqual(['stale', 409, body])
})

test('play fetch reject -> network/0', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
  const e = await err(play({}))
  expect([e.code, e.status]).toEqual(['network', 0])
})

test('play 2xx -> PlayView, sends auth headers', async () => {
  const view = { item_id: 'i', finished: false }
  const f = vi.fn(async () => new Response(JSON.stringify(view), { status: 200 }))
  vi.stubGlobal('fetch', f)
  expect(await play({ op: 'open' })).toEqual(view)
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('http://sb.test/functions/v1/play')
  expect(init.headers).toMatchObject({ authorization: 'Bearer tok', apikey: 'pub' })
})

test('duel posts to /functions/v1/duel and passes 409 view as body', async () => {
  const body = { error: 'not_due', view: { match_id: 'm' } }
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status: 409 }))
  vi.stubGlobal('fetch', f)
  const e = await err(duel({ action: 'tick', match_id: 'm' }))
  expect([e.code, e.status, e.body]).toEqual(['not_due', 409, body])
  expect((f.mock.calls[0] as unknown as [string])[0]).toBe('http://sb.test/functions/v1/duel')
})

test('duel messages', () => {
  expect(duelErrorMessage('not_your_turn')).toBe('상대 차례예요')
  expect(duelErrorMessage('stale')).toBe('화면을 새로 맞췄어요')
  expect(duelErrorMessage('full')).toBe('이미 시작된 대국이에요')
  expect(duelErrorMessage('own_match')).toBe('내가 만든 대국이에요')
  expect(duelErrorMessage('too_many_waiting')).toBe('기다리는 대국은 3개까지 만들 수 있어요')
  expect(duelErrorMessage('not_due')).toBe('')
  expect(duelErrorMessage('version_changed')).toBe('규칙이 바뀌어 이 대국은 무효가 됐어요')
  expect(errorMessage('stale')).toBe('다른 화면에서 진행된 내용으로 갱신했어요') // 대회 문구는 그대로
})

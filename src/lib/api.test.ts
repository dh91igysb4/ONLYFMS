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

import { ApiError, play, rpc } from './api.ts'

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

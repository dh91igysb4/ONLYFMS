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

import { ApiError, duel, duelActionMessage, duelErrorMessage, errorMessage, play, rpc, world } from './api.ts'

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

test('rpc P0001 DETAIL -> body.details (fee_mismatch의 지금 참가비)', async () => {
  rpcMock.mockResolvedValue({ data: null, error: { message: 'fee_mismatch', code: 'P0001', details: '700' } })
  const e = await err(rpc('join_by_invite_code', { p_code: 'x' }))
  expect([e.code, e.body]).toEqual(['fee_mismatch', { details: '700' }])
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
  expect(duelErrorMessage('prepare_failed')).toBe('판을 준비하지 못했어요. 잠시 뒤 다시 해 주세요')
})

test('duel action messages: logic sentences shown, codes hidden', () => {
  expect(duelActionMessage('이미 쓴 선수예요')).toBe('이미 쓴 선수예요')
  expect(duelActionMessage('bad_pick')).toBe('할 수 없는 행동이에요')
  expect(duelActionMessage('no_rolls_left2')).toBe('할 수 없는 행동이에요')
  expect(duelActionMessage(undefined)).toBe('할 수 없는 행동이에요')
  expect(duelActionMessage('')).toBe('할 수 없는 행동이에요')
  expect(duelActionMessage(42)).toBe('할 수 없는 행동이에요')
  expect(duelActionMessage('x'.repeat(201))).toBe('할 수 없는 행동이에요')
})

test('world act: action_id를 붙이고, 응답을 못 받으면 같은 id로 다시 보낸다(4xx는 다시 보내지 않는다)', async () => {
  vi.useFakeTimers()
  try {
    const sent: Record<string, unknown>[] = []
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string))
      n++
      if (n === 1) throw new TypeError('Failed to fetch')
      if (n === 2) return new Response('{"error":"internal"}', { status: 500 })
      return new Response(JSON.stringify({ view: { ok: true }, result: null, server_now: 1 }), { status: 200 })
    }))
    const p = world({ game: 'g', action: 'act', payload: { type: 'x' } })
    await vi.runAllTimersAsync()
    expect((await p).view).toEqual({ ok: true })
    expect(sent).toHaveLength(3)
    const id = sent[0].action_id
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(sent.every((b) => b.action_id === id && (b.payload as { type: string }).type === 'x')).toBe(true)

    sent.length = 0
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string))
      return new Response('{"error":"bag_changed"}', { status: 400 })
    }))
    const e = await err(world({ game: 'g', action: 'act', payload: {} }))
    expect(e.code).toBe('bag_changed')
    expect(sent).toHaveLength(1)
    expect(sent[0].action_id).not.toBe(id)

    // load에는 action_id가 없고 다시 보내지 않는다
    sent.length = 0
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string))
      throw new TypeError('Failed to fetch')
    }))
    expect((await err(world({ game: 'g', action: 'load' }))).code).toBe('network')
    expect(sent).toEqual([{ game: 'g', action: 'load' }])
  } finally {
    vi.useRealTimers()
  }
})

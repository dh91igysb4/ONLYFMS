import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type Handler = (arg: { payload?: unknown }) => void
const fake = {
  name: '' as string,
  opts: undefined as unknown,
  handlers: new Map<string, Handler>(),
  status: null as ((s: string) => void) | null,
  presence: {} as Record<string, unknown[]>,
  send: vi.fn(),
  track: vi.fn(),
  throwOnChannel: false,
}
const removeChannel = vi.fn()
vi.mock('../../lib/supabase.ts', () => ({
  supabase: {
    channel: (name: string, opts: unknown) => {
      if (fake.throwOnChannel) throw new Error('no realtime')
      fake.name = name
      fake.opts = opts
      const ch = {
        on: (type: string, filter: { event: string }, cb: Handler) => { fake.handlers.set(`${type}:${filter.event}`, cb); return ch },
        subscribe: (cb: (s: string) => void) => { fake.status = cb; return ch },
        send: (m: unknown) => fake.send(m),
        track: (m: unknown) => fake.track(m),
        presenceState: () => fake.presence,
      }
      return ch
    },
    removeChannel: (...a: unknown[]) => removeChannel(...a),
  },
}))

import { joinWorldRoom, roomName } from './room.ts'

const me = { id: 'me', handle: 'kane', x: 10, y: 20, facing: 'down' as const, moving: false, act: 'walk' as const, outfit: '{}' }
const other = (over: Record<string, unknown> = {}) => ({ ...me, id: 'u2', handle: 'son', t: 1, ...over })
const sync = (...ids: string[]) => {
  fake.presence = Object.fromEntries(ids.map((id) => [id, [{ id }]]))
  fake.handlers.get('presence:sync')?.({})
}
const pos = (payload: unknown) => fake.handlers.get('broadcast:pos')?.({ payload })

beforeEach(() => {
  fake.handlers.clear()
  fake.status = null
  fake.presence = {}
  fake.send.mockReset()
  fake.track.mockReset()
  fake.throwOnChannel = false
  removeChannel.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('joinWorldRoom', () => {
  test('채널 이름·프레즌스 키·self false', () => {
    joinWorldRoom('fishing', 'village', 'me')
    expect(roomName('fishing', 'village')).toBe('world:fishing:village')
    expect(fake.name).toBe('world:fishing:village')
    expect(fake.opts).toEqual({ config: { presence: { key: 'me' }, broadcast: { self: false } } })
  })

  test('SUBSCRIBED면 track 한 번', () => {
    joinWorldRoom('fishing', 'village', 'me')
    fake.status?.('SUBSCRIBED')
    expect(fake.track).toHaveBeenCalledTimes(1)
    expect(fake.track).toHaveBeenCalledWith({ id: 'me' })
  })

  test('둘이면 tick이 위치를 보낸다', () => {
    const r = joinWorldRoom('fishing', 'village', 'me')
    expect(r.count()).toBe(1)
    fake.status?.('SUBSCRIBED')
    sync('me', 'u2')
    expect(r.count()).toBe(2)
    r.tick(5000, me)
    expect(fake.send).toHaveBeenCalledTimes(1)
    expect(fake.send).toHaveBeenCalledWith({ type: 'broadcast', event: 'pos', payload: { ...me, t: 5000 } })
  })

  test('구독 뒤 연결이 끊기면(CHANNEL_ERROR·CLOSED) 보내지 않고 인원을 1로 되돌린다', () => {
    for (const status of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
      fake.send.mockReset()
      const r = joinWorldRoom('fishing', 'village', 'me')
      fake.status?.('SUBSCRIBED')
      sync('me', 'u2')
      fake.status?.(status)
      expect(r.count(), status).toBe(1)
      r.tick(9000, me)
      expect(fake.send, status).not.toHaveBeenCalled()
      fake.status?.('SUBSCRIBED')
      sync('me', 'u2')
      r.tick(20000, me)
      expect(fake.send, status).toHaveBeenCalledTimes(1)
    }
  })

  test('구독 전에는 프레즌스가 있어도 보내지 않는다', () => {
    const r = joinWorldRoom('fishing', 'village', 'me')
    sync('me', 'u2')
    r.tick(5000, me)
    expect(fake.send).not.toHaveBeenCalled()
  })

  test('혼자면 보내지 않는다', () => {
    const r = joinWorldRoom('fishing', 'village', 'me')
    sync('me')
    r.tick(5000, me)
    expect(fake.send).not.toHaveBeenCalled()
  })

  test('받은 위치: 정상은 보이고, 깨진 것·내 것은 무시', () => {
    const r = joinWorldRoom('fishing', 'village', 'me')
    sync('me', 'u2')
    pos(other())
    pos({ broken: true })
    pos(other({ id: 'me' }))
    expect(r.peers(0).map((p) => p.handle)).toEqual(['son'])
  })

  test('프레즌스에서 빠지면 사라진다', () => {
    const r = joinWorldRoom('fishing', 'village', 'me')
    sync('me', 'u2')
    pos(other())
    sync('me')
    expect(r.peers(0)).toEqual([])
  })

  test('CHANNEL_ERROR는 경고만', () => {
    joinWorldRoom('fishing', 'village', 'me')
    expect(() => fake.status?.('CHANNEL_ERROR')).not.toThrow()
    expect(console.warn).toHaveBeenCalled()
  })

  test('channel()이 던져도 안전', () => {
    fake.throwOnChannel = true
    const r = joinWorldRoom('fishing', 'village', 'me')
    expect(() => { r.tick(0, me); r.leave() }).not.toThrow()
    expect(r.peers(0)).toEqual([])
    expect(r.count()).toBe(1)
  })

  test('leave 두 번이면 removeChannel 한 번', () => {
    const r = joinWorldRoom('fishing', 'village', 'me')
    r.leave()
    r.leave()
    expect(removeChannel).toHaveBeenCalledTimes(1)
  })
})

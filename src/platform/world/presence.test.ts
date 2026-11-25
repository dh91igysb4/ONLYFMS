import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type Handler = (arg: unknown) => void
const fake = {
  name: '', opts: undefined as unknown, handlers: new Map<string, Handler>(),
  status: null as ((s: string) => void) | null, presence: {} as Record<string, unknown[]>,
  track: vi.fn(), throwOnChannel: false,
}
const removeChannel = vi.fn()
vi.mock('../../lib/supabase.ts', () => ({
  supabase: {
    channel: (name: string, opts: unknown) => {
      if (fake.throwOnChannel) throw new Error('no realtime')
      fake.name = name
      fake.opts = opts
      const ch = {
        on: (type: string, f: { event: string }, cb: Handler) => { fake.handlers.set(`${type}:${f.event}`, cb); return ch },
        subscribe: (cb: (s: string) => void) => { fake.status = cb; return ch },
        track: (m: unknown) => fake.track(m),
        presenceState: () => fake.presence,
      }
      return ch
    },
    removeChannel: (...a: unknown[]) => removeChannel(...a),
  },
}))

import { PRESENCE_MOVE_MS, joinWorldPresence, parseOnlinePeer, presenceName, shouldTrack, type OnlinePeer } from './presence.ts'

const peer = (over: Partial<OnlinePeer> = {}): OnlinePeer => ({ id: 'u2', handle: 'son', area: 'forest', act: 'fish', tx: 3, ty: 4, ...over })
const me = peer({ id: 'me', handle: 'kane', area: 'village', act: 'walk' })
const sync = (state: Record<string, unknown[]>) => {
  fake.presence = state
  fake.handlers.get('presence:sync')?.({})
}

beforeEach(() => {
  fake.handlers.clear()
  fake.status = null
  fake.presence = {}
  fake.track.mockReset()
  fake.throwOnChannel = false
  removeChannel.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('parseOnlinePeer', () => {
  test('정상은 그대로, 깨진 것은 null', () => {
    expect(parseOnlinePeer(peer())).toEqual(peer())
    const bad: unknown[] = [
      peer({ area: 'Bad Area' }), peer({ act: 'run' as never }), peer({ handle: 'x'.repeat(33) }), peer({ handle: '' }),
      peer({ tx: -1 }), peer({ tx: 1.5 }), peer({ ty: NaN }), { ...peer(), id: undefined }, null, 'x',
    ]
    for (const b of bad) expect(parseOnlinePeer(b), JSON.stringify(b)).toBeNull()
  })
  test('장소 값은 48자까지(주인 있는 장소 isle-<32자>)', () => {
    const key = `isle-${'a'.repeat(32)}`
    expect(parseOnlinePeer(peer({ area: key }))).toEqual(peer({ area: key }))
    expect(parseOnlinePeer(peer({ area: 'a'.repeat(48) }))).not.toBeNull()
    expect(parseOnlinePeer(peer({ area: 'a'.repeat(49) }))).toBeNull()
  })
})

describe('shouldTrack', () => {
  test('규칙', () => {
    expect(shouldTrack(null, me, 0)).toBe(true)
    const prev = { s: me, at: 1000 }
    expect(shouldTrack(prev, { ...me, area: 'river' }, 1001)).toBe(true)
    expect(shouldTrack(prev, { ...me, act: 'fish' }, 1001)).toBe(true)
    expect(shouldTrack(prev, { ...me, tx: 9 }, 1000 + PRESENCE_MOVE_MS - 1)).toBe(false)
    expect(shouldTrack(prev, { ...me, tx: 9 }, 1000 + PRESENCE_MOVE_MS)).toBe(true)
    expect(shouldTrack(prev, me, 1000 + 3 * PRESENCE_MOVE_MS)).toBe(false)
  })
})

describe('joinWorldPresence', () => {
  test('채널 이름과 프레즌스 키', () => {
    joinWorldPresence('fishing', 'me', false)
    expect(presenceName('fishing')).toBe('world:fishing')
    expect(fake.name).toBe('world:fishing')
    expect(fake.opts).toEqual({ config: { presence: { key: 'me' } } })
  })

  test('구독 전 update는 보관했다가 SUBSCRIBED 때 마지막 상태로 한 번', () => {
    const p = joinWorldPresence('fishing', 'me', false)
    p.update(me, 0)
    p.update({ ...me, area: 'river' }, 10)
    expect(fake.track).not.toHaveBeenCalled()
    fake.status?.('SUBSCRIBED')
    expect(fake.track).toHaveBeenCalledTimes(1)
    expect(fake.track).toHaveBeenCalledWith({ ...me, area: 'river' })
    p.update({ ...me, area: 'river' }, 20)
    expect(fake.track).toHaveBeenCalledTimes(1)
    p.update({ ...me, area: 'forest' }, 30)
    expect(fake.track).toHaveBeenCalledTimes(2)
  })

  test('듣기 전용이면 track 하지 않는다', () => {
    const p = joinWorldPresence('fishing', 'me', true)
    p.update(me, 0)
    fake.status?.('SUBSCRIBED')
    p.update({ ...me, area: 'river' }, 10)
    expect(fake.track).not.toHaveBeenCalled()
  })

  test('sync: 나 빼고 아이디 가나다순, 같은 키는 마지막 상태, 깨진 상태는 빠짐, onChange', () => {
    const p = joinWorldPresence('fishing', 'me', false)
    const cb = vi.fn()
    p.onChange(cb)
    sync({
      me: [me],
      u3: [peer({ id: 'u3', handle: 'zed' })],
      u2: [peer({ area: 'river' }), peer({ area: 'cave' })],
      u4: [{ broken: true }],
    })
    expect(p.peers().map((x) => [x.handle, x.area])).toEqual([['son', 'cave'], ['zed', 'forest']])
    expect(cb).toHaveBeenCalledTimes(1)
  })

  test('CHANNEL_ERROR면 목록을 비우고 알리며 그 뒤 track 없음', () => {
    const p = joinWorldPresence('fishing', 'me', false)
    const cb = vi.fn()
    p.onChange(cb)
    fake.status?.('SUBSCRIBED')
    sync({ u2: [peer()] })
    fake.status?.('CHANNEL_ERROR')
    expect(p.peers()).toEqual([])
    expect(cb).toHaveBeenCalledTimes(2)
    fake.track.mockReset()
    p.update({ ...me, area: 'cave' }, 99)
    expect(fake.track).not.toHaveBeenCalled()
  })

  test('재연결: 끊긴 동안 온 상태는 다시 SUBSCRIBED 때 보낸다', () => {
    const p = joinWorldPresence('fishing', 'me', false)
    fake.status?.('SUBSCRIBED')
    p.update(me, 0)
    fake.status?.('CHANNEL_ERROR')
    p.update(me, 1)
    fake.status?.('SUBSCRIBED')
    expect(fake.track).toHaveBeenCalledTimes(2)
    expect(fake.track).toHaveBeenLastCalledWith(me)
  })

  test('재연결: 끊긴 동안 update가 없었어도 다음 update에서 같은 상태를 다시 보낸다', () => {
    const p = joinWorldPresence('fishing', 'me', false)
    fake.status?.('SUBSCRIBED')
    p.update(me, 0)
    fake.status?.('CHANNEL_ERROR')
    fake.status?.('SUBSCRIBED')
    p.update(me, 1)
    expect(fake.track).toHaveBeenCalledTimes(2)
  })

  test('track이 ok가 아니면 다음 update에서 다시 보낸다', async () => {
    fake.track.mockResolvedValueOnce('timed out').mockResolvedValue('ok')
    const p = joinWorldPresence('fishing', 'me', false)
    fake.status?.('SUBSCRIBED')
    p.update(me, 0)
    await Promise.resolve(); await Promise.resolve()
    p.update(me, 1)
    expect(fake.track).toHaveBeenCalledTimes(2)
    await Promise.resolve(); await Promise.resolve()
    p.update(me, 2)
    expect(fake.track).toHaveBeenCalledTimes(2)
  })

  test('channel()이 던져도 안전, leave 두 번이면 removeChannel 한 번', () => {
    fake.throwOnChannel = true
    const a = joinWorldPresence('fishing', 'me', false)
    expect(() => { a.update(me, 0); a.leave() }).not.toThrow()
    expect(a.peers()).toEqual([])
    fake.throwOnChannel = false
    const b = joinWorldPresence('fishing', 'me', false)
    b.leave()
    b.leave()
    expect(removeChannel).toHaveBeenCalledTimes(1)
  })
})

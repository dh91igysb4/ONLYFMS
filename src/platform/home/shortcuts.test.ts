import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Manifest } from '../../games/types.ts'

const rpcMock = vi.fn()
const listMock = vi.fn()
const mineMock = vi.fn()
vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))
vi.mock('../contests/data.ts', () => ({
  listContests: (...a: unknown[]) => listMock(...a),
  getMyContestIds: (...a: unknown[]) => mineMock(...a),
}))
vi.mock('../contests/clock.ts', () => ({ syncServerTime: () => Promise.resolve() }))

import { now } from '../../lib/serverTime.ts'
import { kstDate } from '../../shared/kst.ts'
import { buildShortcuts, loadDailyDone, loadMyOpenDuels, loadOpenContests, shortcutTarget } from './shortcuts.ts'

function m(id: string, modes: Manifest['modes'], extra: Partial<Manifest> = {}): { manifest: Manifest } {
  return {
    manifest: {
      id, name: `이름-${id}`, description: `설명-${id}`, hidden: false, modes,
      puzzleSource: 'generate', dailyTimeLimitSec: null, options: [], ...extra,
    } as Manifest,
  }
}
const BOTH = { daily: true, contest: true, free: true }
const FREE = { daily: false, contest: false, free: true }
const NONE = { daily: false, contest: false, free: false }

beforeEach(() => {
  rpcMock.mockReset()
  listMock.mockReset()
  mineMock.mockReset()
})

describe('buildShortcuts', () => {
  test('순서: 데일리 게임들 → 대전 → 대회 → 자유 플레이 게임들 (데일리+자유 게임은 두 번)', () => {
    const list = buildShortcuts([m('wya', BOTH), m('ball', FREE), m('rider', FREE)], false)
    expect(list.map((s) => [s.label, s.to, s.badge])).toEqual([
      ['데일리 이름-wya', '/play/wya/daily', 'daily'],
      ['대전', '/duel', 'duels'],
      ['대회', '/contests', 'contests'],
      ['이름-wya', '/play/wya/free', null],
      ['이름-ball', '/play/ball/free', null],
      ['이름-rider', '/play/rider/free', null],
    ])
    expect(list[0].gameId).toBe('wya')
    expect(new Set(list.map((s) => s.key)).size).toBe(list.length)
  })

  test('숨김 게임은 관리자에게만', () => {
    const mods = [m('wya', BOTH), m('secret', FREE, { hidden: true })]
    expect(buildShortcuts(mods, false).some((s) => s.label === '이름-secret')).toBe(false)
    expect(buildShortcuts(mods, true).some((s) => s.label === '이름-secret')).toBe(true)
  })

  test('모드가 모두 false인 모듈(지속형·대전)은 버튼을 만들지 않는다', () => {
    const list = buildShortcuts([m('fishing', NONE, { category: 'world' }), m('yacht', NONE, { category: 'duel' })], false)
    expect(list.map((s) => s.key)).toEqual(['duel', 'contests'])
  })
})

describe('shortcutTarget', () => {
  const p = (id: string) => `/duel/${id}`
  test('하나뿐이면 그곳, 아니면 목록', () => {
    expect(shortcutTarget('/duel', [{ id: 'a' }], p)).toBe('/duel/a')
    expect(shortcutTarget('/duel', [], p)).toBe('/duel')
    expect(shortcutTarget('/duel', [{ id: 'a' }, { id: 'b' }], p)).toBe('/duel')
  })
})

describe('loaders', () => {
  test('loadDailyDone: 오늘(KST) lb_daily에 내 행이 있으면 true', async () => {
    rpcMock.mockResolvedValueOnce([{ user_id: 'u1', score: 7 }])
    await expect(loadDailyDone('wya', 'u1')).resolves.toBe(true)
    expect(rpcMock).toHaveBeenCalledWith('lb_daily', { p_day: kstDate(now()), p_game: 'wya' })
    rpcMock.mockResolvedValueOnce([{ user_id: 'u2', score: 7 }])
    await expect(loadDailyDone('wya', 'u1')).resolves.toBe(false)
    rpcMock.mockResolvedValueOnce(null)
    await expect(loadDailyDone('wya', 'u1')).resolves.toBe(false)
  })

  test('loadMyOpenDuels: duel_list().mine 중 active·waiting(내 대기 방 포함)', async () => {
    rpcMock.mockResolvedValueOnce({
      lobby: [], recent: [], due: [],
      mine: [{ id: 'w', status: 'waiting' }, { id: 'a', status: 'active' }, { id: 'f', status: 'finished' }],
    })
    const r = await loadMyOpenDuels()
    expect(rpcMock).toHaveBeenCalledWith('duel_list')
    expect(r.map((d) => d.id)).toEqual(['w', 'a'])
  })

  test('loadOpenContests: 공개이거나 참가했고, 취소 아니고, 진행 중이거나 24시간 안에 시작', async () => {
    const t = now()
    const iso = (ms: number) => new Date(t + ms).toISOString()
    const H = 3_600_000
    listMock.mockResolvedValueOnce([
      { id: 'pub-live', starts_at: iso(-H), ends_at: iso(H), cancelled_at: null, visibility: 'public' },
      { id: 'inv-live', starts_at: iso(-H), ends_at: iso(H), cancelled_at: null, visibility: 'invite' },
      { id: 'live', starts_at: iso(-H), ends_at: iso(H), cancelled_at: null, visibility: 'public' },
      { id: 'soon', starts_at: iso(23 * H), ends_at: iso(30 * H), cancelled_at: null, visibility: 'invite' },
      { id: 'later', starts_at: iso(25 * H), ends_at: iso(30 * H), cancelled_at: null, visibility: 'public' },
      { id: 'cancelled', starts_at: iso(-H), ends_at: iso(H), cancelled_at: iso(-H), visibility: 'public' },
      { id: 'ended', starts_at: iso(-3 * H), ends_at: iso(-H), cancelled_at: null, visibility: 'public' },
    ])
    mineMock.mockResolvedValueOnce(new Set(['live', 'soon', 'later', 'cancelled', 'ended']))
    const r = await loadOpenContests('u1')
    expect(mineMock).toHaveBeenCalledWith('u1')
    expect(r.map((c) => c.id)).toEqual(['pub-live', 'live', 'soon'])
  })
})

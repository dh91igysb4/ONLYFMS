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
import {
  buildShortcuts, loadDailyScore, loadDuelList, loadMyOpenDuels, loadOpenContests, loadTodayTop, recentChips, shortcutTarget,
} from './shortcuts.ts'
import type { DuelListItem } from '../duel/data.ts'

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
  test('loadDailyScore: 오늘(KST) lb_daily에 내 행이 있으면 그 점수, 없으면 null', async () => {
    rpcMock.mockResolvedValueOnce([{ user_id: 'u1', score: 7 }])
    await expect(loadDailyScore('wya', 'u1')).resolves.toBe(7)
    expect(rpcMock).toHaveBeenCalledWith('lb_daily', { p_day: kstDate(now()), p_game: 'wya' })
    rpcMock.mockResolvedValueOnce([{ user_id: 'u2', score: 7 }])
    await expect(loadDailyScore('wya', 'u1')).resolves.toBeNull()
    rpcMock.mockResolvedValueOnce(null)
    await expect(loadDailyScore('wya', 'u1')).resolves.toBeNull()
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

  const row = (rank: number, id: string) => ({ rank, user_id: id, handle: `h${id}`, score: 10 - rank, action_count: 3, finished_at: null })

  test('loadTodayTop: 오늘 전체(p_game null) 위 3명, 내가 4위 밖이면 me, 안이면·기록 없으면 null', async () => {
    rpcMock.mockResolvedValueOnce([row(1, 'a'), row(2, 'b'), row(3, 'c'), row(4, 'd'), row(5, 'u1')])
    const r = await loadTodayTop('u1')
    expect(rpcMock).toHaveBeenCalledWith('lb_daily', { p_day: kstDate(now()), p_game: null })
    expect(r.top.map((x) => x.handle)).toEqual(['ha', 'hb', 'hc'])
    expect(r.top[0]).toEqual({ rank: 1, user_id: 'a', handle: 'ha', score: 9 })
    expect(r.me).toEqual({ rank: 5, user_id: 'u1', handle: 'hu1', score: 5 })
    rpcMock.mockResolvedValueOnce([row(1, 'a'), row(2, 'u1'), row(3, 'c'), row(4, 'd')])
    expect((await loadTodayTop('u1')).me).toBeNull()
    rpcMock.mockResolvedValueOnce([row(1, 'a')])
    const none = await loadTodayTop('u1')
    expect(none.me).toBeNull()
    expect(none.top).toHaveLength(1)
    rpcMock.mockResolvedValueOnce(null)
    expect(await loadTodayTop('u1')).toEqual({ top: [], me: null })
  })

  test('loadDuelList는 동시에 두 번 불러도 duel_list RPC 한 번, 끝난 뒤 부르면 다시 부른다', async () => {
    const list = { lobby: [], mine: [], recent: [], due: [] }
    rpcMock.mockResolvedValue(list)
    const [a, b] = await Promise.all([loadDuelList(), loadMyOpenDuels()])
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(a).toEqual(list)
    expect(b).toEqual([])
    await loadDuelList()
    expect(rpcMock).toHaveBeenCalledTimes(2)
  })

  test('loadDuelList가 실패하면 함께 기다리던 쪽 모두 실패, 다음 호출은 다시 부른다', async () => {
    rpcMock.mockRejectedValueOnce(new Error('x'))
    const r = await Promise.allSettled([loadDuelList(), loadDuelList()])
    expect(r.map((x) => x.status)).toEqual(['rejected', 'rejected'])
    rpcMock.mockResolvedValueOnce({ lobby: [], mine: [], recent: [], due: [] })
    await expect(loadDuelList()).resolves.toBeTruthy()
    expect(rpcMock).toHaveBeenCalledTimes(2)
  })
})

describe('recentChips', () => {
  const duel = (id: string, status: string, winner: 0 | 1 | null, seat: 0 | 1 = 0) => ({
    id, status, winner,
    players: seat === 0 ? [{ id: 'me', handle: 'me', rating: 0 }, { id: 'o', handle: 'o', rating: 0 }]
      : [{ id: 'o', handle: 'o', rating: 0 }, { id: 'me', handle: 'me', rating: 0 }],
  }) as unknown as DuelListItem

  test('내 자리 기준 승·무·패, void는 빼고 최대 5개', () => {
    const list = [
      duel('1', 'finished', 0), duel('2', 'finished', 0, 1), duel('3', 'void', null),
      duel('4', 'finished', null), duel('5', 'finished', 1, 1), duel('6', 'finished', 1), duel('7', 'finished', 0),
    ]
    expect(recentChips(list, 'me')).toEqual(['win', 'loss', 'draw', 'win', 'loss'])
    expect(recentChips([], 'me')).toEqual([])
  })
})

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
const loadMock = vi.fn()
let admin = true
let yachtHidden = false
vi.mock('../../../games/index.ts', async (orig) => {
  const real = await orig<typeof import('../../../games/index.ts')>()
  const list = () => real.duels.map((d) => (d.manifest.id === 'yacht' ? { ...d, manifest: { ...d.manifest, hidden: yachtHidden } } : d))
  return {
    ...real,
    get duels() { return list() },
    getDuel: (id: string) => list().find((d) => d.manifest.id === id),
  }
})
vi.mock('../../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))
vi.mock('../../games/UpcomingContests.tsx', async (orig) => ({
  ...(await orig<typeof import('../../games/UpcomingContests.tsx')>()),
  loadUpcomingContests: (...a: unknown[]) => loadMock(...a),
}))
vi.mock('../../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: admin } }),
}))

import { ContestsBlock } from './ContestsBlock.tsx'
import { DuelsBlock } from './DuelsBlock.tsx'
import { EloBlock } from './EloBlock.tsx'

beforeEach(() => { rpcMock.mockReset(); loadMock.mockReset(); admin = true; yachtHidden = false })

const wrap = (ui: React.ReactNode) => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</MemoryRouter>)

describe('ContestsBlock', () => {
  test('shows live contest with badge and link', async () => {
    loadMock.mockResolvedValue([{
      id: 'c1', kind: 'official', title: '주말 대회', created_by: null, visibility: 'public',
      starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: new Date(Date.now() + 3_600_000).toISOString(),
      cancelled_at: null, daily_key: null, created_at: '2026-11-01T00:00:00Z',
    }])
    wrap(<ContestsBlock title="대회" />)
    expect(await screen.findByText('주말 대회')).toBeInTheDocument()
    expect(screen.getByText('진행 중')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /주말 대회/ })).toHaveAttribute('href', '/contests/c1')
    expect(loadMock).toHaveBeenCalledWith('u1')
  })

  test('empty', async () => {
    loadMock.mockResolvedValue([])
    wrap(<ContestsBlock title="대회" />)
    expect(await screen.findByText('진행 중이거나 곧 시작하는 대회가 없어요')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '대회 보기' })).toHaveAttribute('href', '/contests')
  })

  test('error', async () => {
    loadMock.mockRejectedValue(new Error('x'))
    wrap(<ContestsBlock title="대회" />)
    expect(await screen.findByText('불러오지 못했어요')).toBeInTheDocument()
  })
})

const item = (id: string, status: 'waiting' | 'active', players: { id: string; handle: string | null; rating: number }[], game_id = 'yacht') => ({
  id, game_id, rated: true, visibility: 'public' as const, turn_seconds: 60, status, players,
  created_by_handle: null, created_at: '2026-11-01T00:00:00Z', winner: null, end_reason: null, final_scores: null,
})
const me = { id: 'u1', handle: 'kane', rating: 1500 }

describe('DuelsBlock', () => {
  test('active vs opponent, waiting, lobby count, calls duel_list once', async () => {
    rpcMock.mockResolvedValue({
      mine: [item('m1', 'active', [me, { id: 'u2', handle: 'son', rating: 1500 }]), item('m2', 'waiting', [me])],
      lobby: [item('l1', 'waiting', []), item('l2', 'waiting', []), item('l3', 'waiting', [])],
      recent: [], due: [],
    })
    wrap(<DuelsBlock title="대전" />)
    expect(await screen.findByRole('link', { name: '요트 다이스 · vs son' })).toHaveAttribute('href', '/duel/m1')
    expect(screen.getByRole('link', { name: '요트 다이스 · 상대 기다리는 중' })).toHaveAttribute('href', '/duel/m2')
    expect(screen.getByText('공개 대기실 3개')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '대전하러 가기' })).toHaveAttribute('href', '/duel')
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('duel_list')
  })

  test('at most 5 of mine', async () => {
    rpcMock.mockResolvedValue({
      mine: Array.from({ length: 6 }, (_, i) => item(`m${i}`, 'waiting', [me])), lobby: [], recent: [], due: [],
    })
    wrap(<DuelsBlock title="대전" />)
    await screen.findByText('공개 대기실 0개')
    expect(screen.getAllByRole('link', { name: /^요트 다이스 · / })).toHaveLength(5)
  })

  test('empty mine keeps lobby line and link', async () => {
    rpcMock.mockResolvedValue({ mine: [], lobby: [item('l1', 'waiting', [])], recent: [], due: [] })
    wrap(<DuelsBlock title="대전" />)
    expect(await screen.findByText('진행 중인 대전이 없어요')).toBeInTheDocument()
    expect(screen.getByText('공개 대기실 1개')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '대전하러 가기' })).toHaveAttribute('href', '/duel')
  })

  test('hidden game is dropped for non-admin', async () => {
    admin = false
    yachtHidden = true
    rpcMock.mockResolvedValue({ mine: [item('m1', 'waiting', [me])], lobby: [], recent: [], due: [] })
    wrap(<DuelsBlock title="대전" />)
    expect(await screen.findByText('진행 중인 대전이 없어요')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /요트 다이스/ })).toBeNull()
  })

  test('error', async () => {
    rpcMock.mockRejectedValue(new Error('x'))
    wrap(<DuelsBlock title="대전" />)
    expect(await screen.findByText('불러오지 못했어요')).toBeInTheDocument()
  })
})

const row = (handle: string, rating: number, placed = true, w = 0, d = 0, l = 0) =>
  ({ handle, rating, rated_games: w + d + l, wins: w, draws: d, losses: l, placed })

describe('EloBlock', () => {
  test('no own row: empty copy, link, top 3 placed', async () => {
    rpcMock.mockResolvedValue([row('a', 1700), row('b', 1650), row('c', 1600), row('d', 1550)])
    wrap(<EloBlock title="레이팅" />)
    expect(await screen.findByText('아직 레이팅 대전 기록이 없어요')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '대전하러 가기' })).toHaveAttribute('href', '/duel')
    expect(screen.getByText('1. a 1700')).toBeInTheDocument()
    expect(screen.getByText('3. c 1600')).toBeInTheDocument()
    expect(screen.queryByText('4. d 1550')).toBeNull()
    expect(rpcMock).toHaveBeenCalledWith('lb_duel', { p_game: 'yacht' })
  })

  test('own row not placed shows 배치 중', async () => {
    rpcMock.mockResolvedValue([row('a', 1700), row('kane', 1510, false, 1, 0, 1)])
    wrap(<EloBlock title="레이팅" />)
    expect(await screen.findByText('배치 중')).toBeInTheDocument()
    expect(screen.getByText('레이팅 1510')).toBeInTheDocument()
  })

  test('own placed rank among placed only', async () => {
    rpcMock.mockResolvedValue([row('a', 1700), row('x', 1690, false), row('kane', 1650, true, 3, 1, 2)])
    wrap(<EloBlock title="레이팅" />)
    expect(await screen.findByText('2위')).toBeInTheDocument()
    expect(screen.getByText('레이팅 대전 3승 1무 2패')).toBeInTheDocument()
    expect(screen.getByText('레이팅 1650')).toBeInTheDocument()
    const mineRow = screen.getByText('2. kane 1650')
    expect(mineRow).toHaveClass('me')
    expect(mineRow).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('1. a 1700')).not.toHaveClass('me')
  })

  test('hidden game for non-admin: no games, no rpc', async () => {
    admin = false
    yachtHidden = true
    wrap(<EloBlock title="레이팅" />)
    expect(await screen.findByText('열린 대전 게임이 없어요')).toBeInTheDocument()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  test('error', async () => {
    rpcMock.mockRejectedValue(new Error('x'))
    wrap(<EloBlock title="레이팅" />)
    expect(await screen.findByText('불러오지 못했어요')).toBeInTheDocument()
  })
})

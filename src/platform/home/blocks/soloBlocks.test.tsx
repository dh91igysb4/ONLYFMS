import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
let admin = true
let onlyTest = false
vi.mock('../../../games/index.ts', async (orig) => {
  const { withTestGame, testGuess } = await import('../../../test-fixtures/registry.ts')
  const full = withTestGame(await orig())
  return {
    get games() { return onlyTest ? [testGuess] : full.games },
    getGame: (id: string) => (onlyTest ? [testGuess] : full.games).find((g) => g.manifest.id === id),
  }
})
vi.mock('../../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))
vi.mock('../../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: admin } }),
}))

import { kstWeekStart } from '../../../shared/kst.ts'
import { DailyBlock } from './DailyBlock.tsx'
import { WeeklyBlock } from './WeeklyBlock.tsx'
import { StreakBlock } from './StreakBlock.tsx'

beforeEach(() => { rpcMock.mockReset(); admin = true; onlyTest = false })

/** 테스트 게임 소제목 영역 (등록부에 다른 게임이 있어도 이 영역만 검사한다) */
async function ngSection() {
  const h = await screen.findByRole('heading', { name: '테스트 숫자 맞히기', level: 4 })
  return within(h.parentElement as HTMLElement)
}

const wrap = (ui: React.ReactNode) => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</MemoryRouter>)

describe('DailyBlock', () => {
  test('shows own score and rank, with link', async () => {
    rpcMock.mockResolvedValue([{ user_id: 'u2', rank: 1, score: 9 }, { user_id: 'u1', rank: 2, score: 8.5 }])
    wrap(<DailyBlock title="오늘의 데일리" />)
    const s = await ngSection()
    expect(await s.findByText('8.5점 · 2위 / 2명')).toBeInTheDocument()
    expect(rpcMock).toHaveBeenCalledWith('lb_daily', { p_day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), p_game: 'test-guess' })
    expect(s.getByRole('link', { name: '데일리' })).toHaveAttribute('href', '/play/test-guess/daily')
  })

  test('not finished yet', async () => {
    rpcMock.mockResolvedValue([])
    wrap(<DailyBlock title="오늘의 데일리" />)
    const s = await ngSection()
    expect(await s.findByText('아직 끝내지 않았어요')).toBeInTheDocument()
    expect(s.getByRole('link', { name: '데일리' })).toHaveAttribute('href', '/play/test-guess/daily')
  })

  test('error', async () => {
    rpcMock.mockRejectedValue(new Error('x'))
    wrap(<DailyBlock title="오늘의 데일리" />)
    expect(await screen.findByText('불러오지 못했어요')).toBeInTheDocument()
  })
})

describe('WeeklyBlock', () => {
  const rows = (n: number, me: number) => Array.from({ length: n }, (_, i) => ({
    rank: i + 1, user_id: i + 1 === me ? 'u1' : `x${i}`, handle: i + 1 === me ? 'kane' : `p${i + 1}`, score: 10 - i,
  }))

  test('top 5, ellipsis, then my row when rank 6 or lower', async () => {
    rpcMock.mockResolvedValue(rows(7, 7))
    wrap(<WeeklyBlock title="이번 주" />)
    const s = await ngSection()
    expect(await s.findByText('1. p1 10점')).toBeInTheDocument()
    expect(s.getByText('5. p5 6점')).toBeInTheDocument()
    expect(s.queryByText('6. p6 5점')).toBeNull()
    expect(s.getByText('…')).toBeInTheDocument()
    const mine = s.getByText('7. kane 4점')
    expect(mine).toHaveAttribute('aria-current', 'true')
    expect(mine).toHaveClass('me')
    expect(s.getByText('1. p1 10점')).not.toHaveClass('me')
    const [call] = rpcMock.mock.calls.filter((c) => c[1].p_game === 'test-guess')
    expect(call[0]).toBe('lb_range')
    expect(call[1].p_from).toBe(kstWeekStart(call[1].p_to))
  })

  test('no ellipsis when I am inside the top 5', async () => {
    rpcMock.mockResolvedValue(rows(7, 2))
    wrap(<WeeklyBlock title="이번 주" />)
    const s = await ngSection()
    const mine = await s.findByText('2. kane 9점')
    expect(mine).toHaveAttribute('aria-current', 'true')
    expect(mine).toHaveClass('me')
    expect(s.queryByText('…')).toBeNull()
  })

  test('empty', async () => {
    rpcMock.mockResolvedValue([])
    wrap(<WeeklyBlock title="이번 주" />)
    expect(await (await ngSection()).findByText('이번 주 기록이 없어요')).toBeInTheDocument()
  })

  test('error', async () => {
    rpcMock.mockRejectedValue(new Error('x'))
    wrap(<WeeklyBlock title="이번 주" />)
    expect(await screen.findByText('불러오지 못했어요')).toBeInTheDocument()
  })
})

describe('StreakBlock', () => {
  test('shows own free-play record', async () => {
    rpcMock.mockResolvedValue([
      { user_id: 'u2', handle: 'a', plays: 1, wins: 1, win_rate: 1, current_streak: 1, best_streak: 1, avg_score: 1 },
      { user_id: 'u1', handle: 'kane', plays: 12, wins: 5, win_rate: 0.4167, current_streak: 3, best_streak: 5, avg_score: 4 },
    ])
    wrap(<StreakBlock title="내 기록" />)
    const s = await ngSection()
    expect(await s.findByText('12판 · 승률 42% · 연속 3 (최고 5)')).toBeInTheDocument()
    expect(rpcMock).toHaveBeenCalledWith('lb_free', { p_game: 'test-guess' })
  })

  test('no row of mine', async () => {
    rpcMock.mockResolvedValue([])
    wrap(<StreakBlock title="내 기록" />)
    const s = await ngSection()
    expect(await s.findByText('아직 기록이 없어요')).toBeInTheDocument()
    expect(s.getByRole('link', { name: '자유 플레이' })).toHaveAttribute('href', '/play/test-guess/free')
  })

  test('error', async () => {
    rpcMock.mockRejectedValue(new Error('x'))
    wrap(<StreakBlock title="내 기록" />)
    expect(await screen.findByText('불러오지 못했어요')).toBeInTheDocument()
  })
})

describe('visibility', () => {
  test('hidden game is shown to admins only', async () => {
    rpcMock.mockResolvedValue([])
    admin = false
    const r = wrap(<DailyBlock title="오늘의 데일리" />)
    expect(await screen.findByRole('heading', { name: '후알야', level: 4 })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '테스트 숫자 맞히기' })).toBeNull()
    r.unmount()
    admin = true
    wrap(<DailyBlock title="오늘의 데일리" />)
    expect(await screen.findByRole('heading', { name: '테스트 숫자 맞히기', level: 4 })).toBeInTheDocument()
  })

  test.each([
    ['데일리', DailyBlock, '열린 데일리 게임이 없어요'],
    ['주간', WeeklyBlock, '열린 데일리 게임이 없어요'],
    ['기록', StreakBlock, '열린 자유 플레이 게임이 없어요'],
  ] as const)('%s: no visible games shows empty copy without rpc', async (_n, Block, copy) => {
    admin = false
    onlyTest = true
    wrap(<Block title="블록" />)
    expect(await screen.findByText(copy)).toBeInTheDocument()
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

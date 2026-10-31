import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
let admin = false
vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: admin } }),
}))
vi.mock('../../games/index.ts', () => ({
  games: [
    { manifest: { id: 'test-guess', name: '숫자 맞추기', hidden: false } },
    { manifest: { id: 'secret', name: '비밀 게임', hidden: true } },
  ],
}))

import { kstDate, kstWeekStart } from '../../shared/kst.ts'
import { LeaderboardPage } from './LeaderboardPage.tsx'

const today = () => kstDate(Date.now())
const row = (rank: number, user_id: string, handle: string, score = 10) => ({
  rank, user_id, handle, score, action_count: 3, finished_at: null,
})
const free = (user_id: string, handle: string, plays: number, wins: number, rate: number, cur = 1, best: number | null = 2) => ({
  user_id, handle, plays, wins, win_rate: rate, current_streak: cur, best_streak: best, avg_score: 5,
})

function setup(over: Record<string, unknown> = {}) {
  rpcMock.mockImplementation(async (name: string) => {
    if (name in over) return over[name]
    if (name === 'lb_contests') return { contests: [], totals: [] }
    return []
  })
}
const renderPage = () => render(<MemoryRouter><LeaderboardPage /></MemoryRouter>)
const tab = (n: string) => fireEvent.click(screen.getByRole('tab', { name: n }))

beforeEach(() => { rpcMock.mockReset(); admin = false })

test('tabs_call_right_rpc', async () => {
  setup()
  renderPage()
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('lb_daily', { p_day: today(), p_game: null }))
  tab('주간')
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('lb_range', { p_from: kstWeekStart(today()), p_to: today(), p_game: null }))
  tab('전체')
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('lb_range', { p_from: '2000-01-01', p_to: today(), p_game: null }))
  tab('대회')
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('lb_contests', { p_from: '2000-01-01', p_to: today() }))
  tab('자유 플레이')
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('lb_free', { p_game: null }))
})

test('game_filter_passes_game_id', async () => {
  setup()
  renderPage()
  await screen.findByText('아직 기록이 없어요')
  fireEvent.change(screen.getByLabelText('게임'), { target: { value: 'test-guess' } })
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('lb_daily', { p_day: today(), p_game: 'test-guess' }))
  expect(screen.queryByRole('option', { name: '비밀 게임' })).toBeNull()
})

test('hidden_game_selectable_for_admin', async () => {
  admin = true
  setup()
  renderPage()
  expect(await screen.findByRole('option', { name: '비밀 게임' })).toBeTruthy()
})

test('free_tab_sort_toggle', async () => {
  setup({
    lb_free: [free('a', 'alpha', 10, 3, 0.3), free('b', 'beta', 2, 2, 1), free('c', 'gamma', 20, 5, 0.25)],
  })
  renderPage()
  tab('자유 플레이')
  await screen.findByText('alpha')
  const order = () => screen.getAllByRole('link').map((a) => a.textContent)
  expect(order()).toEqual(['gamma', 'alpha', 'beta']) // 정답 수 기본
  fireEvent.click(screen.getByRole('button', { name: '정답률' }))
  expect(order()).toEqual(['beta', 'alpha', 'gamma'])
  fireEvent.click(screen.getByRole('button', { name: '플레이 수' }))
  expect(order()).toEqual(['gamma', 'alpha', 'beta'])
  expect(screen.getByText('100%')).toBeTruthy()
})

test('streak_hidden_in_total_view', async () => {
  setup({ lb_free: [free('a', 'alpha', 10, 3, 0.3, 1, null)] })
  renderPage()
  tab('자유 플레이')
  await screen.findByText('alpha')
  expect(screen.queryByText('연속')).toBeNull()
  expect(screen.queryByText('최고 연속')).toBeNull()
  setup({ lb_free: [free('a', 'alpha', 10, 3, 0.3, 1, 4)] })
  fireEvent.change(screen.getByLabelText('게임'), { target: { value: 'test-guess' } })
  await screen.findByText('최고 연속')
  expect(screen.getByText('연속')).toBeTruthy()
})

test('my_row_highlighted', async () => {
  setup({ lb_daily: [row(1, 'u9', 'messi'), row(2, 'u1', 'kane')] })
  renderPage()
  const me = (await screen.findByText('kane')).closest('tr')!
  expect(me.className).toContain('me')
  expect(screen.getByText('messi').closest('tr')!.className).not.toContain('me')
  expect(within(me).getByRole('link', { name: 'kane' }).getAttribute('href')).toBe('/u/kane')
})

test('contests_tab_shows_podium_and_totals', async () => {
  setup({
    lb_contests: {
      contests: [{ contest_id: 'c1', title: '개막 대회', ends_at: '2026-10-01T00:00:00Z', podium: [{ handle: 'messi', score: 20 }] }],
      totals: [{ user_id: 'u1', handle: 'kane', total: 33 }],
    },
  })
  renderPage()
  tab('대회')
  expect(await screen.findByText('개막 대회')).toBeTruthy()
  expect(screen.getByText('messi')).toBeTruthy()
  expect(screen.getByText('kane').closest('tr')!.className).toContain('me')
  expect(screen.queryByLabelText('게임')).toBeNull()
})

test('error_shows_retry', async () => {
  rpcMock.mockRejectedValueOnce(new Error('x'))
  setup()
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: '다시 시도' }))
  await screen.findByText('아직 기록이 없어요')
})

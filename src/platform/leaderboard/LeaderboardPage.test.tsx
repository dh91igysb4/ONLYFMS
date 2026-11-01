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
vi.mock('../../games/index.ts', () => {
  const games = [
    { manifest: { id: 'test-guess', name: '숫자 맞추기', hidden: false } },
    { manifest: { id: 'secret', name: '비밀 게임', hidden: true } },
    { manifest: { id: 'who-are-ya', name: '후알야', hidden: false } },
    { manifest: { id: 'toothbrush', name: '양치', hidden: true, freeDefaultSort: 'best' } },
  ]
  return {
    games,
    getGame: (id: string) => games.find((g) => g.manifest.id === id),
    duels: [
      { manifest: { id: 'yacht', name: '요트 다이스', hidden: false } },
      { manifest: { id: 'secret-duel', name: '비밀 대전', hidden: true } },
    ],
  }
})

import { kstDate, kstWeekStart } from '../../shared/kst.ts'
import { LeaderboardPage } from './LeaderboardPage.tsx'

const today = () => kstDate(Date.now())
const row = (rank: number, user_id: string, handle: string, score = 10) => ({
  rank, user_id, handle, score, action_count: 3, finished_at: null,
})
const free = (user_id: string, handle: string, plays: number, wins: number, rate: number, cur = 1, best: number | null = 2, best_score = 0) => ({
  user_id, handle, plays, wins, win_rate: rate, current_streak: cur, best_streak: best, avg_score: 5, best_score,
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
  const sort = screen.getByLabelText('정렬') as HTMLSelectElement
  expect(sort.value).toBe('wins')
  fireEvent.change(sort, { target: { value: 'rate' } })
  expect(order()).toEqual(['beta', 'alpha', 'gamma'])
  fireEvent.change(sort, { target: { value: 'plays' } })
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

test('toothbrush_defaults_to_best_sort', async () => {
  admin = true
  setup({ lb_free: [free('a', 'alpha', 10, 9, 0.9, 1, 2, 5), free('b', 'beta', 3, 1, 0.3, 1, 2, 9.5), free('c', 'gamma', 5, 3, 0.6, 1, 2, 7)] })
  renderPage()
  tab('자유 플레이')
  await screen.findByText('alpha')
  fireEvent.change(screen.getByLabelText('게임'), { target: { value: 'toothbrush' } })
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('lb_free', { p_game: 'toothbrush' }))
  expect((screen.getByLabelText('정렬') as HTMLSelectElement).value).toBe('best')
  await waitFor(() => expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['beta', 'gamma', 'alpha']))
  expect(screen.getByRole('columnheader', { name: '최고' }).getAttribute('aria-sort')).toBe('descending')
})

test('who_are_ya_keeps_wins_sort', async () => {
  setup({ lb_free: [free('a', 'alpha', 10, 3, 0.3, 1, 2, 5)] })
  renderPage()
  tab('자유 플레이')
  await screen.findByText('alpha')
  fireEvent.change(screen.getByLabelText('게임'), { target: { value: 'who-are-ya' } })
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('lb_free', { p_game: 'who-are-ya' }))
  expect((screen.getByLabelText('정렬') as HTMLSelectElement).value).toBe('wins')
  const best = await screen.findByRole('columnheader', { name: '최고' })
  expect(best.getAttribute('aria-sort')).toBeNull()
  expect(screen.getByRole('columnheader', { name: '정답' }).getAttribute('aria-sort')).toBe('descending')
})

test('best_hidden_in_total_view', async () => {
  admin = true
  setup({ lb_free: [free('a', 'alpha', 10, 3, 0.3, 1, null, 5)] })
  renderPage()
  tab('자유 플레이')
  await screen.findByText('alpha')
  expect(screen.queryByRole('columnheader', { name: '최고' })).toBeNull()
  expect(screen.queryByRole('option', { name: '최고 점수' })).toBeNull()
  fireEvent.change(screen.getByLabelText('게임'), { target: { value: 'toothbrush' } })
  await screen.findByRole('columnheader', { name: '최고' })
  expect(screen.getByRole('option', { name: '최고 점수' })).toBeTruthy()
  expect((screen.getByLabelText('정렬') as HTMLSelectElement).value).toBe('best')
  fireEvent.change(screen.getByLabelText('게임'), { target: { value: '' } })
  await waitFor(() => expect(screen.queryByRole('columnheader', { name: '최고' })).toBeNull())
  expect((screen.getByLabelText('정렬') as HTMLSelectElement).value).toBe('wins')
  expect(screen.queryByRole('option', { name: '최고 점수' })).toBeNull()
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

test('top_three_rows_marked', async () => {
  setup({ lb_daily: [row(1, 'a', 'one'), row(2, 'b', 'two'), row(3, 'c', 'three'), row(4, 'd', 'four')] })
  renderPage()
  const tr = async (h: string) => (await screen.findByText(h)).closest('tr')!
  for (const h of ['one', 'two', 'three']) expect((await tr(h)).className).toContain('top')
  expect((await tr('four')).className).not.toContain('top')
})

test('key_column_marked_with_aria_sort', async () => {
  setup({ lb_daily: [row(1, 'u9', 'messi')], lb_free: [free('a', 'alpha', 10, 3, 0.3)] })
  renderPage()
  expect((await screen.findByRole('columnheader', { name: '점수' })).getAttribute('aria-sort')).toBe('descending')
  tab('자유 플레이')
  await screen.findByText('alpha')
  expect(screen.getByRole('columnheader', { name: '정답' }).getAttribute('aria-sort')).toBe('descending')
  fireEvent.change(screen.getByLabelText('정렬'), { target: { value: 'rate' } })
  expect(screen.getByRole('columnheader', { name: '정답률' }).getAttribute('aria-sort')).toBe('descending')
  expect(screen.getByRole('columnheader', { name: '정답' }).getAttribute('aria-sort')).toBeNull()
})

test('sort_only_on_free_tab_and_period_is_tablist', async () => {
  setup()
  renderPage()
  await screen.findByText('아직 기록이 없어요')
  expect(screen.getByRole('tablist', { name: '기간' })).toBeTruthy()
  expect(screen.getByRole('tab', { name: '오늘' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.queryByLabelText('정렬')).toBeNull()
})

test('contest_podium_is_table_with_top_rows', async () => {
  setup({
    lb_contests: {
      contests: [{ contest_id: 'c1', title: '개막 대회', ends_at: '2026-10-01T00:00:00Z', podium: [{ handle: 'messi', score: 20 }, { handle: 'son', score: 15 }] }],
      totals: [],
    },
  })
  renderPage()
  tab('대회')
  const messi = (await screen.findByText('messi')).closest('tr')!
  expect(messi.className).toContain('top')
  expect(within(messi).getByText('20')).toBeTruthy()
  expect(screen.getByText('son').closest('tr')!.className).toContain('top')
})

const duelRow = (handle: string, rating: number, rated_games: number, wins: number, draws: number, losses: number, placed: boolean) => ({
  handle, rating, rated_games, wins, draws, losses, placed,
})

test('leaderboard_duel_tab', async () => {
  setup({
    lb_duel: [
      duelRow('messi', 1120, 10, 7, 1, 2, true),
      duelRow('kane', 1050, 6, 3, 0, 3, true),
      duelRow('newbie', 1010, 2, 1, 0, 1, false),
    ],
  })
  renderPage()
  tab('대전')
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('lb_duel', { p_game: 'yacht' }))
  const messi = (await screen.findByText('messi')).closest('tr')!
  expect(within(messi).getByText('1')).toBeTruthy()
  expect(within(messi).getByText('1120')).toBeTruthy()
  expect(within(messi).getByText('70%')).toBeTruthy()
  // 다른 탭과 같은 표: 1~3위 막대, 레이팅이 정렬 기준
  expect(messi.className).toContain('top')
  expect(screen.getByRole('columnheader', { name: '레이팅' }).getAttribute('aria-sort')).toBe('descending')
  const kane = screen.getByText('kane').closest('tr')!
  expect(within(kane).getByText('2')).toBeTruthy()
  expect(within(kane).getByText('50%')).toBeTruthy()
  expect(kane.className).toContain('me')
  // 배치 중은 순위표 밖
  const newbie = screen.getByText('newbie')
  expect(newbie.closest('tr')).toBeNull()
  expect(screen.getByText('배치 중')).toBeTruthy()
  // 숨김 대전 게임은 비관리자 선택지에 없음
  expect(screen.getByRole('option', { name: '요트 다이스' })).toBeTruthy()
  expect(screen.queryByRole('option', { name: '비밀 대전' })).toBeNull()
})

test('leaderboard_duel_hidden_game_for_admin', async () => {
  admin = true
  setup({ lb_duel: [] })
  renderPage()
  tab('대전')
  expect(await screen.findByRole('option', { name: '비밀 대전' })).toBeTruthy()
  fireEvent.change(screen.getByLabelText('게임'), { target: { value: 'secret-duel' } })
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('lb_duel', { p_game: 'secret-duel' }))
  expect(await screen.findByText('아직 기록이 없어요')).toBeTruthy()
})

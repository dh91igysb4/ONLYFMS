import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))
const auth = vi.hoisted(() => ({ handle: 'kane' }))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: auth.handle, status: 'approved', is_admin: false }, refresh: async () => {} }),
}))
vi.mock('../../games/index.ts', () => ({
  games: [{ manifest: { id: 'test-guess', name: '숫자 맞추기', hidden: false } }],
  duels: [{ manifest: { id: 'yacht', name: '요트 다이스', hidden: false } }],
}))

import { ProfilePage } from './ProfilePage.tsx'

const renderAt = (h: string) => render(
  <MemoryRouter initialEntries={[`/u/${h}`]}>
    <Routes><Route path="/u/:handle" element={<ProfilePage />} /></Routes>
  </MemoryRouter>,
)

beforeEach(() => { rpcMock.mockReset(); auth.handle = 'kane' })

function setup(over: Record<string, unknown>) {
  rpcMock.mockImplementation(async (name: string) => (name in over ? over[name] : name === 'duel_stats' ? [] : null))
}
const emptyStats = { daily_by_game: [], contests: [], free_by_game: [], recent: [] }
const wdl = (w: number, d: number, l: number) => ({ w, d, l, rate: w + d + l === 0 ? null : w / (w + d + l) })
const duelStat = {
  game_id: 'yacht',
  rating: 1075,
  rated: wdl(3, 1, 1),
  all: wdl(5, 1, 4),
  recent: [
    { id: 'm1', opponent_handle: 'messi', result: 'win', rated: true, ended_at: '2026-10-31T10:00:00Z', my_score: 250, opp_score: 200 },
    { id: 'm2', opponent_handle: 'ronaldo', result: 'loss', rated: false, ended_at: '2026-10-30T10:00:00Z', my_score: 100, opp_score: 180 },
    { id: 'm3', opponent_handle: null, result: 'draw', rated: true, ended_at: '2026-10-29T10:00:00Z', my_score: 1, opp_score: 1 },
  ],
}

test('profile_not_found_message', async () => {
  rpcMock.mockResolvedValue(null)
  renderAt('nobody')
  expect(await screen.findByText('없는 사용자예요')).toBeTruthy()
  expect(rpcMock).toHaveBeenCalledWith('user_stats', { p_handle: 'nobody' })
})

test('profile_renders_sections', async () => {
  setup({ user_stats: {
    daily_by_game: [{ game_id: 'test-guess', days: 5, avg_score: 7.5 }],
    contests: [{ contest_id: 'c1', title: '개막 대회', kind: 'official', ends_at: '2026-10-01T00:00:00Z', rank: 2, score: 18 }],
    free_by_game: [{ game_id: 'old-game', plays: 4, wins: 2, win_rate: 0.5, best_streak: 2 }],
    recent: [{ type: 'free', game_id: 'test-guess', score: 9, at: '2026-10-30T10:00:00Z' }],
  } })
  renderAt('kane')
  expect(await screen.findByText('개막 대회')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'kane' })).toBeTruthy()
  expect(screen.getByText('공식')).toBeTruthy()
  expect(screen.getByRole('link', { name: '개막 대회' }).getAttribute('href')).toBe('/contests/c1')
  expect(screen.getByText('old-game')).toBeTruthy()
  expect(screen.getByText('50%')).toBeTruthy()
  expect(screen.getByText('숫자 맞추기', { selector: 'td' })).toBeTruthy()
  expect(screen.getByText(/숫자 맞추기 · 9점/)).toBeTruthy()
})

test('profile_duel_stats_toggle', async () => {
  setup({
    user_stats: emptyStats,
    duel_stats: [
      duelStat,
      { game_id: 'chess', rating: 1000, rated: wdl(0, 0, 0), all: wdl(0, 0, 0), recent: [] },
    ],
  })
  renderAt('kane')
  const rated = await screen.findByText('1075')
  expect(rpcMock).toHaveBeenCalledWith('duel_stats', { p_handle: 'kane', p_game: null })
  const card = rated.closest('section')!
  expect(within(card).getByText('요트 다이스')).toBeTruthy()
  // 랭크만 (기본): 3승 1무 1패 = 60%
  expect(within(card).getByText('3승 1무 1패')).toBeTruthy()
  expect(within(card).getByText('60%')).toBeTruthy()
  expect(screen.getAllByText('–').length).toBeGreaterThan(0) // 0판 게임
  fireEvent.click(screen.getByRole('button', { name: '전체' }))
  expect(within(card).getByText('5승 1무 4패')).toBeTruthy()
  expect(within(card).getByText('50%')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '랭크만' }))
  expect(within(card).getByText('3승 1무 1패')).toBeTruthy()
})

test('profile_duel_recent_filters_by_toggle', async () => {
  setup({ user_stats: emptyStats, duel_stats: [duelStat] })
  renderAt('kane')
  await screen.findByText('1075')
  const recent = () => screen.getByRole('list', { name: '최근 대국' })
  expect(within(recent()).getAllByRole('listitem')).toHaveLength(2) // m1, m3 (랭크)
  fireEvent.click(screen.getByRole('button', { name: '전체' }))
  expect(within(recent()).getAllByRole('listitem')).toHaveLength(3)
})

test('profile_duel_resign_without_scores_hides_colon', async () => {
  setup({
    user_stats: emptyStats,
    duel_stats: [{ ...duelStat, recent: [{ id: 'r1', opponent_handle: 'messi', result: 'win', rated: true, ended_at: '2026-10-31T10:00:00Z', my_score: null, opp_score: null }] }],
  })
  renderAt('kane')
  await screen.findByText('1075')
  const row = within(screen.getByRole('list', { name: '최근 대국' })).getByRole('listitem')
  expect(row.textContent).toContain('vs messi')
  expect(row.textContent).not.toContain(' : ')
})

test('profile_h2h_default_me_vs_them', async () => {
  setup({
    user_stats: emptyStats,
    duel_stats: [duelStat],
    duel_h2h: {
      games: [{ game_id: 'yacht', a_wins: 2, draws: 1, b_wins: 4 }],
      recent: [{ id: 'h1', game_id: 'yacht', result: 'win', rated: true, ended_at: '2026-10-31T10:00:00Z', a_score: 300, b_score: 280 }],
    },
  })
  renderAt('messi')
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('duel_h2h', { p_handle_a: 'kane', p_handle_b: 'messi', p_game: null }))
  expect(await screen.findByText(/2승 1무 4패/)).toBeTruthy()
  expect(screen.getByText(/300 : 280/)).toBeTruthy()
})

test('profile_own_h2h_defaults_to_first_opponent', async () => {
  setup({
    user_stats: emptyStats,
    duel_stats: [duelStat],
    duel_h2h: { games: [], recent: [] },
  })
  renderAt('kane')
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('duel_h2h', { p_handle_a: 'kane', p_handle_b: 'messi', p_game: null }))
  fireEvent.change(screen.getByLabelText('상대'), { target: { value: 'ronaldo' } })
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('duel_h2h', { p_handle_a: 'kane', p_handle_b: 'ronaldo', p_game: null }))
})

test('profile_own_without_duels_shows_empty', async () => {
  setup({ user_stats: emptyStats, duel_stats: [] })
  renderAt('kane')
  expect(await screen.findByText('아직 대전 기록이 없어요')).toBeTruthy()
  expect(rpcMock).not.toHaveBeenCalledWith('duel_h2h', expect.anything() as never)
})

test('settings_only_on_own_profile', async () => {
  setup({ user_stats: emptyStats })
  const own = renderAt('kane')
  expect(await own.findByRole('heading', { name: '화면 설정' })).toBeTruthy()
  own.unmount()
  const other = renderAt('other')
  await other.findByRole('heading', { name: 'other' })
  expect(other.queryByRole('heading', { name: '화면 설정' })).toBeNull()
})

test('settings_on_own_profile_case_insensitive', async () => {
  setup({ user_stats: emptyStats })
  renderAt('Kane')
  expect(await screen.findByRole('heading', { name: '화면 설정' })).toBeTruthy()
})

test('hangul_handle_in_url', async () => {
  rpcMock.mockResolvedValue(null)
  renderAt('손흥민')
  await screen.findByText('없는 사용자예요')
  expect(rpcMock).toHaveBeenCalledWith('user_stats', { p_handle: '손흥민' })
  rpcMock.mockReset()
  rpcMock.mockResolvedValue(null)
  renderAt(encodeURIComponent('손흥민'))
  await screen.findAllByText('없는 사용자예요')
  expect(rpcMock).toHaveBeenCalledWith('user_stats', { p_handle: '손흥민' })
})

test('profile_own_hangul_handle_nfd_url_is_mine', async () => {
  auth.handle = '손흥민'
  setup({ user_stats: emptyStats, duel_stats: [duelStat], duel_h2h: { games: [], recent: [] } })
  renderAt(encodeURIComponent('손흥민'.normalize('NFD')))
  // 내 프로필로 판별 → 기본 상대는 첫 상대(messi)
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('duel_h2h', { p_handle_a: '손흥민', p_handle_b: 'messi', p_game: null }))
})

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
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

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}
const renderAt = (h: string, search = '') => render(
  <MemoryRouter initialEntries={[`/u/${h}${search}`]}>
    <Routes><Route path="/u/:handle" element={<ProfilePage />} /></Routes>
    <Where />
  </MemoryRouter>,
)
const where = () => screen.getByTestId('where').textContent

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
  renderAt('kane', '?tab=puzzle')
  expect(await screen.findByText('개막 대회')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'kane' })).toBeTruthy()
  expect(screen.getByText('공식')).toBeTruthy()
  expect(screen.getByRole('link', { name: '개막 대회' }).getAttribute('href')).toBe('/contests/c1')
  expect(screen.getByText('old-game')).toBeTruthy()
  expect(screen.getByText('50%')).toBeTruthy()
  expect(screen.getByText('숫자 맞추기', { selector: 'td' })).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: '요약' }))
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
  renderAt('kane', '?tab=duel')
  const rated = await within(await screen.findByRole('tabpanel')).findByText('1075')
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
  renderAt('kane', '?tab=duel')
  await within(await screen.findByRole('tabpanel')).findByText('1075')
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
  renderAt('kane', '?tab=duel')
  await within(await screen.findByRole('tabpanel')).findByText('1075')
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
  renderAt('messi', '?tab=duel')
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('duel_h2h', { p_handle_a: 'kane', p_handle_b: 'messi', p_game: null }))
  expect(await screen.findByText(/요트 다이스 · 2승 1무 4패/)).toBeTruthy()
  expect(screen.getByText(/300 : 280/)).toBeTruthy()
})

test('profile_own_h2h_defaults_to_first_opponent', async () => {
  setup({
    user_stats: emptyStats,
    duel_stats: [duelStat],
    duel_h2h: { games: [], recent: [] },
  })
  renderAt('kane', '?tab=duel')
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('duel_h2h', { p_handle_a: 'kane', p_handle_b: 'messi', p_game: null }))
  fireEvent.change(screen.getByLabelText('상대'), { target: { value: 'ronaldo' } })
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('duel_h2h', { p_handle_a: 'kane', p_handle_b: 'ronaldo', p_game: null }))
})

test('profile_own_without_duels_shows_empty', async () => {
  setup({ user_stats: emptyStats, duel_stats: [] })
  renderAt('kane', '?tab=duel')
  expect(await screen.findByText('아직 대전 기록이 없어요')).toBeTruthy()
  expect(rpcMock).not.toHaveBeenCalledWith('duel_h2h', expect.anything() as never)
})

test('settings_only_on_own_profile', async () => {
  setup({ user_stats: emptyStats })
  const own = renderAt('kane', '?tab=settings')
  expect(await own.findByRole('heading', { name: '화면 설정' })).toBeTruthy()
  expect(own.getByRole('tab', { name: '설정' }).getAttribute('aria-selected')).toBe('true')
  own.unmount()
  const other = renderAt('other', '?tab=settings')
  await other.findByRole('heading', { name: 'other' })
  expect(other.queryByRole('tab', { name: '설정' })).toBeNull()
  expect(other.queryByRole('heading', { name: '화면 설정' })).toBeNull()
  // 없는 탭이면 요약으로
  expect(other.getByRole('tab', { name: '요약' }).getAttribute('aria-selected')).toBe('true')
})

test('settings_on_own_profile_case_insensitive', async () => {
  setup({ user_stats: emptyStats })
  renderAt('Kane', '?tab=settings')
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
  renderAt(encodeURIComponent('손흥민'.normalize('NFD')), '?tab=duel')
  // 내 프로필로 판별 → 기본 상대는 첫 상대(messi)
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('duel_h2h', { p_handle_a: '손흥민', p_handle_b: 'messi', p_game: null }))
})


test('profile_tabs_default_summary_and_switch_updates_query', async () => {
  setup({ user_stats: emptyStats })
  renderAt('kane')
  const tablist = await screen.findByRole('tablist', { name: '프로필 보기' })
  expect(within(tablist).getAllByRole('tab').map((t) => t.textContent)).toEqual(['요약', '퍼즐', '대전', '설정'])
  expect(screen.getByRole('tab', { name: '요약' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { name: '요약' }).id)
  fireEvent.click(screen.getByRole('tab', { name: '퍼즐' }))
  expect(where()).toBe('/u/kane?tab=puzzle')
  expect(screen.getByRole('tab', { name: '퍼즐' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByText('참가한 대회가 없어요')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: '대전' }))
  expect(where()).toBe('/u/kane?tab=duel')
  fireEvent.click(screen.getByRole('tab', { name: '요약' }))
  expect(where()).toBe('/u/kane?tab=summary')
})

test('profile_tabs_arrow_keys', async () => {
  setup({ user_stats: emptyStats })
  renderAt('kane')
  const summary = await screen.findByRole('tab', { name: '요약' })
  fireEvent.keyDown(summary, { key: 'ArrowRight' })
  expect(where()).toBe('/u/kane?tab=puzzle')
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: '퍼즐' }))
  fireEvent.keyDown(screen.getByRole('tab', { name: '퍼즐' }), { key: 'ArrowLeft' })
  fireEvent.keyDown(screen.getByRole('tab', { name: '요약' }), { key: 'ArrowLeft' })
  expect(where()).toBe('/u/kane?tab=settings')
})

test('profile_tab_survives_reload', async () => {
  setup({ user_stats: emptyStats, duel_stats: [duelStat] })
  renderAt('kane', '?tab=duel')
  expect(await screen.findByRole('tab', { name: '대전' })).toBeTruthy()
  expect(screen.getByRole('tab', { name: '대전' }).getAttribute('aria-selected')).toBe('true')
  expect(await screen.findByRole('list', { name: '최근 대국' })).toBeTruthy()
})

test('profile_unknown_tab_falls_back_to_summary', async () => {
  setup({ user_stats: emptyStats })
  renderAt('kane', '?tab=zzz')
  expect((await screen.findByRole('tab', { name: '요약' })).getAttribute('aria-selected')).toBe('true')
})

test('profile_header_card_chips', async () => {
  setup({
    user_stats: {
      daily_by_game: [{ game_id: 'test-guess', days: 5, avg_score: 7.5 }, { game_id: 'b', days: 2, avg_score: 3 }],
      contests: [
        { contest_id: 'c1', title: '개막 대회', kind: 'official', ends_at: '2026-10-01T00:00:00Z', rank: 2, score: 18 },
        { contest_id: 'c2', title: '친선', kind: 'friendly', ends_at: '2026-10-02T00:00:00Z', rank: 1, score: 3 },
      ],
      free_by_game: [{ game_id: 'test-guess', plays: 4, wins: 2, win_rate: 0.5, best_streak: 2 }, { game_id: 'b', plays: 6, wins: 1, win_rate: 0.16, best_streak: 1 }],
      recent: [],
    },
    duel_stats: [duelStat, { game_id: 'chess', rating: 1200, rated: wdl(0, 0, 0), all: wdl(0, 0, 0), recent: [] }],
  })
  renderAt('kane')
  const card = (await screen.findByRole('heading', { name: 'kane' })).closest('section')!
  const chips = within(card).getByRole('list', { name: '요약 기록' })
  const chip = (label: string) => within(chips).getByText(label).closest('li')!.textContent
  expect(chip('데일리 참여')).toContain('7')
  expect(chip('자유 플레이')).toContain('10')
  await waitFor(() => expect(chip('대전 최고 레이팅')).toContain('1075')) // 대국 없는 게임(1200)은 빼고
  expect(chip('공식 대회')).toContain('1')
})

test('profile_header_duel_rating_dash_without_games', async () => {
  setup({ user_stats: emptyStats, duel_stats: [] })
  renderAt('kane')
  const chips = await screen.findByRole('list', { name: '요약 기록' })
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('duel_stats', { p_handle: 'kane', p_game: null }))
  expect(within(chips).getByText('대전 최고 레이팅').closest('li')!.textContent).toContain('–')
})

test('profile_h2h_line_on_others_profile_switches_to_duel_tab', async () => {
  setup({
    user_stats: emptyStats,
    duel_stats: [duelStat],
    duel_h2h: {
      games: [{ game_id: 'yacht', a_wins: 2, draws: 1, b_wins: 4 }, { game_id: 'chess', a_wins: 1, draws: 0, b_wins: 0 }],
      recent: [],
    },
  })
  renderAt('messi')
  const line = await screen.findByRole('button', { name: '나와의 대전 전적 3승 1무 4패' })
  fireEvent.click(line)
  expect(where()).toBe('/u/messi?tab=duel')
  expect(screen.getByRole('tab', { name: '대전' }).getAttribute('aria-selected')).toBe('true')
})

test('profile_h2h_line_hidden_without_matches_and_on_own', async () => {
  setup({ user_stats: emptyStats, duel_stats: [duelStat], duel_h2h: { games: [], recent: [] } })
  const other = renderAt('messi')
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('duel_h2h', { p_handle_a: 'kane', p_handle_b: 'messi', p_game: null }))
  await other.findByRole('heading', { name: 'messi' })
  expect(other.queryByText(/나와의 대전 전적/)).toBeNull()
  other.unmount()
  rpcMock.mockClear()
  renderAt('kane')
  await screen.findByRole('heading', { name: 'kane' })
  expect(screen.queryByText(/나와의 대전 전적/)).toBeNull()
  expect(rpcMock).not.toHaveBeenCalledWith('duel_h2h', expect.anything() as never)
})

test('profile_summary_merges_recent_newest_first', async () => {
  setup({
    user_stats: {
      ...emptyStats,
      recent: [
        { type: 'daily', game_id: 'test-guess', score: 7, at: '2026-10-31T12:00:00Z' },
        { type: 'contest', game_id: 'test-guess', score: 3, at: '2026-10-29T12:00:00Z' },
      ],
    },
    duel_stats: [duelStat],
  })
  renderAt('kane')
  const list = await screen.findByRole('list', { name: '최근 기록' })
  await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(5))
  const rows = within(list).getAllByRole('listitem').map((li) => li.textContent ?? '')
  expect(rows[0]).toContain('데일리')         // 10-31 12:00
  expect(rows[1]).toContain('vs messi')       // 10-31 10:00
  expect(rows[2]).toContain('vs ronaldo')     // 10-30
  expect(rows[2]).toContain('친선')
  expect(rows[3]).toContain('대회')           // 10-29 12:00
  expect(rows[4]).toContain('vs 알 수 없음')  // 10-29 10:00
})

test('profile_summary_caps_at_ten', async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ type: 'free', game_id: 'test-guess', score: i, at: `2026-10-${String(10 + i).padStart(2, '0')}T00:00:00Z` }))
  setup({ user_stats: { ...emptyStats, recent: many } })
  renderAt('kane')
  const list = await screen.findByRole('list', { name: '최근 기록' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(10)
  expect(within(list).getAllByRole('listitem')[0].textContent).toContain('11점')
})

test('profile_error_retry', async () => {
  rpcMock.mockImplementation(async (name: string) => {
    if (name === 'user_stats') throw new Error('boom')
    return []
  })
  renderAt('kane')
  expect(await screen.findByRole('alert')).toBeTruthy()
  setup({ user_stats: emptyStats })
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByRole('heading', { name: 'kane' })).toBeTruthy()
})

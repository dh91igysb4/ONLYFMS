import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))
vi.mock('../../games/index.ts', () => ({
  games: [{ manifest: { id: 'test-guess', name: '숫자 맞추기', hidden: false } }],
}))

let authProfile: { handle: string } | null = null
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: authProfile, refresh: async () => {} }),
}))

import { ProfilePage } from './ProfilePage.tsx'

const renderAt = (h: string) => render(
  <MemoryRouter initialEntries={[`/u/${h}`]}>
    <Routes><Route path="/u/:handle" element={<ProfilePage />} /></Routes>
  </MemoryRouter>,
)

beforeEach(() => { rpcMock.mockReset(); authProfile = null })

test('profile_not_found_message', async () => {
  rpcMock.mockResolvedValue(null)
  renderAt('nobody')
  expect(await screen.findByText('없는 사용자예요')).toBeTruthy()
  expect(rpcMock).toHaveBeenCalledWith('user_stats', { p_handle: 'nobody' })
})

test('profile_renders_sections', async () => {
  rpcMock.mockResolvedValue({
    daily_by_game: [{ game_id: 'test-guess', days: 5, avg_score: 7.5 }],
    contests: [{ contest_id: 'c1', title: '개막 대회', kind: 'official', ends_at: '2026-10-01T00:00:00Z', rank: 2, score: 18 }],
    free_by_game: [{ game_id: 'old-game', plays: 4, wins: 2, win_rate: 0.5, best_streak: 2 }],
    recent: [{ type: 'free', game_id: 'test-guess', score: 9, at: '2026-10-30T10:00:00Z' }],
  })
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

test('settings_only_on_own_profile', async () => {
  authProfile = { handle: 'kane' }
  rpcMock.mockResolvedValue({ daily_by_game: [], contests: [], free_by_game: [], recent: [] })
  const own = renderAt('kane')
  expect(await own.findByRole('heading', { name: '화면 설정' })).toBeTruthy()
  own.unmount()
  const other = renderAt('other')
  await other.findByRole('heading', { name: 'other' })
  expect(other.queryByRole('heading', { name: '화면 설정' })).toBeNull()
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

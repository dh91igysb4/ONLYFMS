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
  games: [{ manifest: { id: 'number-guess', name: '숫자 맞추기', hidden: false } }],
}))

import { ProfilePage } from './ProfilePage.tsx'

const renderAt = (h: string) => render(
  <MemoryRouter initialEntries={[`/u/${h}`]}>
    <Routes><Route path="/u/:handle" element={<ProfilePage />} /></Routes>
  </MemoryRouter>,
)

beforeEach(() => rpcMock.mockReset())

test('profile_not_found_message', async () => {
  rpcMock.mockResolvedValue(null)
  renderAt('nobody')
  expect(await screen.findByText('없는 사용자예요')).toBeTruthy()
  expect(rpcMock).toHaveBeenCalledWith('user_stats', { p_handle: 'nobody' })
})

test('profile_renders_sections', async () => {
  rpcMock.mockResolvedValue({
    daily_by_game: [{ game_id: 'number-guess', days: 5, avg_score: 7.5 }],
    contests: [{ contest_id: 'c1', title: '개막 대회', kind: 'official', ends_at: '2026-10-01T00:00:00Z', rank: 2, score: 18 }],
    free_by_game: [{ game_id: 'old-game', plays: 4, wins: 2, win_rate: 0.5, best_streak: 2 }],
    recent: [{ type: 'free', game_id: 'number-guess', score: 9, at: '2026-10-30T10:00:00Z' }],
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

import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
const playMock = vi.fn()
let admin = true
vi.mock('../../lib/supabase.ts', () => ({ supabase: { from: () => ({ upsert: async () => ({ error: null }) }) }, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
  play: (...a: unknown[]) => playMock(...a),
}))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: admin } }),
}))

import { HomePage } from './HomePage.tsx'
import { DailyPage } from './DailyPage.tsx'

beforeEach(() => { rpcMock.mockReset(); playMock.mockReset(); admin = true })

test('home shows own daily score for admin-visible hidden game', async () => {
  rpcMock.mockResolvedValue([{ user_id: 'u2', score: 3 }, { user_id: 'u1', score: 8.5 }])
  render(<MemoryRouter><HomePage /></MemoryRouter>)
  expect(await screen.findByText('오늘 8.5점')).toBeInTheDocument()
  expect(rpcMock).toHaveBeenCalledWith('lb_daily', { p_day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), p_game: 'number-guess' })
  expect(screen.getByRole('link', { name: '데일리' })).toHaveAttribute('href', '/play/number-guess/daily')
  expect(screen.getByRole('link', { name: '자유 플레이' })).toHaveAttribute('href', '/play/number-guess/free')
})

test('home says not played yet, and hides hidden games from non-admins', async () => {
  rpcMock.mockResolvedValue([])
  render(<MemoryRouter><HomePage /></MemoryRouter>)
  expect(await screen.findByText('아직 안 풀었어요')).toBeInTheDocument()
  admin = false
  render(<MemoryRouter><HomePage /></MemoryRouter>)
  await waitFor(() => expect(screen.getAllByText('아직 열린 게임이 없어요')).toHaveLength(1))
})

test('daily page with unknown game', () => {
  render(
    <MemoryRouter initialEntries={['/play/nope/daily']}>
      <Routes><Route path="/play/:game/daily" element={<DailyPage />} /></Routes>
    </MemoryRouter>,
  )
  expect(screen.getByText('없는 게임이에요')).toBeInTheDocument()
  expect(playMock).not.toHaveBeenCalled()
})

test('daily page asks for the daily item then opens it', async () => {
  playMock.mockResolvedValueOnce({ contest_id: 'c', item_id: 'it9' })
  playMock.mockResolvedValueOnce({
    item_id: 'it9', contest_id: 'c', game_id: 'number-guess', options: {}, finished: false, score: null, action_count: 0,
    public_state: { guesses: [], feedback: [], hintUsed: false, parity: null, gaveUp: false },
    ends_at: new Date(Date.now() + 1e6).toISOString(), server_now: Date.now(),
  })
  render(
    <MemoryRouter initialEntries={['/play/number-guess/daily']}>
      <Routes><Route path="/play/:game/daily" element={<DailyPage />} /></Routes>
    </MemoryRouter>,
  )
  await screen.findByText('0 / 8')
  expect(playMock).toHaveBeenNthCalledWith(1, { action: 'daily', game_id: 'number-guess' })
  expect(playMock).toHaveBeenNthCalledWith(2, { action: 'open', item_id: 'it9' })
})

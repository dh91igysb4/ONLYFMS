import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

import { ApiError } from '../../lib/api.ts'
import { HomePage } from './HomePage.tsx'
import { DailyPage } from './DailyPage.tsx'
import { FreePage } from './FreePage.tsx'
import { resetServerTime, syncFromView } from '../../lib/serverTime.ts'

beforeEach(() => { rpcMock.mockReset(); playMock.mockReset(); admin = true; resetServerTime() })

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
  await screen.findByText('남은 기회 8')
  expect(playMock).toHaveBeenNthCalledWith(1, { action: 'daily', game_id: 'number-guess' })
  expect(playMock).toHaveBeenNthCalledWith(2, { action: 'open', item_id: 'it9' })
})

test('daily page shows day-changed notice on ended and reopens a new daily', async () => {
  const base = {
    contest_id: 'c', game_id: 'number-guess', options: {}, finished: false, score: null, action_count: 0,
    public_state: { guesses: [], feedback: [], hintUsed: false, parity: null, gaveUp: false },
    ends_at: new Date(Date.now() + 1e6).toISOString(), server_now: Date.now(),
  }
  playMock.mockResolvedValueOnce({ contest_id: 'c', item_id: 'it1' })
  playMock.mockResolvedValueOnce({ ...base, item_id: 'it1' })
  render(
    <MemoryRouter initialEntries={['/play/number-guess/daily']}>
      <Routes><Route path="/play/:game/daily" element={<DailyPage />} /></Routes>
    </MemoryRouter>,
  )
  await screen.findByText('남은 기회 8')
  playMock.mockRejectedValueOnce(new ApiError('ended', 409, {
    error: 'ended',
    view: { ...base, item_id: 'it1', finished: true, score: 0, reveal: { answer: 33 }, ends_at: new Date(Date.now() - 1000).toISOString() },
  }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '5' } })
  fireEvent.click(screen.getByRole('button', { name: '추측' }))
  expect(await screen.findByText('날짜가 바뀌었어요')).toBeInTheDocument()
  expect(screen.getByText(/정답은 33/)).toBeInTheDocument()
  playMock.mockResolvedValueOnce({ contest_id: 'c2', item_id: 'it2' })
  playMock.mockResolvedValueOnce({ ...base, contest_id: 'c2', item_id: 'it2' })
  fireEvent.click(screen.getByRole('button', { name: '새 데일리 열기' }))
  await screen.findByText('남은 기회 8')
  expect(playMock).toHaveBeenNthCalledWith(4, { action: 'daily', game_id: 'number-guess' })
  expect(playMock).toHaveBeenNthCalledWith(5, { action: 'open', item_id: 'it2' })
  expect(screen.queryByText('날짜가 바뀌었어요')).toBeNull()
})

test('home uses server-synced time for the KST day', async () => {
  rpcMock.mockResolvedValue([])
  // 서버 시각 2030-01-01 00:30 KST (브라우저 시계와 무관)
  syncFromView(Date.parse('2029-12-31T15:30:00Z'))
  render(<MemoryRouter><HomePage /></MemoryRouter>)
  await screen.findByText('아직 안 풀었어요')
  expect(rpcMock).toHaveBeenCalledWith('lb_daily', { p_day: '2030-01-01', p_game: 'number-guess' })
})

test('free page hides hidden games from non-admins like unknown games', () => {
  admin = false
  const page = () => (
    <MemoryRouter initialEntries={['/play/number-guess/free']}>
      <Routes><Route path="/play/:game/free" element={<FreePage />} /></Routes>
    </MemoryRouter>
  )
  const r = render(page())
  expect(screen.getByText('없는 게임이에요')).toBeInTheDocument()
  expect(screen.queryByText('남은 기회 8')).toBeNull()
  r.unmount()
  admin = true
  render(page())
  expect(screen.getByText('남은 기회 8')).toBeInTheDocument()
})

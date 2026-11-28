import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
const playMock = vi.fn()
let admin = true
vi.mock('../../games/index.ts', async (orig) => {
  const fx = await import('../../test-fixtures/world.ts')
  const real = fx.withTestWorld((await import('../../test-fixtures/registry.ts')).withTestGame(await orig()))
  // 숨김 world (일반 사용자에게는 카드가 없어야 한다)
  const hidden = { ...fx.testWorld, manifest: { ...fx.testWorld.manifest, id: 'hidden-world', name: '숨김 월드', hidden: true } }
  return { ...real, worlds: [...real.worlds, hidden] }
})
vi.mock('../../games/ui.ts', async (orig) =>
  (await import('../../test-fixtures/ui.ts')).withTestGameUi(await orig()))
vi.mock('../../lib/supabase.ts', () => ({ supabase: { from: () => ({ upsert: async () => ({ error: null }) }) }, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
  play: (...a: unknown[]) => playMock(...a),
}))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: admin } }),
}))

vi.mock('../chat/DailyChat.tsx', () => ({
  DailyChat: ({ itemId }: { itemId: string }) => <section><h3>오늘의 대화</h3><p>chat:{itemId}</p></section>,
}))

import { ApiError } from '../../lib/api.ts'
import { GamesPage } from './GamesPage.tsx'
import { DailyPage } from './DailyPage.tsx'
import { FreePage } from './FreePage.tsx'
import { resetServerTime, syncFromView } from '../../lib/serverTime.ts'

beforeEach(() => { rpcMock.mockReset(); playMock.mockReset(); admin = true; resetServerTime() })

/** 게임 목록에서 숫자 맞히기 줄만 (등록부에 다른 게임이 있어도 이 줄로 검사한다) */
async function ngCard() {
  return within(await screen.findByRole('group', { name: '테스트 숫자 맞히기' }))
}

test('home shows own daily score for admin-visible hidden game', async () => {
  rpcMock.mockResolvedValue([{ user_id: 'u2', score: 3 }, { user_id: 'u1', score: 8.5 }])
  render(<MemoryRouter><GamesPage /></MemoryRouter>)
  const card = await ngCard()
  expect(await card.findByText(/오늘 8\.5점/)).toBeInTheDocument()
  expect(rpcMock).toHaveBeenCalledWith('lb_daily', { p_day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), p_game: 'test-guess' })
})

test('데일리 게임 줄에 데일리·자유 링크와 오늘 상태', async () => {
  rpcMock.mockResolvedValue([])
  render(<MemoryRouter><GamesPage /></MemoryRouter>)
  const card = await ngCard()
  expect(await card.findByText(/아직 안 풀었어요/)).toBeInTheDocument()
  const daily = card.getByRole('link', { name: '테스트 숫자 맞히기 데일리' })
  expect(daily).toHaveAttribute('href', '/play/test-guess/daily')
  expect(daily.className).toContain('btn-primary')
  const free = card.getByRole('link', { name: '테스트 숫자 맞히기 자유 플레이' })
  expect(free).toHaveAttribute('href', '/play/test-guess/free')
  expect(free.className).toContain('btn-ghost')
  expect(card.getByText('데일리')).toBeInTheDocument()
  expect(card.getByText('자유')).toBeInTheDocument()
})

test('자유 플레이만 있는 게임은 줄 전체가 링크(이름으로 찾음)', async () => {
  rpcMock.mockResolvedValue([])
  render(<MemoryRouter><GamesPage /></MemoryRouter>)
  const row = await screen.findByRole('link', { name: '볼 런' })
  expect(row).toHaveAttribute('href', '/play/ball-run/free')
  expect(row.className).toContain('fm-row')
})

test('home says not played yet, and hides hidden games from non-admins', async () => {
  rpcMock.mockResolvedValue([])
  const r = render(<MemoryRouter><GamesPage /></MemoryRouter>)
  expect(await (await ngCard()).findByText(/아직 안 풀었어요/)).toBeInTheDocument()
  r.unmount()
  admin = false
  render(<MemoryRouter><GamesPage /></MemoryRouter>)
  expect(await screen.findByRole('group', { name: '후알야' })).toBeInTheDocument()
  expect(screen.queryByText('테스트 숫자 맞히기')).toBeNull()
})

test('지속형 게임 줄은 /world/:id 링크, 숨김은 관리자에게만', async () => {
  rpcMock.mockResolvedValue([])
  const r = render(<MemoryRouter><GamesPage /></MemoryRouter>)
  const row = await screen.findByRole('link', { name: '테스트 월드 입장' })
  expect(row).toHaveAttribute('href', '/world/test-world')
  expect(row.textContent).toContain('입장 ›')
  expect(screen.getByRole('link', { name: '숨김 월드 입장' })).toBeInTheDocument()
  r.unmount()
  admin = false
  render(<MemoryRouter><GamesPage /></MemoryRouter>)
  expect(await screen.findByRole('link', { name: '테스트 월드 입장' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '숨김 월드 입장' })).toBeNull()
})

test('페이지 제목 "게임 목록"은 보이지 않게 남는다', () => {
  rpcMock.mockResolvedValue([])
  render(<MemoryRouter><GamesPage /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: '게임 목록' }).className).toContain('sr-only')
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
    item_id: 'it9', contest_id: 'c', game_id: 'test-guess', options: {}, finished: false, score: null, action_count: 0,
    public_state: { guesses: [], feedback: [], hintUsed: false, parity: null, gaveUp: false },
    ends_at: new Date(Date.now() + 1e6).toISOString(), server_now: Date.now(),
  })
  render(
    <MemoryRouter initialEntries={['/play/test-guess/daily']}>
      <Routes><Route path="/play/:game/daily" element={<DailyPage />} /></Routes>
    </MemoryRouter>,
  )
  await screen.findByText('남은 기회 8')
  expect(playMock).toHaveBeenNthCalledWith(1, { action: 'daily', game_id: 'test-guess' })
  expect(playMock).toHaveBeenNthCalledWith(2, { action: 'open', item_id: 'it9' })
})

test('daily chat is hidden until the daily is finished', async () => {
  const base = {
    item_id: 'it9', contest_id: 'c', game_id: 'test-guess', options: {}, finished: false, score: null, action_count: 0,
    public_state: { guesses: [], feedback: [], hintUsed: false, parity: null, gaveUp: false },
    ends_at: new Date(Date.now() + 1e6).toISOString(), server_now: Date.now(),
  }
  playMock.mockResolvedValueOnce({ contest_id: 'c', item_id: 'it9' })
  playMock.mockResolvedValueOnce(base)
  render(
    <MemoryRouter initialEntries={['/play/test-guess/daily']}>
      <Routes><Route path="/play/:game/daily" element={<DailyPage />} /></Routes>
    </MemoryRouter>,
  )
  await screen.findByText('남은 기회 8')
  expect(screen.queryByText('오늘의 대화')).toBeNull()
  playMock.mockResolvedValueOnce({
    ...base, finished: true, score: 10, action_count: 1, reveal: { answer: 5 },
    public_state: { guesses: [5], feedback: ['hit'], hintUsed: false, parity: null, gaveUp: false },
  })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '5' } })
  fireEvent.click(screen.getByRole('button', { name: '추측' }))
  expect(await screen.findByText('오늘의 대화')).toBeInTheDocument()
  expect(screen.getByText('chat:it9')).toBeInTheDocument()
})

test('daily chat shows when reopening an already finished daily', async () => {
  playMock.mockResolvedValueOnce({ contest_id: 'c', item_id: 'it8' })
  playMock.mockResolvedValueOnce({
    item_id: 'it8', contest_id: 'c', game_id: 'test-guess', options: {}, finished: true, score: 10, action_count: 1,
    public_state: { guesses: [5], feedback: ['hit'], hintUsed: false, parity: null, gaveUp: false }, reveal: { answer: 5 },
    ends_at: new Date(Date.now() - 1000).toISOString(), server_now: Date.now(),
  })
  render(
    <MemoryRouter initialEntries={['/play/test-guess/daily']}>
      <Routes><Route path="/play/:game/daily" element={<DailyPage />} /></Routes>
    </MemoryRouter>,
  )
  expect(await screen.findByText('chat:it8')).toBeInTheDocument()
})

test('daily page shows day-changed notice on ended and reopens a new daily', async () => {
  const base = {
    contest_id: 'c', game_id: 'test-guess', options: {}, finished: false, score: null, action_count: 0,
    public_state: { guesses: [], feedback: [], hintUsed: false, parity: null, gaveUp: false },
    ends_at: new Date(Date.now() + 1e6).toISOString(), server_now: Date.now(),
  }
  playMock.mockResolvedValueOnce({ contest_id: 'c', item_id: 'it1' })
  playMock.mockResolvedValueOnce({ ...base, item_id: 'it1' })
  render(
    <MemoryRouter initialEntries={['/play/test-guess/daily']}>
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
  expect(playMock).toHaveBeenNthCalledWith(4, { action: 'daily', game_id: 'test-guess' })
  expect(playMock).toHaveBeenNthCalledWith(5, { action: 'open', item_id: 'it2' })
  expect(screen.queryByText('날짜가 바뀌었어요')).toBeNull()
})

test('home uses server-synced time for the KST day', async () => {
  rpcMock.mockResolvedValue([])
  // 서버 시각 2030-01-01 00:30 KST (브라우저 시계와 무관)
  syncFromView(Date.parse('2029-12-31T15:30:00Z'))
  render(<MemoryRouter><GamesPage /></MemoryRouter>)
  await (await ngCard()).findByText('아직 안 풀었어요')
  expect(rpcMock).toHaveBeenCalledWith('lb_daily', { p_day: '2030-01-01', p_game: 'test-guess' })
})

test('free page hides hidden games from non-admins like unknown games', () => {
  admin = false
  const page = () => (
    <MemoryRouter initialEntries={['/play/test-guess/free']}>
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

test('home groups games into topic sections, world games first in each', async () => {
  rpcMock.mockResolvedValue([])
  render(<MemoryRouter><GamesPage /></MemoryRouter>)
  const football = await screen.findByRole('region', { name: '축구' })
  expect(football.className).toContain('fm-panel')
  expect(within(football).getByRole('group', { name: '후알야' })).toBeInTheDocument()
  expect(within(football).queryByRole('group', { name: '테스트 숫자 맞히기' })).toBeNull()
  const other = screen.getByRole('region', { name: '다른 게임' })
  expect(within(other).getByRole('heading').textContent).toBe('다른 게임')
  const rows = [...other.querySelectorAll('.fm-row')]
  expect(rows[0].textContent).toContain('펨타듀 낚시') // 지속형 게임이 맨 위
  expect(rows.some((x) => x.textContent?.includes('테스트 숫자 맞히기'))).toBe(true)
})

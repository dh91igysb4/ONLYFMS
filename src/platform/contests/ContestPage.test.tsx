import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const calls: string[] = []
const rpcMock = vi.fn()
const playMock = vi.fn()
const dataMock = {
  getContest: vi.fn(),
  getItems: vi.fn(),
  getEntries: vi.fn(),
}
let admin = false
vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
  play: (...a: unknown[]) => playMock(...a),
}))
vi.mock('./data.ts', () => ({
  getContest: (...a: unknown[]) => dataMock.getContest(...a),
  getItems: (...a: unknown[]) => dataMock.getItems(...a),
  getEntries: (...a: unknown[]) => dataMock.getEntries(...a),
}))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: admin } }),
}))

import { resetServerTime } from '../../lib/serverTime.ts'
import { ContestPage } from './ContestPage.tsx'
import { ContestItemPage } from './ContestItemPage.tsx'

const MIN = 60_000
let serverOffset = 0 // 서버 시각 - 브라우저 시각
const sNow = () => Date.now() + serverOffset
const iso = (ms: number) => new Date(ms).toISOString()

function contest(over: Record<string, unknown> = {}) {
  return {
    id: 'c1', kind: 'friendly', title: '금요 대회', created_by: 'u9', visibility: 'public',
    starts_at: iso(sNow() + 60 * MIN), ends_at: iso(sNow() + 120 * MIN), cancelled_at: null,
    daily_key: null, created_at: iso(sNow() - 1000), ...over,
  }
}
const item = (position: number, over: Record<string, unknown> = {}) => ({
  id: `it${position}`, contest_id: 'c1', position, game_id: 'number-guess', options: { range: '100' },
  puzzle: null, puzzle_key: null, logic_version: 1, generated_at: null, ...over,
})

function setup(over: { entries?: string[]; lb?: unknown[] } = {}) {
  dataMock.getItems.mockResolvedValue([item(1), item(2)])
  dataMock.getEntries.mockResolvedValue(over.entries ?? [])
  rpcMock.mockImplementation(async (name: string) => {
    calls.push(name)
    if (name === 'server_now') return sNow()
    if (name === 'lb_contest') return over.lb ?? []
    if (name === 'contest_invite_code') return null
    return null
  })
}

function renderAt(path = '/contests/c1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/contests/:id" element={<ContestPage />} />
        <Route path="/contests/:id/:position" element={<ContestItemPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

beforeEach(() => {
  calls.length = 0
  rpcMock.mockReset(); playMock.mockReset()
  Object.values(dataMock).forEach((m) => m.mockReset())
  admin = false
  serverOffset = 0
  resetServerTime()
})
afterEach(() => { vi.useRealTimers() })

test('lobby_shows_countdown_using_server_offset', async () => {
  serverOffset = 60 * MIN // 서버가 브라우저보다 1시간 빠르다
  dataMock.getContest.mockResolvedValue(contest({ starts_at: iso(sNow() + 90 * MIN + 30_000) }))
  setup({ entries: ['u2', 'u3'] })
  renderAt()
  expect(await screen.findByText(/1시간 30분/)).toBeInTheDocument()
  expect(screen.getByText('금요 대회')).toBeInTheDocument()
  expect(screen.getByText('친선')).toBeInTheDocument()
  expect(screen.getByText(/참가자 2명/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '참가' })).toBeInTheDocument()
})

test('live_polls_lb_contest_every_5s', async () => {
  vi.useFakeTimers()
  dataMock.getContest.mockResolvedValue(
    contest({ starts_at: iso(sNow() - 10 * MIN), ends_at: iso(sNow() + 50 * MIN) }),
  )
  setup({ entries: ['u1'], lb: [{ rank: 1, user_id: 'u1', handle: 'kane', score: 7, solved_items: 1, action_count: 3, last_finished_at: null }] })
  const view = renderAt()
  await flush()
  expect(screen.getByText('진행 중')).toBeInTheDocument()
  const count = () => calls.filter((c) => c === 'lb_contest').length
  expect(count()).toBe(1)
  expect(screen.getByRole('link', { name: /1번/ })).toHaveAttribute('href', '/contests/c1/1')
  await act(async () => { await vi.advanceTimersByTimeAsync(4900) })
  expect(count()).toBe(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(200) })
  expect(count()).toBe(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(count()).toBe(3)
  view.unmount()
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
  expect(count()).toBe(3)
})

test('public_live_contest_autojoins_before_open', async () => {
  dataMock.getContest.mockResolvedValue(
    contest({ starts_at: iso(sNow() - 10 * MIN), ends_at: iso(sNow() + 50 * MIN) }),
  )
  setup({ entries: [] })
  rpcMock.mockImplementation(async (name: string) => {
    calls.push(name)
    if (name === 'server_now') return sNow()
    return name === 'lb_contest' ? [] : null
  })
  playMock.mockImplementation(async (body: { action: string }) => {
    calls.push(`play:${body.action}`)
    return {
      item_id: 'it1', contest_id: 'c1', game_id: 'number-guess', options: { range: '100' },
      public_state: { guesses: [], feedback: [], hintUsed: false, parity: null, gaveUp: false },
      finished: false, score: null, action_count: 0, ends_at: iso(sNow() + 50 * MIN), server_now: sNow(),
    }
  })
  renderAt()
  const link = await screen.findByRole('link', { name: /1번/ })
  expect(calls).toContain('join_contest')
  expect(rpcMock).toHaveBeenCalledWith('join_contest', { p_id: 'c1' })
  fireEvent.click(link)
  await screen.findByText(/남은 기회/)
  const open = calls.indexOf('play:open')
  expect(open).toBeGreaterThan(-1)
  expect(calls.indexOf('join_contest')).toBeLessThan(open)
})

test('item page joins by itself when opened directly', async () => {
  dataMock.getContest.mockResolvedValue(
    contest({ starts_at: iso(sNow() - 10 * MIN), ends_at: iso(sNow() + 50 * MIN) }),
  )
  setup({ entries: [] })
  playMock.mockImplementation(async (body: { action: string }) => {
    calls.push(`play:${body.action}`)
    return {
      item_id: 'it2', contest_id: 'c1', game_id: 'number-guess', options: { range: '100' },
      public_state: { guesses: [], feedback: [], hintUsed: false, parity: null, gaveUp: false },
      finished: false, score: null, action_count: 0, ends_at: iso(sNow() + 50 * MIN), server_now: sNow(),
    }
  })
  renderAt('/contests/c1/2')
  await screen.findByText(/남은 기회/)
  expect(playMock).toHaveBeenCalledWith({ action: 'open', item_id: 'it2' })
  expect(calls.indexOf('join_contest')).toBeLessThan(calls.indexOf('play:open'))
})

test('invite_contest_without_code_shows_join_required', async () => {
  // RLS가 초대 대회를 숨기므로 getContest는 null을 돌려준다
  dataMock.getContest.mockResolvedValue(null)
  setup({ entries: [] })
  renderAt()
  expect(await screen.findByText('대회를 찾을 수 없거나, 초대 링크로만 참가할 수 있어요')).toBeInTheDocument()
  expect(calls).not.toContain('join_contest')
})

test('item page shows the same message when nothing is visible', async () => {
  dataMock.getContest.mockResolvedValue(null)
  setup({ entries: [] })
  dataMock.getItems.mockResolvedValue([])
  renderAt('/contests/c1/1')
  expect(await screen.findByText('대회를 찾을 수 없거나, 초대 링크로만 참가할 수 있어요')).toBeInTheDocument()
  expect(playMock).not.toHaveBeenCalled()
})

test('ended ranking failure shows an error with retry', async () => {
  dataMock.getContest.mockResolvedValue(
    contest({ starts_at: iso(sNow() - 120 * MIN), ends_at: iso(sNow() - 60 * MIN) }),
  )
  setup({ entries: ['u1'] })
  let fail = true
  rpcMock.mockImplementation(async (name: string) => {
    calls.push(name)
    if (name === 'server_now') return sNow()
    if (name === 'lb_contest') {
      if (fail) throw new Error('boom')
      return [{ rank: 1, user_id: 'u1', handle: 'kane', score: 5, solved_items: 1, action_count: 2, last_finished_at: null }]
    }
    return null
  })
  renderAt()
  expect(await screen.findByText('순위를 불러오지 못했어요')).toBeInTheDocument()
  expect(screen.queryByText('아직 기록이 없어요')).toBeNull()
  fail = false
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByText('kane')).toBeInTheDocument()
})

test('ended_shows_results_and_answers', async () => {
  dataMock.getContest.mockResolvedValue(
    contest({ starts_at: iso(sNow() - 120 * MIN), ends_at: iso(sNow() - 60 * MIN) }),
  )
  setup({
    entries: ['u1', 'u2'],
    lb: [
      { rank: 1, user_id: 'u2', handle: 'son', score: 18, solved_items: 2, action_count: 7, last_finished_at: null },
      { rank: 2, user_id: 'u1', handle: 'kane', score: 9.5, solved_items: 1, action_count: 9, last_finished_at: null },
    ],
  })
  dataMock.getItems.mockResolvedValue([item(1, { puzzle: { answer: 42 } }), item(2, { puzzle: { answer: 77 } })])
  renderAt()
  expect(await screen.findByText('종료')).toBeInTheDocument()
  expect(screen.getByText('son')).toBeInTheDocument()
  expect(screen.getByText('18')).toBeInTheDocument()
  expect(screen.getByText(/42/)).toBeInTheDocument()
  expect(screen.getByText(/77/)).toBeInTheDocument()
  expect(calls.filter((c) => c === 'lb_contest')).toHaveLength(1)
})

test('cancelled_shows_notice', async () => {
  dataMock.getContest.mockResolvedValue(contest({ cancelled_at: iso(sNow() - MIN) }))
  setup()
  renderAt()
  expect(await screen.findByText('취소된 대회예요')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '참가' })).toBeNull()
})

test('creator can cancel with two taps and sees the invite link', async () => {
  dataMock.getContest.mockResolvedValue(contest({ created_by: 'u1', visibility: 'invite' }))
  setup({ entries: ['u1'] })
  rpcMock.mockImplementation(async (name: string) => {
    calls.push(name)
    if (name === 'server_now') return sNow()
    if (name === 'contest_invite_code') return 'abcde12345'
    if (name === 'cancel_contest') {
      dataMock.getContest.mockResolvedValue(contest({ created_by: 'u1', visibility: 'invite', cancelled_at: iso(sNow()) }))
    }
    return null
  })
  renderAt()
  expect(await screen.findByDisplayValue(`${location.origin}/join/abcde12345`)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '대회 취소' }))
  expect(rpcMock).not.toHaveBeenCalledWith('cancel_contest', expect.anything())
  fireEvent.click(screen.getByRole('button', { name: '정말 취소할까요?' }))
  expect(await screen.findByText('취소된 대회예요')).toBeInTheDocument()
  expect(rpcMock).toHaveBeenCalledWith('cancel_contest', { p_id: 'c1' })
})

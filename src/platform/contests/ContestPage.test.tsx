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
  getSettledAt: vi.fn(),
}
let admin = false
const wallet = vi.hoisted(() => ({ enabled: true }))
vi.mock('../wallet/enabled.ts', () => ({ walletEnabled: () => wallet.enabled }))
vi.mock('../../games/index.ts', async (orig) =>
  (await import('../../test-fixtures/registry.ts')).withTestGame(await orig()))
vi.mock('../../games/ui.ts', async (orig) =>
  (await import('../../test-fixtures/ui.ts')).withTestGameUi(await orig()))
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
  getSettledAt: (...a: unknown[]) => dataMock.getSettledAt(...a),
}))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: admin } }),
}))

import { resetServerTime } from '../../lib/serverTime.ts'
import { setBalance } from '../../lib/walletStore.ts'
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
  id: `it${position}`, contest_id: 'c1', position, game_id: 'test-guess', options: { range: '100' },
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
  wallet.enabled = true
  setBalance(100000)
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
      item_id: 'it1', contest_id: 'c1', game_id: 'test-guess', options: { range: '100' },
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
      item_id: 'it2', contest_id: 'c1', game_id: 'test-guess', options: { range: '100' },
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
  expect(screen.getByText(/"answer": 42/)).toBeInTheDocument()
  expect(screen.getByText(/"answer": 77/)).toBeInTheDocument()
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

// ---- 받은 상금 (지갑 3단계) ----
const endedDaily = () => contest({
  kind: 'daily', title: '후알야 · 2026-11-24', daily_key: 'test-guess:2026-11-24',
  starts_at: iso(sNow() - 25 * 60 * MIN), ends_at: iso(sNow() - 60 * MIN),
})
const lb2 = [
  { rank: 1, user_id: 'u1', handle: 'kane', score: 9, solved_items: 1, action_count: 3, last_finished_at: null },
  { rank: 2, user_id: 'u2', handle: 'son', score: 7, solved_items: 1, action_count: 4, last_finished_at: null },
]

function setupPrizes(prizes: unknown[][], settledAt: string | null | undefined = null) {
  // contest_prizes를 부를 때마다 다음 값을 돌려준다(마지막 값 유지)
  let i = 0
  dataMock.getSettledAt.mockResolvedValue(settledAt)
  dataMock.getItems.mockResolvedValue([item(1)])
  dataMock.getEntries.mockResolvedValue(['u1', 'u2'])
  rpcMock.mockImplementation(async (name: string) => {
    calls.push(name)
    if (name === 'server_now') return sNow()
    if (name === 'lb_contest') return lb2
    if (name === 'contest_prizes') return prizes[Math.min(i++, prizes.length - 1)]
    if (name === 'my_wallet') return { balance: 6150, today: {}, earned_today: 6150, prizes: [] }
    return null
  })
}

test('ended_daily_shows_prize_column_and_my_prize', async () => {
  dataMock.getContest.mockResolvedValue(endedDaily())
  setupPrizes([[
    { user_id: 'u1', handle: 'kane', amount: 6150, note: '1등' },
    { user_id: 'u2', handle: 'son', amount: 5120, note: '2등' },
  ]])
  renderAt()
  expect(await screen.findByText('내 상금 +6,150 G (1등)')).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: '상금' })).toBeInTheDocument()
  expect(screen.getByText('+5,120 G')).toBeInTheDocument()
  expect(calls).toContain('contest_prizes')
  expect(calls).not.toContain('my_wallet')
})

test('ended_daily_without_prizes_settles_once_then_reloads', async () => {
  dataMock.getContest.mockResolvedValue(endedDaily())
  setupPrizes([[], [{ user_id: 'u1', handle: 'kane', amount: 6150, note: '1등' }]])
  renderAt()
  expect(await screen.findByText('내 상금 +6,150 G (1등)')).toBeInTheDocument()
  expect(calls.filter((c) => c === 'my_wallet')).toHaveLength(1)
  expect(calls.filter((c) => c === 'contest_prizes')).toHaveLength(2)
})

test('ended_daily_settle_shows_pending_text_while_running', async () => {
  dataMock.getContest.mockResolvedValue(endedDaily())
  setupPrizes([[]])
  let release!: () => void
  const base = rpcMock.getMockImplementation()!
  rpcMock.mockImplementation(async (name: string, ...rest: unknown[]) => {
    if (name === 'my_wallet') { calls.push(name); await new Promise<void>((r) => { release = r }); return { balance: 0 } }
    return base(name, ...rest)
  })
  renderAt()
  expect(await screen.findByText('상금을 정산하는 중이에요')).toBeInTheDocument()
  release()
  await vi.waitFor(() => expect(screen.queryByText('상금을 정산하는 중이에요')).toBeNull())
  expect(screen.queryByRole('columnheader', { name: '상금' })).toBeNull()
})

test('friendly_ended_without_prizes_has_no_prize_column_and_no_settle', async () => {
  dataMock.getContest.mockResolvedValue(contest({ starts_at: iso(sNow() - 120 * MIN), ends_at: iso(sNow() - 60 * MIN) }))
  setupPrizes([[]])
  renderAt()
  expect(await screen.findByText('kane')).toBeInTheDocument()
  await vi.waitFor(() => expect(calls).toContain('contest_prizes'))
  expect(screen.queryByRole('columnheader', { name: '상금' })).toBeNull()
  expect(calls).not.toContain('my_wallet')
})

test('no_prize_ui_when_wallet_disabled', async () => {
  wallet.enabled = false
  dataMock.getContest.mockResolvedValue(endedDaily())
  setupPrizes([[{ user_id: 'u1', handle: 'kane', amount: 6150, note: '1등' }]])
  renderAt()
  expect(await screen.findByText('kane')).toBeInTheDocument()
  expect(calls).not.toContain('contest_prizes')
  expect(screen.queryByText(/내 상금/)).toBeNull()
})

test('ended_daily_already_settled_without_prizes_does_not_show_pending_or_settle', async () => {
  dataMock.getContest.mockResolvedValue(endedDaily())
  setupPrizes([[]], '2026-11-24T00:00:00Z')
  renderAt()
  expect(await screen.findByText('kane')).toBeInTheDocument()
  await vi.waitFor(() => expect(dataMock.getSettledAt).toHaveBeenCalled())
  expect(screen.queryByText('상금을 정산하는 중이에요')).toBeNull()
  expect(calls).not.toContain('my_wallet')
})

test('ended_daily_settled_at_unreadable_does_not_settle', async () => {
  dataMock.getContest.mockResolvedValue(endedDaily())
  setupPrizes([[]])
  dataMock.getSettledAt.mockResolvedValue(undefined) // 3단계 DB 전: 열이 없어 읽지 못함
  renderAt()
  expect(await screen.findByText('kane')).toBeInTheDocument()
  await vi.waitFor(() => expect(dataMock.getSettledAt).toHaveBeenCalled())
  expect(calls).not.toContain('my_wallet')
})

// ---------------------------------------------------------------- 참가비 (지갑 5단계)
test('참가비 대회 대기실: 참가비·모인 돈, 확인 뒤 "참가비 N G 내고 참가"가 p_entry_fee를 보낸다', async () => {
  dataMock.getContest.mockResolvedValue(contest({ entry_fee: 1000 }))
  setup({ entries: ['u9', 'u2'] })
  renderAt()
  expect(await screen.findByText(/모인 돈/)).toHaveTextContent('참가비 1,000 G · 모인 돈 2,000 G')
  fireEvent.click(screen.getByRole('button', { name: '참가비 1,000 G 내고 참가' }))
  // 첫 클릭은 확인 단계
  expect(screen.getByText(/참가비 1,000 G를 내고 참가할까요/)).toBeInTheDocument()
  expect(calls).not.toContain('join_contest')
  fireEvent.click(screen.getByRole('button', { name: '참가비 1,000 G 내고 참가' }))
  await vi.waitFor(() => expect(rpcMock).toHaveBeenCalledWith('join_contest', { p_id: 'c1', p_entry_fee: 1000 }))
  await vi.waitFor(() => expect(screen.getByText(/모인 돈/)).toHaveTextContent('모인 돈 3,000 G'))
  expect(calls).toContain('my_wallet') // 참가 뒤 잔액 다시 읽기
})

test('잔액이 참가비보다 적으면 참가 버튼이 막히고 "골드가 부족해요"', async () => {
  setBalance(500)
  dataMock.getContest.mockResolvedValue(contest({ entry_fee: 1000 }))
  setup({ entries: ['u9'] })
  renderAt()
  expect(await screen.findByRole('button', { name: '참가비 1,000 G 내고 참가' })).toBeDisabled()
  expect(screen.getByText(/골드가 부족해요/)).toBeInTheDocument()
})

test('진행 중인 공개 참가비 대회는 자동 참가하지 않고 버튼을 보인다', async () => {
  dataMock.getContest.mockResolvedValue(
    contest({ entry_fee: 500, starts_at: iso(sNow() - 10 * MIN), ends_at: iso(sNow() + 50 * MIN) }),
  )
  setup({ entries: [] })
  renderAt()
  expect(await screen.findByRole('button', { name: '참가비 500 G 내고 참가' })).toBeInTheDocument()
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  expect(calls).not.toContain('join_contest')
})

test('fee_mismatch면 대회를 다시 읽고 안내한다', async () => {
  const { ApiError } = await import('../../lib/api.ts')
  dataMock.getContest.mockResolvedValue(contest({ entry_fee: 1000 }))
  setup({ entries: ['u9'] })
  rpcMock.mockImplementation(async (name: string) => {
    calls.push(name)
    if (name === 'server_now') return sNow()
    if (name === 'join_contest') throw new ApiError('fee_mismatch', 400, { details: '2000' })
    return null
  })
  renderAt()
  fireEvent.click(await screen.findByRole('button', { name: '참가비 1,000 G 내고 참가' }))
  fireEvent.click(screen.getByRole('button', { name: '참가비 1,000 G 내고 참가' }))
  expect(await screen.findByText('참가비를 다시 확인해 주세요')).toBeInTheDocument()
  await vi.waitFor(() => expect(dataMock.getContest.mock.calls.length).toBeGreaterThan(1))
})

test('참가비 0 대회는 지금처럼 "참가" 한 번', async () => {
  dataMock.getContest.mockResolvedValue(contest({ entry_fee: 0 }))
  setup({ entries: [] })
  renderAt()
  fireEvent.click(await screen.findByRole('button', { name: '참가' }))
  await vi.waitFor(() => expect(rpcMock).toHaveBeenCalledWith('join_contest', { p_id: 'c1' }))
  expect(screen.queryByText(/참가비/)).toBeNull()
})

test('취소된 참가비 대회에 참가했으면 "참가비를 돌려받았어요"이고 모인 돈은 보이지 않는다', async () => {
  dataMock.getContest.mockResolvedValue(contest({ entry_fee: 1000, cancelled_at: iso(sNow() - MIN) }))
  setup({ entries: ['u1'] })
  renderAt()
  expect(await screen.findByText('참가비를 돌려받았어요')).toBeInTheDocument()
  expect(document.querySelector('.contest-fee')).toHaveTextContent('참가비 1,000 G')
  expect(screen.queryByText(/모인 돈/)).toBeNull()
})

test('지갑이 보이기 전에는 참가비를 보이지 않는다', async () => {
  wallet.enabled = false
  dataMock.getContest.mockResolvedValue(contest({ entry_fee: 1000 }))
  setup({ entries: ['u9'] })
  renderAt()
  expect(await screen.findByRole('button', { name: '참가' })).toBeInTheDocument()
  expect(screen.queryByText(/참가비/)).toBeNull()
})

test('정산 전(끝나고 1분 유예)에는 "참가비를 돌려받았어요"를 보이지 않는다', async () => {
  dataMock.getContest.mockResolvedValue(contest({ entry_fee: 1000, starts_at: iso(sNow() - 120 * MIN), ends_at: iso(sNow() - 30_000) }))
  setupPrizes([[]], null)
  rpcMock.mockImplementation(async (name: string) => {
    calls.push(name)
    if (name === 'server_now') return sNow()
    if (name === 'lb_contest') return []
    if (name === 'contest_prizes') return []
    if (name === 'my_wallet') return { balance: 1, today: {}, earned_today: 0, prizes: [] }
    return null
  })
  renderAt()
  await vi.waitFor(() => expect(calls).toContain('my_wallet'))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  expect(screen.queryByText(/참가비를 돌려받았어요/)).toBeNull()
})

test('문제 화면에서 참가비 대회에 바로 들어오면(fee_mismatch) 대회 페이지로 보낸다', async () => {
  const { ApiError } = await import('../../lib/api.ts')
  dataMock.getContest.mockResolvedValue(
    contest({ entry_fee: 500, starts_at: iso(sNow() - 10 * MIN), ends_at: iso(sNow() + 50 * MIN) }),
  )
  setup({ entries: [] })
  rpcMock.mockImplementation(async (name: string) => {
    calls.push(name)
    if (name === 'server_now') return sNow()
    if (name === 'join_contest') throw new ApiError('fee_mismatch', 400, { details: '500' })
    return name === 'lb_contest' ? [] : null
  })
  renderAt('/contests/c1/1')
  expect(await screen.findByRole('button', { name: '참가비 500 G 내고 참가' })).toBeInTheDocument()
  expect(playMock).not.toHaveBeenCalled()
})

test('끝난 참가비 대회: 모인 돈·상금 열·내 상금, 정산 전이면 my_wallet로 정산', async () => {
  dataMock.getContest.mockResolvedValue(contest({ entry_fee: 1000, starts_at: iso(sNow() - 120 * MIN), ends_at: iso(sNow() - 60 * MIN) }))
  setupPrizes([[], [
    { user_id: 'u1', handle: 'kane', amount: 2000, note: '1등' },
  ]])
  renderAt()
  expect(await screen.findByText('내 상금 +2,000 G (1등)')).toBeInTheDocument()
  expect(screen.getByText(/모인 돈/)).toHaveTextContent('참가비 1,000 G · 모인 돈 2,000 G')
  expect(screen.getByRole('columnheader', { name: '상금' })).toBeInTheDocument()
  expect(calls.filter((c) => c === 'my_wallet')).toHaveLength(1)
})

test('끝난 참가비 대회에서 순위(행동 1번 이상)에 든 사람이 없으면 "참가비를 돌려받았어요"', async () => {
  dataMock.getContest.mockResolvedValue(contest({ entry_fee: 1000, starts_at: iso(sNow() - 120 * MIN), ends_at: iso(sNow() - 60 * MIN) }))
  setupPrizes([[]], '2026-11-24T00:00:00Z')
  rpcMock.mockImplementation(async (name: string) => {
    calls.push(name)
    if (name === 'server_now') return sNow()
    if (name === 'lb_contest') return [{ rank: 1, user_id: 'u1', handle: 'kane', score: 0, solved_items: 0, action_count: 0, last_finished_at: null }]
    if (name === 'contest_prizes') return []
    return null
  })
  renderAt()
  expect(await screen.findByText('순위에 든 사람이 없어 참가비를 돌려받았어요')).toBeInTheDocument()
})

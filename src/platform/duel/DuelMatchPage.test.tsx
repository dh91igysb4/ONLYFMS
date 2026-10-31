import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// ---- 가짜 Realtime 채널
type Handler = () => void
let broadcastHandler: Handler | null = null
let subscribeStatus = 'SUBSCRIBED'
let channelThrows = false
const removeChannel = vi.fn()
const channelMock = vi.fn((name: string) => {
  if (channelThrows) throw new Error('realtime unavailable')
  const ch = {
    name,
    on: vi.fn((_type: string, _filter: unknown, cb: Handler) => { broadcastHandler = cb; return ch }),
    subscribe: vi.fn((cb?: (s: string) => void) => { cb?.(subscribeStatus); return ch }),
  }
  return ch
})
vi.mock('../../lib/supabase.ts', () => ({
  supabase: { channel: (n: string) => channelMock(n), removeChannel: (c: unknown) => removeChannel(c) },
  supabaseUrl: 'http://x',
  supabaseKey: 'k',
}))

const duelMock = vi.fn()
const rpcMock = vi.fn()
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  duel: (...a: unknown[]) => duelMock(...a),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: true } }),
}))

// ---- 가짜 게임 화면
let boardMissing = false
vi.mock('../../games/ui.ts', () => ({
  getDuelComponent: () =>
    boardMissing
      ? undefined
      : (p: { onAction(a: unknown): void; toMove: number | null }) => (
          <div>
            <p>보드 {String(p.toMove)}</p>
            <button onClick={() => p.onAction({ type: 'roll', keep: [] })}>둔다</button>
          </div>
        ),
}))

import { ApiError, type DuelView } from '../../lib/api.ts'
import { resetServerTime } from '../../lib/serverTime.ts'
import { DuelMatchPage } from './DuelMatchPage.tsx'

function dv(over: Partial<DuelView> = {}): DuelView {
  return {
    match_id: 'm1', game_id: 'yacht', options: {}, rated: true, visibility: 'public', status: 'active',
    turn_seconds: 60,
    players: [{ id: 'u1', handle: 'kane', rating: 1000 }, { id: 'u2', handle: 'son', rating: 1010 }],
    my_seat: 0, to_move: 0, action_no: 0,
    turn_deadline: new Date(Date.now() + 60_000).toISOString(), server_now: Date.now(),
    view: {}, winner: null, end_reason: null, final_scores: null, ...over,
  }
}

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname}</p>
}

let nav: NavigateFunction | null = null
function Nav() {
  nav = useNavigate()
  return null
}

function renderAt(path = '/duel/m1', state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/duel/:id" element={<DuelMatchPage />} />
        <Route path="*" element={<p>다른 화면</p>} />
      </Routes>
      <Where />
      <Nav />
    </MemoryRouter>,
  )
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const calls = (action: string) => duelMock.mock.calls.filter((c) => (c[0] as { action: string }).action === action)

let current: DuelView
beforeEach(() => {
  vi.useFakeTimers()
  resetServerTime()
  duelMock.mockReset()
  rpcMock.mockReset()
  removeChannel.mockClear()
  channelMock.mockClear()
  broadcastHandler = null
  subscribeStatus = 'SUBSCRIBED'
  channelThrows = false
  boardMissing = false
  current = dv()
  duelMock.mockImplementation(async (b: { action: string }) => {
    if (b.action === 'view') return current
    throw new Error(`unexpected ${b.action}`)
  })
})
afterEach(() => { vi.useRealTimers() })

test('match_my_turn_only', async () => {
  current = dv({ to_move: 1 })
  renderAt()
  await flush()
  expect(screen.getByText('상대 차례')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '둔다' }))
  await flush()
  expect(calls('move')).toHaveLength(0)

  // 내 차례가 되면 expected_action_no와 함께 보낸다
  current = dv({ to_move: 0, action_no: 3 })
  await advance(5000)
  expect(screen.getByText('내 차례')).toBeInTheDocument()
  duelMock.mockImplementationOnce(async () => dv({ to_move: 0, action_no: 4 }))
  fireEvent.click(screen.getByRole('button', { name: '둔다' }))
  await flush()
  expect(calls('move')).toEqual([[{ action: 'move', match_id: 'm1', expected_action_no: 3, payload: { type: 'roll', keep: [] } }]])
})

test('board placeholder when the game screen is not ready', async () => {
  boardMissing = true
  renderAt()
  await flush()
  expect(screen.getByText('준비 중인 게임이에요')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '기권' })).toBeInTheDocument()
})

test('match_tick_once_per_deadline', async () => {
  const deadline = new Date(Date.now() + 2000).toISOString()
  current = dv({ turn_deadline: deadline, to_move: 1 })
  const pending = new Promise<never>(() => {})
  duelMock.mockImplementation(async (b: { action: string }) => {
    if (b.action === 'view') return { ...current, server_now: Date.now() }
    if (b.action === 'tick') return pending
    throw new Error(b.action)
  })
  renderAt()
  await flush()
  expect(calls('tick')).toHaveLength(0)
  await advance(3000)
  expect(calls('tick')).toEqual([[{ action: 'tick', match_id: 'm1' }]])
  await advance(20_000)
  expect(calls('tick')).toHaveLength(1)
})

test('match_tick: 409 not_due waits for a new deadline, silently', async () => {
  const deadline = new Date(Date.now() + 1000).toISOString()
  current = dv({ turn_deadline: deadline, to_move: 1 })
  duelMock.mockImplementation(async (b: { action: string }) => {
    if (b.action === 'view') return { ...current, server_now: Date.now() }
    if (b.action === 'tick') throw new ApiError('not_due', 409, { error: 'not_due', view: { ...current, server_now: Date.now() } })
    throw new Error(b.action)
  })
  renderAt()
  await flush()
  await advance(2000)
  expect(calls('tick')).toHaveLength(1)
  await advance(20_000)
  expect(calls('tick')).toHaveLength(1)
  expect(screen.queryByRole('alert')).toBeNull()

  // 마감이 바뀌고 그 마감도 지나면 다시 한 번
  current = dv({ turn_deadline: new Date(Date.now() + 3000).toISOString(), to_move: 1, action_no: 2 })
  await advance(5000)
  await advance(3000)
  expect(calls('tick')).toHaveLength(2)
})

test('match_polls_without_realtime', async () => {
  // Realtime을 아예 쓸 수 없어도(채널 생성이 던짐) 5초 폴링으로 진행된다
  channelThrows = true
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { unmount } = renderAt()
  await flush()
  expect(channelMock).toHaveBeenCalledWith('duel:m1')
  expect(warn).toHaveBeenCalled()
  expect(calls('view')).toHaveLength(1)
  current = dv({ to_move: 1, action_no: 1 })
  await advance(5000)
  expect(calls('view')).toHaveLength(2)
  expect(screen.getByText('상대 차례')).toBeInTheDocument()
  await advance(5000)
  expect(calls('view')).toHaveLength(3)
  unmount()
  await advance(20_000)
  expect(calls('view')).toHaveLength(3)
  expect(removeChannel).not.toHaveBeenCalled()
  warn.mockRestore()
})

test('match_polls_when_subscribe_reports_error; broadcast triggers a view', async () => {
  subscribeStatus = 'CHANNEL_ERROR'
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { unmount } = renderAt()
  await flush()
  expect(warn).toHaveBeenCalledWith('duel: realtime', 'CHANNEL_ERROR')
  expect(calls('view')).toHaveLength(1)
  await advance(5000)
  expect(calls('view')).toHaveLength(2)
  await advance(5000)
  expect(calls('view')).toHaveLength(3)
  warn.mockRestore()
  // 신호가 오면 바로 다시 읽는다
  await act(async () => { broadcastHandler?.() ; await vi.advanceTimersByTimeAsync(0) })
  expect(calls('view')).toHaveLength(4)
  unmount()
  expect(removeChannel).toHaveBeenCalledTimes(1)
  await advance(20_000)
  expect(calls('view')).toHaveLength(4)
})

test('match_resign_two_step', async () => {
  renderAt()
  await flush()
  fireEvent.click(screen.getByRole('button', { name: '기권' }))
  expect(screen.getByRole('button', { name: '한 번 더 누르면 기권' })).toBeInTheDocument()
  expect(calls('resign')).toHaveLength(0)
  await advance(3000)
  expect(screen.getByRole('button', { name: '기권' })).toBeInTheDocument()

  duelMock.mockImplementationOnce(async () => dv({ status: 'finished', winner: 1, end_reason: 'resign', to_move: null, turn_deadline: null }))
  fireEvent.click(screen.getByRole('button', { name: '기권' }))
  fireEvent.click(screen.getByRole('button', { name: '한 번 더 누르면 기권' }))
  await flush()
  expect(calls('resign')).toEqual([[{ action: 'resign', match_id: 'm1' }]])
  expect(screen.getByText('졌어요')).toBeInTheDocument()
})

test('match_result', async () => {
  current = dv({
    status: 'finished', winner: 0, end_reason: 'normal', final_scores: [200, 150], to_move: null, turn_deadline: null,
    players: [{ id: 'u1', handle: 'kane', rating: 1020 }, { id: 'u2', handle: 'son', rating: 990 }],
    rating_change: { before: 1000, after: 1020 },
  })
  renderAt()
  await flush()
  expect(screen.getByText('이겼어요')).toBeInTheDocument()
  expect(screen.getByText('200 : 150')).toBeInTheDocument()
  expect(screen.getByText(/1000 → 1020/)).toBeInTheDocument()

  duelMock.mockImplementation(async (b: { action: string; match_id?: string }) => {
    if (b.action === 'create') return { match_id: 'm2', invite_code: 'abcde12345' }
    if (b.action === 'view') return b.match_id === 'm2'
      ? dv({ match_id: 'm2', status: 'waiting', my_seat: null, to_move: null, turn_deadline: null, players: [{ id: 'u1', handle: 'kane', rating: 1020 }] })
      : current
    throw new Error(b.action)
  })
  fireEvent.click(screen.getByRole('button', { name: '재대결' }))
  await flush()
  expect(calls('create')).toEqual([[{ action: 'create', game_id: 'yacht', options: {}, rated: true, visibility: 'invite', turn_seconds: 60 }]])
  expect(screen.getByTestId('where')).toHaveTextContent('/duel/m2')
  await flush()
  expect(screen.getByDisplayValue(`${location.origin}/duel/join/abcde12345`)).toBeInTheDocument()
})

test('match_waiting_invite', async () => {
  current = dv({ status: 'waiting', my_seat: null, to_move: null, turn_deadline: null, players: [{ id: 'u1', handle: 'kane', rating: 1000 }] })
  rpcMock.mockResolvedValue('abcde12345')
  renderAt()
  await flush()
  await flush()
  expect(rpcMock).toHaveBeenCalledWith('duel_invite_code', { p_match: 'm1' })
  expect(screen.getByDisplayValue(`${location.origin}/duel/join/abcde12345`)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '복사' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '기권' })).toBeNull()

  duelMock.mockImplementationOnce(async () => ({ ...current, status: 'void', end_reason: 'void' }))
  fireEvent.click(screen.getByRole('button', { name: '대국 취소' }))
  await flush()
  expect(calls('cancel')).toEqual([[{ action: 'cancel', match_id: 'm1' }]])
  expect(screen.getByText('무효가 된 대국이에요')).toBeInTheDocument()
})

test('409 with a view re-renders silently; version_changed shows its message', async () => {
  renderAt()
  await flush()
  duelMock.mockImplementationOnce(async () => {
    throw new ApiError('stale', 409, { error: 'stale', view: dv({ to_move: 1, action_no: 5 }) })
  })
  fireEvent.click(screen.getByRole('button', { name: '둔다' }))
  await flush()
  expect(screen.getByText('상대 차례')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()

  current = dv({ to_move: 0, action_no: 6 })
  await advance(5000)
  duelMock.mockImplementationOnce(async () => {
    throw new ApiError('version_changed', 409, { error: 'version_changed', view: dv({ status: 'void', end_reason: 'void', action_no: 6, to_move: null, turn_deadline: null }) })
  })
  fireEvent.click(screen.getByRole('button', { name: '둔다' }))
  await flush()
  expect(screen.getByText('규칙이 바뀌어 이 대국은 무효가 됐어요')).toBeInTheDocument()
})

test('not a participant shows an error with a link to the duel tab', async () => {
  duelMock.mockImplementation(async () => { throw new ApiError('not_player', 403, { error: 'not_player' }) })
  renderAt()
  await flush()
  expect(screen.getByText('참가한 대국이 아니에요')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '대전 탭으로' })).toHaveAttribute('href', '/duel')
})

type Deferred<T> = { promise: Promise<T>; resolve(v: T): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

test('late view with a lower action_no does not undo a move response', async () => {
  current = dv({ to_move: 0, action_no: 3 })
  renderAt()
  await flush()
  expect(screen.getByText('내 차례')).toBeInTheDocument()
  const slow = deferred<DuelView>()
  duelMock.mockImplementation(async (b: { action: string }) => {
    if (b.action === 'view') return slow.promise
    if (b.action === 'move') return dv({ to_move: 1, action_no: 4 })
    throw new Error(b.action)
  })
  await advance(5000) // 폴링 view가 걸려 있는 동안
  expect(calls('view')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '둔다' }))
  await flush()
  expect(screen.getByText('상대 차례')).toBeInTheDocument()
  // 수를 두기 전에 읽은 옛 화면이 늦게 도착
  await act(async () => { slow.resolve(dv({ to_move: 0, action_no: 3 })); await vi.advanceTimersByTimeAsync(0) })
  expect(screen.getByText('상대 차례')).toBeInTheDocument()
  expect(screen.getByText('보드 1')).toBeInTheDocument()
})

test('switching match: old channel removed, new one subscribed, late old view ignored', async () => {
  const m1Slow = deferred<DuelView>()
  let m1Calls = 0
  duelMock.mockImplementation(async (b: { action: string; match_id: string }) => {
    if (b.action !== 'view') throw new Error(b.action)
    if (b.match_id === 'm1') {
      m1Calls += 1
      return m1Calls === 1 ? dv({ to_move: 0 }) : m1Slow.promise
    }
    return dv({ match_id: 'm2', to_move: 1, players: [{ id: 'u1', handle: 'kane', rating: 1000 }, { id: 'u9', handle: 'park', rating: 1200 }] })
  })
  renderAt()
  await flush()
  expect(screen.getByText('son')).toBeInTheDocument()
  await advance(5000) // m1 view 하나가 걸려 있다
  expect(m1Calls).toBe(2)
  await act(async () => { nav!('/duel/m2'); await vi.advanceTimersByTimeAsync(0) })
  expect(removeChannel).toHaveBeenCalledTimes(1)
  expect(channelMock).toHaveBeenLastCalledWith('duel:m2')
  expect(screen.getByText('park')).toBeInTheDocument()
  await act(async () => { m1Slow.resolve(dv({ to_move: 0, action_no: 9 })); await vi.advanceTimersByTimeAsync(0) })
  expect(screen.getByText('park')).toBeInTheDocument()
  expect(screen.queryByText('son')).toBeNull()
  expect(screen.getByText('상대 차례')).toBeInTheDocument()
})

test('slow view: no overlapping view calls, one rerun after it finishes', async () => {
  const slow = deferred<DuelView>()
  duelMock.mockImplementation(async (b: { action: string }) => {
    if (b.action === 'view') return calls('view').length === 1 ? slow.promise : current
    throw new Error(b.action)
  })
  renderAt()
  await flush()
  await advance(12_000) // 폴링 두 번 + 신호
  await act(async () => { broadcastHandler?.(); await vi.advanceTimersByTimeAsync(0) })
  expect(calls('view')).toHaveLength(1)
  await act(async () => { slow.resolve(current); await vi.advanceTimersByTimeAsync(0) })
  await flush()
  expect(calls('view')).toHaveLength(2)
  expect(screen.getByText('내 차례')).toBeInTheDocument()
})

test('no early tick when the browser clock runs ahead of the server', async () => {
  // 서버 시계가 브라우저보다 10초 느리다. 마감은 서버 기준 5초 뒤(브라우저 기준으로는 이미 지난 시각)
  const skew = -10_000
  const deadline = new Date(Date.now() + skew + 5000).toISOString()
  current = dv({ turn_deadline: deadline, to_move: 1 })
  duelMock.mockImplementation(async (b: { action: string }) => {
    if (b.action === 'view') return { ...current, server_now: Date.now() + skew }
    if (b.action === 'tick') return new Promise<never>(() => {})
    throw new Error(b.action)
  })
  renderAt()
  await flush()
  await advance(3000)
  expect(calls('tick')).toHaveLength(0)
  await advance(3000)
  expect(calls('tick')).toHaveLength(1)
})

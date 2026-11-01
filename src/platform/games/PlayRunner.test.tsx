import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const playMock = vi.fn()
const submitMock = vi.fn(async () => {})
vi.mock('../../games/index.ts', async (orig) =>
  (await import('../../test-fixtures/registry.ts')).withTestGame(await orig()))
const burst = vi.hoisted(() => ({ on: false }))
vi.mock('../../games/ui.ts', async (orig) => {
  const base = (await import('../../test-fixtures/ui.ts')).withTestGameUi(await orig())
  return {
    ...base,
    getGameComponent: (id: string) => {
      const Real = base.getGameComponent(id)
      if (!burst.on || id !== 'test-guess' || !Real) return Real
      // 한 번의 클릭에서 onAction을 동기로 두 번 부르는 화면
      return (props: import('../../games/ui.ts').GameProps) => (
        <div>
          <Real {...props} />
          <button onClick={() => { props.onAction({ type: 'guess', value: 1 }); props.onAction({ type: 'guess', value: 2 }) }}>연속</button>
        </div>
      )
    },
  }
})
vi.mock('./seed.ts', async () => {
  const actual = await vi.importActual<typeof import('./seed.ts')>('./seed.ts')
  return { ...actual, newSeed: () => new Uint8Array(16).fill(3) }
})
vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'http://x', supabaseKey: 'k' }))
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  play: (...a: unknown[]) => playMock(...a),
}))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: false } }),
}))
vi.mock('./freeQueue.ts', () => ({ submit: (...a: unknown[]) => (submitMock as (...x: unknown[]) => unknown)(...a) }))

import { ApiError, type PlayView } from '../../lib/api.ts'
import { PlayRunner } from './PlayRunner.tsx'
import { logic } from '../../test-fixtures/test-guess/logic.ts'
import { rngFromSeed } from '../../shared/rng.ts'

const emptyState = { guesses: [], feedback: [], hintUsed: false, parity: null, gaveUp: false }
function view(over: Partial<PlayView> = {}): PlayView {
  return {
    item_id: 'it1', contest_id: 'c1', game_id: 'test-guess', options: { range: '100' },
    public_state: emptyState, finished: false, score: null, action_count: 0,
    ends_at: new Date(Date.now() + 3_600_000).toISOString(), server_now: Date.now(), ...over,
  }
}
const stateWith = (guesses: number[], feedback: string[]) => ({ ...emptyState, guesses, feedback })

function guess(n: number) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: String(n) } })
  fireEvent.click(screen.getByRole('button', { name: '추측' }))
}

beforeEach(() => {
  playMock.mockReset()
  submitMock.mockClear()
})

test('server_mode_sends_expected_count', async () => {
  playMock.mockResolvedValueOnce(view({ action_count: 2, public_state: stateWith([10, 20], ['up', 'up']) }))
  render(<PlayRunner mode="server" itemId="it1" />)
  await screen.findByText('남은 기회 6')
  expect(playMock).toHaveBeenCalledWith({ action: 'open', item_id: 'it1' })
  playMock.mockResolvedValueOnce(view({ action_count: 3, public_state: stateWith([10, 20, 30], ['up', 'up', 'down']) }))
  guess(30)
  await waitFor(() => expect(playMock).toHaveBeenCalledTimes(2))
  expect(playMock).toHaveBeenLastCalledWith({
    action: 'act', item_id: 'it1', expected_count: 2, payload: { type: 'guess', value: 30 },
  })
  await screen.findByText('남은 기회 5')
})

test('double click sends only one act while busy', async () => {
  playMock.mockResolvedValueOnce(view())
  render(<PlayRunner mode="server" itemId="it1" />)
  await screen.findByRole('button', { name: '추측' })
  let resolve!: (v: PlayView) => void
  playMock.mockReturnValueOnce(new Promise<PlayView>((r) => { resolve = r }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '5' } })
  const btn = screen.getByRole('button', { name: '추측' })
  fireEvent.click(btn)
  fireEvent.click(btn)
  expect(playMock).toHaveBeenCalledTimes(2) // open + 1 act
  await act(async () => resolve(view({ action_count: 1, public_state: stateWith([5], ['up']) })))
})

test('stale_409_replaces_state_with_server_view', async () => {
  playMock.mockResolvedValueOnce(view())
  render(<PlayRunner mode="server" itemId="it1" />)
  await screen.findByText('남은 기회 8')
  const fresh = view({ action_count: 2, public_state: stateWith([40, 60], ['up', 'down']) })
  playMock.mockRejectedValueOnce(new ApiError('stale', 409, { error: 'stale', view: fresh }))
  guess(50)
  await screen.findByText('남은 기회 6')
  expect(screen.getByText('다른 화면에서 진행된 내용으로 갱신했어요')).toBeInTheDocument()
})

test('network_error_shows_retry_and_does_not_advance', async () => {
  playMock.mockResolvedValueOnce(view())
  render(<PlayRunner mode="server" itemId="it1" />)
  await screen.findByText('남은 기회 8')
  playMock.mockRejectedValueOnce(new ApiError('network', 0))
  guess(50)
  const retry = await screen.findByRole('button', { name: '다시 시도' })
  expect(screen.getByText('남은 기회 8')).toBeInTheDocument()
  playMock.mockResolvedValueOnce(view({ action_count: 1, public_state: stateWith([50], ['up']) }))
  fireEvent.click(retry)
  await screen.findByText('남은 기회 7')
  // 재시도는 같은 expected_count로 보낸다
  expect(playMock.mock.calls[2][0]).toMatchObject({ action: 'act', expected_count: 0, payload: { type: 'guess', value: 50 } })
  expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
})

test('ended_409_navigates_to_results', async () => {
  const onEnded = vi.fn()
  playMock.mockResolvedValueOnce(view())
  render(<PlayRunner mode="server" itemId="it1" onEnded={onEnded} />)
  await screen.findByText('남은 기회 8')
  playMock.mockRejectedValueOnce(new ApiError('ended', 409, { error: 'ended' }))
  guess(50)
  await waitFor(() => expect(onEnded).toHaveBeenCalled())
})

test('ended_409_without_handler_reopens_the_item', async () => {
  playMock.mockResolvedValueOnce(view())
  render(<PlayRunner mode="server" itemId="it1" />)
  await screen.findByText('남은 기회 8')
  playMock.mockRejectedValueOnce(new ApiError('ended', 409, { error: 'ended' }))
  // 실제 서버: 끝나지 않은 기록이라도 대회가 끝났으면 open은 finished: true와 정답을 준다.
  // score는 기록에 저장된 "지금 포기하면 받을 점수"다.
  playMock.mockResolvedValueOnce(view({
    finished: true, score: 0, action_count: 1, reveal: { answer: 77 }, public_state: stateWith([1], ['up']),
    ends_at: new Date(Date.now() - 1000).toISOString(),
  }))
  guess(50)
  await screen.findByText(/정답은 77/)
  expect(playMock.mock.calls[2][0]).toEqual({ action: 'open', item_id: 'it1' })
  expect(screen.queryByRole('button', { name: '추측' })).toBeNull()
})

test('ended_409_with_view_shows_answer_and_calls_handler', async () => {
  const onEnded = vi.fn()
  playMock.mockResolvedValueOnce(view())
  render(<PlayRunner mode="server" itemId="it1" onEnded={onEnded} />)
  await screen.findByText('남은 기회 8')
  const done = view({ finished: true, score: 0, reveal: { answer: 12 }, ends_at: new Date(Date.now() - 1000).toISOString() })
  playMock.mockRejectedValueOnce(new ApiError('ended', 409, { error: 'ended', view: done }))
  guess(50)
  await screen.findByText(/정답은 12/)
  expect(onEnded).toHaveBeenCalledTimes(1)
  expect(playMock).toHaveBeenCalledTimes(2) // 다시 열지 않는다
})

test('finished_409_with_view_shows_score_and_answer', async () => {
  playMock.mockResolvedValueOnce(view())
  render(<PlayRunner mode="server" itemId="it1" />)
  await screen.findByText('남은 기회 8')
  const done = view({ finished: true, score: 7, action_count: 2, reveal: { answer: 42 }, public_state: stateWith([30, 42], ['up', 'hit']) })
  playMock.mockRejectedValueOnce(new ApiError('finished', 409, { error: 'finished', view: done }))
  guess(50)
  await screen.findByText(/정답은 42/)
  expect(screen.getByText('7점')).toBeInTheDocument()
  expect(screen.getByText('이미 끝낸 문제예요')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '추측' })).toBeNull()
})

test('version_changed_409_shows_notice', async () => {
  playMock.mockResolvedValueOnce(view())
  render(<PlayRunner mode="server" itemId="it1" />)
  await screen.findByText('남은 기회 8')
  const done = view({ finished: true, score: 3, public_state: null, action_count: 3 })
  playMock.mockRejectedValueOnce(new ApiError('version_changed', 409, { error: 'version_changed', view: done }))
  guess(50)
  await screen.findByText('규칙이 바뀌어 이 문제는 종료됐어요')
  expect(screen.queryByRole('button', { name: '추측' })).toBeNull()
})

test('invalid_action_shows_message_and_refreshes_view', async () => {
  playMock.mockResolvedValueOnce(view())
  render(<PlayRunner mode="server" itemId="it1" />)
  await screen.findByText('남은 기회 8')
  playMock.mockRejectedValueOnce(new ApiError('invalid_action', 400, { error: 'invalid_action', message: '이미 힌트를 썼어요' }))
  // 응답을 놓친 힌트가 서버에는 반영돼 있었다
  playMock.mockResolvedValueOnce(view({ action_count: 1, public_state: { ...emptyState, hintUsed: true, parity: 'even' } }))
  fireEvent.click(screen.getByRole('button', { name: '힌트 (-1점)' }))
  await screen.findByText('이미 힌트를 썼어요')
  await screen.findByText('힌트: 정답은 짝수예요')
  expect(playMock.mock.calls[2][0]).toEqual({ action: 'open', item_id: 'it1' })
  expect(screen.getByText('이미 힌트를 썼어요')).toBeInTheDocument()
})

test('local_mode_submits_free_play_on_finish', async () => {
  const answer = (logic.pickPuzzle(rngFromSeed(new Uint8Array(16).fill(3)), { range: '100' }) as { answer: number }).answer
  render(<PlayRunner mode="local" gameId="test-guess" options={{ range: '100' }} />)
  await screen.findByText('남은 기회 8')
  guess(answer)
  await screen.findByText(new RegExp(`정답은 ${answer}`))
  expect(submitMock).toHaveBeenCalledTimes(1)
  expect(submitMock).toHaveBeenCalledWith(expect.objectContaining({
    user_id: 'u1', game_id: 'test-guess', options: { range: '100' },
    logic_version: logic.version, solved: true, score: 10, action_count: 1,
    client_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
  }))
  expect(submitMock.mock.calls[0]).not.toContain('played_at')
})

test('local_mode_applies_sync_actions_in_order', async () => {
  burst.on = true
  try {
    render(<PlayRunner mode="local" gameId="test-guess" options={{ range: '100' }} />)
    await screen.findByText('남은 기회 8')
    fireEvent.click(screen.getByRole('button', { name: '연속' }))
    await screen.findByText('남은 기회 6')
  } finally {
    burst.on = false
  }
})

test('timeout_409_shows_result_and_notice', async () => {
  playMock.mockResolvedValueOnce(view())
  render(<PlayRunner mode="server" itemId="it1" />)
  await screen.findByText('남은 기회 8')
  const done = view({ finished: true, score: 0, reveal: { answer: 42 } })
  playMock.mockRejectedValueOnce(new ApiError('timeout', 409, { error: 'timeout', view: done }))
  guess(50)
  await screen.findByText('제한 시간이 끝났어요')
})

test('timer_reaching_zero_reopens_once_and_shows_notice', async () => {
  playMock.mockResolvedValueOnce(view({ ends_at: new Date(Date.now() + 1500).toISOString() }))
  render(<PlayRunner mode="server" itemId="it1" />)
  await screen.findByText('남은 기회 8')
  playMock.mockResolvedValue(view({ finished: true, score: 0, reveal: { answer: 42 }, ends_at: new Date(Date.now()).toISOString() }))
  await screen.findByText('제한 시간이 끝났어요', {}, { timeout: 4000 })
  expect(playMock).toHaveBeenCalledTimes(2)
  expect(playMock).toHaveBeenLastCalledWith({ action: 'open', item_id: 'it1' })
})

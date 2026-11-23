import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'http://x', supabaseKey: 'k' }))
const duelMock = vi.fn()
const rpcMock = vi.fn()
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  duel: (...a: unknown[]) => duelMock(...a),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: false } }),
}))

const refreshMock = vi.fn(async () => {})
vi.mock('../wallet/useWallet.ts', async (orig) => ({
  ...(await orig<typeof import('../wallet/useWallet.ts')>()),
  refreshWallet: () => refreshMock(),
}))

import { ApiError } from '../../lib/api.ts'
import { fireEvent } from '@testing-library/react'
import { resetWallet, setWallet } from '../../lib/walletStore.ts'
import { DuelJoinPage } from './DuelJoinPage.tsx'

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname}</p>
}

function renderJoin(code = 'abcde12345') {
  return render(
    <MemoryRouter initialEntries={[`/duel/join/${code}`]}>
      <Routes>
        <Route path="/duel/join/:code" element={<DuelJoinPage />} />
        <Route path="*" element={<p>다른 화면</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  )
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

beforeEach(() => {
  vi.useFakeTimers()
  duelMock.mockReset()
  rpcMock.mockReset()
  refreshMock.mockClear()
  resetWallet()
})
afterEach(() => { vi.useRealTimers() })

test('join_page_states: success goes to the match', async () => {
  duelMock.mockResolvedValue({ match_id: 'm1', status: 'active' })
  renderJoin()
  await flush()
  expect(duelMock).toHaveBeenCalledTimes(1)
  // 판돈 0으로 먼저 들어가 본다. 판돈 대국이면 서버가 stake_mismatch로 실제 판돈을 알려 준다
  expect(duelMock).toHaveBeenCalledWith({ action: 'join', code: 'abcde12345', stake: 0 })
  expect(refreshMock).not.toHaveBeenCalled()
  expect(screen.getByTestId('where')).toHaveTextContent('/duel/m1')
})

test('join_page_states: full shows a message and a duel tab link', async () => {
  duelMock.mockRejectedValue(new ApiError('full', 409, { error: 'full' }))
  renderJoin()
  await flush()
  expect(screen.getByText('이미 시작된 대국이에요')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '대전 탭으로' })).toHaveAttribute('href', '/duel')
  expect(screen.getByTestId('where')).toHaveTextContent('/duel/join/abcde12345')
})

test('join_page_states: own_match goes to that match', async () => {
  duelMock.mockRejectedValue(new ApiError('own_match', 409, { error: 'own_match', match_id: 'w2' }))
  renderJoin()
  await flush()
  expect(rpcMock).not.toHaveBeenCalled()
  expect(screen.getByTestId('where')).toHaveTextContent('/duel/w2')
})

test('join_page_states: other errors show message and retry', async () => {
  duelMock.mockRejectedValue(new ApiError('not_found', 404, { error: 'not_found' }))
  renderJoin()
  await flush()
  expect(screen.getByText('없는 대국이에요')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
})

// ---------------------------------------------------------------- 판돈 (지갑 4단계)
const mismatch = (stake: number) => new ApiError('stake_mismatch', 409, { error: 'stake_mismatch', stake })

test('join_page_stake: confirm screen, then join with that stake', async () => {
  setWallet({ balance: 5000, today: {}, earnedToday: 0 })
  duelMock.mockRejectedValueOnce(mismatch(1000))
  duelMock.mockResolvedValueOnce({ match_id: 'm3', status: 'active' })
  renderJoin()
  await flush()
  expect(screen.getByText('판돈 1,000 G를 걸고 참가할까요?')).toBeInTheDocument()
  expect(screen.getByText(/내 골드 5,000 G/)).toBeInTheDocument()
  expect(screen.getByText(/이기면 2,000 G를 받아요/)).toBeInTheDocument()
  expect(screen.getByTestId('where')).toHaveTextContent('/duel/join/abcde12345')
  fireEvent.click(screen.getByRole('button', { name: '참가' }))
  await flush()
  expect(duelMock).toHaveBeenLastCalledWith({ action: 'join', code: 'abcde12345', stake: 1000 })
  expect(screen.getByTestId('where')).toHaveTextContent('/duel/m3')
  expect(refreshMock).toHaveBeenCalled()
})

test('join_page_stake: not enough gold disables join', async () => {
  setWallet({ balance: 500, today: {}, earnedToday: 0 })
  duelMock.mockRejectedValueOnce(mismatch(1000))
  renderJoin()
  await flush()
  expect(screen.getByText('골드가 부족해요')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '참가' })).toBeDisabled()
})

test('join_page_stake: cancel goes back to the duel tab', async () => {
  duelMock.mockRejectedValueOnce(mismatch(1000))
  renderJoin()
  await flush()
  fireEvent.click(screen.getByRole('link', { name: '취소' }))
  expect(screen.getByTestId('where')).toHaveTextContent('/duel')
  expect(duelMock).toHaveBeenCalledTimes(1)
})

test('join_page_stake: server says not enough gold / stake changed again', async () => {
  duelMock.mockRejectedValueOnce(mismatch(1000))
  duelMock.mockRejectedValueOnce(new ApiError('not_enough_gold', 409, { error: 'not_enough_gold' }))
  renderJoin()
  await flush()
  fireEvent.click(screen.getByRole('button', { name: '참가' }))
  await flush()
  expect(screen.getByRole('alert')).toHaveTextContent('골드가 부족해요')
  // 판돈이 또 다르면 최신 판돈으로 확인 화면을 다시 보여 준다
  duelMock.mockRejectedValueOnce(mismatch(2000))
  fireEvent.click(screen.getByRole('button', { name: '참가' }))
  await flush()
  expect(screen.getByText('판돈 2,000 G를 걸고 참가할까요?')).toBeInTheDocument()
})

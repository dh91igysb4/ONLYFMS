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

import { ApiError } from '../../lib/api.ts'
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
})
afterEach(() => { vi.useRealTimers() })

test('join_page_states: success goes to the match', async () => {
  duelMock.mockResolvedValue({ match_id: 'm1', status: 'active' })
  renderJoin()
  await flush()
  expect(duelMock).toHaveBeenCalledTimes(1)
  expect(duelMock).toHaveBeenCalledWith({ action: 'join', code: 'abcde12345' })
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
  duelMock.mockRejectedValue(new ApiError('own_match', 409, { error: 'own_match' }))
  rpcMock.mockImplementation(async (name: string, args?: { p_match: string }) => {
    if (name === 'duel_list') {
      return {
        lobby: [], recent: [], due: [],
        mine: [
          { id: 'w1', status: 'waiting', players: [{ id: 'u1', handle: 'kane', rating: 1000 }] },
          { id: 'w2', status: 'waiting', players: [{ id: 'u1', handle: 'kane', rating: 1000 }] },
        ],
      }
    }
    if (name === 'duel_invite_code') return args?.p_match === 'w2' ? 'abcde12345' : 'zzzzz00000'
    throw new Error(name)
  })
  renderJoin()
  await flush()
  await flush()
  expect(screen.getByTestId('where')).toHaveTextContent('/duel/w2')
})

test('join_page_states: other errors show message and retry', async () => {
  duelMock.mockRejectedValue(new ApiError('not_found', 404, { error: 'not_found' }))
  renderJoin()
  await flush()
  expect(screen.getByText('없는 대국이에요')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
})

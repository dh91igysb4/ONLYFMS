import { fireEvent, render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const upsert = vi.fn(async () => ({ error: null }))
vi.mock('../../lib/supabase.ts', () => ({
  supabase: { from: () => ({ upsert: (...a: unknown[]) => (upsert as (...x: unknown[]) => unknown)(...a) }), auth: { signOut: vi.fn() } },
}))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: false } }),
}))

import { Layout } from './Layout.tsx'
import { resetFreeQueue } from '../games/freeQueue.ts'

const row = {
  client_id: 'q1', user_id: 'u1', game_id: 'number-guess', options: {},
  logic_version: 1, solved: true, score: 5, action_count: 3,
}

beforeEach(() => {
  upsert.mockClear()
  localStorage.clear()
  resetFreeQueue()
  localStorage.setItem('onlyfms:freeQueue', JSON.stringify([row]))
})

function mount() {
  return render(
    <MemoryRouter initialEntries={['/leaderboard']}>
      <Routes><Route element={<Layout />}><Route path="/leaderboard" element={<p>lb</p>} /></Route></Routes>
    </MemoryRouter>,
  )
}

test('layout flushes the free-play queue on mount even on a non-Home route', async () => {
  mount()
  await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1))
  expect((upsert.mock.calls[0] as unknown[])[0]).toMatchObject({ client_id: 'q1' })
})

test('layout flushes again on the online event', async () => {
  mount()
  await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1))
  localStorage.setItem('onlyfms:freeQueue', JSON.stringify([{ ...row, client_id: 'q2' }]))
  fireEvent(window, new Event('online'))
  await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(2))
  expect((upsert.mock.calls[1] as unknown[])[0]).toMatchObject({ client_id: 'q2' })
})

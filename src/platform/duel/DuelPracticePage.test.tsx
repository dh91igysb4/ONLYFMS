import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'http://x', supabaseKey: 'k' }))
let admin = true
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: admin } }),
}))
let pc = true
vi.mock('./pcOnly.ts', () => ({ isPcCapable: () => pc }))
vi.mock('../../games/index.ts', async (orig) =>
  (await import('../../test-fixtures/duel.ts')).withRealtimeDuel(await orig<typeof import('../../games/index.ts')>()))
const onExitSeen = vi.hoisted(() => ({ fn: null as null | (() => void) }))
vi.mock('../../games/ui.ts', async (orig) => {
  const real = await orig<typeof import('../../games/ui.ts')>()
  const Fake = ({ mode, onExit }: { mode: string; onExit(): void }) => {
    onExitSeen.fn = onExit
    return <p data-testid="race">race {mode}</p>
  }
  return { ...real, getRealtimeComponent: (id: string) => (id === 'realtime-duel' ? Fake : real.getRealtimeComponent(id)) }
})

import { DuelPracticePage } from './DuelPracticePage.tsx'

function renderAt(game: string) {
  return render(
    <MemoryRouter initialEntries={[`/duel/practice/${game}`]}>
      <Routes>
        <Route path="/duel/practice/:game" element={<DuelPracticePage />} />
        <Route path="/duel" element={<p>대전 홈</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  cleanup()
  admin = true
  pc = true
})

test('admin on a PC sees the realtime game in practice mode', () => {
  renderAt('realtime-duel')
  expect(screen.getByTestId('race').textContent).toBe('race practice')
})

test('hidden realtime game is not found for non-admins', () => {
  admin = false
  renderAt('realtime-duel')
  expect(screen.getByText('없는 게임이에요')).toBeTruthy()
  expect(screen.queryByTestId('race')).toBeNull()
})

test('touch-only device sees the PC notice', () => {
  pc = false
  renderAt('realtime-duel')
  expect(screen.getByText('PC에서만 할 수 있어요')).toBeTruthy()
  expect(screen.queryByTestId('race')).toBeNull()
})

test('turn-based duel has no practice page', () => {
  renderAt('yacht')
  expect(screen.getByText('없는 게임이에요')).toBeTruthy()
})

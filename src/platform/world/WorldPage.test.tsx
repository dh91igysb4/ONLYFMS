import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
let admin = true
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: admin } }),
}))

const HIDDEN_ID = 'hidden-world'
vi.mock('../../games/index.ts', async (orig) => {
  const fx = await import('../../test-fixtures/world.ts')
  const real = fx.withTestWorld(await orig<typeof import('../../games/index.ts')>())
  const hidden = { ...fx.testWorld, manifest: { ...fx.testWorld.manifest, id: 'hidden-world', hidden: true } }
  return { ...real, getWorld: (id: string) => (id === 'hidden-world' ? hidden : real.getWorld(id)) }
})
vi.mock('../../games/ui.ts', async (orig) => {
  const fx = await import('../../test-fixtures/world.ts')
  const Fake = ({ gameId }: { gameId: string }) => <p>fake:{gameId}</p>
  const real = fx.withTestWorldUi(await orig<typeof import('../../games/ui.ts')>(), Fake)
  return { ...real, getWorldComponent: (id: string) => real.getWorldComponent(id === 'hidden-world' ? fx.TEST_WORLD_ID : id) }
})

import { WorldPage } from './WorldPage.tsx'

beforeEach(() => { cleanup(); admin = true })

function renderAt(game: string) {
  return render(
    <MemoryRouter initialEntries={[`/world/${game}`]}>
      <Routes><Route path="/world/:game" element={<WorldPage />} /></Routes>
    </MemoryRouter>,
  )
}

test('renders the registered component with its gameId and the manifest name', () => {
  renderAt('test-world')
  expect(screen.getByRole('heading', { name: '테스트 월드' })).toBeInTheDocument()
  expect(screen.getByText('fake:test-world')).toBeInTheDocument()
})

test('unknown game', () => {
  renderAt('nope')
  expect(screen.getByText('없는 게임이에요')).toBeInTheDocument()
})

test('hidden world shows only to admins', () => {
  renderAt(HIDDEN_ID)
  expect(screen.getByText('fake:hidden-world')).toBeInTheDocument()
  cleanup()
  admin = false
  renderAt(HIDDEN_ID)
  expect(screen.getByText('없는 게임이에요')).toBeInTheDocument()
  expect(screen.queryByText('fake:hidden-world')).toBeNull()
})

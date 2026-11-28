import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../lib/supabase.ts', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  supabaseUrl: 'x',
  supabaseKey: 'k',
}))
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
  const { world } = await import('../../lib/api.ts')
  const Fake = ({ gameId, onOpenGames }: { gameId: string; onOpenGames?: () => void }) => (
    <div>
      <p>fake:{gameId}</p>
      <button onClick={() => onOpenGames?.()}>게임 목록</button>
      <button onClick={() => { void world({ game: gameId, action: 'act', payload: {} }) }}>행동</button>
    </div>
  )
  const real = fx.withTestWorldUi(await orig<typeof import('../../games/ui.ts')>(), Fake)
  return { ...real, getWorldComponent: (id: string) => real.getWorldComponent(id === 'hidden-world' ? fx.TEST_WORLD_ID : id) }
})

import { WorldPage } from './WorldPage.tsx'

beforeEach(() => { cleanup(); admin = true })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function stubWorld(body: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
}

function renderAt(game: string) {
  return render(
    <MemoryRouter initialEntries={[`/world/${game}`]}>
      <Routes><Route path="/world/:game" element={<WorldPage />} /><Route path="/games" element={<p>게임 목록 화면</p>} /></Routes>
    </MemoryRouter>,
  )
}

test('renders the registered component with its gameId and the manifest name', () => {
  renderAt('test-world')
  expect(screen.getByRole('heading', { name: '테스트 월드' })).toBeInTheDocument()
  // 탭과 겹치는 큰 제목은 숨긴다(폰에서 캔버스가 쓸 높이를 늘린다)
  expect(screen.getByRole('heading', { name: '테스트 월드' }).className).toContain('sr-only')
  expect(screen.getByText('fake:test-world')).toBeInTheDocument()
})

test('게임 화면이 onOpenGames를 부르면 /games로 간다', () => {
  renderAt('test-world')
  fireEvent.click(screen.getByRole('button', { name: '게임 목록' }))
  expect(screen.getByText('게임 목록 화면')).toBeInTheDocument()
})

test('unknown game', () => {
  renderAt('nope')
  expect(screen.getByText('없는 게임이에요')).toBeInTheDocument()
  expect(document.documentElement).not.toHaveClass('game-screen')
})

test('marks the page as a game screen (no text selection) only while the game is shown', () => {
  const { unmount } = renderAt('test-world')
  expect(screen.getByText('fake:test-world')).toBeInTheDocument()
  expect(document.documentElement).toHaveClass('game-screen')
  unmount()
  expect(document.documentElement).not.toHaveClass('game-screen')
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

const CAP_TEXT = '오늘 골드 상한을 넘어 일부만 들어왔어요 (+800 G / +1,000 G)'

test('world 응답에 gold_capped가 있으면 상한 알림을 3초 보여 준다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  stubWorld({ view: {}, result: null, server_now: 1, gold: 30800, gold_capped: { asked: 1000, got: 800 } })
  renderAt('test-world')
  fireEvent.click(screen.getByRole('button', { name: '행동' }))
  const toast = await screen.findByRole('status')
  expect(toast).toHaveTextContent(CAP_TEXT)
  act(() => { vi.advanceTimersByTime(2900) })
  expect(screen.getByRole('status')).toBeInTheDocument()
  act(() => { vi.advanceTimersByTime(200) })
  expect(screen.queryByRole('status')).toBeNull()
})

test('gold_capped가 없으면 알림이 없다', async () => {
  const f = vi.fn(async () => new Response(JSON.stringify({ view: {}, result: null, server_now: 1, gold: 5 }), { status: 200 }))
  vi.stubGlobal('fetch', f)
  renderAt('test-world')
  fireEvent.click(screen.getByRole('button', { name: '행동' }))
  await vi.waitFor(() => expect(f).toHaveBeenCalled())
  await act(async () => { await Promise.resolve() })
  expect(screen.queryByRole('status')).toBeNull()
})

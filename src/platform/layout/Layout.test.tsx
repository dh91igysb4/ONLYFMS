import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const upsert = vi.fn(async () => ({ error: null }))
const signOut = vi.hoisted(() => vi.fn(async () => ({ error: null })))
vi.mock('../../lib/supabase.ts', () => ({
  supabase: { from: () => ({ upsert: (...a: unknown[]) => (upsert as (...x: unknown[]) => unknown)(...a) }), auth: { signOut } },
}))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: false } }),
}))

import { Layout } from './Layout.tsx'
import { resetFreeQueue } from '../games/freeQueue.ts'

const row = {
  client_id: 'q1', user_id: 'u1', game_id: 'test-guess', options: {},
  logic_version: 1, solved: true, score: 5, action_count: 3,
}

beforeEach(() => {
  upsert.mockClear()
  signOut.mockClear()
  localStorage.clear()
  resetFreeQueue()
  localStorage.setItem('onlyfms:freeQueue', JSON.stringify([row]))
})

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/leaderboard']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/leaderboard" element={<p>lb</p>} />
          <Route path="/u/:handle" element={<p>profile</p>} />
        </Route>
      </Routes>
      <Where />
    </MemoryRouter>,
  )
}

const where = () => screen.getByTestId('where').textContent
const menuButton = () => screen.getByRole('button', { name: 'kane 계정 메뉴' })

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

test('nav no longer has a 내 프로필 tab', () => {
  mount()
  const nav = screen.getByRole('navigation', { name: '주 메뉴' })
  expect(within(nav).queryByText('내 프로필')).toBeNull()
  expect(within(nav).getByText('리더보드')).toBeTruthy()
})

test('user menu opens and closes (Esc, outside click, toggle)', () => {
  mount()
  const btn = menuButton()
  expect(btn.getAttribute('aria-haspopup')).toBe('menu')
  expect(btn.getAttribute('aria-expanded')).toBe('false')
  expect(btn.textContent).toContain('kane')
  expect(screen.queryByRole('menu')).toBeNull()

  fireEvent.click(btn)
  expect(btn.getAttribute('aria-expanded')).toBe('true')
  const menu = screen.getByRole('menu')
  expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['내 프로필', '화면 설정', '로그아웃'])
  expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: '내 프로필' }))

  fireEvent.keyDown(menu, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(btn)

  fireEvent.click(btn)
  fireEvent.mouseDown(screen.getByText('lb'))
  expect(screen.queryByRole('menu')).toBeNull()

  fireEvent.click(btn)
  fireEvent.click(btn)
  expect(screen.queryByRole('menu')).toBeNull()
})

test('user menu arrow keys move focus', () => {
  mount()
  fireEvent.click(menuButton())
  const menu = screen.getByRole('menu')
  const items = within(menu).getAllByRole('menuitem')
  fireEvent.keyDown(menu, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(items[1])
  fireEvent.keyDown(menu, { key: 'ArrowUp' })
  fireEvent.keyDown(menu, { key: 'ArrowUp' })
  expect(document.activeElement).toBe(items[2])
})

test('menu 내 프로필 goes to /u/<handle> and closes', () => {
  mount()
  fireEvent.click(menuButton())
  fireEvent.click(screen.getByRole('menuitem', { name: '내 프로필' }))
  expect(where()).toBe('/u/kane')
  expect(screen.queryByRole('menu')).toBeNull()
})

test('menu 화면 설정 goes to the settings tab', () => {
  mount()
  fireEvent.click(menuButton())
  fireEvent.click(screen.getByRole('menuitem', { name: '화면 설정' }))
  expect(where()).toBe('/u/kane?tab=settings')
  expect(screen.queryByRole('menu')).toBeNull()
})

test('menu 로그아웃 signs out', () => {
  mount()
  fireEvent.click(menuButton())
  fireEvent.click(screen.getByRole('menuitem', { name: '로그아웃' }))
  expect(signOut).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('menu')).toBeNull()
})

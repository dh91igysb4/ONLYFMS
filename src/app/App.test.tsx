import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, test, expect, vi } from 'vitest'
import { setAuth } from '../platform/auth/testUtils.tsx'

vi.mock('../lib/supabase.ts', async () => (await import('../platform/auth/testUtils.tsx')).supabaseMock())

import { App } from './App.tsx'

beforeEach(() => window.history.pushState({}, '', '/'))

test('renders app shell title', async () => {
  setAuth(null, false) // 로그아웃 상태 → 로그인 화면
  render(<App />)
  expect(await screen.findByText('playONLYFMS')).toBeInTheDocument()
})

test('approved user sees layout nav and placeholder home', async () => {
  setAuth({ id: 'u1', handle: 'kane', status: 'approved', is_admin: false })
  render(<App />)
  expect(await screen.findByRole('heading', { name: '홈' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '내 프로필' })).toBeNull() // 탭 대신 오른쪽 위 메뉴
  fireEvent.click(screen.getByRole('button', { name: 'kane 계정 메뉴' }))
  expect(screen.getByRole('menuitem', { name: '내 프로필' })).toHaveAttribute('href', '/u/kane')
  expect(screen.queryByRole('link', { name: '관리자' })).toBeNull()
})

test('/games shows the game list', async () => {
  setAuth({ id: 'u1', handle: 'kane', status: 'approved', is_admin: false })
  window.history.pushState({}, '', '/games')
  render(<App />)
  expect(await screen.findByRole('heading', { name: '게임 목록' })).toBeInTheDocument()
})

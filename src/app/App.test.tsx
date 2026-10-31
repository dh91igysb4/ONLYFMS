import { render, screen } from '@testing-library/react'
import { beforeEach, test, expect, vi } from 'vitest'
import { setAuth } from '../platform/auth/testUtils.tsx'

vi.mock('../lib/supabase.ts', async () => (await import('../platform/auth/testUtils.tsx')).supabaseMock())

import { App } from './App.tsx'

beforeEach(() => window.history.pushState({}, '', '/'))

test('renders app shell title', async () => {
  setAuth(null, false) // 로그아웃 상태 → 로그인 화면
  render(<App />)
  expect(await screen.findByText('ONLYFMS')).toBeInTheDocument()
})

test('approved user sees layout nav and placeholder home', async () => {
  setAuth({ id: 'u1', handle: 'kane', status: 'approved', is_admin: false })
  render(<App />)
  expect(await screen.findByText('게임 목록')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '내 프로필' })).toHaveAttribute('href', '/u/kane')
  expect(screen.queryByRole('link', { name: '관리자' })).toBeNull()
})

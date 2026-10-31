import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { mocks, setAuth } from './testUtils.tsx'

vi.mock('../../lib/supabase.ts', async () => (await import('./testUtils.tsx')).supabaseMock())

import { AuthProvider, type Profile } from './AuthProvider.tsx'
import { RequireAdmin, RequireApproved } from './Guard.tsx'
import { LoginPage } from './LoginPage.tsx'
import { WelcomePage } from './WelcomePage.tsx'

const approved: Profile = { id: 'u1', handle: 'kane', status: 'approved', is_admin: false }

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

function setup(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Where />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/" element={<RequireApproved><p>홈</p></RequireApproved>} />
          <Route path="/join/:code" element={<RequireApproved><p>초대 화면</p></RequireApproved>} />
          <Route path="/admin" element={<RequireApproved><RequireAdmin><p>관리자 화면</p></RequireAdmin></RequireApproved>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => vi.clearAllMocks())

test('redirects_logged_out_to_login', async () => {
  setAuth(null, false)
  setup('/')
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/login?redirect=%2F'))
})

test('pending_goes_to_welcome', async () => {
  setAuth({ ...approved, status: 'pending' })
  setup('/')
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/welcome?redirect=%2F'))
})

test('approved_renders_child', async () => {
  setAuth(approved)
  setup('/')
  expect(await screen.findByText('홈')).toBeInTheDocument()
})

test('non_admin_blocked_from_admin', async () => {
  setAuth(approved)
  setup('/admin')
  expect(await screen.findByText('홈')).toBeInTheDocument()
  expect(screen.queryByText('관리자 화면')).toBeNull()
})

test('admin_can_open_admin', async () => {
  setAuth({ ...approved, is_admin: true })
  setup('/admin')
  expect(await screen.findByText('관리자 화면')).toBeInTheDocument()
})

test('invite_link_returns_after_approval', async () => {
  // 1) 로그아웃 상태로 초대 링크 진입 → 로그인 화면에 redirect 보존
  setAuth(null, false)
  const first = setup('/join/abc')
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/login?redirect=%2Fjoin%2Fabc'))
  fireEvent.click(screen.getByRole('button', { name: '구글로 로그인' }))
  expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
    provider: 'google',
    options: { redirectTo: `${location.origin}/welcome?redirect=${encodeURIComponent('/join/abc')}` },
  })
  first.unmount()

  // 2) 로그인 후 승인된 상태로 /welcome?redirect=... 도착 → 초대 링크로 이동
  setAuth(approved)
  setup('/welcome?redirect=%2Fjoin%2Fabc')
  expect(await screen.findByText('초대 화면')).toBeInTheDocument()
})

test('welcome_ignores_offsite_redirect', async () => {
  setAuth(approved)
  setup('/welcome?redirect=https%3A%2F%2Fevil.example')
  expect(await screen.findByText('홈')).toBeInTheDocument()
})

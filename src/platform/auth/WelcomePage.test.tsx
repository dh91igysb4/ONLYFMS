import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { mocks, setAuth } from './testUtils.tsx'

vi.mock('../../lib/supabase.ts', async () => (await import('./testUtils.tsx')).supabaseMock())

import { AuthProvider } from './AuthProvider.tsx'
import { WelcomePage } from './WelcomePage.tsx'

function setup() {
  return render(
    <MemoryRouter initialEntries={['/welcome']}>
      <AuthProvider>
        <WelcomePage />
      </AuthProvider>
    </MemoryRouter>,
  )
}
const noHandle = { id: 'u1', handle: null, status: 'pending' as const, is_admin: false }

beforeEach(() => vi.clearAllMocks())

test('shows_handle_form_when_null', async () => {
  setAuth(noHandle)
  setup()
  expect(await screen.findByLabelText('아이디')).toBeInTheDocument()
})

test('client_validation_matches_regex', async () => {
  setAuth(noHandle)
  setup()
  const input = await screen.findByLabelText('아이디')
  const btn = screen.getByRole('button', { name: '아이디 정하기' })
  fireEvent.change(input, { target: { value: 'a' } })
  expect(btn).toBeDisabled()
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.change(input, { target: { value: ' Kane ' } })
  expect(btn).toBeEnabled()
  expect(screen.getByText('저장될 아이디: kane')).toBeInTheDocument()
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.change(input, { target: { value: 'ka-ne' } })
  expect(btn).toBeDisabled()
})

test('submits_normalized_handle', async () => {
  setAuth(noHandle)
  setup()
  fireEvent.change(await screen.findByLabelText('아이디'), { target: { value: 'Kane ' } })
  fireEvent.click(screen.getByRole('button', { name: '아이디 정하기' }))
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('set_handle', { new_handle: 'kane' }))
})

test('shows_server_error_handle_taken_in_korean', async () => {
  setAuth(noHandle)
  mocks.rpc.mockImplementation(async (name: string) =>
    name === 'my_profile'
      ? { data: noHandle, error: null }
      : { data: null, error: { message: 'handle_taken', code: 'P0001' } },
  )
  setup()
  fireEvent.change(await screen.findByLabelText('아이디'), { target: { value: 'kane' } })
  fireEvent.click(screen.getByRole('button', { name: '아이디 정하기' }))
  expect(await screen.findByText('이미 쓰는 아이디예요')).toBeInTheDocument()
})

test('pending_message', async () => {
  setAuth({ ...noHandle, handle: 'kane' })
  setup()
  expect(await screen.findByText(/관리자가 승인하면/)).toBeInTheDocument()
})

test('rejected_message', async () => {
  setAuth({ ...noHandle, handle: 'kane', status: 'rejected' })
  setup()
  expect(await screen.findByText(/승인되지 않았어요/)).toBeInTheDocument()
})

test('hangul_handle_validation', async () => {
  setAuth(noHandle)
  setup()
  const input = await screen.findByLabelText('아이디')
  const btn = screen.getByRole('button', { name: '아이디 정하기' })
  for (const ok of ['손흥민', '승주', 'kane_케인9']) {
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.change(input, { target: { value: ok } })
    expect(btn).toBeEnabled()
  }
  for (const bad of ['ㅋㅋㅋ', '손', '손 흥민', '가나다라마바사아자차카타파하가나다']) {
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.change(input, { target: { value: bad } })
    expect(btn).toBeDisabled()
  }
})

test('submits_nfc_normalized_hangul', async () => {
  setAuth(noHandle)
  setup()
  fireEvent.change(await screen.findByLabelText('아이디'), { target: { value: ' 손흥민'.normalize('NFD') } })
  fireEvent.click(screen.getByRole('button', { name: '아이디 정하기' }))
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('set_handle', { new_handle: '손흥민' }))
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
let admin = false
vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: admin } }),
}))

import { ContestNewPage } from './ContestNewPage.tsx'

beforeEach(() => { rpcMock.mockReset(); admin = false })

test('official checkbox is admin only', () => {
  render(<MemoryRouter><ContestNewPage /></MemoryRouter>)
  expect(screen.queryByLabelText('공식 대회')).toBeNull()
  admin = true
  render(<MemoryRouter><ContestNewPage /></MemoryRouter>)
  expect(screen.getByLabelText('공식 대회')).toBeInTheDocument()
})

test('invalid form shows field errors and does not call the server', () => {
  render(<MemoryRouter><ContestNewPage /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '대회 만들기' }))
  expect(screen.getByText('제목은 1~40자로 적어 주세요')).toBeInTheDocument()
  expect(rpcMock).not.toHaveBeenCalled()
})

test('invite contest shows the join link after creation', async () => {
  admin = true // number-guess는 숨김 게임이라 관리자만 고를 수 있다
  rpcMock.mockResolvedValue([{ id: 'c9', invite_code: 'abcde12345' }])
  render(<MemoryRouter><ContestNewPage /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('제목'), { target: { value: '테스트' } })
  fireEvent.click(screen.getByLabelText(/초대 링크로만/))
  fireEvent.click(screen.getByRole('button', { name: '대회 만들기' }))
  expect(await screen.findByDisplayValue(`${location.origin}/join/abcde12345`)).toBeInTheDocument()
  expect(rpcMock).toHaveBeenCalledWith('create_contest', expect.objectContaining({ p_visibility: 'invite', p_official: false }))
  expect(screen.getByRole('link', { name: '대회 페이지로 가기' })).toHaveAttribute('href', '/contests/c9')
})

test('server error is mapped to its field', async () => {
  admin = true
  const { ApiError } = await import('../../lib/api.ts')
  rpcMock.mockRejectedValue(new ApiError('game_not_allowed', 400))
  render(<MemoryRouter><ContestNewPage /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('제목'), { target: { value: '테스트' } })
  fireEvent.click(screen.getByRole('button', { name: '대회 만들기' }))
  await waitFor(() => expect(screen.getByText('대회에 쓸 수 없는 게임이 들어 있어요')).toBeInTheDocument())
})

;(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'America/New_York' // 한국 시간이 아닌 브라우저를 흉내낸다

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
  expect(rpcMock).not.toHaveBeenCalledWith('create_contest', expect.anything())
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

test('start time is read as KST even when the browser is not in KST', async () => {
  admin = true
  rpcMock.mockImplementation(async (name: string) => (name === 'create_contest' ? [{ id: 'c1', invite_code: null }] : null))
  const startInput = () => screen.getByLabelText(/시작 시각/) as HTMLInputElement
  render(<MemoryRouter><ContestNewPage /></MemoryRouter>)
  // 기본값은 KST 벽시계: 지금(UTC)+30분+9시간
  const expectDefault = new Date(Date.now() + 30 * 60_000 + 9 * 3_600_000).toISOString().slice(0, 16)
  expect(Math.abs(Date.parse(startInput().value + 'Z') - Date.parse(expectDefault + 'Z'))).toBeLessThanOrEqual(2 * 60_000)
  const kst = new Date(Date.now() + 2 * 3_600_000 + 9 * 3_600_000)
  const wall = kst.toISOString().slice(0, 16) // KST 벽시계 2시간 뒤
  fireEvent.change(startInput(), { target: { value: wall } })
  fireEvent.change(screen.getByLabelText('제목'), { target: { value: '시간 테스트' } })
  fireEvent.click(screen.getByRole('button', { name: '대회 만들기' }))
  await screen.findByText('대회를 만들었어요')
  const args = rpcMock.mock.calls.find((c) => c[0] === 'create_contest')![1] as { p_starts_at: string }
  expect(args.p_starts_at).toBe(new Date(`${wall}:00+09:00`).toISOString())
  expect(Date.parse(args.p_starts_at) - Date.now()).toBeGreaterThan(115 * 60_000)
  expect(Date.parse(args.p_starts_at) - Date.now()).toBeLessThan(125 * 60_000)
  expect(rpcMock).toHaveBeenCalledWith('server_now')
})

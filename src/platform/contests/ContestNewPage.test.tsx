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
const wallet = vi.hoisted(() => ({ enabled: true }))
vi.mock('../wallet/enabled.ts', () => ({ walletEnabled: () => wallet.enabled }))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: admin } }),
}))

import { setBalance } from '../../lib/walletStore.ts'
import { ContestNewPage } from './ContestNewPage.tsx'

beforeEach(() => { rpcMock.mockReset(); admin = false; wallet.enabled = true; setBalance(100000) })

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
  admin = true // test-guess는 숨김 게임이라 관리자만 고를 수 있다
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

// ---------------------------------------------------------------- 참가비 (지갑 5단계)
test('참가비 입력: 1,000을 고르면 버튼이 "참가비 1,000 JWD 내고 만들기"이고 p_entry_fee를 보낸다', async () => {
  rpcMock.mockImplementation(async (name: string) => (name === 'create_contest' ? [{ id: 'c1', invite_code: null }] : null))
  render(<MemoryRouter><ContestNewPage /></MemoryRouter>)
  expect(screen.getByText(/모인 참가비를 1~3등이 6:3:1로 나눠 가져요/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('제목'), { target: { value: '참가비 대회' } })
  fireEvent.click(screen.getByRole('button', { name: '1,000 JWD' }))
  fireEvent.click(screen.getByRole('button', { name: '참가비 1,000 JWD 내고 만들기' }))
  await screen.findByText('대회를 만들었어요')
  expect(rpcMock).toHaveBeenCalledWith('create_contest', expect.objectContaining({ p_entry_fee: 1000 }))
})

test('참가비 0이면 p_entry_fee를 보내지 않는다(옛 DB 호환)', async () => {
  rpcMock.mockImplementation(async (name: string) => (name === 'create_contest' ? [{ id: 'c1', invite_code: null }] : null))
  render(<MemoryRouter><ContestNewPage /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('제목'), { target: { value: '무료 대회' } })
  fireEvent.click(screen.getByRole('button', { name: '대회 만들기' }))
  await screen.findByText('대회를 만들었어요')
  const args = rpcMock.mock.calls.find((c) => c[0] === 'create_contest')![1] as Record<string, unknown>
  expect('p_entry_fee' in args).toBe(false)
})

test('잔액보다 큰 참가비는 "JWD가 부족해요"이고 만들기 버튼이 막힌다', () => {
  setBalance(500)
  render(<MemoryRouter><ContestNewPage /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('참가비'), { target: { value: '1000' } })
  expect(screen.getByText('JWD가 부족해요')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '참가비 1,000 JWD 내고 만들기' })).toBeDisabled()
})

test('상한을 넘는 참가비 문구', () => {
  setBalance(100000)
  render(<MemoryRouter><ContestNewPage /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('참가비'), { target: { value: '41001' } })
  expect(screen.getByText('참가비는 41,000 JWD까지예요')).toBeInTheDocument()
})

test('서버의 not_enough_gold는 참가비 칸에 보인다', async () => {
  const { ApiError } = await import('../../lib/api.ts')
  rpcMock.mockRejectedValue(new ApiError('not_enough_gold', 400))
  render(<MemoryRouter><ContestNewPage /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('제목'), { target: { value: '참가비 대회' } })
  fireEvent.click(screen.getByRole('button', { name: '500 JWD' }))
  fireEvent.click(screen.getByRole('button', { name: '참가비 500 JWD 내고 만들기' }))
  expect(await screen.findByText('JWD가 부족해요')).toBeInTheDocument()
})

test('지갑 게임이 없으면 참가비 입력이 없다', () => {
  wallet.enabled = false
  render(<MemoryRouter><ContestNewPage /></MemoryRouter>)
  expect(screen.queryByLabelText('참가비')).toBeNull()
})

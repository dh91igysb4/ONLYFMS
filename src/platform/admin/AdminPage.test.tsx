import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
const listContestsMock = vi.fn()
vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'me', handle: 'boss', status: 'approved', is_admin: true } }),
}))
vi.mock('../contests/data.ts', async (orig) => ({
  ...(await orig<typeof import('../contests/data.ts')>()),
  listContests: (...a: unknown[]) => listContestsMock(...a),
}))
vi.mock('../../games/index.ts', () => ({
  games: [
    { manifest: { id: 'test-guess', name: '숫자 맞추기', hidden: false, puzzleSource: 'generate' } },
    { manifest: { id: 'players', name: '선수 맞추기', hidden: false, puzzleSource: 'bank' } },
  ],
}))

import { ApiError } from '../../lib/api.ts'
import { AdminPage } from './AdminPage.tsx'

type U = { id: string; handle: string | null; email: string; status: string; created_at: string }
const user = (id: string, handle: string | null, status = 'pending'): U => ({
  id, handle, email: `${id}@x.com`, status, created_at: '2026-10-01T03:00:00Z',
})

let users: U[]
let bank: { game_id: string; remaining: number }[]
let handlers: Record<string, (args: Record<string, unknown>) => unknown>

beforeEach(() => {
  rpcMock.mockReset()
  listContestsMock.mockReset()
  listContestsMock.mockResolvedValue([])
  users = [user('a', 'alice'), user('b', null), user('me', 'boss')]
  bank = [{ game_id: 'players', remaining: 100 }]
  handlers = {}
  rpcMock.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (handlers[name]) return handlers[name](args)
    if (name === 'admin_list_users') return users.filter((u) => u.status === args.p_status)
    if (name === 'admin_bank_status') return bank
    if (name === 'admin_set_status') {
      users = users.map((u) => (u.id === args.p_user ? { ...u, status: args.p_status as string } : u))
      return null
    }
    return null
  })
})

const renderPage = () => render(<AdminPage />)
const rowOf = (text: string) => screen.getByText(text).closest('li') as HTMLElement

test('lists_pending_with_email', async () => {
  renderPage()
  await screen.findByText('alice')
  expect(rpcMock).toHaveBeenCalledWith('admin_list_users', { p_status: 'pending' })
  expect(screen.getByText('a@x.com')).toBeTruthy()
  expect(screen.getByText('아이디 미설정')).toBeTruthy()
  // 내 행에는 승인/거절이 없다
  expect(within(rowOf('boss')).queryByRole('button', { name: '승인' })).toBeNull()
  expect(within(rowOf('boss')).queryByRole('button', { name: '거절' })).toBeNull()
})

test('approve_and_reject_update_list', async () => {
  renderPage()
  await screen.findByText('alice')
  fireEvent.click(within(rowOf('alice')).getByRole('button', { name: '승인' }))
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('admin_set_status', { p_user: 'a', p_status: 'approved' }))
  await waitFor(() => expect(screen.queryByText('alice')).toBeNull())

  fireEvent.click(within(rowOf('b@x.com')).getByRole('button', { name: '거절' }))
  fireEvent.click(within(rowOf('b@x.com')).getByRole('button', { name: '거절 확인' }))
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('admin_set_status', { p_user: 'b', p_status: 'rejected' }))
  await waitFor(() => expect(screen.queryByText('b@x.com')).toBeNull())

  fireEvent.click(screen.getByRole('tab', { name: '승인' }))
  await screen.findByText('alice')
})

test('reject_requires_second_click', async () => {
  renderPage()
  await screen.findByText('alice')
  fireEvent.click(within(rowOf('alice')).getByRole('button', { name: '거절' }))
  expect(rpcMock).not.toHaveBeenCalledWith('admin_set_status', expect.anything())
  expect(within(rowOf('alice')).getByRole('button', { name: '거절 확인' })).toBeTruthy()
})

test('handle_edit_shows_server_error', async () => {
  handlers.admin_set_handle = () => { throw new ApiError('handle_taken', 400) }
  renderPage()
  await screen.findByText('alice')
  fireEvent.click(within(rowOf('alice')).getByRole('button', { name: '아이디 변경' }))
  fireEvent.change(screen.getByLabelText('새 아이디'), { target: { value: 'bob' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('admin_set_handle', { p_user: 'a', p_handle: 'bob' }))
  expect((await screen.findByRole('alert')).textContent).toContain('이미 쓰는 아이디예요')
})

const upload = (content: string) => {
  const input = screen.getByLabelText('문제 파일') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File([content], 'p.json', { type: 'application/json' })] } })
}

test('upload_json_file_reports_added_and_skipped', async () => {
  handlers.admin_upload_puzzles = () => [{ added: 2, skipped: 1 }]
  renderPage()
  await screen.findByText('alice')
  const puzzles = [
    { puzzle_key: 'k1', puzzle: { n: 1 } },
    { puzzle_key: 'k2', puzzle: { n: 2 } },
    { puzzle_key: 'k3', puzzle: { n: 3 } },
  ]
  upload(JSON.stringify(puzzles))
  expect(await screen.findByText('추가 2개, 건너뜀 1개')).toBeTruthy()
  expect(rpcMock).toHaveBeenCalledWith('admin_upload_puzzles', { p_game: 'players', p_puzzles: puzzles })
  const bankCalls = rpcMock.mock.calls.filter((c) => c[0] === 'admin_bank_status').length
  expect(bankCalls).toBeGreaterThanOrEqual(2)
})

test('invalid_json_shows_error_without_calling_rpc', async () => {
  renderPage()
  await screen.findByText('alice')
  const cases: [string, string][] = [
    ['{ not json', 'JSON 형식이 올바르지 않아요'],
    [JSON.stringify([{ puzzle: {} }]), '1번째 문제의 형식이 올바르지 않아요'],
    [JSON.stringify([{ puzzle_key: 'ok', puzzle: {} }, { puzzle_key: 'x', puzzle: 5 }]), '2번째 문제의 형식이 올바르지 않아요'],
  ]
  for (const [content, message] of cases) {
    upload(content)
    const alert = await screen.findByRole('alert')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(message))
    expect(alert).toBeTruthy()
    expect(rpcMock.mock.calls.some((c) => c[0] === 'admin_upload_puzzles')).toBe(false)
  }
})

test('bank_under_30_shows_warning', async () => {
  bank = [{ game_id: 'players', remaining: 29 }]
  renderPage()
  expect((await screen.findByText(/문제가 얼마 남지 않았어요/)).getAttribute('role')).toBe('status')
})

test('bank_30_or_more_has_no_warning', async () => {
  renderPage()
  await screen.findByText('alice')
  await screen.findByText(/남은 문제 100개/)
  expect(screen.queryByText(/문제가 얼마 남지 않았어요/)).toBeNull()
})

test('cancel_live_contest_requires_confirm', async () => {
  const now = Date.now()
  const c = (id: string, title: string, kind: string, s: number, e: number, cancelled: string | null = null) => ({
    id, title, kind, created_by: null, visibility: 'public', cancelled_at: cancelled, daily_key: null, created_at: '',
    starts_at: new Date(now + s).toISOString(), ends_at: new Date(now + e).toISOString(),
  })
  listContestsMock.mockResolvedValue([
    c('c1', '진행 대회', 'official', -3_600_000, 3_600_000),
    c('c2', '끝난 대회', 'friendly', -7_200_000, -3_600_000),
    c('c3', '취소된 대회', 'friendly', 3_600_000, 7_200_000, '2026-10-01T00:00:00Z'),
  ])
  renderPage()
  const li = (await screen.findByText('진행 대회')).closest('li') as HTMLElement
  expect(screen.queryByText('끝난 대회')).toBeNull()
  expect(screen.queryByText('취소된 대회')).toBeNull()
  fireEvent.click(within(li).getByRole('button', { name: '취소' }))
  expect(rpcMock.mock.calls.some((x) => x[0] === 'cancel_contest')).toBe(false)
  fireEvent.click(within(li).getByRole('button', { name: '취소 확인' }))
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('cancel_contest', { p_id: 'c1' }))
})

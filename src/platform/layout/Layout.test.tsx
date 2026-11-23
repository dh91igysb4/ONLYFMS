import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const upsert = vi.fn(async () => ({ error: null }))
const signOut = vi.hoisted(() => vi.fn(async () => ({ error: null })))
vi.mock('../../lib/supabase.ts', () => ({
  supabase: { from: () => ({ upsert: (...a: unknown[]) => (upsert as (...x: unknown[]) => unknown)(...a) }), auth: { signOut } },
}))
const auth = vi.hoisted(() => ({ isAdmin: false, status: 'approved' }))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: auth.status, is_admin: auth.isAdmin } }),
}))
const fetchMyWallet = vi.hoisted(() => vi.fn())
const wallet = vi.hoisted(() => ({ enabled: true }))
vi.mock('../wallet/enabled.ts', () => ({ walletEnabled: () => wallet.enabled }))
vi.mock('../wallet/api.ts', () => ({ fetchMyWallet }))
const pendingCount = vi.hoisted(() => vi.fn())
vi.mock('../suggest/adminApi.ts', () => ({ suggestionPendingCount: pendingCount }))

import { Layout } from './Layout.tsx'
import { resetFreeQueue } from '../games/freeQueue.ts'
import { resetWallet, setWallet } from '../../lib/walletStore.ts'

const row = {
  client_id: 'q1', user_id: 'u1', game_id: 'test-guess', options: {},
  logic_version: 1, solved: true, score: 5, action_count: 3,
}

beforeEach(() => {
  upsert.mockClear()
  signOut.mockClear()
  pendingCount.mockReset()
  pendingCount.mockResolvedValue(0)
  auth.isAdmin = false
  auth.status = 'approved'
  wallet.enabled = true
  resetWallet()
  fetchMyWallet.mockReset()
  fetchMyWallet.mockImplementation(async () => {
    const w = { balance: 1234, today: {}, earnedToday: 0 }
    setWallet(w)
    return w
  })
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
          <Route path="/suggest" element={<p>sg</p>} />
          <Route path="/admin" element={<p>adm</p>} />
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

test('main nav lists 홈, 게임, 대회, 대전, 리더보드, 제안 in order', () => {
  mount()
  const links = within(screen.getByRole('navigation', { name: '주 메뉴' })).getAllByRole('link')
  expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
    ['홈', '/'], ['게임', '/games'], ['대회', '/contests'], ['대전', '/duel'], ['리더보드', '/leaderboard'], ['제안', '/suggest'],
  ])
})

test('관리자이고 대기 제안이 있으면 관리자 링크에 배지가 붙는다', async () => {
  auth.isAdmin = true
  pendingCount.mockResolvedValue(3)
  mount()
  const badge = await screen.findByLabelText('결정 대기 제안 3건')
  expect(badge.textContent).toBe('3')
  expect(badge.closest('a')?.getAttribute('href')).toBe('/admin')
  expect(pendingCount).toHaveBeenCalledTimes(1)
})

test('대기 제안이 0건이면 배지가 없다', async () => {
  auth.isAdmin = true
  mount()
  await vi.waitFor(() => expect(pendingCount).toHaveBeenCalledTimes(1))
  expect(screen.queryByLabelText(/결정 대기 제안/)).toBeNull()
})

test('일반 사용자는 대기 제안 수를 부르지 않는다', async () => {
  pendingCount.mockResolvedValue(3)
  mount()
  await vi.waitFor(() => expect(upsert).toHaveBeenCalled())
  expect(pendingCount).not.toHaveBeenCalled()
  expect(screen.queryByLabelText(/결정 대기 제안/)).toBeNull()
})

test('대기 제안 수 조회가 실패해도 조용히 배지만 없다', async () => {
  auth.isAdmin = true
  pendingCount.mockRejectedValue(new Error('boom'))
  mount()
  await vi.waitFor(() => expect(pendingCount).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('link', { name: '관리자' })).toBeTruthy()
  expect(screen.queryByLabelText(/결정 대기 제안/)).toBeNull()
})

test('관리자는 경로가 바뀔 때마다 대기 제안 수를 다시 읽어 배지를 갱신한다', async () => {
  auth.isAdmin = true
  pendingCount.mockResolvedValueOnce(3).mockResolvedValueOnce(2)
  mount()
  expect((await screen.findByLabelText('결정 대기 제안 3건')).textContent).toBe('3')
  fireEvent.click(screen.getByRole('link', { name: '제안' }))
  expect((await screen.findByLabelText('결정 대기 제안 2건')).textContent).toBe('2')
  expect(pendingCount).toHaveBeenCalledTimes(2)
})

test('일반 사용자는 경로가 바뀌어도 대기 제안 수를 부르지 않는다', async () => {
  mount()
  fireEvent.click(screen.getByRole('link', { name: '제안' }))
  await vi.waitFor(() => expect(where()).toBe('/suggest'))
  expect(pendingCount).not.toHaveBeenCalled()
})

test('경로가 바뀐 뒤 조회가 실패하면 조용히 이전 배지를 유지한다', async () => {
  auth.isAdmin = true
  pendingCount.mockResolvedValueOnce(3).mockRejectedValueOnce(new Error('boom'))
  mount()
  await screen.findByLabelText('결정 대기 제안 3건')
  fireEvent.click(screen.getByRole('link', { name: '제안' }))
  await vi.waitFor(() => expect(pendingCount).toHaveBeenCalledTimes(2))
  expect(screen.getByLabelText('결정 대기 제안 3건')).toBeTruthy()
})

test('로드 때 my_wallet을 한 번 읽고 헤더에 잔액을 보여 준다', async () => {
  mount()
  expect(await screen.findByLabelText('내 골드 1,234 G')).toBeTruthy()
  expect(fetchMyWallet).toHaveBeenCalledTimes(1)
})

test('승인되지 않은 사용자에게는 배지가 없고 my_wallet도 부르지 않는다', async () => {
  auth.status = 'pending'
  mount()
  await vi.waitFor(() => expect(upsert).toHaveBeenCalled())
  expect(screen.queryByLabelText(/내 골드/)).toBeNull()
  expect(fetchMyWallet).not.toHaveBeenCalled()
})

test('지갑을 쓰는 게임이 없으면(낚시 이전 전) 배지가 없고 my_wallet도 부르지 않는다', async () => {
  wallet.enabled = false
  mount()
  await vi.waitFor(() => expect(upsert).toHaveBeenCalled())
  expect(screen.queryByLabelText(/내 골드/)).toBeNull()
  expect(fetchMyWallet).not.toHaveBeenCalled()
})

test('받은 상금이 있으면 헤더 아래 상금 알림 (지갑 3단계)', async () => {
  const { setPrizes } = await import('../../lib/walletStore.ts')
  fetchMyWallet.mockImplementation(async () => {
    const w = { balance: 7384, today: {}, earnedToday: 0 }
    setWallet(w)
    setPrizes([{ id: 1, reason: 'daily_prize', contestId: 'c1', gameId: null, amount: 6150, note: '1등', at: '2026-11-25T00:00:00Z' }])
    return w
  })
  mount()
  expect((await screen.findByRole('status')).textContent).toContain('데일리 상금이 들어왔어요 · 1등 +6,150 G')
})

test('지갑 게임이 없으면 상금 알림도 없다', async () => {
  wallet.enabled = false
  const { setPrizes } = await import('../../lib/walletStore.ts')
  setPrizes([{ id: 1, reason: 'daily_prize', contestId: 'c1', gameId: null, amount: 6150, note: '1등', at: '2026-11-25T00:00:00Z' }])
  mount()
  expect(screen.queryByText(/상금이 들어왔어요/)).toBeNull()
})

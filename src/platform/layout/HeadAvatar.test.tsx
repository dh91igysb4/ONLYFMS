import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
const seen = vi.fn()
const reg = vi.hoisted(() => ({ hidden: false, isAdmin: false }))
vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../../lib/api.ts', async (orig) => ({ ...(await orig<typeof import('../../lib/api.ts')>()), rpc: (...a: unknown[]) => rpcMock(...a) }))
vi.mock('../auth/AuthProvider.tsx', () => ({ useAuth: () => ({ profile: { id: 'u1', handle: 'kane', is_admin: reg.isAdmin } }) }))
vi.mock('../../games/index.ts', () => ({
  get worlds() { return [{ manifest: { id: 'w1', name: '월드', hidden: reg.hidden, avatar: { label: '캐릭터' } } }] },
}))
vi.mock('../../games/ui.ts', () => ({
  getAvatarComponent: (id: string) => (id === 'w1'
    ? (p: { data: string; scale: number; crop?: string }) => { seen(p); return <canvas data-testid="head" /> }
    : undefined),
}))

import { HeadAvatar } from './HeadAvatar.tsx'

const mount = () => render(<MemoryRouter><HeadAvatar handle="kane" /></MemoryRouter>)

beforeEach(() => {
  rpcMock.mockReset().mockResolvedValue([{ game_id: 'w1', key: 'avatar', value: 0, detail: '{"hat":"cap"}' }])
  seen.mockReset()
  reg.hidden = false
  reg.isAdmin = false
})

test('내 캐릭터가 있으면 머리를 동그라미 안에 그린다(글자 대신)', async () => {
  mount()
  expect(await screen.findByTestId('head')).toBeTruthy()
  expect(rpcMock).toHaveBeenCalledWith('user_records', { p_handle: 'kane' })
  expect(seen).toHaveBeenCalledWith(expect.objectContaining({ data: '{"hat":"cap"}', crop: 'head' }))
  const circle = screen.getByTestId('head').closest('.avatar')!
  expect(circle.classList.contains('avatar-head')).toBe(true)
  expect(circle.textContent).toBe('')
})

test('캐릭터 기록이 없거나 불러오지 못하면 첫 글자', async () => {
  rpcMock.mockResolvedValue([])
  const r = mount()
  await waitFor(() => expect(rpcMock).toHaveBeenCalled())
  expect(r.container.querySelector('.avatar')!.textContent).toBe('K')
  r.unmount()
  rpcMock.mockRejectedValue(new Error('x'))
  const r2 = mount()
  await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(2))
  expect(r2.container.querySelector('.avatar')!.textContent).toBe('K')
  expect(screen.queryByTestId('head')).toBeNull()
})

test('숨김 게임 캐릭터는 관리자에게만', async () => {
  reg.hidden = true
  const r = mount()
  await waitFor(() => expect(rpcMock).toHaveBeenCalled())
  await Promise.resolve()
  expect(screen.queryByTestId('head')).toBeNull()
  r.unmount()
  reg.isAdmin = true
  mount()
  expect(await screen.findByTestId('head')).toBeTruthy()
})

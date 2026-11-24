import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))
const auth = vi.hoisted(() => ({ admin: false }))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: auth.admin }, refresh: async () => {} }),
}))
const hiddenRef = vi.hoisted(() => ({ hidden: false }))
vi.mock('../../games/index.ts', async () => {
  const fx = await import('../../test-fixtures/world.ts')
  const plain = { ...fx.testWorld, manifest: { ...fx.testWorld.manifest, id: 'plain-world' } }
  const world = {
    ...fx.testWorld,
    manifest: { ...fx.testWorld.manifest, avatar: { label: '테스트 캐릭터' }, get hidden() { return hiddenRef.hidden } },
    logic: { ...fx.testWorld.logic, avatar: () => 'x' },
  }
  return { games: [], duels: [], worlds: [world, plain], getWorld: () => undefined }
})
vi.mock('../../games/ui.ts', () => ({
  getAvatarComponent: (id: string) =>
    id === 'test-world' || id === 'plain-world' ? ({ data, scale }: { data: string; scale: number }) => <span>{`그림:${data}:${scale}`}</span> : undefined,
}))

import { AvatarSection } from './AvatarSection.tsx'

beforeEach(() => { rpcMock.mockReset(); auth.admin = false; hiddenRef.hidden = false })

test('avatar 행이 있으면 등록된 화면으로 그린다', async () => {
  rpcMock.mockResolvedValue([
    { game_id: 'test-world', key: 'n', value: 3, detail: null },
    { game_id: 'test-world', key: 'avatar', value: 0, detail: '{"hat":"cap"}' },
  ])
  render(<AvatarSection handle="kane" />)
  expect(await screen.findByText('그림:{"hat":"cap"}:4')).toBeTruthy()
  expect(screen.getByText('테스트 캐릭터')).toBeTruthy()
  expect(screen.getByText('테스트 월드')).toBeTruthy()
  expect(rpcMock).toHaveBeenCalledWith('user_records', { p_handle: 'kane' })
})

test('manifest에 avatar가 없는 게임의 avatar 행은 그리지 않는다', async () => {
  rpcMock.mockResolvedValue([{ game_id: 'plain-world', key: 'avatar', value: 0, detail: 'zz' }])
  const { container } = render(<AvatarSection handle="kane" />)
  await waitFor(() => expect(rpcMock).toHaveBeenCalled())
  await new Promise((r) => setTimeout(r, 0))
  expect(container.textContent).toBe('')
})

test('행이 없거나 실패하면 아무것도 그리지 않는다', async () => {
  rpcMock.mockResolvedValueOnce([])
  const a = render(<AvatarSection handle="kane" />)
  await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1))
  expect(a.container.textContent).toBe('')
  a.unmount()
  rpcMock.mockRejectedValueOnce(new Error('boom'))
  const b = render(<AvatarSection handle="kane" />)
  await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(2))
  await new Promise((r) => setTimeout(r, 0))
  expect(b.container.textContent).toBe('')
})

test('숨김 게임은 관리자에게만', async () => {
  hiddenRef.hidden = true
  rpcMock.mockResolvedValue([{ game_id: 'test-world', key: 'avatar', value: 0, detail: 'd' }])
  const a = render(<AvatarSection handle="kane" />)
  await waitFor(() => expect(rpcMock).toHaveBeenCalled())
  await new Promise((r) => setTimeout(r, 0))
  expect(a.container.textContent).toBe('')
  a.unmount()
  auth.admin = true
  render(<AvatarSection handle="kane" />)
  expect(await screen.findByText('그림:d:4')).toBeTruthy()
})

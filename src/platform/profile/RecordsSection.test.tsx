import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
vi.mock('../../games/index.ts', async (orig) => {
  const fx = await import('../../test-fixtures/world.ts')
  const real = fx.withTestWorld({ ...(await orig<typeof import('../../games/index.ts')>()), worlds: [] as never[], getWorld: () => undefined } as never) as { worlds: unknown[] }
  const world = { ...fx.testWorld, manifest: { ...fx.testWorld.manifest, get hidden() { return hiddenRef.hidden } } }
  return { games: [], duels: [], ...real, worlds: [world] }
})

import { RecordsSection } from './RecordsSection.tsx'

beforeEach(() => { rpcMock.mockReset(); auth.admin = false; hiddenRef.hidden = false })

test('records_shows_label_and_formatted_value', async () => {
  rpcMock.mockResolvedValue([{ game_id: 'test-world', key: 'n', value: 1234, detail: null }])
  render(<RecordsSection handle="kane" />)
  expect(await screen.findByText('테스트 월드')).toBeTruthy()
  expect(screen.getByText('횟수')).toBeTruthy()
  expect(screen.getByText('1,234')).toBeTruthy()
  expect(rpcMock).toHaveBeenCalledWith('user_records', { p_handle: 'kane' })
})

test('records_missing_row_shows_dash', async () => {
  rpcMock.mockResolvedValue([])
  render(<RecordsSection handle="kane" />)
  expect(await screen.findByText('–')).toBeTruthy()
})

test('records_ignores_unknown_key_and_game', async () => {
  rpcMock.mockResolvedValue([
    { game_id: 'test-world', key: 'zzz', value: 77, detail: null },
    { game_id: 'gone', key: 'n', value: 88, detail: null },
  ])
  render(<RecordsSection handle="kane" />)
  expect(await screen.findByText('–')).toBeTruthy()
  expect(screen.queryByText('77')).toBeNull()
  expect(screen.queryByText('88')).toBeNull()
})

test('records_detail_in_parentheses', async () => {
  rpcMock.mockResolvedValue([{ game_id: 'test-world', key: 'n', value: 5, detail: '은어' }])
  render(<RecordsSection handle="kane" />)
  expect(await screen.findByText(/5 \(은어\)/)).toBeTruthy()
})

test('records_error_and_retry', async () => {
  rpcMock.mockRejectedValueOnce(new Error('boom'))
  rpcMock.mockResolvedValueOnce([{ game_id: 'test-world', key: 'n', value: 3, detail: null }])
  render(<RecordsSection handle="kane" />)
  expect(await screen.findByText(/기록을 불러오지 못했어요/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByText('3')).toBeTruthy()
  expect(rpcMock).toHaveBeenCalledTimes(2)
})

test('records_hidden_game_only_for_admin', async () => {
  hiddenRef.hidden = true
  rpcMock.mockResolvedValue([{ game_id: 'test-world', key: 'n', value: 9, detail: null }])
  const first = render(<RecordsSection handle="kane" />)
  expect(await screen.findByText('아직 기록이 없어요')).toBeTruthy()
  expect(screen.queryByText('테스트 월드')).toBeNull()
  first.unmount()
  auth.admin = true
  render(<RecordsSection handle="kane" />)
  expect(await screen.findByText('테스트 월드')).toBeTruthy()
  await waitFor(() => expect(screen.getByText('9')).toBeTruthy())
})

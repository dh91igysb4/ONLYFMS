import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
let profile: { id: string; handle: string; status: string; is_admin: boolean } | null = null
let walletOn = true

vi.mock('../../games/index.ts', async (orig) => {
  const real = (await import('../../test-fixtures/registry.ts')).withTestGame(await orig())
  const base = real.games.find((g) => g.manifest.id === 'test-guess')!
  const shopped = {
    ...base,
    manifest: {
      ...base.manifest,
      hidden: false,
      options: [{ ...base.manifest.options[0], shop: true as const }],
      shop: { option: 'range', items: [{ id: '100', price: 0 }, { id: '1000', price: 3000 }] },
    },
  }
  const games = real.games.map((g) => (g.manifest.id === 'test-guess' ? shopped : g))
  return { ...real, games, getGame: (id: string) => games.find((g) => g.manifest.id === id) }
})
vi.mock('../../games/ui.ts', async (orig) =>
  (await import('../../test-fixtures/ui.ts')).withTestGameUi(await orig()))
vi.mock('../wallet/enabled.ts', () => ({ walletEnabled: () => walletOn }))
vi.mock('../../lib/supabase.ts', () => ({ supabase: { from: () => ({ upsert: async () => ({ error: null }) }) }, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))
vi.mock('../auth/AuthProvider.tsx', () => ({ useAuth: () => ({ profile }) }))

import { FreePage } from './FreePage.tsx'

const approved = { id: 'u1', handle: 'kane', status: 'approved', is_admin: true }
const page = () => (
  <MemoryRouter initialEntries={['/play/test-guess/free']}>
    <Routes><Route path="/play/:game/free" element={<FreePage />} /></Routes>
  </MemoryRouter>
)
const select = () => screen.getByRole('combobox', { name: '범위' }) as HTMLSelectElement
const optionValues = () => [...select().options].map((o) => o.value)

beforeEach(() => { rpcMock.mockReset(); profile = approved; walletOn = true })

test('승인 사용자: my_items 응답 전에는 불러오는 중, 뒤에는 가진 품목과 고른 값', async () => {
  let resolve!: (v: unknown) => void
  rpcMock.mockImplementation((name: string) => (name === 'my_items' ? new Promise((r) => { resolve = r }) : Promise.resolve(null)))
  render(page())
  expect(screen.getByText('불러오는 중')).toBeInTheDocument()
  expect(screen.queryByText('남은 기회 8')).toBeNull()
  resolve([{ item_id: '1000', equipped: true }])
  expect(await screen.findByText('남은 기회 8')).toBeInTheDocument()
  expect(optionValues()).toEqual(['100', '1000'])
  expect(select().value).toBe('1000')
  expect(screen.getByRole('button', { name: '상점' })).toBeInTheDocument()
  expect(rpcMock).toHaveBeenCalledWith('my_items', { p_game: 'test-guess' })
})

test('안 가진 품목은 선택 상자에 없다', async () => {
  rpcMock.mockResolvedValue([])
  render(page())
  await screen.findByText('남은 기회 8')
  expect(optionValues()).toEqual(['100'])
  expect(select().value).toBe('100')
})

test('선택을 바꾸면 equip_item을 부르고 새 판', async () => {
  rpcMock.mockImplementation((name: string) => Promise.resolve(name === 'my_items' ? [{ item_id: '1000', equipped: false }] : null))
  render(page())
  await screen.findByText('남은 기회 8')
  fireEvent.change(select(), { target: { value: '1000' } })
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('equip_item', { p_game: 'test-guess', p_item: '1000' }))
  expect(select().value).toBe('1000')
})

test('my_items가 실패하면 기본값으로 시작한다', async () => {
  rpcMock.mockRejectedValue(new Error('network'))
  render(page())
  expect(await screen.findByText('남은 기회 8')).toBeInTheDocument()
  expect(optionValues()).toEqual(['100'])
})

test('상점에서 사면 그 품목을 고르고 equip_item을 부른다', async () => {
  rpcMock.mockImplementation((name: string) => {
    if (name === 'my_items') return Promise.resolve([])
    if (name === 'buy_item') return Promise.resolve({ balance: 500 })
    return Promise.resolve(null)
  })
  render(page())
  await screen.findByText('남은 기회 8')
  fireEvent.click(screen.getByRole('button', { name: '상점' }))
  const panel = screen.getByRole('region', { name: '상점' })
  fireEvent.click(within(panel).getByRole('button', { name: '사기 (3,000 JWD)' }))
  fireEvent.click(within(panel).getByRole('button', { name: '확인' }))
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('buy_item', { p_game: 'test-guess', p_item: '1000', p_price: 3000 }))
  await waitFor(() => expect(select().value).toBe('1000'))
  expect(optionValues()).toEqual(['100', '1000'])
  expect(rpcMock).toHaveBeenCalledWith('equip_item', { p_game: 'test-guess', p_item: '1000' })
})

test.each([
  ['비로그인', () => { profile = null }],
  ['미승인', () => { profile = { ...approved, status: 'pending' } }],
  ['지갑 꺼짐', () => { walletOn = false }],
])('%s: 바로 시작, 가격 0 품목만, 상점 버튼 없음', (_n, setup) => {
  setup()
  render(page())
  expect(screen.getByText('남은 기회 8')).toBeInTheDocument()
  expect(optionValues()).toEqual(['100'])
  expect(screen.queryByRole('button', { name: '상점' })).toBeNull()
  expect(rpcMock).not.toHaveBeenCalled()
})

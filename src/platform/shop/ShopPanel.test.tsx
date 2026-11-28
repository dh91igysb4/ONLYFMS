import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Manifest } from '../../games/types.ts'

const buyMock = vi.fn()
vi.mock('./api.ts', () => ({ buyItem: (...a: unknown[]) => buyMock(...a) }))
vi.mock('../../games/ui.ts', () => ({
  getShopPreview: (id: string) => (id === 'with-art' ? ({ itemId }: { itemId: string }) => <i data-testid="art">{itemId}</i> : undefined),
}))

const fetchWalletMock = vi.fn()
vi.mock('../wallet/api.ts', () => ({ fetchMyWallet: (...a: unknown[]) => fetchWalletMock(...a) }))

import { getWallet, resetWallet } from '../../lib/walletStore.ts'
import { ShopPanel } from './ShopPanel.tsx'

const manifest = {
  id: 'with-art',
  options: [{ key: 'car', label: '차', shop: true, default: 'a', choices: [{ value: 'a', label: '기본차' }, { value: 'b', label: '빠른차' }] }],
  shop: { option: 'car', items: [{ id: 'a', price: 0 }, { id: 'b', price: 5000 }] },
} as unknown as Manifest

const onBought = vi.fn(), onSelect = vi.fn(), onClose = vi.fn(), onRefresh = vi.fn()
function open(owned = ['a'], gameId = 'with-art') {
  return render(<ShopPanel gameId={gameId} manifest={manifest} owned={new Set(owned)} selected="a" onBought={onBought} onSelect={onSelect} onRefresh={onRefresh} onClose={onClose} />)
}

beforeEach(() => { fetchWalletMock.mockReset(); fetchWalletMock.mockResolvedValue({}); onRefresh.mockReset(); buyMock.mockReset(); onBought.mockReset(); onSelect.mockReset(); onClose.mockReset() })
afterEach(() => resetWallet())

test('안 산 품목은 사기, 산 품목은 고르기, 고른 품목은 표시', () => {
  open()
  expect(screen.getByRole('button', { name: '사기 (5,000 JWD)' })).toBeInTheDocument()
  expect(screen.getByText('고름')).toBeInTheDocument()
  open(['a', 'b'])
  fireEvent.click(screen.getByRole('button', { name: '고르기' }))
  expect(onSelect).toHaveBeenCalledWith('b')
})

test('사기 → 확인 → buyItem → 잔액 갱신과 onBought', async () => {
  buyMock.mockResolvedValue({ balance: 1234 })
  open()
  fireEvent.click(screen.getByRole('button', { name: '사기 (5,000 JWD)' }))
  expect(screen.getByText('5,000 JWD로 살까요?')).toBeInTheDocument()
  expect(buyMock).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '확인' }))
  await waitFor(() => expect(onBought).toHaveBeenCalledWith('b'))
  expect(buyMock).toHaveBeenCalledWith('with-art', 'b', 5000)
  expect(getWallet().balance).toBe(1234)
})

test('취소하면 사지 않는다', () => {
  open()
  fireEvent.click(screen.getByRole('button', { name: '사기 (5,000 JWD)' }))
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(buyMock).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '사기 (5,000 JWD)' })).toBeInTheDocument()
})

test.each([
  ['not_enough_gold', 'JWD가 부족해요'],
  ['price_mismatch', '가격이 바뀌었어요. 페이지를 새로 고쳐 주세요'],
  ['already_owned', '이미 가진 품목이에요'],
  ['wallet_off', '사지 못했어요'],
])('오류 %s → %s', async (code, text) => {
  buyMock.mockRejectedValue(new Error(code))
  open()
  fireEvent.click(screen.getByRole('button', { name: '사기 (5,000 JWD)' }))
  fireEvent.click(screen.getByRole('button', { name: '확인' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(text)
  expect(onBought).not.toHaveBeenCalled()
})

test('미리보기 컴포넌트가 등록돼 있으면 품목마다 그린다', () => {
  open()
  expect(screen.getAllByTestId('art').map((e) => e.textContent)).toEqual(['a', 'b'])
})

test('사기에 실패하면 보유 목록과 잔액을 다시 읽는다', async () => {
  buyMock.mockRejectedValue(new Error('network'))
  open()
  fireEvent.click(screen.getByRole('button', { name: '사기 (5,000 JWD)' }))
  fireEvent.click(screen.getByRole('button', { name: '확인' }))
  await screen.findByRole('alert')
  expect(onRefresh).toHaveBeenCalledTimes(1)
  expect(fetchWalletMock).toHaveBeenCalledTimes(1)
})

test('사기에 성공하면 다시 읽지 않는다', async () => {
  buyMock.mockResolvedValue({ balance: 10 })
  open()
  fireEvent.click(screen.getByRole('button', { name: '사기 (5,000 JWD)' }))
  fireEvent.click(screen.getByRole('button', { name: '확인' }))
  await waitFor(() => expect(onBought).toHaveBeenCalled())
  expect(onRefresh).not.toHaveBeenCalled()
})

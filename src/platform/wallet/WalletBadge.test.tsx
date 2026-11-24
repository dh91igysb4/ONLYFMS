import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { resetWallet, setBalance } from '../../lib/walletStore.ts'
import { WalletBadge } from './WalletBadge.tsx'
import { formatGold, signedGold } from './format.ts'

afterEach(() => resetWallet())

test('잔액을 모르면 — G', () => {
  render(<WalletBadge />)
  expect(screen.getByLabelText('지갑 — G').textContent).toBe('지갑 — G')
})

test('저장소 값이 바뀌면(world 응답) 다시 그린다', () => {
  render(<WalletBadge />)
  act(() => setBalance(1234))
  expect(screen.getByLabelText('지갑 1,234 G').textContent).toBe('지갑 1,234 G')
  act(() => setBalance(0))
  expect(screen.getByLabelText('지갑 0 G')).toBeTruthy()
})

test('금액 표기', () => {
  expect(formatGold(1234567)).toBe('1,234,567 G')
  expect(signedGold(500)).toBe('+500')
  expect(signedGold(-1200)).toBe('−1,200')
})

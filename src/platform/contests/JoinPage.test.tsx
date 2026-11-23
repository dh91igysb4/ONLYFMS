import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
const wallet = vi.hoisted(() => ({ enabled: true }))
vi.mock('../wallet/enabled.ts', () => ({ walletEnabled: () => wallet.enabled }))
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))

import { ApiError } from '../../lib/api.ts'
import { setBalance } from '../../lib/walletStore.ts'
import { JoinPage } from './JoinPage.tsx'

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/join/abcde12345']}>
      <Routes>
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="/contests/:id" element={<p>대회 화면</p>} />
        <Route path="/contests" element={<p>대회 목록 화면</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { rpcMock.mockReset(); setBalance(100000); wallet.enabled = true })

test('참가비 0 대회는 바로 들어간다', async () => {
  rpcMock.mockResolvedValue('c1')
  renderAt()
  expect(await screen.findByText('대회 화면')).toBeInTheDocument()
  expect(rpcMock).toHaveBeenCalledWith('join_by_invite_code', { p_code: 'abcde12345' })
})

test('참가비 대회는 fee_mismatch로 금액을 알고 확인 화면을 거친다', async () => {
  rpcMock.mockImplementation(async (name: string, args: { p_entry_fee?: number }) => {
    if (name === 'join_by_invite_code' && !args.p_entry_fee) throw new ApiError('fee_mismatch', 400, { details: '700' })
    if (name === 'join_by_invite_code') return 'c1'
    return { balance: 99300, today: {}, earned_today: 0, prizes: [] }
  })
  renderAt()
  expect(await screen.findByText('참가비가 있는 대회예요')).toBeInTheDocument()
  expect(screen.getByText(/내 골드 100,000 G/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '참가비 700 G 내고 참가' }))
  expect(await screen.findByText('대회 화면')).toBeInTheDocument()
  expect(rpcMock).toHaveBeenCalledWith('join_by_invite_code', { p_code: 'abcde12345', p_entry_fee: 700 })
})

test('잔액이 모자라면 확인 화면의 참가 버튼이 막힌다', async () => {
  setBalance(300)
  rpcMock.mockRejectedValue(new ApiError('fee_mismatch', 400, { details: '700' }))
  renderAt()
  expect(await screen.findByRole('button', { name: '참가비 700 G 내고 참가' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('골드가 부족해요')
})

test('확인 화면에서 서버가 not_enough_gold면 그 화면에 문구', async () => {
  rpcMock.mockImplementation(async (_n: string, args: { p_entry_fee?: number }) => {
    if (!args.p_entry_fee) throw new ApiError('fee_mismatch', 400, { details: '700' })
    throw new ApiError('not_enough_gold', 400)
  })
  renderAt()
  fireEvent.click(await screen.findByRole('button', { name: '참가비 700 G 내고 참가' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('골드가 부족해요')
  expect(screen.getByText('참가비가 있는 대회예요')).toBeInTheDocument()
})

test('다른 오류는 지금처럼 문구와 다시 시도', async () => {
  rpcMock.mockRejectedValue(new ApiError('contest_closed', 400))
  renderAt()
  expect(await screen.findByText('이미 끝났거나 취소된 대회예요')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
})

test('지갑이 보이기 전에는 확인 화면 대신 오류 문구', async () => {
  wallet.enabled = false
  rpcMock.mockRejectedValue(new ApiError('fee_mismatch', 400, { details: '700' }))
  renderAt()
  expect(await screen.findByText('참가비를 확인하고 대회 페이지에서 다시 참가해 주세요')).toBeInTheDocument()
  expect(screen.queryByText('참가비가 있는 대회예요')).toBeNull()
})

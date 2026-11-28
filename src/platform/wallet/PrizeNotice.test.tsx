import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../../games/index.ts', async (orig) =>
  (await import('../../test-fixtures/registry.ts')).withTestGame(await orig()))

import { resetWallet, setPrizes, type Prize } from '../../lib/walletStore.ts'
import { PrizeNotice } from './PrizeNotice.tsx'

const prize = (id: number, over: Partial<Prize> = {}): Prize => ({
  id, reason: 'daily_prize', contestId: `c${id}`, gameId: 'test-guess', amount: 6150, note: '1등',
  at: '2026-11-25T00:00:00Z', ...over,
})

const mount = () => render(<MemoryRouter><PrizeNotice uid="u1" /></MemoryRouter>)

beforeEach(() => { localStorage.clear(); resetWallet() })
afterEach(() => resetWallet())

test('상금 하나: 게임 이름·등수·금액과 보기 링크', () => {
  setPrizes([prize(5)])
  mount()
  const box = screen.getByRole('status')
  expect(box.textContent).toContain('데일리 상금이 들어왔어요')
  expect(box.textContent).toContain('테스트 숫자 맞히기 1등')
  expect(box.textContent).toContain('+6,150 JWD')
  expect(screen.getByRole('link', { name: '보기' }).getAttribute('href')).toBe('/contests/c5')
})

test('확인 → 닫히고 다시 그려도 안 뜬다(사용자별 기록)', () => {
  setPrizes([prize(5)])
  const v = mount()
  fireEvent.click(screen.getByRole('button', { name: '확인' }))
  expect(screen.queryByRole('status')).toBeNull()
  v.unmount()
  mount()
  expect(screen.queryByRole('status')).toBeNull()
  expect(localStorage.getItem('onlyfms:prize-seen:u1')).toBe('5')
})

test('보기를 눌러도 확인한 것으로 기록한다', () => {
  setPrizes([prize(7)])
  mount()
  fireEvent.click(screen.getByRole('link', { name: '보기' }))
  expect(localStorage.getItem('onlyfms:prize-seen:u1')).toBe('7')
})

test('여러 건: 건수와 합계, 보기 링크 없음', () => {
  setPrizes([prize(9, { amount: 5120, note: '2등' }), prize(8)])
  mount()
  const box = screen.getByRole('status')
  expect(box.textContent).toContain('상금이 들어왔어요 · 2건')
  expect(box.textContent).toContain('+11,270 JWD')
  expect(screen.queryByRole('link', { name: '보기' })).toBeNull()
})

test('대회 상금(5단계)은 문구가 다르다, 게임 없음', () => {
  setPrizes([prize(3, { reason: 'contest_prize', gameId: null, amount: 1800 })])
  mount()
  expect(screen.getByRole('status').textContent).toContain('대회 상금이 들어왔어요 · 1등 +1,800 JWD')
})

test('이미 확인한 상금·빈 목록 → 아무것도 그리지 않는다', () => {
  localStorage.setItem('onlyfms:prize-seen:u1', '10')
  setPrizes([prize(10)])
  const v = mount()
  expect(v.container.innerHTML).toBe('')
  setPrizes([])
  expect(v.container.innerHTML).toBe('')
})

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))
vi.mock('../../games/index.ts', () => ({
  games: [{ manifest: { id: 'test-guess', name: '숫자 맞추기' } }],
  duels: [],
  worlds: [{ manifest: { id: 'fishing', name: '펨타듀 낚시' } }],
}))

import { ApiError } from '../../lib/api.ts'
import { AdminGoldSection, kstShort, REASON_LABEL } from './AdminGoldSection.tsx'

const row = (o: Record<string, unknown>) => ({
  id: 1, handle: 'kane', delta: 500, balance_after: 500, reason: 'admin', ref: 'r', game_id: null,
  note: '보상', raw_delta: null, created_at: '2026-11-24T03:05:00Z', ...o,
})
let ledger: unknown[]

beforeEach(() => {
  rpcMock.mockReset()
  ledger = [
    row({ id: 3, reason: 'world', game_id: 'fishing', delta: 800, raw_delta: 1000, balance_after: 30800, note: null }),
    row({ id: 2, reason: 'world', game_id: 'fishing', delta: -1500, balance_after: 30000, note: null }),
    row({ id: 1 }),
  ]
  rpcMock.mockImplementation(async (name: string) => {
    if (name === 'admin_gold_ledger') return ledger
    if (name === 'admin_gold_adjust') return 600
    return null
  })
})

test('최근 장부: 시각 KST·아이디·이유 라벨+게임 이름·금액·상한·잔액', async () => {
  render(<AdminGoldSection />)
  expect(screen.getByRole('heading', { name: 'JWD' })).toBeTruthy()
  const table = await screen.findByRole('table')
  const rows = within(table).getAllByRole('row').slice(1)
  expect(rows).toHaveLength(3)
  expect(rows[0]).toHaveTextContent('11.24 12:05')
  expect(rows[0]).toHaveTextContent('kane')
  expect(rows[0]).toHaveTextContent('게임 안 · 펨타듀 낚시')
  expect(rows[0]).toHaveTextContent('+800')
  expect(rows[0]).toHaveTextContent('(상한, 원래 +1,000)')
  expect(rows[0]).toHaveTextContent('30,800')
  expect(rows[1]).toHaveTextContent('−1,500')
  expect(rows[2]).toHaveTextContent('관리자 조정')
  expect(rows[2]).toHaveTextContent('보상')
  expect(rpcMock).toHaveBeenCalledWith('admin_gold_ledger', { p_limit: 50 })
})

test('조정 성공 → 결과 문구, 목록 다시 읽음', async () => {
  render(<AdminGoldSection />)
  await screen.findByRole('table')
  fireEvent.change(screen.getByLabelText('아이디'), { target: { value: 'kane' } })
  fireEvent.change(screen.getByLabelText('금액'), { target: { value: '100' } })
  fireEvent.change(screen.getByLabelText('메모'), { target: { value: '보상' } })
  fireEvent.click(screen.getByRole('button', { name: '반영' }))
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('admin_gold_adjust', { p_handle: 'kane', p_delta: 100, p_note: '보상' }))
  expect(await screen.findByText('반영했어요. kane 잔액 600 JWD')).toBeTruthy()
  expect(rpcMock.mock.calls.filter((c) => c[0] === 'admin_gold_ledger')).toHaveLength(2)
})

test.each([
  ['not_found', '없는 아이디예요'],
  ['not_enough_gold', '잔액보다 많이 뺄 수 없어요'],
  ['note_invalid', '메모를 1~100자로 적어 주세요'],
])('오류 %s → %s', async (code, text) => {
  rpcMock.mockImplementation(async (name: string) => {
    if (name === 'admin_gold_ledger') return []
    throw new ApiError(code, 400)
  })
  render(<AdminGoldSection />)
  fireEvent.change(screen.getByLabelText('아이디'), { target: { value: 'kane' } })
  fireEvent.change(screen.getByLabelText('금액'), { target: { value: '-100' } })
  fireEvent.change(screen.getByLabelText('메모'), { target: { value: 'x' } })
  fireEvent.click(screen.getByRole('button', { name: '반영' }))
  expect(await screen.findByText(text)).toBeTruthy()
})

test.each(['1.5', '1e3', '0x10', '0', '+5', '9'.repeat(20)])('금액 %s는 보내지 않는다(0이 아닌 일반 정수만)', async (value) => {
  render(<AdminGoldSection />)
  fireEvent.change(screen.getByLabelText('아이디'), { target: { value: 'kane' } })
  fireEvent.change(screen.getByLabelText('금액'), { target: { value } })
  fireEvent.change(screen.getByLabelText('메모'), { target: { value: 'x' } })
  fireEvent.click(screen.getByRole('button', { name: '반영' }))
  expect(await screen.findByText('금액은 0이 아닌 정수로 적어 주세요')).toBeTruthy()
  expect(rpcMock).not.toHaveBeenCalledWith('admin_gold_adjust', expect.anything())
})

test('kstShort', () => {
  expect(kstShort('2026-11-23T15:00:00Z')).toBe('11.24 00:00')
})

test('이유 라벨은 마이그레이션의 마지막 gold_ledger reason 검사와 같은 목록', () => {
  const files = import.meta.glob('../../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<
    string,
    string
  >
  let reasons: string[] = []
  for (const name of Object.keys(files).sort()) {
    for (const m of files[name].matchAll(/reason\s+in\s*\(([^)]*)\)\s*\)/gi)) {
      const list = [...m[1].matchAll(/'([^']*)'/g)].map((v) => v[1])
      if (list.includes('admin')) reasons = list
    }
  }
  expect(reasons).toContain('shop')
  expect(Object.keys(REASON_LABEL).sort()).toEqual([...reasons].sort())
  expect(REASON_LABEL.shop).toBe('상점')
})

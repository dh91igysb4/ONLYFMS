import { beforeEach, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('../../lib/supabase.ts', () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a), auth: { getSession: async () => ({ data: { session: null } }) } },
  supabaseUrl: 'http://sb.test',
  supabaseKey: 'pub',
}))

import { buyItem, equipItem, fetchMyItems } from './api.ts'

beforeEach(() => rpcMock.mockReset())

test('fetchMyItems: my_items 행을 가진 목록과 고른 품목으로 바꾼다', async () => {
  rpcMock.mockResolvedValue({ data: [{ item_id: 'pickup', equipped: false }, { item_id: 'f1', equipped: true }], error: null })
  expect(await fetchMyItems('neon-rider')).toEqual({ owned: ['pickup', 'f1'], equipped: 'f1' })
  expect(rpcMock).toHaveBeenCalledWith('my_items', { p_game: 'neon-rider' })
})

test('fetchMyItems: 행이 없으면 빈 목록, 고른 것 없음', async () => {
  rpcMock.mockResolvedValue({ data: [], error: null })
  expect(await fetchMyItems('g')).toEqual({ owned: [], equipped: null })
})

test('buyItem: buy_item을 부르고 잔액을 돌려준다', async () => {
  rpcMock.mockResolvedValue({ data: { balance: 7000 }, error: null })
  expect(await buyItem('neon-rider', 'pickup', 5000)).toEqual({ balance: 7000 })
  expect(rpcMock).toHaveBeenCalledWith('buy_item', { p_game: 'neon-rider', p_item: 'pickup', p_price: 5000 })
})

test('buyItem: 서버 오류 코드를 message로 던진다', async () => {
  rpcMock.mockResolvedValue({ data: null, error: { message: 'not_enough_gold', code: 'P0001', details: null } })
  await expect(buyItem('g', 'i', 10)).rejects.toThrow('not_enough_gold')
})

test('equipItem: equip_item을 부르고, 오류 코드를 던진다', async () => {
  rpcMock.mockResolvedValue({ data: null, error: null })
  await equipItem('neon-rider', 'f1')
  expect(rpcMock).toHaveBeenCalledWith('equip_item', { p_game: 'neon-rider', p_item: 'f1' })
  rpcMock.mockResolvedValue({ data: null, error: { message: 'not_owned', code: 'P0001', details: null } })
  await expect(equipItem('neon-rider', 'f1')).rejects.toThrow('not_owned')
})

test('buyItem: 응답이 비었거나 잔액이 숫자가 아니면 bad_response', async () => {
  rpcMock.mockResolvedValue({ data: {}, error: null })
  await expect(buyItem('g', 'x', 1)).rejects.toThrow('bad_response')
  rpcMock.mockResolvedValue({ data: { balance: 'abc' }, error: null })
  await expect(buyItem('g', 'x', 1)).rejects.toThrow('bad_response')
})

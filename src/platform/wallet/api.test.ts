import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('../../lib/supabase.ts', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  },
  supabaseUrl: 'http://sb.test',
  supabaseKey: 'pub',
}))

import { getPrizes, getWallet, resetWallet, setBalance } from '../../lib/walletStore.ts'
import { world, type ApiError } from '../../lib/api.ts'
import {
  adminGoldAdjust, adminGoldLedger, fetchContestPrizes, fetchMyWallet, fetchUserFreeBonus, fetchUserPrizeTotal, fetchUserWallet,
} from './api.ts'
import { refreshWallet } from './useWallet.ts'

beforeEach(() => rpcMock.mockReset())
afterEach(() => {
  resetWallet()
  vi.unstubAllGlobals()
})

test('fetchMyWallet: my_wallet 결과로 저장소를 채운다', async () => {
  rpcMock.mockResolvedValue({ data: { balance: 1234, today: { a: 100 }, earned_today: 31000 }, error: null })
  const w = await fetchMyWallet()
  expect(rpcMock).toHaveBeenCalledWith('my_wallet', undefined)
  expect(w).toEqual({ balance: 1234, today: { a: 100 }, earnedToday: 31000, freeBonusPct: 0 })
  expect(getWallet()).toEqual({ balance: 1234, today: { a: 100 }, earnedToday: 31000, freeBonusPct: 0 })
})

test('fetchMyWallet: free_bonus_pct(도전과제 보너스)를 저장소에 넣는다(문자열 숫자 포함)', async () => {
  rpcMock.mockResolvedValue({ data: { balance: 1, free_bonus_pct: '140' }, error: null })
  expect((await fetchMyWallet()).freeBonusPct).toBe(140)
  expect(getWallet().freeBonusPct).toBe(140)
})

test('fetchUserFreeBonus: user_free_bonus, null은 null', async () => {
  rpcMock.mockResolvedValueOnce({ data: 220, error: null })
  expect(await fetchUserFreeBonus('kim')).toBe(220)
  expect(rpcMock).toHaveBeenCalledWith('user_free_bonus', { p_handle: 'kim' })
  rpcMock.mockResolvedValueOnce({ data: null, error: null })
  expect(await fetchUserFreeBonus('nobody')).toBeNull()
})

test('fetchMyWallet: earned_today·today가 없으면 0·{}', async () => {
  rpcMock.mockResolvedValue({ data: { balance: 5 }, error: null })
  expect(await fetchMyWallet()).toEqual({ balance: 5, today: {}, earnedToday: 0, freeBonusPct: 0 })
})

test('refreshWallet: 실패는 삼키고 이전 값을 유지한다', async () => {
  setBalance(9)
  rpcMock.mockResolvedValue({ data: null, error: { message: 'boom', code: 'XX000' } })
  await expect(refreshWallet()).resolves.toBeUndefined()
  expect(getWallet().balance).toBe(9)
})

test('fetchUserWallet: user_wallet(p_handle), null 그대로', async () => {
  rpcMock.mockResolvedValue({ data: 5000, error: null })
  expect(await fetchUserWallet('kane')).toBe(5000)
  expect(rpcMock).toHaveBeenCalledWith('user_wallet', { p_handle: 'kane' })
  rpcMock.mockResolvedValue({ data: null, error: null })
  expect(await fetchUserWallet('nobody')).toBeNull()
})

test('fetchUserWallet: 문자열 bigint도 숫자로', async () => {
  rpcMock.mockResolvedValue({ data: '42', error: null })
  expect(await fetchUserWallet('kane')).toBe(42)
})

test('adminGoldAdjust: 인자 이름과 오류 코드', async () => {
  rpcMock.mockResolvedValue({ data: 600, error: null })
  expect(await adminGoldAdjust('kane', 100, '보상')).toBe(600)
  expect(rpcMock).toHaveBeenCalledWith('admin_gold_adjust', { p_handle: 'kane', p_delta: 100, p_note: '보상' })
  rpcMock.mockResolvedValue({ data: null, error: { message: 'not_enough_gold', code: 'P0001' } })
  await expect(adminGoldAdjust('kane', -1e6, '회수')).rejects.toMatchObject({ code: 'not_enough_gold' } satisfies Partial<ApiError>)
})

test('adminGoldLedger: p_limit, 숫자 변환', async () => {
  rpcMock.mockResolvedValue({
    data: [{ id: 1, handle: 'kane', delta: '500', balance_after: '500', reason: 'admin', ref: 'x', game_id: null,
             note: '보상', raw_delta: null, created_at: '2026-11-24T00:00:00Z' }],
    error: null,
  })
  const rows = await adminGoldLedger(10)
  expect(rpcMock).toHaveBeenCalledWith('admin_gold_ledger', { p_limit: 10 })
  expect(rows[0]).toMatchObject({ handle: 'kane', delta: 500, balanceAfter: 500, rawDelta: null, gameId: null, note: '보상' })
})

test('world(): 응답 gold를 저장소에 넣는다, 없으면 그대로', async () => {
  setBalance(1)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ view: {}, result: null, server_now: 1, gold: 77 }), { status: 200 })))
  await world({ game: 'g', action: 'load' })
  expect(getWallet().balance).toBe(77)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ view: { gold: 3 }, result: null, server_now: 1 }), { status: 200 })))
  await world({ game: 'g', action: 'load' })
  expect(getWallet().balance).toBe(77)
})

test('fetchMyWallet: 요청 중 world 잔액이 들어오면 늦은 my_wallet이 잔액을 덮지 않는다', async () => {
  let resolve!: (v: unknown) => void
  rpcMock.mockReturnValue(new Promise((r) => { resolve = r }))
  const p = fetchMyWallet()
  setBalance(500) // world 응답(지연 이전 뒤 잔액)이 먼저 도착
  resolve({ data: { balance: 0, today: { a: 1 }, earned_today: 7 }, error: null })
  expect(await p).toEqual({ balance: 500, today: { a: 1 }, earnedToday: 7, freeBonusPct: 0 })
  expect(getWallet()).toEqual({ balance: 500, today: { a: 1 }, earnedToday: 7, freeBonusPct: 0 })
})

// ---- 받은 상금 (지갑 3단계) ----
test('fetchMyWallet: prizes를 상금 저장소에 넣는다(문자열 숫자 포함)', async () => {
  rpcMock.mockResolvedValue({
    data: { balance: 1, today: {}, earned_today: 0, prizes: [
      { id: '12', reason: 'daily_prize', contest_id: 'c1', game_id: 'who-are-ya', amount: '6150', note: '1등', at: '2026-11-25T00:00:00Z' },
    ] },
    error: null,
  })
  const w = await fetchMyWallet()
  expect(w).toEqual({ balance: 1, today: {}, earnedToday: 0, freeBonusPct: 0 })
  expect(getPrizes()).toEqual([
    { id: 12, reason: 'daily_prize', contestId: 'c1', gameId: 'who-are-ya', amount: 6150, note: '1등', at: '2026-11-25T00:00:00Z' },
  ])
})

test('fetchMyWallet: prizes가 없는 응답(2단계 DB)이면 빈 목록', async () => {
  rpcMock.mockResolvedValue({ data: { balance: 1 }, error: null })
  await fetchMyWallet()
  expect(getPrizes()).toEqual([])
})

test('fetchContestPrizes: contest_prizes(p_contest), 숫자 변환', async () => {
  rpcMock.mockResolvedValue({ data: [{ user_id: 'u1', handle: 'kane', amount: '6150', note: '1등' }], error: null })
  expect(await fetchContestPrizes('c1')).toEqual([{ userId: 'u1', handle: 'kane', amount: 6150, note: '1등' }])
  expect(rpcMock).toHaveBeenCalledWith('contest_prizes', { p_contest: 'c1' })
  rpcMock.mockResolvedValue({ data: null, error: null })
  expect(await fetchContestPrizes('c1')).toEqual([])
})

test('fetchUserPrizeTotal: user_prize_total(p_handle), null 그대로', async () => {
  rpcMock.mockResolvedValue({ data: '12300', error: null })
  expect(await fetchUserPrizeTotal('kane')).toBe(12300)
  expect(rpcMock).toHaveBeenCalledWith('user_prize_total', { p_handle: 'kane' })
  rpcMock.mockResolvedValue({ data: null, error: null })
  expect(await fetchUserPrizeTotal('nobody')).toBeNull()
})

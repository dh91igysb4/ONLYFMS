import { afterEach, expect, test, vi } from 'vitest'
import { getWallet, resetWallet, setBalance, setWallet, subscribeWallet } from './walletStore.ts'

afterEach(() => resetWallet())

test('처음에는 잔액을 모른다', () => {
  expect(getWallet()).toEqual({ balance: null, today: {}, earnedToday: 0, freeBonusPct: 0 })
})

test('setWallet은 구독자를 부르고 값을 바꾼다', () => {
  const fn = vi.fn()
  const off = subscribeWallet(fn)
  setWallet({ balance: 1234, today: { a: 10 }, earnedToday: 500 })
  expect(fn).toHaveBeenCalledTimes(1)
  expect(getWallet()).toEqual({ balance: 1234, today: { a: 10 }, earnedToday: 500, freeBonusPct: 0 })
  off()
  setWallet({ balance: 1, today: {}, earnedToday: 0 })
  expect(fn).toHaveBeenCalledTimes(1)
})

test('setBalance는 today·earnedToday를 그대로 둔다', () => {
  setWallet({ balance: 10, today: { a: 3 }, earnedToday: 7 })
  const before = getWallet()
  setBalance(77)
  expect(getWallet()).toEqual({ balance: 77, today: { a: 3 }, earnedToday: 7, freeBonusPct: 0 })
  expect(getWallet()).not.toBe(before) // useSyncExternalStore가 바뀐 것을 알도록 새 객체
})

test('같은 잔액이면 구독자를 부르지 않는다', () => {
  setBalance(5)
  const fn = vi.fn()
  subscribeWallet(fn)
  setBalance(5)
  expect(fn).not.toHaveBeenCalled()
})

test('resetWallet은 처음 상태로 되돌리고 알린다', () => {
  setWallet({ balance: 10, today: { a: 3 }, earnedToday: 7 })
  const fn = vi.fn()
  subscribeWallet(fn)
  resetWallet()
  expect(fn).toHaveBeenCalledTimes(1)
  expect(getWallet()).toEqual({ balance: null, today: {}, earnedToday: 0, freeBonusPct: 0 })
})

test('상한 알림 구독', async () => {
  const { notifyGoldCapped, subscribeGoldCapped } = await import('./walletStore.ts')
  const fn = vi.fn()
  const off = subscribeGoldCapped(fn)
  notifyGoldCapped({ asked: 1000, got: 800 })
  expect(fn).toHaveBeenCalledWith({ asked: 1000, got: 800 })
  off()
  notifyGoldCapped({ asked: 1, got: 0 })
  expect(fn).toHaveBeenCalledTimes(1)
})

// ---- 받은 상금 (지갑 3단계) ----
const prize = (id: number, amount = 6150) => ({
  id, reason: 'daily_prize' as const, contestId: `c${id}`, gameId: 'who-are-ya', amount, note: '1등', at: '2026-11-25T00:00:00Z',
})

test('상금 목록: setPrizes → 구독자, resetWallet이 비운다', async () => {
  const { getPrizes, setPrizes, subscribePrizes } = await import('./walletStore.ts')
  expect(getPrizes()).toEqual([])
  const fn = vi.fn()
  const off = subscribePrizes(fn)
  setPrizes([prize(1)])
  expect(fn).toHaveBeenCalledTimes(1)
  expect(getPrizes()).toEqual([prize(1)])
  resetWallet()
  expect(getPrizes()).toEqual([])
  off()
})

test('unseenPrizes·markPrizesSeen: 사용자별로 확인한 가장 큰 장부 id를 기억한다', async () => {
  const { markPrizesSeen, unseenPrizes } = await import('./walletStore.ts')
  localStorage.clear()
  const list = [prize(12), prize(10)]
  expect(unseenPrizes('u1', list)).toEqual(list)
  markPrizesSeen('u1', [prize(10)])
  expect(unseenPrizes('u1', list)).toEqual([prize(12)])
  markPrizesSeen('u1', list)
  expect(unseenPrizes('u1', list)).toEqual([])
  // 더 작은 id로 되돌리지 않는다
  markPrizesSeen('u1', [prize(3)])
  expect(unseenPrizes('u1', list)).toEqual([])
  // 다른 사용자는 따로
  expect(unseenPrizes('u2', list)).toEqual(list)
})

test('unseenPrizes·markPrizesSeen: localStorage가 던져도 던지지 않는다', async () => {
  const { markPrizesSeen, unseenPrizes } = await import('./walletStore.ts')
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  expect(unseenPrizes('u1', [prize(1)])).toEqual([prize(1)])
  expect(() => markPrizesSeen('u1', [prize(1)])).not.toThrow()
  get.mockRestore()
  set.mockRestore()
})

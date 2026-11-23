import { afterEach, expect, test, vi } from 'vitest'
import { getWallet, resetWallet, setBalance, setWallet, subscribeWallet } from './walletStore.ts'

afterEach(() => resetWallet())

test('처음에는 잔액을 모른다', () => {
  expect(getWallet()).toEqual({ balance: null, today: {}, earnedToday: 0 })
})

test('setWallet은 구독자를 부르고 값을 바꾼다', () => {
  const fn = vi.fn()
  const off = subscribeWallet(fn)
  setWallet({ balance: 1234, today: { a: 10 }, earnedToday: 500 })
  expect(fn).toHaveBeenCalledTimes(1)
  expect(getWallet()).toEqual({ balance: 1234, today: { a: 10 }, earnedToday: 500 })
  off()
  setWallet({ balance: 1, today: {}, earnedToday: 0 })
  expect(fn).toHaveBeenCalledTimes(1)
})

test('setBalance는 today·earnedToday를 그대로 둔다', () => {
  setWallet({ balance: 10, today: { a: 3 }, earnedToday: 7 })
  const before = getWallet()
  setBalance(77)
  expect(getWallet()).toEqual({ balance: 77, today: { a: 3 }, earnedToday: 7 })
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
  expect(getWallet()).toEqual({ balance: null, today: {}, earnedToday: 0 })
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

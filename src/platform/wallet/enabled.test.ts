import { expect, test, vi } from 'vitest'

const reg = vi.hoisted(() => ({ worlds: [] as { logic: { wallet?: boolean } }[] }))
vi.mock('../../games/index.ts', () => ({
  get worlds() { return reg.worlds },
}))

import { walletEnabled } from './enabled.ts'

test('지갑 게임이 없으면 false, 하나라도 wallet: true면 true', () => {
  reg.worlds = []
  expect(walletEnabled()).toBe(false)
  reg.worlds = [{ logic: {} }, { logic: { wallet: false } }]
  expect(walletEnabled()).toBe(false)
  reg.worlds = [{ logic: {} }, { logic: { wallet: true } }]
  expect(walletEnabled()).toBe(true)
})

import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { now, resetServerTime, syncFromView } from './serverTime.ts'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); resetServerTime() })
afterEach(() => { vi.useRealTimers() })

test('keeps the sample with the least delay (server_now is stamped before the reply travels)', () => {
  // 실제 서버 시각 = 브라우저 + 500. 응답이 늦을수록 표본은 작게 나온다
  syncFromView(Date.now() + 500 - 120)
  expect(now()).toBe(Date.now() + 380)
  syncFromView(Date.now() + 500 - 30)
  expect(now()).toBe(Date.now() + 470)
  // 더 늦은 표본은 시계를 뒤로 돌리지 않는다(최종 리뷰 I3: 5초마다 흔들려 차가 끊기지 않게)
  syncFromView(Date.now() + 500 - 300)
  expect(now()).toBe(Date.now() + 470)
})

test('a big jump (the device clock was changed) is taken as is', () => {
  syncFromView(Date.now() + 500)
  syncFromView(Date.now() - 20_000)
  expect(now()).toBe(Date.now() - 20_000)
})

test('the first sample is taken as is', () => {
  syncFromView(Date.now() - 3000)
  expect(now()).toBe(Date.now() - 3000)
})

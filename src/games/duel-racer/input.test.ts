import { expect, test } from 'vitest'
import { GAME_KEYS, controlsFrom } from './input.ts'

const keys = (...k: string[]) => new Set(k)

test('up arrow / W is throttle, down / S is brake', () => {
  expect(controlsFrom(keys('ArrowUp')).throttle).toBe(1)
  expect(controlsFrom(keys('KeyW')).throttle).toBe(1)
  expect(controlsFrom(keys('ArrowDown')).brake).toBe(1)
  expect(controlsFrom(keys('KeyS')).brake).toBe(1)
})

test('right arrow / D steers right, A and D cancel', () => {
  expect(controlsFrom(keys('ArrowRight')).steer).toBe(1)
  expect(controlsFrom(keys('KeyD')).steer).toBe(1)
  expect(controlsFrom(keys('ArrowLeft')).steer).toBe(-1)
  expect(controlsFrom(keys('KeyA', 'KeyD')).steer).toBe(0)
})

test('shift is nitro', () => {
  expect(controlsFrom(keys('ShiftLeft')).nitro).toBe(true)
  expect(controlsFrom(keys('ShiftRight')).nitro).toBe(true)
})

test('game keys are driving keys only (no drift or air spin keys)', () => {
  for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight']) {
    expect(GAME_KEYS.has(k)).toBe(true)
  }
  for (const k of ['KeyQ', 'KeyE', 'KeyR', 'Escape']) expect(GAME_KEYS.has(k)).toBe(false)
})

test('space only blocks page scroll and does nothing to the car', () => {
  expect(controlsFrom(keys('Space'))).toEqual(controlsFrom(keys()))
})

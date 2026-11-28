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

test('air: W/S tilt the car (W = nose down), A/D turn it (D = right), no steering', () => {
  expect(controlsFrom(keys('KeyW'), true).pitch).toBe(1)
  expect(controlsFrom(keys('ArrowDown'), true).pitch).toBe(-1)
  const d = controlsFrom(keys('KeyD'), true)
  expect(d.yaw).toBe(1)
  expect(d.steer).toBe(0)
  expect(controlsFrom(keys('ArrowLeft'), true).yaw).toBe(-1)
})

test('ground: no air controls', () => {
  const c = controlsFrom(keys('KeyW', 'KeyD'), false)
  expect(c.pitch).toBe(0)
  expect(c.yaw).toBe(0)
  expect(c.steer).toBe(1)
})

test('air: W held since the ground does not tilt; pressing it again in the air does', () => {
  // airKeys = 공중에 뜬 뒤 새로 누른 키
  expect(controlsFrom(keys('KeyW'), true, keys()).pitch).toBe(0)
  expect(controlsFrom(keys('KeyW'), true, keys()).throttle).toBe(1)
  expect(controlsFrom(keys('KeyW'), true, keys('KeyW')).pitch).toBe(1)
  expect(controlsFrom(keys('ArrowDown'), true, keys('ArrowDown')).pitch).toBe(-1)
})

test('air: A/D turn even if held since the ground', () => {
  expect(controlsFrom(keys('KeyD'), true, keys()).yaw).toBe(1)
})

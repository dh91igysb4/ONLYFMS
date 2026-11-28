import { expect, test } from 'vitest'
import { GAME_KEYS, controlsFrom } from './input.ts'

const keys = (...k: string[]) => new Set(k)

test('ground: up arrow is throttle, not pitch', () => {
  const c = controlsFrom(keys('ArrowUp'), false)
  expect(c.throttle).toBe(1)
  expect(c.pitch).toBe(0)
})

test('air: up arrow also pitches forward', () => {
  const c = controlsFrom(keys('ArrowUp'), true)
  expect(c.throttle).toBe(1)
  expect(c.pitch).toBe(1)
})

test('air: left arrow rolls instead of steering', () => {
  const c = controlsFrom(keys('ArrowLeft'), true)
  expect(c.steer).toBe(0)
  expect(c.roll).toBe(-1)
})

test('ground: right arrow / D steers right', () => {
  expect(controlsFrom(keys('ArrowRight'), false).steer).toBe(1)
  expect(controlsFrom(keys('KeyD'), false).steer).toBe(1)
})

test('A and D together cancel', () => {
  expect(controlsFrom(keys('KeyA', 'KeyD'), false).steer).toBe(0)
})

test('W/S, space, shift and Q/E', () => {
  expect(controlsFrom(keys('KeyW'), false).throttle).toBe(1)
  expect(controlsFrom(keys('KeyS'), false).brake).toBe(1)
  expect(controlsFrom(keys('Space'), false).handbrake).toBe(true)
  expect(controlsFrom(keys('ShiftLeft'), false).nitro).toBe(true)
  expect(controlsFrom(keys('ShiftRight'), false).nitro).toBe(true)
  expect(controlsFrom(keys('KeyE'), true).yaw).toBe(1)
  expect(controlsFrom(keys('KeyQ'), true).yaw).toBe(-1)
  expect(controlsFrom(keys('KeyQ'), false).yaw).toBe(0)
})

test('air: down arrow pitches back', () => {
  expect(controlsFrom(keys('ArrowDown'), true).pitch).toBe(-1)
})

test('game keys include driving keys but not R or Escape', () => {
  for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyQ', 'KeyE']) {
    expect(GAME_KEYS.has(k)).toBe(true)
  }
  expect(GAME_KEYS.has('KeyR')).toBe(false)
  expect(GAME_KEYS.has('Escape')).toBe(false)
})

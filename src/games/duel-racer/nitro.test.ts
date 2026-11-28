import { expect, test } from 'vitest'
import { NITRO_BURN_PER_SEC, NITRO_REGEN_DELAY, NITRO_REGEN_PER_SEC } from './constants.ts'
import { NITRO_START, stepNitro, type Nitro } from './nitro.ts'

const DT = 1 / 60
const hold = (n: Nitro, want: boolean, seconds: number) => {
  for (let k = 0; k < Math.round(seconds / DT); k++) n = stepNitro(n, want, DT)
  return n
}

test('starts empty', () => {
  expect(NITRO_START.gauge).toBe(0)
})

test('nothing refills before NITRO_REGEN_DELAY', () => {
  expect(hold(NITRO_START, false, NITRO_REGEN_DELAY - 0.1).gauge).toBe(0)
})

test('after the delay it refills at NITRO_REGEN_PER_SEC', () => {
  const n = hold(NITRO_START, false, NITRO_REGEN_DELAY + 2)
  expect(n.gauge).toBeCloseTo(2 * NITRO_REGEN_PER_SEC, 2)
})

test('burning drains at NITRO_BURN_PER_SEC and stops at empty', () => {
  let n: Nitro = { gauge: 0.1, burning: false, idle: 10 }
  n = stepNitro(n, true, DT)
  expect(n.burning).toBe(true)
  expect(n.gauge).toBeCloseTo(0.1 - NITRO_BURN_PER_SEC * DT, 6)
  n = hold(n, true, 1)
  expect(n.gauge).toBe(0)
  expect(n.burning).toBe(false)
})

test('using it restarts the refill delay', () => {
  let n: Nitro = { gauge: 0.5, burning: false, idle: 10 }
  n = hold(n, true, 0.5)
  const after = n.gauge
  n = hold(n, false, NITRO_REGEN_DELAY - 0.1)
  expect(n.gauge).toBeCloseTo(after, 6)
  n = hold(n, false, 1)
  expect(n.gauge).toBeGreaterThan(after)
})

test('holding the key on an empty gauge does not count as idle', () => {
  const n = hold({ gauge: 0, burning: false, idle: 0 }, true, NITRO_REGEN_DELAY + 2)
  expect(n.gauge).toBe(0)
})

test('gauge never exceeds 1', () => {
  expect(hold({ gauge: 0.99, burning: false, idle: 10 }, false, 5).gauge).toBe(1)
})

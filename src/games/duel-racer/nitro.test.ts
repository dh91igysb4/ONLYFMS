import { expect, test } from 'vitest'
import { NITRO_BURN_PER_SEC, NITRO_CLEAN_LANDING, NITRO_PER_AIR_SEC, NITRO_PER_DRIFT_SEC, NITRO_PER_FLIP } from './constants.ts'
import { NITRO_START, stepNitro, type Nitro } from './nitro.ts'

const DT = 1 / 60
const idle = { want: false, airborne: false, drifting: false, landed: null }

test('airtime, flips and clean landing fill the gauge', () => {
  let n: Nitro = NITRO_START
  for (let k = 0; k < 60; k++) n = stepNitro(n, { ...idle, airborne: true }, DT)
  n = stepNitro(n, { ...idle, landed: { airTime: 1, flips: 1, clean: true } }, DT)
  expect(n.gauge).toBeCloseTo(NITRO_START.gauge + NITRO_PER_AIR_SEC + NITRO_PER_FLIP + NITRO_CLEAN_LANDING, 5)
})

test('rough landing gives flips but no clean bonus', () => {
  const n = stepNitro(NITRO_START, { ...idle, landed: { airTime: 1, flips: 2, clean: false } }, DT)
  expect(n.gauge).toBeCloseTo(NITRO_START.gauge + 2 * NITRO_PER_FLIP, 5)
})

test('drifting fills slowly', () => {
  let n: Nitro = NITRO_START
  for (let k = 0; k < 60; k++) n = stepNitro(n, { ...idle, drifting: true }, DT)
  expect(n.gauge).toBeCloseTo(NITRO_START.gauge + NITRO_PER_DRIFT_SEC, 5)
})

test('burning drains at NITRO_BURN_PER_SEC and stops at empty', () => {
  let n: Nitro = { gauge: 0.1, burning: false }
  n = stepNitro(n, { ...idle, want: true }, DT)
  expect(n.burning).toBe(true)
  expect(n.gauge).toBeCloseTo(0.1 - NITRO_BURN_PER_SEC * DT, 6)
  for (let k = 0; k < 60; k++) n = stepNitro(n, { ...idle, want: true }, DT)
  expect(n.gauge).toBe(0)
  expect(n.burning).toBe(false)
})

test('letting go stops burning', () => {
  const n = stepNitro({ gauge: 0.5, burning: true }, idle, DT)
  expect(n.burning).toBe(false)
  expect(n.gauge).toBe(0.5)
})

test('gauge never exceeds 1', () => {
  const n = stepNitro({ gauge: 0.95, burning: false }, { ...idle, landed: { airTime: 2, flips: 3, clean: true } }, DT)
  expect(n.gauge).toBe(1)
})

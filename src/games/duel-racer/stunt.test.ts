import { expect, test } from 'vitest'
import { AIR_IDLE, trackAir, type AirTrack } from './stunt.ts'

const DT = 1 / 60
const air = (pitchRate: number, rollRate = 0) => ({ grounded: false, localAngVel: { x: pitchRate, y: 0, z: rollRate }, upY: 1 })
const land = (upY = 1) => ({ grounded: true, localAngVel: { x: 0, y: 0, z: 0 }, upY })

/** seconds 동안 rate(rad/s)로 돌며 날다가 착지 */
function flight(seconds: number, pitchRate: number, rollRate = 0, upY = 1) {
  let t: AirTrack = AIR_IDLE
  const n = Math.round(seconds / DT)
  for (let k = 0; k < n; k++) t = trackAir(t, air(pitchRate, rollRate), DT).track
  return trackAir(t, land(upY), DT).landed
}

test('one full pitch rotation counts one flip', () => {
  const r = flight(1, 2 * Math.PI + 0.1)
  expect(r?.flips).toBe(1)
})

test('350 degrees is not a flip', () => {
  expect(flight(1, (350 * Math.PI) / 180)?.flips).toBe(0)
})

test('backflips count too', () => {
  expect(flight(1, -(2 * Math.PI + 0.1))?.flips).toBe(1)
})

test('pitch and roll flips add', () => {
  expect(flight(1, 2 * Math.PI + 0.1, 2 * Math.PI + 0.1)?.flips).toBe(2)
})

test('short hops are ignored', () => {
  expect(flight(0.2, 0)).toBeNull()
})

test('airTime is reported on landing', () => {
  expect(flight(1, 0)?.airTime).toBeCloseTo(1, 1)
})

test('clean landing needs upright car', () => {
  expect(flight(1, 0, 0, 0.95)?.clean).toBe(true)
  expect(flight(1, 0, 0, 0.3)?.clean).toBe(false)
})

test('track resets after landing', () => {
  let t: AirTrack = AIR_IDLE
  for (let k = 0; k < 60; k++) t = trackAir(t, air(7), DT).track
  t = trackAir(t, land(), DT).track
  expect(t).toEqual(AIR_IDLE)
})

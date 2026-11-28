import { beforeAll, expect, test } from 'vitest'
import { CAR_HALF, GHOST_EXTRAP_MAX_MS, GHOST_MARGIN, SPIN_KICK, TICK_HZ } from '../constants.ts'
import { flatCourse } from '../course/testCourses.ts'
import type { StatePacket } from '../net/codec.ts'
import { advance, COUNTDOWN_TICKS, createRace, type Race } from '../race.ts'
import { carState, resetCar } from './car.ts'
import { NO_CONTROLS } from './controls.ts'
import { createOpponent, placeOpponent, receiveState, resolveContact, type Opponent } from './opponent.ts'
import { loadRapier, type Rapier } from './rapier.ts'

let R: Rapier
beforeAll(async () => { R = await loadRapier() })
const TICK_MS = 1000 / TICK_HZ
const Q0 = { x: 0, y: 0, z: 0, w: 1 }

function setup(): { race: Race; opp: Opponent } {
  const race = createRace(R, flatCourse())
  race.elapsed = COUNTDOWN_TICKS // 출발한 상태에서 시작
  resetCar(race.car, { pos: { x: 0, y: 1.2, z: 100 }, yaw: 0 })
  advance(race, 30 * TICK_MS, NO_CONTROLS) // 바닥에 내려앉게
  return { race, opp: createOpponent(race.pw) }
}
const pkt = (tick: number, pos: StatePacket['pos'], vel: StatePacket['vel']): StatePacket =>
  ({ kind: 'state', tick, pos, quat: Q0, vel, nitro: false })

/** 상대를 놓고 한 틱 돌린 뒤 충돌을 푼다 */
function stepWith(race: Race, opp: Opponent, tick: number) {
  placeOpponent(opp, tick)
  advance(race, TICK_MS, NO_CONTROLS)
  return resolveContact(opp, race.car, tick)
}

test('ghost body is the car box enlarged by GHOST_MARGIN', () => {
  const { opp } = setup()
  const he = opp.collider.halfExtents()!
  expect(he.x).toBeCloseTo(CAR_HALF.x + GHOST_MARGIN)
  expect(he.z).toBeCloseTo(CAR_HALF.z + GHOST_MARGIN)
  expect(opp.collider.isSensor()).toBe(true)
})

test('a faster opponent rear-ending me pushes me forward (equal-mass impulse)', () => {
  const { race, opp } = setup()
  const me = carState(race.car)
  receiveState(opp, pkt(50, { x: me.pos.x, y: me.pos.y, z: me.pos.z - 4.2 }, { x: 0, y: 0, z: 20 }), 50)
  const r = stepWith(race, opp, 50)
  expect(r).toBe('hit')
  const v = carState(race.car).vel.z
  // (1 + 0.35) / 2 × 20 = 13.5 m/s 가까이
  expect(v).toBeGreaterThan(10)
  expect(v).toBeLessThan(16)
})

test('a side hit above SPIN_HIT_SPEED spins me; a slow side touch does not', () => {
  const a = setup()
  const me = carState(a.race.car)
  receiveState(a.opp, pkt(50, { x: me.pos.x - 2.1, y: me.pos.y, z: me.pos.z }, { x: 9, y: 0, z: 0 }), 50)
  expect(stepWith(a.race, a.opp, 50)).toBe('spin')
  expect(Math.abs(carState(a.race.car).angVel.y)).toBeGreaterThan(SPIN_KICK * 0.7)

  const b = setup()
  const me2 = carState(b.race.car)
  receiveState(b.opp, pkt(50, { x: me2.pos.x - 2.1, y: me2.pos.y, z: me2.pos.z }, { x: 2, y: 0, z: 0 }), 50)
  expect(stepWith(b.race, b.opp, 50)).toBe('hit')
  expect(Math.abs(carState(b.race.car).angVel.y)).toBeLessThan(1)
})

test('extrapolation adds one tick and caps at GHOST_EXTRAP_MAX_MS', () => {
  const { opp } = setup()
  receiveState(opp, pkt(10, { x: 50, y: 1, z: 100 }, { x: 0, y: 0, z: 30 }), 12)
  const p = placeOpponent(opp, 13)!
  expect(p.fresh).toBe(true)
  expect(p.pose.pos.z).toBeCloseTo(100 + 30 * (4 / TICK_HZ), 5) // (13 - 10 + 1)틱
  const capped = placeOpponent(opp, 40)!
  expect(capped.pose.pos.z).toBeCloseTo(100 + 30 * GHOST_EXTRAP_MAX_MS / 1000, 5)
  // 늦게 온 옛 패킷은 무시한다(순서 없는 전송)
  receiveState(opp, pkt(5, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }), 41)
  expect(placeOpponent(opp, 41)!.pose.pos.x).toBe(50)
})

test('stale opponent (>1s) is not fresh and never collides', () => {
  const { race, opp } = setup()
  const me = carState(race.car)
  receiveState(opp, pkt(0, { x: me.pos.x, y: me.pos.y, z: me.pos.z - 4.2 }, { x: 0, y: 0, z: 0 }), 0)
  const p = placeOpponent(opp, TICK_HZ + 1)!
  expect(p.fresh).toBe(false)
  advance(race, TICK_MS, NO_CONTROLS)
  expect(resolveContact(opp, race.car, TICK_HZ + 1)).toBe('none')
  expect(Math.abs(carState(race.car).vel.z)).toBeLessThan(0.5)
})

test('no contact when apart, and nothing before the first packet', () => {
  const { race, opp } = setup()
  expect(placeOpponent(opp, 0)).toBeNull()
  advance(race, TICK_MS, NO_CONTROLS)
  expect(resolveContact(opp, race.car, 0)).toBe('none')
  const me = carState(race.car)
  receiveState(opp, pkt(50, { x: me.pos.x + 10, y: me.pos.y, z: me.pos.z }, { x: 0, y: 0, z: 0 }), 50)
  expect(stepWith(race, opp, 50)).toBe('none')
})

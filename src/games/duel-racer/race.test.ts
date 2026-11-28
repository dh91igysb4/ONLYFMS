import { beforeAll, expect, test } from 'vitest'
import { FALL_Y, NITRO_REGEN_DELAY, NITRO_REGEN_PER_SEC, STUCK_SECONDS, TICK_HZ, TOP_SPEED } from './constants.ts'
import { flatCourse, hairpinCourse } from './course/testCourses.ts'
import { NO_CONTROLS, type Controls } from './physics/controls.ts'
import { loadRapier, type Rapier } from './physics/rapier.ts'
import { quatYPR } from './physics/world.ts'
import { advance, COUNTDOWN_TICKS, createRace, requestReset, snapshot, type Race } from './race.ts'

let R: Rapier
beforeAll(async () => {
  R = await loadRapier()
})

const GAS: Controls = { ...NO_CONTROLS, throttle: 1 }
const TICK_MS = 1000 / TICK_HZ
const seconds = (race: Race, s: number, c: Controls = GAS) => advance(race, s * 1000, c)
const pastCountdown = (race: Race) => advance(race, COUNTDOWN_TICKS * TICK_MS, NO_CONTROLS)

test('tick count does not depend on frame chunking', () => {
  const a = createRace(R, flatCourse())
  const b = createRace(R, flatCourse())
  for (let k = 0; k < 30; k++) advance(a, TICK_MS, GAS)
  for (let k = 0; k < 10; k++) advance(b, 50, GAS)
  expect(snapshot(a).tick).toBe(snapshot(b).tick)
})

test('car is held during countdown', () => {
  const race = createRace(R, flatCourse())
  expect(snapshot(race).countdown).toBe(3)
  seconds(race, 1.5)
  expect(snapshot(race).countdown).toBe(2)
  seconds(race, 1)
  expect(snapshot(race).countdown).toBe(1)
  expect(Math.abs(snapshot(race).car.speed)).toBeLessThan(0.5)
  expect(snapshot(race).tick).toBeLessThan(0)
  seconds(race, 0.6)
  expect(snapshot(race).countdown).toBeNull()
  expect(snapshot(race).tick).toBeGreaterThanOrEqual(0)
})

test('finishes a straight course and records finishTicks', () => {
  const race = createRace(R, flatCourse(600))
  pastCountdown(race)
  seconds(race, 25)
  const s = snapshot(race)
  expect(s.finishTicks).not.toBeNull()
  expect(Number.isInteger(s.finishTicks)).toBe(true)
  expect(s.progress).toBe(1)
  seconds(race, 1)
  expect(snapshot(race).tick).toBe(s.finishTicks)
  expect(snapshot(race).finishTicks).toBe(s.finishTicks)
})

test('progress grows along the course', () => {
  const race = createRace(R, flatCourse())
  pastCountdown(race)
  const p0 = snapshot(race).progress
  seconds(race, 5)
  expect(snapshot(race).progress).toBeGreaterThan(p0)
})

test('falling below FALL_Y respawns at last checkpoint', () => {
  const c = flatCourse()
  const race = createRace(R, c)
  pastCountdown(race)
  // 체크포인트는 300m마다: 10초면 하나 이상 지난다
  seconds(race, 10)
  race.car.body.setTranslation({ x: 500, y: FALL_Y - 1, z: 300 }, true)
  advance(race, TICK_MS, GAS)
  const s = snapshot(race)
  expect(s.car.pos.y).toBeGreaterThan(0)
  expect(Math.abs(s.car.pos.x)).toBeLessThan(1)
  const cp = c.centerline[race.lastCheckpoint]
  expect(Math.abs(s.car.pos.z - cp.z)).toBeLessThan(2)
  expect(race.lastCheckpoint).toBeGreaterThan(0)
})

test('non-finite pose respawns', () => {
  const race = createRace(R, flatCourse())
  pastCountdown(race)
  seconds(race, 2)
  race.car.body.setLinvel({ x: NaN, y: 0, z: 0 }, true)
  advance(race, TICK_MS, GAS)
  const s = snapshot(race)
  for (const v of [s.car.pos.x, s.car.pos.y, s.car.pos.z, s.car.vel.x, s.car.vel.y, s.car.vel.z]) expect(Number.isFinite(v)).toBe(true)
})

test('stuck upside down for STUCK_SECONDS respawns', () => {
  const race = createRace(R, flatCourse())
  pastCountdown(race)
  seconds(race, 1, NO_CONTROLS)
  const p = race.car.body.translation()
  race.car.body.setTranslation({ x: p.x, y: 1.5, z: p.z }, true)
  race.car.body.setRotation(quatYPR(0, 0, Math.PI), true)
  race.car.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  seconds(race, STUCK_SECONDS - 0.5, NO_CONTROLS)
  expect(snapshot(race).car.up.y).toBeLessThan(0)
  seconds(race, 1, NO_CONTROLS)
  expect(snapshot(race).car.up.y).toBeGreaterThan(0.9)
})

test('requestReset returns to last checkpoint on next tick', () => {
  const c = flatCourse()
  const race = createRace(R, c)
  pastCountdown(race)
  seconds(race, 8)
  const cp = c.centerline[race.lastCheckpoint]
  requestReset(race)
  advance(race, TICK_MS, GAS)
  expect(Math.abs(snapshot(race).car.pos.z - cp.z)).toBeLessThan(2)
  expect(Math.abs(snapshot(race).car.speed)).toBeLessThan(2)
})

test('30 s hidden tab catches up exactly', () => {
  const race = createRace(R, flatCourse())
  pastCountdown(race)
  const t0 = snapshot(race).tick
  advance(race, 30000, NO_CONTROLS)
  expect(snapshot(race).tick - t0).toBe(30 * TICK_HZ)
})

test('nitro starts refilling NITRO_REGEN_DELAY after GO, not during the countdown', () => {
  const race = createRace(R, flatCourse())
  pastCountdown(race)
  expect(snapshot(race).nitro.gauge).toBe(0)
  seconds(race, NITRO_REGEN_DELAY - 0.2)
  expect(snapshot(race).nitro.gauge).toBe(0)
  seconds(race, 2.2)
  expect(snapshot(race).nitro.gauge).toBeCloseTo(2 * NITRO_REGEN_PER_SEC, 1)
})

test('holding shift burns nitro and boosts past top speed', () => {
  const race = createRace(R, flatCourse())
  pastCountdown(race)
  seconds(race, NITRO_REGEN_DELAY + 12)
  const g = snapshot(race).nitro.gauge
  expect(g).toBeGreaterThan(0.5)
  seconds(race, 1, { ...GAS, nitro: true })
  const s = snapshot(race)
  expect(s.nitro.gauge).toBeLessThan(g)
  expect(s.nitro.burning).toBe(true)
  expect(s.car.speed).toBeGreaterThan(TOP_SPEED)
})

test('falling past the other leg of a hairpin does not skip ahead', () => {
  const c = hairpinCourse()
  const race = createRace(R, c)
  pastCountdown(race)
  seconds(race, 2)
  const before = race.lastCheckpoint
  // 출발 다리 옆으로 날아가 반대쪽 다리(끝 근처) 아래로 떨어지는 중
  race.car.body.setTranslation({ x: 60, y: -6, z: 40 }, true)
  race.car.body.setLinvel({ x: 0, y: -8, z: 0 }, true)
  for (let k = 0; k < 10; k++) advance(race, TICK_MS, GAS)
  expect(race.lastCheckpoint).toBe(before)
  expect(snapshot(race).finishTicks).toBeNull()
  expect(snapshot(race).progress).toBeLessThan(0.5)
})

test('landing on another part of the road (shortcut) is accepted', () => {
  const c = hairpinCourse()
  const race = createRace(R, c)
  pastCountdown(race)
  seconds(race, 2)
  // 반대쪽 다리 중간 노면 위에 바로 내려놓는다(지름길 착지)
  race.car.body.setTranslation({ x: 60, y: 1.1, z: 300 }, true)
  race.car.body.setLinvel({ x: 0, y: 0, z: -20 }, true)
  for (let k = 0; k < 30; k++) advance(race, TICK_MS, GAS)
  expect(snapshot(race).progress).toBeGreaterThan(0.6)
})

test('snapshot exposes the pose one tick before the current one', () => {
  const a = createRace(R, flatCourse())
  const b = createRace(R, flatCourse())
  pastCountdown(a)
  pastCountdown(b)
  const zs: number[] = []
  for (let k = 0; k < 40; k++) {
    advance(a, TICK_MS, GAS)
    zs.push(snapshot(a).car.pos.z)
  }
  // 한 번에 두 틱씩 흘려도 prev는 '직전 틱' 자세여야 한다
  for (let k = 0; k < 20; k++) advance(b, 2 * TICK_MS, GAS)
  const s = snapshot(b)
  expect(s.car.pos.z).toBeCloseTo(zs[39], 4)
  expect(s.prev.pos.z).toBeCloseTo(zs[38], 4)
})

test('after a respawn prev equals the new pose (no blending across the teleport)', () => {
  const race = createRace(R, flatCourse())
  pastCountdown(race)
  seconds(race, 10)
  requestReset(race)
  advance(race, TICK_MS, GAS)
  const s = snapshot(race)
  expect(Math.abs(s.prev.pos.z - s.car.pos.z)).toBeLessThan(1)
})

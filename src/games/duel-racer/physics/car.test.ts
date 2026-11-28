import { beforeAll, expect, test } from 'vitest'
import { ACCEL_TIME, LANDING_ASSIST_MAX_DEG, NITRO_SPEED, TOP_SPEED } from '../constants.ts'
import { flatCourse, rampCourse } from '../course/testCourses.ts'
import type { Course } from '../course/types.ts'
import { NO_CONTROLS, type Controls } from './controls.ts'
import { carState, createCar, stepCar, type Car } from './car.ts'
import { loadRapier, type Rapier } from './rapier.ts'
import { createWorld, type PhysWorld } from './world.ts'

const DT = 1 / 60
let R: Rapier
beforeAll(async () => {
  R = await loadRapier()
})

function setup(course: Course, pose = course.start, roll = 0): { w: PhysWorld; car: Car } {
  const w = createWorld(R, course)
  const car = createCar(w, pose, roll)
  return { w, car }
}

function tick(w: PhysWorld, car: Car, c: Controls, boost = false) {
  stepCar(car, c, boost, DT)
  w.world.step()
}

function run(w: PhysWorld, car: Car, c: Controls, seconds: number, boost = false, each?: (t: number) => void) {
  const n = Math.round(seconds / DT)
  for (let k = 0; k < n; k++) {
    tick(w, car, c, boost)
    each?.((k + 1) * DT)
  }
}

const GAS: Controls = { ...NO_CONTROLS, throttle: 1 }

// 출발 직후 차가 내려앉을 시간
function settle(w: PhysWorld, car: Car) {
  run(w, car, NO_CONTROLS, 0.5)
}

test('reaches 90% of top speed within ACCEL_TIME', () => {
  const { w, car } = setup(flatCourse())
  settle(w, car)
  let reached = Infinity
  run(w, car, GAS, ACCEL_TIME + 1, false, (t) => {
    if (reached === Infinity && carState(car).speed >= 0.9 * TOP_SPEED) reached = t
  })
  expect(reached).toBeLessThanOrEqual(ACCEL_TIME + 0.5)
})

test('never exceeds TOP_SPEED without boost', () => {
  const { w, car } = setup(flatCourse())
  settle(w, car)
  let max = 0
  run(w, car, GAS, 10, false, () => { max = Math.max(max, carState(car).speed) })
  expect(max).toBeLessThanOrEqual(TOP_SPEED * 1.02)
})

test('boost exceeds TOP_SPEED up to NITRO_SPEED', () => {
  const { w, car } = setup(flatCourse())
  settle(w, car)
  run(w, car, GAS, 6)
  let max = 0
  run(w, car, GAS, 5, true, () => { max = Math.max(max, carState(car).speed) })
  expect(max).toBeGreaterThan(TOP_SPEED)
  expect(max).toBeLessThanOrEqual(NITRO_SPEED * 1.02)
})

test('steering right responds on the next tick (angVel.y < 0)', () => {
  const { w, car } = setup(flatCourse())
  settle(w, car)
  run(w, car, GAS, 1.5)
  expect(carState(car).speed).toBeGreaterThan(25)
  tick(w, car, { ...GAS, steer: 1 })
  expect(carState(car).angVel.y).toBeLessThan(0)
})

test('handbrake drifts and recovers', () => {
  const { w, car } = setup(flatCourse())
  settle(w, car)
  run(w, car, GAS, 2.5)
  expect(carState(car).speed).toBeGreaterThan(38)
  let maxSlip = 0
  run(w, car, { ...GAS, steer: 1, handbrake: true }, 1, false, () => { maxSlip = Math.max(maxSlip, carState(car).slipDeg) })
  expect(maxSlip).toBeGreaterThan(15)
  run(w, car, GAS, 1)
  expect(carState(car).slipDeg).toBeLessThan(5)
})

test('does not roll over at full steer and top speed', () => {
  const { w, car } = setup(flatCourse())
  settle(w, car)
  run(w, car, GAS, 6)
  let minUp = 1
  run(w, car, { ...GAS, steer: 1 }, 3, false, () => { minUp = Math.min(minUp, carState(car).up.y) })
  expect(minUp).toBeGreaterThan(0.7)
})

test('air controls rotate the car while airborne', () => {
  const { w, car } = setup(rampCourse())
  settle(w, car)
  let airTicks = 0
  let pitchRate = 0
  // 점프대는 400m 지점: 가속해서 10초쯤 닿는다
  run(w, car, GAS, 14, false, () => {
    const s = carState(car)
    if (!s.grounded && s.pos.y > 2 && airTicks < 20) {
      airTicks++
      tick(w, car, { ...GAS, pitch: 1 })
      pitchRate = carState(car).localAngVel.x
    }
  })
  expect(airTicks).toBeGreaterThan(0)
  expect(pitchRate).toBeGreaterThan(0.5)
})

function dropTest(rollDeg: number): number {
  const c = flatCourse()
  const { w, car } = setup(c, { pos: { ...c.start.pos, y: c.start.pos.y + 3 }, yaw: 0 }, (rollDeg * Math.PI) / 180)
  let landedAt = -1
  let upAfter = NaN
  run(w, car, NO_CONTROLS, 3, false, (t) => {
    const s = carState(car)
    if (landedAt < 0 && (s.grounded || s.pos.y < c.start.pos.y + 0.6)) landedAt = t
    if (landedAt >= 0 && Number.isNaN(upAfter) && t >= landedAt + (rollDeg <= LANDING_ASSIST_MAX_DEG ? 0.5 : 1)) upAfter = s.up.y
  })
  return upAfter
}

test('landing assist rights a tilted car', () => {
  expect(dropTest(30)).toBeGreaterThan(0.95)
})

test('no assist beyond LANDING_ASSIST_MAX_DEG', () => {
  expect(dropTest(120)).toBeLessThan(0.5)
})

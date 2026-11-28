import { beforeAll, expect, test } from 'vitest'
import { ACCEL_TIME, LANDING_ASSIST_MAX_DEG, NITRO_SPEED, TOP_SPEED } from '../constants.ts'
import { flatCourse, rampCourse, walledCourse } from '../course/testCourses.ts'
import type { Course } from '../course/types.ts'
import { NO_CONTROLS, type Controls } from './controls.ts'
import { AIR_YAW_RATE, STEER_YAW_RATE, carState, createCar, stepCar, type Car } from './car.ts'
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

function jumpLanding(speed: number): { minUpInAir: number; endUp: number } {
  const c = rampCourse()
  const { w, car } = setup(c, { pos: { x: 0, y: 1.1, z: 300 }, yaw: 0 })
  run(w, car, NO_CONTROLS, 0.3)
  car.body.setLinvel({ x: 0, y: 0, z: speed }, true)
  let air = false
  let minUp = 1
  run(w, car, GAS, 6, false, () => {
    const s = carState(car)
    if (!s.grounded && s.pos.z > 395) air = true
    if (air) minUp = Math.min(minUp, s.up.y)
  })
  return { minUpInAir: minUp, endUp: carState(car).up.y }
}

test('without air input the car stays level over a jump and lands on its wheels', () => {
  for (const v of [30, 45, 55]) {
    const r = jumpLanding(v)
    expect(r.minUpInAir).toBeGreaterThan(0.9)
    expect(r.endUp).toBeGreaterThan(0.95)
  }
})

function wallHit(deg: number, speed: number): { speed: number; headingDeg: number } {
  const yaw = (-deg * Math.PI) / 180
  const { w, car } = setup(walledCourse(), { pos: { x: 0, y: 1.1, z: 50 }, yaw })
  run(w, car, NO_CONTROLS, 0.3)
  car.body.setLinvel({ x: Math.sin(yaw) * speed, y: 0, z: Math.cos(yaw) * speed }, true)
  run(w, car, GAS, 1.5)
  const s = carState(car)
  const q = s.quat
  const fx = 2 * (q.x * q.z + q.w * q.y)
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y)
  return { speed: s.speed, headingDeg: Math.abs((Math.atan2(fx, fz) * 180) / Math.PI) }
}

test('glancing a wall slides along it instead of stopping', () => {
  for (const deg of [10, 25]) {
    const r = wallHit(deg, 40)
    expect(r.speed).toBeGreaterThan(25)
    expect(r.headingDeg).toBeLessThan(12)
  }
})

test('a steep wall hit loses speed but turns the car along the wall', () => {
  const r = wallHit(45, 40)
  expect(r.headingDeg).toBeLessThan(20)
  expect(r.speed).toBeGreaterThan(10)
})

function spinLanding(speed: number): { x: number; headingDeg: number; landHeading: number } {
  const { w, car } = setup(rampCourse(), { pos: { x: 0, y: 1.1, z: 300 }, yaw: 0 })
  run(w, car, NO_CONTROLS, 0.3)
  car.body.setLinvel({ x: 0, y: 0, z: speed }, true)
  let air = false
  let landed = false
  let landHeading = 0
  let airTicks = 0
  const heading = () => {
    const q = carState(car).quat
    return (Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)) * 180) / Math.PI
  }
  for (let k = 0; k < 60 * 7; k++) {
    const s0 = carState(car)
    if (!s0.grounded && s0.pos.z > 395) air = true
    if (air && !landed && s0.grounded) {
      landed = true
      landHeading = heading()
    }
    // 공중에서 E를 0.7초(약 90°) 누르고, 착지 1.2초 뒤까지
    if (air && !landed) airTicks++
    tick(w, car, { ...GAS, yaw: air && !landed && airTicks <= 42 ? 1 : 0 })
    if (landed && --budget <= 0) break
  }
  return { x: carState(car).pos.x, headingDeg: Math.abs(heading()), landHeading }
}
let budget = 0

test('landing sideways after an air spin keeps going down the road and straightens', () => {
  budget = 72
  const r = spinLanding(55)
  expect(Math.abs(r.landHeading)).toBeGreaterThan(30)
  expect(Math.abs(r.x)).toBeLessThan(5)
  expect(r.headingDeg).toBeLessThan(15)
})

test('full steer turns at most STEER_YAW_RATE (not twitchy)', () => {
  const { w, car } = setup(flatCourse())
  settle(w, car)
  run(w, car, GAS, 1.5)
  let maxRate = 0
  run(w, car, { ...GAS, steer: 1 }, 1, false, () => { maxRate = Math.max(maxRate, Math.abs(carState(car).angVel.y)) })
  expect(maxRate).toBeLessThanOrEqual(STEER_YAW_RATE * 1.1)
  expect(maxRate).toBeGreaterThan(STEER_YAW_RATE * 0.7)
})

test('Q/E air spin is slower than flips (AIR_YAW_RATE)', () => {
  const { w, car } = setup(rampCourse())
  settle(w, car)
  let maxRate = 0
  run(w, car, GAS, 14, false, () => {
    const s = carState(car)
    if (!s.grounded && s.pos.y > 2) {
      tick(w, car, { ...GAS, yaw: 1 })
      maxRate = Math.max(maxRate, Math.abs(carState(car).localAngVel.y))
    }
  })
  expect(maxRate).toBeGreaterThan(AIR_YAW_RATE * 0.7)
  expect(maxRate).toBeLessThanOrEqual(AIR_YAW_RATE * 1.1)
})

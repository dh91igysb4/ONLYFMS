import { beforeAll, expect, test } from 'vitest'
import { ACCEL_TIME, LANDING_ASSIST_MAX_DEG, NITRO_SPEED, TOP_SPEED } from '../constants.ts'
import { flatCourse, rampCourse, walledCourse } from '../course/testCourses.ts'
import type { Course } from '../course/types.ts'
import { NO_CONTROLS, type Controls } from './controls.ts'
import { AIR_PITCH_RATE, AIR_YAW_RATE, STEER_YAW_RATE, carState, createCar, stepCar, type Car } from './car.ts'
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

test('does not roll over at full steer and top speed', () => {
  const { w, car } = setup(flatCourse())
  settle(w, car)
  run(w, car, GAS, 6)
  let minUp = 1
  run(w, car, { ...GAS, steer: 1 }, 3, false, () => { minUp = Math.min(minUp, carState(car).up.y) })
  expect(minUp).toBeGreaterThan(0.7)
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
    // 공중에서 0.7초 동안 바깥 힘으로 돌린다(2단계: 상대와 부딪혀 도는 경우), 착지 1.2초 뒤까지
    if (air && !landed && ++airTicks <= 42) car.body.setAngvel({ x: 0, y: -2.4, z: 0 }, true)
    tick(w, car, GAS)
    if (landed && --budget <= 0) break
  }
  return { x: carState(car).pos.x, headingDeg: Math.abs(heading()), landHeading }
}
let budget = 0

test('landing sideways while spinning keeps going down the road and straightens', () => {
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


/** 점프대에서 떠오른 뒤 첫 공중 틱까지 달린다 */
function toAir(speed = 50) {
  const { w, car } = setup(rampCourse(), { pos: { x: 0, y: 1.1, z: 300 }, yaw: 0 })
  run(w, car, NO_CONTROLS, 0.3)
  car.body.setLinvel({ x: 0, y: 0, z: speed }, true)
  for (let k = 0; k < 600; k++) {
    const s = carState(car)
    if (!s.grounded && s.pos.z > 400 && s.pos.y > 1.5) break
    tick(w, car, GAS)
  }
  return { w, car }
}
const headingOf = (q: { x: number; y: number; z: number; w: number }) =>
  Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y))
const pitchOf = (q: { x: number; y: number; z: number; w: number }) => {
  // 차 앞(로컬 +z)의 수직 성분: 음수면 앞이 아래
  const fy = 2 * (q.y * q.z - q.w * q.x)
  return Math.asin(Math.max(-1, Math.min(1, fy)))
}

test('air yaw input turns the car at about AIR_YAW_RATE (right = angVel.y < 0)', () => {
  const { w, car } = toAir()
  let rate = 0
  for (let k = 0; k < 20; k++) {
    tick(w, car, { ...GAS, yaw: 1 })
    rate = carState(car).localAngVel.y
  }
  expect(rate).toBeLessThan(-AIR_YAW_RATE * 0.7)
  expect(rate).toBeGreaterThan(-AIR_YAW_RATE * 1.1)
})

test('air pitch input tilts the nose (W = down) at about AIR_PITCH_RATE and the angle stays after release', () => {
  const { w, car } = toAir()
  const start = pitchOf(carState(car).quat)
  for (let k = 0; k < 15; k++) tick(w, car, { ...GAS, pitch: 1 })
  expect(carState(car).localAngVel.x).toBeGreaterThan(AIR_PITCH_RATE * 0.7)
  const tilted = pitchOf(carState(car).quat)
  expect(tilted - start).toBeLessThan(-0.3)
  for (let k = 0; k < 15; k++) tick(w, car, GAS)
  // 손을 떼도 수평으로 되돌아가지 않는다(멈추기만 한다)
  expect(pitchOf(carState(car).quat) - start).toBeLessThan((tilted - start) * 0.8)
})

test('turning in the air changes where the car goes after landing', () => {
  const { w, car } = toAir()
  // 약 0.25초 오른쪽으로(약 30°)
  for (let k = 0; k < 15; k++) tick(w, car, { ...GAS, yaw: 1 })
  run(w, car, GAS, 3)
  const s = carState(car)
  const h = headingOf(s.quat)
  const travel = Math.atan2(s.vel.x, s.vel.z)
  expect(h).toBeLessThan(-0.2)
  expect(Math.abs(travel - h)).toBeLessThan(0.1)
})

import { expect, test } from 'vitest'
import { quatYPR } from '../physics/world.ts'
import { CAM_BACK, CAM_UP, FOV_FAST, FOV_SLOW, chaseCamera, type CamPose } from './camera.ts'

const car = (yaw: number, roll = 0, speed = 0) => ({
  pos: { x: 10, y: 1, z: 20 },
  quat: quatYPR(yaw, 0, roll),
  vel: { x: Math.sin(yaw) * speed, y: 0, z: Math.cos(yaw) * speed },
})

function settle(c: ReturnType<typeof car>, seconds = 3): CamPose {
  let p: CamPose | null = null
  for (let k = 0; k < seconds * 60; k++) p = chaseCamera(p, c, 1 / 60)
  return p!
}

test('settles behind and above a still car', () => {
  const p = settle(car(0))
  expect(p.pos.x).toBeCloseTo(10, 3)
  expect(p.pos.z).toBeCloseTo(20 - CAM_BACK, 3)
  expect(p.pos.y).toBeCloseTo(1 + CAM_UP, 3)
})

test('follows the car heading (yaw 90° → behind is -x)', () => {
  const p = settle(car(Math.PI / 2))
  expect(p.pos.x).toBeCloseTo(10 - CAM_BACK, 3)
  expect(p.pos.z).toBeCloseTo(20, 3)
})

test('stays level and above the car when the car rolls upside down', () => {
  const p = settle(car(0, Math.PI))
  expect(p.pos.y).toBeCloseTo(1 + CAM_UP, 3)
  expect(p.pos.z).toBeCloseTo(20 - CAM_BACK, 3)
})

test('field of view widens with speed', () => {
  const fovs = [0, 10, 25, 40, 50].map((v) => settle(car(0, 0, v), 2).fov)
  expect(fovs[0]).toBeCloseTo(FOV_SLOW, 3)
  expect(fovs[4]).toBeCloseTo(FOV_FAST, 3)
  for (let i = 1; i < fovs.length; i++) expect(fovs[i]).toBeGreaterThan(fovs[i - 1])
})

test('first frame snaps to the target', () => {
  const p = chaseCamera(null, car(0), 1 / 60)
  expect(p.pos.z).toBeCloseTo(20 - CAM_BACK, 3)
})

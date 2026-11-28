import { expect, test } from 'vitest'
import { getCourse } from '../course/index.ts'
import { cityBlocks, CITY_CLEARANCE } from './city.ts'

const c = getCourse('neon-1')

test('same seed gives the same city', () => {
  expect(cityBlocks(c, 7)).toEqual(cityBlocks(c, 7))
  expect(cityBlocks(c, 7)).not.toEqual(cityBlocks(c, 8))
})

test('has buildings', () => {
  expect(cityBlocks(c, 1).length).toBeGreaterThan(50)
})

test('no building footprint comes within width/2 + clearance of the centerline', () => {
  for (const b of cityBlocks(c, 1)) {
    for (let i = 0; i < c.centerline.length; i += 2) {
      const p = c.centerline[i]
      const dx = Math.max(0, Math.abs(p.x - b.center.x) - b.half.x)
      const dz = Math.max(0, Math.abs(p.z - b.center.z) - b.half.z)
      expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(c.width[i] / 2 + CITY_CLEARANCE - 1e-6)
    }
  }
})

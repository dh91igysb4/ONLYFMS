import { expect, test } from 'vitest'
import { ROAD_MIN_WIDTH, TOP_SPEED } from '../constants.ts'
import { arcLength, getCourse, progressAt } from './index.ts'
import { buildRoad } from './road.ts'

const c = getCourse('neon-1')

test('road is wide enough for side-by-side contact', () => {
  expect(c.width.length).toBe(c.centerline.length)
  for (const w of c.width) expect(w).toBeGreaterThanOrEqual(ROAD_MIN_WIDTH)
})

test('race length fits 70–90 s at 85% of top speed', () => {
  const len = arcLength(c).at(-1)!
  expect(len / (TOP_SPEED * 0.85)).toBeGreaterThanOrEqual(70)
  expect(len / (TOP_SPEED * 0.85)).toBeLessThanOrEqual(90)
})

test('centerline points are 2–6 m apart', () => {
  const s = arcLength(c)
  for (let i = 1; i < s.length; i++) {
    expect(s[i] - s[i - 1]).toBeGreaterThanOrEqual(2)
    expect(s[i] - s[i - 1]).toBeLessThanOrEqual(6)
  }
})

test('has jumps and a shortcut', () => {
  expect(c.boxes.filter((b) => b.kind === 'ramp').length).toBeGreaterThanOrEqual(3)
  expect(c.boxes.filter((b) => b.kind === 'shortcut').length).toBeGreaterThanOrEqual(1)
})

test('checkpoints are ordered and end before finish', () => {
  const s = arcLength(c)
  expect(c.checkpoints.length).toBeGreaterThan(0)
  expect(c.checkpoints[0]).toBe(0)
  for (let i = 1; i < c.checkpoints.length; i++) {
    expect(c.checkpoints[i]).toBeGreaterThan(c.checkpoints[i - 1])
    expect(s[c.checkpoints[i]] - s[c.checkpoints[i - 1]]).toBeLessThanOrEqual(400)
  }
  expect(c.checkpoints.at(-1)!).toBeLessThan(c.finish)
  expect(s[c.finish] - s[c.checkpoints.at(-1)!]).toBeLessThanOrEqual(400)
  expect(c.finish).toBeLessThan(c.centerline.length)
})

test('buildRoad makes a strip with 2 triangles per segment', () => {
  const n = c.centerline.length
  const r = buildRoad(c)
  expect(r.positions.length).toBe(n * 2 * 3)
  expect(r.indices.length).toBe((n - 1) * 6)
  for (const v of r.positions) expect(Number.isFinite(v)).toBe(true)
  for (const v of r.walls.positions) expect(Number.isFinite(v)).toBe(true)
  for (const i of r.indices) expect(i).toBeLessThan(n * 2)
  expect(r.walls.indices.length).toBeGreaterThan(0)
})

test('road triangles face up', () => {
  const r = buildRoad(c)
  const p = (k: number) => [r.positions[k * 3], r.positions[k * 3 + 1], r.positions[k * 3 + 2]]
  for (let t = 0; t < r.indices.length; t += 6 * 50) {
    const [a, b, d] = [p(r.indices[t]), p(r.indices[t + 1]), p(r.indices[t + 2])]
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]
    const ny = u[2] * v[0] - u[0] * v[2]
    expect(ny).toBeGreaterThan(0)
  }
})

test('progressAt finds the nearest index near the hint', () => {
  const k = 120
  const p = c.centerline[k]
  expect(progressAt(c, { x: p.x, y: p.y + 2, z: p.z }, k - 10).index).toBe(k)
})

test('progressAt falls back to a global search far from the hint', () => {
  const k = 400
  const p = c.centerline[k]
  const r = progressAt(c, { x: p.x, y: p.y + 1, z: p.z }, 0)
  expect(r.index).toBe(k)
  expect(r.s).toBeCloseTo(arcLength(c)[k], 5)
})

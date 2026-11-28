import { describe, expect, test } from 'vitest'
import { FOOTPRINT_LIFE_MS, FOOTPRINT_MAX, FOOTPRINT_STEP, footprintAlpha, NO_FOOTPRINTS, stepFootprints, type Footprints } from './footprints.ts'

const sandAll = () => true
const sandLeft = (x: number) => x < 100

describe('발자국', () => {
  test('모래 위에서 한 걸음(FOOTPRINT_STEP) 갈 때마다 하나씩 쌓이고 좌우 발을 번갈아 찍는다', () => {
    let fp: Footprints = NO_FOOTPRINTS
    fp = stepFootprints(fp, { x: 10, y: 10 }, 0, sandAll)
    expect(fp.prints).toHaveLength(1)
    fp = stepFootprints(fp, { x: 10 + FOOTPRINT_STEP - 1, y: 10 }, 10, sandAll)
    expect(fp.prints).toHaveLength(1)
    fp = stepFootprints(fp, { x: 10 + FOOTPRINT_STEP, y: 10 }, 20, sandAll)
    expect(fp.prints).toHaveLength(2)
    expect(fp.prints[0].side).not.toBe(fp.prints[1].side)
  })
  test('가만히 서 있으면 더 찍지 않는다', () => {
    let fp = stepFootprints(NO_FOOTPRINTS, { x: 10, y: 10 }, 0, sandAll)
    for (let t = 1; t < 10; t++) fp = stepFootprints(fp, { x: 10, y: 10 }, t * 100, sandAll)
    expect(fp.prints).toHaveLength(1)
  })
  test('모래가 아닌 칸(물·풀·눈·동굴)에서는 찍지 않는다', () => {
    let fp: Footprints = NO_FOOTPRINTS
    for (let x = 0; x < 200; x += FOOTPRINT_STEP) fp = stepFootprints(fp, { x, y: 0 }, x, sandLeft)
    expect(fp.prints.length).toBeGreaterThan(0)
    expect(fp.prints.every((f) => f.x < 100)).toBe(true)
  })
  test('개수 상한을 넘으면 오래된 것부터 버린다', () => {
    let fp: Footprints = NO_FOOTPRINTS
    for (let i = 0; i < FOOTPRINT_MAX + 10; i++) fp = stepFootprints(fp, { x: i * FOOTPRINT_STEP, y: 0 }, i, sandAll)
    expect(fp.prints).toHaveLength(FOOTPRINT_MAX)
    expect(fp.prints[fp.prints.length - 1].x).toBe((FOOTPRINT_MAX + 9) * FOOTPRINT_STEP)
  })
  test('시간이 지나면 옅어지다 사라진다', () => {
    let fp = stepFootprints(NO_FOOTPRINTS, { x: 0, y: 0 }, 1000, sandAll)
    const first = fp.prints[0]
    expect(footprintAlpha(first, 1000)).toBe(1)
    const mid = footprintAlpha(first, 1000 + FOOTPRINT_LIFE_MS * 0.75)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    // 다 사라진 뒤 서 있는 자리에는 다시 찍지 않는다
    fp = stepFootprints(fp, { x: 0, y: 0 }, 1000 + FOOTPRINT_LIFE_MS, sandAll)
    expect(fp.prints).toHaveLength(0)
    expect(footprintAlpha(first, 1000 + FOOTPRINT_LIFE_MS)).toBe(0)
  })
  test('풀에서 모래로 들어서면 걸은 거리대로 찍는다', () => {
    let fp: Footprints = NO_FOOTPRINTS
    fp = stepFootprints(fp, { x: 90, y: 0 }, 0, (x) => x >= 100)
    fp = stepFootprints(fp, { x: 90 + FOOTPRINT_STEP * 2, y: 0 }, 10, (x) => x >= 100)
    expect(fp.prints).toHaveLength(1)
  })
  test('시계가 뒤로 가면(다시 시작) 비운다', () => {
    const fp = stepFootprints(NO_FOOTPRINTS, { x: 0, y: 0 }, 5000, sandAll)
    expect(stepFootprints(fp, { x: 50, y: 0 }, 10, () => false).prints).toHaveLength(0)
  })
})

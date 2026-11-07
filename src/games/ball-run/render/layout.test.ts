import { describe, expect, it } from 'vitest'
import { BLOCK_H, X_LIMIT } from '../constants.ts'
import { courseFromSegments } from '../course.ts'
import { JOINT, parseSegment } from '../segments.ts'
import { buildingsFor, segmentBoxes } from './layout.ts'

const SEED = '0123456789abcdef0123456789abcdef'

// 첫 조각: 이음 행만 6행(행마다 바닥 5칸). 둘째: 블록·오르막.
const STRAIGHT = parseSegment({ id: 'straight', kind: 'obstacle', tier: 1, rows: new Array<string>(6).fill(JOINT) })
const MIXED = parseSegment({ id: 'mixed', kind: 'obstacle', tier: 1, rows: [JOINT, '___B___', '/______', 'B______', JOINT] })
const course = courseFromSegments([
  { seg: STRAIGHT, mirrored: false },
  { seg: MIXED, mirrored: false },
])

describe('segmentBoxes', () => {
  it('floor boxes match cells', () => {
    const info = course.segmentAt(0)
    const floors = segmentBoxes(course, info).filter((b) => b.kind === 'floor')
    expect(floors).toHaveLength(info.length * 5)
    for (let row = info.startRow; row < info.startRow + info.length; row++) {
      for (let col = -2; col <= 2; col++) {
        const b = floors.find((f) => f.cx === col * 1000 && f.cz === row * 1000 + 500)
        expect(b).toBeDefined()
        expect(b!.w).toBe(1000)
        expect(b!.d).toBe(1000)
        expect(b!.slope).toBe(0)
      }
    }
  })

  it('block box sits on floor', () => {
    const info = course.segmentAt(6)
    const boxes = segmentBoxes(course, info)
    const blocks = boxes.filter((b) => b.kind === 'block')
    expect(blocks).toHaveLength(2)
    const b = blocks.find((k) => k.cx === 0 && k.cz === 7 * 1000 + 500)!
    expect(b).toBeDefined()
    const floor = course.cell(0, 7).floor!.h0
    expect(b.cy).toBe(floor + BLOCK_H / 2)
    expect(b.h).toBe(BLOCK_H)
    expect(b.w).toBe(1000)
    expect(b.d).toBe(1000)
    // 블록 칸에도 바닥 상자가 있다.
    expect(boxes.some((f) => f.kind === 'floor' && f.cx === 0 && f.cz === b.cz)).toBe(true)
  })

  it('ramp slope', () => {
    const info = course.segmentAt(6)
    const ramp = segmentBoxes(course, info).find((b) => b.kind === 'floor' && b.cx === -3000 && b.cz === 8 * 1000 + 500)!
    expect(ramp.slope).toBe(250)
    // 오르막 뒤 칸 위 블록은 올라간 바닥 위에 앉는다.
    const block = segmentBoxes(course, info).find((b) => b.kind === 'block' && b.cx === -3000)!
    expect(block.cy).toBe(course.cell(-3, 9).floor!.h0 + BLOCK_H / 2)
  })

  it('holes have no boxes', () => {
    const info = course.segmentAt(0)
    const boxes = segmentBoxes(course, info)
    expect(boxes.some((b) => b.cx === -3000 || b.cx === 3000)).toBe(false)
  })
})

describe('buildingsFor', () => {
  it('buildings are deterministic and off-track', () => {
    const a = buildingsFor(SEED, 0, 300)
    const b = buildingsFor(SEED, 0, 300)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
    for (const k of a) {
      expect(Math.abs(k.cx) - k.w / 2).toBeGreaterThan(X_LIMIT + 1000)
      expect(k.w).toBeGreaterThan(0)
      expect(k.d).toBeGreaterThan(0)
      expect(k.h).toBeGreaterThan(0)
    }
    expect(a.some((k) => k.cx < 0)).toBe(true)
    expect(a.some((k) => k.cx > 0)).toBe(true)
  })

  it('split ranges give the same buildings without duplicates', () => {
    const whole = buildingsFor(SEED, 0, 300)
    const split = [...buildingsFor(SEED, 0, 137), ...buildingsFor(SEED, 137, 300)]
    expect(split).toEqual(whole)
    for (const k of buildingsFor(SEED, 137, 300)) expect(k.cz).toBeGreaterThanOrEqual(137 * 1000)
  })

  it('different seeds differ', () => {
    expect(buildingsFor(SEED, 0, 300)).not.toEqual(buildingsFor('f'.repeat(32), 0, 300))
  })
})

import { describe, expect, it } from 'vitest'
import { COL_MAX, COL_MIN, TIER_WEIGHTS } from './constants.ts'
import { courseFromSegments, decorRandom, getCourse, u32Stream } from './course.ts'
import { PARSED, START_PARSED } from './segments.ts'

const SEED = '0123456789abcdef0123456789abcdef'
const seedN = (n: number) => n.toString(16).padStart(2, '0').repeat(16)

function allCells(seed: string, rows: number) {
  const c = getCourse(seed)
  const out: unknown[] = []
  for (let r = 0; r < rows; r++) for (let col = COL_MIN; col <= COL_MAX; col++) out.push(c.cell(col, r))
  return JSON.stringify(out)
}
function segs(seed: string, count: number) {
  const c = getCourse(seed)
  const list = []
  let row = 0
  while (list.length < count) {
    const s = c.segmentAt(row)
    list.push(s)
    row = s.startRow + s.length
  }
  return list
}
const bandW = (m: number) => [...TIER_WEIGHTS].reverse().find((b) => b.fromM <= m)!.w

describe('course', () => {
  it('same seed same course', () => {
    expect(allCells(SEED, 3000)).toBe(allCells(SEED, 3000))
    expect(allCells(seedN(1), 3000)).not.toBe(allCells(seedN(2), 3000))
  })
  it('starts with START', () => {
    const s = getCourse(SEED).segmentAt(0)
    expect(s.id).toBe('start')
    expect(s.startRow).toBe(0)
    expect(s.length).toBe(START_PARSED.length)
  })
  it('no repeat within last 3', () => {
    for (let n = 0; n < 10; n++) {
      const ids = segs(seedN(n + 10), 200).map((s) => s.id).filter((id) => id !== 'start')
      for (let i = 0; i + 3 < ids.length; i++) {
        expect(new Set(ids.slice(i, i + 4)).size).toBe(4)
      }
    }
  })
  it('respects tier schedule', () => {
    for (let n = 0; n < 10; n++) {
      for (const s of segs(seedN(n + 30), 200)) {
        if (s.id === 'start') continue
        expect(bandW(s.startRow)[s.tier - 1]).toBeGreaterThan(0)
      }
    }
  })
  it('segments are contiguous and segmentsBetween covers range', () => {
    const c = getCourse(SEED)
    const list = c.segmentsBetween(100, 900)
    expect(list[0].startRow).toBeLessThanOrEqual(100)
    expect(list[list.length - 1].startRow + list[list.length - 1].length).toBeGreaterThan(900)
    for (let i = 1; i < list.length; i++) expect(list[i].startRow).toBe(list[i - 1].startRow + list[i - 1].length)
  })
  it('mirror is exact', () => {
    const X = PARSED.find((p) => p.id === 't3-two-branches')!
    const a = courseFromSegments([{ seg: X, mirrored: true }])
    const b = courseFromSegments([{ seg: X, mirrored: false }])
    for (let r = 0; r < X.length; r++) {
      for (let col = COL_MIN; col <= COL_MAX; col++) expect(a.cell(col, r)).toEqual(b.cell(-col, r))
    }
    let asym = false
    for (let r = 0; r < X.length; r++) if (JSON.stringify(a.cell(-3, r)) !== JSON.stringify(a.cell(3, r))) asym = true
    expect(asym).toBe(true)
  })
  it('heights are continuous at joints', () => {
    for (const seed of [SEED, seedN(5)]) {
      const c = getCourse(seed)
      const list = segs(seed, 80)
      for (let i = 1; i < list.length; i++) {
        const prevEnd = c.cell(0, list[i].startRow - 1).floor!
        expect(prevEnd.h1).toBe(list[i].base)
        expect(c.cell(0, list[i].startRow).floor!.h0).toBe(list[i].base)
      }
    }
  })
  it('courseFromSegments is flat beyond the list', () => {
    const c = courseFromSegments([{ seg: PARSED[0], mirrored: false }])
    const h = c.cell(0, 500).floor!
    expect(h.h0).toBe(h.h1)
    expect(c.cell(0, 5000).floor).not.toBeNull()
  })
  it('decor stream is independent', () => {
    const s = 'fedcba9876543210fedcba9876543210'
    const r = decorRandom(s)
    for (let i = 0; i < 1000; i++) r()
    const after = allCells(s, 2000)
    const s2 = 'fedcba9876543210fedcba9876543211'
    expect(after).toBe(allCells('fedcba9876543210fedcba9876543210', 2000))
    expect(allCells(s2, 10)).not.toBe('')
    const a = u32Stream(s, 'x')()
    expect(Number.isInteger(a) && a >= 0 && a < 2 ** 32).toBe(true)
    expect(u32Stream(s, 'decor')()).not.toBe(u32Stream(s, 'course')())
  })
  it('out of range cells are holes', () => {
    const c = getCourse(SEED)
    for (const [col, row] of [[4, 10], [-4, 10], [0, -1]]) {
      expect(c.cell(col, row)).toEqual({ floor: null, block: false })
    }
  })
})

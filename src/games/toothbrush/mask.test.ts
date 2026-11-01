import { describe, expect, it } from 'vitest'
import { MAX_THICK, ZONE_TOTAL } from './constants.ts'
import { isTooth, toothCells, toothOf, gumRows, toothRows } from './mask.ts'

const idx = (c: number, r: number) => r * 48 + c

describe('mask', () => {
  it('tooth_cell_counts', () => {
    for (const z of [0, 1, 3, 4]) expect(toothCells(z).length).toBe(956)
    for (const z of [2, 5]) expect(toothCells(z).length).toBe(680)
  })
  it('columns_0_and_47_empty', () => {
    for (let z = 0; z < 6; z++)
      for (let i = 0; i < 48 * 32; i++)
        if (i % 48 === 0 || i % 48 === 47) expect(isTooth(z, i)).toBe(false)
  })
  it('corners_removed', () => {
    for (const [c, r] of [[1, 6], [4, 6], [1, 27], [4, 27]]) expect(isTooth(0, idx(c, r))).toBe(false)
    expect(isTooth(0, idx(2, 6))).toBe(true)
    expect(isTooth(0, idx(1, 7))).toBe(true)
  })
  it('rows_outside_tooth_band_empty', () => {
    for (const r of [7, 24]) for (let c = 0; c < 48; c++) expect(isTooth(2, idx(c, r))).toBe(false)
  })
  it('zone_total_within_capacity', () => {
    for (let z = 0; z < 6; z++) {
      expect(ZONE_TOTAL[z]).toBeGreaterThanOrEqual(0)
      expect(ZONE_TOTAL[z]).toBeLessThanOrEqual(toothCells(z).length * MAX_THICK)
    }
  })
  it('cells_sorted_unique', () => {
    for (let z = 0; z < 6; z++) {
      const a = toothCells(z)
      for (let k = 1; k < a.length; k++) expect(a[k]).toBeGreaterThan(a[k - 1])
    }
  })
  it('helpers', () => {
    expect(gumRows(0)).toEqual([0, 5])
    expect(gumRows(4)).toEqual([28, 31])
    expect(gumRows(2)).toBeNull()
    expect(toothRows(1)).toEqual([6, 27])
    expect(toothRows(5)).toEqual([8, 23])
    expect(toothOf(0, idx(2, 10))).toBe(0)
    expect(toothOf(0, idx(5, 10))).toBe(1)
    expect(toothOf(0, idx(0, 10))).toBe(-1)
  })
})

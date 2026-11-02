import { describe, expect, it } from 'vitest'
import { DEC_OPT, MAX_THICK, SWITCH_TICKS, TOTAL_TICKS, ZONE_COUNT, ZONE_TOTAL } from './constants.ts'
import { AXIS, inBox, inEllipse, isTooth, toothAt, toothCells, toothOf, ZONE_SHAPES, type Box } from './mask.ts'

const idx = (c: number, r: number) => r * 48 + c

describe('mask', () => {
  it('tooth_cell_counts', () => {
    expect([0, 1, 2, 3, 4, 5].map((z) => toothCells(z).length)).toEqual([504, 440, 484, 458, 442, 466])
    for (let z = 0; z < ZONE_COUNT; z++) {
      expect(toothCells(z).length).toBeGreaterThanOrEqual(400)
      expect(toothCells(z).length).toBeLessThanOrEqual(900)
    }
  })

  it('tooth_counts_per_zone', () => {
    expect(ZONE_SHAPES.map((s) => s.teeth.length)).toEqual([8, 8, 12, 10, 8, 14])
    // 화면 밖이라 칸이 없는 치아는 정의하지 않는다
    for (let z = 0; z < ZONE_COUNT; z++) {
      const seen = new Set<number>()
      for (const i of toothCells(z)) seen.add(toothOf(z, i))
      expect(seen.size).toBe(ZONE_SHAPES[z].teeth.length)
    }
  })

  it('representative_cells', () => {
    // 앞니는 치아
    expect(isTooth(0, idx(22, 12))).toBe(true)
    expect(isTooth(0, idx(26, 12))).toBe(true)
    expect(isTooth(1, idx(21, 22))).toBe(true)
    expect(isTooth(2, idx(21, 3))).toBe(true)
    expect(isTooth(3, idx(21, 20))).toBe(true)
    expect(isTooth(4, idx(21, 8))).toBe(true)
    expect(isTooth(5, idx(21, 28))).toBe(true)
    // 입술(바깥 면 0·3), 입 안 빈 곳, 앞니 사이 V자 치간
    expect(isTooth(0, idx(24, 2))).toBe(false)
    expect(isTooth(3, idx(24, 28))).toBe(false)
    expect(isTooth(0, idx(24, 24))).toBe(false)
    expect(isTooth(0, idx(23, 7))).toBe(false)
    expect(isTooth(0, idx(24, 7))).toBe(false)
    // 입천장(1·2), 혀(4·5), 안쪽 면 앞니 사이 틈
    expect(isTooth(1, idx(24, 5))).toBe(false)
    expect(isTooth(2, idx(24, 16))).toBe(false)
    expect(isTooth(4, idx(24, 28))).toBe(false)
    expect(isTooth(5, idx(24, 15))).toBe(false)
    expect(isTooth(1, idx(24, 20))).toBe(false)
    expect(isTooth(4, idx(24, 8))).toBe(false)
  })

  it('front_upper_and_lower_separate', () => {
    // 위 바깥(0)에는 아래 치아가, 아래 바깥(3)에는 위 치아가 없다: 치아 칸 행 범위가 서로 다르다
    const rows = (z: number) => toothCells(z).map((i) => Math.floor(i / 48))
    expect(Math.max(...rows(0))).toBeLessThan(21)
    expect(Math.min(...rows(3))).toBeGreaterThan(11)
  })

  it('cell_is_tooth_iff_center_in_shape', () => {
    for (let z = 0; z < ZONE_COUNT; z++)
      for (let i = 0; i < 48 * 32; i++)
        expect(toothOf(z, i)).toBe(toothAt(z, (i % 48) * 10 + 5, Math.floor(i / 48) * 10 + 5))
  })

  it('box_geometry', () => {
    // 곧게 선 상자: 축 (0, AXIS), 반폭 10, 반높이 20, 잇몸 쪽 반지름 10, 끝 쪽 반지름 2
    const b: Box = [0, 100, 100, 0, AXIS, 10, 20, 10, 2]
    expect(inBox(b, 100, 100)).toBe(true)
    expect(inBox(b, 110, 100)).toBe(true)
    expect(inBox(b, 111, 100)).toBe(false)
    expect(inBox(b, 100, 80)).toBe(true) // 잇몸 쪽 꼭대기 가운데
    expect(inBox(b, 109, 81)).toBe(false) // 잇몸 쪽 모서리는 둥글다
    expect(inBox(b, 109, 119)).toBe(true) // 끝 쪽 모서리는 거의 각지다
    expect(inBox(b, 100, 121)).toBe(false)
    // 90도 돌린 상자: 축 (AXIS, 0) — 너비가 세로가 된다
    const s: Box = [0, 100, 100, AXIS, 0, 10, 20, 2, 2]
    expect(inBox(s, 100, 110)).toBe(true)
    expect(inBox(s, 100, 112)).toBe(false)
    expect(inBox(s, 120, 100)).toBe(true)
    expect(inEllipse([0, 0, 30, 20], 30, 0)).toBe(true)
    expect(inEllipse([0, 0, 30, 20], 0, 21)).toBe(false)
  })

  it('zone_total_proportional_and_within_capacity', () => {
    for (let z = 0; z < ZONE_COUNT; z++) {
      expect(ZONE_TOTAL[z]).toBe(60 * toothCells(z).length)
      expect(ZONE_TOTAL[z]).toBeLessThanOrEqual(toothCells(z).length * MAX_THICK)
    }
    const total = ZONE_TOTAL.reduce((a, b) => a + b, 0)
    const ratio = (29 * DEC_OPT * (TOTAL_TICKS - 5 * SWITCH_TICKS)) / total
    expect(ratio).toBeGreaterThanOrEqual(1.6)
    expect(ratio).toBeLessThanOrEqual(2.4)
  })

  it('cells_sorted_unique', () => {
    for (let z = 0; z < 6; z++) {
      const a = toothCells(z)
      for (let k = 1; k < a.length; k++) expect(a[k]).toBeGreaterThan(a[k - 1])
    }
  })

  it('geometry_is_integer', () => {
    for (const s of ZONE_SHAPES) {
      for (const b of s.teeth) for (const v of b) expect(Number.isInteger(v)).toBe(true)
      for (const e of [...s.inside, ...s.outside]) for (const v of e) expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('helpers', () => {
    expect(toothOf(0, idx(22, 12))).toBe(3)
    expect(toothOf(0, idx(26, 12))).toBe(4)
    expect(toothOf(0, idx(0, 0))).toBe(-1)
    expect(toothOf(9, 0)).toBe(-1)
  })
})

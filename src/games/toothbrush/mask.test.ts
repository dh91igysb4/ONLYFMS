import { describe, expect, it } from 'vitest'
import { DEC_OPT, MAX_THICK, SWITCH_TICKS, TOTAL_TICKS, ZONE_COUNT, ZONE_TOTAL } from './constants.ts'
import { AXIS, inBox, inEllipse, isTooth, KIND_TONGUE, toothAt, toothCells, toothOf, ZONE_SHAPES, type Box } from './mask.ts'

const idx = (c: number, r: number) => r * 48 + c

describe('mask', () => {
  it('tooth_cell_counts', () => {
    // 닦을 수 있는 칸(치아·혀) 수
    expect([0, 1, 2, 3, 4, 5].map((z) => toothCells(z).length)).toEqual([886, 440, 484, 492, 442, 466])
    for (let z = 0; z < ZONE_COUNT; z++) {
      expect(toothCells(z).length).toBeGreaterThanOrEqual(400)
      expect(toothCells(z).length).toBeLessThanOrEqual(900)
    }
  })

  it('box_corner_radii_valid', () => {
    for (const s of ZONE_SHAPES) {
      for (const [, , , , , hw, hh, rg, re] of [...s.teeth, ...(s.decor ?? [])]) {
        expect(rg).toBeLessThanOrEqual(Math.min(hw, hh))
        expect(re).toBeLessThanOrEqual(Math.min(hw, hh))
        expect(rg + re).toBeLessThanOrEqual(2 * hh)
      }
    }
  })

  it('tooth_counts_per_zone', () => {
    expect(ZONE_SHAPES.map((s) => s.teeth.length)).toEqual([20, 8, 12, 1, 8, 14])
    // 화면 밖이라 칸이 없는 치아는 정의하지 않는다
    for (let z = 0; z < ZONE_COUNT; z++) {
      const seen = new Set<number>()
      for (const i of toothCells(z)) seen.add(toothOf(z, i))
      expect(seen.size).toBe(ZONE_SHAPES[z].teeth.length)
    }
  })

  it('representative_cells', () => {
    // 앞니(바깥 0은 윗니·아랫니 모두), 혀 표면
    expect(isTooth(0, idx(22, 12))).toBe(true)
    expect(isTooth(0, idx(26, 12))).toBe(true)
    expect(isTooth(0, idx(22, 20))).toBe(true)
    expect(isTooth(0, idx(26, 20))).toBe(true)
    expect(isTooth(1, idx(21, 22))).toBe(true)
    expect(isTooth(2, idx(21, 3))).toBe(true)
    expect(isTooth(3, idx(24, 20))).toBe(true)
    expect(isTooth(3, idx(14, 8))).toBe(true)
    expect(isTooth(4, idx(21, 8))).toBe(true)
    expect(isTooth(5, idx(21, 28))).toBe(true)
    // 입술(바깥 0 위·아래), 위 앞니 사이 V자 치간
    expect(isTooth(0, idx(24, 1))).toBe(false)
    expect(isTooth(0, idx(24, 30))).toBe(false)
    expect(isTooth(0, idx(23, 3))).toBe(false)
    expect(isTooth(0, idx(24, 3))).toBe(false)
    // 혀(3): 입 안·윗니(혀 위), 입꼬리 쪽, 혀끝 아래, 혀 상자 안이지만 타원 밖인 모서리
    expect(isTooth(3, idx(24, 5))).toBe(false)
    expect(isTooth(3, idx(5, 20))).toBe(false)
    expect(isTooth(3, idx(24, 31))).toBe(false)
    expect(isTooth(3, idx(12, 8))).toBe(false)
    // 입천장(1·2), 혀(4·5), 안쪽 면 앞니 사이 틈
    expect(isTooth(1, idx(24, 5))).toBe(false)
    expect(isTooth(2, idx(24, 16))).toBe(false)
    expect(isTooth(4, idx(24, 28))).toBe(false)
    expect(isTooth(5, idx(24, 15))).toBe(false)
    expect(isTooth(1, idx(24, 20))).toBe(false)
    expect(isTooth(4, idx(24, 8))).toBe(false)
  })

  it('front_closed_bite', () => {
    // 바깥(0)은 다문 정면: 위 치아(축이 아래)가 앞에 10개, 아래 치아가 뒤에 10개. 둘 다 칸이 있고 교합선에서 만난다
    const teeth = ZONE_SHAPES[0].teeth
    expect(teeth.slice(0, 10).every((b) => b[4] > 0)).toBe(true)
    expect(teeth.slice(10).every((b) => b[4] < 0)).toBe(true)
    const rows = (upper: boolean) =>
      toothCells(0).filter((i) => (toothOf(0, i) < 10) === upper).map((i) => Math.floor(i / 48))
    expect(Math.min(...rows(true))).toBeLessThan(6)
    expect(Math.max(...rows(false))).toBeGreaterThan(22)
    expect(Math.max(...rows(true)) + 1).toBeGreaterThanOrEqual(Math.min(...rows(false)))
    // 가장 작은 치아도 칫솔 원 지름(70) 이상의 높이
    for (const b of teeth) expect(2 * b[6]).toBeGreaterThanOrEqual(70)
  })

  it('tongue_zone', () => {
    // 혀(3): 닦을 수 있는 도형은 혀 하나(혀 상자 ∩ inside 타원). 장식 치아는 판정에 쓰이지 않는다
    const s = ZONE_SHAPES[3]
    expect(s.teeth.map((b) => b[0])).toEqual([KIND_TONGUE])
    expect(s.inside.length).toBe(1)
    expect(s.decor?.length).toBeGreaterThan(0)
    expect(s.mouth?.length).toBe(2)
    for (const i of toothCells(3)) expect(toothOf(3, i)).toBe(0)
    // 혀 밖에 있는 장식 치아의 중심은 닦을 수 있는 칸이 아니다
    for (const b of (s.decor ?? []).filter((d) => !inBox(s.teeth[0], d[1], d[2])))
      expect(toothAt(3, b[1], b[2])).toBe(-1)
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
      expect(ZONE_TOTAL[z]).toBe(74 * toothCells(z).length)
      expect(ZONE_TOTAL[z]).toBeLessThanOrEqual(toothCells(z).length * MAX_THICK)
    }
    const total = ZONE_TOTAL.reduce((a, b) => a + b, 0)
    const ratio = (29 * DEC_OPT * (TOTAL_TICKS - 5 * SWITCH_TICKS)) / total
    expect(ratio).toBeGreaterThanOrEqual(1.5)
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
      for (const b of s.decor ?? []) for (const v of b) expect(Number.isInteger(v)).toBe(true)
      for (const e of [...s.inside, ...s.outside, ...(s.mouth ?? [])]) for (const v of e) expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('helpers', () => {
    expect(toothOf(0, idx(22, 12))).toBe(4)
    expect(toothOf(0, idx(26, 12))).toBe(5)
    expect(toothOf(0, idx(22, 20))).toBe(14)
    expect(toothOf(3, idx(24, 20))).toBe(0)
    expect(toothOf(0, idx(0, 0))).toBe(-1)
    expect(toothOf(9, 0)).toBe(-1)
  })
})

import { describe, expect, it } from 'vitest'
import { MM, SEG_LEN } from './constants.ts'
import { TEMPLATES, buildTemplate, type Template } from './pieces.ts'
import { TURN, isqrt } from './trig.ts'

const mk = (prims: Template['prims']): Template => ({ id: 'x', tier: 1, prims })

describe('buildTemplate', () => {
  it('line 하나는 선분 1개', () => {
    const b = buildTemplate(mk([{ t: 'line', dx: 100, dy: 50 }]))
    expect(b.segs).toEqual([{ x0: 0, y0: 0, x1: 100, y1: 50, boost: false }])
    expect([b.endX, b.endY]).toEqual([100, 50])
  })

  it('반원 arc: 선분 수와 반지름', () => {
    const r = 1000 * MM
    const b = buildTemplate(mk([{ t: 'arc', r, a0: TURN / 2, a1: TURN }]))
    expect(b.segs.length).toBeGreaterThanOrEqual(Math.floor((355 * r) / 113 / SEG_LEN))
    expect(b.segs[0].x0).toBe(0)
    const cx = r
    const cy = 0
    for (const s of b.segs) {
      for (const [x, y] of [[s.x0, s.y0], [s.x1, s.y1]]) {
        const d = isqrt((x - cx) ** 2 + (y - cy) ** 2)
        expect(Math.abs(d - r)).toBeLessThanOrEqual(2)
      }
    }
    expect(b.endX).toBeGreaterThan(2 * r - 3)
    expect(b.endX).toBeLessThan(2 * r + 3)
    expect(b.minY).toBeLessThan(-r + Math.floor(r / 50)) // 꼭짓점이 바닥에 딱 놓이지 않을 수 있다
  })

  it('연속 선분은 이어지고 gap은 끊는다', () => {
    const b = buildTemplate(mk([{ t: 'line', dx: 10, dy: 0 }, { t: 'gap', dx: 5, dy: -3 }, { t: 'line', dx: 10, dy: 0 }]))
    expect(b.segs[1].x0).toBe(15)
    expect(b.segs[1].y0).toBe(-3)
    for (const t of TEMPLATES) {
      const s = buildTemplate(t).segs
      const hasGap = t.prims.some((p) => p.t === 'gap')
      if (!hasGap) for (let i = 1; i < s.length; i++) expect([s[i].x0, s[i].y0]).toEqual([s[i - 1].x1, s[i - 1].y1])
    }
  })

  it('boost 선분만 boost: true', () => {
    const b = buildTemplate(mk([{ t: 'line', dx: 10, dy: 0 }, { t: 'boost', len: 20 }, { t: 'line', dx: 10, dy: 5 }]))
    expect(b.segs.map((s) => s.boost)).toEqual([false, true, false])
    expect(b.segs[1].y1).toBe(b.segs[1].y0)
  })

  it('gem은 펜을 움직이지 않고 위치만 기록', () => {
    const b = buildTemplate(mk([{ t: 'line', dx: 10, dy: 0 }, { t: 'gem', dx: 3, dy: 4 }, { t: 'line', dx: 10, dy: 0 }]))
    expect(b.gems).toEqual([{ x: 13, y: 4 }])
    expect(b.segs[1].x0).toBe(10)
  })

  it('minY는 선분 최저 y', () => {
    const b = buildTemplate(mk([{ t: 'line', dx: 10, dy: -7 }, { t: 'line', dx: 10, dy: 20 }]))
    expect(b.minY).toBe(-7)
  })
})

describe('TEMPLATES', () => {
  it('id 중복 없음', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length)
  })
  for (const t of TEMPLATES) {
    it(`${t.id}: 정수, 수평 시작·끝 ≥ 1 m, endX > 0, minY 정확`, () => {
      const b = buildTemplate(t)
      const first = b.segs[0]
      const last = b.segs[b.segs.length - 1]
      expect(first.y0).toBe(first.y1)
      expect(last.y0).toBe(last.y1)
      expect(first.x1 - first.x0).toBeGreaterThanOrEqual(1000 * MM)
      expect(last.x1 - last.x0).toBeGreaterThanOrEqual(1000 * MM)
      expect(b.endX).toBeGreaterThan(0)
      for (const s of b.segs) for (const v of [s.x0, s.y0, s.x1, s.y1]) expect(Number.isInteger(v)).toBe(true)
      for (const g of b.gems) expect(Number.isInteger(g.x) && Number.isInteger(g.y)).toBe(true)
      expect(b.minY).toBe(Math.min(...b.segs.flatMap((s) => [s.y0, s.y1])))
    })
  }
  it('bowl은 보석 4개', () => {
    expect(buildTemplate(TEMPLATES.find((t) => t.id === 'bowl')!).gems).toHaveLength(4)
  })
  it('ramp: 착지 평지가 이륙점보다 낮다', () => {
    const b = buildTemplate(TEMPLATES.find((t) => t.id === 'ramp')!)
    expect(b.endY).toBeLessThan(b.segs[1].y1)
  })
})

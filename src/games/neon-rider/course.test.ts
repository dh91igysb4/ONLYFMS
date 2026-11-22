import { describe, expect, it } from 'vitest'
import { REST_LEN, START_BACK, START_LEN } from './constants.ts'
import { courseCacheSize, courseFromTemplates, courseOf, getCourse, makeSeededCourse } from './course.ts'
import type { Prim, Template } from './pieces.ts'

const flat = (id: string, tier: 1 | 2 | 3 | 4, extra: Prim[] = []): Template => ({
  id,
  tier,
  prims: [{ t: 'line', dx: 20000, dy: 0 }, ...extra, { t: 'line', dx: 20000, dy: 0 }],
})
// 티어마다 5개씩: 연속 4개 안에 같은 id가 없어야 하는 조건을 검사할 수 있다.
const POOL: Template[] = ([1, 2, 3, 4] as const).flatMap((tier) => [0, 1, 2, 3, 4].map((n) => flat(`t${tier}-${n}`, tier)))
const ids = (c: ReturnType<typeof getCourse>, n: number) => Array.from({ length: n }, (_, k) => c.section(k).templateId)

describe('neon-rider 코스', () => {
  it('같은 seed면 구간 0~49가 같고 다른 seed면 다르다', () => {
    const a = ids(makeSeededCourse('aa11', POOL), 50)
    expect(ids(makeSeededCourse('aa11', POOL), 50)).toEqual(a)
    expect(ids(makeSeededCourse('bb22', POOL), 50)).not.toEqual(a)
    expect(ids(getCourse('00ff00ff'), 50)).toEqual(ids(getCourse('00ff00ff'), 50))
  })

  it('선분이 이어지고 구간 경계에서 높이가 이어진다 (실제 템플릿)', () => {
    const c = getCourse('1234abcd')
    expect(c.seg(0)).toMatchObject({ x0: -START_BACK, y0: 0, x1: START_LEN, y1: 0 })
    const last = c.section(30).lastSeg
    const restStarts = new Set([1, ...Array.from({ length: 31 }, (_, k) => c.section(k).firstSeg)])
    for (let i = 1; i <= last; i++) {
      const a = c.seg(i - 1)
      const b = c.seg(i)
      if (restStarts.has(i)) {
        // 시작 평지·구간 사이 이음: 반드시 이어진다
        expect(b.x0).toBe(a.x1)
        expect(b.y0).toBe(a.y1)
      } else if (b.x0 !== a.x1) {
        expect(b.x0).toBeGreaterThan(a.x1) // 템플릿 안의 gap(앞으로만 끊김)
      } else expect(b.y0).toBe(a.y1)
    }
    for (let k = 0; k < 30; k++) {
      const s = c.section(k)
      expect(c.seg(s.firstSeg)).toMatchObject({ x0: s.startX, x1: s.startX + REST_LEN })
      expect(c.seg(s.lastSeg).x1).toBe(s.endX)
      expect(c.section(k + 1).startX).toBe(s.endX)
      expect(c.seg(c.section(k + 1).firstSeg).y0).toBe(c.seg(s.lastSeg).y1)
    }
  })

  it('gap은 x가 끊기는 유일한 곳이다', () => {
    const c = courseFromTemplates([flat('g', 1, [{ t: 'gap', dx: 7000, dy: -500 }])])
    const last = c.section(5).lastSeg
    let breaks = 0
    for (let i = 1; i <= last; i++) {
      const a = c.seg(i - 1)
      const b = c.seg(i)
      if (b.x0 !== a.x1) {
        breaks++
        expect(b.x0 - a.x1).toBe(7000)
        expect(b.y0 - a.y1).toBe(-500)
      }
    }
    expect(breaks).toBe(6)
  })

  it('구간 0~3은 tier 1만 나온다', () => {
    for (const seed of ['01', '02', '03', '04', '05', '06']) {
      const c = makeSeededCourse(seed, POOL)
      for (let k = 0; k < 4; k++) expect(c.section(k).templateId.startsWith('t1-')).toBe(true)
    }
  })

  it('템플릿이 4개 이상인 티어에서는 연속 4개 안에 같은 id가 없다', () => {
    for (const seed of ['aa', 'bb', 'cc']) {
      const list = ids(makeSeededCourse(seed, POOL), 80)
      for (let k = 0; k + 3 < list.length; k++) expect(new Set(list.slice(k, k + 4)).size).toBe(4)
    }
  })

  it('후반에는 높은 티어도 나온다', () => {
    const list = ids(makeSeededCourse('ee', POOL), 120)
    expect(list.some((id) => id.startsWith('t4-'))).toBe(true)
  })

  it('후보가 없으면 제한을 푼다 (티어 안 템플릿이 하나뿐)', () => {
    const c = makeSeededCourse('ff', [flat('only', 1)])
    expect(ids(c, 6)).toEqual(Array(6).fill('only'))
  })

  it('courseOf는 주어진 순서를 반복한다', () => {
    const c = courseOf(['hill', 'ramp'])
    expect(ids(c, 5)).toEqual(['hill', 'ramp', 'hill', 'ramp', 'hill'])
    expect(() => courseOf(['nope'])).toThrow()
  })

  it('courseFromTemplates는 Template 객체를 순환한다', () => {
    const a = flat('a', 3)
    const b = flat('b', 4)
    expect(ids(courseFromTemplates([a, b]), 4)).toEqual(['a', 'b', 'a', 'b'])
  })

  it('section 범위가 단조 증가하고 minY가 구간 안 최저다', () => {
    const c = getCourse('9999aaaa')
    let prev = 0
    for (let k = 0; k < 40; k++) {
      const s = c.section(k)
      expect(s.index).toBe(k)
      expect(s.firstSeg).toBeLessThanOrEqual(s.lastSeg)
      expect(s.firstSeg).toBe(prev + 1)
      prev = s.lastSeg
      let low = Infinity
      for (let i = s.firstSeg; i <= s.lastSeg; i++) low = Math.min(low, c.seg(i).y0, c.seg(i).y1)
      expect(s.minY).toBe(low)
    }
  })

  it('보석 id는 전역에서 유일하고 증가하며 gemsBetween은 겹치는 구간의 보석을 준다', () => {
    const g = flat('gem', 1, [{ t: 'gem', dx: 100, dy: 200 }, { t: 'gem', dx: 300, dy: 200 }])
    const c = courseFromTemplates([g])
    const s2 = c.section(2)
    const all = c.gemsBetween(0, c.section(3).lastSeg)
    expect(all.map((x) => x.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    const mid = c.gemsBetween(s2.firstSeg, s2.lastSeg)
    expect(mid.map((x) => x.id)).toEqual([4, 5])
    expect(mid[0].x).toBeGreaterThan(s2.startX + REST_LEN)
    expect(mid[0].x).toBeLessThan(s2.endX)
    expect(c.gemsBetween(0, 0)).toEqual([])
  })

  it('seg/section/gemsBetween은 잘못된 인덱스에 던진다', () => {
    const c = getCourse('abab')
    expect(() => c.seg(-1)).toThrow()
    expect(() => c.seg(1.5)).toThrow()
    expect(() => c.section(-1)).toThrow()
    expect(() => c.gemsBetween(-1, 3)).toThrow()
  })

  it('section(600)까지 만든 뒤 seg 조회가 빠르다', () => {
    const c = getCourse('cafe0001')
    const n = c.section(600).lastSeg
    const t0 = performance.now()
    let acc = 0
    for (let j = 0; j < 100000; j++) acc += c.seg(j % n).x0
    expect(performance.now() - t0).toBeLessThan(50)
    expect(acc).toBeGreaterThan(0)
  })

  it('getCourse 캐시는 4개를 넘지 않고 같은 seed는 같은 객체다', () => {
    for (const s of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) getCourse(s)
    expect(courseCacheSize()).toBeLessThanOrEqual(4)
    expect(getCourse('c6')).toBe(getCourse('c6'))
  })
})

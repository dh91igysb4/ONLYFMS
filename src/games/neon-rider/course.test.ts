import { describe, expect, it } from 'vitest'
import { FALL_DEPTH, REST_LEN, START_BACK, START_LEN, TIER_WEIGHTS } from './constants.ts'
import { courseCacheSize, courseFromTemplates, courseOf, getCourse, makeSeededCourse, type Course } from './course.ts'
import type { Box } from './collide.ts'
import type { HazardDef } from './hazards.ts'
import type { Motion } from './motion.ts'
import type { MoverDef } from './movers.ts'
import type { Prim, Template } from './pieces.ts'
import { TURN } from './trig.ts'

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

  it('첫 가중치 전환(TIER_WEIGHTS[1].from = 3) 전 구간 0~2는 tier 1만 나온다', () => {
    expect(TIER_WEIGHTS[0].w).toEqual([1, 0, 0, 0])
    const first = TIER_WEIGHTS[1].from
    expect(first).toBe(3)
    for (const seed of ['01', '02', '03', '04', '05', '06']) {
      const c = makeSeededCourse(seed, POOL)
      for (let k = 0; k < first; k++) expect(c.section(k).templateId.startsWith('t1-')).toBe(true)
    }
  })

  it('실제 템플릿으로 첫 구간들부터 여러 종류가 나온다: 구간 0~5에 서로 다른 템플릿 4종 이상(seed 20개 모두)', () => {
    for (let n = 0; n < 20; n++) {
      const c = getCourse(`5eed${n.toString(16).padStart(4, '0')}`)
      expect(new Set(ids(c, 6)).size).toBeGreaterThanOrEqual(4)
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
    // 다시 생성하지 않는 O(1) 조회면 수 ms다. 느린 CI·병렬 실행에서 흔들리지 않게 여유를 크게 둔다(다시 생성하면 수 초 걸린다).
    expect(performance.now() - t0).toBeLessThan(500)
    expect(acc).toBeGreaterThan(0)
  })

  it('getCourse 캐시는 4개를 넘지 않고 같은 seed는 같은 객체다', () => {
    for (const s of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) getCourse(s)
    expect(courseCacheSize()).toBeLessThanOrEqual(4)
    expect(getCourse('c6')).toBe(getCourse('c6'))
  })
})

// ── 위험물·움직이는 길·블록 (이 파일 안의 시험용 템플릿) ──
const NONE: Motion = { k: 'none' }
const hz = (dx: number, dy: number, h: HazardDef): Prim => ({ t: 'hazard', dx, dy, h })
const mv = (dx: number, dy: number, m: MoverDef): Prim => ({ t: 'mover', dx, dy, m })
const line = (dx: number): Prim => ({ t: 'line', dx, dy: 0 })
const disc = (x: number, y: number, r: number): HazardDef => ({ shape: { s: 'disc', x, y, r }, motion: NONE, look: 'saw' })
const yellow = (x1: number, motion: Motion): MoverDef => ({
  segs: [{ x0: 0, y0: 0, x1, y1: 0, boost: false }],
  pivotX: 0,
  pivotY: 0,
  motion,
  start: { k: 'time' },
  look: 'yellow',
})
// 템플릿 길이 40000. 구간 k의 템플릿 원점은 section(k).startX + REST_LEN, 높이 0.
const HZ: Template = flat('hz', 1, [hz(5000, 1000, disc(0, 0, 500))]) // 원 중심 = 템플릿 (25000, 1000)
const PLAIN: Template = flat('plain', 1)
const origin = (c: Course, k: number): number => c.section(k).startX + REST_LEN
const at = (x: number, y: number, r = 10): Box => ({ x0: x - r, y0: y - r, x1: x + r, y1: y + r })

describe('neon-rider 코스: 위험물·움직이는 길·블록', () => {
  it('위험물을 월드 좌표로 옮기고, 같은 구간·다음 구간까지 상자와 겹치는 것만 준다', () => {
    const c = courseFromTemplates([HZ])
    const x0 = origin(c, 0) + 25000
    const x1 = origin(c, 1) + 25000
    expect(c.hazardsNear(at(x0, 1000))).toEqual([{ id: 0, shape: { s: 'disc', x: x0, y: 1000, r: 500 }, motion: NONE, look: 'saw' }])
    expect(c.hazardsNear({ x0, y0: 0, x1, y1: 2000 }).map((h) => h.id)).toEqual([0, 1])
    expect(c.hazardsNear(at(x1, 1000)).map((h) => h.id)).toEqual([1])
    expect(c.hazardsNear({ x0: x0 + 600, y0: 0, x1: x1 - 600, y1: 2000 })).toEqual([]) // 두 원 사이
    expect(c.hazardsNear(at(x0, 2000))).toEqual([]) // 위로 빗나감
    expect(c.moversNear(at(x0, 1000))).toEqual([])
    expect(c.blocksNear(at(x0, 1000))).toEqual([])
  })

  it('Review Focus 3: 구간 끝을 넘어 뻗은 날, 구간 앞으로 뻗은 막대, 다음 구간까지 가는 왕복 길도 찾는다', () => {
    const blades: HazardDef = { shape: { s: 'blades', x: 0, y: 0, rIn: 0, rOut: 8000, n: 2, w: 600 }, motion: { k: 'rotate', a0: 0, w: 5 }, look: 'blades' }
    const BIG: Template = { id: 'big', tier: 1, prims: [line(20000), line(20000), hz(-1000, 0, blades)] } // 중심 x 39000, 끝 40000을 7000 넘음
    const end0 = (c: Course): number => c.section(0).endX
    const a = courseFromTemplates([BIG, PLAIN])
    expect(a.hazardsNear(at(end0(a) + 5000, 0)).map((h) => h.id)).toEqual([0])
    expect(a.hazardsNear(at(end0(a) + 7500, 0))).toEqual([])

    // 템플릿 원점에서 뒤로 30000: 앞 구간(평지) 안까지 뻗는다. 새 코스에서 구간 1을 만들기 전에 묻는다.
    const back: HazardDef = { shape: { s: 'bar', x0: -30000, y0: 0, x1: 0, y1: 0, r: 100 }, motion: NONE, look: 'laser' }
    const BACK: Template = { id: 'back', tier: 1, prims: [hz(0, 0, back), line(20000), line(20000)] }
    const ref = courseFromTemplates([PLAIN, BACK])
    const s1 = ref.section(1).startX
    const fresh = courseFromTemplates([PLAIN, BACK])
    expect(fresh.hazardsNear(at(s1 - 10000, 0)).map((h) => h.shape)).toEqual([{ s: 'bar', x0: s1 + REST_LEN - 30000, y0: 0, x1: s1 + REST_LEN, y1: 0, r: 100 }])

    // 왕복 범위: 템플릿 x 38000에서 오른쪽으로 20000 더 간다(구간 끝 40000 너머).
    const SW: Template = { id: 'sw', tier: 1, prims: [line(20000), line(20000), mv(-2000, 0, yellow(1000, { k: 'swing', ax: 20000, ay: 0, period: 120, phase: 0 }))] }
    const b = courseFromTemplates([SW, PLAIN])
    expect(b.moversNear(at(end0(b) + 15000, 0)).map((m) => m.id)).toEqual([0])
    expect(b.moversNear(at(end0(b) + 25000, 0))).toEqual([])
  })

  it('움직이는 길: 월드 좌표(선분·기준점·pass.x), 회전 범위, fall은 아래로 FALL_DEPTH까지', () => {
    const pass: MoverDef = { ...yellow(3000, { k: 'fall', w: 0 }), pivotX: 1500, start: { k: 'pass', x: -4000, delay: 6 } }
    const T: Template = flat('mv', 1, [mv(1000, 500, pass), mv(10000, 0, { ...yellow(3000, { k: 'rotate', a0: 0, w: 7 }), look: 'green' })])
    const c = courseFromTemplates([T])
    const ox = origin(c, 0)
    const [m] = c.moversNear(at(ox + 22000, 500))
    expect(m).toEqual({
      ...pass,
      id: 0,
      segs: [{ x0: ox + 21000, y0: 500, x1: ox + 24000, y1: 500, boost: false }],
      pivotX: ox + 22500,
      pivotY: 500,
      start: { k: 'pass', x: ox + 17000, delay: 6 },
    })
    expect(c.moversNear(at(ox + 22000, 500 - FALL_DEPTH + 20)).map((x) => x.id)).toEqual([0])
    expect(c.moversNear(at(ox + 22000, 500 - FALL_DEPTH - 20))).toEqual([])
    // 회전 길: 기준점 (ox + 30000, 0) 둘레 반지름 3000
    expect(c.moversNear(at(ox + 30000 - 2900, 0, 50)).map((x) => x.id)).toEqual([1])
    expect(c.moversNear(at(ox + 30000, 2900, 50)).map((x) => x.id)).toEqual([1])
    expect(c.moversNear(at(ox + 30000, 3200, 50))).toEqual([])
  })

  it('블록: 처음 자세 상자(바닥 변 가운데 기준, 처음 각도로 돈 상자)로 찾는다', () => {
    const T: Template = flat('blk', 1, [
      { t: 'block', dx: 5000, dy: 0, b: { x: 0, y: 0, w: 1000, h: 4000, a: 0 } },
      { t: 'block', dx: 10000, dy: 0, b: { x: 0, y: 0, w: 1000, h: 4000, a: TURN / 4 } }, // 왼쪽으로 누운 블록
    ])
    const c = courseFromTemplates([T])
    const bx = origin(c, 0) + 25000
    const cx = origin(c, 0) + 30000
    expect(c.blocksNear(at(bx, 3980, 5))).toEqual([{ id: 0, x: bx, y: 0, w: 1000, h: 4000, a: 0 }])
    expect(c.blocksNear(at(bx, 4100, 5))).toEqual([])
    expect(c.blocksNear(at(bx + 600, 100, 5))).toEqual([])
    expect(c.blocksNear(at(cx - 3500, 0, 5)).map((b) => b.id)).toEqual([1])
    expect(c.blocksNear(at(cx - 3500, 1000, 5))).toEqual([])
    expect(c.blocksNear(at(cx + 600, 0, 5))).toEqual([])
  })

  it('공중 비행 상자: 진행 번호와 상관없이 x 범위로 찾고, 필요한 구간을 만든다', () => {
    const ref = courseFromTemplates([HZ])
    const x4 = origin(ref, 4) + 25000
    const fresh = courseFromTemplates([HZ]) // seg·section을 한 번도 부르지 않음
    expect(fresh.hazardsNear(at(x4, 1000)).map((h) => [h.id, h.shape])).toEqual([[4, { s: 'disc', x: x4, y: 1000, r: 500 }]])
  })

  it('id는 시드에 대해 결정적이고 종류마다 0부터 중복 없이 이어지며, 먼저 만든 구간 수와 상관없다', () => {
    const items: Prim[][] = [
      [hz(3000, 800, disc(0, 0, 400)), { t: 'block', dx: 9000, dy: 0, b: { x: 0, y: 0, w: 800, h: 1600, a: 0 } }],
      [mv(2000, 0, yellow(4000, { k: 'swing', ax: 0, ay: 900, period: 90, phase: 10 })), hz(8000, 600, disc(0, 0, 300)), hz(9000, 600, disc(0, 0, 300))],
      [mv(0, 0, { ...yellow(2000, { k: 'fall', w: 1 }), start: { k: 'touch', delay: 3 } })],
    ]
    const pool: Template[] = ([1, 2, 3, 4] as const).flatMap((tier) =>
      items.map((extra, n) => ({ id: `m${tier}-${n}`, tier, prims: [line(10000 + 3000 * n), ...extra, line(10000 + 1000 * tier)] })),
    )
    const all = (c: Course, x1: number) => {
      const box = { x0: -START_BACK, y0: -100000000, x1, y1: 100000000 }
      return { h: c.hazardsNear(box), m: c.moversNear(box), b: c.blocksNear(box) }
    }
    const x1 = makeSeededCourse('d00d', pool).section(25).endX
    const a = all(makeSeededCourse('d00d', pool), x1)
    const ahead = makeSeededCourse('d00d', pool)
    ahead.section(60)
    expect(all(ahead, x1)).toEqual(a)
    for (const list of [a.h, a.m, a.b]) {
      expect(list.length).toBeGreaterThan(5)
      expect(list.map((x) => x.id)).toEqual(list.map((_, i) => i))
    }
    expect(all(makeSeededCourse('beef', pool), x1)).not.toEqual(a)
    for (const m of a.m) expect(ahead.moverById(m.id)).toEqual(m)
  })

  it('moverById: 만든 구간의 길은 같은 내용, 없는 id는 던진다', () => {
    const c = courseFromTemplates([flat('one', 1, [mv(0, 0, yellow(1000, NONE))])])
    const near = c.moversNear(at(origin(c, 2) + 20500, 0))
    expect(near.map((m) => m.id)).toEqual([2])
    expect(c.moverById(2)).toEqual(near[0])
    expect(c.moverById(0)).toEqual(c.moversNear(at(origin(c, 0) + 20500, 0))[0])
    expect(c.moverById(0).pivotX).toBe(origin(c, 0) + 20000)
    expect(() => c.moverById(-1)).toThrow()
    expect(() => c.moverById(1.5)).toThrow()
    expect(() => c.moverById(1000000)).toThrow()
  })

  it('위험물이 없는 코스에서 *Near는 빈 목록', () => {
    const c = makeSeededCourse('1234abcd', POOL)
    const box = { x0: 0, y0: -1000000, x1: c.section(10).endX, y1: 1000000 }
    expect([c.hazardsNear(box), c.moversNear(box), c.blocksNear(box)]).toEqual([[], [], []])
  })
})

import { describe, expect, it } from 'vitest'
import { COL_MAX, COL_MIN, TIER_WEIGHTS, obstaclesInStage } from './constants.ts'
import { courseFromSegments, decorRandom, getCourse, makeCourse, u32Stream } from './course.ts'
import { JOINT, PARSED, PARSED_OBSTACLES, START_PARSED, parseSegment } from './segments.ts'
import type { Cell } from './segments.ts'

const SEED = '0123456789abcdef0123456789abcdef'
const seedN = (n: number) => n.toString(16).padStart(2, '0').repeat(16)

function allCells(seed: string, rows: number) {
  const c = makeCourse(seed) // 캐시를 거치지 않는 새 인스턴스
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
// id 뒤의 ~는 좌우 반전
const GOLDEN = [
  'start', 'd-steep-blocks~', 'o1-down-blocks~', 'tunnel-16~', 'd-terraces~', 'o2-zigzag~',
  'tunnel-14', 'd-ridge~', 'o1-edge-pillars', 'o1-gate-wide~', 'tunnel-14~', 'd-ridge~',
]
const stageW = (stage: number) => [...TIER_WEIGHTS].reverse().find((b) => b.fromStage <= stage)!.w
const flipBank = (c: Cell): Cell => (c.bank === undefined ? c : { ...c, bank: (-c.bank) as -1 | 1 })

describe('course', () => {
  it('same seed same course', () => {
    expect(allCells(SEED, 3000)).toBe(allCells(SEED, 3000))
    // 읽는 순서와 상관없다: 정방향으로 전부 읽은 인스턴스 vs 뒤에서부터(2500행 먼저) 읽은 인스턴스
    const fwd = makeCourse(SEED)
    const rev = makeCourse(SEED)
    const cellsOf = (c: ReturnType<typeof makeCourse>, r: number) => {
      const out: unknown[] = []
      for (let col = COL_MIN; col <= COL_MAX; col++) out.push(c.cell(col, r))
      return JSON.stringify(out)
    }
    const a: string[] = []
    for (let r = 0; r <= 3000; r++) a.push(cellsOf(fwd, r))
    const b: string[] = new Array(3001)
    for (let r = 3000; r >= 0; r--) b[r] = cellsOf(rev, r)
    expect(b).toEqual(a)
    expect(JSON.stringify(rev.segmentsBetween(0, 3000))).toBe(JSON.stringify(fwd.segmentsBetween(0, 3000)))
    expect(getCourse(SEED)).toBe(getCourse(SEED)) // 캐시는 같은 인스턴스
    expect(makeCourse(SEED)).not.toBe(makeCourse(SEED))
    expect(allCells(seedN(1), 3000)).not.toBe(allCells(seedN(2), 3000))
  })
  it('starts with START', () => {
    const s = getCourse(SEED).segmentAt(0)
    expect(s.id).toBe('start')
    expect(s.startRow).toBe(0)
    expect(s.length).toBe(START_PARSED.length)
  })
  it('no obstacle repeats within the last 3 obstacles', () => {
    for (let n = 0; n < 10; n++) {
      const ids = segs(seedN(n + 10), 200).filter((s) => s.kind === 'obstacle').map((s) => s.id)
      for (let i = 0; i + 3 < ids.length; i++) {
        expect(new Set(ids.slice(i, i + 4)).size).toBe(4)
      }
    }
  })
  it('stage cycle: tunnel, descent, obstacle x obstaclesInStage(stage), tunnel, ...', () => {
    // 단계 = 지나온 터널 수(시작 터널 포함) = 그 구간의 속도 단계. 단계 1·2는 장애물 1개, 3부터 2개.
    expect([0, 1, 2, 3, 4, 10, 50].map(obstaclesInStage)).toEqual([1, 1, 1, 2, 2, 2, 2])
    for (const seed of [SEED, seedN(7), 'a1b2c3d4e5f60718293a4b5c6d7e8f90']) {
      const kinds = segs(seed, 60).map((s) => s.kind)
      const want: string[] = ['tunnel']
      for (let stage = 1; want.length < kinds.length; stage++) {
        want.push('descent', ...new Array<string>(obstaclesInStage(stage)).fill('obstacle'), 'tunnel')
      }
      expect(kinds, seed).toEqual(want.slice(0, kinds.length))
    }
  })
  it('every segment after the start takes exactly 3 draws (mirror bit is the 3rd)', () => {
    for (const seed of [SEED, seedN(9)]) {
      const next = u32Stream(seed, 'course')
      const list = segs(seed, 40)
      for (let i = 1; i < list.length; i++) {
        next()
        next()
        expect(list[i].mirrored, `${seed} #${i} ${list[i].kind}`).toBe((next() & 1) === 1)
      }
    }
  })
  it('tier weights by stage (rescaled for shorter stages)', () => {
    expect(TIER_WEIGHTS.map((b) => b.fromStage)).toEqual([0, 2, 5, 8, 12])
    expect(TIER_WEIGHTS.map((b) => b.w)).toEqual([[1, 0, 0, 0], [3, 1, 0, 0], [2, 2, 1, 0], [1, 2, 2, 1], [1, 1, 2, 2]])
  })
  it('tier by stage: obstacle tiers follow the stage weights', () => {
    for (let n = 0; n < 10; n++) {
      let tunnels = 0
      for (const s of segs(seedN(n + 30), 200)) {
        if (s.kind === 'tunnel') tunnels++
        if (s.kind !== 'obstacle') continue
        expect(stageW(tunnels)[s.tier - 1], `${s.id} stage ${tunnels}`).toBeGreaterThan(0)
      }
      expect(tunnels).toBeGreaterThan(12)
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
    const X = PARSED_OBSTACLES.find((p) => p.id === 'o2-gate-corridor')!
    const a = courseFromSegments([{ seg: X, mirrored: true }])
    const b = courseFromSegments([{ seg: X, mirrored: false }])
    for (let r = 0; r < X.length; r++) {
      for (let col = COL_MIN; col <= COL_MAX; col++) expect(a.cell(col, r)).toEqual(flipBank(b.cell(-col, r)))
    }
    let asym = false
    for (let r = 0; r < X.length; r++) if (JSON.stringify(a.cell(-1, r)) !== JSON.stringify(a.cell(1, r))) asym = true
    expect(asym).toBe(true)
  })
  it('mirror flips bank', () => {
    const banked = PARSED.filter((p) => p.cells.some((row) => row.some((c) => c.bank !== undefined)))
    expect(banked.length).toBeGreaterThan(0)
    for (const X of banked) {
      const a = courseFromSegments([{ seg: X, mirrored: true }])
      const b = courseFromSegments([{ seg: X, mirrored: false }])
      let seen = 0
      for (let r = 0; r < X.length; r++) {
        for (let col = COL_MIN; col <= COL_MAX; col++) {
          const orig = b.cell(col, r).bank
          const flipped = a.cell(-col, r).bank
          if (orig === undefined) expect(flipped, `${X.id} ${col},${r}`).toBeUndefined()
          else {
            seen++
            expect(flipped, `${X.id} ${col},${r}`).toBe(-orig)
          }
        }
      }
      expect(seen, X.id).toBeGreaterThan(0)
    }
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
    const before = allCells(s, 2000)
    const r = decorRandom(s)
    for (let i = 0; i < 1000; i++) r()
    expect(allCells(s, 2000)).toBe(before)
    const a = u32Stream(s, 'x')()
    expect(Number.isInteger(a) && a >= 0 && a < 2 ** 32).toBe(true)
    expect(u32Stream(s, 'decor')()).not.toBe(u32Stream(s, 'course')())
  })
  it('golden: first segments of a fixed seed', () => {
    // 템플릿·가중치가 바뀌면 코스가 달라져 기존 기록이 재생되지 않는다. logic.version을 올리지 않고 이 값만
    // 고치지 말 것 — 이 테스트가 깨지면 version 범프가 필요한지 먼저 확인한다.
    const c = makeCourse(SEED)
    const list = []
    let row = 0
    while (list.length < 12) {
      const s = c.segmentAt(row)
      list.push(`${s.id}${s.mirrored ? '~' : ''}`)
      row = s.startRow + s.length
    }
    expect(list).toEqual(GOLDEN)
  })
  it('boostsBefore counts every tunnel, the start tunnel included', () => {
    const flat = (id: string, n: number) =>
      parseSegment({ id, kind: 'obstacle', tier: 1, rows: [JOINT, ...new Array<string>(n).fill('_______'), JOINT] })
    const tunnel = (id: string, n: number) =>
      parseSegment({ id, kind: 'tunnel', tier: 1, rows: [JOINT, ...new Array<string>(n).fill('_______'), JOINT] })
    const T0 = tunnel('t0', 8) // rows 0..9
    const O1 = flat('o1', 10) // rows 10..21
    const T1 = tunnel('t1', 4) // rows 22..27
    const O2 = flat('o2', 3) // rows 28..32
    const T2 = tunnel('t2', 4) // rows 33..38
    const c = courseFromSegments([T0, O1, T1, O2, T2].map((seg) => ({ seg, mirrored: false })))
    // 시작 터널도 한 번 센다(원작: 시작 직후 '속도 증가').
    expect(c.boostsBefore(-5)).toBe(1)
    for (const r of [0, 9, 10, 21]) expect(c.boostsBefore(r)).toBe(1)
    for (const r of [22, 27, 28, 32]) expect(c.boostsBefore(r)).toBe(2)
    for (const r of [33, 38, 39, 5000]) expect(c.boostsBefore(r)).toBe(3)
    // 첫 조각이 터널이 아니면 첫 터널까지 0.
    const d = courseFromSegments([O1, T1, O2].map((seg) => ({ seg, mirrored: false })))
    expect(d.boostsBefore(0)).toBe(0)
    expect(d.boostsBefore(11)).toBe(0)
    expect(d.boostsBefore(12)).toBe(1)
    expect(d.boostsBefore(1000)).toBe(1)
    // 생성 코스: 시작 터널에서 1이고 행이 늘어도 줄지 않는다.
    const g = makeCourse(SEED)
    expect(g.boostsBefore(0)).toBe(1)
    let prev = 1
    for (let r = 0; r <= 3000; r += 50) {
      const b = g.boostsBefore(r)
      expect(b).toBeGreaterThanOrEqual(prev)
      prev = b
    }
    // 앞쪽부터 읽지 않아도 같은 값
    expect(makeCourse(SEED).boostsBefore(3000)).toBe(prev)
  })
  it('out of range cells are holes', () => {
    const c = getCourse(SEED)
    for (const [col, row] of [[4, 10], [-4, 10], [0, -1]]) {
      expect(c.cell(col, row)).toEqual({ floor: null, block: false })
    }
  })
})

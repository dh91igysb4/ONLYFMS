import { describe, expect, it } from 'vitest'
import { G, SUBSTEPS } from './constants.ts'
import { applyPose, maxReach, motionDone, poseAt, subtick, type Motion } from './motion.ts'

const S = SUBSTEPS

describe('subtick', () => {
  it('tick × SUBSTEPS + k + 1', () => {
    expect(subtick(0, 0)).toBe(1)
    expect(subtick(2, 2)).toBe(9)
  })
})

describe('rotate', () => {
  it('a0 + floor(w × T / SUBSTEPS)', () => {
    expect(poseAt({ k: 'rotate', a0: 100, w: 6 }, subtick(10, 2), null).a).toBe(100 + 6 * 11)
  })
})

describe('swing', () => {
  const m: Motion = { k: 'swing', ax: 3000, ay: -1500, period: 40, phase: 0 }
  it('0 → 반주기에 (ax, ay) → 주기에 0', () => {
    expect(poseAt(m, 0, null)).toEqual({ dx: 0, dy: 0, a: 0 })
    expect(poseAt(m, (40 * S) / 2, null)).toEqual({ dx: 3000, dy: -1500, a: 0 })
    const end = poseAt(m, 40 * S, null)
    expect(end.dx).toBe(0)
    expect(end.dy).toBe(0)
  })
  it('정수이고 주기적이다', () => {
    const odd: Motion = { k: 'swing', ax: 777, ay: -333, period: 37, phase: 5 }
    for (let T = 0; T < 300; T++) {
      const p = poseAt(odd, T, null)
      expect(Number.isInteger(p.dx) && Number.isInteger(p.dy)).toBe(true)
      expect(poseAt(odd, T + 37 * S, null)).toEqual(p)
    }
  })
  it('위상만큼 앞선다', () => {
    const ph: Motion = { k: 'swing', ax: 3000, ay: -1500, period: 40, phase: 10 }
    expect(poseAt(ph, 0, null)).toEqual(poseAt(m, 10 * S, null))
  })
})

describe('pop', () => {
  const m: Motion = { k: 'pop', period: 40, phase: 0, hide: 10, rise: 10, up: 10, fall: 10, height: 1000 }
  const ext = (t: number) => poseAt(m, t * S, null).dy
  it('hide 0 / rise 증가 / up height / fall 감소', () => {
    for (let t = 0; t < 10; t++) expect(ext(t)).toBe(0)
    expect(ext(10)).toBe(0)
    expect(ext(15)).toBe(500)
    expect(ext(19)).toBeGreaterThan(ext(15))
    expect(ext(20)).toBe(1000)
    expect(ext(29)).toBe(1000)
    expect(ext(30)).toBe(1000)
    expect(ext(35)).toBe(500)
    expect(ext(39)).toBeLessThan(ext(35))
    expect(ext(40)).toBe(0)
  })
  it('dx·a는 0이고 위상이 적용된다', () => {
    expect(poseAt(m, 17, null)).toMatchObject({ dx: 0, a: 0 })
    expect(poseAt({ ...m, phase: 10 } as Motion, 0, null).dy).toBe(ext(10))
  })
})

describe('keys', () => {
  const m: Motion = {
    k: 'keys',
    keys: [
      { t: 0, dx: 0, dy: 0, a: 0 },
      { t: 10, dx: 1000, dy: -400, a: 200 },
      { t: 20, dx: 1000, dy: -400, a: 200 },
    ],
  }
  it('T0 null 또는 e ≤ 0이면 첫 키', () => {
    expect(poseAt(m, 999, null)).toEqual({ dx: 0, dy: 0, a: 0 })
    expect(poseAt(m, 50, 50)).toEqual({ dx: 0, dy: 0, a: 0 })
    expect(poseAt(m, 40, 50)).toEqual({ dx: 0, dy: 0, a: 0 })
  })
  it('키 사이를 선형 보간한다', () => {
    expect(poseAt(m, 100 + 5 * S, 100)).toEqual({ dx: 500, dy: -200, a: 100 })
    expect(poseAt(m, 100 + 10 * S, 100)).toEqual({ dx: 1000, dy: -400, a: 200 })
  })
  it('마지막 키 뒤는 고정이고 motionDone이 true다', () => {
    expect(poseAt(m, 100 + 500, 100)).toEqual({ dx: 1000, dy: -400, a: 200 })
    expect(motionDone(m, 100 + 20 * S - 1, 100)).toBe(false)
    expect(motionDone(m, 100 + 20 * S, 100)).toBe(true)
    expect(motionDone(m, 100 + 500, null)).toBe(false)
  })
  it('음수 변화도 정수로 보간한다', () => {
    const p = poseAt(m, 100 + 3, 100)
    expect(Number.isInteger(p.dy)).toBe(true)
  })
})

describe('fall', () => {
  const m: Motion = { k: 'fall', w: 12 }
  it('e = 0 → 0, 단조 감소, 60틱 값', () => {
    expect(poseAt(m, 77, 77)).toEqual({ dx: 0, dy: 0, a: 0 })
    expect(poseAt(m, 10, null)).toEqual({ dx: 0, dy: 0, a: 0 })
    let prev = 0
    for (let e = 1; e <= 200; e++) {
      const y = poseAt(m, 77 + e, 77).dy
      expect(y).toBeLessThanOrEqual(prev)
      prev = y
    }
    const p = poseAt(m, 77 + 60 * S, 77)
    expect(p.dy).toBe(-Math.floor((G * (60 * 3) ** 2) / (2 * 9)))
    expect(p.a).toBe(Math.floor((12 * 60 * S) / S))
  })
})

describe('applyPose', () => {
  it('90° 회전 후 이동', () => {
    const r = applyPose({ dx: 0, dy: 0, a: 1024 }, 0, 0, 16000, 0)
    expect(Math.abs(r.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(r.y - 16000)).toBeLessThanOrEqual(1)
    const t = applyPose({ dx: 50, dy: -20, a: 0 }, 1000, 1000, 3000, 2000)
    expect(t).toEqual({ x: 3050, y: 1980 })
  })
  it('기준점 둘레로 돈다', () => {
    const r = applyPose({ dx: 0, dy: 0, a: 2048 }, 1000, 500, 3000, 500)
    expect(Math.abs(r.x - -1000)).toBeLessThanOrEqual(1)
    expect(Math.abs(r.y - 500)).toBeLessThanOrEqual(1)
  })
})

describe('정수성', () => {
  it('무작위 입력 1,000개의 결과가 모두 정수다', () => {
    let seed = 12345
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
      return seed % n
    }
    const motions: Motion[] = [
      { k: 'none' },
      { k: 'rotate', a0: 33, w: -7 },
      { k: 'swing', ax: 1234, ay: -4321, period: 31, phase: 7 },
      { k: 'pop', period: 33, phase: 4, hide: 9, rise: 7, up: 11, fall: 6, height: 999 },
      { k: 'keys', keys: [{ t: 0, dx: 0, dy: 0, a: 0 }, { t: 17, dx: -999, dy: 777, a: -321 }] },
      { k: 'fall', w: -5 },
    ]
    for (let i = 0; i < 1000; i++) {
      const m = motions[rnd(motions.length)]
      const p = poseAt(m, rnd(100000), rnd(2) ? rnd(100000) : null)
      const q = applyPose(p, rnd(2000000) - 1000000, rnd(2000000) - 1000000, rnd(4000000) - 2000000, rnd(4000000) - 2000000)
      for (const v of [p.dx, p.dy, p.a, q.x, q.y]) expect(Number.isInteger(v)).toBe(true)
    }
  })
})

describe('maxReach', () => {
  it('swing·keys·pop·fall의 범위를 덮는다', () => {
    const sw: Motion = { k: 'swing', ax: -3000, ay: 800, period: 30, phase: 3 }
    const r = maxReach(sw)
    for (let T = 0; T < 200; T++) {
      const p = poseAt(sw, T, null)
      expect(p.dx).toBeGreaterThanOrEqual(r.dx0)
      expect(p.dx).toBeLessThanOrEqual(r.dx1)
      expect(p.dy).toBeGreaterThanOrEqual(r.dy0)
      expect(p.dy).toBeLessThanOrEqual(r.dy1)
    }
    expect(r.turns).toBe(false)
    const ks: Motion = { k: 'keys', keys: [{ t: 0, dx: 0, dy: 0, a: 0 }, { t: 10, dx: 500, dy: -700, a: 90 }] }
    const kr = maxReach(ks)
    expect(kr).toEqual({ dx0: 0, dy0: -700, dx1: 500, dy1: 0, turns: true })
    for (let T = 0; T < 60; T++) {
      const p = poseAt(ks, T, 0)
      expect(p.dx).toBeGreaterThanOrEqual(kr.dx0)
      expect(p.dy).toBeGreaterThanOrEqual(kr.dy0)
      expect(p.dx).toBeLessThanOrEqual(kr.dx1)
      expect(p.dy).toBeLessThanOrEqual(kr.dy1)
    }
    expect(maxReach({ k: 'pop', period: 4, phase: 0, hide: 1, rise: 1, up: 1, fall: 1, height: 50 }).dy1).toBe(50)
    expect(maxReach({ k: 'rotate', a0: 0, w: 3 }).turns).toBe(true)
    expect(maxReach({ k: 'none' }).turns).toBe(false)
    expect(maxReach({ k: 'fall', w: 0 }).dy0).toBeLessThan(0)
  })
})

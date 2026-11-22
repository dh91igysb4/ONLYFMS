import { describe, expect, it } from 'vitest'
import { COLLIDE_WINDOW, MM, SEG_LEN } from './constants.ts'
import { TEMPLATES, buildTemplate, type Seg, type Template } from './pieces.ts'
import { TURN, angDiff, atan2T, isqrt } from './trig.ts'

// 선분 a의 두 끝점에서 선분 b까지 거리 중 작은 것(근사: 겹침 판정용).
function segDist(a: Seg, b: Seg): number {
  const d = (x: number, y: number): number => {
    const sx = b.x1 - b.x0
    const sy = b.y1 - b.y0
    const l2 = sx * sx + sy * sy
    const t = Math.max(0, Math.min(l2, (x - b.x0) * sx + (y - b.y0) * sy))
    const px = b.x0 + Math.floor((t * sx) / l2)
    const py = b.y0 + Math.floor((t * sy) / l2)
    return isqrt((x - px) ** 2 + (y - py) ** 2)
  }
  return Math.min(d(a.x0, a.y0), d(a.x1, a.y1))
}

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

  it('큰 반지름 arc도 원 위에 있고(오차는 r에 비례), 선분 길이는 SEG_LEN 안팎', () => {
    for (const r of [20000 * MM, 60000 * MM]) {
      const b = buildTemplate(mk([{ t: 'arc', r, a0: (TURN * 3) / 4, a1: TURN + TURN / 8 }]))
      const cx = 0
      const cy = r // a0 = 270°: 시작점은 중심 바로 아래
      const tol = Math.floor(r / 4096) + 2 // 사인 표 해상도 1/16384 + 내림
      // 선분 수 ≥ 호 길이 / SEG_LEN (2π ≈ 710/113). 2π를 작게 잡으면 r = 60 m에서 모자란다.
      const span = TURN / 2 - TURN / 8
      expect(b.segs.length).toBeGreaterThanOrEqual(Math.ceil((r * span * 710) / (113 * TURN * SEG_LEN)))
      for (const s of b.segs) {
        for (const [x, y] of [[s.x0, s.y0], [s.x1, s.y1]]) expect(Math.abs(isqrt((x - cx) ** 2 + (y - cy) ** 2) - r)).toBeLessThanOrEqual(tol)
        // 꼭짓점 각이 TURN 정수로 내림되므로 한 선분은 각 1단위의 호 길이(r·2π/TURN)만큼 길어질 수 있다
        expect(isqrt((s.x1 - s.x0) ** 2 + (s.y1 - s.y0) ** 2)).toBeLessThanOrEqual(SEG_LEN + Math.floor((r * 44) / (7 * TURN)) + 2)
      }
    }
  })

  it('선분이 없는 템플릿은 오류', () => {
    expect(() => buildTemplate(mk([{ t: 'gap', dx: 10, dy: 0 }]))).toThrow()
    expect(() => buildTemplate(mk([]))).toThrow()
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
  // 이어진 두 선분 사이에서 진행 방향이 꺾이는 각. 호 안과 호 이음은 MAX_JOINT보다 작아야 하고,
  // 그보다 큰 꺾임은 직선끼리 일부러 만든 모서리뿐이다(템플릿마다 개수를 적어 둔다). 호 방향을 잘못 쓰면 거의 반 바퀴 꺾여 걸린다.
  const MAX_JOINT = Math.floor(TURN / 24) // 15°
  const SHARP: Record<string, number> = { ramp: 1, spikes: 9, spikes2: 7 }
  for (const t of TEMPLATES) {
    it(`${t.id}: 이음 꺾임 < 15°, 일부러 만든 모서리 ${SHARP[t.id] ?? 0}개`, () => {
      const s = buildTemplate(t).segs
      const dir = (i: number): number => atan2T(s[i].y1 - s[i].y0, s[i].x1 - s[i].x0)
      let sharp = 0
      for (let i = 1; i < s.length; i++) {
        if (s[i].x0 !== s[i - 1].x1 || s[i].y0 !== s[i - 1].y1) continue // gap
        if (Math.abs(angDiff(dir(i), dir(i - 1))) >= MAX_JOINT) sharp++
      }
      expect(sharp).toBe(SHARP[t.id] ?? 0)
    })
  }
  it('템플릿 13종, 티어별 개수', () => {
    expect(TEMPLATES.map((t) => t.id).sort()).toEqual(
      ['arcs', 'boostjump', 'bowl', 'hill', 'loop', 'loop2', 'quarter', 'ramp', 'scurve', 'spikes', 'spikes2', 'steps', 'waves'],
    )
    expect([1, 2, 3, 4].map((k) => TEMPLATES.filter((t) => t.tier === k).length)).toEqual([4, 4, 3, 2])
  })
  it('루프: 몸으로는 가깝지만 길로는 먼 선분 쌍은 진행 번호가 충돌 창(±COLLIDE_WINDOW)보다 멀다', () => {
    // 접지한 차가 루프를 지날 때 입구 쪽에서 출구 쪽 선분(또는 그 반대)에 부딪히지 않으려면 둘이 창 밖이어야 한다.
    const NEAR = 1000 * MM // 차 판정원이 닿을 수 있는 거리
    const FAR_ALONG = 4000 * MM // 이만큼 길을 따라 떨어져 있으면 "다른 곳"
    for (const id of ['loop', 'loop2']) {
      const s = buildTemplate(TEMPLATES.find((t) => t.id === id)!).segs
      const len = s.map((g) => isqrt((g.x1 - g.x0) ** 2 + (g.y1 - g.y0) ** 2))
      let pairs = 0
      for (let i = 0; i < s.length; i++) {
        let along = 0
        for (let j = i + 1; j < s.length; j++) {
          if (j - 1 > i) along += len[j - 1] // i 끝과 j 시작 사이의 길이
          if (along < FAR_ALONG) continue
          if (Math.min(segDist(s[i], s[j]), segDist(s[j], s[i])) >= NEAR) continue
          pairs++
          expect(j - i, `${id} ${i}-${j}`).toBeGreaterThan(COLLIDE_WINDOW)
        }
      }
      expect(pairs).toBeGreaterThan(0) // 루프는 실제로 겹친다
    }
  })
  it('bowl은 보석 4개', () => {
    expect(buildTemplate(TEMPLATES.find((t) => t.id === 'bowl')!).gems).toHaveLength(4)
  })
  it('ramp: 착지 평지가 이륙점보다 낮다', () => {
    const b = buildTemplate(TEMPLATES.find((t) => t.id === 'ramp')!)
    expect(b.endY).toBeLessThan(b.segs[1].y1)
  })
})

import { describe, expect, it } from 'vitest'
import { COLLIDE_WINDOW, LEAD_FLAT_MAX, MM, SEG_LEN, SUBSTEPS, WHEEL_R } from './constants.ts'
import type { HazardShape } from './hazards.ts'
import { TEMPLATES, buildTemplate, type Prim, type Seg, type Template } from './pieces.ts'
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

  it('위험물·움직이는 길·블록 없는 템플릿은 빈 목록', () => {
    const b = buildTemplate(mk([{ t: 'line', dx: 10, dy: 0 }]))
    expect([b.hazards, b.movers, b.blocks]).toEqual([[], [], []])
  })

  it('hazard·mover·block은 (펜 + dx, dy) 기준 상대 좌표로 놓이고 펜은 그대로', () => {
    const b = buildTemplate(mk([{ t: 'line', dx: 100, dy: 50 }, ...EXTRAS, { t: 'line', dx: 10, dy: 0 }]))
    // 기준점 = 펜(100, 50) + 각 prim의 (dx, dy)
    expect(b.hazards).toEqual([
      { shape: { s: 'disc', x: 111, y: 72, r: 5 }, motion: SWING, look: 'saw' },
      { shape: { s: 'bar', x0: 98, y0: 51, x1: 103, y1: 56, r: 2 }, motion: { k: 'none' }, look: 'spikes' },
      { shape: { s: 'blades', x: 100, y: 50, rIn: 0, rOut: 9, n: 2, w: 100 }, motion: { k: 'rotate', a0: 0, w: 3 }, look: 'blades' },
    ])
    expect(b.movers).toEqual([
      {
        segs: [{ x0: 130, y0: 80, x1: 140, y1: 80, boost: false }],
        pivotX: 135,
        pivotY: 81,
        motion: { k: 'fall', w: 0 },
        start: { k: 'pass', x: 125, delay: 4 },
        look: 'yellow',
      },
      { segs: [{ x0: 130, y0: 80, x1: 130, y1: 90, boost: false }], pivotX: 130, pivotY: 80, motion: { k: 'rotate', a0: 0, w: 1 }, start: { k: 'time' }, look: 'green' },
    ])
    expect(b.blocks).toEqual([{ x: 103, y: 50, w: 40, h: 60, a: 7 }])
    expect(b.segs[1]).toEqual({ x0: 100, y0: 50, x1: 110, y1: 50, boost: false })
    expect([b.endX, b.endY]).toEqual([110, 50])
  })

  it('trimFlats: 앞쪽 평지를 자르면 위험물·길·블록도 보석과 같은 양만큼 x로 옮긴다', () => {
    const prims: Template['prims'] = [
      { t: 'line', dx: LEAD_FLAT_MAX + 5000, dy: 0 },
      { t: 'gem', dx: 10, dy: 20 },
      ...EXTRAS,
      { t: 'line', dx: 3000, dy: 500 },
      { t: 'line', dx: 3000, dy: 0 },
    ]
    const raw = buildTemplate({ id: 'raw', tier: 1, prims })
    const cut = buildTemplate({ id: 'cut', tier: 1, prims, trimFlats: true })
    const d = raw.gems[0].x - cut.gems[0].x
    expect(d).toBe(5000)
    expect(cut.gems[0].y).toBe(raw.gems[0].y)
    const sh = (s: HazardShape): HazardShape =>
      s.s === 'bar' ? { ...s, x0: s.x0 - d, x1: s.x1 - d } : { ...s, x: s.x - d }
    expect(cut.hazards).toEqual(raw.hazards.map((h) => ({ ...h, shape: sh(h.shape) })))
    expect(cut.movers).toEqual(
      raw.movers.map((m) => ({
        ...m,
        segs: m.segs.map((s) => ({ ...s, x0: s.x0 - d, x1: s.x1 - d })),
        pivotX: m.pivotX - d,
        start: m.start.k === 'pass' ? { ...m.start, x: m.start.x - d } : m.start,
      })),
    )
    expect(cut.blocks).toEqual(raw.blocks.map((k) => ({ ...k, x: k.x - d })))
  })
})

// 기준점 (dx, dy)를 기준으로 한 상대 좌표. 위 두 테스트가 함께 쓴다.
const SWING = { k: 'swing', ax: 30, ay: 0, period: 60, phase: 0 } as const
const EXTRAS: Prim[] = [
  { t: 'hazard', dx: 10, dy: 20, h: { shape: { s: 'disc', x: 1, y: 2, r: 5 }, motion: SWING, look: 'saw' } },
  { t: 'hazard', dx: 0, dy: 0, h: { shape: { s: 'bar', x0: -2, y0: 1, x1: 3, y1: 6, r: 2 }, motion: { k: 'none' }, look: 'spikes' } },
  { t: 'hazard', dx: 0, dy: 0, h: { shape: { s: 'blades', x: 0, y: 0, rIn: 0, rOut: 9, n: 2, w: 100 }, motion: { k: 'rotate', a0: 0, w: 3 }, look: 'blades' } },
  {
    t: 'mover',
    dx: 30,
    dy: 30,
    m: {
      segs: [{ x0: 0, y0: 0, x1: 10, y1: 0, boost: false }],
      pivotX: 5,
      pivotY: 1,
      motion: { k: 'fall', w: 0 },
      start: { k: 'pass', x: -5, delay: 4 },
      look: 'yellow',
    },
  },
  {
    t: 'mover',
    dx: 30,
    dy: 30,
    m: { segs: [{ x0: 0, y0: 0, x1: 0, y1: 10, boost: false }], pivotX: 0, pivotY: 0, motion: { k: 'rotate', a0: 0, w: 1 }, start: { k: 'time' }, look: 'green' },
  },
  { t: 'block', dx: 3, dy: 0, b: { x: 0, y: 0, w: 40, h: 60, a: 7 } },
]

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
  // 직선끼리 만나는 모서리: 삼각 열(△ 4개의 오르막·꼭대기·내리막 + ▽ 꼭짓점 3개 = 12 … 아래 테스트가 센다), 직선 봉우리·경사·계단.
  // 가시 구덩이 벽 4, 직선 경사로 시작(배럴형 바퀴·팩맨·굽은 길·톱니 밭 킥커)
  const SHARP: Record<string, number> = {
    spikes: 12, valley: 2, rampflat: 2, roofs: 3, stairs: 7, vplat: 2, curl: 5, spiral: 5,
    spikepit: 4, barrel: 1, pacman: 1, curve: 1, sawfield: 1,
  }
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
  it('템플릿 39종(영상 장애물 목록의 정적 지형 + 위험물·굽은 길·스마일, 설계 §9), 티어별 목록', () => {
    expect(TEMPLATES.map((t) => t.id).sort()).toEqual(
      [
        'arcs', 'barrel', 'bigdrop', 'boostflat', 'boostjump', 'bowl', 'bowldrop', 'cliff', 'crestgap', 'cup',
        'curl', 'curve', 'fans', 'hill', 'hook', 'humps', 'ledge', 'loop', 'loop2', 'pacman',
        'quarter', 'ramp', 'rampflat', 'ringbarrel', 'roofs', 'sawfield', 'sawswing', 'sinuous', 'smile', 'spears',
        'spikefloor', 'spikepit', 'spikes', 'spiral', 'stairs', 'stepup', 'valley', 'vplat', 'waves',
      ],
    )
    const byTier = (k: number): string[] => TEMPLATES.filter((t) => t.tier === k).map((t) => t.id).sort()
    // 설계 §9 표의 tier: 톱니 밭·왕복 톱니·팩맨·배럴형 바퀴·굽은 길 2, 원형 배럴·창 3, 환풍기 4, 스마일 1. 톱니를 더한 기존 템플릿은 tier 그대로
    expect(byTier(1)).toEqual(['bigdrop', 'boostflat', 'bowl', 'cliff', 'hill', 'ledge', 'ramp', 'rampflat', 'smile', 'spikes', 'valley', 'waves'])
    expect(byTier(2)).toEqual([
      'barrel', 'boostjump', 'bowldrop', 'crestgap', 'cup', 'curve', 'pacman', 'quarter', 'roofs', 'sawfield', 'sawswing', 'spikefloor', 'spikepit', 'stairs', 'stepup',
    ])
    expect(byTier(3)).toEqual(['curl', 'hook', 'humps', 'loop', 'ringbarrel', 'sinuous', 'spears', 'vplat'])
    expect(byTier(4)).toEqual(['arcs', 'fans', 'loop2', 'spiral'])
  })
  it('위험물 수: 녹화·위키에 나온 자리(톱니 밭 9개 이상, 왕복 톱니 1, 바퀴·원반 둘씩, 창 3, 환풍기 2, 루프 안 호, 기존 템플릿의 톱니)', () => {
    const want: Record<string, number> = {
      waves: 2, boostjump: 2, crestgap: 2, loop: 1, spikepit: 1,
      sawfield: 9, sawswing: 1, barrel: 2, pacman: 2, ringbarrel: 1, spears: 3, fans: 2,
    }
    for (const t of TEMPLATES) expect(buildTemplate(t).hazards.length, t.id).toBe(want[t.id] ?? 0)
    const saws = buildTemplate(TEMPLATES.find((t) => t.id === 'sawfield')!).hazards
    expect(saws.every((h) => h.shape.s === 'disc' && h.look === 'saw' && h.motion.k === 'none')).toBe(true)
  })
  it('빠른 날(설계 §5.2): 도는 위험물·길의 끝이 이동 단계 하나에 바퀴 반지름보다 덜 움직인다', () => {
    // 끝 속도 |ω| · rOut · 2π / TURN / SUBSTEPS < WHEEL_R. 2π를 44/7(2π보다 크다)로 잡아 보수적으로, 정수로 비교한다.
    const fast = (w: number, reach: number): boolean => Math.abs(w) * reach * 44 >= WHEEL_R * TURN * SUBSTEPS * 7
    let checked = 0
    for (const t of TEMPLATES) {
      const b = buildTemplate(t)
      for (const h of b.hazards) {
        if (h.motion.k !== 'rotate') continue
        const s = h.shape
        // blades는 중심에서 rOut, bar는 (x0, y0) 둘레로 돈다. disc는 돌아도 모양이 그대로다.
        const reach = s.s === 'blades' ? s.rOut : s.s === 'bar' ? isqrt((s.x1 - s.x0) ** 2 + (s.y1 - s.y0) ** 2) + s.r : 0
        expect(fast(h.motion.w, reach), `${t.id} 위험물`).toBe(false)
        checked++
      }
      for (const m of b.movers) {
        if (m.motion.k !== 'rotate') continue
        const reach = Math.max(...m.segs.flatMap((g) => [[g.x0, g.y0], [g.x1, g.y1]]).map(([x, y]) => isqrt((x - m.pivotX) ** 2 + (y - m.pivotY) ** 2)))
        expect(fast(m.motion.w, reach), `${t.id} 움직이는 길`).toBe(false)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
    // 조건 자체: 끝 속도가 바퀴 반지름을 넘는 날은 걸린다
    expect(fast(Math.ceil((WHEEL_R * TURN * SUBSTEPS * 7) / (44 * 3000 * MM)), 3000 * MM)).toBe(true)
  })
  it('spikepit: 구덩이에 바닥 길이 있고(끊김 없음), 가시 막대는 바닥 위에 얹혀 양 끝이 벽 안쪽이라 옆 길과 겹치지 않는다', () => {
    const b = buildTemplate(TEMPLATES.find((t) => t.id === 'spikepit')!)
    for (let i = 1; i < b.segs.length; i++) expect([b.segs[i].x0, b.segs[i].y0]).toEqual([b.segs[i - 1].x1, b.segs[i - 1].y1])
    const bars = b.hazards.filter((h) => h.shape.s === 'bar' && h.look === 'spikes')
    expect(bars.length).toBe(1)
    const bar = bars[0].shape as Extract<HazardShape, { s: 'bar' }>
    expect(bars[0].motion.k).toBe('none')
    expect(bar.y0).toBe(bar.y1)
    // 바닥: 막대 바로 밑(막대 반지름만큼 아래)의 수평 선분. 막대는 그 x 범위 안에 있다
    const floor = b.segs.filter((s) => s.y0 === s.y1 && s.y0 === bar.y0 - bar.r)
    expect(floor.length).toBe(1)
    const f = floor[0]
    expect(Math.min(bar.x0, bar.x1) - bar.r).toBeGreaterThan(Math.min(f.x0, f.x1))
    expect(Math.max(bar.x0, bar.x1) + bar.r).toBeLessThan(Math.max(f.x0, f.x1))
    expect(f.y0).toBeLessThan(b.minY + 1) // 구덩이 바닥이 템플릿에서 가장 낮다
    // 바닥 말고는 어느 선분(벽·고원·반대편)과도 막대 둘레(캡슐)가 닿지 않는다
    const cap: Seg = { x0: bar.x0, y0: bar.y0, x1: bar.x1, y1: bar.y1, boost: false }
    for (const s of b.segs) {
      if (s === f) continue
      expect(Math.min(segDist(cap, s), segDist(s, cap)), `${s.x0},${s.y0}→${s.x1},${s.y1}`).toBeGreaterThan(bar.r)
    }
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
  it('보석 수: 녹화에서 보석이 있던 곳(그릇 5, 컵 4, 루프 6, 역삼각 윗변 4, 급경사 궤적 5, 낭떠러지 아래 줄 4)', () => {
    const want: Record<string, number> = { bowl: 5, bowldrop: 5, cup: 4, loop: 6, vplat: 4, bigdrop: 5, ledge: 4, boostjump: 4, waves: 3, valley: 2, curl: 5, spiral: 5, hook: 5 }
    for (const t of TEMPLATES) expect(buildTemplate(t).gems.length, t.id).toBe(want[t.id] ?? 0)
  })
  it('ramp·boostjump·quarter·spikefloor: 점프대 턱(틈 앞 선분 끝)보다 끝 평지가 낮다', () => {
    for (const id of ['ramp', 'boostjump', 'quarter', 'spikefloor']) {
      const b = buildTemplate(TEMPLATES.find((t) => t.id === id)!)
      const k = b.segs.findIndex((s, i) => i > 0 && s.x0 !== b.segs[i - 1].x1)
      expect(k, id).toBeGreaterThan(0)
      expect(b.endY, id).toBeLessThan(b.segs[k - 1].y1)
    }
  })
})

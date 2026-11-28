import { describe, expect, it } from 'vitest'
import { CARS, CAR_REACH_MAX, DEFAULT_CAR, carById } from './cars.ts'
import { BODY_DY, BODY_R, HEAD_OFFSET, HEAD_R, MM, WHEELBASE, WHEEL_R } from './constants.ts'
import { courseOf } from './course.ts'
import { TEMPLATES } from './pieces.ts'

const roof = (c: { headOffset: number; headR: number }): number => c.headOffset + c.headR

describe('차 정의 (설계 §5)', () => {
  it('표의 6대: 순서·이름·가격·판정 치수(mm)', () => {
    expect(CARS.map((c) => [c.id, c.label, c.price, c.headOffset / MM, c.headR / MM, c.bodyDY / MM, c.bodyR / MM])).toEqual([
      ['coupe', '쿠페', 0, 300, 280, 170, 190],
      ['pickup', '픽업', 5000, 360, 340, 210, 190],
      ['buggy', '버기', 15000, 270, 250, 130, 170],
      ['sports', '스포츠카', 30000, 250, 230, 150, 150],
      ['f1', 'F1', 60000, 180, 160, 60, 130],
      ['skate', '스케이트보드', 100000, 110, 90, 40, 120],
    ])
    for (const c of CARS) for (const v of [c.headOffset, c.headR, c.bodyDY, c.bodyR]) expect(v % MM).toBe(0)
  })

  it('지붕 높이 순서: pickup > coupe > buggy > sports > f1 > skate', () => {
    const order = ['pickup', 'coupe', 'buggy', 'sports', 'f1', 'skate']
    for (let i = 1; i < order.length; i++) expect(roof(carById(order[i - 1]))).toBeGreaterThan(roof(carById(order[i])))
  })

  it('모든 차: 캡슐 아래 끝은 바퀴 바닥보다 위, 위 끝은 지붕 이하', () => {
    for (const c of CARS) {
      expect(c.bodyDY - c.bodyR, c.id).toBeGreaterThan(-WHEEL_R)
      expect(c.bodyDY + c.bodyR, c.id).toBeLessThanOrEqual(roof(c))
    }
  })

  it('쿠페는 지금 상수와 같다', () => {
    const c = carById('coupe')
    expect([c.headOffset, c.headR, c.bodyDY, c.bodyR]).toEqual([HEAD_OFFSET, HEAD_R, BODY_DY, BODY_R])
    expect(DEFAULT_CAR).toBe('coupe')
  })

  it('모르는 id·undefined는 쿠페', () => {
    expect(carById('zzz').id).toBe('coupe')
    expect(carById(undefined).id).toBe('coupe')
    expect(carById('skate').id).toBe('skate')
  })

  it('CAR_REACH_MAX는 모든 차의 판정이 축선에서 닿는 최대 거리(픽업 지붕 700 mm)', () => {
    expect(CAR_REACH_MAX).toBe(700 * MM)
    for (const c of CARS) expect(Math.max(roof(c), c.bodyDY + c.bodyR)).toBeLessThanOrEqual(CAR_REACH_MAX)
  })
})

// 기하 검사: 두 바퀴를 길에 붙인 자세에서 지붕 원이 지형에 닿지 않는다(검사용 부동소수 사용, 시뮬 코드 아님).
describe('차 지붕과 지형 (기하 검사)', () => {
  type P = { x: number; y: number }
  type S = { x0: number; y0: number; x1: number; y1: number }
  const distSeg = (p: P, s: S): number => {
    const dx = s.x1 - s.x0
    const dy = s.y1 - s.y0
    const l2 = dx * dx + dy * dy
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.x0) * dx + (p.y - s.y0) * dy) / l2))
    return Math.hypot(p.x - (s.x0 + t * dx), p.y - (s.y0 + t * dy))
  }

  // 쿠페 지붕이 지형에 안 닿는 자세에서 cars의 지붕이 닿는 자리들(차 id·템플릿 id·x·여유). 쿠페가 닿는 자세는 지금도 받아들이는 동작이라 보지 않는다.
  const compareToCoupe = (cars: readonly (typeof CARS)[number][]): { fails: string[]; checked: number } => {
    const step = 100 * MM
    const fails: string[] = []
    let checked = 0
    for (const t of TEMPLATES) {
      const course = courseOf([t.id])
      const sec = course.section(0)
      const segs: S[] = []
      for (let i = sec.firstSeg; i <= sec.lastSeg; i++) segs.push(course.seg(i))
      // 바퀴가 길에 닿는 중심: x 위의 길 점에서 윗 법선으로 WHEEL_R. 길에 파고들면(꼭짓점·좁은 홈) null.
      // 지금 보는 자리 둘레의 선분만(속도). 앞바퀴는 최대 WHEELBASE + 2·WHEEL_R 앞, 닿는 거리 여유 1 m
      let loc: S[] = segs
      const centre = (x: number): P | null => {
        const s = loc.find((g) => g.x0 < g.x1 && x >= g.x0 && x <= g.x1)
        if (!s) return null
        const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0)
        const y = s.y0 + ((s.y1 - s.y0) * (x - s.x0)) / (s.x1 - s.x0)
        const c = { x: x - ((s.y1 - s.y0) * WHEEL_R) / len, y: y + ((s.x1 - s.x0) * WHEEL_R) / len }
        return loc.every((g) => distSeg(c, g) >= WHEEL_R - 2) ? c : null
      }
      for (let x = sec.startX; x < sec.endX; x += step) {
        loc = segs.filter((g) => Math.max(g.x0, g.x1) >= x - 1000 * MM && Math.min(g.x0, g.x1) <= x + WHEELBASE + 2 * WHEEL_R + 1000 * MM)
        const r = centre(x)
        if (!r) continue
        // 앞바퀴: 뒷바퀴 오른쪽에서 두 중심 거리가 WHEELBASE가 되는 첫 자리(찾지 못하면 틈·절벽이라 건너뜀)
        let found: P | null = null
        let prev: { x: number; d: number } | null = null
        for (let fx = x + WHEELBASE / 2; fx <= x + WHEELBASE + 2 * WHEEL_R && !found; fx += 8 * MM) {
          const c = centre(fx)
          if (!c) {
            prev = null
            continue
          }
          const d = Math.hypot(c.x - r.x, c.y - r.y)
          if (prev && prev.d < WHEELBASE && d >= WHEELBASE) {
            let lo = prev.x
            let hi = fx
            for (let k = 0; k < 30; k++) {
              const mid = (lo + hi) / 2
              const m = centre(mid)
              if (m && Math.hypot(m.x - r.x, m.y - r.y) < WHEELBASE) lo = mid
              else hi = mid
            }
            found = centre(hi)
          }
          prev = { x: fx, d }
        }
        if (!found) continue
        const f: P = found
        const dx = f.x - r.x
        const dy = f.y - r.y
        const dist = Math.hypot(dx, dy)
        const clearance = (car: (typeof CARS)[number]): number => {
          const h = {
            x: (r.x + f.x) / 2 - (dy * car.headOffset) / dist,
            y: (r.y + f.y) / 2 + (dx * car.headOffset) / dist,
          }
          return Math.min(...loc.map((g) => distSeg(h, g))) - car.headR
        }
        // 쿠페가 닿는 자세는 지금도 받아들이는 동작이라 단언하지 않는다.
        if (clearance(carById('coupe')) <= 0) continue
        checked++
        for (const car of cars) {
          const c = clearance(car)
          if (c <= 0) fails.push(`${car.id} ${t.id} x=${Math.round(x / MM)}mm 여유 ${Math.round(c / MM)} mm`)
        }
      }
    }
    return { fails, checked }
  }

  it('모든 템플릿·모든 자세: 쿠페 지붕이 지형에 안 닿으면 다른 차 지붕도 안 닿는다 (쿠페 기준 비교)', () => {
    const { fails, checked } = compareToCoupe(CARS)
    expect(checked).toBeGreaterThan(100)
    expect(fails.slice(0, 10)).toEqual([])
  })

  it('검사가 실제로 잡는다: 지붕 바닥이 쿠페보다 낮은 차(옛 스포츠카 130/150)는 걸린다', () => {
    const low = { ...carById('sports'), headOffset: 130 * MM, headR: 150 * MM }
    expect(compareToCoupe([low]).fails.length).toBeGreaterThan(0)
  })
})

import { describe, expect, it } from 'vitest'
import { VIEW_CARS, WHEEL_R } from './constants.ts'
import { courseOf } from './course.ts'
import { initSimAt } from './sim.ts'
import type { SimState } from './sim.ts'
import { CAR_LEN, cameraFor, createRenderer, praiseFor, toScreen, visibleSegRange } from './render.ts'
import type { Camera } from './render.ts'

const course = courseOf(['hill', 'ramp'])

function carX(s: SimState): number {
  return (s.rear.x + s.front.x) / 2
}

function moved(s: SimState, dx: number, dy = 0): SimState {
  const w = (x: SimState['rear']) => ({ ...x, x: x.x + dx, y: x.y + dy, px: x.px + dx, py: x.py + dy })
  return { ...s, rear: w(s.rear), front: w(s.front) }
}

describe('cameraFor', () => {
  const s = initSimAt(course, 3000 * 16, 0)

  it.each([360, 1280])('폭 %ipx에서 차 중심이 화면 가로 28%에 온다', (w) => {
    const cam = cameraFor(s, s, 1, w, 640, null)
    const p = toScreen(cam, w, 640, carX(s), s.rear.y)
    expect(Math.abs(p.x - w * 0.28)).toBeLessThanOrEqual(1)
  })

  it('평지의 길은 카메라가 맞춰졌을 때 화면 위에서 53% 근처에 온다', () => {
    const cam = cameraFor(s, s, 1, 360, 640, null)
    const roadY = s.rear.y - WHEEL_R
    expect(Math.abs(toScreen(cam, 360, 640, carX(s), roadY).y - 640 * 0.53)).toBeLessThanOrEqual(2)
  })

  it.each([360, 1280])('폭 %ipx에 차 길이 VIEW_CARS대가 들어간다', (w) => {
    const cam = cameraFor(s, s, 0, w, 800, null)
    expect(w / (CAR_LEN * cam.scale)).toBeCloseTo(VIEW_CARS, 6)
  })

  it('세로로 긴 화면도 가로 축척은 같다', () => {
    expect(cameraFor(s, s, 0, 360, 1200, null).scale).toBe(cameraFor(s, s, 0, 360, 640, null).scale)
  })

  it('alpha 0→1에서 x가 prev와 cur 사이를 선형 보간한다', () => {
    const cur = moved(s, 4000)
    const at = (a: number) => cameraFor(s, cur, a, 360, 640, null).x
    expect(at(0)).toBeCloseTo(carX(s), 6)
    expect(at(1)).toBeCloseTo(carX(cur), 6)
    expect(at(0.25)).toBeCloseTo(carX(s) + 1000, 6)
    expect(at(0.5)).toBeCloseTo(carX(s) + 2000, 6)
  })

  it('세로는 last에서 목표 쪽으로 움직이고 넘어가지 않는다', () => {
    const target = cameraFor(s, s, 1, 360, 640, null).y
    for (const off of [-40000, -500, 500, 40000]) {
      let last: Camera = { x: carX(s), y: target + off, scale: 1 }
      for (let k = 0; k < 200; k++) {
        const next = cameraFor(s, s, 1, 360, 640, last)
        const before = Math.abs(last.y - target)
        const after = Math.abs(next.y - target)
        expect(after).toBeLessThanOrEqual(before)
        if (before > 0) expect(after).toBeLessThan(before)
        expect(Math.sign(next.y - target) * Math.sign(off)).toBeGreaterThanOrEqual(0)
        last = next
      }
    }
  })
})

describe('praiseFor', () => {
  const lists: Record<number, string[]> = { 1: ['nice!', 'clean!'], 2: ['double!', 'so smooth!'], 3: ['triple!'], 4: ['unreal!', 'dizzy yet?'] }

  it('1바퀴는 목록 안의 문구', () => {
    expect(lists[1]).toContain(praiseFor(1, false, 0))
  })

  it('퍼펙트면 perfect 로 시작한다', () => {
    expect(praiseFor(2, true, 0).startsWith('perfect ')).toBe(true)
    expect(lists[2]).toContain(praiseFor(2, true, 0).slice('perfect '.length))
  })

  it('tick에 따라 후보를 고르고 모든 반환값이 소문자 ASCII다', () => {
    const seen = new Set<string>()
    for (let flips = 1; flips <= 7; flips++)
      for (const perfect of [false, true])
        for (let tick = 0; tick < 10; tick++) {
          const p = praiseFor(flips, perfect, tick)
          expect(p).toMatch(/^[a-z !?']+$/)
          seen.add(p)
          const base = perfect ? p.slice('perfect '.length) : p
          expect(lists[Math.min(4, flips)]).toContain(base)
        }
    expect(seen).toContain('nice!')
    expect(seen).toContain('clean!')
    expect(seen).toContain('dizzy yet?')
  })
})

describe('visibleSegRange', () => {
  it('보이는 x 범위와 겹치는 선분만 포함하고, 시작 번호에서 양쪽으로 넓힌다', () => {
    const from = 6
    const s = course.seg(from)
    const xMin = Math.min(s.x0, s.x1) - 5000 * 16
    const xMax = Math.max(s.x0, s.x1) + 5000 * 16
    const { lo, hi } = visibleSegRange(course, from, xMin, xMax)
    expect(lo).toBeLessThanOrEqual(from)
    expect(hi).toBeGreaterThanOrEqual(from)
    // 범위 밖 첫 선분은 실제로 보이지 않는다(양 끝 한 칸 바깥).
    if (lo > 0) expect(Math.max(course.seg(lo - 1).x0, course.seg(lo - 1).x1)).toBeLessThan(xMin)
    expect(Math.min(course.seg(hi + 1).x0, course.seg(hi + 1).x1)).toBeGreaterThan(xMax)
    // 보이는 선분은 모두 범위 안에 있다.
    for (let i = 0; i <= hi + 40; i++) {
      const g = course.seg(i)
      const vis = Math.max(g.x0, g.x1) >= xMin && Math.min(g.x0, g.x1) <= xMax
      if (vis) {
        expect(i).toBeGreaterThanOrEqual(lo)
        expect(i).toBeLessThanOrEqual(hi)
      }
    }
  })

  it('시작 번호가 0이면 뒤로 가지 않는다', () => {
    expect(visibleSegRange(course, 0, -1000, 1000).lo).toBe(0)
  })
})

type Call = { name: string; args: unknown[] }

function fakeCanvas(): { canvas: HTMLCanvasElement; calls: Call[]; sets: string[] } {
  const calls: Call[] = []
  const sets: string[] = []
  const gradient = { addColorStop: () => {} }
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      return (...args: unknown[]) => {
        calls.push({ name: prop, args })
        if (prop === 'createLinearGradient') return gradient
        if (prop === 'measureText') return { width: 10 * String(args[0]).length }
        return undefined
      }
    },
    set(target, prop: string, value) {
      sets.push(prop)
      target[prop] = value
      return true
    },
  })
  const canvas = { width: 0, height: 0, style: {}, getContext: (kind: string) => (kind === '2d' ? ctx : null) }
  return { canvas: canvas as unknown as HTMLCanvasElement, calls, sets }
}

describe('createRenderer', () => {
  const s0 = initSimAt(course, 3000 * 16, 2000)

  it('render 1회는 예외 없이 그리고 shadowBlur를 대입하지 않는다', () => {
    const { canvas, calls, sets } = fakeCanvas()
    const r = createRenderer(canvas)
    r.resize(360, 640, 2)
    expect(() => r.render(s0, moved(s0, 2000), 0.5, course, 1000)).not.toThrow()
    expect(calls.some((c) => c.name === 'stroke')).toBe(true)
    expect(calls.some((c) => c.name === 'fillText')).toBe(true)
    expect(sets).not.toContain('shadowBlur')
  })

  it('모든 경로는 moveTo로 시작한다(첫 lineTo가 빈 경로에서 사라지지 않게)', () => {
    const { canvas, calls } = fakeCanvas()
    const r = createRenderer(canvas)
    r.resize(360, 640, 1)
    r.render(s0, s0, 0, course, 0)
    const pathOps = new Set(['moveTo', 'lineTo', 'arc', 'rect'])
    let first: string | null = null
    let lineTos = 0
    for (const c of calls) {
      if (c.name === 'beginPath') first = null
      else if (pathOps.has(c.name)) {
        if (first === null) first = c.name
        if (c.name === 'lineTo') {
          lineTos++
          expect(first).not.toBe('lineTo')
        }
      }
    }
    expect(lineTos).toBeGreaterThan(0)
  })

  it('착지·보석·사망 변화가 있어도 예외 없이 그린다', () => {
    const { canvas, sets } = fakeCanvas()
    const r = createRenderer(canvas)
    r.resize(1280, 800, 1)
    r.render(s0, s0, 0, course, 0)
    const landed: SimState = { ...s0, tick: 30, lastAward: { tick: 30, flips: 2, perfect: true, points: 4 }, flipScore: 4, gems: 1 }
    expect(() => r.render(s0, landed, 1, course, 16)).not.toThrow()
    const dead: SimState = { ...landed, tick: 31, dead: 'crash' }
    expect(() => r.render(landed, dead, 1, course, 32)).not.toThrow()
    expect(() => r.render(dead, dead, 1, course, 600)).not.toThrow()
    expect(sets).not.toContain('shadowBlur')
  })

  it('dispose 뒤 render는 아무것도 그리지 않는다', () => {
    const { canvas, calls } = fakeCanvas()
    const r = createRenderer(canvas)
    r.resize(360, 640, 1)
    r.render(s0, s0, 0, course, 0)
    r.dispose()
    const n = calls.length
    r.render(s0, s0, 0, course, 16)
    expect(calls.length).toBe(n)
  })

  it('getContext가 null이면 render는 아무것도 하지 않는다', () => {
    const canvas = { width: 0, height: 0, style: {}, getContext: () => null } as unknown as HTMLCanvasElement
    const r = createRenderer(canvas)
    expect(() => {
      r.resize(360, 640, 1)
      r.render(s0, s0, 0, course, 0)
      r.dispose()
    }).not.toThrow()
  })
})

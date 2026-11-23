import { describe, expect, it } from 'vitest'
import { CAR_LEN, HEAD_OFFSET, HEAD_R, MM, REST_LEN, START_LEN, VIEW_CARS, WHEELBASE, WHEEL_R } from './constants.ts'
import { courseFromTemplates, courseOf } from './course.ts'
import type { MoverDef } from './movers.ts'
import type { HazardDef } from './hazards.ts'
import type { Template } from './pieces.ts'
import { initSim, initSimAt, step } from './sim.ts'
import type { SimState } from './sim.ts'
import { BODY, cameraFor, createRenderer, praiseFor, toScreen, visibleSegRange } from './render.ts'
import type { Camera } from './render.ts'

const course = courseOf(['hill', 'ramp'])

function carX(s: SimState): number {
  return (s.rear.x + s.front.x) / 2
}

function moved(s: SimState, dx: number, dy = 0): SimState {
  const w = (x: SimState['rear']) => ({ ...x, x: x.x + dx, y: x.y + dy, px: x.px + dx, py: x.py + dy })
  return { ...s, rear: w(s.rear), front: w(s.front) }
}

describe('차 그림', () => {
  it('차체 다각형의 모든 꼭짓점이 판정원(두 바퀴·지붕)에서 40 mm 안에 있다(그림과 판정이 어긋나지 않게)', () => {
    // 차 좌표(mm): 뒷바퀴 (0, 0), 앞바퀴 (WHEELBASE, 0), 지붕 판정원 (WHEELBASE/2, HEAD_OFFSET).
    const circles = [
      { x: 0, y: 0, r: WHEEL_R / MM },
      { x: WHEELBASE / MM, y: 0, r: WHEEL_R / MM },
      { x: WHEELBASE / MM / 2, y: HEAD_OFFSET / MM, r: HEAD_R / MM },
    ]
    for (const [a, b] of BODY) {
      const out = Math.min(...circles.map((c) => Math.hypot(a - c.x, b - c.y) - c.r))
      expect(out, `(${a}, ${b})`).toBeLessThanOrEqual(40)
    }
  })
})

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

  it('세로 따라가기는 시간 기준: 60 fps와 30 fps로 0.5초를 그리면 같은 곳에 온다', () => {
    const target = cameraFor(s, s, 1, 360, 640, null).y
    const after = (fps: number): number => {
      let last: Camera = { x: carX(s), y: target + 80000, scale: 1 }
      for (let k = 0; k < fps / 2; k++) last = cameraFor(s, s, 1, 360, 640, last, 1000 / fps)
      return last.y - target
    }
    const a = after(60)
    const b = after(30)
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(80000 / 10)
    expect(Math.abs(a - b)).toBeLessThan(80000 / 400)
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
// stroke·fill 호출 때의 색과 그 경로(beginPath 이후 연산)
type Draw = { name: 'stroke' | 'fill'; style: unknown; path: Call[] }

function fakeCanvas(): { canvas: HTMLCanvasElement; calls: Call[]; sets: string[]; draws: Draw[] } {
  const calls: Call[] = []
  const sets: string[] = []
  const draws: Draw[] = []
  let path: Call[] = []
  const gradient = { addColorStop: () => {} }
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      return (...args: unknown[]) => {
        calls.push({ name: prop, args })
        if (prop === 'beginPath') path = []
        else if (prop === 'moveTo' || prop === 'lineTo' || prop === 'arc' || prop === 'closePath' || prop === 'rect') path.push({ name: prop, args })
        else if (prop === 'stroke') draws.push({ name: 'stroke', style: target.strokeStyle, path: path.slice() })
        else if (prop === 'fill') draws.push({ name: 'fill', style: target.fillStyle, path: path.slice() })
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
  return { canvas: canvas as unknown as HTMLCanvasElement, calls, sets, draws }
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

  it('착지 "+N"은 지급된 곳이 아니라 차의 현재 화면 위치를 따라간다', () => {
    const { canvas, calls } = fakeCanvas()
    const r = createRenderer(canvas)
    r.resize(360, 640, 1)
    r.render(s0, s0, 1, course, 0)
    const landed: SimState = { ...s0, tick: 30, lastAward: { tick: 30, flips: 1, perfect: false, points: 1 }, flipScore: 1 }
    const popupX = () => calls.filter((c) => c.name === 'fillText' && c.args[0] === '+1').map((c) => c.args[1] as number)
    r.render(s0, landed, 1, course, 16)
    const [x0] = popupX()
    // 차가 차 길이 3대만큼 앞으로 간 뒤에도 팝업은 차 옆에 있다(세계에 고정이면 화면에서 그만큼 뒤로 처진다).
    const later: SimState = { ...moved(landed, 3 * CAR_LEN), tick: 40 }
    r.render(landed, later, 1, course, 200)
    const x1 = popupX().at(-1)!
    expect(Math.abs(x1 - x0)).toBeLessThan(2)
  })

  it('시작 평지는 화면 왼쪽 끝까지 그려진다(선분 0이 코스 시작점 뒤로 이어져 판정과 같은 길)', () => {
    const { canvas, calls } = fakeCanvas()
    const r = createRenderer(canvas)
    r.resize(360, 640, 1)
    const s = initSim(course)
    r.render(s, s, 1, course, 0)
    expect(calls.some((c) => c.name === 'moveTo' && (c.args[0] as number) <= 0)).toBe(true)
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

describe('위험물·움직이는 길·블록 그리기', () => {
  const mm = (n: number): number => n * MM
  const TPL_X = START_LEN + REST_LEN
  const NONE = { k: 'none' } as const
  const saw: HazardDef = { shape: { s: 'disc', x: 0, y: mm(400), r: mm(300) }, motion: NONE, look: 'saw' }
  const yellowRoad: MoverDef = { segs: [{ x0: 0, y0: 0, x1: mm(3000), y1: 0, boost: false }], pivotX: 0, pivotY: 0, motion: NONE, start: { k: 'time' }, look: 'yellow' }
  const greenRing: MoverDef = {
    segs: [{ x0: mm(800), y0: 0, x1: 0, y1: mm(800), boost: false }, { x0: 0, y0: mm(800), x1: -mm(800), y1: 0, boost: false }],
    pivotX: 0, pivotY: 0, motion: { k: 'rotate', a0: 0, w: 10 }, start: { k: 'time' }, look: 'green',
  }
  const tpl = (prims: Template['prims']): Template => ({ id: 'draw', tier: 1, prims: [...prims, { t: 'line', dx: mm(400000), dy: 0 }] })
  const full = courseFromTemplates([tpl([
    { t: 'hazard', dx: mm(3000), dy: 0, h: saw },
    { t: 'hazard', dx: mm(5000), dy: 0, h: { shape: { s: 'bar', x0: 0, y0: mm(300), x1: mm(2000), y1: mm(300), r: mm(150) }, motion: NONE, look: 'spikes' } },
    { t: 'hazard', dx: mm(8000), dy: 0, h: { shape: { s: 'blades', x: 0, y: mm(1500), rIn: mm(600), rOut: mm(1200), n: 2, w: 600 }, motion: { k: 'rotate', a0: 0, w: 10 }, look: 'ring' } },
    { t: 'mover', dx: mm(6000), dy: mm(1200), m: yellowRoad },
    { t: 'mover', dx: mm(10000), dy: mm(2000), m: greenRing },
    { t: 'block', dx: mm(11000), dy: 0, b: { x: 0, y: 0, w: mm(1000), h: mm(1000), a: 0 } },
  ])])
  const start = initSimAt(full, TPL_X, 0)
  const sizes = (draws: Draw[]) => draws.map((d) => String(d.style))
  // 경로가 있는 노랑 stroke(부스터·보석이 없는 코스에서는 움직이는 길뿐)
  const yellowDrawn = (draws: Draw[]) => draws.some((d) => d.name === 'stroke' && d.style === '#ffe14a' && d.path.length > 0)

  it('위험물·길·블록이 있는 코스를 예외 없이 그리고, 빨강·노랑·초록·흰색이 모두 쓰이며 shadowBlur는 없다', () => {
    const { canvas, sets, draws } = fakeCanvas()
    const r = createRenderer(canvas)
    r.resize(800, 600, 1)
    expect(() => r.render(start, start, 0.5, full, 1000)).not.toThrow()
    const styles = sizes(draws)
    for (const color of ['#ff3355', '#39ff88']) expect(styles).toContain(color)
    expect(yellowDrawn(draws)).toBe(true)
    // 블록: 닫힌 사각형 경로(호 없음)를 흰 윤곽으로 긋는다(차 바퀴의 흰 윤곽은 호).
    const quad = draws.find((d) => d.name === 'stroke' && d.style === '#ffffff' && d.path.some((c) => c.name === 'closePath') && !d.path.some((c) => c.name === 'arc'))
    expect(quad).toBeDefined()
    expect(sets).not.toContain('shadowBlur')
  })

  it('위험물이 없는 코스에는 빨강을 쓰지 않는다', () => {
    const { canvas, draws } = fakeCanvas()
    const r = createRenderer(canvas)
    r.resize(800, 600, 1)
    r.render(start, start, 0, course, 0)
    expect(sizes(draws)).not.toContain('#ff3355')
  })

  it('화면 밖 위험물·길·블록은 그리지 않는다', () => {
    const far = courseFromTemplates([tpl([
      { t: 'hazard', dx: mm(90000), dy: 0, h: saw },
      { t: 'mover', dx: mm(90000), dy: 0, m: yellowRoad },
      { t: 'mover', dx: mm(90000), dy: 0, m: greenRing },
    ])])
    const { canvas, draws } = fakeCanvas()
    const r = createRenderer(canvas)
    r.resize(800, 600, 1)
    const s = initSimAt(far, TPL_X, 0)
    r.render(s, s, 0, far, 0)
    const styles = sizes(draws)
    for (const color of ['#ff3355', '#39ff88']) expect(styles).not.toContain(color)
    expect(yellowDrawn(draws)).toBe(false)
  })

  it('Review Focus 5: 처음 crash가 난 틱을 alpha = 1로 그리면 그 톱니의 그림이 차 판정 도형과 화면에서 겹친다', () => {
    const c = courseFromTemplates([tpl([{ t: 'hazard', dx: mm(8000), dy: 0, h: { ...saw, motion: { k: 'swing', ax: 0, ay: mm(300), period: 60, phase: 0 } } }])])
    let prev = initSimAt(c, TPL_X, 2900)
    let cur = prev
    for (let i = 0; i < 400 && !cur.dead; i++) {
      prev = cur
      cur = step(cur, true, c)
    }
    expect(cur.dead).toBe('crash')
    const { canvas, draws } = fakeCanvas()
    const r = createRenderer(canvas)
    r.resize(800, 600, 1)
    r.render(prev, cur, 1, c, 0) // 첫 호출이라 카메라는 cameraFor(…, null)과 같다
    const poly = draws.find((d) => d.name === 'fill' && d.style === '#ff3355')
    expect(poly).toBeDefined()
    const pts = poly!.path.filter((p) => p.name === 'moveTo' || p.name === 'lineTo').map((p) => p.args as [number, number])
    const ox = pts.reduce((a, p) => a + p[0], 0) / pts.length
    const oy = pts.reduce((a, p) => a + p[1], 0) / pts.length
    const rad = Math.max(...pts.map((p) => Math.hypot(p[0] - ox, p[1] - oy)))
    const view = cameraFor(prev, cur, 1, 800, 600, null)
    // 판정 도형(바퀴 둘·차체 판정원)의 화면 위치와 그린 톱니(중심 ox, oy / 반지름 rad)가 겹친다.
    const px = (x: number, y: number) => toScreen(view, 800, 600, x, y)
    const mid = { x: (cur.rear.x + cur.front.x) / 2, y: (cur.rear.y + cur.front.y) / 2 }
    const circles = [
      { ...px(cur.rear.x, cur.rear.y), r: WHEEL_R * view.scale },
      { ...px(cur.front.x, cur.front.y), r: WHEEL_R * view.scale },
      { ...px(mid.x, mid.y + HEAD_OFFSET), r: HEAD_R * view.scale },
    ]
    expect(circles.some((q) => Math.hypot(q.x - ox, q.y - oy) < q.r + rad)).toBe(true)
    // 그린 톱니의 크기는 판정 반지름과 같은 축척이다(가장 바깥 꼭짓점 = r).
    expect(rad / (mm(300) * view.scale)).toBeGreaterThan(0.99)
    expect(rad / (mm(300) * view.scale)).toBeLessThan(1.01)
  })
})

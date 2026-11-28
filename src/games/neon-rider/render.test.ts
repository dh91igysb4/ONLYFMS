import { describe, expect, it } from 'vitest'
import { BODY_DY, BODY_R, CAR_LEN, HEAD_OFFSET, HEAD_R, MM, REST_LEN, START_LEN, VIEW_CARS, WHEELBASE, WHEEL_R } from './constants.ts'
import { CARS } from './cars.ts'
import { chassisOf } from './collide.ts'
import { courseFromTemplates, courseOf } from './course.ts'
import type { MoverDef } from './movers.ts'
import type { HazardDef } from './hazards.ts'
import { TEMPLATES, buildTemplate, type Template } from './pieces.ts'
import { shapeAt, type HazardShape } from './hazards.ts'
import { initSim, initSimAt, step } from './sim.ts'
import type { SimState } from './sim.ts'
import { CAR_ART, CAR_BARS, CAR_COLOR, CAR_DECAL, CAR_WINDOW, cameraFor, createRenderer, praiseFor, sawOutline, spearOutline, spikeOutline, toScreen, visibleSegRange } from './render.ts'
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
  it('CAR_ART의 키 집합은 CARS의 id 집합과 같다', () => {
    expect(Object.keys(CAR_ART).sort()).toEqual(CARS.map((c) => c.id).sort())
  })

  it.each(CARS.map((c) => [c.id, c] as const))('%s: 그림의 가장자리(꼭짓점 사이 표본 포함) 모든 점이 판정 도형(두 바퀴·지붕 원·올린 차대 캡슐)에서 40 mm 안에 있다', (id, car) => {
    // 차 좌표(mm): 뒷바퀴 (0, 0), 앞바퀴 (WHEELBASE, 0), 지붕 판정원 (WHEELBASE/2, headOffset), 차대 캡슐 = 선분 (0, bodyDY)–(WHEELBASE, bodyDY), 반지름 bodyR.
    const art = CAR_ART[id]
    const circles = [
      { x: 0, y: 0, r: WHEEL_R / MM },
      { x: WHEELBASE / MM, y: 0, r: WHEEL_R / MM },
      { x: WHEELBASE / MM / 2, y: car.headOffset / MM, r: car.headR / MM },
    ]
    const outside = (a: number, b: number): number => {
      const cx = Math.min(Math.max(a, 0), WHEELBASE / MM)
      const cap = Math.hypot(a - cx, b - car.bodyDY / MM) - car.bodyR / MM
      return Math.min(cap, ...circles.map((c) => Math.hypot(a - c.x, b - c.y) - c.r))
    }
    for (let i = 0; i < art.length; i++) {
      const [x0, y0] = art[i]
      const [x1, y1] = art[(i + 1) % art.length]
      for (let k = 0; k <= 50; k++) {
        const a = x0 + ((x1 - x0) * k) / 50
        const b = y0 + ((y1 - y0) * k) / 50
        expect(outside(a, b), `변 ${i} (${a.toFixed(0)}, ${b.toFixed(0)})`).toBeLessThanOrEqual(40)
      }
    }
  })

  it.each(CARS.map((c) => [c.id, c] as const))('%s: 롤케이지 막대도 판정 도형 40 mm 안에 있다', (id, car) => {
    for (const bar of CAR_BARS[id] ?? []) {
      for (let i = 0; i + 1 < bar.length; i++) {
        for (let k = 0; k <= 50; k++) {
          const a = bar[i][0] + ((bar[i + 1][0] - bar[i][0]) * k) / 50
          const b = bar[i][1] + ((bar[i + 1][1] - bar[i][1]) * k) / 50
          const cx = Math.min(Math.max(a, 0), WHEELBASE / MM)
          const d = Math.min(
            Math.hypot(a - cx, b - car.bodyDY / MM) - car.bodyR / MM,
            Math.hypot(a - WHEELBASE / MM / 2, b - car.headOffset / MM) - car.headR / MM,
            Math.hypot(a, b) - WHEEL_R / MM,
            Math.hypot(a - WHEELBASE / MM, b) - WHEEL_R / MM,
          )
          expect(d, `(${a.toFixed(0)}, ${b.toFixed(0)})`).toBeLessThanOrEqual(40)
        }
      }
    }
  })

  it('CAR_COLOR·CAR_DECAL의 키 집합은 CARS의 id 집합과 같다', () => {
    expect(Object.keys(CAR_COLOR).sort()).toEqual(CARS.map((c) => c.id).sort())
    expect(Object.keys(CAR_DECAL).sort()).toEqual(CARS.map((c) => c.id).sort())
  })

  it.each([...Object.entries(CAR_WINDOW).map(([id, p]) => [`창 ${id}`, id, p] as const), ...Object.entries(CAR_DECAL).map(([id, p]) => [`데칼 ${id}`, id, p] as const)])('%s: 다각형은 차 그림 안에 있다', (_name, id, win) => {
    const art = CAR_ART[id]
    const inside = (x: number, y: number): boolean => {
      let o = false
      for (let i = 0, j = art.length - 1; i < art.length; j = i++) {
        const [xi, yi] = art[i]
        const [xj, yj] = art[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) o = !o
      }
      return o
    }
    for (let i = 0; i < win.length; i++) {
      const [x0, y0] = win[i]
      const [x1, y1] = win[(i + 1) % win.length]
      for (let k = 0; k <= 20; k++) expect(inside(x0 + ((x1 - x0) * k) / 20, y0 + ((y1 - y0) * k) / 20), `창 ${id} 변 ${i}`).toBe(true)
    }
  })

  it.each(CARS.map((c) => [c.id, c] as const))('%s: 판정 캡슐의 아래 끝은 축선 아래 바퀴 바닥보다 위다(바퀴 사이 길 아래로 처지지 않는다)', (_id, car) => {
    expect(car.bodyR - car.bodyDY).toBeLessThan(WHEEL_R)
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
    const cap = chassisOf(cur.rear, cur.front, BODY_DY)
    const A = px(cap.x0, cap.y0)
    const B = px(cap.x1, cap.y1)
    const t = Math.min(1, Math.max(0, ((ox - A.x) * (B.x - A.x) + (oy - A.y) * (B.y - A.y)) / ((B.x - A.x) ** 2 + (B.y - A.y) ** 2)))
    const capHit = Math.hypot(A.x + (B.x - A.x) * t - ox, A.y + (B.y - A.y) * t - oy) < BODY_R * view.scale + rad
    expect(capHit || circles.some((q) => Math.hypot(q.x - ox, q.y - oy) < q.r + rad)).toBe(true)
    // 그린 톱니의 크기는 판정 반지름과 같은 축척이다(가장 바깥 꼭짓점 = r + 톱니 끝 40 mm).
    expect(rad / (mm(340) * view.scale)).toBeGreaterThan(0.99)
    expect(rad / (mm(340) * view.scale)).toBeLessThan(1.01)
  })
})

describe('위험물 그림과 판정 경계(설계 §5.4: 45 mm 안)', () => {
  const mm = (n: number): number => n * MM
  const TOL = 45 * MM
  type Pt = readonly [number, number]
  const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
    return Math.hypot(px - ax - dx * t, py - ay - dy * t)
  }
  // 그린 바깥선(닫힌 다각형)까지의 거리
  const toOutline = (poly: readonly Pt[], x: number, y: number): number => {
    let d = Infinity
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i]
      const [bx, by] = poly[(i + 1) % poly.length]
      d = Math.min(d, segDist(x, y, ax, ay, bx, by))
    }
    return d
  }
  // 판정 경계(원 또는 캡슐 둘레)까지의 거리와 그 경계 위 표본
  const toJudged = (sh: HazardShape, x: number, y: number): number =>
    sh.s === 'disc' ? Math.abs(Math.hypot(x - sh.x, y - sh.y) - sh.r) : sh.s === 'bar' ? Math.abs(segDist(x, y, sh.x0, sh.y0, sh.x1, sh.y1) - sh.r) : NaN
  const judgedSamples = (sh: HazardShape): Pt[] => {
    const out: Pt[] = []
    if (sh.s === 'disc') {
      for (let k = 0; k < 720; k++) out.push([sh.x + Math.cos((k * Math.PI) / 360) * sh.r, sh.y + Math.sin((k * Math.PI) / 360) * sh.r])
    } else if (sh.s === 'bar') {
      const len = Math.hypot(sh.x1 - sh.x0, sh.y1 - sh.y0)
      const ux = len > 0 ? (sh.x1 - sh.x0) / len : 1
      const uy = len > 0 ? (sh.y1 - sh.y0) / len : 0
      const n = Math.max(2, Math.ceil(len / mm(10)))
      for (let k = 0; k <= n; k++) {
        const t = (len * k) / n
        for (const sd of [1, -1]) out.push([sh.x0 + ux * t - uy * sh.r * sd, sh.y0 + uy * t + ux * sh.r * sd])
      }
      for (let k = 0; k <= 180; k++) {
        const a = (k * Math.PI) / 180 - Math.PI / 2 // 끝 쪽 반원(앞)과 시작 쪽 반원(뒤)
        const cx = Math.cos(a)
        const sy = Math.sin(a)
        out.push([sh.x1 + (ux * cx - uy * sy) * sh.r, sh.y1 + (uy * cx + ux * sy) * sh.r])
        out.push([sh.x0 - (ux * cx - uy * sy) * sh.r, sh.y0 - (uy * cx + ux * sy) * sh.r])
      }
    }
    return out
  }
  // 두 방향 모두: 판정 경계의 모든 표본이 그린 선에서, 그린 선(변마다 표본)의 모든 점이 판정 경계에서 TOL 안.
  const worst = (sh: HazardShape, poly: readonly Pt[]): { cover: number; spill: number } => {
    let cover = 0
    for (const [x, y] of judgedSamples(sh)) cover = Math.max(cover, toOutline(poly, x, y))
    let spill = 0
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i]
      const [bx, by] = poly[(i + 1) % poly.length]
      for (let k = 0; k < 20; k++) spill = Math.max(spill, toJudged(sh, ax + ((bx - ax) * k) / 20, ay + ((by - ay) * k) / 20))
    }
    return { cover, spill }
  }
  const outlineOf = (look: string, sh: HazardShape, spin: number): Pt[] | null => {
    if (look === 'saw' && sh.s === 'disc') return sawOutline(sh.x, sh.y, sh.r, spin)
    if (look === 'spikes' && sh.s === 'bar') return spikeOutline(sh.x0, sh.y0, sh.x1, sh.y1, sh.r)
    if (look === 'spear' && sh.s === 'bar') return spearOutline(sh.x0, sh.y0, sh.x1, sh.y1, sh.r)
    return null
  }

  it('템플릿의 모든 톱니·가시 띠·창: 판정 경계와 그린 바깥선이 서로 45 mm 안(움직이는 것은 여러 시각)', () => {
    const looks = new Set<string>()
    let checked = 0
    for (const t of TEMPLATES) {
      for (const def of buildTemplate(t).hazards) {
        const hz = { ...def, id: 0 }
        const times = def.motion.k === 'none' ? [0] : Array.from({ length: 40 }, (_, k) => k * 23)
        for (const T of times) {
          const sh = shapeAt(hz, T)
          if (!sh) continue
          const poly = outlineOf(def.look, sh, 0.1 + T / 50)
          if (!poly) continue
          looks.add(def.look)
          checked++
          const { cover, spill } = worst(sh, poly)
          expect(cover, `${t.id} ${def.look} T=${T}: 그리지 않은 판정 경계`).toBeLessThanOrEqual(TOL)
          expect(spill, `${t.id} ${def.look} T=${T}: 판정 밖으로 그린 선`).toBeLessThanOrEqual(TOL)
        }
      }
    }
    expect([...looks].sort()).toEqual(['saw', 'spear', 'spikes'])
    expect(checked).toBeGreaterThan(20)
  })

  it('작은·큰 치수에서도 45 mm 안: 톱니 r 0.2~6 m, 가시 띠·창 길이 0~20 m·기울기 여러 개', () => {
    for (const r of [200, 300, 450, 1000, 2500, 4500, 6000]) {
      const sh: HazardShape = { s: 'disc', x: mm(1234), y: -mm(567), r: mm(r) }
      for (const spin of [0, 0.2, 1.7]) {
        const { cover, spill } = worst(sh, sawOutline(sh.x, sh.y, sh.r, spin))
        expect(Math.max(cover, spill), `톱니 r ${r} mm`).toBeLessThanOrEqual(TOL)
      }
    }
    for (const len of [0, 50, 400, 3000, 20000]) {
      for (const deg of [0, 30, 90, 145, 180, 260]) {
        for (const r of [100, 200]) {
          const a = (deg * Math.PI) / 180
          const sh: HazardShape = { s: 'bar', x0: mm(100), y0: mm(200), x1: mm(100) + Math.round(Math.cos(a) * mm(len)), y1: mm(200) + Math.round(Math.sin(a) * mm(len)), r: mm(r) }
          for (const [name, poly] of [['가시', spikeOutline(sh.x0, sh.y0, sh.x1, sh.y1, sh.r)], ['창', spearOutline(sh.x0, sh.y0, sh.x1, sh.y1, sh.r)]] as const) {
            const { cover, spill } = worst(sh, poly)
            expect(Math.max(cover, spill), `${name} 길이 ${len} 각도 ${deg} r ${r}`).toBeLessThanOrEqual(TOL)
          }
        }
      }
    }
  })
})

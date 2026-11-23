import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { drawSprite } from './sprites.ts'
import { drawScene, layout, SCENE_H, SCENE_W, type Phase, type SceneState } from './scene.ts'

// 그려진 스프라이트의 화면 좌표(이동 반영)를 기록하려고 drawSprite를 감싼다. 그리기 자체는 실제 함수가 한다.
vi.mock('./sprites.ts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./sprites.ts')>()
  return { ...orig, drawSprite: vi.fn(orig.drawSprite) }
})
const realSprites = await vi.importActual<typeof import('./sprites.ts')>('./sprites.ts')

type Rect = { x: number; y: number; w: number; h: number; safe: boolean }
type SpriteCall = { name: string; x: number; y: number; safe: boolean }

/** fillRect·drawImage를 기록하는 가짜 2D 컨텍스트. save 안(이동된 안전 상자 층)인지와 이동량을 함께 적는다. */
class RecordingCtx {
  fillStyle = ''
  imageSmoothingEnabled = true
  tx = 0
  ty = 0
  stack: [number, number][] = []
  rects: Rect[] = []
  images: { img: unknown; x: number; y: number }[] = []
  sprites: SpriteCall[] = []
  fillRect(x: number, y: number, w: number, h: number) {
    this.rects.push({ x: x + this.tx, y: y + this.ty, w, h, safe: this.stack.length > 0 })
  }
  drawImage(img: unknown, x: number, y: number) {
    this.images.push({ img, x, y })
  }
  save() {
    this.stack.push([this.tx, this.ty])
  }
  restore() {
    const top = this.stack.pop()
    if (top) [this.tx, this.ty] = top
  }
  translate(dx: number, dy: number) {
    this.tx += dx
    this.ty += dy
  }
}
const asCtx = (c: RecordingCtx) => c as unknown as CanvasRenderingContext2D

const bar = { barPos: 0.55, barVel: 0, fishPos: 0.62, fishTarget: 0.6, progress: 0.58, perfect: true, t: 0 }
const STATES: Record<Phase, Partial<SceneState>> = {
  idle: {},
  charging: { gauge: 0.7 },
  waiting: { castPower: 0.6 },
  bite: { castPower: 1 },
  fighting: { castPower: 1, bar, barParams: { barSize: 0.3, difficulty: 0.5 } },
  caught: { castPower: 0.6, caughtSpecies: 'mackerel' },
  lost: { castPower: 0 },
}
const PHASES = Object.keys(STATES) as Phase[]
const SIZES: [number, number][] = [[160, 240], [195, 280], [320, 480]]

function state(phase: Phase, tMs = 1234): SceneState {
  return { phase, tMs, gauge: 0, castPower: 0, bar: null, barParams: null, caughtSpecies: null, ...STATES[phase] }
}

beforeEach(() => {
  vi.mocked(drawSprite).mockImplementation((ctx, name, x, y, scale, opts) => {
    const c = ctx as unknown as RecordingCtx
    c.sprites?.push({ name, x: x + c.tx, y: y + c.ty, safe: c.stack.length > 0 })
    realSprites.drawSprite(ctx, name, x, y, scale, opts)
  })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('layout', () => {
  test('centres the 160×240 safe box', () => {
    expect(layout(160, 240)).toMatchObject({ ox: 0, oy: 0 })
    expect(layout(195, 280)).toMatchObject({ ox: 17, oy: 20 })
    expect(layout(320, 480)).toMatchObject({ ox: 80, oy: 120 })
    expect(SCENE_W).toBe(160)
    expect(SCENE_H).toBe(240)
  })
})

describe('drawScene (direct drawing, no offscreen canvas)', () => {
  beforeEach(() => {
    // jsdom처럼 오프스크린 캔버스 컨텍스트가 없으면 직접 그린다
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
  })

  for (const [w, h] of SIZES) {
    for (const phase of PHASES) {
      test(`${w}×${h} ${phase}: player at the safe-box spot, safe layer inside the canvas`, () => {
        const ctx = new RecordingCtx()
        expect(() => drawScene(asCtx(ctx), state(phase), { w, h })).not.toThrow()
        const ox = Math.floor((w - 160) / 2)
        const oy = Math.floor((h - 240) / 2)
        const L = layout(w, h)
        expect([L.playerX, L.playerY]).toEqual([ox + 72, oy + 86])

        const players = ctx.sprites.filter((s) => s.name.startsWith('player-'))
        expect(players).toHaveLength(1)
        const shake = phase === 'fighting' ? [-1, 1] : [0]
        expect(shake.map((d) => L.playerX + d)).toContain(players[0].x)
        expect(players[0].y).toBe(L.playerY)

        const safe = ctx.rects.filter((r) => r.safe)
        expect(safe.length).toBeGreaterThan(0)
        for (const r of safe) {
          expect(r.x, JSON.stringify(r)).toBeGreaterThanOrEqual(0)
          expect(r.y, JSON.stringify(r)).toBeGreaterThanOrEqual(0)
          expect(r.x + r.w, JSON.stringify(r)).toBeLessThanOrEqual(w)
          expect(r.y + r.h, JSON.stringify(r)).toBeLessThanOrEqual(h)
        }
        expect(ctx.stack).toHaveLength(0)
        expect([ctx.tx, ctx.ty]).toEqual([0, 0])
      })
    }
  }

  test('the background fills the whole canvas: sand across the top, water to the bottom-right corner', () => {
    const ctx = new RecordingCtx()
    drawScene(asCtx(ctx), state('idle'), { w: 320, h: 480 })
    const bg = ctx.rects.filter((r) => !r.safe)
    // 모래 띠는 y = 0에서 전체 너비로
    expect(bg.some((r) => r.x === 0 && r.y === 0 && r.w === 320)).toBe(true)
    // 물 타일이 오른쪽 아래 모서리까지 덮는다
    const water = ctx.sprites.filter((s) => s.name.startsWith('water-'))
    expect(water.some((s) => s.x + 16 >= 320 && s.y + 16 >= 480)).toBe(true)
    // 부두는 위 모래에서 안전 상자의 부두 끝까지 이어지고, x는 ox를 따른다
    const L = layout(320, 480)
    const planks = ctx.sprites.filter((s) => s.name === 'pier-plank')
    expect(Math.min(...planks.map((p) => p.y))).toBeLessThanOrEqual(0)
    expect(Math.max(...planks.map((p) => p.y + 16))).toBe(L.pierEnd)
    expect(new Set(planks.map((p) => p.x))).toEqual(new Set([L.pierX, L.pierX + 16]))
    // 기둥이 부두 길이를 따라 늘어난다
    const posts = ctx.sprites.filter((s) => s.name === 'pier-post')
    expect(posts.length).toBeGreaterThan(6)
    // 바위가 안전 상자 밖에도 있다
    const rocks = ctx.sprites.filter((s) => s.name === 'rock')
    expect(rocks.length).toBeGreaterThan(2)
    expect(rocks.some((r) => r.x < L.ox || r.x + 14 > L.ox + 160 || r.y < L.oy || r.y + 9 > L.oy + 240)).toBe(true)
  })

  test('rocks and fish shadows never overlap the pier, sand or each other', () => {
    for (const [w, h] of [...SIZES, [320, 348] as [number, number], [179, 282] as [number, number]]) {
      for (let t = 0; t < 60000; t += 1777) {
        const ctx = new RecordingCtx()
        drawScene(asCtx(ctx), state('idle', t), { w, h })
        const L = layout(w, h)
        const rocks = ctx.sprites.filter((s) => s.name === 'rock')
        const shadows = ctx.sprites.filter((s) => s.name === 'fish-shadow')
        expect(rocks.length, `${w}×${h}`).toBeGreaterThanOrEqual(2)
        expect(shadows.length, `${w}×${h}`).toBeGreaterThanOrEqual(2)
        for (const r of rocks) {
          expect(r.x).toBeGreaterThanOrEqual(0)
          expect(r.x + 14).toBeLessThanOrEqual(w)
          expect(r.y + 9).toBeLessThanOrEqual(h)
        }
        const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        // 부두(기둥·그늘 포함)와 모래
        const pier = { x: L.pierX - 8, y: 0, w: 32 + 16, h: L.pierEnd + 7 }
        for (const s of [...rocks.map((r) => ({ x: r.x, y: r.y, w: 14, h: 9 })), ...shadows.map((f) => ({ x: f.x, y: f.y, w: 10, h: 5 }))]) {
          expect(hit(s, pier), `${w}×${h} ${JSON.stringify(s)}`).toBe(false)
          expect(s.y).toBeGreaterThanOrEqual(17)
        }
        for (const f of shadows) {
          for (const r of rocks) expect(hit({ x: f.x, y: f.y, w: 10, h: 5 }, { x: r.x, y: r.y, w: 14, h: 9 })).toBe(false)
        }
      }
    }
  })
})

describe('drawScene background cache', () => {
  test('renders the static background once per size into two canvases and draws them per water frame', () => {
    const made: RecordingCtx[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const c = new RecordingCtx()
      made.push(c)
      return c as unknown as RenderingContext
    })
    const main = new RecordingCtx()
    drawScene(asCtx(main), state('idle', 0), { w: 200, h: 300 })
    drawScene(asCtx(main), state('idle', 100), { w: 200, h: 300 })
    drawScene(asCtx(main), state('waiting', 600), { w: 200, h: 300 })
    expect(made).toHaveLength(2)
    expect(made.every((c) => c.rects.length > 0)).toBe(true)
    expect(main.images).toHaveLength(3)
    expect(main.images.every((i) => i.x === 0 && i.y === 0)).toBe(true)
    expect(main.images[0].img).toBe(main.images[1].img)
    expect(main.images[2].img).not.toBe(main.images[0].img)
    // 물 타일은 배경 캔버스에만 그려지고 화면에는 그리지 않는다
    expect(main.sprites.some((s) => s.name.startsWith('water-'))).toBe(false)
    expect(main.sprites.some((s) => s.name === 'player-idle')).toBe(true)

    // 크기가 바뀌면 다시 만든다
    drawScene(asCtx(main), state('idle', 0), { w: 201, h: 300 })
    expect(made).toHaveLength(4)
    expect((main.images[3].img as HTMLCanvasElement).width).toBe(201)
  })
})

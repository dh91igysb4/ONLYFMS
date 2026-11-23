import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { drawSprite } from './sprites.ts'
import { drawWorld, hudSide, releaseSceneCache, type Phase, type WorldScene } from './scene.ts'
import type { BarParams } from './minigame.ts'
import { PIER_END, SPAWN, TILE, castTarget, type Facing, type Vec } from './map.ts'
import { cameraFor, type Player } from './walk.ts'

// 그려진 스프라이트의 화면 좌표(이동 반영)를 기록하려고 drawSprite를 감싼다. 그리기 자체는 실제 함수가 한다.
vi.mock('./sprites.ts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./sprites.ts')>()
  return { ...orig, drawSprite: vi.fn(orig.drawSprite) }
})
const realSprites = await vi.importActual<typeof import('./sprites.ts')>('./sprites.ts')

type Rect = { x: number; y: number; w: number; h: number; color: string }
type SpriteCall = { name: string; x: number; y: number; flipX: boolean; at: number }

/** fillRect·drawImage를 기록하는 가짜 2D 컨텍스트. 이동(translate)을 반영한 화면 좌표로 적는다. */
class RecordingCtx {
  fillStyle = ''
  imageSmoothingEnabled = true
  tx = 0
  ty = 0
  stack: [number, number][] = []
  rects: Rect[] = []
  images: unknown[][] = []
  sprites: SpriteCall[] = []
  fillRect(x: number, y: number, w: number, h: number) {
    this.rects.push({ x: x + this.tx, y: y + this.ty, w, h, color: this.fillStyle })
  }
  drawImage(...args: unknown[]) {
    this.images.push(args)
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
const barParams: BarParams = { barSize: 0.3, difficulty: 0.5, behavior: 'mixed' }
const PHASES: Phase[] = ['idle', 'charging', 'waiting', 'bite', 'fighting', 'caught', 'lost']
const SIZES: [number, number][] = [[160, 240], [195, 280], [320, 480]]

const tileCentre = (tx: number, ty: number): Vec => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })
const PIER_SPOT = tileCentre(PIER_END.tx, PIER_END.ty)

function player(pos: Vec, facing: Facing = 'down', moving = false, walkMs = 0): Player {
  return { pos, facing, moving, walkMs }
}

function scene(phase: Phase, p: Player, size: { w: number; h: number }, extra: Partial<WorldScene> = {}): WorldScene {
  const fishing = phase === 'waiting' || phase === 'bite' || phase === 'fighting' || phase === 'lost'
  return {
    phase,
    tMs: 1234,
    gauge: phase === 'charging' ? 0.7 : 0,
    player: p,
    camera: cameraFor(p.pos, size),
    bobber: fishing ? castTarget(p.pos, p.facing, 0.6) : null,
    bar: phase === 'fighting' ? bar : null,
    barParams: phase === 'fighting' ? barParams : null,
    caughtSpecies: phase === 'caught' ? 'mackerel' : null,
    ...extra,
  }
}

const players = (c: RecordingCtx) => c.sprites.filter((s) => s.name.startsWith('player-'))

beforeEach(() => {
  vi.mocked(drawSprite).mockImplementation((ctx, name, x, y, scale, opts) => {
    const c = ctx as unknown as RecordingCtx
    c.sprites?.push({ name, x: x + c.tx, y: y + c.ty, flipX: opts?.flipX === true, at: c.rects?.length ?? 0 })
    realSprites.drawSprite(ctx, name, x, y, scale, opts)
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  releaseSceneCache()
})

describe('hudSide', () => {
  test('HUD goes to the half the player is not in', () => {
    expect(hudSide(40, 195)).toBe('right')
    expect(hudSide(150, 195)).toBe('left')
    expect(hudSide(0, 160)).toBe('right')
    expect(hudSide(159, 160)).toBe('left')
  })
})

describe('drawWorld without an offscreen canvas (direct drawing)', () => {
  beforeEach(() => {
    // jsdom처럼 오프스크린 캔버스 컨텍스트가 없으면 보이는 타일만 직접 그린다
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
  })

  const SPOTS: [string, Player][] = [
    ['shop front', player(SPAWN.pos, 'down')],
    ['beach', player(tileCentre(20, 24), 'down')],
    ['pier end', player(PIER_SPOT, 'down')],
    ['pier end facing left', player(PIER_SPOT, 'left')],
  ]

  for (const [w, h] of SIZES) {
    for (const phase of PHASES) {
      for (const [where, p] of SPOTS) {
        test(`${w}×${h} ${phase} at ${where}: no throw, player sprite at its feet`, () => {
          const ctx = new RecordingCtx()
          const s = scene(phase, p, { w, h })
          expect(() => drawWorld(asCtx(ctx), s, { w, h })).not.toThrow()
          const ps = players(ctx)
          expect(ps).toHaveLength(1)
          const x = p.pos.x - s.camera.x - 8
          const y = p.pos.y - s.camera.y - 24
          const shake = phase === 'fighting' ? [x - 1, x, x + 1] : [x]
          expect(shake).toContain(ps[0].x)
          expect(ps[0].y).toBe(y)
          expect(ctx.stack).toHaveLength(0)
          expect([ctx.tx, ctx.ty]).toEqual([0, 0])
        })
      }
    }
  }

  test('only tiles that touch the view are drawn', () => {
    for (const [w, h] of SIZES) {
      const ctx = new RecordingCtx()
      drawWorld(asCtx(ctx), scene('idle', player(PIER_SPOT), { w, h }), { w, h })
      const tiles = ctx.sprites.filter((s) => s.name.startsWith('tile-') || s.name.startsWith('water-'))
      expect(tiles.length).toBeGreaterThan(0)
      for (const t of tiles) {
        expect(t.x + 16, JSON.stringify(t)).toBeGreaterThan(-16)
        expect(t.y + 32, JSON.stringify(t)).toBeGreaterThan(-16)
        expect(t.x, JSON.stringify(t)).toBeLessThan(w + 16)
        expect(t.y, JSON.stringify(t)).toBeLessThan(h + 16)
      }
      expect(tiles.length).toBeLessThan(((w / 16 + 3) * (h / 16 + 3)) * 2)
    }
  })

  test('grass variants are fixed per tile (no flicker between frames)', () => {
    const size = { w: 320, h: 480 }
    const names = (tMs: number) => {
      const ctx = new RecordingCtx()
      drawWorld(asCtx(ctx), { ...scene('idle', player(SPAWN.pos), size), tMs }, size)
      return ctx.sprites.filter((s) => s.name.startsWith('tile-grass')).map((s) => `${s.name}@${s.x},${s.y}`)
    }
    const a = names(0)
    expect(a.some((n) => n.startsWith('tile-grass-alt@'))).toBe(true)
    expect(a.some((n) => n.startsWith('tile-grass@'))).toBe(true)
    expect(names(777)).toEqual(a)
  })

  test('the shop is drawn once at its tile spot and vertical fence runs use tile-fence-v', () => {
    const size = { w: 320, h: 480 }
    const p = player(SPAWN.pos)
    const s = scene('idle', p, size)
    const ctx = new RecordingCtx()
    drawWorld(asCtx(ctx), s, size)
    const shops = ctx.sprites.filter((c) => c.name === 'shop')
    expect(shops).toHaveLength(1)
    expect([shops[0].x, shops[0].y]).toEqual([10 * 16 - s.camera.x, 2 * 16 - s.camera.y])
    // 맵 (3, 10)은 위아래에만 울타리가 있다
    const v = ctx.sprites.find((c) => c.name === 'tile-fence-v' && c.x === 3 * 16 - s.camera.x && c.y === 10 * 16 - s.camera.y)
    expect(v).toBeDefined()
  })

  test('pose follows phase, facing and walking; left is the side sprite mirrored', () => {
    const size = { w: 195, h: 280 }
    const pick = (phase: Phase, p: Player) => {
      const ctx = new RecordingCtx()
      drawWorld(asCtx(ctx), scene(phase, p, size), size)
      const [one] = players(ctx)
      return `${one.name}${one.flipX ? ':flip' : ''}`
    }
    const beach = tileCentre(20, 22)
    expect(pick('idle', player(beach, 'down'))).toBe('player-idle-down')
    expect(pick('idle', player(beach, 'up'))).toBe('player-idle-up')
    expect(pick('idle', player(beach, 'right'))).toBe('player-idle-side')
    expect(pick('idle', player(beach, 'left'))).toBe('player-idle-side:flip')
    expect(pick('idle', player(beach, 'down', true, 50))).toBe('player-walk-down-0')
    expect(pick('idle', player(beach, 'down', true, 250))).toBe('player-walk-down-1')
    expect(pick('idle', player(beach, 'left', true, 450))).toBe('player-walk-side-0:flip')
    expect(pick('caught', player(beach, 'up', true, 250))).toBe('player-walk-up-1')
    for (const phase of ['charging', 'waiting', 'bite'] as Phase[]) {
      expect(pick(phase, player(beach, 'down'))).toBe('player-cast')
      expect(pick(phase, player(beach, 'up'))).toBe('player-cast-up')
      expect(pick(phase, player(beach, 'right'))).toBe('player-cast-side')
      expect(pick(phase, player(beach, 'left'))).toBe('player-cast-side:flip')
    }
    expect(pick('fighting', player(beach, 'down'))).toBe('player-reel')
    expect(pick('fighting', player(beach, 'up'))).toBe('player-reel-up')
    expect(pick('fighting', player(beach, 'left'))).toBe('player-reel-side:flip')
  })

  /** 캐릭터가 화면 가운데·좌우 끝·위아래 끝 근처에 오는 카메라들 (맵 가장자리에서 카메라가 멈춘 경우) */
  const outcomeViews = (w: number, h: number): [string, Player, Vec][] => {
    const out: [string, Player, Vec][] = []
    for (const [where, p] of SPOTS) {
      for (const sx of [30, Math.floor(w / 2), w - 30]) {
        for (const sy of [60, Math.floor(h / 2), h - 20]) {
          out.push([`${w}×${h} ${where} at screen (${sx}, ${sy})`, p, { x: p.pos.x - sx, y: p.pos.y - sy }])
        }
      }
    }
    return out
  }

  test('caught: the fish is held up above the player head, centred on the player, inside the canvas', () => {
    for (const [w, h] of SIZES) {
      for (const [label0, p, camera] of outcomeViews(w, h)) {
        for (const tMs of [0, 400]) {
          const ctx = new RecordingCtx()
          drawWorld(asCtx(ctx), scene('caught', p, { w, h }, { camera, tMs }), { w, h })
          const [pl] = players(ctx)
          const fish = ctx.sprites.find((c) => c.name === 'fish-mackerel')
          const label = `${label0} t=${tMs}`
          expect(fish, label).toBeDefined()
          const f = fish as SpriteCall
          // 2배로 그린 16×16 물고기
          expect(f.y + 32, label).toBeLessThanOrEqual(pl.y)
          expect(Math.abs(f.x + 16 - (pl.x + 8)), label).toBeLessThanOrEqual(8)
          expect(f.x, label).toBeGreaterThanOrEqual(0)
          expect(f.x + 32, label).toBeLessThanOrEqual(w)
          expect(f.y, label).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  test('lost: the fish shadow and splash appear above the player head, centred on the player', () => {
    for (const [w, h] of SIZES) {
      for (const [label, p, camera] of outcomeViews(w, h)) {
        const ctx = new RecordingCtx()
        drawWorld(asCtx(ctx), scene('lost', p, { w, h }, { camera }), { w, h })
        const [pl] = players(ctx)
        const shadow = ctx.sprites.find((c) => c.name === 'fish-shadow')
        const splash = ctx.sprites.find((c) => c.name === 'splash')
        expect(shadow, label).toBeDefined()
        expect(splash, label).toBeDefined()
        const s = shadow as SpriteCall
        // 2배로 그린 10×5 그림자
        expect(s.y + 10, label).toBeLessThanOrEqual(pl.y)
        expect(Math.abs(s.x + 10 - (pl.x + 8)), label).toBeLessThanOrEqual(8)
        expect((splash as SpriteCall).y + 5, label).toBeLessThanOrEqual(pl.y)
      }
    }
  })

  test('bobber and bite mark sit on the bobber spot, only while fishing', () => {
    const size = { w: 195, h: 280 }
    const p = player(PIER_SPOT, 'down')
    const waiting = scene('waiting', p, size)
    const ctx = new RecordingCtx()
    drawWorld(asCtx(ctx), waiting, size)
    const b = waiting.bobber as Vec
    const bob = ctx.sprites.find((c) => c.name === 'bobber')
    expect(bob).toBeDefined()
    expect(Math.abs((bob?.x ?? 0) + 3 - (b.x - waiting.camera.x))).toBeLessThanOrEqual(1)
    expect(Math.abs((bob?.y ?? 0) - (b.y - waiting.camera.y))).toBeLessThanOrEqual(8)

    const bite = new RecordingCtx()
    drawWorld(asCtx(bite), scene('bite', p, size), size)
    const bang = bite.sprites.find((c) => c.name === 'bang')
    expect(bang).toBeDefined()
    expect(bang?.y ?? 0).toBeLessThan(b.y - waiting.camera.y)

    const idle = new RecordingCtx()
    drawWorld(asCtx(idle), scene('idle', p, size, { bobber: b }), size)
    expect(idle.sprites.some((c) => c.name === 'bobber' || c.name === 'bang')).toBe(false)
  })
})

describe('drawWorld with an offscreen canvas', () => {
  let made: RecordingCtx[]
  beforeEach(() => {
    made = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const c = new RecordingCtx()
      made.push(c)
      return c as unknown as RenderingContext
    })
  })

  test('the static map is cached in two canvases once; each frame blits the camera view with one drawImage', () => {
    const size = { w: 195, h: 280 }
    const main = new RecordingCtx()
    const s = scene('idle', player(SPAWN.pos), size)
    drawWorld(asCtx(main), { ...s, tMs: 0 }, size)
    drawWorld(asCtx(main), { ...s, tMs: 100 }, size)
    drawWorld(asCtx(main), { ...s, tMs: 600 }, size)
    expect(made).toHaveLength(2)
    expect(made.every((c) => c.rects.length > 0 && c.sprites.some((t) => t.name === 'shop'))).toBe(true)
    expect(main.images).toHaveLength(3)
    const [img, sx, sy, sw, sh, dx, dy, dw, dh] = main.images[0]
    expect([sx, sy, sw, sh, dx, dy, dw, dh]).toEqual([s.camera.x, s.camera.y, 195, 280, 0, 0, 195, 280])
    expect((img as HTMLCanvasElement).width).toBe(48 * 16)
    expect((img as HTMLCanvasElement).height).toBe(36 * 16)
    expect(main.images[1][0]).toBe(img)
    expect(main.images[2][0]).not.toBe(img)
    // 타일은 캐시에만 그리고 화면에는 그리지 않는다
    expect(main.sprites.some((c) => c.name.startsWith('water-') || c.name === 'shop' || c.name === 'tile-grass')).toBe(false)
    expect(players(main)).toHaveLength(3) // 프레임마다 하나

    // 크기가 바뀌어도 맵 캐시는 그대로
    drawWorld(asCtx(main), scene('idle', player(SPAWN.pos), { w: 320, h: 480 }), { w: 320, h: 480 })
    expect(made).toHaveLength(2)

    releaseSceneCache()
    drawWorld(asCtx(main), s, size)
    expect(made).toHaveLength(4)
    expect(main.images.at(-1)?.[0]).not.toBe(img)
  })

  test('tree tops cover the player standing above the trunk, not the player below it', () => {
    const size = { w: 195, h: 280 }
    // 맵 (6, 3)은 나무, (6, 2)·(6, 4)는 풀
    const TREE_COLOR = '#3f8a4f'
    const treeTop = (c: RecordingCtx, cam: Vec) =>
      c.rects.map((r, i) => ({ r, i })).filter(({ r }) =>
        r.color === TREE_COLOR && r.x >= 6 * 16 - cam.x && r.x < 7 * 16 - cam.x && r.y >= 2 * 16 - cam.y && r.y < 3 * 16 - cam.y)

    const above = scene('idle', player(tileCentre(6, 2), 'down'), size)
    const a = new RecordingCtx()
    drawWorld(asCtx(a), above, size)
    const pa = players(a)[0]
    const ta = treeTop(a, above.camera)
    expect(ta.length).toBeGreaterThan(0)
    expect(ta.every(({ i }) => i >= pa.at)).toBe(true)

    const below = scene('idle', player({ x: 6 * 16 + 8, y: 4 * 16 + 8 }, 'up'), size)
    const b = new RecordingCtx()
    drawWorld(asCtx(b), below, size)
    const pb = players(b)[0]
    const tb = treeTop(b, below.camera)
    expect(tb.length).toBeGreaterThan(0)
    expect(tb.every(({ i }) => i < pb.at)).toBe(true)
  })

  test('the fight track sits in the hudSide half, inside the canvas', () => {
    const TRACK_COLORS = new Set(['#173a52', '#a8723f', '#3b3350'])
    for (const [w, h] of SIZES) {
      for (const screenX of [30, w - 30]) {
        const p = player(PIER_SPOT, 'down')
        const camera = { x: p.pos.x - screenX, y: p.pos.y - Math.floor(h / 2) }
        const ctx = new RecordingCtx()
        drawWorld(asCtx(ctx), scene('fighting', p, { w, h }, { camera }), { w, h })
        const track = ctx.rects.filter((r) => TRACK_COLORS.has(r.color))
        expect(track.length).toBeGreaterThan(0)
        const x0 = Math.min(...track.map((r) => r.x))
        const x1 = Math.max(...track.map((r) => r.x + r.w))
        const y0 = Math.min(...track.map((r) => r.y))
        const y1 = Math.max(...track.map((r) => r.y + r.h))
        expect(y0).toBeGreaterThanOrEqual(0)
        expect(y1).toBeLessThanOrEqual(h)
        if (hudSide(screenX, w) === 'right') {
          expect(x0, `${w}×${h} x=${screenX}`).toBeGreaterThanOrEqual(w / 2)
          expect(x1).toBeLessThanOrEqual(w)
        } else {
          expect(x0).toBeGreaterThanOrEqual(0)
          expect(x1, `${w}×${h} x=${screenX}`).toBeLessThanOrEqual(w / 2)
        }
      }
    }
  })
})

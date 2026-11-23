import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { drawSprite } from './sprites.ts'
import { drawWorld, hudLayout, hudSide, releaseSceneCache, type Box, type Phase, type WorldScene } from './scene.ts'
import type { BarParams } from './minigame.ts'
import { TILE, castTarget, defineMap, pierEnd, type Facing, type Opened, type Vec } from './map.ts'
import { DEFAULT_AREAS, type AreaId } from './data.ts'
import { VILLAGE } from './maps/village.ts'
import { cameraFor, type Player } from './walk.ts'
import type { Conditions } from './clock.ts'

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
  texts: { text: string; x: number; y: number }[] = []
  fillText(text: string, x: number, y: number) {
    this.texts.push({ text, x: x + this.tx, y: y + this.ty })
  }
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
const barParams: BarParams = { barSize: 0.3, difficulty: 0.5, behavior: 'mixed', drain: 1, pull: 0 }
const NOON_SUN: Conditions = { gameMinute: 12 * 60, gameDay: 1, season: 'spring', weather: 'sun' }
const PHASES: Phase[] = ['idle', 'charging', 'waiting', 'bite', 'fighting', 'caught', 'lost']
const SIZES: [number, number][] = [[160, 240], [195, 280], [320, 480]]

const tileCentre = (tx: number, ty: number): Vec => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })
const MAP_W = VILLAGE.w
const SPAWN = VILLAGE.spawn
const PIER_END = pierEnd(VILLAGE)!
const PIER_SPOT = tileCentre(PIER_END.tx, PIER_END.ty)

function player(pos: Vec, facing: Facing = 'down', moving = false, walkMs = 0): Player {
  return { pos, facing, moving, walkMs }
}

function scene(phase: Phase, p: Player, size: { w: number; h: number }, extra: Partial<WorldScene> = {}): WorldScene {
  const fishing = phase === 'waiting' || phase === 'bite' || phase === 'fighting' || phase === 'lost'
  return {
    map: VILLAGE,
    phase,
    tMs: 1234,
    gauge: phase === 'charging' ? 0.7 : 0,
    player: p,
    camera: cameraFor(VILLAGE, p.pos, size),
    bobber: fishing ? castTarget(VILLAGE, p.pos, p.facing, 0.6) : null,
    bar: phase === 'fighting' ? bar : null,
    barParams: phase === 'fighting' ? barParams : null,
    caughtSpecies: phase === 'caught' ? 'mackerel' : null,
    cond: NOON_SUN,
    hudTop: 0,
    fade: 0,
    opened: new Set<AreaId>(DEFAULT_AREAS),
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

describe('new tile kinds', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
  })

  test('each new tile is drawn with its own sprite', () => {
    const region = defineMap('river', ['TTTTTTT', 'T,pb,,T', 'T,rHr,T', 'T,wc..T', 'TTTTTTT'], {
      spots: { river: 'river', pond: 'pond', basin: 'waterfall' },
    })
    const size = { w: 195, h: 280 }
    const p = player(tileCentre(1, 1))
    const cam = cameraFor(region, p.pos, size)
    const ctx = new RecordingCtx()
    drawWorld(asCtx(ctx), { ...scene('idle', p, size), map: region, camera: cam }, size)
    const at = (tx: number, ty: number) =>
      ctx.sprites.filter((s) => s.x === tx * 16 - cam.x && s.y === ty * 16 - cam.y).map((s) => s.name)
    expect(at(2, 1)).toContainEqual(expect.stringMatching(/^pond-[01]$/))
    expect(at(3, 1)).toContainEqual(expect.stringMatching(/^basin-[01]$/))
    expect(at(2, 2)).toContainEqual(expect.stringMatching(/^river-[01]$/))
    expect(at(4, 2)).toContainEqual(expect.stringMatching(/^river-[01]$/))
    expect(at(3, 2)).toEqual(expect.arrayContaining(['bridge-plank']))
    expect(at(3, 2)).toContainEqual(expect.stringMatching(/^river-[01]$/)) // 다리 아래 강물
    expect(at(2, 3)).toContainEqual(expect.stringMatching(/^falls-[01]$/))
    expect(at(3, 3)).toEqual(['tile-cliff'])
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

  test('the static map is cached in two canvases once (built over two frames); each frame blits the camera view with one drawImage', () => {
    const size = { w: 195, h: 280 }
    const main = new RecordingCtx()
    const s = scene('idle', player(SPAWN.pos), size)
    drawWorld(asCtx(main), { ...s, tMs: 0 }, size)
    drawWorld(asCtx(main), { ...s, tMs: 100 }, size)
    drawWorld(asCtx(main), { ...s, tMs: 600 }, size)
    drawWorld(asCtx(main), { ...s, tMs: 700 }, size)
    expect(made).toHaveLength(2)
    expect(made.every((c) => c.rects.length > 0 && c.sprites.some((t) => t.name === 'shop'))).toBe(true)
    expect(main.images).toHaveLength(4)
    const [img, sx, sy, sw, sh, dx, dy, dw, dh] = main.images[0]
    expect([sx, sy, sw, sh, dx, dy, dw, dh]).toEqual([s.camera.x, s.camera.y, 195, 280, 0, 0, 195, 280])
    expect((img as HTMLCanvasElement).width).toBe(48 * 16)
    expect((img as HTMLCanvasElement).height).toBe(36 * 16)
    expect(main.images[1][0]).toBe(img)
    expect(main.images[2][0]).not.toBe(img)
    expect(main.images[3][0]).toBe(main.images[2][0])
    // 타일은 캐시에만 그리고 화면에는 그리지 않는다
    expect(main.sprites.some((c) => c.name.startsWith('water-') || c.name === 'shop' || c.name === 'tile-grass')).toBe(false)
    expect(players(main)).toHaveLength(4) // 프레임마다 하나

    // 크기가 바뀌어도 맵 캐시는 그대로
    drawWorld(asCtx(main), scene('idle', player(SPAWN.pos), { w: 320, h: 480 }), { w: 320, h: 480 })
    expect(made).toHaveLength(2)

    releaseSceneCache()
    drawWorld(asCtx(main), s, size)
    drawWorld(asCtx(main), s, size)
    expect(made).toHaveLength(4)
    expect(main.images.at(-1)?.[0]).not.toBe(img)
  })

  test('same map reuses the cache; drawing another map.id drops the old cache and builds a new one', () => {
    const size = { w: 195, h: 280 }
    const main = new RecordingCtx()
    const other = defineMap('river', ['TTTTTT', 'T,,,,T', 'T,,,,T', 'T~~~~T', 'TTTTTT'])
    const inVillage = scene('idle', player(SPAWN.pos), size)
    const inOther = { ...scene('idle', player(tileCentre(2, 1)), size), map: other }

    drawWorld(asCtx(main), inVillage, size)
    drawWorld(asCtx(main), inVillage, size)
    expect(made).toHaveLength(2)
    const villageImg = main.images[0][0] as HTMLCanvasElement

    drawWorld(asCtx(main), inOther, size)
    drawWorld(asCtx(main), inOther, size)
    expect(made).toHaveLength(4)
    const otherImg = main.images.at(-1)?.[0] as HTMLCanvasElement
    expect(otherImg).not.toBe(villageImg)
    expect([otherImg.width, otherImg.height]).toEqual([6 * 16, 5 * 16])

    drawWorld(asCtx(main), inOther, size)
    expect(made).toHaveLength(4)
    expect(main.images.at(-1)?.[0]).toBe(otherImg)

    // 되돌아오면 마을 캐시는 이미 버려졌으므로 새로 만든다
    drawWorld(asCtx(main), inVillage, size)
    drawWorld(asCtx(main), inVillage, size)
    expect(made).toHaveLength(6)
    expect(main.images.at(-1)?.[0]).not.toBe(villageImg)
  })

  test('switching maps builds one frame on the swap draw and the other on the next; drawing never throws between', () => {
    const size = { w: 195, h: 280 }
    const main = new RecordingCtx()
    const other = defineMap('river', ['TTTTTT', 'T,,,,T', 'T,,,,T', 'T~~~~T', 'TTTTTT'])
    const inVillage = scene('idle', player(SPAWN.pos), size)
    const inOther = { ...scene('idle', player(tileCentre(2, 1)), size), map: other }
    drawWorld(asCtx(main), inVillage, size)
    drawWorld(asCtx(main), inVillage, size)
    expect(made).toHaveLength(2)

    // 바꾼 프레임: 한 장만 만들고, 물 모양 1번 때도 그 장으로 그린다
    expect(() => drawWorld(asCtx(main), { ...inOther, tMs: 600 }, size)).not.toThrow()
    expect(made).toHaveLength(3)
    const first = main.images.at(-1)?.[0] as HTMLCanvasElement
    expect([first.width, first.height]).toEqual([6 * 16, 5 * 16])
    // 다음 프레임: 나머지 한 장
    expect(() => drawWorld(asCtx(main), { ...inOther, tMs: 600 }, size)).not.toThrow()
    expect(made).toHaveLength(4)
    expect(main.images.at(-1)?.[0]).not.toBe(first)
    drawWorld(asCtx(main), { ...inOther, tMs: 0 }, size)
    expect(main.images.at(-1)?.[0]).toBe(first)
    expect(made).toHaveLength(4)
  })

  test('replaced or released frames are shrunk to zero size to free canvas memory', () => {
    const size = { w: 195, h: 280 }
    const main = new RecordingCtx()
    const other = defineMap('river', ['TTTTTT', 'T,,,,T', 'T,,,,T', 'T~~~~T', 'TTTTTT'])
    const inVillage = scene('idle', player(SPAWN.pos), size)
    const inOther = { ...scene('idle', player(tileCentre(2, 1)), size), map: other }
    const frames = new Set<HTMLCanvasElement>()
    const spy = vi.spyOn(document, 'createElement')
    drawWorld(asCtx(main), inVillage, size)
    drawWorld(asCtx(main), { ...inVillage, tMs: 600 }, size)
    for (const r of spy.mock.results) if ((r.value as HTMLElement).tagName === 'CANVAS') frames.add(r.value as HTMLCanvasElement)
    expect(frames.size).toBe(2)
    expect([...frames].every((c) => c.width > 0 && c.height > 0)).toBe(true)

    drawWorld(asCtx(main), inOther, size) // 맵 교체
    expect([...frames].every((c) => c.width === 0 && c.height === 0)).toBe(true)

    drawWorld(asCtx(main), inOther, size)
    const second = [...spy.mock.results].map((r) => r.value as HTMLElement).filter((e) => e.tagName === 'CANVAS' && !frames.has(e as HTMLCanvasElement)) as HTMLCanvasElement[]
    expect(second).toHaveLength(2)
    expect(second.every((c) => c.width > 0)).toBe(true)
    releaseSceneCache()
    expect(second.every((c) => c.width === 0 && c.height === 0)).toBe(true)
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
        // 같은 화면의 idle 프레임에도 있는 칸(마을 선착장 배처럼 트랙과 같은 색을 쓰는 월드 그림)은 트랙이 아니다
        const idle = new RecordingCtx()
        drawWorld(asCtx(idle), scene('idle', p, { w, h }, { camera }), { w, h })
        const rectKey = (r: Rect) => `${r.x},${r.y},${r.w},${r.h},${r.color}`
        const world = new Set(idle.rects.map(rectKey))
        const track = ctx.rects.filter((r) => TRACK_COLORS.has(r.color) && !world.has(rectKey(r)))
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

describe('시계·밤·날씨', () => {
  const W = 195
  const H = 280
  const draw = (phase: Phase, p: Player, cond: Conditions, extra: Partial<WorldScene> = {}) => {
    const ctx = new RecordingCtx()
    drawWorld(asCtx(ctx), scene(phase, p, { w: W, h: H }, { cond, ...extra }), { w: W, h: H })
    return ctx
  }
  const idle = player(SPAWN.pos)
  const cover = (c: RecordingCtx) => c.rects.filter((r) => r.x === 0 && r.y === 0 && r.w >= W && r.h >= H && r.color.startsWith('rgba'))
  const SPRING_14_37: Conditions = { gameMinute: 14 * 60 + 37, gameDay: 1, season: 'spring', weather: 'sun' }

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
  })

  const clockSprites = (c: RecordingCtx) =>
    c.sprites.filter((sp) => sp.name.startsWith('digit-') || sp.name.startsWith('season-') || sp.name.startsWith('icon-'))
  const digits = (c: RecordingCtx) => c.sprites.filter((sp) => sp.name.startsWith('digit-')).sort((a, b) => a.x - b.x).map((sp) => sp.name)

  test('fade 0.5면 마지막에 화면 전체 채우기 한 번, 0이면 없다', () => {
    const none = draw('idle', idle, NOON_SUN, { fade: 0 })
    expect(cover(none)).toHaveLength(0)
    const faded = draw('idle', idle, NOON_SUN, { fade: 0.5 })
    const full = cover(faded)
    expect(full).toHaveLength(1)
    expect(full[0].color).toBe('rgba(0, 0, 0, 0.5)')
    // 시계 판(HUD)까지 덮도록 가장 마지막 채우기다
    expect(faded.rects.at(-1)).toBe(full[0])
  })

  test('HUD 시계는 픽셀 숫자·계절 아이콘·날씨 아이콘 스프라이트로 그리고 fillText는 쓰지 않는다', () => {
    const ctx = draw('idle', idle, SPRING_14_37)
    expect(digits(ctx)).toEqual(['digit-1', 'digit-4', 'digit-colon', 'digit-3', 'digit-0'])
    expect(ctx.sprites.some((s) => s.name === 'season-spring')).toBe(true)
    expect(ctx.sprites.some((s) => s.name === 'icon-sun')).toBe(true)
    expect(ctx.texts).toHaveLength(0)
    // 정수 좌표에 찍어야 확대해도 번지지 않는다
    for (const sp of clockSprites(ctx)) {
      expect(Number.isInteger(sp.x), sp.name).toBe(true)
      expect(Number.isInteger(sp.y), sp.name).toBe(true)
    }
  })

  test('계절 아이콘은 계절마다 다르다', () => {
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      const names = draw('idle', idle, { ...SPRING_14_37, season }).sprites.map((s) => s.name).filter((n) => n.startsWith('season-'))
      expect(names).toEqual([`season-${season}`])
    }
  })

  test('시계는 낚시의 모든 단계에서 그려지고, hudTop 아래(안내 줄 밑)에 놓인다', () => {
    for (const phase of PHASES) {
      const ctx = draw(phase, player(PIER_SPOT, 'down'), SPRING_14_37, { hudTop: 22 })
      expect(digits(ctx), phase).toEqual(['digit-1', 'digit-4', 'digit-colon', 'digit-3', 'digit-0'])
      for (const sp of clockSprites(ctx)) expect(sp.y, `${phase} ${sp.name}`).toBeGreaterThanOrEqual(22)
    }
    const top = draw('idle', idle, SPRING_14_37)
    for (const sp of clockSprites(top)) expect(sp.y).toBeLessThan(22)
  })

  test('날씨 아이콘: 비는 icon-rain, 겨울 비는 icon-snow', () => {
    expect(draw('idle', idle, { ...SPRING_14_37, weather: 'rain' }).sprites.some((s) => s.name === 'icon-rain')).toBe(true)
    expect(draw('idle', idle, { ...SPRING_14_37, season: 'winter', weather: 'rain' }).sprites.some((s) => s.name === 'icon-snow')).toBe(true)
  })

  test('밤에는 화면 전체를 덮는 반투명 채우기가 한 번, 정오에는 없다', () => {
    expect(cover(draw('idle', idle, { ...NOON_SUN, gameMinute: 0 }))).toHaveLength(1)
    expect(cover(draw('idle', idle, NOON_SUN))).toHaveLength(0)
  })

  test('비·눈 입자: 있고 80개 이하, 맑으면 없음, 같은 시각이면 같은 자리', () => {
    const count = (c: RecordingCtx) => c.rects.length
    const base = count(draw('idle', idle, NOON_SUN))
    const rain = draw('idle', idle, { ...NOON_SUN, weather: 'rain' })
    const snow = draw('idle', idle, { ...NOON_SUN, season: 'winter', weather: 'rain' })
    for (const c of [rain, snow]) {
      const n = count(c) - base
      expect(n).toBeGreaterThan(0)
      expect(n).toBeLessThanOrEqual(80)
    }
    const again = draw('idle', idle, { ...NOON_SUN, weather: 'rain' })
    expect(again.rects).toEqual(rain.rects)
    const later = draw('idle', idle, { ...NOON_SUN, weather: 'rain' }, { tMs: 1234 + 400 })
    expect(later.rects).not.toEqual(rain.rects)
  })

  test('HUD는 fighting 중 트랙 반대쪽에 그려진다', () => {
    const seen = new Set<string>()
    for (const pos of [tileCentre(2, 24), tileCentre(MAP_W - 3, 24), PIER_SPOT, SPAWN.pos]) {
      const p = player(pos)
      const s = scene('fighting', p, { w: W, h: H })
      const ctx = new RecordingCtx()
      drawWorld(asCtx(ctx), s, { w: W, h: H })
      const side = hudSide(p.pos.x - s.camera.x, W)
      seen.add(side)
      const icon = ctx.sprites.find((sp) => sp.name === 'icon-sun')!
      // 트랙이 오른쪽이면 시계는 왼쪽 절반, 트랙이 왼쪽이면 오른쪽 절반
      if (side === 'right') expect(icon.x).toBeLessThan(W / 2)
      else expect(icon.x).toBeGreaterThan(W / 2)
    }
    expect(seen.size).toBe(2)
  })
})

describe('hudLayout', () => {
  const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  const inside = (a: Box, w: number, h: number) => a.x >= 0 && a.y >= 0 && a.x + a.w <= w && a.y + a.h <= h

  test('시계 판은 낚시 트랙(외곽선 포함)과 겹치지 않고 캔버스 안에 있다 (160×240, 320×480)', () => {
    for (const [w, h] of [[160, 240], [195, 280], [320, 480]]) {
      // hudTop: 데스크톱 0, 터치 배율 4·2·1 (안내 줄 44 CSS px)
      for (const hudTop of [0, 11, 22, 44]) {
        for (const screenX of [8, w / 2 - 1, w / 2, w - 8]) {
          const { track, clock } = hudLayout(screenX, w, h, hudTop)
          const at = `${w}×${h} top ${hudTop} x ${screenX}`
          expect(overlaps(track, clock), at).toBe(false)
          expect(inside(track, w, h), at).toBe(true)
          expect(inside(clock, w, h), at).toBe(true)
          expect(clock.y, at).toBeGreaterThanOrEqual(hudTop)
        }
      }
    }
  })

  test('그려진 트랙과 시계가 hudLayout 상자 안에 있다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const [w, h] = [160, 240]
    for (const pos of [tileCentre(2, 24), tileCentre(MAP_W - 3, 24)]) {
      const p = player(pos)
      const s = scene('fighting', p, { w, h }, { hudTop: 44 })
      const ctx = new RecordingCtx()
      drawWorld(asCtx(ctx), s, { w, h })
      const { track, clock } = hudLayout(p.pos.x - s.camera.x, w, h, 44)
      const fish = ctx.sprites.find((sp) => sp.name === 'track-fish')!
      expect(fish.x).toBeGreaterThanOrEqual(track.x)
      expect(fish.x).toBeLessThan(track.x + track.w)
      for (const sp of ctx.sprites.filter((x) => x.name.startsWith('digit-') || x.name.startsWith('season-'))) {
        expect(sp.x).toBeGreaterThanOrEqual(clock.x)
        expect(sp.x).toBeLessThan(clock.x + clock.w)
        expect(sp.y).toBeGreaterThanOrEqual(clock.y)
        expect(sp.y).toBeLessThan(clock.y + clock.h)
      }
      // 트랙 틀의 외곽선은 상자 왼쪽 끝에서, 진행 게이지의 외곽선은 상자 오른쪽 끝에서 끝난다
      const frames = ctx.rects.filter((r) => r.y === track.y && r.h === track.h)
      expect(frames.some((r) => r.x === track.x)).toBe(true)
      expect(frames.some((r) => r.x + r.w === track.x + track.w)).toBe(true)
    }
  })
})

describe('문·선착장·실내', () => {
  // (4,2) 다리 = 호수 문(무너진 다리), (8,1) 돌무더기 문, 배는 (5,5)
  const GATED = defineMap('river', [
    'TTTTTTTTTT',
    'T,,,,,,,,T',
    'TrrrHrrrrT',
    'T,,,,,...T',
    'T,,,,,.#.T',
    'T~~~~~~#~T',
    'T~~~~~~#~T',
    'T~~~~~~~~T',
    'TTTTTTTTTT',
  ], {
    gates: [
      { area: 'lake', tiles: { tx: 4, ty: 2, w: 1, h: 1 }, look: 'broken-bridge', front: { tx: 4, ty: 3, facing: 'up' } },
      { area: 'cave', tiles: { tx: 8, ty: 1, w: 1, h: 1 }, look: 'rubble', front: { tx: 7, ty: 1, facing: 'right' } },
    ],
    docks: [{ front: { tx: 7, ty: 5, facing: 'left' }, target: 'island', entry: { tx: 2, ty: 2, facing: 'down' }, boat: { tx: 5, ty: 5 } }],
  })
  const BASE: Opened = new Set<AreaId>(DEFAULT_AREAS)
  const ALL: Opened = new Set<AreaId>([...DEFAULT_AREAS, 'lake', 'cave', 'island'])
  const size = { w: 195, h: 280 }
  const p = player(tileCentre(4, 3))
  const cam = cameraFor(GATED, p.pos, size)
  const gatedScene = (opened: Opened, extra: Partial<WorldScene> = {}): WorldScene => ({ ...scene('idle', p, size), map: GATED, camera: cam, opened, ...extra })
  const at = (c: RecordingCtx, name: string) => c.sprites.filter((s) => s.name === name)

  describe('with an offscreen canvas', () => {
    let made: RecordingCtx[]
    beforeEach(() => {
      made = []
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
        const c = new RecordingCtx()
        made.push(c)
        return c as unknown as RenderingContext
      })
    })

    test('잠긴 문 칸에 look 스프라이트, 열리면 안 그린다 — 캐시는 다시 만들지 않는다', () => {
      const main = new RecordingCtx()
      drawWorld(asCtx(main), gatedScene(BASE), size)
      drawWorld(asCtx(main), gatedScene(BASE), size)
      expect(made).toHaveLength(2)
      // 문 그림은 캐시가 아니라 매 프레임 화면에
      expect(made.some((c) => c.sprites.some((s) => s.name.startsWith('gate-')))).toBe(false)
      const locked = new RecordingCtx()
      drawWorld(asCtx(locked), gatedScene(BASE), size)
      expect(at(locked, 'gate-broken-bridge').map((s) => [s.x, s.y])).toEqual([[4 * TILE - cam.x, 2 * TILE - cam.y]])
      expect(at(locked, 'gate-rubble').map((s) => [s.x, s.y])).toEqual([[8 * TILE - cam.x, 1 * TILE - cam.y]])
      // 캐릭터보다 아래(먼저) 그린다
      const playerAt = players(locked)[0].at
      for (const g of at(locked, 'gate-broken-bridge')) expect(g.at).toBeLessThan(playerAt)

      const lakeOpen = new RecordingCtx()
      drawWorld(asCtx(lakeOpen), gatedScene(new Set<AreaId>([...DEFAULT_AREAS, 'lake'])), size)
      expect(at(lakeOpen, 'gate-broken-bridge')).toHaveLength(0)
      expect(at(lakeOpen, 'gate-rubble')).toHaveLength(1)
      const opened = new RecordingCtx()
      drawWorld(asCtx(opened), gatedScene(ALL), size)
      expect(opened.sprites.some((s) => s.name.startsWith('gate-'))).toBe(false)
      expect(made).toHaveLength(2) // renderFrame 호출 수 불변
    })

    test('선착장의 배는 boat 칸에 월드 레이어로, 열림과 무관하게 그린다', () => {
      for (const opened of [BASE, ALL]) {
        const main = new RecordingCtx()
        drawWorld(asCtx(main), gatedScene(opened), size)
        const boats = at(main, 'boat')
        expect(boats).toHaveLength(1)
        expect(boats[0].x).toBe(5 * TILE - cam.x)
        expect(boats[0].y - (5 * TILE - cam.y)).toBeGreaterThanOrEqual(0)
        expect(boats[0].y - (5 * TILE - cam.y)).toBeLessThanOrEqual(1) // 물결에 1px 흔들림
        expect(boats[0].at).toBeLessThan(players(main)[0].at)
      }
      expect(made.some((c) => c.sprites.some((s) => s.name === 'boat'))).toBe(false)
    })
  })

  test('indoor 맵은 비 오는 밤에도 입자·밤 색조 없음, HUD 시계는 있다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const RAINY_NIGHT: Conditions = { gameMinute: 0, gameDay: 1, season: 'spring', weather: 'rain' }
    const cave = defineMap('cave', GATED.rows, { indoor: true })
    const outside = defineMap('river', GATED.rows)
    const draw = (map: typeof cave) => {
      const ctx = new RecordingCtx()
      drawWorld(asCtx(ctx), { ...gatedScene(BASE), map, cond: RAINY_NIGHT }, size)
      return ctx
    }
    const cover = (c: RecordingCtx) => c.rects.filter((r) => r.x === 0 && r.y === 0 && r.w >= size.w && r.h >= size.h && r.color.startsWith('rgba'))
    const drops = (c: RecordingCtx) => c.rects.filter((r) => r.color === '#bfe6f7' && r.w === 1 && r.h === 3)
    const out = draw(outside)
    expect(cover(out)).toHaveLength(1)
    expect(drops(out).length).toBeGreaterThan(0)
    const inside = draw(cave)
    expect(cover(inside)).toHaveLength(0)
    expect(drops(inside)).toHaveLength(0)
    expect(inside.sprites.some((s) => s.name === 'icon-rain')).toBe(true)
    expect(inside.sprites.some((s) => s.name.startsWith('digit-'))).toBe(true)
    // 겨울 눈도 없다
    const snowy = new RecordingCtx()
    drawWorld(asCtx(snowy), { ...gatedScene(BASE), map: cave, cond: { ...RAINY_NIGHT, season: 'winter' } }, size)
    expect(snowy.rects.filter((r) => r.color === '#ffffff' && r.w === 2 && r.h === 2)).toHaveLength(0)
  })
})

describe('산 호수·동굴·섬 타일', () => {
  const PALM_LEAF = '#3fa65f'
  const PALM_TRUNK = '#b08850'
  const GRASS = '#78b85c'
  const SAND_WET = '#c7a96e'
  const FOAM = '#e9f6fb'
  const size = { w: 195, h: 280 }
  /** 화면 좌표 사각형이 칸 (tx, ty) 안에 있는가 */
  const inTile = (r: { x: number; y: number }, cam: Vec, tx: number, ty: number) =>
    r.x >= tx * 16 - cam.x && r.x < (tx + 1) * 16 - cam.x && r.y >= ty * 16 - cam.y && r.y < (ty + 1) * 16 - cam.y

  // 0 WWWWWWWWW
  // 1 W_uqLE__W   동굴 바닥·웅덩이·수정·용암·입구
  // 2 Wkl~K..P.   호수·석호·바다·선착장·모래·야자수
  // 3 .........
  const MIXED = defineMap('cave', ['WWWWWWWWW', 'W_uqLE__W', 'Wkl~K..P.', '.........'], {
    spots: { 'cave-pool': 'cave1', crystal: 'cave2', lava: 'cave3', lake: 'lake', lagoon: 'lagoon', water: 'sea' },
  })

  describe('direct drawing', () => {
    beforeEach(() => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    })
    const draw = () => {
      const p = player(tileCentre(1, 1))
      const cam = cameraFor(MIXED, p.pos, size)
      const ctx = new RecordingCtx()
      drawWorld(asCtx(ctx), { ...scene('idle', p, size), map: MIXED, camera: cam }, size)
      const at = (tx: number, ty: number) => ctx.sprites.filter((s) => s.x === tx * 16 - cam.x && s.y === ty * 16 - cam.y).map((s) => s.name)
      const rectsIn = (tx: number, ty: number) => ctx.rects.filter((r) => inTile(r, cam, tx, ty))
      return { at, rectsIn }
    }

    test('각 칸을 자기 스프라이트로 그린다', () => {
      const { at, rectsIn } = draw()
      expect(at(0, 0)).toEqual(['tile-cave-wall'])
      expect(at(1, 1)).toEqual(['tile-cave-floor'])
      expect(at(2, 1)).toEqual([expect.stringMatching(/^cave-pool-[01]$/)])
      expect(at(3, 1)).toEqual([expect.stringMatching(/^crystal-[01]$/)])
      expect(at(4, 1)).toEqual([expect.stringMatching(/^lava-[01]$/)])
      expect(at(5, 1)).toEqual(['tile-cave-mouth'])
      expect(at(1, 2)).toEqual([expect.stringMatching(/^lake-[01]$/)])
      expect(at(2, 2)).toEqual([expect.stringMatching(/^lagoon-[01]$/)])
      expect(at(3, 2)).toEqual([expect.stringMatching(/^water-[01]$/)])
      // 선착장: 아래 바다 + 판자
      expect(at(4, 2)).toEqual([expect.stringMatching(/^water-[01]$/), 'dock-plank'])
      // 야자수는 모래 위에 밑동, 잎은 윗칸
      expect(at(7, 2)).toEqual(['tile-sand'])
      expect(rectsIn(7, 2).some((r) => r.color === PALM_TRUNK)).toBe(true)
      expect(rectsIn(7, 1).some((r) => r.color === PALM_LEAF)).toBe(true)
    })

    test('물가 규칙: 석호는 모래에 거품, 동굴 바닥 옆 물은 거품 없음. 동굴 바닥·입구 옆 모래에 풀 가장자리 없음', () => {
      const { rectsIn } = draw()
      // 석호(2,2) 아래가 모래 → 젖은 모래와 거품
      expect(rectsIn(2, 2).some((r) => r.color === SAND_WET)).toBe(true)
      expect(rectsIn(2, 2).some((r) => r.color === FOAM)).toBe(true)
      // 동굴 웅덩이(2,1)·수정(3,1)은 둘레(대각선 포함)에 모래가 없어 거품·젖은 모래 없음. 용암(4,1)은 (5,2) 모래와 대각선이라 뺀다
      for (const [tx, ty] of [[2, 1], [3, 1]]) {
        expect(rectsIn(tx, ty).some((r) => r.color === SAND_WET || r.color === FOAM), `${tx},${ty}`).toBe(false)
      }
      // 입구(5,1)·바닥(6,1) 아래 모래(5,2)·(6,2)는 풀 가장자리를 받지 않는다
      for (const tx of [5, 6]) expect(rectsIn(tx, 2).some((r) => r.color === GRASS), `${tx},2`).toBe(false)
    })
  })

  test('야자수 윗부분: 캐릭터가 밑동보다 위 줄이면 앞에, 아래 줄이면 뒤에 그린다(나무와 같은 규칙)', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new RecordingCtx() as unknown as RenderingContext)
    // (2,3)은 야자수, 잎은 (2,2) 칸
    const beach = defineMap('island', ['.....', '.....', '.....', '..P..', '.....', '.....'])
    const leaves = (c: RecordingCtx, cam: Vec) =>
      c.rects.map((r, i) => ({ r, i })).filter(({ r }) => r.color === PALM_LEAF && inTile(r, cam, 2, 2))

    const above = { ...scene('idle', player(tileCentre(2, 2), 'down'), size), map: beach }
    above.camera = cameraFor(beach, above.player.pos, size)
    const a = new RecordingCtx()
    drawWorld(asCtx(a), above, size)
    const la = leaves(a, above.camera)
    expect(la.length).toBeGreaterThan(0)
    expect(la.every(({ i }) => i >= players(a)[0].at)).toBe(true)

    const below = { ...scene('idle', player(tileCentre(2, 4), 'up'), size), map: beach }
    below.camera = cameraFor(beach, below.player.pos, size)
    const b = new RecordingCtx()
    drawWorld(asCtx(b), below, size)
    const lb = leaves(b, below.camera)
    expect(lb.length).toBeGreaterThan(0)
    expect(lb.every(({ i }) => i < players(b)[0].at)).toBe(true)
  })
})

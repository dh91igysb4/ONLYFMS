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
    teleporterOn: false,
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

describe('물 속 바위', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
  })
  // 가운데(2,2) 바위를 그 물로 둘러싼다. 아래 두 줄은 걸을 땅
  const pool = (ch: string) => [',,,,,', `,${ch}${ch}${ch},`, `,${ch}o${ch},`, `,${ch}${ch}${ch},`, ',,,,,']
  const cases: [string, string, string][] = [
    ['r', 'river', 'river'],
    ['p', 'pond', 'pond'],
    ['k', 'lake', 'lake'],
    ['l', 'lagoon', 'lagoon'],
    ['L', 'lava', 'lava'],
    ['u', 'cave-pool', 'cave-pool'],
    ['~', 'water', 'water'],
    ['g', 'creek', 'creek'],
    ['z', 'marsh', 'marsh'],
    ['Q', 'bog', 'bog'],
  ]
  test.each(cases)('%s 물 속 바위는 그 물(%s) 위에 그린다', (ch, sprite) => {
    const m = defineMap('river', pool(ch))
    const size = { w: 195, h: 280 }
    const p = player(tileCentre(0, 0))
    const cam = cameraFor(m, p.pos, size)
    const ctx = new RecordingCtx()
    drawWorld(asCtx(ctx), { ...scene('idle', p, size), map: m, camera: cam }, size)
    const at = ctx.sprites.filter((c) => c.x === 2 * 16 - cam.x && c.y === 2 * 16 - cam.y).map((c) => c.name)
    expect(at).toContainEqual(expect.stringMatching(new RegExp(`^${sprite}-[01]$`)))
    if (sprite !== 'water') expect(at.some((n) => /^water-[01]$/.test(n))).toBe(false)
    // 바위는 물 위 작은 바위 그림
    expect(ctx.sprites.some((c) => c.name === 'rock')).toBe(true)
  })
  test('물 종류가 섞이면 이웃(상하좌우)에 가장 많은 물', () => {
    const m = defineMap('river', [',,,,,', ',rrr,', ',~or,', ',rrr,', ',,,,,'])
    const size = { w: 195, h: 280 }
    const p = player(tileCentre(0, 0))
    const cam = cameraFor(m, p.pos, size)
    const ctx = new RecordingCtx()
    drawWorld(asCtx(ctx), { ...scene('idle', p, size), map: m, camera: cam }, size)
    const at = ctx.sprites.filter((c) => c.x === 2 * 16 - cam.x && c.y === 2 * 16 - cam.y).map((c) => c.name)
    expect(at).toContainEqual(expect.stringMatching(/^river-[01]$/))
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

describe('순간이동기', () => {
  // 3×? 풀밭, 이동기 칸 (3,3)~(4,4), 도착 자리 (3,5)
  const FIELD = defineMap('river', [
    'TTTTTTTTT',
    'T,,,,,,,T',
    'T,,,,,,,T',
    'T,,,,,,,T',
    'T,,,,,,,T',
    'T,,,,,,,T',
    'T,,,,,,,T',
    'TTTTTTTTT',
  ], { teleporter: { tiles: { tx: 3, ty: 3, w: 2, h: 2 }, front: { tx: 3, ty: 5, facing: 'down' } } })
  const size = { w: 160, h: 240 }
  const fieldScene = (p: Player, extra: Partial<WorldScene> = {}): WorldScene =>
    ({ ...scene('idle', p, size), map: FIELD, camera: cameraFor(FIELD, p.pos, size), ...extra })
  const named = (c: RecordingCtx, name: string) => c.sprites.filter((s) => s.name === name)

  test('이동기는 칸 왼쪽 위에서 한 칸 위(탑 끝)부터 한 번 그리고, 꺼져 있으면 불빛이 없다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new RecordingCtx() as unknown as RenderingContext)
    const sc = fieldScene(player(tileCentre(3, 5), 'up'))
    const c = new RecordingCtx()
    drawWorld(asCtx(c), sc, size)
    expect(named(c, 'teleporter').map((s) => [s.x, s.y])).toEqual([[3 * TILE - sc.camera.x, 2 * TILE - sc.camera.y]])
    expect(c.sprites.some((s) => s.name.startsWith('teleporter-glow'))).toBe(false)
  })

  test('켜져 있으면 같은 자리에 불빛이 두 장 번갈아(물 박자) 얹힌다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new RecordingCtx() as unknown as RenderingContext)
    const glows = new Set<string>()
    for (const tMs of [0, 500]) {
      const sc = fieldScene(player(tileCentre(3, 5), 'up'), { teleporterOn: true, tMs })
      const c = new RecordingCtx()
      drawWorld(asCtx(c), sc, size)
      const g = c.sprites.filter((s) => s.name.startsWith('teleporter-glow'))
      expect(g).toHaveLength(1)
      expect([g[0].x, g[0].y]).toEqual([3 * TILE - sc.camera.x, 2 * TILE - sc.camera.y])
      expect(g[0].at).toBeGreaterThanOrEqual(named(c, 'teleporter')[0].at)
      glows.add(g[0].name)
    }
    expect([...glows].sort()).toEqual(['teleporter-glow-0', 'teleporter-glow-1'])
  })

  test('정적 캐시에는 넣지 않는다: 켜짐을 바꿔도 캐시를 다시 만들지 않는다', () => {
    const made: RecordingCtx[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const c = new RecordingCtx()
      made.push(c)
      return c as unknown as RenderingContext
    })
    const p = player(tileCentre(3, 5), 'up')
    for (const on of [false, false, true, false]) drawWorld(asCtx(new RecordingCtx()), fieldScene(p, { teleporterOn: on }), size)
    expect(made).toHaveLength(2)
    expect(made.some((c) => c.sprites.some((s) => s.name.startsWith('teleporter')))).toBe(false)
  })

  test('캐릭터가 이동기 위 줄(뒤)에 서면 탑이 나중에, 도착 자리(앞)에 서면 먼저 그려진다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new RecordingCtx() as unknown as RenderingContext)
    const behind = new RecordingCtx()
    drawWorld(asCtx(behind), fieldScene(player(tileCentre(3, 2), 'down')), size)
    expect(named(behind, 'teleporter')[0].at).toBeGreaterThan(players(behind)[0].at)
    const side = new RecordingCtx()
    drawWorld(asCtx(side), fieldScene(player(tileCentre(5, 4), 'left')), size)
    expect(named(side, 'teleporter')[0].at).toBeGreaterThan(players(side)[0].at)
    const front = new RecordingCtx()
    drawWorld(asCtx(front), fieldScene(player(tileCentre(3, 5), 'up')), size)
    expect(named(front, 'teleporter')[0].at).toBeLessThan(players(front)[0].at)
  })

  test('이동기가 화면 밖이면 그리지 않는다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new RecordingCtx() as unknown as RenderingContext)
    const sc = fieldScene(player(tileCentre(3, 5), 'up'), { camera: { x: 9 * TILE, y: 0 } })
    const c = new RecordingCtx()
    drawWorld(asCtx(c), sc, size)
    expect(named(c, 'teleporter')).toHaveLength(0)
  })

  test('이동기 바로 아래 칸의 나무 윗부분은 (둘 다 캐릭터 앞일 때) 탑보다 나중에 그린다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new RecordingCtx() as unknown as RenderingContext)
    // 이동기 (3,3)~(4,4), 그 아래 (3,5)에 나무. 캐릭터는 둘보다 위(1,1)
    const map = defineMap('river', [
      'TTTTTTTTT',
      'T,,,,,,,T',
      'T,,,,,,,T',
      'T,,,,,,,T',
      'T,,,,,,,T',
      'T,,T,,,,T',
      'T,,,,,,,T',
      'TTTTTTTTT',
    ], { teleporter: { tiles: { tx: 3, ty: 3, w: 2, h: 2 }, front: { tx: 5, ty: 4, facing: 'right' } } })
    const p = player(tileCentre(1, 1), 'down')
    const sc: WorldScene = { ...scene('idle', p, size), map, camera: cameraFor(map, p.pos, size) }
    const c = new RecordingCtx()
    drawWorld(asCtx(c), sc, size)
    const tpAt = named(c, 'teleporter')[0].at
    const tpColors = new Set(Object.values(realSprites.SPRITES.teleporter.palette))
    const treeOnly = Object.values(realSprites.SPRITES['tile-tree'].palette).filter((col) => !tpColors.has(col))
    const x0 = 3 * TILE - sc.camera.x
    const y0 = 4 * TILE - sc.camera.y
    const leavesAfter = c.rects.filter((r, i) => i >= tpAt && treeOnly.includes(r.color) && r.x >= x0 && r.x < x0 + TILE && r.y >= y0 && r.y < y0 + TILE)
    expect(tpAt).toBeGreaterThan(players(c)[0].at)
    expect(leavesAfter.length).toBeGreaterThan(0)
  })
})

describe('옷 입은 캐릭터', () => {
  test('outfit이 있으면 옷 색으로 그리고, 없으면 원래 그림', () => {
    const size = { w: 160, h: 240 }
    const p = player(SPAWN.pos)
    const plain = new RecordingCtx()
    drawWorld(asCtx(plain), scene('idle', p, size), size)
    const straw = new RecordingCtx()
    drawWorld(asCtx(straw), scene('idle', p, size, { outfit: { hat: 'straw', top: 'kit-red', bottom: 'jeans', hair: 'short', hairColor: 'brown', rodSkin: 'gold' } }), size)
    const colors = (c: RecordingCtx) => new Set(c.rects.map((r) => r.color.toLowerCase()))
    expect(colors(straw).has('#e8c36a')).toBe(true) // 밀짚
    expect(colors(straw).has('#d3262c')).toBe(true) // 빨간 유니폼
    expect(colors(plain).has('#e8c36a')).toBe(false)
    expect(colors(plain).has('#eaa53c')).toBe(true) // 원래 바람막이
  })
})

describe('신화 용솟음(surge) 트랙', () => {
  const W = 195, H = 280
  const p = player(tileCentre(10, 10))
  const frameOf = (ctx: RecordingCtx, box: Box) => ctx.rects.filter((r) => r.x === box.x && r.y === box.y && r.w === 20 && r.h === box.h)
  const draw = (tMs: number, barT: number, behavior: BarParams['behavior']) => {
    const ctx = new RecordingCtx()
    const s = scene('fighting', p, { w: W, h: H }, { tMs, bar: { ...bar, t: barT }, barParams: { ...barParams, behavior } })
    drawWorld(asCtx(ctx), s, { w: W, h: H })
    const box = hudLayout(Math.round(p.pos.x) - Math.round(s.camera.x), W, H, 0).track
    return { ctx, box }
  }
  test('용솟음 단계 동안 트랙 테두리 색이 번갈아 바뀌고, 고요·다른 유형은 늘 외곽선 색', () => {
    const colors = (barT: number, behavior: BarParams['behavior']) =>
      new Set([0, 120, 240, 360].map((t) => { const { ctx, box } = draw(t, barT, behavior); return frameOf(ctx, box)[0]?.color }))
    expect(colors(2000, 'surge').size).toBe(2)
    expect(colors(100, 'surge').size).toBe(1)
    expect(colors(2000, 'dart').size).toBe(1)
  })
  test('용솟음 동안 바는 줄어든 크기(effectiveBarSize)로 그린다', () => {
    const barRects = (barT: number) => { const { ctx } = draw(0, barT, 'surge'); return ctx.rects.filter((r) => r.color === '#6fdc7e') }
    const calm = barRects(100)[0].h
    const surge = barRects(2000)[0].h
    expect(surge).toBeLessThan(calm)
    expect(surge / calm).toBeCloseTo(0.21 / 0.3, 1)
  })
})

// ---------------------------------------------------------------- 낚시 5부 M1: 물때·구멍·안개·늘 눈·신화 빛고리
describe('움직이는 맵 장면', () => {
  const W = 195, H = 280
  const FLAT = defineMap('village', ['..........', '.mmmmmmmm.', '.mmmrrmmm.', '.mmmmmmmm.', '~~~~~~~~~~', '~~~~~~~~~~'], {
    tidal: true, spots: { water: 'shore', mud: 'shore', river: 'creek' },
  })
  const ICE = defineMap('village', [',,,,,,,,', ',iiiiii,', ',iiiiii,', ',,,,,,,,'], { snowy: true, spots: { hole: 'ice' } })
  const SWAMP = defineMap('village', Array.from({ length: 30 }, () => ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,'), { fog: true })
  const dyn = (tide: 'low' | 'high', ...holes: string[]) => ({ tide, holes: new Set(holes) })
  const at = (map: typeof FLAT, tx: number, ty: number, extra: Partial<WorldScene> = {}) => {
    const p = player(tileCentre(tx, ty))
    return { ...scene('idle', p, { w: W, h: H }), map, camera: cameraFor(map, p.pos, { w: W, h: H }), ...extra }
  }

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
    test('물때 맵: 물때가 바뀌면 캐시를 다시 만들고, 같은 물때면 그대로; 물때 없는 맵은 물때와 무관', () => {
      const main = new RecordingCtx()
      const high = at(FLAT, 0, 0, { dyn: dyn('high') })
      drawWorld(asCtx(main), high, { w: W, h: H })
      drawWorld(asCtx(main), high, { w: W, h: H })
      expect(made).toHaveLength(2)
      drawWorld(asCtx(main), high, { w: W, h: H })
      expect(made).toHaveLength(2)
      const low = at(FLAT, 0, 0, { dyn: dyn('low') })
      drawWorld(asCtx(main), low, { w: W, h: H })
      expect(made).toHaveLength(3)
      expect(made[2].sprites.some((s) => s.name === 'tile-mud')).toBe(true)
      expect(made[0].sprites.some((s) => s.name.startsWith('tile-mud-wet-'))).toBe(true)
      const village = scene('idle', player(SPAWN.pos), { w: W, h: H })
      drawWorld(asCtx(main), { ...village, dyn: dyn('high') }, { w: W, h: H })
      drawWorld(asCtx(main), { ...village, dyn: dyn('high') }, { w: W, h: H })
      const n = made.length
      drawWorld(asCtx(main), { ...village, dyn: dyn('low') }, { w: W, h: H })
      expect(made).toHaveLength(n)
    })
    test('구멍은 화면(월드 레이어)에 그리고 캐시는 다시 만들지 않는다', () => {
      const main = new RecordingCtx()
      drawWorld(asCtx(main), at(ICE, 0, 1, { dyn: dyn('high') }), { w: W, h: H })
      drawWorld(asCtx(main), at(ICE, 0, 1, { dyn: dyn('high') }), { w: W, h: H })
      const n = made.length
      const withHoles = new RecordingCtx()
      drawWorld(asCtx(withHoles), at(ICE, 0, 1, { dyn: dyn('high', '2,1', '4,2') }), { w: W, h: H })
      expect(made).toHaveLength(n)
      const holes = withHoles.sprites.filter((s) => s.name.startsWith('tile-hole-'))
      expect(holes.map((h) => [h.x, h.y]).sort()).toEqual([[2 * TILE - (at(ICE, 0, 1).camera.x), TILE - at(ICE, 0, 1).camera.y], [4 * TILE - at(ICE, 0, 1).camera.x, 2 * TILE - at(ICE, 0, 1).camera.y]].sort())
      expect(made.at(-1)!.sprites.some((s) => s.name === 'tile-ice')).toBe(true)
    })
    test('안개 비네트는 화면 크기마다 한 번 만들고 drawImage 한 번으로 얹는다', () => {
      const main = new RecordingCtx()
      const s = at(SWAMP, 10, 10, { dyn: dyn('high') })
      drawWorld(asCtx(main), s, { w: W, h: H })
      drawWorld(asCtx(main), s, { w: W, h: H })
      const n = made.length
      drawWorld(asCtx(main), s, { w: W, h: H })
      expect(made).toHaveLength(n)
      const before = main.images.length
      drawWorld(asCtx(main), s, { w: W, h: H })
      expect(main.images.length - before).toBe(2) // 맵 한 번 + 안개 한 번
      releaseSceneCache()
    })
  })

  describe('direct drawing', () => {
    beforeEach(() => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    })
    const fogRects = (c: RecordingCtx) => c.rects.filter((r) => r.color.startsWith('rgba(24, 32, 30,'))
    const alphaOf = (r: Rect) => Number(r.color.split(',')[3].replace(')', ''))
    const fogAt = (c: RecordingCtx, x: number, y: number) =>
      fogRects(c).filter((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h).reduce((a, r) => Math.max(a, alphaOf(r)), 0)
    test('진흙: 밀물이면 흙탕물 그림, 썰물이면 진흙 그림', () => {
      const hi = new RecordingCtx()
      drawWorld(asCtx(hi), at(FLAT, 0, 0, { dyn: dyn('high') }), { w: W, h: H })
      expect(hi.sprites.some((s) => s.name.startsWith('tile-mud-wet-'))).toBe(true)
      expect(hi.sprites.some((s) => s.name === 'tile-mud')).toBe(false)
      const lo = new RecordingCtx()
      drawWorld(asCtx(lo), at(FLAT, 0, 0, { dyn: dyn('low') }), { w: W, h: H })
      expect(lo.sprites.some((s) => s.name === 'tile-mud')).toBe(true)
      expect(lo.sprites.some((s) => s.name.startsWith('tile-mud-wet-'))).toBe(false)
    })
    test('물때 맵만 HUD에 물때 아이콘', () => {
      const lo = new RecordingCtx()
      drawWorld(asCtx(lo), at(FLAT, 0, 0, { dyn: dyn('low') }), { w: W, h: H })
      expect(lo.sprites.some((s) => s.name === 'icon-tide-low')).toBe(true)
      const hi = new RecordingCtx()
      drawWorld(asCtx(hi), at(FLAT, 0, 0, { dyn: dyn('high') }), { w: W, h: H })
      expect(hi.sprites.some((s) => s.name === 'icon-tide-high')).toBe(true)
      const v = new RecordingCtx()
      drawWorld(asCtx(v), scene('idle', player(SPAWN.pos), { w: W, h: H }), { w: W, h: H })
      expect(v.sprites.some((s) => s.name.startsWith('icon-tide-'))).toBe(false)
    })
    test('안개: 캐릭터 둘레는 옅고 모서리는 짙다; 안개 없는 맵은 없다; 비 오는 밤이 맑은 낮보다 짙다', () => {
      const s = at(SWAMP, 15, 15)
      const px = Math.round(s.player.pos.x) - s.camera.x
      const py = Math.round(s.player.pos.y) - s.camera.y
      const day = new RecordingCtx()
      drawWorld(asCtx(day), s, { w: W, h: H })
      expect(fogAt(day, px, py - 8)).toBeLessThan(fogAt(day, 1, 1))
      expect(fogAt(day, 1, 1)).toBeGreaterThan(0.3)
      const night = new RecordingCtx()
      drawWorld(asCtx(night), { ...s, cond: { ...NOON_SUN, gameMinute: 23 * 60, weather: 'rain' } }, { w: W, h: H })
      expect(fogAt(night, 1, 1)).toBeGreaterThan(fogAt(day, 1, 1))
      expect(fogAt(night, 1, 1)).toBeLessThanOrEqual(0.75)
      const v = new RecordingCtx()
      drawWorld(asCtx(v), scene('idle', player(SPAWN.pos), { w: W, h: H }), { w: W, h: H })
      expect(fogRects(v)).toHaveLength(0)
    })
    test('늘 눈 맵: 여름 비도 눈(입자·HUD 아이콘)', () => {
      const c = new RecordingCtx()
      drawWorld(asCtx(c), at(ICE, 0, 1, { cond: { ...NOON_SUN, season: 'summer', weather: 'rain' } }), { w: W, h: H })
      expect(c.sprites.some((s) => s.name === 'icon-snow')).toBe(true)
      expect(c.rects.filter((r) => r.color === '#ffffff' && r.w === 2 && r.h === 2).length).toBeGreaterThan(10)
      const v = new RecordingCtx()
      drawWorld(asCtx(v), scene('idle', player(SPAWN.pos), { w: W, h: H }, { cond: { ...NOON_SUN, season: 'summer', weather: 'rain' } }), { w: W, h: H })
      expect(v.sprites.some((s) => s.name === 'icon-rain')).toBe(true)
    })
    test('구멍 뚫기: 진행에 따라 금 그림 단계가 바뀐다', () => {
      const stage = (ms: number) => {
        const c = new RecordingCtx()
        drawWorld(asCtx(c), at(ICE, 0, 1, { drill: { tx: 1, ty: 1, ms } }), { w: W, h: H })
        return c.sprites.filter((s) => s.name.startsWith('drill-')).map((s) => s.name)
      }
      expect(stage(100)).toEqual(['drill-0'])
      expect(stage(600)).toEqual(['drill-1'])
      expect(stage(1100)).toEqual(['drill-2'])
      const none = new RecordingCtx()
      drawWorld(asCtx(none), at(ICE, 0, 1), { w: W, h: H })
      expect(none.sprites.some((s) => s.name.startsWith('drill-'))).toBe(false)
    })
    test('신화 빛고리: 잡은 뒤 1.5초 동안 캐릭터 둘레에, 그 뒤·없으면 안 그린다', () => {
      const ring = (ms: number | null) => {
        const c = new RecordingCtx()
        drawWorld(asCtx(c), scene('caught', player(SPAWN.pos), { w: W, h: H }, { mythicFlashMs: ms }), { w: W, h: H })
        return c.rects.filter((r) => r.color === '#fff1a8' || r.color === '#ffc94a').length
      }
      expect(ring(300)).toBeGreaterThan(10)
      expect(ring(null)).toBe(0)
      expect(ring(1600)).toBe(0)
    })
  })
})

describe('낚시 5부 M2 타일: 갯벌·늪지', () => {
  const size = { w: 195, h: 280 }
  const inTile = (r: { x: number; y: number }, cam: Vec, tx: number, ty: number) =>
    r.x >= tx * 16 - cam.x && r.x < (tx + 1) * 16 - cam.x && r.y >= ty * 16 - cam.y && r.y < (ty + 1) * 16 - cam.y
  // 0 zzzzz
  // 1 zdddQ   늪·데크·수렁
  // 2 ggR.X   갯골·갈대·모래·고사목
  // 3 .....
  const SWAMPY = defineMap('forest', ['zzzzz', 'zdddQ', 'ggR.X', '.....', '.....'], { spots: { marsh: 'marsh', bog: 'bog', creek: 'creek' } })

  test('물은 제 그림(늪·수렁·갯골 두 장), 데크는 늪물 위 판자', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const p = player(tileCentre(3, 3))
    const cam = cameraFor(SWAMPY, p.pos, size)
    const ctx = new RecordingCtx()
    drawWorld(asCtx(ctx), { ...scene('idle', p, size), map: SWAMPY, camera: cam }, size)
    const at = (tx: number, ty: number) => ctx.sprites.filter((c) => c.x === tx * 16 - cam.x && c.y === ty * 16 - cam.y).map((c) => c.name)
    expect(at(0, 0)).toContainEqual(expect.stringMatching(/^marsh-(lily-)?[01]$/))
    expect(at(4, 1)).toContainEqual(expect.stringMatching(/^bog-[01]$/))
    expect(at(0, 2)).toContainEqual(expect.stringMatching(/^creek-[01]$/))
    expect(at(2, 1)).toContainEqual(expect.stringMatching(/^marsh-[01]$/))
    expect(at(2, 1)).toContain('boardwalk-plank')
  })

  test.each([['R', 'tile-reed'], ['X', 'tile-deadtree']])('%s 윗부분: 캐릭터가 밑동보다 위 줄이면 앞에, 아래 줄이면 뒤에', (ch, name) => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new RecordingCtx() as unknown as RenderingContext)
    const m = defineMap('forest', ['.....', '.....', '.....', `..${ch}..`, '.....', '.....'])
    // 윗부분에만 있는 색(밑동과 겹치지 않는 색)
    const sp = realSprites.SPRITES[name]
    const topColors = new Set(sp.rows.slice(0, 16).flatMap((r) => [...r].filter((c) => c !== '.').map((c) => sp.palette[c])))
    const bottomColors = new Set(sp.rows.slice(16).flatMap((r) => [...r].filter((c) => c !== '.').map((c) => sp.palette[c])))
    const only = [...topColors].filter((c) => !bottomColors.has(c) && c !== '#78b85c')
    expect(only.length).toBeGreaterThan(0)
    const tops = (c: RecordingCtx, cam: Vec) => c.rects.map((r, i) => ({ r, i })).filter(({ r }) => only.includes(r.color) && inTile(r, cam, 2, 2))
    const above = { ...scene('idle', player(tileCentre(2, 2), 'down'), size), map: m }
    above.camera = cameraFor(m, above.player.pos, size)
    const a = new RecordingCtx()
    drawWorld(asCtx(a), above, size)
    const ta = tops(a, above.camera)
    expect(ta.length).toBeGreaterThan(0)
    expect(ta.every(({ i }) => i >= players(a)[0].at)).toBe(true)
    const below = { ...scene('idle', player(tileCentre(2, 4), 'up'), size), map: m }
    below.camera = cameraFor(m, below.player.pos, size)
    const b = new RecordingCtx()
    drawWorld(asCtx(b), below, size)
    const tb = tops(b, below.camera)
    expect(tb.length).toBeGreaterThan(0)
    expect(tb.every(({ i }) => i < players(b)[0].at)).toBe(true)
  })

  test('잠긴 통나무 더미·덩굴 문은 gate-driftwood·gate-vines를 그린다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const m = defineMap('village', ['.....', '.....', '.....'], {
      gates: [
        { area: 'lake', tiles: { tx: 0, ty: 0, w: 1, h: 3 }, look: 'driftwood', front: { tx: 1, ty: 1, facing: 'left' } },
        { area: 'cave', tiles: { tx: 4, ty: 0, w: 1, h: 2 }, look: 'vines', front: { tx: 3, ty: 0, facing: 'right' } },
      ],
    })
    const p = player(tileCentre(2, 1))
    const cam = cameraFor(m, p.pos, size)
    const ctx = new RecordingCtx()
    drawWorld(asCtx(ctx), { ...scene('idle', p, size), map: m, camera: cam }, size)
    expect(ctx.sprites.filter((c) => c.name === 'gate-driftwood')).toHaveLength(3)
    expect(ctx.sprites.filter((c) => c.name === 'gate-vines')).toHaveLength(2)
  })
})

describe('낚시 5부 M2: 늪 속 갈대·고사목', () => {
  test('늪물에 둘러싸인 갈대·고사목 칸은 늪물 위에, 풀밭이면 풀 위에 그린다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const size = { w: 195, h: 280 }
    const m = defineMap('forest', ['zzz,,,', 'zRz,X,', 'zzz,,,', ',,,,,,', ',,,,,,'], { spots: { marsh: 'marsh' } })
    const p = player(tileCentre(3, 3))
    const cam = cameraFor(m, p.pos, size)
    const ctx = new RecordingCtx()
    drawWorld(asCtx(ctx), { ...scene('idle', p, size), map: m, camera: cam }, size)
    const at = (tx: number, ty: number) => ctx.sprites.filter((c) => c.x === tx * 16 - cam.x && c.y === ty * 16 - cam.y).map((c) => c.name)
    expect(at(1, 1)).toContainEqual(expect.stringMatching(/^marsh-[01]$/))
    expect(at(4, 1).some((n) => n.startsWith('tile-grass'))).toBe(true)
  })
})

describe('낚시 5부 M2: 밀물 진흙 옆 갈대', () => {
  test('둘레가 갈대·밀물 진흙뿐인 갈대는 흙탕물 위에 그린다(바다 그림이 아니다)', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const size = { w: 195, h: 280 }
    const m = defineMap('tideflat', ['.RRR.', '.RRR.', 'mmmmm', 'mmmmm', '.....', '.....'], { tidal: true, spots: { mud: 'estuary' } })
    const p = player(tileCentre(2, 5))
    const cam = cameraFor(m, p.pos, size)
    const ctx = new RecordingCtx()
    drawWorld(asCtx(ctx), { ...scene('idle', p, size), map: m, camera: cam, dyn: { tide: 'high', holes: new Set() } }, size)
    const at = ctx.sprites.filter((c) => c.x === 2 * 16 - cam.x && c.y === 1 * 16 - cam.y).map((c) => c.name)
    expect(at).toContainEqual(expect.stringMatching(/^tile-mud-wet-[01]$/))
    expect(at.some((n) => /^water-[01]$/.test(n))).toBe(false)
  })
})

describe('늪지 그림 다듬기', () => {
  const size = { w: 195, h: 280 }
  const draw = (m: ReturnType<typeof defineMap>) => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const p = player(tileCentre(0, m.h - 1))
    const cam = cameraFor(m, p.pos, size)
    const ctx = new RecordingCtx()
    drawWorld(asCtx(ctx), { ...scene('idle', p, size), map: m, camera: cam }, size)
    return { ctx, cam, at: (tx: number, ty: number) => ctx.sprites.filter((c) => c.x === tx * 16 - cam.x && c.y === ty * 16 - cam.y).map((c) => c.name) }
  }
  test('세로로만 이어진 데크는 세로 판자, 가로·갈림길은 가로 판자', () => {
    const m = defineMap('forest', ['zdzzz', 'zdzzz', 'zdddd', 'zzzzz', ',,,,,'], { spots: { marsh: 'marsh' } })
    const { at } = draw(m)
    expect(at(1, 0)).toContain('boardwalk-plank-v')
    expect(at(1, 1)).toContain('boardwalk-plank-v')
    expect(at(1, 2)).toContain('boardwalk-plank')
    expect(at(3, 2)).toContain('boardwalk-plank')
  })
  test('수렁 가장자리: 늪 쪽 변에는 늪물 띠와 진흙 테두리, 수렁끼리 붙은 변에는 없다', () => {
    const m = defineMap('forest', ['zzzz', 'zQQz', 'zzzz', ',,,,'], { spots: { marsh: 'marsh', bog: 'bog' } })
    const { ctx, cam } = draw(m)
    const inTile = (r: { x: number; y: number }, tx: number, ty: number) =>
      r.x >= tx * 16 - cam.x && r.x < (tx + 1) * 16 - cam.x && r.y >= ty * 16 - cam.y && r.y < (ty + 1) * 16 - cam.y
    const rim = ctx.rects.filter((r) => r.color === '#3e3a2a' && inTile(r, 1, 1))
    expect(rim.length).toBeGreaterThan(0)
    // (1,1)의 오른쪽 변(수렁 (2,1)과 붙은 쪽) 끝 열에는 테두리가 없다
    expect(rim.some((r) => r.x === 2 * 16 - cam.x - 1 && r.w === 1 && r.y > 16 - cam.y + 3 && r.y < 32 - cam.y - 4)).toBe(false)
  })
  test('늪 칸 일부(칸마다 고정)는 연잎 그림이다', () => {
    const rows = Array.from({ length: 12 }, () => 'z'.repeat(12))
    rows.push(','.repeat(12))
    const { ctx } = draw(defineMap('forest', rows, { spots: { marsh: 'marsh' } }))
    const lily = ctx.sprites.filter((c) => c.name.startsWith('marsh-lily-')).length
    const plain = ctx.sprites.filter((c) => /^marsh-[01]$/.test(c.name)).length
    expect(lily).toBeGreaterThan(0)
    expect(plain).toBeGreaterThan(lily * 2)
  })
})

describe('늪지 풀밭 물가', () => {
  test('풀에 닿은 늪 칸에는 물가 풀 띠, 풀이 없는 늪 칸에는 없다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const size = { w: 195, h: 280 }
    const m = defineMap('forest', [',,,,,', 'zzzzz', 'zzzzz', 'zzzzz', ',,,,,'], { spots: { marsh: 'marsh' } })
    const p = player(tileCentre(2, 4))
    const cam = cameraFor(m, p.pos, size)
    const ctx = new RecordingCtx()
    drawWorld(asCtx(ctx), { ...scene('idle', p, size), map: m, camera: cam }, size)
    const inTile = (r: { x: number; y: number }, tx: number, ty: number) =>
      r.x >= tx * 16 - cam.x && r.x < (tx + 1) * 16 - cam.x && r.y >= ty * 16 - cam.y && r.y < (ty + 1) * 16 - cam.y
    const sedge = (tx: number, ty: number) => ctx.rects.filter((r) => r.color === '#6f9a52' && inTile(r, tx, ty)).length
    expect(sedge(2, 1)).toBeGreaterThan(0)
    expect(sedge(2, 3)).toBeGreaterThan(0)
    expect(sedge(2, 2)).toBe(0)
  })
})

describe('낚시 5부 M3 타일: 산정 호수·난파선', () => {
  const size = { w: 195, h: 280 }
  const inTile = (r: { x: number; y: number }, cam: Vec, tx: number, ty: number) =>
    r.x >= tx * 16 - cam.x && r.x < (tx + 1) * 16 - cam.x && r.y >= ty * 16 - cam.y && r.y < (ty + 1) * 16 - cam.y
  // 0 ~~~vv
  // 1 neeen   바다·심해·선체·갑판
  // 2 sshso   눈·온천·바위(눈 위)
  // 3 ssiss   얼음
  const ICY = defineMap('lake', ['~~~vv', 'neMen', 'sshso', 'ssiss', 'sssss', 'sssss'], { spots: { water: 'wreck', deep: 'abyss', hotspring: 'hotspring', hole: 'ice' } })
  const draw = (m = ICY, at = tileCentre(1, 4)) => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const p = player(at)
    const cam = cameraFor(m, p.pos, size)
    const ctx = new RecordingCtx()
    drawWorld(asCtx(ctx), { ...scene('idle', p, size), map: m, camera: cam }, size)
    const names = (tx: number, ty: number) => ctx.sprites.filter((c) => c.x === tx * 16 - cam.x && c.y === ty * 16 - cam.y).map((c) => c.name)
    return { ctx, cam, names }
  }

  test('온천·심해는 제 물 그림(두 장), 갑판은 판자, 선체는 선체 그림, 돛대 밑은 갑판 위', () => {
    const { names } = draw()
    expect(names(0, 0)).toContainEqual(expect.stringMatching(/^water-[01]$/))
    expect(names(3, 0)).toContainEqual(expect.stringMatching(/^deep-[01]$/))
    expect(names(2, 2)).toContainEqual(expect.stringMatching(/^hotspring-[01]$/))
    expect(names(1, 1)).toContain('deck-plank')
    expect(names(0, 1)).toContain('tile-hull')
    expect(names(2, 1)).toContain('deck-plank')
  })

  test('눈 칸은 눈 그림, 눈 사이 바위는 눈 위, 얼음은 얼음', () => {
    const { names } = draw()
    expect(names(0, 2)).toContain('tile-snow')
    expect(names(4, 2)).toContain('tile-snow')
    expect(names(4, 2)).toContain('tile-rock')
    expect(names(2, 3)).toContain('tile-ice')
  })

  test.each([['A', 'tile-snowpine'], ['M', 'tile-mast']])('%s 윗부분: 캐릭터가 밑동보다 위 줄이면 앞에, 아래 줄이면 뒤에', (ch, name) => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new RecordingCtx() as unknown as RenderingContext)
    const ground = ch === 'M' ? 'e' : 's'
    const row = ground.repeat(5)
    const m = defineMap('lake', [row, row, row, `${ground}${ground}${ch}${ground}${ground}`, row, row])
    const sp = realSprites.SPRITES[name]
    const topColors = new Set(sp.rows.slice(0, 16).flatMap((r) => [...r].filter((c) => c !== '.').map((c) => sp.palette[c])))
    const bottomColors = new Set(sp.rows.slice(16).flatMap((r) => [...r].filter((c) => c !== '.').map((c) => sp.palette[c])))
    const only = [...topColors].filter((c) => !bottomColors.has(c))
    expect(only.length).toBeGreaterThan(0)
    const tops = (c: RecordingCtx, cam: Vec) => c.rects.map((r, i) => ({ r, i })).filter(({ r }) => only.includes(r.color) && inTile(r, cam, 2, 2))
    const above = { ...scene('idle', player(tileCentre(2, 2), 'down'), size), map: m }
    above.camera = cameraFor(m, above.player.pos, size)
    const a = new RecordingCtx()
    drawWorld(asCtx(a), above, size)
    const ta = tops(a, above.camera)
    expect(ta.length).toBeGreaterThan(0)
    expect(ta.every(({ i }) => i >= players(a)[0].at)).toBe(true)
    const below = { ...scene('idle', player(tileCentre(2, 4), 'up'), size), map: m }
    below.camera = cameraFor(m, below.player.pos, size)
    const b = new RecordingCtx()
    drawWorld(asCtx(b), below, size)
    const tb = tops(b, below.camera)
    expect(tb.length).toBeGreaterThan(0)
    expect(tb.every(({ i }) => i < players(b)[0].at)).toBe(true)
  })

  test('잠긴 눈더미 문은 gate-snowdrift를 그린다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const m = defineMap('lake', ['sssss', 'sssss', 'sssss'], {
      gates: [{ area: 'cave', tiles: { tx: 1, ty: 0, w: 2, h: 1 }, look: 'snowdrift', front: { tx: 1, ty: 1, facing: 'up' } }],
    })
    const { ctx } = draw(m, tileCentre(2, 2))
    expect(ctx.sprites.filter((c) => c.name === 'gate-snowdrift')).toHaveLength(2)
  })
})

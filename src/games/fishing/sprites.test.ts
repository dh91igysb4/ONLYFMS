import { describe, expect, it } from 'vitest'
import { RODS, SPECIES } from './data.ts'
import { SHOP, TILE } from './map.ts'
import { SPRITES, drawSprite } from './sprites.ts'

const PLAYER_POSES = [
  'player-idle-down',
  'player-walk-down-0',
  'player-walk-down-1',
  'player-idle-up',
  'player-walk-up-0',
  'player-walk-up-1',
  'player-idle-side',
  'player-walk-side-0',
  'player-walk-side-1',
  'player-cast-up',
  'player-reel-up',
  'player-cast-side',
  'player-reel-side',
]
const TILES = ['tile-grass', 'tile-grass-alt', 'tile-path', 'tile-sand', 'tile-flower', 'tile-rock', 'tile-fence', 'tile-fence-v']

const REQUIRED = [
  'player-idle',
  'player-cast',
  'player-reel',
  'water-0',
  'water-1',
  'pier-plank',
  'pier-post',
  'bobber',
  ...SPECIES.map((s) => `fish-${s.id}`),
  ...RODS.map((r) => `rod-${r.tier}`),
  ...PLAYER_POSES,
  ...TILES,
  'tile-tree',
  'shop',
]

describe('SPRITES', () => {
  it('has every required key', () => {
    for (const key of REQUIRED) expect(SPRITES[key], key).toBeDefined()
  })

  it('every sprite matches its size and palette', () => {
    for (const [name, sp] of Object.entries(SPRITES)) {
      expect(sp.rows.length, `${name} rows`).toBe(sp.h)
      sp.rows.forEach((row, y) => {
        expect(row.length, `${name} row ${y} width`).toBe(sp.w)
        for (const ch of row) {
          if (ch !== '.') expect(sp.palette[ch], `${name} row ${y} char '${ch}'`).toBeDefined()
        }
      })
    }
  })

  it('fish fit in 16×16 and the player is 16×24', () => {
    for (const s of SPECIES) {
      const sp = SPRITES[`fish-${s.id}`]
      expect(sp.w, s.id).toBeLessThanOrEqual(16)
      expect(sp.h, s.id).toBeLessThanOrEqual(16)
    }
    for (const pose of ['player-idle', 'player-cast', 'player-reel']) {
      expect([SPRITES[pose].w, SPRITES[pose].h], pose).toEqual([16, 24])
    }
  })

  it('all 12 fish are drawn differently', () => {
    const drawings = SPECIES.map((s) => SPRITES[`fish-${s.id}`].rows.join('\n'))
    expect(new Set(drawings).size).toBe(SPECIES.length)
  })

  it('village art has the sizes the tile map expects', () => {
    for (const pose of PLAYER_POSES) expect([SPRITES[pose].w, SPRITES[pose].h], pose).toEqual([16, 24])
    for (const tile of TILES) expect([SPRITES[tile].w, SPRITES[tile].h], tile).toEqual([16, 16])
    expect([SPRITES['tile-tree'].w, SPRITES['tile-tree'].h]).toEqual([16, 32])
    expect(SPRITES.shop.w % 16).toBe(0)
    expect(SPRITES.shop.h % 16).toBe(0)
    // 맵의 건물 사각형(B·D 칸)과 같은 크기라 좌상단에 한 번에 그리면 맞는다
    expect([SPRITES.shop.w, SPRITES.shop.h]).toEqual([SHOP.w * TILE, SHOP.h * TILE])
  })

  it('walk frames 0 and 1 differ in every direction', () => {
    for (const dir of ['down', 'up', 'side']) {
      const a = SPRITES[`player-walk-${dir}-0`].rows.join('\n')
      const b = SPRITES[`player-walk-${dir}-1`].rows.join('\n')
      expect(a, dir).not.toBe(b)
    }
  })
})

describe('drawSprite', () => {
  // 칠한 사각형을 기록하는 가짜 컨텍스트
  function recorder() {
    const rects: { x: number; y: number; w: number; h: number; color: string }[] = []
    const ctx = {
      fillStyle: '',
      fillRect(x: number, y: number, w: number, h: number) {
        rects.push({ x, y, w, h, color: String(this.fillStyle) })
      },
    }
    return { ctx: ctx as unknown as CanvasRenderingContext2D, rects }
  }

  // 사각형 목록을 픽셀 격자로 되돌린다(스프라이트 좌표, 칠하지 않은 칸은 null)
  function pixels(rects: { x: number; y: number; w: number; h: number; color: string }[], ox: number, oy: number, scale: number, w: number, h: number) {
    const grid: (string | null)[][] = Array.from({ length: h }, () => Array<string | null>(w).fill(null))
    for (const r of rects) {
      for (let px = r.x; px < r.x + r.w; px += scale) grid[(r.y - oy) / scale][(px - ox) / scale] = r.color
    }
    return grid
  }

  it('flipX mirrors the sprite inside the same box', () => {
    const name = 'player-walk-side-0'
    const sp = SPRITES[name]
    const plain = recorder()
    const flipped = recorder()
    drawSprite(plain.ctx, name, 10, 20, 2)
    drawSprite(flipped.ctx, name, 10, 20, 2, { flipX: true })
    const a = pixels(plain.rects, 10, 20, 2, sp.w, sp.h)
    const b = pixels(flipped.rects, 10, 20, 2, sp.w, sp.h)
    expect(b).toEqual(a.map((row) => [...row].reverse()))
    expect(b).not.toEqual(a)
  })
})

import { describe, expect, it } from 'vitest'
import {
  MAP_H,
  MAP_ROWS,
  MAP_W,
  PIER_END,
  SHOP,
  SHOP_SPOT,
  SPAWN,
  TILE,
  TILE_CHARS,
  castTarget,
  interactionAt,
  isWalkable,
  tileAt,
  tileOf,
  type Facing,
  type TileKind,
  type Vec,
} from './map.ts'

const DIRS: Record<Facing, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}
const FACINGS: Facing[] = ['up', 'down', 'left', 'right']

const center = (tx: number, ty: number): Vec => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })

function allTiles(): { tx: number; ty: number }[] {
  const out: { tx: number; ty: number }[] = []
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) out.push({ tx, ty })
  return out
}

// 4방향 BFS. 시작 타일에서 각 걷기 타일까지의 걸음 수.
function bfs(from: { tx: number; ty: number }): Map<string, number> {
  const dist = new Map<string, number>([[`${from.tx},${from.ty}`, 0]])
  const queue = [from]
  for (let i = 0; i < queue.length; i++) {
    const { tx, ty } = queue[i]
    const d = dist.get(`${tx},${ty}`)!
    for (const { dx, dy } of Object.values(DIRS)) {
      const n = { tx: tx + dx, ty: ty + dy }
      const key = `${n.tx},${n.ty}`
      if (!isWalkable(n.tx, n.ty) || dist.has(key)) continue
      dist.set(key, d + 1)
      queue.push(n)
    }
  }
  return dist
}

describe('map grid', () => {
  it('has consistent size within the design range', () => {
    expect(MAP_ROWS.length).toBe(MAP_H)
    for (const row of MAP_ROWS) expect(row.length).toBe(MAP_W)
    expect(MAP_W).toBeGreaterThanOrEqual(40)
    expect(MAP_W).toBeLessThanOrEqual(56)
    expect(MAP_H).toBeGreaterThanOrEqual(30)
    expect(MAP_H).toBeLessThanOrEqual(40)
    expect(TILE).toBe(16)
  })

  it('uses only known tile characters', () => {
    for (const row of MAP_ROWS) for (const ch of row) expect(TILE_CHARS[ch], `char ${JSON.stringify(ch)}`).toBeDefined()
  })

  it('uses every tile kind at least once', () => {
    const used = new Set(allTiles().map(({ tx, ty }) => tileAt(tx, ty)))
    const kinds: TileKind[] = ['water', 'sand', 'grass', 'path', 'pier', 'tree', 'flower', 'fence', 'rock', 'building', 'door']
    for (const k of kinds) expect(used.has(k), k).toBe(true)
  })

  it('walkable kinds are exactly sand, grass, path, pier, flower', () => {
    const walkable = new Set<TileKind>()
    for (const { tx, ty } of allTiles()) if (isWalkable(tx, ty)) walkable.add(tileAt(tx, ty)!)
    expect([...walkable].sort()).toEqual(['flower', 'grass', 'path', 'pier', 'sand'])
    for (const { tx, ty } of allTiles()) {
      const k = tileAt(tx, ty)!
      expect(isWalkable(tx, ty)).toBe(['sand', 'grass', 'path', 'pier', 'flower'].includes(k))
    }
  })

  it('border tiles are not walkable', () => {
    for (let tx = 0; tx < MAP_W; tx++) {
      expect(isWalkable(tx, 0), `(${tx},0)`).toBe(false)
      expect(isWalkable(tx, MAP_H - 1), `(${tx},${MAP_H - 1})`).toBe(false)
    }
    for (let ty = 0; ty < MAP_H; ty++) {
      expect(isWalkable(0, ty), `(0,${ty})`).toBe(false)
      expect(isWalkable(MAP_W - 1, ty), `(${MAP_W - 1},${ty})`).toBe(false)
    }
  })

  it('outside the map is null and not walkable', () => {
    expect(tileAt(-1, 0)).toBeNull()
    expect(tileAt(0, -1)).toBeNull()
    expect(tileAt(MAP_W, 0)).toBeNull()
    expect(tileAt(0, MAP_H)).toBeNull()
    expect(isWalkable(MAP_W, 0)).toBe(false)
    expect(isWalkable(-1, 5)).toBe(false)
  })

  it('tileOf floors world pixels to tiles', () => {
    expect(tileOf({ x: 0, y: 0 })).toEqual({ tx: 0, ty: 0 })
    expect(tileOf({ x: 15.9, y: 16 })).toEqual({ tx: 0, ty: 1 })
    expect(tileOf({ x: 40, y: 31.99 })).toEqual({ tx: 2, ty: 1 })
    expect(tileOf({ x: -0.5, y: -16 })).toEqual({ tx: -1, ty: -1 })
  })
})

describe('shop', () => {
  it('footprint is a 4x3..6x4 block of building tiles with one door in its bottom row', () => {
    expect(SHOP.w).toBeGreaterThanOrEqual(4)
    expect(SHOP.w).toBeLessThanOrEqual(6)
    expect(SHOP.h).toBeGreaterThanOrEqual(3)
    expect(SHOP.h).toBeLessThanOrEqual(4)
    expect(SHOP.doorTx).toBeGreaterThan(SHOP.tx)
    expect(SHOP.doorTx).toBeLessThan(SHOP.tx + SHOP.w - 1)
    const doorTy = SHOP.ty + SHOP.h - 1
    for (const { tx, ty } of allTiles()) {
      const inside = tx >= SHOP.tx && tx < SHOP.tx + SHOP.w && ty >= SHOP.ty && ty < SHOP.ty + SHOP.h
      const isDoor = tx === SHOP.doorTx && ty === doorTy
      const expected: TileKind | null = isDoor ? 'door' : inside ? 'building' : null
      const kind = tileAt(tx, ty)
      if (expected) expect(kind, `(${tx},${ty})`).toBe(expected)
      else expect(kind === 'building' || kind === 'door', `(${tx},${ty}) outside the shop`).toBe(false)
    }
  })

  it('SHOP_SPOT is the tile right below the door, SPAWN is its center facing down', () => {
    expect(SHOP_SPOT).toEqual({ tx: SHOP.doorTx, ty: SHOP.ty + SHOP.h })
    expect(SPAWN.pos).toEqual(center(SHOP_SPOT.tx, SHOP_SPOT.ty))
    expect(SPAWN.facing).toBe('down')
    expect(isWalkable(SHOP_SPOT.tx, SHOP_SPOT.ty)).toBe(true)
  })

  it('SPAWN facing up interacts with the shop; other facings do not', () => {
    expect(interactionAt(SPAWN.pos, 'up')).toEqual({ kind: 'shop' })
    expect(interactionAt(SPAWN.pos, 'down')).toBeNull()
    expect(interactionAt(SPAWN.pos, 'left')).toBeNull()
    expect(interactionAt(SPAWN.pos, 'right')).toBeNull()
  })

  it('SHOP_SPOT is the only tile in the map with a shop interaction', () => {
    const shopTiles: { tx: number; ty: number }[] = []
    for (const { tx, ty } of allTiles()) {
      for (const f of FACINGS) {
        const hit = interactionAt(center(tx, ty), f)
        if (hit?.kind === 'shop') {
          expect(f).toBe('up')
          shopTiles.push({ tx, ty })
        }
      }
    }
    expect(shopTiles).toEqual([SHOP_SPOT])
  })
})

describe('fishing spots', () => {
  it('PIER_END is a pier tile with water below and interacts as pier fishing', () => {
    expect(tileAt(PIER_END.tx, PIER_END.ty)).toBe('pier')
    expect(tileAt(PIER_END.tx, PIER_END.ty + 1)).toBe('water')
    expect(interactionAt(center(PIER_END.tx, PIER_END.ty), 'down')).toEqual({ kind: 'fish', spot: 'pier' })
  })

  it('PIER_END is the far end of the pier (no pier tile further out)', () => {
    let maxTy = -1
    for (const { tx, ty } of allTiles()) if (tileAt(tx, ty) === 'pier') maxTy = Math.max(maxTy, ty)
    expect(PIER_END.ty).toBe(maxTy)
  })

  it('a sand tile above water fishes from the shore facing down, nothing facing up', () => {
    const shore = allTiles().find(({ tx, ty }) => tileAt(tx, ty) === 'sand' && tileAt(tx, ty + 1) === 'water')
    expect(shore).toBeDefined()
    const pos = center(shore!.tx, shore!.ty)
    expect(interactionAt(pos, 'down')).toEqual({ kind: 'fish', spot: 'shore' })
    expect(interactionAt(pos, 'up')).toBeNull()
  })

  it('the beach is long enough to fish from many shore tiles', () => {
    const shoreTiles = allTiles().filter(
      ({ tx, ty }) => tileAt(tx, ty) === 'sand' && FACINGS.some((f) => interactionAt(center(tx, ty), f)?.kind === 'fish'),
    )
    expect(shoreTiles.length).toBeGreaterThanOrEqual(20)
  })

  it('uses the foot position, not the tile corner, to pick the standing tile', () => {
    const p = center(PIER_END.tx, PIER_END.ty)
    expect(interactionAt({ x: p.x - 7.9, y: p.y + 7.9 }, 'down')).toEqual({ kind: 'fish', spot: 'pier' })
  })
})

describe('reachability', () => {
  const dist = bfs(SHOP_SPOT)

  it('PIER_END and every walkable tile next to water are reachable from SPAWN', () => {
    expect(dist.has(`${PIER_END.tx},${PIER_END.ty}`)).toBe(true)
    for (const { tx, ty } of allTiles()) {
      if (!isWalkable(tx, ty)) continue
      const nearWater = Object.values(DIRS).some(({ dx, dy }) => tileAt(tx + dx, ty + dy) === 'water')
      if (nearWater) expect(dist.has(`${tx},${ty}`), `(${tx},${ty})`).toBe(true)
    }
  })

  it('every walkable tile is reachable (no sealed pockets)', () => {
    for (const { tx, ty } of allTiles()) if (isWalkable(tx, ty)) expect(dist.has(`${tx},${ty}`), `(${tx},${ty})`).toBe(true)
  })

  it('shortest walk PIER_END <-> SHOP_SPOT is 30..45 tiles (10..15 s at 3 tiles/s)', () => {
    const steps = dist.get(`${PIER_END.tx},${PIER_END.ty}`)!
    expect(steps).toBeGreaterThanOrEqual(30)
    expect(steps).toBeLessThanOrEqual(45)
  })
})

describe('castTarget', () => {
  const pierEnd = center(PIER_END.tx, PIER_END.ty)

  it('lands 1.5 tiles out at power 0 and 5 tiles out at power 1, on water', () => {
    const near = castTarget(pierEnd, 'down', 0)
    const far = castTarget(pierEnd, 'down', 1)
    expect(near).toEqual({ x: pierEnd.x, y: pierEnd.y + 1.5 * TILE })
    expect(far).toEqual({ x: pierEnd.x, y: pierEnd.y + 5 * TILE })
    const nt = tileOf(near)
    const ft = tileOf(far)
    expect(tileAt(nt.tx, nt.ty)).toBe('water')
    expect(tileAt(ft.tx, ft.ty)).toBe('water')
  })

  it('scales linearly with power and clamps it to 0..1', () => {
    expect(castTarget(pierEnd, 'down', 0.5)).toEqual({ x: pierEnd.x, y: pierEnd.y + 3.25 * TILE })
    expect(castTarget(pierEnd, 'down', -3)).toEqual(castTarget(pierEnd, 'down', 0))
    expect(castTarget(pierEnd, 'down', 7)).toEqual(castTarget(pierEnd, 'down', 1))
  })

  it('stops at the center of the last water tile before land', () => {
    let found: { tx: number; ty: number; f: Facing } | undefined
    for (const { tx, ty } of allTiles()) {
      if (!isWalkable(tx, ty)) continue
      for (const f of FACINGS) {
        const { dx, dy } = DIRS[f]
        const first = tileAt(tx + dx, ty + dy)
        const second = tileAt(tx + 2 * dx, ty + 2 * dy)
        if (first === 'water' && second !== null && second !== 'water') found ??= { tx, ty, f }
      }
    }
    expect(found, 'a spot with one water tile then land ahead').toBeDefined()
    const { tx, ty, f } = found!
    const { dx, dy } = DIRS[f]
    expect(castTarget(center(tx, ty), f, 1)).toEqual(center(tx + dx, ty + dy))
    expect(castTarget(center(tx, ty), f, 0.6)).toEqual(center(tx + dx, ty + dy))
  })

  it('works in every direction from the pier end (sideways water is open)', () => {
    const left = castTarget(pierEnd, 'left', 1)
    expect(left.y).toBe(pierEnd.y)
    expect(left.x).toBeLessThan(pierEnd.x)
    const lt = tileOf(left)
    expect(tileAt(lt.tx, lt.ty)).toBe('water')
  })
})

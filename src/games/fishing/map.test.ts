import { describe, expect, it } from 'vitest'
import {
  TILE,
  TILE_CHARS,
  WATER_KINDS,
  castTarget,
  defineMap,
  interactionAt,
  isWalkable,
  pierEnd,
  shopSpot,
  spotFor,
  tileAt,
  tileOf,
  type Facing,
  type TileKind,
  type Vec,
} from './map.ts'
import { VILLAGE } from './maps/village.ts'

const MAP_W = VILLAGE.w
const MAP_H = VILLAGE.h
const MAP_ROWS = VILLAGE.rows
const SHOP = VILLAGE.shop!
const SHOP_SPOT = shopSpot(VILLAGE)!
const SPAWN = VILLAGE.spawn
const PIER_END = pierEnd(VILLAGE)!

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
      if (!isWalkable(VILLAGE, n.tx, n.ty) || dist.has(key)) continue
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
    const used = new Set(allTiles().map(({ tx, ty }) => tileAt(VILLAGE, tx, ty)))
    const kinds: TileKind[] = ['water', 'sand', 'grass', 'path', 'pier', 'tree', 'flower', 'fence', 'rock', 'building', 'door']
    for (const k of kinds) expect(used.has(k), k).toBe(true)
  })

  it('walkable kinds are exactly sand, grass, path, pier, flower', () => {
    const walkable = new Set<TileKind>()
    for (const { tx, ty } of allTiles()) if (isWalkable(VILLAGE, tx, ty)) walkable.add(tileAt(VILLAGE, tx, ty)!)
    expect([...walkable].sort()).toEqual(['flower', 'grass', 'path', 'pier', 'sand'])
    for (const { tx, ty } of allTiles()) {
      const k = tileAt(VILLAGE, tx, ty)!
      expect(isWalkable(VILLAGE, tx, ty)).toBe(['sand', 'grass', 'path', 'pier', 'flower'].includes(k))
    }
  })

  it('border tiles are not walkable', () => {
    for (let tx = 0; tx < MAP_W; tx++) {
      expect(isWalkable(VILLAGE, tx, 0), `(${tx},0)`).toBe(false)
      expect(isWalkable(VILLAGE, tx, MAP_H - 1), `(${tx},${MAP_H - 1})`).toBe(false)
    }
    for (let ty = 0; ty < MAP_H; ty++) {
      expect(isWalkable(VILLAGE, 0, ty), `(0,${ty})`).toBe(false)
      expect(isWalkable(VILLAGE, MAP_W - 1, ty), `(${MAP_W - 1},${ty})`).toBe(false)
    }
  })

  it('outside the map is null and not walkable', () => {
    expect(tileAt(VILLAGE, -1, 0)).toBeNull()
    expect(tileAt(VILLAGE, 0, -1)).toBeNull()
    expect(tileAt(VILLAGE, MAP_W, 0)).toBeNull()
    expect(tileAt(VILLAGE, 0, MAP_H)).toBeNull()
    expect(isWalkable(VILLAGE, MAP_W, 0)).toBe(false)
    expect(isWalkable(VILLAGE, -1, 5)).toBe(false)
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
      const kind = tileAt(VILLAGE, tx, ty)
      if (expected) expect(kind, `(${tx},${ty})`).toBe(expected)
      else expect(kind === 'building' || kind === 'door', `(${tx},${ty}) outside the shop`).toBe(false)
    }
  })

  it('SHOP_SPOT is the tile right below the door, SPAWN is its center facing down', () => {
    expect(SHOP_SPOT).toEqual({ tx: SHOP.doorTx, ty: SHOP.ty + SHOP.h })
    expect(SPAWN.pos).toEqual(center(SHOP_SPOT.tx, SHOP_SPOT.ty))
    expect(SPAWN.facing).toBe('down')
    expect(isWalkable(VILLAGE, SHOP_SPOT.tx, SHOP_SPOT.ty)).toBe(true)
  })

  it('SPAWN facing up interacts with the shop; other facings do not', () => {
    expect(interactionAt(VILLAGE, SPAWN.pos, 'up')).toEqual({ kind: 'shop' })
    expect(interactionAt(VILLAGE, SPAWN.pos, 'down')).toBeNull()
    expect(interactionAt(VILLAGE, SPAWN.pos, 'left')).toBeNull()
    expect(interactionAt(VILLAGE, SPAWN.pos, 'right')).toBeNull()
  })

  it('SHOP_SPOT is the only tile in the map with a shop interaction', () => {
    const shopTiles: { tx: number; ty: number }[] = []
    for (const { tx, ty } of allTiles()) {
      for (const f of FACINGS) {
        const hit = interactionAt(VILLAGE, center(tx, ty), f)
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
    expect(tileAt(VILLAGE, PIER_END.tx, PIER_END.ty)).toBe('pier')
    expect(tileAt(VILLAGE, PIER_END.tx, PIER_END.ty + 1)).toBe('water')
    expect(interactionAt(VILLAGE, center(PIER_END.tx, PIER_END.ty), 'down')).toEqual({ kind: 'fish', spot: 'pier' })
  })

  it('PIER_END is the far end of the pier (no pier tile further out)', () => {
    let maxTy = -1
    for (const { tx, ty } of allTiles()) if (tileAt(VILLAGE, tx, ty) === 'pier') maxTy = Math.max(maxTy, ty)
    expect(PIER_END.ty).toBe(maxTy)
  })

  it('a sand tile above water fishes from the shore facing down, nothing facing up', () => {
    const shore = allTiles().find(({ tx, ty }) => tileAt(VILLAGE, tx, ty) === 'sand' && tileAt(VILLAGE, tx, ty + 1) === 'water')
    expect(shore).toBeDefined()
    const pos = center(shore!.tx, shore!.ty)
    expect(interactionAt(VILLAGE, pos, 'down')).toEqual({ kind: 'fish', spot: 'shore' })
    expect(interactionAt(VILLAGE, pos, 'up')).toBeNull()
  })

  it('the beach is long enough to fish from many shore tiles', () => {
    const shoreTiles = allTiles().filter(
      ({ tx, ty }) => tileAt(VILLAGE, tx, ty) === 'sand' && FACINGS.some((f) => interactionAt(VILLAGE, center(tx, ty), f)?.kind === 'fish'),
    )
    expect(shoreTiles.length).toBeGreaterThanOrEqual(20)
  })

  it('uses the foot position, not the tile corner, to pick the standing tile', () => {
    const p = center(PIER_END.tx, PIER_END.ty)
    expect(interactionAt(VILLAGE, { x: p.x - 7.9, y: p.y + 7.9 }, 'down')).toEqual({ kind: 'fish', spot: 'pier' })
  })
})

describe('reachability', () => {
  const dist = bfs(SHOP_SPOT)

  it('PIER_END and every walkable tile next to water are reachable from SPAWN', () => {
    expect(dist.has(`${PIER_END.tx},${PIER_END.ty}`)).toBe(true)
    for (const { tx, ty } of allTiles()) {
      if (!isWalkable(VILLAGE, tx, ty)) continue
      const nearWater = Object.values(DIRS).some(({ dx, dy }) => tileAt(VILLAGE, tx + dx, ty + dy) === 'water')
      if (nearWater) expect(dist.has(`${tx},${ty}`), `(${tx},${ty})`).toBe(true)
    }
  })

  it('every walkable tile is reachable (no sealed pockets)', () => {
    for (const { tx, ty } of allTiles()) if (isWalkable(VILLAGE, tx, ty)) expect(dist.has(`${tx},${ty}`), `(${tx},${ty})`).toBe(true)
  })

  it('shortest walk PIER_END <-> SHOP_SPOT is 30..45 tiles (10..15 s at 3 tiles/s)', () => {
    const steps = dist.get(`${PIER_END.tx},${PIER_END.ty}`)!
    expect(steps).toBeGreaterThanOrEqual(30)
    expect(steps).toBeLessThanOrEqual(45)
  })
})

describe('castTarget', () => {
  const pierCenter = center(PIER_END.tx, PIER_END.ty)

  it('lands 1.5 tiles out at power 0 and 5 tiles out at power 1, on water', () => {
    const near = castTarget(VILLAGE, pierCenter, 'down', 0)
    const far = castTarget(VILLAGE, pierCenter, 'down', 1)
    expect(near).toEqual({ x: pierCenter.x, y: pierCenter.y + 1.5 * TILE })
    expect(far).toEqual({ x: pierCenter.x, y: pierCenter.y + 5 * TILE })
    const nt = tileOf(near)
    const ft = tileOf(far)
    expect(tileAt(VILLAGE, nt.tx, nt.ty)).toBe('water')
    expect(tileAt(VILLAGE, ft.tx, ft.ty)).toBe('water')
  })

  it('scales linearly with power and clamps it to 0..1', () => {
    expect(castTarget(VILLAGE, pierCenter, 'down', 0.5)).toEqual({ x: pierCenter.x, y: pierCenter.y + 3.25 * TILE })
    expect(castTarget(VILLAGE, pierCenter, 'down', -3)).toEqual(castTarget(VILLAGE, pierCenter, 'down', 0))
    expect(castTarget(VILLAGE, pierCenter, 'down', 7)).toEqual(castTarget(VILLAGE, pierCenter, 'down', 1))
  })

  it('stops at the center of the last water tile before land', () => {
    let found: { tx: number; ty: number; f: Facing } | undefined
    for (const { tx, ty } of allTiles()) {
      if (!isWalkable(VILLAGE, tx, ty)) continue
      for (const f of FACINGS) {
        const { dx, dy } = DIRS[f]
        const first = tileAt(VILLAGE, tx + dx, ty + dy)
        const second = tileAt(VILLAGE, tx + 2 * dx, ty + 2 * dy)
        if (first === 'water' && second !== null && second !== 'water') found ??= { tx, ty, f }
      }
    }
    expect(found, 'a spot with one water tile then land ahead').toBeDefined()
    const { tx, ty, f } = found!
    const { dx, dy } = DIRS[f]
    expect(castTarget(VILLAGE, center(tx, ty), f, 1)).toEqual(center(tx + dx, ty + dy))
    expect(castTarget(VILLAGE, center(tx, ty), f, 0.6)).toEqual(center(tx + dx, ty + dy))
  })

  it('works in every direction from the pier end (sideways water is open)', () => {
    const left = castTarget(VILLAGE, pierCenter, 'left', 1)
    expect(left.y).toBe(pierCenter.y)
    expect(left.x).toBeLessThan(pierCenter.x)
    const lt = tileOf(left)
    expect(tileAt(VILLAGE, lt.tx, lt.ty)).toBe('water')
  })
})

// 새 타일 종류용 작은 합성 맵. 위에서 아래로: 풀 / 연못 / 웅덩이 / 풀, 오른쪽 열은 강·다리
const REGION = defineMap(
  'river',
  [
    ',,,,,',
    ',ppp,',
    ',pbb,',
    ',,,,,',
    'rrHrr',
    'wcrr,',
  ],
  { spots: { river: 'river', pond: 'pond', basin: 'waterfall' } },
)

describe('new tile kinds', () => {
  it('reads the new tile characters', () => {
    expect(tileAt(REGION, 1, 1)).toBe('pond')
    expect(tileAt(REGION, 2, 2)).toBe('basin')
    expect(tileAt(REGION, 0, 4)).toBe('river')
    expect(tileAt(REGION, 2, 4)).toBe('bridge')
    expect(tileAt(REGION, 0, 5)).toBe('falls')
    expect(tileAt(REGION, 1, 5)).toBe('cliff')
  })

  it('bridge is walkable; river, pond, basin, falls and cliff are not', () => {
    expect(isWalkable(REGION, 2, 4)).toBe(true)
    for (const [tx, ty] of [[0, 4], [1, 1], [2, 2], [0, 5], [1, 5]]) expect(isWalkable(REGION, tx, ty), `${tx},${ty}`).toBe(false)
  })

  it('WATER_KINDS holds the four water kinds only', () => {
    expect([...WATER_KINDS].sort()).toEqual(['basin', 'pond', 'river', 'water'])
  })
})

describe('spotFor', () => {
  it('village: pier standing gives pier, sand gives shore, other fronts give null', () => {
    expect(spotFor(VILLAGE, 'pier', 'water')).toBe('pier')
    expect(spotFor(VILLAGE, 'sand', 'water')).toBe('shore')
    expect(spotFor(VILLAGE, 'sand', 'sand')).toBeNull()
    expect(spotFor(VILLAGE, 'sand', null)).toBeNull()
  })

  it('a bridge over a river fishes the river spot', () => {
    expect(spotFor(REGION, 'bridge', 'river')).toBe('river')
  })

  it('grass beside a basin or a pond gives each its own spot', () => {
    expect(spotFor(REGION, 'grass', 'basin')).toBe('waterfall')
    expect(spotFor(REGION, 'grass', 'pond')).toBe('pond')
  })

  it('water kinds the map has no spot for give null', () => {
    expect(spotFor(REGION, 'grass', 'water')).toBeNull()
    expect(spotFor(defineMap('river', [',,', ',r'], { spots: { pond: 'pond' } }), 'grass', 'river')).toBeNull()
  })
})

describe('interactionAt on new tiles', () => {
  it('facing falls or cliff gives null', () => {
    const wall = defineMap('river', ['..', 'wc'], { spots: { river: 'river' } })
    expect(interactionAt(wall, center(0, 0), 'down')).toBeNull() // 폭포
    expect(interactionAt(wall, center(1, 0), 'down')).toBeNull() // 절벽
  })

  it('on the bridge, facing the river fishes river', () => {
    expect(interactionAt(REGION, center(2, 4), 'down')).toEqual({ kind: 'fish', spot: 'river' })
    expect(interactionAt(REGION, center(2, 4), 'left')).toEqual({ kind: 'fish', spot: 'river' })
    expect(interactionAt(REGION, center(2, 4), 'right')).toEqual({ kind: 'fish', spot: 'river' })
  })

  it('from the grass, a pond and a basin give their spots', () => {
    expect(interactionAt(REGION, center(0, 1), 'right')).toEqual({ kind: 'fish', spot: 'pond' })
    expect(interactionAt(REGION, center(3, 3), 'up')).toEqual({ kind: 'fish', spot: 'waterfall' })
  })
})

describe('castTarget over mixed water kinds', () => {
  it('keeps going from pond into basin and stops at the last water tile before grass', () => {
    const row = defineMap('river', [',,,,,,', ',pbbb,', ',,,,,,'], { spots: { pond: 'pond', basin: 'waterfall' } })
    const from = center(0, 1)
    expect(castTarget(row, from, 'right', 1)).toEqual(center(4, 1))
    expect(castTarget(row, from, 'right', 0)).toEqual({ x: from.x + 1.5 * TILE, y: from.y })
  })

  it('stops before grass after a river tile', () => {
    expect(castTarget(REGION, center(4, 3), 'down', 1)).toEqual(center(4, 4))
  })
})

describe('defineMap', () => {
  const ROW = (n: number) => ','.repeat(n)

  it('throws when rows differ in length', () => {
    expect(() => defineMap('village', [ROW(5), ROW(4), ROW(5)])).toThrow(/row 1/)
  })

  it('throws when the map has two doors', () => {
    expect(() => defineMap('village', ['BDB,', 'BDB,', ',,,,'])).toThrow(/exactly one door/)
  })

  it('has shop null and spawns on the first walkable tile when there is no door', () => {
    const map = defineMap('river', ['TTTT', 'T,,T', 'TTTT'])
    expect(map.shop).toBeNull()
    expect(shopSpot(map)).toBeNull()
    expect(pierEnd(map)).toBeNull()
    expect(map.spawn).toEqual({ pos: center(1, 1), facing: 'down' })
    expect([map.w, map.h]).toEqual([4, 3])
  })

  it('computes the shop and spawns in front of the door', () => {
    const map = defineMap('village', ['BBB,', 'BDB,', ',,,,'])
    expect(map.shop).toEqual({ tx: 0, ty: 0, w: 3, h: 2, doorTx: 1 })
    expect(shopSpot(map)).toEqual({ tx: 1, ty: 2 })
    expect(map.spawn).toEqual({ pos: center(1, 2), facing: 'down' })
  })
})

import { describe, expect, it } from 'vitest'
import {
  ALL_AREAS_OPEN,
  MAX_HOLES,
  STATIC_DYNAMIC,
  TILE,
  TILE_CHARS,
  WATER_KINDS,
  castTarget,
  defineMap,
  exitAt,
  interactionAt,
  isWalkable,
  openExitAt,
  pierEnd,
  reachableTiles,
  shopSpot,
  spotFor,
  tileAt,
  tileOf,
  type Dock,
  type Exit,
  addHole,
  nearestDryTile,
  type Facing,
  type Gate,
  type MapDynamic,
  type Opened,
  type Teleporter,
  type TileKind,
  type Vec,
} from './map.ts'
import type { AreaId } from './data.ts'
import { VILLAGE } from './maps/village.ts'
import { RIVER } from './maps/river.ts'
import { DEFAULT_AREAS } from './data.ts'
import { feetBlocked, stepWalk, type Player } from './walk.ts'

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
      if (!isWalkable(VILLAGE, n.tx, n.ty, ALL_AREAS_OPEN) || dist.has(key)) continue
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

  it('walkable kinds are exactly sand, grass, path, pier, flower, dock (순간이동기 칸 제외)', () => {
    const t = VILLAGE.teleporter!.tiles
    const underTeleporter = (tx: number, ty: number) => tx >= t.tx && tx < t.tx + t.w && ty >= t.ty && ty < t.ty + t.h
    const walkable = new Set<TileKind>()
    for (const { tx, ty } of allTiles()) if (isWalkable(VILLAGE, tx, ty, ALL_AREAS_OPEN)) walkable.add(tileAt(VILLAGE, tx, ty)!)
    expect([...walkable].sort()).toEqual(['dock', 'flower', 'grass', 'path', 'pier', 'sand'])
    for (const { tx, ty } of allTiles()) {
      const k = tileAt(VILLAGE, tx, ty)!
      const expected = !underTeleporter(tx, ty) && ['sand', 'grass', 'path', 'pier', 'flower', 'dock'].includes(k)
      expect(isWalkable(VILLAGE, tx, ty, ALL_AREAS_OPEN), `(${tx},${ty})`).toBe(expected)
    }
  })

  it('border tiles are not walkable except the north exit', () => {
    for (let tx = 0; tx < MAP_W; tx++) {
      const isExit = exitAt(VILLAGE, center(tx, 0)) !== null
      expect(isWalkable(VILLAGE, tx, 0, ALL_AREAS_OPEN), `(${tx},0)`).toBe(isExit)
      expect(isWalkable(VILLAGE, tx, MAP_H - 1, ALL_AREAS_OPEN), `(${tx},${MAP_H - 1})`).toBe(false)
    }
    for (let ty = 0; ty < MAP_H; ty++) {
      expect(isWalkable(VILLAGE, 0, ty, ALL_AREAS_OPEN), `(0,${ty})`).toBe(false)
      expect(isWalkable(VILLAGE, MAP_W - 1, ty, ALL_AREAS_OPEN), `(${MAP_W - 1},${ty})`).toBe(false)
    }
  })

  it('outside the map is null and not walkable', () => {
    expect(tileAt(VILLAGE, -1, 0)).toBeNull()
    expect(tileAt(VILLAGE, 0, -1)).toBeNull()
    expect(tileAt(VILLAGE, MAP_W, 0)).toBeNull()
    expect(tileAt(VILLAGE, 0, MAP_H)).toBeNull()
    expect(isWalkable(VILLAGE, MAP_W, 0, ALL_AREAS_OPEN)).toBe(false)
    expect(isWalkable(VILLAGE, -1, 5, ALL_AREAS_OPEN)).toBe(false)
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
    expect(isWalkable(VILLAGE, SHOP_SPOT.tx, SHOP_SPOT.ty, ALL_AREAS_OPEN)).toBe(true)
  })

  it('SPAWN facing up interacts with the shop; other facings do not', () => {
    expect(interactionAt(VILLAGE, SPAWN.pos, 'up', ALL_AREAS_OPEN)).toEqual({ kind: 'shop' })
    expect(interactionAt(VILLAGE, SPAWN.pos, 'down', ALL_AREAS_OPEN)).toBeNull()
    expect(interactionAt(VILLAGE, SPAWN.pos, 'left', ALL_AREAS_OPEN)).toBeNull()
    expect(interactionAt(VILLAGE, SPAWN.pos, 'right', ALL_AREAS_OPEN)).toBeNull()
  })

  it('SHOP_SPOT is the only tile in the map with a shop interaction', () => {
    const shopTiles: { tx: number; ty: number }[] = []
    for (const { tx, ty } of allTiles()) {
      for (const f of FACINGS) {
        const hit = interactionAt(VILLAGE, center(tx, ty), f, ALL_AREAS_OPEN)
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
    expect(interactionAt(VILLAGE, center(PIER_END.tx, PIER_END.ty), 'down', ALL_AREAS_OPEN)).toEqual({ kind: 'fish', spot: 'pier' })
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
    expect(interactionAt(VILLAGE, pos, 'down', ALL_AREAS_OPEN)).toEqual({ kind: 'fish', spot: 'shore' })
    expect(interactionAt(VILLAGE, pos, 'up', ALL_AREAS_OPEN)).toBeNull()
  })

  it('the beach is long enough to fish from many shore tiles', () => {
    const shoreTiles = allTiles().filter(
      ({ tx, ty }) => tileAt(VILLAGE, tx, ty) === 'sand' && FACINGS.some((f) => interactionAt(VILLAGE, center(tx, ty), f, ALL_AREAS_OPEN)?.kind === 'fish'),
    )
    expect(shoreTiles.length).toBeGreaterThanOrEqual(20)
  })

  it('uses the foot position, not the tile corner, to pick the standing tile', () => {
    const p = center(PIER_END.tx, PIER_END.ty)
    expect(interactionAt(VILLAGE, { x: p.x - 7.9, y: p.y + 7.9 }, 'down', ALL_AREAS_OPEN)).toEqual({ kind: 'fish', spot: 'pier' })
  })
})

describe('reachability', () => {
  const dist = bfs(SHOP_SPOT)

  it('PIER_END and every walkable tile next to water are reachable from SPAWN', () => {
    expect(dist.has(`${PIER_END.tx},${PIER_END.ty}`)).toBe(true)
    for (const { tx, ty } of allTiles()) {
      if (!isWalkable(VILLAGE, tx, ty, ALL_AREAS_OPEN)) continue
      const nearWater = Object.values(DIRS).some(({ dx, dy }) => tileAt(VILLAGE, tx + dx, ty + dy) === 'water')
      if (nearWater) expect(dist.has(`${tx},${ty}`), `(${tx},${ty})`).toBe(true)
    }
  })

  it('every walkable tile is reachable (no sealed pockets)', () => {
    for (const { tx, ty } of allTiles()) if (isWalkable(VILLAGE, tx, ty, ALL_AREAS_OPEN)) expect(dist.has(`${tx},${ty}`), `(${tx},${ty})`).toBe(true)
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
      if (!isWalkable(VILLAGE, tx, ty, ALL_AREAS_OPEN)) continue
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
    expect(isWalkable(REGION, 2, 4, ALL_AREAS_OPEN)).toBe(true)
    for (const [tx, ty] of [[0, 4], [1, 1], [2, 2], [0, 5], [1, 5]]) expect(isWalkable(REGION, tx, ty, ALL_AREAS_OPEN), `${tx},${ty}`).toBe(false)
  })

  it('WATER_KINDS holds the fishable water kinds only (falls excluded)', () => {
    expect([...WATER_KINDS].sort()).toEqual(['basin', 'bog', 'cave-pool', 'creek', 'crystal', 'lagoon', 'lake', 'lava', 'marsh', 'pond', 'river', 'water'])
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
    expect(interactionAt(wall, center(0, 0), 'down', ALL_AREAS_OPEN)).toBeNull() // 폭포
    expect(interactionAt(wall, center(1, 0), 'down', ALL_AREAS_OPEN)).toBeNull() // 절벽
  })

  it('on the bridge, facing the river fishes river', () => {
    expect(interactionAt(REGION, center(2, 4), 'down', ALL_AREAS_OPEN)).toEqual({ kind: 'fish', spot: 'river' })
    expect(interactionAt(REGION, center(2, 4), 'left', ALL_AREAS_OPEN)).toEqual({ kind: 'fish', spot: 'river' })
    expect(interactionAt(REGION, center(2, 4), 'right', ALL_AREAS_OPEN)).toEqual({ kind: 'fish', spot: 'river' })
  })

  it('from the grass, a pond and a basin give their spots', () => {
    expect(interactionAt(REGION, center(0, 1), 'right', ALL_AREAS_OPEN)).toEqual({ kind: 'fish', spot: 'pond' })
    expect(interactionAt(REGION, center(3, 3), 'up', ALL_AREAS_OPEN)).toEqual({ kind: 'fish', spot: 'waterfall' })
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

// ── 3단계: 문(gate)·선착장(dock)·안쪽 출구와 열린 지역 ─────────────────
describe('문·선착장·안쪽 출구', () => {
  // 0 TTTTTTTTTT
  // 1 T,,,,,,,,T   (1,1)~(2,1) 안쪽 출구, (8,1) 돌무더기 문(9,1 나무까지 덮음)
  // 2 TrrrHrrrrT   (4,2) 다리 = 무너진 다리 문
  // 3 T,,,,,...T   (4,3)에서 위를 보면 문
  // 4 T,,,,,.#.T
  // 5 T~~~~~~#~T   (7,5) 선착장 front(왼쪽), 배 (5,5)
  // 6 T~~~~~~#~T   (7,6) 부두 끝
  // 7 T~~~~~~~~T
  // 8 TTTTTTTTTT
  const ROWS = [
    'TTTTTTTTTT',
    'T,,,,,,,,T',
    'TrrrHrrrrT',
    'T,,,,,...T',
    'T,,,,,.#.T',
    'T~~~~~~#~T',
    'T~~~~~~#~T',
    'T~~~~~~~~T',
    'TTTTTTTTTT',
  ]
  const BRIDGE_GATE: Gate = { area: 'lake', tiles: { tx: 4, ty: 2, w: 1, h: 1 }, look: 'broken-bridge', front: { tx: 4, ty: 3, facing: 'up' } }
  const RUBBLE_GATE: Gate = { area: 'cave', tiles: { tx: 8, ty: 1, w: 2, h: 1 }, look: 'rubble', front: { tx: 7, ty: 1, facing: 'right' } }
  const DOCK: Dock = { front: { tx: 7, ty: 5, facing: 'left' }, target: 'island', entry: { tx: 2, ty: 2, facing: 'down' }, boat: { tx: 5, ty: 5 } }
  const CAVE_EXIT: Exit = { at: { tx: 1, ty: 1, w: 2, h: 1 }, target: 'cave', entry: { tx: 3, ty: 3, facing: 'down' } }
  const make = (extra: { gates?: Gate[]; docks?: Dock[] } = {}) =>
    defineMap('river', ROWS, {
      spots: { river: 'river', water: 'sea' },
      gates: extra.gates ?? [BRIDGE_GATE, RUBBLE_GATE],
      docks: extra.docks ?? [DOCK],
      exits: [CAVE_EXIT],
    })
  const MAP = make()
  const BASE: Opened = new Set<AreaId>(['village', 'river', 'forest'])
  const ALL: Opened = new Set<AreaId>(['village', 'river', 'forest', 'lake', 'cave', 'island'])

  it('defineMap 기본값: 문·선착장 없음, indoor false. 지정하면 그대로', () => {
    const plain = defineMap('river', ['TTTT', 'T,,T', 'TTTT'])
    expect(plain.gates).toEqual([])
    expect(plain.docks).toEqual([])
    expect(plain.indoor).toBe(false)
    expect(MAP.gates).toEqual([BRIDGE_GATE, RUBBLE_GATE])
    expect(MAP.docks).toEqual([DOCK])
    expect(defineMap('cave', ['TTTT', 'T,,T', 'TTTT'], { indoor: true }).indoor).toBe(true)
  })

  it('isWalkable: 문 칸은 opened에 그 지역이 없으면 false, 있으면 rows 원래 칸의 규칙대로', () => {
    expect(isWalkable(MAP, 4, 2, BASE)).toBe(false)
    expect(isWalkable(MAP, 4, 2, ALL)).toBe(true) // 다리
    expect(isWalkable(MAP, 8, 1, BASE)).toBe(false)
    expect(isWalkable(MAP, 8, 1, ALL)).toBe(true) // 풀
    expect(isWalkable(MAP, 9, 1, ALL)).toBe(false) // 원래 나무
    // 그 지역만 열려도 된다(다른 문은 그대로 잠김)
    const lakeOnly: Opened = new Set<AreaId>([...BASE, 'lake'])
    expect(isWalkable(MAP, 4, 2, lakeOnly)).toBe(true)
    expect(isWalkable(MAP, 8, 1, lakeOnly)).toBe(false)
    // 문 밖 칸은 열림과 무관
    expect(isWalkable(MAP, 3, 2, ALL)).toBe(false)
    expect(isWalkable(MAP, 4, 3, BASE)).toBe(true)
  })

  it('interactionAt: 잠긴 문 front에서 facing을 보면 gate, 열린 뒤에는 gate가 아니다', () => {
    expect(interactionAt(MAP, center(4, 3), 'up', BASE)).toEqual({ kind: 'gate', area: 'lake' })
    expect(interactionAt(MAP, center(4, 3), 'up', ALL)).toBeNull() // 앞이 다리
    expect(interactionAt(MAP, center(4, 3), 'left', BASE)).toBeNull() // 방향이 다르면 아님
    expect(interactionAt(MAP, center(7, 1), 'right', BASE)).toEqual({ kind: 'gate', area: 'cave' })
    expect(interactionAt(MAP, center(7, 1), 'right', ALL)).toBeNull()
  })

  it('interactionAt: 선착장 front → dock(열림 여부와 무관), 부두 끝에서 물 → 낚시 pier 그대로', () => {
    expect(interactionAt(MAP, center(7, 5), 'left', BASE)).toEqual({ kind: 'dock', target: 'island' })
    expect(interactionAt(MAP, center(7, 5), 'left', ALL)).toEqual({ kind: 'dock', target: 'island' })
    expect(interactionAt(MAP, center(7, 5), 'right', BASE)).toEqual({ kind: 'fish', spot: 'pier' })
    expect(interactionAt(MAP, center(7, 6), 'left', BASE)).toEqual({ kind: 'fish', spot: 'pier' })
    expect(interactionAt(MAP, center(7, 6), 'down', BASE)).toEqual({ kind: 'fish', spot: 'pier' })
    expect(interactionAt(MAP, center(5, 3), 'up', BASE)).toEqual({ kind: 'fish', spot: 'river' })
  })

  it('exitAt: at 출구 사각형 안 칸 → 그 출구, 밖 → null', () => {
    expect(exitAt(MAP, center(1, 1))).toBe(CAVE_EXIT)
    expect(exitAt(MAP, center(2, 1))).toBe(CAVE_EXIT)
    expect(exitAt(MAP, { x: 2 * TILE + TILE - 0.01, y: TILE + 1 })).toBe(CAVE_EXIT)
    expect(exitAt(MAP, center(3, 1))).toBeNull()
    expect(exitAt(MAP, center(1, 3))).toBeNull()
  })

  it('openExitAt: 안 연 지역으로 가는 출구는 null, 열면 그 출구(실제 강 북쪽 출구)', () => {
    const base: Opened = new Set<AreaId>(DEFAULT_AREAS)
    const lakeExit = RIVER.exits.find((e) => e.target === 'lake')!
    for (const tx of [24, 25]) {
      expect(exitAt(RIVER, center(tx, 0))).toBe(lakeExit)
      expect(openExitAt(RIVER, center(tx, 0), base)).toBeNull()
      expect(openExitAt(RIVER, center(tx, 0), new Set<AreaId>([...DEFAULT_AREAS, 'lake']))).toBe(lakeExit)
    }
    // 기본 지역으로 가는 출구는 그대로
    const south = RIVER.exits.find((e) => e.target === 'village')!
    expect(openExitAt(RIVER, center(24, RIVER.h - 1), base)).toBe(south)
    expect(openExitAt(RIVER, center(10, 10), base)).toBeNull()
  })

  it('reachableTiles: 시작 칸에서 열린 지역 기준으로 걸어 닿는 칸. 잠긴 문 너머는 빠지고, 못 걷는 시작 칸은 무시', () => {
    const base: Opened = new Set<AreaId>(DEFAULT_AREAS)
    const start = [{ tx: 24, ty: 4 }]
    const closed = reachableTiles(RIVER, start, base)
    expect(closed.has('24,4')).toBe(true)
    expect(closed.has('24,2')).toBe(false)
    expect(closed.has('24,1')).toBe(false)
    expect(closed.has('24,0')).toBe(false)
    const open = reachableTiles(RIVER, start, new Set<AreaId>([...DEFAULT_AREAS, 'lake']))
    expect(open.has('24,1')).toBe(true)
    expect(open.has('25,0')).toBe(true)
    // 시작 칸이 못 걷는 칸(나무)이면 아무 칸도 없다
    expect(reachableTiles(RIVER, [{ tx: 0, ty: 0 }], base).size).toBe(0)
  })

  it('defineMap: 문 칸이 맵 밖이면 throw, 선착장 front가 못 걷는 칸이면 throw', () => {
    expect(() => make({ gates: [{ ...RUBBLE_GATE, tiles: { tx: 9, ty: 1, w: 2, h: 1 } }] })).toThrow(/gate/)
    expect(() => make({ gates: [{ ...RUBBLE_GATE, tiles: { tx: 8, ty: -1, w: 1, h: 2 } }] })).toThrow(/gate/)
    expect(() => make({ docks: [{ ...DOCK, front: { tx: 7, ty: 7, facing: 'left' } }] })).toThrow(/dock/)
    expect(() => make({ docks: [{ ...DOCK, front: { tx: 0, ty: 3, facing: 'left' } }] })).toThrow(/dock/)
  })
})

// ── 3단계: 산 호수·동굴·섬 타일 ─────────────────────────────────────
describe('산 호수·동굴·섬 타일', () => {
  // 글자 열 개를 한 줄에. 첫 걸을 수 있는 칸('_')이 시작 위치가 된다
  const ROW = defineMap('island', ['k_WuqLEPlK'])
  const KINDS: [string, TileKind, boolean][] = [
    ['k', 'lake', false],
    ['_', 'cave-floor', true],
    ['W', 'cave-wall', false],
    ['u', 'cave-pool', false],
    ['q', 'crystal', false],
    ['L', 'lava', false],
    ['E', 'cave-mouth', true],
    ['P', 'palm', false],
    ['l', 'lagoon', false],
    ['K', 'dock', true],
  ]

  it('글자 → kind, 걷기는 표대로(동굴 바닥·입구·선착장만 걷는다)', () => {
    KINDS.forEach(([ch, kind, walk], tx) => {
      expect(TILE_CHARS[ch], ch).toBe(kind)
      expect(tileAt(ROW, tx, 0), ch).toBe(kind)
      expect(isWalkable(ROW, tx, 0, ALL_AREAS_OPEN), kind).toBe(walk)
    })
  })

  it('물 종류: 호수·동굴 웅덩이·수정·용암·석호. 동굴 바닥·벽·입구·야자수·선착장은 물이 아니다', () => {
    for (const kind of ['lake', 'cave-pool', 'crystal', 'lava', 'lagoon'] as const) expect(WATER_KINDS.has(kind), kind).toBe(true)
    for (const kind of ['cave-floor', 'cave-wall', 'cave-mouth', 'palm', 'dock'] as const) expect(WATER_KINDS.has(kind), kind).toBe(false)
  })

  it('spotFor: 산 호수는 lake 자리', () => {
    const lake = defineMap('lake', [',k'], { spots: { lake: 'lake' } })
    expect(spotFor(lake, 'grass', 'lake')).toBe('lake')
    expect(spotFor(lake, 'grass', 'water')).toBeNull()
  })

  it('spotFor: 동굴은 웅덩이 cave1, 수정 cave2, 용암 cave3. 벽·입구 앞은 null', () => {
    const cave = defineMap('cave', ['_uqL'], { spots: { 'cave-pool': 'cave1', crystal: 'cave2', lava: 'cave3' }, indoor: true })
    expect(spotFor(cave, 'cave-floor', 'cave-pool')).toBe('cave1')
    expect(spotFor(cave, 'cave-floor', 'crystal')).toBe('cave2')
    expect(spotFor(cave, 'cave-floor', 'lava')).toBe('cave3')
    expect(spotFor(cave, 'cave-floor', 'cave-wall')).toBeNull()
    expect(spotFor(cave, 'cave-floor', 'cave-mouth')).toBeNull()
    expect(spotFor(cave, 'cave-floor', 'lake')).toBeNull()
  })

  it('spotFor: 섬은 바다 sea, 석호 lagoon. 선착장 위에서 바다를 봐도 부두(pier) 보너스가 아니다', () => {
    const island = defineMap('island', ['.l', 'K~'], { spots: { water: 'sea', lagoon: 'lagoon' } })
    expect(spotFor(island, 'sand', 'lagoon')).toBe('lagoon')
    expect(spotFor(island, 'sand', 'water')).toBe('sea')
    expect(spotFor(island, 'dock', 'water')).toBe('sea')
    expect(spotFor(island, 'dock', 'lagoon')).toBe('lagoon')
    expect(spotFor(island, 'sand', 'palm')).toBeNull()
  })

  it('interactionAt: 동굴 바닥에서 용암을 보면 cave3 낚시, 벽을 보면 null', () => {
    const cave = defineMap('cave', ['WWW', 'W_L', 'WWW'], { spots: { 'cave-pool': 'cave1', crystal: 'cave2', lava: 'cave3' }, indoor: true })
    expect(interactionAt(cave, center(1, 1), 'right', ALL_AREAS_OPEN)).toEqual({ kind: 'fish', spot: 'cave3' })
    expect(interactionAt(cave, center(1, 1), 'up', ALL_AREAS_OPEN)).toBeNull()
  })

  it('castTarget: 수정 웅덩이에서 용암으로 이어 날아가고 동굴 바닥 앞에서 멈춘다', () => {
    const cave = defineMap('cave', ['_qqLL_'], { spots: { crystal: 'cave2', lava: 'cave3' } })
    expect(castTarget(cave, center(0, 0), 'right', 1)).toEqual(center(4, 0))
    const lavaOnly = defineMap('cave', ['_LLLLLLL'], { spots: { lava: 'cave3' } })
    expect(castTarget(lavaOnly, center(0, 0), 'right', 1)).toEqual({ x: center(0, 0).x + 5 * TILE, y: center(0, 0).y })
  })
})

describe('순간이동기', () => {
  // 0 TTTTTTTTTT
  // 1 T,,,,,,,,T
  // 2 T,,,,,,,,T   (4,2)~(5,3) 순간이동기 2×2
  // 3 T,,,,,,,,T
  // 4 T,,,,,,,,T   (4,4) 도착 자리(아래를 본다)
  // 5 T~~~~~~~~T
  // 6 TTTTTTTTTT
  const ROWS = [
    'TTTTTTTTTT',
    'T,,,,,,,,T',
    'T,,,,,,,,T',
    'T,,,,,,,,T',
    'T,,,,,,,,T',
    'T~~~~~~~~T',
    'TTTTTTTTTT',
  ]
  const TP: Teleporter = { tiles: { tx: 4, ty: 2, w: 2, h: 2 }, front: { tx: 4, ty: 4, facing: 'down' } }
  const make = (teleporter: Teleporter | null = TP, world = { tx: 7, ty: -3 }) =>
    defineMap('river', ROWS, { spots: { water: 'sea' }, teleporter: teleporter ?? undefined, world })
  const MAP = make()
  const at = (tx: number, ty: number): Vec => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })

  it('defineMap 기본값: world {0,0}, teleporter null. 지정하면 그대로', () => {
    const plain = defineMap('river', ['TTTT', 'T,,T', 'TTTT'])
    expect(plain.world).toEqual({ tx: 0, ty: 0 })
    expect(plain.teleporter).toBeNull()
    expect(MAP.world).toEqual({ tx: 7, ty: -3 })
    expect(MAP.teleporter).toEqual(TP)
  })

  it('이동기 칸은 어떤 열림에서도 못 걷고 옆 칸은 걷는다; 발도 걸린다', () => {
    for (const [tx, ty] of [[4, 2], [5, 2], [4, 3], [5, 3]]) {
      expect(isWalkable(MAP, tx, ty, ALL_AREAS_OPEN), `${tx},${ty}`).toBe(false)
      expect(isWalkable(MAP, tx, ty, new Set<AreaId>(DEFAULT_AREAS)), `${tx},${ty}`).toBe(false)
    }
    for (const [tx, ty] of [[3, 2], [6, 3], [4, 1], [5, 4]]) expect(isWalkable(MAP, tx, ty, ALL_AREAS_OPEN), `${tx},${ty}`).toBe(true)
    expect(feetBlocked(MAP, at(4, 2).x, at(4, 2).y, ALL_AREAS_OPEN)).toBe(true)
    expect(feetBlocked(MAP, at(4, 4).x, at(4, 4).y, ALL_AREAS_OPEN)).toBe(false)
  })

  it('stepWalk: 이동기로 걸으면 그 앞에서 멈춘다', () => {
    let p: Player = { pos: at(4, 4), facing: 'up', moving: false, walkMs: 0 }
    for (let i = 0; i < 60; i++) p = stepWalk(MAP, p, { x: 0, y: -1 }, 16, ALL_AREAS_OPEN)
    expect(tileOf(p.pos)).toEqual({ tx: 4, ty: 4 })
  })

  it('interactionAt: 구조물을 아래·옆·위에서 보면 teleporter, 등지거나 옆을 보면 아님', () => {
    const cases: [number, number, Facing][] = [[4, 4, 'up'], [5, 4, 'up'], [3, 2, 'right'], [6, 3, 'left'], [4, 1, 'down'], [5, 1, 'down']]
    for (const [tx, ty, f] of cases) expect(interactionAt(MAP, at(tx, ty), f, ALL_AREAS_OPEN), `${tx},${ty} ${f}`).toEqual({ kind: 'teleporter' })
    for (const [tx, ty, f] of [[4, 4, 'down'], [4, 4, 'left'], [3, 2, 'left'], [6, 4, 'up']] as [number, number, Facing][]) {
      expect(interactionAt(MAP, at(tx, ty), f, ALL_AREAS_OPEN)?.kind, `${tx},${ty} ${f}`).not.toBe('teleporter')
    }
    // 도착 자리에서 도착 방향 그대로는 다시 열리지 않는다
    expect(interactionAt(MAP, at(TP.front.tx, TP.front.ty), TP.front.facing, ALL_AREAS_OPEN)?.kind).not.toBe('teleporter')
  })

  it('이동기가 없는 맵은 teleporter 상호작용이 없다', () => {
    const plain = make(null)
    expect(plain.teleporter).toBeNull()
    expect(interactionAt(plain, at(4, 4), 'up', ALL_AREAS_OPEN)).toBeNull()
  })

  it('defineMap: 칸이 맵 밖·물 위·나무 위, front가 칸 안·떨어짐·못 걷는 칸, front.facing이 구조물을 보면 throw', () => {
    const bad: Teleporter[] = [
      { ...TP, tiles: { tx: 8, ty: 2, w: 2, h: 2 } },
      { ...TP, tiles: { tx: 4, ty: 4, w: 2, h: 2 } },
      { ...TP, tiles: { tx: 0, ty: 2, w: 2, h: 2 } },
      { ...TP, front: { tx: 4, ty: 3, facing: 'down' } },
      { ...TP, front: { tx: 7, ty: 4, facing: 'down' } },
      { ...TP, front: { tx: 4, ty: 5, facing: 'down' } },
      { ...TP, front: { tx: 4, ty: 4, facing: 'up' } },
    ]
    for (const t of bad) expect(() => make(t), JSON.stringify(t)).toThrow(/teleporter/)
    // 옆이나 위에 붙은 도착 자리는 된다
    expect(() => make({ ...TP, front: { tx: 6, ty: 2, facing: 'right' } })).not.toThrow()
    expect(() => make({ ...TP, front: { tx: 5, ty: 1, facing: 'up' } })).not.toThrow()
  })
})

// ---------------------------------------------------------------- 낚시 5부 M1: 움직이는 맵 상태(진흙·얼음 구멍)

describe('움직이는 맵 상태: 진흙(물때)', () => {
  // 모래 / 진흙 / 진흙 가운데 갯골(강물 r) / 진흙 / 바다
  const FLAT = defineMap('village', ['........', '.mmmmmm.', '.mmrrmm.', '.mmmmmm.', '~~~~~~~~'], {
    tidal: true, spots: { water: 'shore', mud: 'shore', river: 'creek' },
  })
  const LOW: MapDynamic = { tide: 'low', holes: new Set() }
  const HIGH: MapDynamic = { tide: 'high', holes: new Set() }

  it('defineMap 옵션: tidal·fog·snowy 기본 false, STATIC_DYNAMIC은 밀물·구멍 없음', () => {
    expect(FLAT.tidal).toBe(true)
    expect([FLAT.fog, FLAT.snowy]).toEqual([false, false])
    expect(VILLAGE.tidal || VILLAGE.fog || VILLAGE.snowy).toBe(false)
    expect(STATIC_DYNAMIC.tide).toBe('high')
    expect(STATIC_DYNAMIC.holes.size).toBe(0)
    expect(TILE_CHARS.m).toBe('mud')
    expect(TILE_CHARS.i).toBe('ice')
  })
  it('mud: 밀물이면 못 걷고 그 칸을 보면 fish(spots.mud), 썰물이면 걷고 낚시 불가', () => {
    expect(isWalkable(FLAT, 1, 1, ALL_AREAS_OPEN)).toBe(false)
    expect(isWalkable(FLAT, 1, 1, ALL_AREAS_OPEN, HIGH)).toBe(false)
    expect(isWalkable(FLAT, 1, 1, ALL_AREAS_OPEN, LOW)).toBe(true)
    expect(interactionAt(FLAT, center(1, 0), 'down', ALL_AREAS_OPEN)).toEqual({ kind: 'fish', spot: 'shore' })
    expect(interactionAt(FLAT, center(1, 0), 'down', ALL_AREAS_OPEN, LOW)).toBeNull()
  })
  it('썰물에만 진흙 위에서 갯골을 본다; 밀물에는 모래에서 갯골에 닿지 않는다', () => {
    expect(interactionAt(FLAT, center(3, 1), 'down', ALL_AREAS_OPEN, LOW)).toEqual({ kind: 'fish', spot: 'creek' })
    const reachHigh = reachableTiles(FLAT, [{ tx: 0, ty: 0 }], ALL_AREAS_OPEN)
    expect(reachHigh.has('3,1')).toBe(false)
    const reachLow = reachableTiles(FLAT, [{ tx: 0, ty: 0 }], ALL_AREAS_OPEN, LOW)
    expect(reachLow.has('3,1')).toBe(true)
    expect(reachLow.has('3,2')).toBe(false)
  })
  it('castTarget: 밀물 진흙 위로 찌가 날아가고, 썰물이면 앞 칸에서 멈춘다', () => {
    expect(castTarget(FLAT, center(2, 0), 'down', 1)).toEqual(center(2, 4))
    expect(castTarget(FLAT, center(2, 0), 'down', 1, HIGH)).toEqual(center(2, 4))
    expect(castTarget(FLAT, center(2, 0), 'down', 1, LOW)).toEqual(center(2, 1))
  })
  it('walk: 썰물에만 진흙으로 걸어 들어간다', () => {
    const p: Player = { pos: center(1, 0), facing: 'down', moving: false, walkMs: 0 }
    expect(feetBlocked(FLAT, center(1, 1).x, center(1, 1).y, ALL_AREAS_OPEN)).toBe(true)
    expect(feetBlocked(FLAT, center(1, 1).x, center(1, 1).y, ALL_AREAS_OPEN, LOW)).toBe(false)
    let a = p
    let b = p
    for (let i = 0; i < 20; i++) {
      a = stepWalk(FLAT, a, { x: 0, y: 1 }, 50, ALL_AREAS_OPEN)
      b = stepWalk(FLAT, b, { x: 0, y: 1 }, 50, ALL_AREAS_OPEN, LOW)
    }
    expect(tileOf(a.pos).ty).toBe(0)
    expect(tileOf(b.pos).ty).toBeGreaterThanOrEqual(1)
  })
  it('nearestDryTile: 진흙을 지나 가장 가까운 늘 걷는 칸, 같은 거리면 ty·tx 작은 쪽, 땅 위면 그 칸', () => {
    expect(nearestDryTile(FLAT, { tx: 3, ty: 3 }, ALL_AREAS_OPEN)).toEqual({ tx: 0, ty: 3 })
    expect(nearestDryTile(FLAT, { tx: 1, ty: 1 }, ALL_AREAS_OPEN)).toEqual({ tx: 1, ty: 0 })
    expect(nearestDryTile(FLAT, { tx: 6, ty: 2 }, ALL_AREAS_OPEN)).toEqual({ tx: 7, ty: 2 })
    expect(nearestDryTile(FLAT, { tx: 4, ty: 0 }, ALL_AREAS_OPEN)).toEqual({ tx: 4, ty: 0 })
    // 진흙에 갇힌 칸(둘레가 물뿐)은 null
    const sealed = defineMap('village', ['..~~', '~~m~', '~~~~'], { tidal: true })
    expect(nearestDryTile(sealed, { tx: 2, ty: 1 }, ALL_AREAS_OPEN)).toBeNull()
  })
})

describe('움직이는 맵 상태: 얼음 구멍', () => {
  const ICE = defineMap('village', [',,,,,,', ',iiii,', ',iiii,', ',,,,,,'], { snowy: true, spots: { hole: 'ice' } })
  const holes = (...keys: string[]): MapDynamic => ({ tide: 'high', holes: new Set(keys) })

  it('ice는 걷는다; 구멍이 되면 못 걷는다', () => {
    expect(ICE.snowy).toBe(true)
    expect(isWalkable(ICE, 2, 1, ALL_AREAS_OPEN)).toBe(true)
    expect(isWalkable(ICE, 2, 1, ALL_AREAS_OPEN, holes('2,1'))).toBe(false)
    expect(isWalkable(ICE, 3, 1, ALL_AREAS_OPEN, holes('2,1'))).toBe(true)
  })
  it('ice를 보면 drill(얼음 위·물가 둘 다), 구멍을 보면 fish(spots.hole)', () => {
    expect(interactionAt(ICE, center(1, 1), 'right', ALL_AREAS_OPEN)).toEqual({ kind: 'drill' })
    expect(interactionAt(ICE, center(0, 1), 'right', ALL_AREAS_OPEN)).toEqual({ kind: 'drill' })
    expect(interactionAt(ICE, center(1, 1), 'right', ALL_AREAS_OPEN, holes('2,1'))).toEqual({ kind: 'fish', spot: 'ice' })
  })
  it('spots.hole이 없는 맵의 얼음은 뚫지 않는다', () => {
    const plain = defineMap('village', [',i,'])
    expect(interactionAt(plain, center(0, 0), 'right', ALL_AREAS_OPEN)).toBeNull()
  })
  it('castTarget: 구멍 하나면 그 구멍 칸 가운데; 구멍 없으면 앞 칸', () => {
    expect(castTarget(ICE, center(1, 1), 'right', 1, holes('2,1'))).toEqual(center(2, 1))
    expect(castTarget(ICE, center(1, 1), 'right', 1)).toEqual(center(2, 1))
  })
  it('addHole: 같은 칸 두 번은 하나, MAX_HOLES 넘으면 가장 오래된 것을 뺀다, 입력은 그대로', () => {
    expect(MAX_HOLES).toBe(3)
    expect(addHole([], 1, 2)).toEqual(['1,2'])
    expect(addHole(['1,2'], 1, 2)).toEqual(['1,2'])
    const three = ['1,1', '2,1', '3,1']
    expect(addHole(three, 4, 1)).toEqual(['2,1', '3,1', '4,1'])
    expect(three).toEqual(['1,1', '2,1', '3,1'])
  })
})

// ---------------------------------------------------------------- 낚시 5부 M2: 갯벌·늪지 타일

describe('갯벌·늪지 타일', () => {
  const ROW = defineMap('forest', ['dgRzQX'])
  const KINDS: [string, TileKind, boolean, boolean][] = [
    ['d', 'boardwalk', true, false],
    ['g', 'creek', false, true],
    ['R', 'reed', false, false],
    ['z', 'marsh', false, true],
    ['Q', 'bog', false, true],
    ['X', 'deadtree', false, false],
  ]
  it('글자 → kind, 걷기(데크만), 물 종류(갯골·늪·수렁)', () => {
    KINDS.forEach(([ch, kind, walk, water], tx) => {
      expect(TILE_CHARS[ch], ch).toBe(kind)
      expect(tileAt(ROW, tx, 0), ch).toBe(kind)
      expect(isWalkable(ROW, tx, 0, ALL_AREAS_OPEN), kind).toBe(walk)
      expect(WATER_KINDS.has(kind), kind).toBe(water)
    })
  })
  it('spotFor·interactionAt: 데크에서 늪은 marsh, 수렁은 bog, 갯골은 creek', () => {
    const m = defineMap('forest', ['zdQ', '.g.'], { spots: { marsh: 'marsh', bog: 'bog', creek: 'creek' } })
    expect(interactionAt(m, center(1, 0), 'left', ALL_AREAS_OPEN)).toEqual({ kind: 'fish', spot: 'marsh' })
    expect(interactionAt(m, center(1, 0), 'right', ALL_AREAS_OPEN)).toEqual({ kind: 'fish', spot: 'bog' })
    expect(interactionAt(m, center(1, 0), 'down', ALL_AREAS_OPEN)).toEqual({ kind: 'fish', spot: 'creek' })
    expect(spotFor(m, 'boardwalk', 'reed')).toBeNull()
    expect(spotFor(m, 'boardwalk', 'deadtree')).toBeNull()
  })
  it('castTarget: 늪·수렁이 섞여도 물로 계속 날아간다, 갈대 앞에서 멈춘다', () => {
    const m = defineMap('forest', ['dzzQQR'], { spots: { marsh: 'marsh', bog: 'bog' } })
    expect(castTarget(m, center(0, 0), 'right', 1)).toEqual(center(4, 0))
  })
})

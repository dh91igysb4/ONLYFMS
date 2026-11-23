import { describe, expect, it } from 'vitest'
import { AREAS, DEFAULT_AREAS, type AreaId } from '../data.ts'
import {
  ALL_AREAS_OPEN,
  TILE,
  TILE_CHARS,
  exitAt,
  interactionAt,
  isWalkable,
  pierEnd,
  shopSpot,
  spotFor,
  tileAt,
  type Exit,
  type Facing,
  type MapDef,
  type Opened,
  type TileFacing,
  type Vec,
} from '../map.ts'
import { feetBlocked } from '../walk.ts'
import { MAPS, mapFor } from './index.ts'

type Tile = { tx: number; ty: number }

const DIRS: Record<Facing, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}
const FACINGS: Facing[] = ['up', 'down', 'left', 'right']
const ALL = Object.values(MAPS) as MapDef[]

const center = (tx: number, ty: number): Vec => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })
const key = (t: Tile): string => `${t.tx},${t.ty}`

function allTiles(map: MapDef): Tile[] {
  const out: Tile[] = []
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) out.push({ tx, ty })
  return out
}

/** 출구 칸: 가장자리 출구는 그 가장자리 줄의 from..to 범위, 안쪽 출구는 at 사각형 안의 걸을 수 있는 칸 */
function exitTiles(map: MapDef, exit: Exit): Tile[] {
  const out: Tile[] = []
  if ('at' in exit) {
    for (let ty = exit.at.ty; ty < exit.at.ty + exit.at.h; ty++)
      for (let tx = exit.at.tx; tx < exit.at.tx + exit.at.w; tx++) if (isWalkable(map, tx, ty, ALL_AREAS_OPEN)) out.push({ tx, ty })
    return out
  }
  for (let i = exit.from; i <= exit.to; i++) {
    const t =
      exit.edge === 'n' ? { tx: i, ty: 0 }
      : exit.edge === 's' ? { tx: i, ty: map.h - 1 }
      : exit.edge === 'w' ? { tx: 0, ty: i }
      : { tx: map.w - 1, ty: i }
    if (isWalkable(map, t.tx, t.ty, ALL_AREAS_OPEN)) out.push(t)
  }
  return out
}

/** 출구 종류: 가장자리 방향(n/s/e/w) 또는 안쪽 출구 'at' */
const exitSide = (e: Exit): string => ('edge' in e ? e.edge : 'at')

function onBorder(map: MapDef, t: Tile): boolean {
  return t.tx === 0 || t.ty === 0 || t.tx === map.w - 1 || t.ty === map.h - 1
}

/** 기본 지역(마을·강·숲)만 열린 상태 */
const BASE_OPEN: Opened = new Set<AreaId>(DEFAULT_AREAS)

// 4방향 BFS. 시작 타일에서 각 걷기 타일까지의 걸음 수. opened를 주지 않으면 모든 지역이 열린 것으로 본다.
function bfs(map: MapDef, from: Tile, opened: Opened = ALL_AREAS_OPEN): Map<string, number> {
  const dist = new Map<string, number>([[key(from), 0]])
  const queue = [from]
  for (let i = 0; i < queue.length; i++) {
    const { tx, ty } = queue[i]
    const d = dist.get(`${tx},${ty}`)!
    for (const { dx, dy } of Object.values(DIRS)) {
      const n = { tx: tx + dx, ty: ty + dy }
      if (!isWalkable(map, n.tx, n.ty, opened) || dist.has(key(n))) continue
      dist.set(key(n), d + 1)
      queue.push(n)
    }
  }
  return dist
}

/** 다른 맵에서 이 맵으로 들어오는 출구·선착장들의 도착점 */
function arrivalsInto(map: MapDef): TileFacing[] {
  return ALL.flatMap((m) => [...m.exits, ...m.docks].filter((e) => e.target === map.id).map((e) => e.entry))
}

const manhattan = (a: Tile, b: Tile): number => Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty)

/** 기본 지역에서만 들어올 수 있는 도착점(잠긴 상태에서 실제로 설 수 있는 곳). 마을은 SPAWN도 */
function baseStarts(map: MapDef): Tile[] {
  const starts = ALL.filter((m) => DEFAULT_AREAS.includes(m.id))
    .flatMap((m) => [...m.exits, ...m.docks].filter((e) => e.target === map.id).map(({ entry: { tx, ty } }) => ({ tx, ty })))
  if (map.id === 'village') starts.push(shopSpot(map)!)
  return starts
}

describe('맵 등록부', () => {
  it('여섯 지역 모두 맵이 있고 mapFor가 같은 값을 준다', () => {
    expect(Object.keys(MAPS).sort()).toEqual(['cave', 'forest', 'island', 'lake', 'river', 'village'])
    for (const { id } of AREAS) {
      expect(mapFor(id)).toBe(MAPS[id])
      expect(mapFor(id)!.id).toBe(id)
    }
  })

  it('동굴만 실내(indoor)다', () => {
    for (const map of ALL) expect(map.indoor, map.id).toBe(map.id === 'cave')
  })
})

describe.each(ALL.map((m) => [m.id, m] as const))('맵 %s', (_id, map) => {
  it('크기 범위, 행 길이 같음, 모르는 글자 없음', () => {
    expect(map.w).toBeGreaterThanOrEqual(40)
    expect(map.w).toBeLessThanOrEqual(56)
    expect(map.h).toBeGreaterThanOrEqual(30)
    expect(map.h).toBeLessThanOrEqual(40)
    expect(map.rows.length).toBe(map.h)
    for (const row of map.rows) {
      expect(row.length).toBe(map.w)
      for (const ch of row) expect(TILE_CHARS[ch], `char ${JSON.stringify(ch)}`).toBeDefined()
    }
  })

  it('테두리: 출구 칸을 빼고 걸을 수 있는 칸이 없다', () => {
    const exits = new Set(map.exits.flatMap((e) => exitTiles(map, e)).map(key))
    for (const t of allTiles(map)) {
      if (!onBorder(map, t) || !isWalkable(map, t.tx, t.ty, ALL_AREAS_OPEN)) continue
      expect(exits.has(key(t)), `(${t.tx},${t.ty})`).toBe(true)
    }
  })

  it('출구 짝: 출구나 선착장이 하나는 있고, 모든 출구(가장자리·안쪽)의 target 맵이 있고, 그 맵에 되돌아오는 출구가 있다', () => {
    expect(map.exits.length + map.docks.length).toBeGreaterThan(0)
    for (const e of map.exits) {
      expect(exitTiles(map, e).length, `${map.id}→${e.target} 출구 칸`).toBeGreaterThan(0)
      const target = mapFor(e.target)
      expect(target, `${map.id}→${e.target}`).not.toBeNull()
      expect(target!.exits.some((back) => back.target === map.id), `${e.target}→${map.id}`).toBe(true)
    }
  })

  it('선착장 짝: target 맵에 되돌아오는 선착장이 있고, entry는 그 선착장 front에서 0~2칸 안의 걸을 수 있는 칸이며 도착하자마자 배를 타지 않는다', () => {
    for (const d of map.docks) {
      const target = mapFor(d.target)!
      const back = target.docks.find((x) => x.target === map.id)
      expect(back, `${d.target}→${map.id} 선착장`).toBeDefined()
      const { tx, ty, facing } = d.entry
      const label = `${map.id}→${d.target} (${tx},${ty})`
      expect(isWalkable(target, tx, ty, ALL_AREAS_OPEN), label).toBe(true)
      expect(feetBlocked(target, center(tx, ty).x, center(tx, ty).y, ALL_AREAS_OPEN), label).toBe(false)
      expect(exitAt(target, center(tx, ty)), label).toBeNull()
      expect(manhattan(d.entry, back!.front), label).toBeLessThanOrEqual(2)
      expect(interactionAt(target, center(tx, ty), facing, ALL_AREAS_OPEN)?.kind, label).not.toBe('dock')
    }
  })

  it('도착점: 걸을 수 있고, feetBlocked가 아니고, exitAt이 null이며, 출구 칸이 아니고 되돌아가는 출구 칸에서 1~2칸 안', () => {
    const arrivals = arrivalsInto(map)
    expect(arrivals.length).toBeGreaterThan(0)
    const allExitTiles = map.exits.flatMap((e) => exitTiles(map, e))
    for (const e of ALL.flatMap((m) => m.exits.filter((x) => x.target === map.id).map((x) => ({ from: m.id, entry: x.entry })))) {
      const { tx, ty } = e.entry
      const label = `${e.from}→${map.id} (${tx},${ty})`
      expect(isWalkable(map, tx, ty, ALL_AREAS_OPEN), label).toBe(true)
      const pos = center(tx, ty)
      expect(feetBlocked(map, pos.x, pos.y, ALL_AREAS_OPEN), label).toBe(false)
      expect(exitAt(map, pos), label).toBeNull()
      for (const t of allExitTiles) expect(Math.abs(t.tx - tx) + Math.abs(t.ty - ty), label).toBeGreaterThanOrEqual(1)
      const back = map.exits.find((x) => x.target === e.from)!
      const near = Math.min(...exitTiles(map, back).map((t) => Math.abs(t.tx - tx) + Math.abs(t.ty - ty)))
      expect(near, label).toBeGreaterThanOrEqual(1)
      expect(near, label).toBeLessThanOrEqual(2)
    }
  })

  it('연결(전부 열림): 도착점(마을은 SPAWN도)에서 모든 출구 칸·선착장 front와 그 지역 모든 낚시 자리에 닿는다', () => {
    const starts: Tile[] = arrivalsInto(map).map(({ tx, ty }) => ({ tx, ty }))
    if (map.id === 'village') starts.push(shopSpot(map)!)
    const spots = AREAS.find((a) => a.id === map.id)!.spots
    for (const start of starts) {
      const dist = bfs(map, start)
      for (const e of map.exits) for (const t of exitTiles(map, e)) expect(dist.has(key(t)), `출구 칸 (${t.tx},${t.ty})`).toBe(true)
      for (const d of map.docks) expect(dist.has(key(d.front)), `선착장 front (${d.front.tx},${d.front.ty})`).toBe(true)
      for (const spot of spots) {
        const reach = allTiles(map).some(
          (t) =>
            dist.has(key(t)) &&
            FACINGS.some((f) => spotFor(map, tileAt(map, t.tx, t.ty), tileAt(map, t.tx + DIRS[f].dx, t.ty + DIRS[f].dy)) === spot),
        )
        expect(reach, `${map.id} 자리 ${spot}`).toBe(true)
      }
    }
  })

  it('exitAt: 출구 칸 중앙 → 그 출구, 출구 바로 안쪽 칸 → null', () => {
    for (const e of map.exits) {
      for (const t of exitTiles(map, e)) {
        expect(exitAt(map, center(t.tx, t.ty))).toBe(e)
        if (!('edge' in e)) continue
        const inward = e.edge === 'n' ? { tx: t.tx, ty: 1 } : e.edge === 's' ? { tx: t.tx, ty: map.h - 2 } : e.edge === 'w' ? { tx: 1, ty: t.ty } : { tx: map.w - 2, ty: t.ty }
        expect(exitAt(map, center(inward.tx, inward.ty)), `(${inward.tx},${inward.ty})`).toBeNull()
      }
    }
  })
})

describe('상점', () => {
  it('마을만 shop이 있고, 다른 맵의 어느 걸을 수 있는 칸·방향에서도 interactionAt이 shop을 주지 않는다', () => {
    expect(MAPS.village!.shop).not.toBeNull()
    for (const map of ALL.filter((m) => m.id !== 'village')) {
      expect(map.shop).toBeNull()
      for (const t of allTiles(map)) {
        if (!isWalkable(map, t.tx, t.ty, ALL_AREAS_OPEN)) continue
        for (const f of FACINGS) expect(interactionAt(map, center(t.tx, t.ty), f, ALL_AREAS_OPEN)?.kind, `${map.id} (${t.tx},${t.ty}) ${f}`).not.toBe('shop')
      }
    }
  })
})

describe('마을', () => {
  const village = MAPS.village!

  it('SHOP·SPAWN 불변, 부두 끝→문 앞 최단 경로 37칸', () => {
    expect(village.shop).toEqual({ tx: 10, ty: 2, w: 5, h: 4, doorTx: 12 })
    expect(village.spawn).toEqual({ pos: center(12, 6), facing: 'down' })
    const end = pierEnd(village)!
    expect(bfs(village, shopSpot(village)!).get(key(end))).toBe(37)
  })

  it('북쪽 출구는 강으로 간다', () => {
    expect(village.exits.map((e) => [exitSide(e), e.target])).toEqual([['n', 'river']])
  })

  it('선착장 하나(→ 섬): 잠긴 상태에서 걸어서 front에 닿고 그 자리·방향이 dock, front는 부두 끝이 아니다', () => {
    expect(village.docks.map((d) => d.target)).toEqual(['island'])
    const dock = village.docks[0]
    const end = pierEnd(village)!
    expect(key(dock.front)).not.toBe(key(end))
    expect(tileAt(village, dock.front.tx, dock.front.ty)).toBe('dock')
    expect(bfs(village, shopSpot(village)!, BASE_OPEN).has(key(dock.front))).toBe(true)
    expect(interactionAt(village, center(dock.front.tx, dock.front.ty), dock.front.facing, BASE_OPEN)).toEqual({ kind: 'dock', target: 'island' })
  })

  it('부두 끝에서 물을 보면 선착장이 생겨도 여전히 fish/pier', () => {
    const end = pierEnd(village)!
    for (const f of ['left', 'right', 'down'] as Facing[]) {
      expect(interactionAt(village, center(end.tx, end.ty), f, BASE_OPEN), f).toEqual({ kind: 'fish', spot: 'pier' })
    }
  })
})

describe('강·숲 출구', () => {
  it('강: 남쪽 → 마을, 서쪽 → 숲, 북쪽 → 산 호수', () => {
    const river = MAPS.river!
    expect(river.exits.map((e) => [exitSide(e), e.target]).sort()).toEqual([['n', 'lake'], ['s', 'village'], ['w', 'forest']])
  })

  it('강: 다리가 있고 다리 위에서 강을 보면 river', () => {
    const river = MAPS.river!
    const bridge = allTiles(river).find((t) => tileAt(river, t.tx, t.ty) === 'bridge')
    expect(bridge).toBeDefined()
    const f = FACINGS.find((d) => tileAt(river, bridge!.tx + DIRS[d].dx, bridge!.ty + DIRS[d].dy) === 'river')!
    expect(interactionAt(river, center(bridge!.tx, bridge!.ty), f, ALL_AREAS_OPEN)).toEqual({ kind: 'fish', spot: 'river' })
  })

  it('숲: 동쪽 → 강, 안쪽(동굴 입구) → 동굴, 연못·폭포·웅덩이·절벽이 있다', () => {
    const forest = MAPS.forest!
    expect(forest.exits.map((e) => [exitSide(e), e.target])).toEqual([['e', 'river'], ['at', 'cave']])
    const cave = forest.exits.find((e) => e.target === 'cave')!
    for (const t of exitTiles(forest, cave)) expect(tileAt(forest, t.tx, t.ty)).toBe('cave-mouth')
    const kinds = new Set(allTiles(forest).map((t) => tileAt(forest, t.tx, t.ty)))
    for (const k of ['pond', 'falls', 'basin', 'cliff', 'tree'] as const) expect(kinds.has(k), k).toBe(true)
  })
})

describe('잠긴 문', () => {
  // [맵, 문 지역, 모양, 문 너머 출구 target]
  const CASES = [
    ['river', 'lake', 'broken-bridge'],
    ['forest', 'cave', 'rubble'],
  ] as const

  it.each(CASES)('%s: %s 문(%s)이 하나 있다', (id, area, look) => {
    const map = MAPS[id]!
    expect(map.gates.map((g) => [g.area, g.look])).toEqual([[area, look]])
  })

  it('강의 무너진 다리 칸은 rows에서 다리(H)다(열리면 그대로 건넌다)', () => {
    const { tiles } = MAPS.river!.gates[0]
    for (let ty = tiles.ty; ty < tiles.ty + tiles.h; ty++) for (let tx = tiles.tx; tx < tiles.tx + tiles.w; tx++) {
      expect(tileAt(MAPS.river!, tx, ty), `(${tx},${ty})`).toBe('bridge')
    }
  })

  it.each(CASES)('잠김: 기본 지역만 열렸을 때 %s에서 %s 출구 칸에 걸어서 닿지 못하고, 열면 닿는다', (id, area) => {
    const map = MAPS[id]!
    const exit = map.exits.find((e) => e.target === area)!
    const tiles = exitTiles(map, exit)
    expect(tiles.length).toBeGreaterThan(0)
    const starts = baseStarts(map)
    expect(starts.length).toBeGreaterThan(0)
    for (const start of starts) {
      const locked = bfs(map, start, BASE_OPEN)
      for (const t of tiles) expect(locked.has(key(t)), `잠김 ${id} (${t.tx},${t.ty})`).toBe(false)
      const open = bfs(map, start, new Set<AreaId>([...DEFAULT_AREAS, area]))
      for (const t of tiles) expect(open.has(key(t)), `열림 ${id} (${t.tx},${t.ty})`).toBe(true)
    }
  })

  it.each(CASES)('문 front: 잠긴 %s에서 걸어서 닿고, 그 자리·방향의 interactionAt이 gate(%s), 열면 gate가 아니다', (id, area) => {
    const map = MAPS[id]!
    const { front } = map.gates[0]
    for (const start of baseStarts(map)) expect(bfs(map, start, BASE_OPEN).has(key(front))).toBe(true)
    const pos = center(front.tx, front.ty)
    expect(interactionAt(map, pos, front.facing, BASE_OPEN)).toEqual({ kind: 'gate', area })
    expect(interactionAt(map, pos, front.facing, ALL_AREAS_OPEN)?.kind).not.toBe('gate')
  })

  it('섬으로는 걸어서 가는 길이 없다: 마을 선착장은 출구가 아니고, 섬에는 출구가 없다', () => {
    expect(MAPS.village!.exits.some((e) => e.target === 'island')).toBe(false)
    expect(MAPS.island!.exits).toEqual([])
  })
})

describe('새 지역 맵', () => {
  const kinds = (map: MapDef) => new Set(allTiles(map).map((t) => tileAt(map, t.tx, t.ty)))

  it('산 호수: 남쪽 → 강, 호수 물이 있고 lake 자리', () => {
    const lake = MAPS.lake!
    expect(lake.exits.map((e) => [exitSide(e), e.target])).toEqual([['s', 'river']])
    expect(lake.spots).toEqual({ lake: 'lake' })
    for (const k of ['lake', 'tree', 'rock', 'grass'] as const) expect(kinds(lake).has(k), k).toBe(true)
  })

  it('동굴: 남쪽 → 숲, 웅덩이·수정·용암이 있고 입구에서 멀수록 cave1 → cave2 → cave3', () => {
    const cave = MAPS.cave!
    expect(cave.exits.map((e) => [exitSide(e), e.target])).toEqual([['s', 'forest']])
    expect(cave.spots).toEqual({ 'cave-pool': 'cave1', crystal: 'cave2', lava: 'cave3' })
    const entry = MAPS.forest!.exits.find((e) => e.target === 'cave')!.entry
    const dist = bfs(cave, entry)
    // 각 자리를 처음 낚을 수 있는 칸까지의 걸음 수
    const nearest = (spot: string): number =>
      Math.min(
        ...allTiles(cave)
          .filter((t) => dist.has(key(t)) && FACINGS.some((f) => spotFor(cave, tileAt(cave, t.tx, t.ty), tileAt(cave, t.tx + DIRS[f].dx, t.ty + DIRS[f].dy)) === spot))
          .map((t) => dist.get(key(t))!),
      )
    expect(nearest('cave1')).toBeLessThan(nearest('cave2'))
    expect(nearest('cave2')).toBeLessThan(nearest('cave3'))
  })

  it('동굴: 용암은 모래 옆에 없다(물가 거품이 생기지 않게)', () => {
    const cave = MAPS.cave!
    for (const t of allTiles(cave)) {
      if (tileAt(cave, t.tx, t.ty) !== 'lava') continue
      for (const { dx, dy } of Object.values(DIRS)) expect(tileAt(cave, t.tx + dx, t.ty + dy), `(${t.tx},${t.ty})`).not.toBe('sand')
    }
  })

  it('섬: 출구 없음, 선착장 하나(→ 마을), 모래·야자수·석호·바다가 있고 sea·lagoon 자리', () => {
    const island = MAPS.island!
    expect(island.docks.map((d) => d.target)).toEqual(['village'])
    expect(island.spots).toEqual({ water: 'sea', lagoon: 'lagoon' })
    for (const k of ['sand', 'palm', 'lagoon', 'water', 'dock'] as const) expect(kinds(island).has(k), k).toBe(true)
    const { front } = island.docks[0]
    expect(interactionAt(island, center(front.tx, front.ty), front.facing, ALL_AREAS_OPEN)).toEqual({ kind: 'dock', target: 'village' })
  })

  it('배는 물 위에 그린다(배 두 칸이 모두 물)', () => {
    for (const map of ALL) {
      for (const d of map.docks) {
        for (const dx of [0, 1]) expect(tileAt(map, d.boat.tx + dx, d.boat.ty), `${map.id} 배 (${d.boat.tx + dx},${d.boat.ty})`).toBe('water')
      }
    }
  })
})

describe('순간이동기', () => {
  const tp = (map: MapDef) => map.teleporter!
  /** 구조물을 바라보는 방향 하나(front에서) */
  const facingInto = (map: MapDef): Facing =>
    FACINGS.find((f) => {
      const { tiles } = tp(map)
      const t = { tx: tp(map).front.tx + DIRS[f].dx, ty: tp(map).front.ty + DIRS[f].dy }
      return t.tx >= tiles.tx && t.tx < tiles.tx + tiles.w && t.ty >= tiles.ty && t.ty < tiles.ty + tiles.h
    })!

  it.each(ALL.map((m) => [m.id, m] as const))('%s: 2×2 이동기, 칸은 rows에서 땅이고 어떤 열림에서도 못 걷는다', (_id, map) => {
    expect(map.teleporter).not.toBeNull()
    const { tiles } = tp(map)
    expect([tiles.w, tiles.h]).toEqual([2, 2])
    for (let ty = tiles.ty; ty < tiles.ty + 2; ty++) for (let tx = tiles.tx; tx < tiles.tx + 2; tx++) {
      expect(['grass', 'sand', 'path', 'cave-floor'], `(${tx},${ty})`).toContain(tileAt(map, tx, ty))
      expect(isWalkable(map, tx, ty, ALL_AREAS_OPEN), `(${tx},${ty})`).toBe(false)
      expect(isWalkable(map, tx, ty, BASE_OPEN), `(${tx},${ty})`).toBe(false)
    }
  })

  it.each(ALL.map((m) => [m.id, m] as const))('%s: front는 걸을 수 있고 출구·문·선착장 자리가 아니며, 도착 방향으로는 안 열리고 구조물을 보면 열린다', (_id, map) => {
    const { front } = tp(map)
    const pos = center(front.tx, front.ty)
    expect(isWalkable(map, front.tx, front.ty, ALL_AREAS_OPEN)).toBe(true)
    expect(feetBlocked(map, pos.x, pos.y, ALL_AREAS_OPEN)).toBe(false)
    expect(exitAt(map, pos)).toBeNull()
    for (const g of map.gates) for (let ty = g.tiles.ty; ty < g.tiles.ty + g.tiles.h; ty++) for (let tx = g.tiles.tx; tx < g.tiles.tx + g.tiles.w; tx++) {
      expect(key({ tx, ty })).not.toBe(key(front))
    }
    for (const d of map.docks) expect(key(d.front)).not.toBe(key(front))
    expect(interactionAt(map, pos, front.facing, ALL_AREAS_OPEN)).toBeNull()
    expect(interactionAt(map, pos, facingInto(map), ALL_AREAS_OPEN)).toEqual({ kind: 'teleporter' })
  })

  it.each(ALL.map((m) => [m.id, m] as const))('%s: front는 실제 도착점에서 걸어 닿는다(기본 맵은 기본 지역만, 해금 맵은 그 지역을 연 상태)', (id, map) => {
    const base = DEFAULT_AREAS.includes(id)
    const opened: Opened = base ? BASE_OPEN : new Set<AreaId>([...DEFAULT_AREAS, id])
    const starts = base
      ? baseStarts(map)
      : ALL.filter((m) => opened.has(m.id)).flatMap((m) => [...m.exits, ...m.docks].filter((e) => e.target === id).map(({ entry: { tx, ty } }) => ({ tx, ty })))
    expect(starts.length).toBeGreaterThan(0)
    for (const s of starts) expect(bfs(map, s, opened).has(key(tp(map).front)), `${id} from (${s.tx},${s.ty})`).toBe(true)
  })

  it('세계 원점은 맵마다 다르고, 섬은 멀리 있다', () => {
    const origins = ALL.map((m) => key(m.world))
    expect(new Set(origins).size).toBe(ALL.length)
    expect(MAPS.village!.world).toEqual({ tx: 0, ty: 0 })
    const island = MAPS.island!.world
    expect(Math.hypot(island.tx, island.ty)).toBeGreaterThan(500)
  })
})

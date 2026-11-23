import { describe, expect, it } from 'vitest'
import { AREAS, type AreaId } from '../data.ts'
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

// 4방향 BFS. 시작 타일에서 각 걷기 타일까지의 걸음 수.
function bfs(map: MapDef, from: Tile): Map<string, number> {
  const dist = new Map<string, number>([[key(from), 0]])
  const queue = [from]
  for (let i = 0; i < queue.length; i++) {
    const { tx, ty } = queue[i]
    const d = dist.get(`${tx},${ty}`)!
    for (const { dx, dy } of Object.values(DIRS)) {
      const n = { tx: tx + dx, ty: ty + dy }
      if (!isWalkable(map, n.tx, n.ty, ALL_AREAS_OPEN) || dist.has(key(n))) continue
      dist.set(key(n), d + 1)
      queue.push(n)
    }
  }
  return dist
}

/** 다른 맵에서 이 맵으로 들어오는 출구들의 도착점 */
function arrivalsInto(map: MapDef): Exit['entry'][] {
  return ALL.flatMap((m) => m.exits.filter((e) => e.target === map.id).map((e) => e.entry))
}

describe('맵 등록부', () => {
  it('마을·강·숲 맵이 있고 mapFor가 같은 값을 준다, 맵이 없는 지역은 null', () => {
    expect(Object.keys(MAPS).sort()).toEqual(['forest', 'river', 'village'])
    for (const id of ['village', 'river', 'forest'] as AreaId[]) {
      expect(mapFor(id)).toBe(MAPS[id])
      expect(mapFor(id)!.id).toBe(id)
    }
    expect(mapFor('lake')).toBeNull()
    expect(mapFor('cave')).toBeNull()
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

  it('출구 짝: 모든 출구의 target 맵이 있고, 그 맵에 되돌아오는 출구가 있다', () => {
    expect(map.exits.length).toBeGreaterThan(0)
    for (const e of map.exits) {
      expect(exitTiles(map, e).length, `${map.id}→${e.target} 출구 칸`).toBeGreaterThan(0)
      const target = mapFor(e.target)
      expect(target, `${map.id}→${e.target}`).not.toBeNull()
      expect(target!.exits.some((back) => back.target === map.id), `${e.target}→${map.id}`).toBe(true)
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

  it('연결: 도착점(마을은 SPAWN도)에서 모든 출구 칸과 그 지역 모든 낚시 자리에 닿는다', () => {
    const starts: Tile[] = arrivalsInto(map).map(({ tx, ty }) => ({ tx, ty }))
    if (map.id === 'village') starts.push(shopSpot(map)!)
    const spots = AREAS.find((a) => a.id === map.id)!.spots
    for (const start of starts) {
      const dist = bfs(map, start)
      for (const e of map.exits) for (const t of exitTiles(map, e)) expect(dist.has(key(t)), `출구 칸 (${t.tx},${t.ty})`).toBe(true)
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
  it('마을만 shop이 있고, 강·숲의 어느 걸을 수 있는 칸·방향에서도 interactionAt이 shop을 주지 않는다', () => {
    expect(MAPS.village!.shop).not.toBeNull()
    for (const map of [MAPS.river!, MAPS.forest!]) {
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
})

describe('강·숲 출구', () => {
  it('강: 남쪽 → 마을, 서쪽 → 숲, 북쪽 출구 없음', () => {
    const river = MAPS.river!
    expect(river.exits.map((e) => [exitSide(e), e.target]).sort()).toEqual([['s', 'village'], ['w', 'forest']])
  })

  it('강: 다리가 있고 다리 위에서 강을 보면 river', () => {
    const river = MAPS.river!
    const bridge = allTiles(river).find((t) => tileAt(river, t.tx, t.ty) === 'bridge')
    expect(bridge).toBeDefined()
    const f = FACINGS.find((d) => tileAt(river, bridge!.tx + DIRS[d].dx, bridge!.ty + DIRS[d].dy) === 'river')!
    expect(interactionAt(river, center(bridge!.tx, bridge!.ty), f, ALL_AREAS_OPEN)).toEqual({ kind: 'fish', spot: 'river' })
  })

  it('숲: 동쪽 → 강, 연못·폭포·웅덩이·절벽이 있다', () => {
    const forest = MAPS.forest!
    expect(forest.exits.map((e) => [exitSide(e), e.target])).toEqual([['e', 'river']])
    const kinds = new Set(allTiles(forest).map((t) => tileAt(forest, t.tx, t.ty)))
    for (const k of ['pond', 'falls', 'basin', 'cliff', 'tree'] as const) expect(kinds.has(k), k).toBe(true)
  })
})

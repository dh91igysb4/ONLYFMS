// 내 섬(내 섬 설계 docs/superpowers/specs/2026-11-25-my-island-design.md §5). 순수 모듈.
// 섬 모양별 맵, 배에서 내리는 칸, 주인 있는 장소 키(접속 방·위치 표시용)와 그 이름.
import { AREAS, type AreaId, type IsleLayoutId } from './data.ts'
import { defineMap, type MapDef, type MapNode, type MapOpts, type NodeKind, type TileFacing } from './map.ts'
import { ISLE_CRESCENT, ISLE_CRESCENT_OPTS, ISLE_CRESCENT_ROWS } from './maps/isle-crescent.ts'
import { ISLE_TWIN, ISLE_TWIN_OPTS, ISLE_TWIN_ROWS } from './maps/isle-twin.ts'
import { HOUSE_MAX, ISLE_ZONES } from './isleEcon.ts'
import { homeArrival, type Placed } from './home.ts'

const ISLE_BASE: Readonly<Record<IsleLayoutId, { map: MapDef; rows: readonly string[]; opts: MapOpts }>> = {
  crescent: { map: ISLE_CRESCENT, rows: ISLE_CRESCENT_ROWS, opts: ISLE_CRESCENT_OPTS },
  twin: { map: ISLE_TWIN, rows: ISLE_TWIN_ROWS, opts: ISLE_TWIN_OPTS },
}

/**
 * 자원 칸 위치(내 섬 B 설계 §5.2). 처음 닿는 칸(작은 나무·바위 덩어리)은 나무 4·바위 3,
 * 나머지는 큰 덩어리 안쪽이라 구역을 치우면 드러난다. 드러나는 구역(zone)은 아래에서 계산한다.
 */
const NODE_SPOTS: Readonly<Record<IsleLayoutId, readonly (readonly [number, number, NodeKind])[]>> = {
  crescent: [
    [16, 8, 'tree'], [14, 8, 'tree'], [34, 22, 'tree'], [18, 8, 'tree'], [17, 8, 'rock'], [9, 15, 'rock'], [18, 7, 'rock'],
    [30, 24, 'tree'], [29, 25, 'iron'], [31, 25, 'tree'], [28, 26, 'rock'], [19, 11, 'tree'], [18, 12, 'rock'],
    [20, 14, 'tree'], [18, 17, 'iron'], [16, 18, 'tree'], [19, 13, 'iron'], [18, 14, 'tree'],
  ],
  twin: [
    [23, 5, 'tree'], [25, 6, 'tree'], [13, 23, 'tree'], [35, 23, 'tree'], [26, 6, 'rock'], [15, 22, 'rock'], [36, 24, 'rock'],
    [30, 25, 'tree'], [31, 26, 'iron'], [17, 24, 'tree'], [18, 25, 'rock'], [23, 9, 'tree'], [21, 8, 'iron'],
    [27, 11, 'tree'], [20, 10, 'rock'], [22, 11, 'tree'], [25, 11, 'iron'],
  ],
}

/** 이 칸 수 이하의 나무·바위 덩어리는 개간하지 않는다(장식·처음 자원 칸) */
const SMALL_CLUSTER = 6
const ARRIVAL = { tx: 24, ty: 30 }
const WALK_CHARS = new Set(['.', ',', '=', 'f', 'K', 'D'])
const BLOCK_CHARS = new Set(['T', 'o'])
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
const key = (x: number, y: number) => `${x},${y}`

export type IsleNode = MapNode & { zone: number }
type Plan = { zones: ReadonlyMap<string, number>; nodes: readonly IsleNode[] }
const PLANS = new Map<IsleLayoutId, Plan>()

/**
 * 구역 나누기(설계 §5.2): SMALL_CLUSTER보다 큰 나무·바위 덩어리를 작은 덩어리부터, 덩어리 안은 처음 걸을 수 있는 땅에서
 * 가까운 칸부터(같으면 위·왼쪽) 줄 세워 ISLE_ZONES등분한다. 자원 칸은 구역에 넣지 않는다(치우지 않음).
 * 이 순서라 구역 k의 칸은 늘 구역 k−1까지 치운 땅 옆이다. 자원 칸의 zone은 그 옆 칸이 처음 걸을 수 있게 되는 구역.
 */
function plan(layout: IsleLayoutId): Plan {
  const hit = PLANS.get(layout)
  if (hit) return hit
  const rows = ISLE_BASE[layout].rows
  const H = rows.length
  const W = rows[0].length
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H
  const nodeSet = new Set(NODE_SPOTS[layout].map(([x, y]) => key(x, y)))
  const flood = (start: { tx: number; ty: number }, ok: (x: number, y: number) => boolean): Set<string> => {
    const seen = new Set([key(start.tx, start.ty)])
    const q: [number, number][] = [[start.tx, start.ty]]
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i]
      for (const [dx, dy] of D4) {
        const nx = x + dx
        const ny = y + dy
        if (inMap(nx, ny) && !seen.has(key(nx, ny)) && ok(nx, ny)) {
          seen.add(key(nx, ny))
          q.push([nx, ny])
        }
      }
    }
    return seen
  }
  const ground = flood(ARRIVAL, (x, y) => WALK_CHARS.has(rows[y][x]))
  // 나무·바위 덩어리
  const seen = new Set<string>()
  const clusters: [number, number][][] = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!BLOCK_CHARS.has(rows[y][x]) || seen.has(key(x, y))) continue
    const comp: [number, number][] = [[x, y]]
    seen.add(key(x, y))
    for (let i = 0; i < comp.length; i++) {
      const [cx, cy] = comp[i]
      for (const [dx, dy] of D4) {
        const nx = cx + dx
        const ny = cy + dy
        if (inMap(nx, ny) && BLOCK_CHARS.has(rows[ny][nx]) && !seen.has(key(nx, ny))) {
          seen.add(key(nx, ny))
          comp.push([nx, ny])
        }
      }
    }
    clusters.push(comp)
  }
  const minXY = (c: [number, number][]) => c.reduce((m, p) => (p[0] < m[0] || (p[0] === m[0] && p[1] < m[1]) ? p : m))
  const big = clusters.filter((c) => c.length > SMALL_CLUSTER)
    .sort((a, b) => a.length - b.length || minXY(a)[1] - minXY(b)[1] || minXY(a)[0] - minXY(b)[0])
  const order: [number, number][] = []
  for (const c of big) {
    const cells = new Set(c.filter(([x, y]) => !nodeSet.has(key(x, y))).map(([x, y]) => key(x, y)))
    const depth = new Map<string, number>()
    const q: [number, number][] = []
    for (const k of cells) {
      const [x, y] = k.split(',').map(Number)
      if (D4.some(([dx, dy]) => ground.has(key(x + dx, y + dy)))) {
        depth.set(k, 0)
        q.push([x, y])
      }
    }
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i]
      for (const [dx, dy] of D4) {
        const k = key(x + dx, y + dy)
        if (cells.has(k) && !depth.has(k)) {
          depth.set(k, depth.get(key(x, y))! + 1)
          q.push([x + dx, y + dy])
        }
      }
    }
    order.push(...[...depth.keys()].map((k) => k.split(',').map(Number) as [number, number])
      .sort((a, b) => depth.get(key(...a))! - depth.get(key(...b))! || a[1] - b[1] || a[0] - b[0]))
  }
  const zones = new Map<string, number>()
  order.forEach(([x, y], i) => zones.set(key(x, y), 1 + Math.floor((i * ISLE_ZONES) / order.length)))
  const walkAfter = (k: number) => flood(ARRIVAL, (x, y) => WALK_CHARS.has(rows[y][x]) || (zones.get(key(x, y)) ?? Infinity) <= k)
  const reach = Array.from({ length: ISLE_ZONES + 1 }, (_, k) => walkAfter(k))
  const nodes = NODE_SPOTS[layout].map(([tx, ty, kind], i): IsleNode => {
    const zone = reach.findIndex((r) => D4.some(([dx, dy]) => r.has(key(tx + dx, ty + dy))))
    return { id: `${layout[0]}${i + 1}`, tx, ty, kind, zone: zone < 0 ? Infinity : zone }
  })
  const p = { zones, nodes }
  PLANS.set(layout, p)
  return p
}

/** 섬 모양의 자원 칸 전부(드러나는 구역 포함) */
export function isleNodes(layout: IsleLayoutId): readonly IsleNode[] {
  return plan(layout).nodes
}

/** 개간 칸 → 구역(1..ISLE_ZONES) */
export function isleZoneTiles(layout: IsleLayoutId): ReadonlyMap<string, number> {
  return plan(layout).zones
}

/** 섬·집 맵을 정하는 값(주인의 섬 상태 중 그림에 쓰는 것) */
export type IsleShape = { layout: IsleLayoutId; cleared?: number; house?: number; placed?: readonly Placed[] }

/** 집 단계별 섬 건물 그림 */
export const HOUSE_SPRITES = ['tent', 'hut', 'cottage', 'house', 'manor'] as const

const MAPS = new Map<string, MapDef>()
/**
 * 섬 모양·치운 구역 수·집 단계의 맵(치운 칸은 풀밭, 드러난 자원 칸만 nodes). 같은 값이면 같은 객체.
 * 집 1단계부터 건물 그림이 바뀌고 문이 집 안(home)으로 가는 출구가 된다(텐트 안내는 빠진다).
 */
export function isleMap(layout: IsleLayoutId, cleared = 0, house = 0): MapDef {
  const c = Math.max(0, Math.min(ISLE_ZONES, Math.floor(cleared)))
  const h = Math.max(0, Math.min(HOUSE_MAX, Math.floor(house)))
  const k = `${layout}:${c}:${h}`
  const hit = MAPS.get(k)
  if (hit) return hit
  const base = ISLE_BASE[layout]
  const { zones, nodes } = plan(layout)
  const rows = c === 0 ? base.rows : base.rows.map((row, y) =>
    [...row].map((ch, x) => ((zones.get(key(x, y)) ?? Infinity) <= c ? ',' : ch)).join(''))
  const shown = nodes.filter((n) => n.zone <= c).map(({ id, tx, ty, kind }) => ({ id, tx, ty, kind }))
  const door = base.map.building!
  const opts: MapOpts = h === 0 ? { ...base.opts, nodes: shown } : {
    ...base.opts,
    nodes: shown,
    buildingSprite: HOUSE_SPRITES[h],
    fixtures: (base.opts.fixtures ?? []).filter((f) => f.act.kind !== 'notice'),
    exits: [...(base.opts.exits ?? []), { at: { tx: door.doorTx, ty: door.ty + door.h - 1, w: 1, h: 1 }, target: 'home', entry: homeArrival(h) }],
  }
  const map = defineMap('isle', rows, opts)
  MAPS.set(k, map)
  return map
}

/** 마을에서 배로 섬에 닿았을 때 서는 칸: 선착장 뿌리의 모래, 섬 쪽을 본다(두 모양 모두 같은 칸) */
export function isleArrival(_layout: IsleLayoutId): TileFacing {
  return { tx: 24, ty: 30, facing: 'up' }
}

const OWNER_RE = /^(?:isle|home)-([0-9a-f]{32})$/
const compactId = (id: string): string => id.toLowerCase().replace(/-/g, '')

/** 접속 방·위치의 장소 키: 주인 있는 장소(섬·집)는 `isle-<주인 id 32자>`·`home-<…>`, 그 외엔 지역 id */
export function placeKey(area: AreaId, owner: string | null): string {
  return owner && (area === 'isle' || area === 'home') ? `${area}-${compactId(owner)}` : area
}

/** 장소 키의 섬 주인(하이픈 없는 32자). 섬 키가 아니면 null */
export function ownerOfPlaceKey(key: string): string | null {
  return OWNER_RE.exec(key)?.[1] ?? null
}

/** 장소 키의 화면 이름: 지역 이름, 내 섬, "{아이디}의 섬", 모르는 주인이면 "누군가의 섬". 모르는 키면 null */
export function placeName(key: string, opts: { selfId: string | null; players: readonly { id: string; handle: string }[] }): string | null {
  const owner = ownerOfPlaceKey(key)
  if (owner) {
    const what = key.startsWith('home-') ? '집' : '섬'
    if (opts.selfId && compactId(opts.selfId) === owner) return `내 ${what}`
    const p = opts.players.find((x) => compactId(x.id) === owner)
    return p ? `${p.handle}의 ${what}` : `누군가의 ${what}`
  }
  return AREAS.find((a) => a.id === key)?.name ?? null
}

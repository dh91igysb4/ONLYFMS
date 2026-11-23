// 큰 지도 계산. 순수 모듈: React·DOM·Date.now·Math.random 없음.
// 맵 정의·어종·서버 view·조건에서 표시(마커) 자리, 낚시 자리 대표점, 물고기 목록·필터, 지역 경로를 만든다.
// 좌표는 칸 단위. 표시 자리는 칸 가운데를 정수로 두고, 여러 칸에 걸친 것(가장자리 출구·문·순간이동기)은 .5가 될 수 있다.

import { AREAS, CHALLENGES, DEFAULT_AREAS, SPECIES, speciesAvailable, type AreaId, type Rarity, type Species } from './data.ts'
import { inHours, type Conditions } from './clock.ts'
import {
  ALL_AREAS_OPEN, TILE, WATER_KINDS, interactionAt, isWalkable, reachableTiles, shopSpot, tileAt,
  type Facing, type MapDef, type MapDynamic, type Opened, type Rect,
} from './map.ts'
import { MAPS, mapFor } from './maps/index.ts'
import { teleporterOpen, type View } from './logic.ts'
import { teleportFee } from './teleport.ts'

/** 낚시 자리 대표점끼리, 그리고 고정 표시와 떨어뜨릴 칸 수(체비셰프 거리) */
export const MARKER_GAP = 5

export type Cell = { tx: number; ty: number }
export type ExitDir = 'n' | 's' | 'e' | 'w' | 'in'
export type PlaceMarker =
  | { kind: 'exit'; tx: number; ty: number; target: AreaId; dir: ExitDir }
  | { kind: 'gate'; tx: number; ty: number; area: AreaId }
  | { kind: 'dock'; tx: number; ty: number; target: AreaId }
  | { kind: 'shop'; tx: number; ty: number }
  | { kind: 'teleporter'; tx: number; ty: number }

const FACINGS: readonly Facing[] = ['up', 'down', 'left', 'right']
const STEP: Readonly<Record<Facing, Cell>> = { up: { tx: 0, ty: -1 }, down: { tx: 0, ty: 1 }, left: { tx: -1, ty: 0 }, right: { tx: 1, ty: 0 } }
const center = (tx: number, ty: number) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })
const rectMid = (r: Rect): Cell => ({ tx: r.tx + (r.w - 1) / 2, ty: r.ty + (r.h - 1) / 2 })
const cheb = (a: Cell, b: Cell) => Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty))

/** 출구 표시 칸: 가장자리 출구는 그 줄의 범위 안 걷는 칸들의 가운데, 안쪽 출구는 사각형 가운데 */
function exitCell(map: MapDef, e: MapDef['exits'][number]): Cell {
  if ('at' in e) return rectMid(e.at)
  const line: Cell[] = []
  for (let i = e.from; i <= e.to; i++) {
    const c = e.edge === 'n' ? { tx: i, ty: 0 } : e.edge === 's' ? { tx: i, ty: map.h - 1 } : e.edge === 'w' ? { tx: 0, ty: i } : { tx: map.w - 1, ty: i }
    if (isWalkable(map, c.tx, c.ty, ALL_AREAS_OPEN)) line.push(c)
  }
  if (line.length === 0) return e.edge === 'n' || e.edge === 's' ? { tx: (e.from + e.to) / 2, ty: e.edge === 'n' ? 0 : map.h - 1 } : { tx: e.edge === 'w' ? 0 : map.w - 1, ty: (e.from + e.to) / 2 }
  const a = line[0]
  const b = line[line.length - 1]
  return { tx: (a.tx + b.tx) / 2, ty: (a.ty + b.ty) / 2 }
}

const teleporterCell = (map: MapDef): Cell | null => (map.teleporter ? rectMid(map.teleporter.tiles) : null)

/**
 * 길 레이어 표시. 순서: 출구(정의 순) → 잠긴 문 → 선착장 → 상점 → 순간이동기.
 * 안 연 지역으로 가는 출구 중 같은 지역의 문·선착장이 이 맵에 있으면 뺀다(문 표시가 대신한다).
 */
export function placeMarkers(map: MapDef, opened: Opened): PlaceMarker[] {
  const out: PlaceMarker[] = []
  const coveredBy = (area: AreaId) => map.gates.some((g) => g.area === area) || map.docks.some((d) => d.target === area)
  for (const e of map.exits) {
    if (!opened.has(e.target) && coveredBy(e.target)) continue
    out.push({ kind: 'exit', ...exitCell(map, e), target: e.target, dir: 'at' in e ? 'in' : e.edge })
  }
  for (const g of map.gates) if (!opened.has(g.area)) out.push({ kind: 'gate', ...rectMid(g.tiles), area: g.area })
  for (const d of map.docks) out.push({ kind: 'dock', tx: d.front.tx, ty: d.front.ty, target: d.target })
  const shop = shopSpot(map)
  if (shop) out.push({ kind: 'shop', ...shop })
  const tp = teleporterCell(map)
  if (tp) out.push({ kind: 'teleporter', ...tp })
  return out
}

/** 진행과 무관한 고정 표시 칸(출구 전부·선착장·상점·순간이동기). 잠긴 문은 열리면 사라지므로 넣지 않는다 */
export function fixedCells(map: MapDef): Cell[] {
  const out: Cell[] = map.exits.map((e) => exitCell(map, e))
  for (const d of map.docks) out.push({ tx: d.front.tx, ty: d.front.ty })
  const shop = shopSpot(map)
  if (shop) out.push(shop)
  const tp = teleporterCell(map)
  if (tp) out.push(tp)
  return out
}

/** 지도가 설 자리를 셀 때의 맵 상태: 썰물(진흙으로 걸어 들어가는 갯골도 자리), 구멍 없음(얼음은 drill로 센다) */
const ATLAS_DYN: MapDynamic = { tide: 'low', holes: new Set<string>() }

/** 걸어서 닿는 칸(모두 열린 기준, 썰물): 시작 위치·출구 칸·선착장·이동기 앞에서 */
function walkableReach(map: MapDef): ReadonlySet<string> {
  const starts: Cell[] = [{ tx: Math.floor(map.spawn.pos.x / TILE), ty: Math.floor(map.spawn.pos.y / TILE) }]
  for (const e of map.exits) {
    if ('at' in e) starts.push({ tx: e.at.tx, ty: e.at.ty })
    else starts.push(exitCell(map, e))
  }
  for (const d of map.docks) starts.push(d.front)
  if (map.teleporter) starts.push(map.teleporter.front)
  return reachableTiles(map, starts.map((c) => ({ tx: Math.floor(c.tx), ty: Math.floor(c.ty) })), ALL_AREAS_OPEN, ATLAS_DYN)
}

type StandInfo = { stands: Map<string, Cell[]>; waters: Map<string, Cell[]> }
const standCache = new WeakMap<MapDef, StandInfo>()

/**
 * 자리별 설 자리(걸어서 닿고, 네 방향 중 하나에서 그 자리 낚시)와 그 칸에서 보는 물 칸.
 * 썰물 기준이고, 뚫을 수 있는 얼음을 보는 칸은 얼음 구멍 자리(map.spots.hole)의 설 자리로 친다.
 */
function standInfo(map: MapDef): StandInfo {
  const hit = standCache.get(map)
  if (hit) return hit
  const reach = walkableReach(map)
  const stands = new Map<string, Cell[]>()
  const waters = new Map<string, Cell[]>()
  const seenWater = new Map<string, Set<string>>()
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (!reach.has(`${tx},${ty}`)) continue
      const spots = new Set<string>()
      for (const f of FACINGS) {
        const it = interactionAt(map, center(tx, ty), f, ALL_AREAS_OPEN, ATLAS_DYN)
        const spot = it?.kind === 'fish' ? it.spot : it?.kind === 'drill' ? map.spots.hole : undefined
        if (spot === undefined) continue
        spots.add(spot)
        const w = { tx: tx + STEP[f].tx, ty: ty + STEP[f].ty }
        const seen = seenWater.get(spot) ?? new Set<string>()
        seenWater.set(spot, seen)
        if (!seen.has(`${w.tx},${w.ty}`)) {
          seen.add(`${w.tx},${w.ty}`)
          waters.set(spot, [...(waters.get(spot) ?? []), w])
        }
      }
      for (const s of spots) stands.set(s, [...(stands.get(s) ?? []), { tx, ty }])
    }
  }
  const info = { stands, waters }
  standCache.set(map, info)
  return info
}

export type SpotAnchor = { spot: string; tx: number; ty: number }
const anchorCache = new WeakMap<MapDef, SpotAnchor[]>()

/**
 * 맵의 자리마다 대표점(AREAS의 spots 순서, 설 자리가 없는 자리는 빠진다).
 * 설 자리의 무게중심에 가까운 순(동점은 ty, tx 작은 쪽)으로 보며, 고정 표시·앞서 정한 대표점과
 * MARKER_GAP 이상 떨어진 첫 칸. 그런 칸이 없으면 무게중심에 가장 가까운 칸. 맵마다 한 번 계산해 캐시한다.
 */
export function spotAnchors(map: MapDef): SpotAnchor[] {
  const hit = anchorCache.get(map)
  if (hit) return hit
  const { stands } = standInfo(map)
  const taken: Cell[] = fixedCells(map)
  const out: SpotAnchor[] = []
  const order = AREAS.find((a) => a.id === map.id)?.spots ?? []
  const spots = [...order.filter((s) => stands.has(s)), ...[...stands.keys()].filter((s) => !order.includes(s))]
  for (const spot of spots) {
    const cells = stands.get(spot)!
    const cx = cells.reduce((s, c) => s + c.tx, 0) / cells.length
    const cy = cells.reduce((s, c) => s + c.ty, 0) / cells.length
    const d = (c: Cell) => (c.tx - cx) ** 2 + (c.ty - cy) ** 2
    const sorted = [...cells].sort((a, b) => d(a) - d(b) || a.ty - b.ty || a.tx - b.tx)
    const pick = sorted.find((c) => taken.every((t) => cheb(c, t) >= MARKER_GAP)) ?? sorted[0]
    out.push({ spot, tx: pick.tx, ty: pick.ty })
    taken.push(pick)
  }
  anchorCache.set(map, out)
  return out
}

/** 그 자리의 설 자리 칸과 그 칸에서 보는 물 칸(중복 없음). 강조 그림용. 모르는 자리는 둘 다 빈 배열 */
export function spotTiles(map: MapDef, spot: string): { stands: Cell[]; waters: Cell[] } {
  const info = standInfo(map)
  return { stands: info.stands.get(spot) ?? [], waters: info.waters.get(spot) ?? [] }
}

/**
 * 물 칸이고 map.spots에 그 물의 자리가 있으면 그 자리(부두 옆 바다는 'shore' 같은 물 자리), 아니면 null.
 * 진흙은 밀물 자리(spots.mud), 얼음은 구멍 자리(spots.hole)로 본다.
 */
export function spotAtTile(map: MapDef, tx: number, ty: number): string | null {
  const kind = tileAt(map, tx, ty)
  if (kind === 'mud') return map.spots.mud ?? null
  if (kind === 'ice') return map.spots.hole ?? null
  if (kind === null || !WATER_KINDS.has(kind)) return null
  return (map.spots as Record<string, string | undefined>)[kind] ?? null
}

// ---------------------------------------------------------------- 물고기 목록
export type NotNow = 'legend-done' | 'rod' | 'season' | 'hours' | 'weather'
export type FishRow = { species: Species; found: boolean; now: boolean; legendDone: boolean; reason: NotNow | null }
export type FishView = Pick<View, 'dex' | 'legends' | 'rodTier'>

const RARITY_ORDER: Readonly<Record<Rarity, number>> = { common: 0, uncommon: 1, rare: 2, legend: 3, mythic: 4 }

/** 지금 안 나오는 첫 이유(자리는 보지 않는다): 이미 잡은 전설 → 낚싯대 → 계절 → 시간 → 날씨 */
function notNow(s: Species, legendDone: boolean, cond: Conditions, rodTier: number): NotNow | null {
  if (legendDone) return 'legend-done'
  if (s.minRod > rodTier) return 'rod'
  if (s.seasons && !s.seasons.includes(cond.season)) return 'season'
  if (s.hours && !inHours(cond.gameMinute, s.hours)) return 'hours'
  if (s.weather && s.weather !== cond.weather) return 'weather'
  return null
}

function rowsFor(list: readonly Species[], view: FishView, nowOf: (s: Species) => boolean, cond: Conditions): FishRow[] {
  const legends = view.legends ?? []
  const rows = list.map((s) => {
    const legendDone = !!s.legend && legends.includes(s.id)
    const now = !legendDone && nowOf(s)
    return { species: s, found: !!view.dex[s.id], now, legendDone, reason: now ? null : notNow(s, legendDone, cond, view.rodTier) }
  })
  const idx = (s: Species) => SPECIES.indexOf(s)
  return rows.sort((a, b) => Number(b.now) - Number(a.now) || RARITY_ORDER[a.species.rarity] - RARITY_ORDER[b.species.rarity] || idx(a.species) - idx(b.species))
}

/** 그 지역·자리 물고기. now = 서버와 같은 speciesAvailable이고 이미 잡은 전설이 아니다. 정렬: now 먼저 → 등급 → SPECIES 순 */
export function spotFish(area: AreaId, spot: string, view: FishView, cond: Conditions): FishRow[] {
  const list = SPECIES.filter((s) => s.area === area && (!s.spots || s.spots.includes(spot)))
  return rowsFor(list, view, (s) => speciesAvailable(s, area, spot, cond, view.rodTier), cond)
}

/** 지역 전체 물고기. now = 그 지역 자리 중 하나라도 now */
export function areaFish(area: AreaId, view: FishView, cond: Conditions): FishRow[] {
  const spots = AREAS.find((a) => a.id === area)?.spots ?? []
  const list = SPECIES.filter((s) => s.area === area)
  return rowsFor(list, view, (s) => spots.some((spot) => speciesAvailable(s, area, spot, cond, view.rodTier)), cond)
}

export type FishFilter = { now: boolean; undiscovered: boolean }

export function filterFish(rows: readonly FishRow[], f: FishFilter): FishRow[] {
  return rows.filter((r) => (!f.now || r.now) && (!f.undiscovered || !r.found))
}

/** 필터 둘 다 꺼짐 → '찾음/전체', 하나라도 켜짐 → 통과한 수 */
export function fishBadge(rows: readonly FishRow[], f: FishFilter): string {
  if (!f.now && !f.undiscovered) return `${rows.filter((r) => r.found).length}/${rows.length}`
  return String(filterFish(rows, f).length)
}

// ---------------------------------------------------------------- 지역 경로
export type UnlockPlace = { area: AreaId; kind: 'gate' | 'dock' }

/** 그 지역을 여는 문·선착장이 있는 맵. 기본 지역·모르는 지역은 null */
export function unlockPlace(area: AreaId): UnlockPlace | null {
  if (DEFAULT_AREAS.includes(area)) return null
  for (const a of AREAS) {
    const map = MAPS[a.id]
    if (!map) continue
    if (map.gates.some((g) => g.area === area)) return { area: a.id, kind: 'gate' }
    if (map.docks.some((d) => d.target === area)) return { area: a.id, kind: 'dock' }
  }
  return null
}

/** 그 지역 맵에서 걸어서·배로 바로 가는 지역들(대상이 열렸을 때만) */
function neighbors(area: AreaId, opened: Opened): AreaId[] {
  const map = mapFor(area)
  if (!map) return []
  const out: AreaId[] = []
  for (const t of [...map.exits.map((e) => e.target), ...map.docks.map((d) => d.target)]) {
    if (opened.has(t) && !out.includes(t)) out.push(t)
  }
  return out
}

/** 열린 지역만 지나는 최단(지역 수) 경로. 대상이 잠겼으면 path는 그 지역을 여는 곳까지, unlockAt 채움. 못 가면 path null */
export function areaRoute(from: AreaId, to: AreaId, opened: Opened): { path: AreaId[] | null; unlockAt: UnlockPlace | null } {
  const unlockAt = opened.has(to) || to === from ? null : unlockPlace(to)
  const goal = unlockAt ? unlockAt.area : to
  if (!opened.has(to) && to !== from && !unlockAt) return { path: null, unlockAt: null }
  const prev = new Map<AreaId, AreaId | null>([[from, null]])
  const queue: AreaId[] = [from]
  for (let i = 0; i < queue.length && !prev.has(goal); i++) {
    for (const n of neighbors(queue[i], opened)) {
      if (prev.has(n)) continue
      prev.set(n, queue[i])
      queue.push(n)
    }
  }
  if (!prev.has(goal)) return { path: null, unlockAt }
  const path: AreaId[] = []
  for (let at: AreaId | null = goal; at !== null; at = prev.get(at) ?? null) path.unshift(at)
  return { path, unlockAt }
}

/**
 * 지금 지역 지도에서 경로의 첫 걸음 표시: 다음 지역으로 가는 출구·선착장.
 * 경로가 지금 지역에서 끝나고 lockedTarget을 여는 곳이 여기면 그 잠긴 문·선착장. 없으면 null.
 */
export function firstHop(map: MapDef, path: readonly AreaId[] | null, lockedTarget: AreaId | null = null, opened: Opened = ALL_AREAS_OPEN): PlaceMarker | null {
  if (!path || path[0] !== map.id) return null
  const marks = placeMarkers(map, opened)
  if (path.length >= 2) {
    const next = path[1]
    return marks.find((m) => (m.kind === 'exit' || m.kind === 'dock') && m.target === next) ?? null
  }
  if (lockedTarget) return marks.find((m) => (m.kind === 'gate' && m.area === lockedTarget) || (m.kind === 'dock' && m.target === lockedTarget)) ?? null
  return null
}

// ---------------------------------------------------------------- 순간이동기
export type TeleporterInfo = {
  open: boolean
  /** 그 지역 과제. CHALLENGES에 없으면 null */
  challenge: { title: string; desc: string; progress: number; count: number; done: boolean } | null
  /** 지금 지역 이동기에서 오는 요금. 두 이동기 모두 켜졌을 때만, 같은 지역이면 null */
  feeFromHere: number | null
}
type TpView = Pick<View, 'areas'> & { challenges?: View['challenges'] }

/** 그 지역 맵에 이동기가 없으면 null. view.challenges가 없으면(옛 응답) 모두 꺼짐·진행 0. 켜짐 판정은 서버와 같은 teleporterOpen */
export function teleporterInfo(area: AreaId, view: TpView, here: AreaId): TeleporterInfo | null {
  if (!mapFor(area)?.teleporter) return null
  const state = { areas: view.areas, challenges: view.challenges ?? {} }
  const open = teleporterOpen(state, area)
  const ch = CHALLENGES.find((c) => c.area === area)
  const p = ch ? state.challenges[ch.id] : undefined
  const challenge = ch
    ? { title: ch.title, desc: ch.desc, progress: Math.min(p?.progress ?? 0, ch.count), count: ch.count, done: p?.done === true }
    : null
  const hereOpen = here !== area && !!mapFor(here)?.teleporter && teleporterOpen(state, here)
  return { open, challenge, feeFromHere: open && hereOpen ? teleportFee(here, area) : null }
}

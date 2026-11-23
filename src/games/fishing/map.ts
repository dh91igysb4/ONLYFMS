// 낚시 지역 타일맵 정의와 계산. 순수 모듈: DOM·React·외부 의존 없음.
// 좌표: 타일 (tx, ty)는 정수, 월드 픽셀 Vec은 타일 * TILE. 캐릭터 pos는 발 중앙.
// 맵 자체(행 문자열)는 maps/<지역>.ts에서 defineMap으로 만든다.

import { AREAS, type AreaId } from './data.ts'

export const TILE = 16

export type TileKind = 'water' | 'sand' | 'grass' | 'path' | 'pier' | 'tree' | 'flower' | 'fence' | 'rock' | 'building' | 'door'
  | 'river' | 'pond' | 'basin' | 'falls' | 'bridge' | 'cliff'
  | 'lake' | 'cave-floor' | 'cave-wall' | 'cave-pool' | 'crystal' | 'lava' | 'cave-mouth' | 'palm' | 'lagoon' | 'dock'
export type Facing = 'up' | 'down' | 'left' | 'right'
export type Vec = { x: number; y: number } // 월드 픽셀. 캐릭터 pos는 발 중앙

export const TILE_CHARS: Readonly<Record<string, TileKind>> = {
  '~': 'water',
  '.': 'sand',
  ',': 'grass',
  '=': 'path',
  '#': 'pier',
  T: 'tree',
  f: 'flower',
  '|': 'fence',
  o: 'rock',
  B: 'building',
  D: 'door',
  r: 'river', // 강물
  p: 'pond', // 연못물
  b: 'basin', // 폭포 웅덩이
  w: 'falls', // 폭포
  H: 'bridge', // 다리
  c: 'cliff', // 절벽
  k: 'lake', // 산 호수
  _: 'cave-floor', // 동굴 바닥
  W: 'cave-wall', // 동굴 벽
  u: 'cave-pool', // 동굴 웅덩이
  q: 'crystal', // 수정 웅덩이
  L: 'lava', // 용암
  E: 'cave-mouth', // 동굴 입구
  P: 'palm', // 야자수
  l: 'lagoon', // 석호
  K: 'dock', // 선착장
}

const WALKABLE: ReadonlySet<TileKind> = new Set<TileKind>(['sand', 'grass', 'path', 'pier', 'flower', 'bridge', 'cave-floor', 'cave-mouth', 'dock'])

/** 낚시를 던질 수 있는 물 종류. 용암도 낚시하는 물로 친다(동굴 가장 깊은 곳). 폭포는 포함하지 않는다. */
type WaterKind = 'water' | 'river' | 'pond' | 'basin' | 'lake' | 'cave-pool' | 'crystal' | 'lava' | 'lagoon'
const WATER_LIST: readonly WaterKind[] = ['water', 'river', 'pond', 'basin', 'lake', 'cave-pool', 'crystal', 'lava', 'lagoon']
export const WATER_KINDS: ReadonlySet<TileKind> = new Set<TileKind>(WATER_LIST)

const STEP: Readonly<Record<Facing, { dx: number; dy: number }>> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}

/** 칸 사각형(왼쪽 위 tx, ty와 칸 수 w, h) */
export type Rect = { tx: number; ty: number; w: number; h: number }
/** 칸 하나와 그 칸에서 보는 방향 */
export type TileFacing = { tx: number; ty: number; facing: Facing }

/**
 * 출구 두 가지. entry는 도착 맵(target)에서 설 칸과 방향.
 * - 가장자리 출구: from..to는 그 가장자리를 따라 센 칸 범위(포함, n/s는 tx, e/w는 ty).
 *   출구 칸 = 그 가장자리 줄(행/열)의 범위 안 걸을 수 있는 칸.
 * - 안쪽 출구(동굴 입구 등): at 사각형 안의 걸을 수 있는 칸.
 */
export type Exit =
  | { edge: 'n' | 's' | 'e' | 'w'; from: number; to: number; target: AreaId; entry: TileFacing }
  | { at: Rect; target: AreaId; entry: TileFacing }

/**
 * 돈으로 여는 지역의 문. 잠긴 동안 tiles는 못 걷고 look 그림이 덮인다.
 * 열리면 rows의 원래 칸 그대로(다리 H, 길 = 등). front에 서서 facing을 보면 { kind: 'gate', area } 상호작용.
 */
export type Gate = { area: AreaId; tiles: Rect; look: 'broken-bridge' | 'rubble'; front: TileFacing }

/** 배 타는 곳. front에서 facing을 보면 { kind: 'dock', target }. boat는 배 그림 위치(물 위, 칸 좌표). */
export type Dock = { front: TileFacing; target: AreaId; entry: TileFacing; boat: { tx: number; ty: number } }

/** 열린 지역들. 기본 지역(마을·강·숲)은 늘 들어 있다 */
export type Opened = ReadonlySet<AreaId>

/** 모든 지역이 열린 집합(저장 위치 검사처럼 열림과 무관하게 맵만 볼 때) */
export const ALL_AREAS_OPEN: Opened = new Set<AreaId>(AREAS.map((a) => a.id))

/** 한 지역의 타일맵과 거기서 계산한 값. defineMap으로 만든다. */
export type MapDef = {
  id: AreaId
  rows: readonly string[]
  w: number
  h: number
  /** 상점 건물 자리(타일, 문 줄 포함). 문은 맨 아래 줄의 doorTx 열. 문이 없는 맵은 null */
  shop: { tx: number; ty: number; w: number; h: number; doorTx: number } | null
  spawn: { pos: Vec; facing: Facing }
  /** 물 종류 → 낚시 자리 id. 여기 없는 물은 낚시할 수 없다 */
  spots: Partial<Record<WaterKind, string>>
  exits: readonly Exit[]
  gates: readonly Gate[]
  docks: readonly Dock[]
  /** 실내(동굴 등): 비·눈·밤 색조를 그리지 않는다 */
  indoor: boolean
}

export function tileAt(map: MapDef, tx: number, ty: number): TileKind | null {
  if (ty < 0 || ty >= map.h || tx < 0 || tx >= map.w) return null
  return TILE_CHARS[map.rows[ty][tx]] ?? null
}

/** rows의 칸만 본 걷기 가능 여부(문 잠김 무시) */
function tileWalkable(map: MapDef, tx: number, ty: number): boolean {
  const kind = tileAt(map, tx, ty)
  return kind !== null && WALKABLE.has(kind)
}

const inRect = (r: Rect, tx: number, ty: number): boolean => tx >= r.tx && tx < r.tx + r.w && ty >= r.ty && ty < r.ty + r.h

/** 걸을 수 있는 칸인가. 잠긴 문(opened에 그 지역이 없음)의 칸은 못 걷고, 열린 문 칸은 rows 원래 칸의 규칙대로. */
export function isWalkable(map: MapDef, tx: number, ty: number, opened: Opened): boolean {
  if (!tileWalkable(map, tx, ty)) return false
  return !map.gates.some((g) => !opened.has(g.area) && inRect(g.tiles, tx, ty))
}

export function tileOf(pos: Vec): { tx: number; ty: number } {
  return { tx: Math.floor(pos.x / TILE), ty: Math.floor(pos.y / TILE) }
}

function tileCenter(tx: number, ty: number): Vec {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }
}

function findTiles(map: MapDef, kind: TileKind): { tx: number; ty: number }[] {
  const out: { tx: number; ty: number }[] = []
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) if (tileAt(map, tx, ty) === kind) out.push({ tx, ty })
  return out
}

// 상점 건물 자리: 문 D와 건물 B를 감싸는 사각형. 맵 글자에서 읽어 오므로 맵을 고치면 함께 바뀐다.
function computeShop(map: MapDef): MapDef['shop'] {
  const doors = findTiles(map, 'door')
  if (doors.length === 0) return null
  if (doors.length !== 1) throw new Error(`map needs exactly one door, found ${doors.length}`)
  const parts = [...findTiles(map, 'building'), doors[0]]
  const tx = Math.min(...parts.map((p) => p.tx))
  const ty = Math.min(...parts.map((p) => p.ty))
  const w = Math.max(...parts.map((p) => p.tx)) - tx + 1
  const h = Math.max(...parts.map((p) => p.ty)) - ty + 1
  if (doors[0].ty !== ty + h - 1) throw new Error('shop door must be in the bottom row of the building')
  return { tx, ty, w, h, doorTx: doors[0].tx }
}

type MapOpts = { spots?: MapDef['spots']; exits?: Exit[]; gates?: Gate[]; docks?: Dock[]; indoor?: boolean }

const rectInside = (map: MapDef, r: Rect): boolean =>
  r.w >= 1 && r.h >= 1 && r.tx >= 0 && r.ty >= 0 && r.tx + r.w <= map.w && r.ty + r.h <= map.h

// 문·선착장·안쪽 출구 정의 검사. 문 칸이 맵 밖이거나 front가 못 걷는(또는 문 안) 칸, 선착장 front가 못 걷는 칸이면 throw.
function checkPlaces(map: MapDef): void {
  map.gates.forEach((g, i) => {
    if (!rectInside(map, g.tiles)) throw new Error(`gate ${i} (${g.area}) tiles are outside the map`)
    if (!tileWalkable(map, g.front.tx, g.front.ty) || inRect(g.tiles, g.front.tx, g.front.ty)) {
      throw new Error(`gate ${i} (${g.area}) front is not a walkable tile outside the gate`)
    }
  })
  map.docks.forEach((d, i) => {
    if (!tileWalkable(map, d.front.tx, d.front.ty)) throw new Error(`dock ${i} (${d.target}) front is not a walkable tile`)
  })
  map.exits.forEach((e, i) => {
    if ('at' in e && !rectInside(map, e.at)) throw new Error(`exit ${i} (${e.target}) rect is outside the map`)
  })
}

/** 행 문자열로 맵을 만든다. 행 길이가 다르거나, 상점 문이 둘 이상이거나, 문·선착장 정의가 잘못되면 throw. */
export function defineMap(id: AreaId, rows: readonly string[], opts: MapOpts = {}): MapDef {
  if (rows.length === 0) throw new Error('map needs at least one row')
  const w = rows[0].length
  rows.forEach((row, i) => {
    if (row.length !== w) throw new Error(`map row ${i} has length ${row.length}, expected ${w}`)
  })
  const map: MapDef = {
    id, rows, w, h: rows.length, shop: null, spawn: { pos: { x: 0, y: 0 }, facing: 'down' },
    spots: opts.spots ?? {}, exits: opts.exits ?? [], gates: opts.gates ?? [], docks: opts.docks ?? [], indoor: opts.indoor ?? false,
  }
  checkPlaces(map)
  map.shop = computeShop(map)
  // 시작 위치: 문 앞(문 바로 아래 타일), 문이 없으면 첫 걸을 수 있는 칸
  const at = shopSpot(map) ?? firstWalkable(map)
  map.spawn = { pos: tileCenter(at.tx, at.ty), facing: 'down' }
  return map
}

function firstWalkable(map: MapDef): { tx: number; ty: number } {
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) if (tileWalkable(map, tx, ty)) return { tx, ty }
  throw new Error('map has no walkable tile')
}

/** 문 바로 아래 타일. 여기 서서 위를 보면 상점. 상점이 없으면 null. */
export function shopSpot(map: MapDef): { tx: number; ty: number } | null {
  return map.shop ? { tx: map.shop.doorTx, ty: map.shop.ty + map.shop.h } : null
}

/** 부두는 모래사장에서 아래(바다 쪽)로 뻗는다. 맨 끝 = 가장 아래 부두 타일. 부두가 없으면 null. */
export function pierEnd(map: MapDef): { tx: number; ty: number } | null {
  const pier = findTiles(map, 'pier')
  if (pier.length === 0) return null
  const maxTy = Math.max(...pier.map((p) => p.ty))
  const ends = pier.filter((p) => p.ty === maxTy)
  if (ends.length !== 1) throw new Error('pier must end in a single tile')
  return ends[0]
}

/** 발 중앙이 있는 칸이 출구 칸(가장자리 범위 또는 안쪽 사각형)이면 그 출구, 아니면 null. */
export function exitAt(map: MapDef, pos: Vec): Exit | null {
  const { tx, ty } = tileOf(pos)
  // 잠긴 문 칸에는 발이 들어갈 수 없으므로 rows 칸만 본다
  if (!tileWalkable(map, tx, ty)) return null
  for (const exit of map.exits) {
    if ('at' in exit) {
      if (inRect(exit.at, tx, ty)) return exit
      continue
    }
    const onEdge = exit.edge === 'n' ? ty === 0 : exit.edge === 's' ? ty === map.h - 1 : exit.edge === 'w' ? tx === 0 : tx === map.w - 1
    const along = exit.edge === 'n' || exit.edge === 's' ? tx : ty
    if (onEdge && along >= exit.from && along <= exit.to) return exit
  }
  return null
}

/** 출구 칸이고 그 출구가 가는 지역이 열려 있으면 그 출구. 안 연 지역으로 가는 출구는 null(걸어 들어가지 않는다). */
export function openExitAt(map: MapDef, pos: Vec, opened: Opened): Exit | null {
  const exit = exitAt(map, pos)
  return exit && opened.has(exit.target) ? exit : null
}

/**
 * 시작 칸들에서 4방향으로 걸어 닿는 칸들("tx,ty"). 열린 지역 기준(잠긴 문 칸은 못 지난다).
 * 못 걷는 시작 칸은 무시한다.
 */
export function reachableTiles(map: MapDef, starts: readonly { tx: number; ty: number }[], opened: Opened): ReadonlySet<string> {
  const seen = new Set<string>()
  const queue: { tx: number; ty: number }[] = []
  const visit = (tx: number, ty: number) => {
    const k = `${tx},${ty}`
    if (seen.has(k) || !isWalkable(map, tx, ty, opened)) return
    seen.add(k)
    queue.push({ tx, ty })
  }
  for (const s of starts) visit(s.tx, s.ty)
  for (let i = 0; i < queue.length; i++) {
    const { tx, ty } = queue[i]
    for (const { dx, dy } of Object.values(STEP)) visit(tx + dx, ty + dy)
  }
  return seen
}

export type Interaction =
  | { kind: 'shop' }
  | { kind: 'fish'; spot: string }
  | { kind: 'gate'; area: AreaId }
  | { kind: 'dock'; target: AreaId }
  | null

/** 낚시 자리 id. 앞이 물 종류가 아니거나 맵에 그 물의 자리가 없으면 null. 부두 위에서 바다를 보면 'pier'(선착장 dock은 부두가 아니라 그 물의 자리 그대로). */
export function spotFor(map: MapDef, standing: TileKind | null, front: TileKind | null): string | null {
  if (front === null || !WATER_KINDS.has(front)) return null
  const spot = map.spots[front as WaterKind]
  if (spot === undefined) return null
  return standing === 'pier' && front === 'water' ? 'pier' : spot
}

const standsAt = (here: { tx: number; ty: number }, facing: Facing, at: TileFacing): boolean =>
  here.tx === at.tx && here.ty === at.ty && facing === at.facing

// 서 있는 타일 = tileOf(pos), 앞 타일 = 서 있는 타일 + facing.
// 잠긴 문의 front에서 그 방향을 보면 gate, 선착장 front에서 그 방향을 보면 dock(열림과 무관: 화면이 구매/출발을 가른다).
// 그 외: 앞이 상점 문이고 위를 보면 상점, 앞이 물이고 spotFor가 값을 주면 낚시, 그 외(폭포·절벽 포함) null.
export function interactionAt(map: MapDef, pos: Vec, facing: Facing, opened: Opened): Interaction {
  const here = tileOf(pos)
  const gate = map.gates.find((g) => !opened.has(g.area) && standsAt(here, facing, g.front))
  if (gate) return { kind: 'gate', area: gate.area }
  const dock = map.docks.find((d) => standsAt(here, facing, d.front))
  if (dock) return { kind: 'dock', target: dock.target }
  const { dx, dy } = STEP[facing]
  const front = tileAt(map, here.tx + dx, here.ty + dy)
  if (front === 'door') return facing === 'up' ? { kind: 'shop' } : null
  const spot = spotFor(map, tileAt(map, here.tx, here.ty), front)
  return spot === null ? null : { kind: 'fish', spot }
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

// 찌가 떨어질 월드 위치. 발에서 facing 방향으로 (1.5 + 3.5 * power) 타일.
// 앞 타일부터 한 칸씩 나아가다(물 종류가 섞여도 계속) 물이 아닌 타일(맵 밖 포함)을 만나면 그 직전 물 타일의 중앙.
// 끝 지점 타일까지 모두 물이면 끝 지점 그대로. 앞 타일부터 물이 아니면(낚시 불가 자리) 앞 타일 중앙.
export function castTarget(map: MapDef, pos: Vec, facing: Facing, power: number): Vec {
  const { dx, dy } = STEP[facing]
  const dist = (1.5 + 3.5 * clamp01(power)) * TILE
  const end = { x: pos.x + dx * dist, y: pos.y + dy * dist }
  const from = tileOf(pos)
  const to = tileOf(end)
  const steps = Math.abs(to.tx - from.tx) + Math.abs(to.ty - from.ty)
  for (let k = 1; k <= steps; k++) {
    const kind = tileAt(map, from.tx + dx * k, from.ty + dy * k)
    if (kind === null || !WATER_KINDS.has(kind)) {
      const back = Math.max(1, k - 1)
      return tileCenter(from.tx + dx * back, from.ty + dy * back)
    }
  }
  return end
}

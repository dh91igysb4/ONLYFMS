// 낚시 지역 타일맵 정의와 계산. 순수 모듈: DOM·React·외부 의존 없음.
// 좌표: 타일 (tx, ty)는 정수, 월드 픽셀 Vec은 타일 * TILE. 캐릭터 pos는 발 중앙.
// 맵 자체(행 문자열)는 maps/<지역>.ts에서 defineMap으로 만든다.

import type { AreaId } from './data.ts'

export const TILE = 16

export type TileKind = 'water' | 'sand' | 'grass' | 'path' | 'pier' | 'tree' | 'flower' | 'fence' | 'rock' | 'building' | 'door'
  | 'river' | 'pond' | 'basin' | 'falls' | 'bridge' | 'cliff'
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
}

const WALKABLE: ReadonlySet<TileKind> = new Set<TileKind>(['sand', 'grass', 'path', 'pier', 'flower', 'bridge'])

/** 낚시를 던질 수 있는 물 종류(바다·강·연못·웅덩이). 폭포는 포함하지 않는다. */
export const WATER_KINDS: ReadonlySet<TileKind> = new Set<TileKind>(['water', 'river', 'pond', 'basin'])

type WaterKind = 'water' | 'river' | 'pond' | 'basin'

const STEP: Readonly<Record<Facing, { dx: number; dy: number }>> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}

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
}

export function tileAt(map: MapDef, tx: number, ty: number): TileKind | null {
  if (ty < 0 || ty >= map.h || tx < 0 || tx >= map.w) return null
  return TILE_CHARS[map.rows[ty][tx]] ?? null
}

export function isWalkable(map: MapDef, tx: number, ty: number): boolean {
  const kind = tileAt(map, tx, ty)
  return kind !== null && WALKABLE.has(kind)
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

/** 행 문자열로 맵을 만든다. 행 길이가 다르거나 문이 둘 이상이면 throw. */
export function defineMap(id: AreaId, rows: readonly string[], opts: { spots?: MapDef['spots'] } = {}): MapDef {
  if (rows.length === 0) throw new Error('map needs at least one row')
  const w = rows[0].length
  rows.forEach((row, i) => {
    if (row.length !== w) throw new Error(`map row ${i} has length ${row.length}, expected ${w}`)
  })
  const map: MapDef = { id, rows, w, h: rows.length, shop: null, spawn: { pos: { x: 0, y: 0 }, facing: 'down' }, spots: opts.spots ?? {} }
  map.shop = computeShop(map)
  // 시작 위치: 문 앞(문 바로 아래 타일), 문이 없으면 첫 걸을 수 있는 칸
  const at = shopSpot(map) ?? firstWalkable(map)
  map.spawn = { pos: tileCenter(at.tx, at.ty), facing: 'down' }
  return map
}

function firstWalkable(map: MapDef): { tx: number; ty: number } {
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) if (isWalkable(map, tx, ty)) return { tx, ty }
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

export type Interaction = { kind: 'shop' } | { kind: 'fish'; spot: string } | null

/** 낚시 자리 id. 앞이 물 종류가 아니거나 맵에 그 물의 자리가 없으면 null. 부두 위에서 바다를 보면 'pier'. */
export function spotFor(map: MapDef, standing: TileKind | null, front: TileKind | null): string | null {
  if (front === null || !WATER_KINDS.has(front)) return null
  const spot = map.spots[front as WaterKind]
  if (spot === undefined) return null
  return standing === 'pier' && front === 'water' ? 'pier' : spot
}

// 서 있는 타일 = tileOf(pos), 앞 타일 = 서 있는 타일 + facing.
// 앞이 문이고 위를 보면 상점, 앞이 물이고 spotFor가 값을 주면 낚시, 그 외(폭포·절벽 포함) null.
export function interactionAt(map: MapDef, pos: Vec, facing: Facing): Interaction {
  const here = tileOf(pos)
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

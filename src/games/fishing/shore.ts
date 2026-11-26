// 부드러운 물가: 칸 데이터에서 매끄러운 '물 정도' 값과 물체 발밑 사각형을 계산한다. 순수 모듈(DOM 없음).
// 걷기(walk.ts)·그리기(scene.ts)·시험이 같은 값을 쓴다 — 그린 물가선(0.5)이 곧 걷기 경계다.
// 서버 번들(map.ts)은 이 모듈을 import하지 않는다.
import { tileAt, TILE, type MapDef, type Rect, type TileKind } from './map.ts'
import { computeGround, type Ground } from './ground.ts'
import { SPRITES } from './sprites.ts'
import type { Tide } from './clock.ts'

/** 그리는 물가선 */
export const SHORE_LINE = 0.5
/** 걷기 경계(이 값 이상이면 막힘). 0.52까지만 올린다 */
export const SHORE_BLOCK = 0.5
/** 이 값 이상은 물 그림 */
export const WET_BAND = 0.56
/** 젖은 띠 가운데 물가 쪽(거품) */
export const FOAM_BAND = 0.53
/** 이 값 이상 물가선 미만은 모래 띠 */
export const SAND_BAND = 0.16
/** 칸 가운데 이 거리(px) 안은 제 종류를 지킨다(1칸 섬·연못) */
const CORE_R = 5
const LAND_CORE_MAX = 0.45
const WATER_CORE_MIN = 0.55

/**
 * water: 매끄럽게 하는 물(물 위 바위·늪 갈대 포함). land: 매끄럽게 하는 땅(모래·풀·길·눈·동굴 바닥, 땅 위 물체, 건물 등 값 0).
 * walkwet: 걸을 수 있는 젖은 칸(부두·다리·선착장·데크). fixed: 매끄럽게 하지 않는 칸(칸 규칙 그대로).
 */
export type ShoreClass = 'water' | 'land' | 'walkwet' | 'fixed'

export type ShoreField = {
  map: MapDef
  tide: Tide
  ground: readonly (Ground | null)[]
  cls: readonly ShoreClass[]
  /** 칸 값: 물 1, 그 밖 0(walkwet은 점이 든 칸에 따라 정하므로 0으로 둔다) */
  val: Float32Array
}

const WALKWET: ReadonlySet<TileKind> = new Set<TileKind>(['pier', 'bridge', 'dock', 'boardwalk', 'deck'])
const FIXED_KINDS: ReadonlySet<TileKind> = new Set<TileKind>(['hull', 'mast', 'falls', 'mud', 'ice'])
const TIDE_KINDS: ReadonlySet<TileKind> = new Set<TileKind>(['mud', 'ice'])

const cacheByMap = new WeakMap<MapDef, Map<Tide, ShoreField>>()

function nearTide(map: MapDef, tx: number, ty: number): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const k = tileAt(map, tx + dx, ty + dy)
    if (k !== null && TIDE_KINDS.has(k)) return true
  }
  return false
}

export function shoreField(map: MapDef, tide: Tide): ShoreField {
  const t: Tide = map.tidal ? tide : 'high'
  let byTide = cacheByMap.get(map)
  if (!byTide) {
    byTide = new Map()
    cacheByMap.set(map, byTide)
  }
  const hit = byTide.get(t)
  if (hit) return hit
  const ground = computeGround(map, t)
  const cls: ShoreClass[] = []
  const val = new Float32Array(map.w * map.h)
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const i = ty * map.w + tx
      const kind = tileAt(map, tx, ty)!
      const g = ground[i]
      val[i] = g === 'water' && !WALKWET.has(kind) ? 1 : 0
      if (FIXED_KINDS.has(kind) || nearTide(map, tx, ty) || g === null) cls.push('fixed')
      else if (WALKWET.has(kind)) cls.push('walkwet')
      else cls.push(g === 'water' ? 'water' : 'land')
    }
  }
  const f: ShoreField = { map, tide: t, ground, cls, val }
  byTide.set(t, f)
  return f
}

export function shoreClassAt(f: ShoreField, tx: number, ty: number): ShoreClass {
  if (tx < 0 || ty < 0 || tx >= f.map.w || ty >= f.map.h) return 'fixed'
  return f.cls[ty * f.map.w + tx]
}

const clampI = (v: number, n: number): number => (v < 0 ? 0 : v >= n ? n - 1 : v)

function bspline(t: number, out: number[]): void {
  const t2 = t * t
  const t3 = t2 * t
  const u = 1 - t
  out[0] = (u * u * u) / 6
  out[1] = (3 * t3 - 6 * t2 + 4) / 6
  out[2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6
  out[3] = t3 / 6
}

const WX = [0, 0, 0, 0]
const WY = [0, 0, 0, 0]

/** 월드 px (x, y)의 물 정도(0~1). 점이 든 칸이 물이면 walkwet 칸을 물로, 아니면 땅으로 센다. 칸 심지는 제 종류를 지킨다 */
export function wetness(f: ShoreField, x: number, y: number): number {
  const { map, cls, val } = f
  const ctx = cls[clampI(Math.floor(y / TILE), map.h) * map.w + clampI(Math.floor(x / TILE), map.w)]
  const wwVal = ctx === 'water' ? 1 : 0
  const u = x / TILE - 0.5
  const v = y / TILE - 0.5
  const iu = Math.floor(u)
  const iv = Math.floor(v)
  bspline(u - iu, WX)
  bspline(v - iv, WY)
  let s = 0
  for (let b = 0; b < 4; b++) {
    const row = clampI(iv - 1 + b, map.h) * map.w
    let r = 0
    for (let a = 0; a < 4; a++) {
      const i = row + clampI(iu - 1 + a, map.w)
      r += WX[a] * (cls[i] === 'walkwet' ? wwVal : val[i])
    }
    s += WY[b] * r
  }
  if (ctx === 'water' || ctx === 'land') {
    const tx = Math.floor(x / TILE)
    const ty = Math.floor(y / TILE)
    const dx = x - (tx * TILE + TILE / 2)
    const dy = y - (ty * TILE + TILE / 2)
    if (dx * dx + dy * dy <= CORE_R * CORE_R) s = ctx === 'land' ? Math.min(s, LAND_CORE_MAX) : Math.max(s, WATER_CORE_MIN)
  }
  return s
}

/** 2칸 안에 반대 값이 있으면 물가 후보(B-스플라인이 닿는 범위) */
function mixedNear(f: ShoreField, tx: number, ty: number): boolean {
  const { map, cls, val } = f
  const ctx = cls[ty * map.w + tx]
  const ww = ctx === 'water' ? 1 : 0
  let lo = false
  let hi = false
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const i = clampI(ty + dy, map.h) * map.w + clampI(tx + dx, map.w)
    const v = cls[i] === 'walkwet' ? ww : val[i]
    if (v > 0.5) hi = true
    else lo = true
    if (hi && lo) return true
  }
  return false
}

/** 그 칸 256픽셀(행 우선, 픽셀 중심)의 물 정도. 고정·walkwet 칸, 또는 모든 픽셀이 칸 기본 띠와 같으면 null */
export function shoreBands(f: ShoreField, tx: number, ty: number): Float32Array | null {
  const c = shoreClassAt(f, tx, ty)
  if (c !== 'water' && c !== 'land') return null
  if (!mixedNear(f, tx, ty)) return null
  const out = new Float32Array(TILE * TILE)
  let differs = false
  for (let j = 0; j < TILE; j++) {
    for (let i = 0; i < TILE; i++) {
      const v = wetness(f, tx * TILE + i + 0.5, ty * TILE + j + 0.5)
      out[j * TILE + i] = v
      if (c === 'water' ? v < WET_BAND : v >= SAND_BAND) differs = true
    }
  }
  return differs ? out : null
}

// ── 물체 발밑 ────────────────────────────────────────────────────

const px = (x0: number, x1: number, y0: number, y1: number): Rect => ({ tx: x0, ty: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 })

/** 칸 안 px 사각형(양 끝 포함). 키 큰 물체 그림은 칸 위쪽 0~10줄이라(그리기 순서 TREE_BASE 10과 같음) 아래쪽은 빈 땅이다 */
const FOOTPRINT: Readonly<Partial<Record<TileKind, Rect>>> = {
  tree: px(4, 12, 3, 10),
  palm: px(5, 12, 4, 10),
  deadtree: px(3, 11, 2, 8),
  snowpine: px(5, 10, 4, 8),
  reed: px(2, 12, 4, 9),
  mast: px(3, 11, 2, 6),
  rock: px(1, 14, 6, 14),
  bench: px(1, 14, 6, 14),
}
const FENCE_H = px(0, 15, 10, 14)
const FENCE_V = px(5, 11, 0, 15)
const FULL = px(0, TILE - 1, 0, TILE - 1)
const DECO_MAX_H = 8

const decoCache = new Map<string, Rect>()

/** 꾸미기 스프라이트의 불투명 바깥 사각형, 위를 잘라 높이 ≤ 8 */
function decoFootprint(sprite: string): Rect {
  const hit = decoCache.get(sprite)
  if (hit) return hit
  const s = SPRITES[sprite]
  let r = FULL
  if (s) {
    const top = Math.max(0, s.h - TILE)
    let x0 = 99, x1 = -1, y0 = 99, y1 = -1
    for (let y = top; y < s.h; y++) for (let x = 0; x < Math.min(s.w, TILE); x++) {
      const ch = s.rows[y][x]
      if (ch === '.' || ch === ' ') continue
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y - top)
      y1 = Math.max(y1, y - top)
    }
    if (x1 >= 0) r = px(x0, x1, Math.max(y0, y1 - DECO_MAX_H + 1), y1)
  }
  decoCache.set(sprite, r)
  return r
}

/** 물체 칸의 발밑(칸 안 px 사각형, Rect를 px 단위로). 물체 칸이 아니면 null */
export function footprintAt(f: ShoreField, tx: number, ty: number): Rect | null {
  const kind = tileAt(f.map, tx, ty)
  if (kind === null) return null
  if (kind === 'fence') {
    const fence = (dx: number, dy: number) => tileAt(f.map, tx + dx, ty + dy) === 'fence'
    return !fence(-1, 0) && !fence(1, 0) && (fence(0, -1) || fence(0, 1)) ? FENCE_V : FENCE_H
  }
  if (kind === 'deco') {
    const prop = f.map.props.find((p) => p.tx === tx && p.ty === ty)
    return prop ? decoFootprint(prop.sprite) : FULL
  }
  return FOOTPRINT[kind] ?? null
}

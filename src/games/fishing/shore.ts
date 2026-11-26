// 부드러운 물가: 칸 데이터에서 매끄러운 '물 정도' 값과 물체 발밑 사각형을 계산한다. 순수 모듈(DOM 없음).
// 걷기(walk.ts)·그리기(scene.ts)·시험이 같은 값을 쓴다 — 그린 물가선(0.5)이 곧 걷기 경계다.
// 서버 번들(map.ts)은 이 모듈을 import하지 않는다.
import { ALL_AREAS_OPEN, STATIC_DYNAMIC, isWalkable, tileAt, TILE, type MapDef, type Rect, type TileKind } from './map.ts'
import { computeGround, type Ground } from './ground.ts'
import { SPRITES } from './sprites.ts'
import type { Tide } from './clock.ts'

/** 그리는 물가선 */
export const SHORE_LINE = 0.5
/** 걷기 경계(이 값 이상이면 막힘). 0.52까지만 올린다 */
export const SHORE_BLOCK = 0.5
/** 이 값 이상은 물 그림(물가선에서 물 쪽으로 약 3px) */
export const WET_BAND = 0.63
/** 젖은 띠: 물가선~FOAM_BAND는 젖은 모래(약 2px), FOAM_BAND~WET_BAND는 거품(약 1px) — 옛 직선 물가 띠와 같은 순서·두께 */
export const FOAM_BAND = 0.585
/** 이 값 이상 물가선 미만은 모래 띠 */
export const SAND_BAND = 0.16
/** 물 칸 가운데 이 거리(px) 안은 물을 지킨다(1칸 연못) */
const CORE_R = 5
/** 땅 칸 가운데 이 반폭·반높이(px) 사각형 안은 땅을 지킨다: 발 사각형(10×6)이 칸 가운데에 늘 설 수 있게 */
const LAND_CORE_HALF = { w: 6, h: 4 }
/** 심지 밖으로 1px마다 풀리는 양 */
const CORE_RAMP = 0.1
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
  /** 1이면 점이 든 칸에 따라 값을 정하는 칸: walkwet(부두 등)과 땅이 없는 고정 칸(절벽·동굴 벽 — 물은 물대로, 땅은 땅대로 붙는다) */
  ctx: Uint8Array
  /** footprintAt 캐시(칸 번호 → 사각형) */
  fp: Map<number, Rect | null>
  /** shoreBands 캐시(칸 번호 → 픽셀 값) */
  bands: Map<number, Float32Array | null>
  /** 건물 사각형의 막는 픽셀(1 = 그림의 불투명 픽셀 또는 그림이 덮지 않는 곳). 건물·그림이 없으면 null, 아직 안 만들었으면 undefined */
  bmask: Uint8Array | null | undefined
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
  const ctxv = new Uint8Array(map.w * map.h)
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const i = ty * map.w + tx
      const kind = tileAt(map, tx, ty)!
      const g = ground[i]
      val[i] = g === 'water' && !WALKWET.has(kind) ? 1 : 0
      if (WALKWET.has(kind) || (g === null && !nearTide(map, tx, ty))) ctxv[i] = 1
      if (FIXED_KINDS.has(kind) || nearTide(map, tx, ty) || g === null) cls.push('fixed')
      else if (WALKWET.has(kind)) cls.push('walkwet')
      else cls.push(g === 'water' ? 'water' : 'land')
    }
  }
  const f: ShoreField = { map, tide: t, ground, cls, val, ctx: ctxv, fp: new Map(), bands: new Map(), bmask: undefined }
  byTide.set(t, f)
  return f
}

/** 건물 외관 그림(건물 사각형 왼쪽 아래에 맞춰 그린다 — scene.ts drawStatic과 같은 자리)의 막는 픽셀 */
function buildingMask(map: MapDef): Uint8Array | null {
  const b = map.building
  const art = b ? SPRITES[map.buildingSprite] : undefined
  if (!b || !art) return null
  const w = b.w * TILE
  const h = b.h * TILE
  const top = h - art.h // 사각형 위쪽 기준 그림 윗줄(음수면 위로 넘친다)
  const mask = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = art.rows[y - top]?.[x]
      mask[y * w + x] = ch === undefined || x >= art.w || (ch !== '.' && ch !== ' ') ? 1 : 0
    }
  }
  return mask
}

/** 건물 칸이고 그림 픽셀로 막는가를 정할 수 있으면 true(문 칸 제외) */
export function isBuildingTile(f: ShoreField, tx: number, ty: number): boolean {
  return tileAt(f.map, tx, ty) === 'building' && maskOf(f) !== null
}

/** 건물 픽셀은 처음 쓸 때 만든다(스프라이트를 건물 칸에 닿을 때만 읽는다) */
function maskOf(f: ShoreField): Uint8Array | null {
  if (f.bmask === undefined) f.bmask = buildingMask(f.map)
  return f.bmask
}

/** 월드 px (x, y)가 건물 그림의 막는 픽셀인가. 건물 사각형 밖이면 false */
export function buildingSolid(f: ShoreField, x: number, y: number): boolean {
  const b = f.map.building
  const mask = b ? maskOf(f) : null
  if (!b || !mask) return false
  const lx = Math.floor(x - b.tx * TILE)
  const ly = Math.floor(y - b.ty * TILE)
  const w = b.w * TILE
  if (lx < 0 || ly < 0 || lx >= w || ly >= b.h * TILE) return false
  return mask[ly * w + lx] === 1
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
  const { map, cls, val, ctx: useCtx } = f
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
      r += WX[a] * (useCtx[i] ? wwVal : val[i])
    }
    s += WY[b] * r
  }
  if (ctx === 'water' || ctx === 'land') {
    const tx = Math.floor(x / TILE)
    const ty = Math.floor(y / TILE)
    const dx = Math.abs(x - (tx * TILE + TILE / 2))
    const dy = Math.abs(y - (ty * TILE + TILE / 2))
    if (ctx === 'land') {
      // 땅 심지: 발 사각형이 칸 가운데에 들어가는 사각형 안은 늘 땅, 밖으로 CORE_RAMP씩 풀린다(모서리가 각지지 않게)
      const ox = Math.max(0, dx - LAND_CORE_HALF.w)
      const oy = Math.max(0, dy - LAND_CORE_HALF.h)
      s = Math.min(s, LAND_CORE_MAX + Math.hypot(ox, oy) * CORE_RAMP)
    } else {
      s = Math.max(s, WATER_CORE_MIN - Math.max(0, Math.hypot(dx, dy) - CORE_R) * CORE_RAMP)
    }
  }
  return s
}

/** 2칸 안에 반대 값이 있으면 물가 후보(B-스플라인이 닿는 범위) */
function mixedNear(f: ShoreField, tx: number, ty: number): boolean {
  const { map, cls, val, ctx: useCtx } = f
  const ctx = cls[ty * map.w + tx]
  const ww = ctx === 'water' ? 1 : 0
  let lo = false
  let hi = false
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const i = clampI(ty + dy, map.h) * map.w + clampI(tx + dx, map.w)
    const v = useCtx[i] ? ww : val[i]
    if (v > 0.5) hi = true
    else lo = true
    if (hi && lo) return true
  }
  return false
}

/** 그 칸 256픽셀(행 우선, 픽셀 중심)의 물 정도. 고정·walkwet 칸, 또는 모든 픽셀이 칸 기본 띠와 같으면 null */
export function shoreBands(f: ShoreField, tx: number, ty: number): Float32Array | null {
  if (tx < 0 || ty < 0 || tx >= f.map.w || ty >= f.map.h) return null
  const key = ty * f.map.w + tx
  const hit = f.bands.get(key)
  if (hit !== undefined) return hit
  const out = computeBands(f, tx, ty)
  f.bands.set(key, out)
  return out
}

function computeBands(f: ShoreField, tx: number, ty: number): Float32Array | null {
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

/** 물체 칸의 발밑(칸 안 px 사각형, Rect를 px 단위로). 물체 칸이 아니면 null.
 * 이웃(상하좌우)이 막힌 칸(다른 물체·절벽·건물·맵 밖 — 물은 물가선이 맡는다)이면 그쪽 변까지 늘린다:
 * 붙어 선 나무 줄·울타리 모서리 사이로 빠져나가지 않게 */
export function footprintAt(f: ShoreField, tx: number, ty: number): Rect | null {
  const key = ty * f.map.w + tx
  const hit = f.fp.get(key)
  if (hit !== undefined) return hit
  const base = baseFootprint(f, tx, ty)
  let r = base
  if (base) {
    const solid = (dx: number, dy: number) => {
      const nx = tx + dx
      const ny = ty + dy
      if (nx < 0 || ny < 0 || nx >= f.map.w || ny >= f.map.h) return true
      if (isWalkable(f.map, nx, ny, ALL_AREAS_OPEN, STATIC_DYNAMIC)) return false
      return f.cls[ny * f.map.w + nx] !== 'water'
    }
    let x0 = base.tx, x1 = base.tx + base.w - 1, y0 = base.ty, y1 = base.ty + base.h - 1
    if (solid(-1, 0)) x0 = 0
    if (solid(1, 0)) x1 = TILE - 1
    if (solid(0, -1)) y0 = 0
    if (solid(0, 1)) y1 = TILE - 1
    r = px(x0, x1, y0, y1)
  }
  f.fp.set(key, r)
  return r
}

function baseFootprint(f: ShoreField, tx: number, ty: number): Rect | null {
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

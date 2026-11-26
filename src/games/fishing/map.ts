// 낚시 지역 타일맵 정의와 계산. 순수 모듈: DOM·React·외부 의존 없음.
// 좌표: 타일 (tx, ty)는 정수, 월드 픽셀 Vec은 타일 * TILE. 캐릭터 pos는 발 중앙.
// 맵 자체(행 문자열)는 maps/<지역>.ts에서 defineMap으로 만든다.

import { AREAS, type AreaId } from './data.ts'
import type { Tide } from './clock.ts'

export const TILE = 16

export type TileKind = 'water' | 'sand' | 'grass' | 'path' | 'pier' | 'tree' | 'flower' | 'fence' | 'rock' | 'building' | 'door'
  | 'river' | 'pond' | 'basin' | 'falls' | 'bridge' | 'cliff'
  | 'lake' | 'cave-floor' | 'cave-wall' | 'cave-pool' | 'crystal' | 'lava' | 'cave-mouth' | 'palm' | 'lagoon' | 'dock'
  // 낚시 5부: 진흙(썰물이면 땅, 밀물이면 물), 얼음(걷는 칸, 구멍을 뚫으면 물). 구멍은 행 글자 없이 MapDynamic으로만
  | 'mud' | 'ice'
  // 낚시 5부 M2: 갯골(늘 물)·갈대(키 큰 장애물)·늪·수렁(물)·나무 데크(걷는 칸)·고사목(키 큰 장애물)
  | 'creek' | 'reed' | 'marsh' | 'bog' | 'boardwalk' | 'deadtree'
  // 낚시 5부 M3: 눈(걷는 칸)·온천(물)·눈 소나무(키 큰 장애물)·갑판(걷는 칸)·선체(장애물)·돛대(키 큰 장애물)·심해(물)
  | 'snow' | 'hotspring' | 'snowpine' | 'deck' | 'hull' | 'mast' | 'deep'
  // 마을회관: 실내 바닥(걷는 칸)·실내 벽과 가구(못 걷는 칸). 그림은 맵 backdrop이 그린다
  | 'floor' | 'wall'
  // 내 섬 B: 작업대(못 걷는 칸, 풀밭 위에 그림)
  | 'bench'
  // 내 섬 D: 막는 바깥 꾸미기(못 걷는 칸, 풀밭 위에 물건 그림)
  | 'deco'
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
  m: 'mud', // 진흙(물때)
  i: 'ice', // 얼음
  g: 'creek', // 갯골
  R: 'reed', // 갈대
  z: 'marsh', // 늪
  Q: 'bog', // 수렁
  d: 'boardwalk', // 나무 데크
  X: 'deadtree', // 고사목
  s: 'snow', // 눈
  h: 'hotspring', // 온천
  A: 'snowpine', // 눈 소나무
  e: 'deck', // 갑판
  n: 'hull', // 선체
  M: 'mast', // 돛대
  v: 'deep', // 심해
  F: 'floor', // 실내 바닥
  Y: 'wall', // 실내 벽·가구
  j: 'bench', // 내 섬 작업대
  x: 'deco', // 내 섬 바깥 꾸미기(막는 것)
}

const WALKABLE: ReadonlySet<TileKind> = new Set<TileKind>(['sand', 'grass', 'path', 'pier', 'flower', 'bridge', 'cave-floor', 'cave-mouth', 'dock', 'boardwalk', 'snow', 'deck', 'floor', 'door'])

/** 낚시를 던질 수 있는 물 종류. 용암도 낚시하는 물로 친다(동굴 가장 깊은 곳). 폭포는 포함하지 않는다. */
type WaterKind = 'water' | 'river' | 'pond' | 'basin' | 'lake' | 'cave-pool' | 'crystal' | 'lava' | 'lagoon' | 'creek' | 'marsh' | 'bog' | 'hotspring' | 'deep'
const WATER_LIST: readonly WaterKind[] = ['water', 'river', 'pond', 'basin', 'lake', 'cave-pool', 'crystal', 'lava', 'lagoon', 'creek', 'marsh', 'bog', 'hotspring', 'deep']
export const WATER_KINDS: ReadonlySet<TileKind> = new Set<TileKind>(WATER_LIST)
/** 맵 spots의 열쇠: 늘 물인 종류 + 밀물 진흙(mud) + 얼음 구멍(hole) */
export type SpotKey = WaterKind | 'mud' | 'hole'

/**
 * 맵의 움직이는 상태(낚시 5부). tide: 진흙 칸이 땅(low)인지 물(high)인지. holes: 얼음 구멍 칸("tx,ty").
 * 맵 계산 함수들이 마지막 인자로 받고, 넘기지 않으면 STATIC_DYNAMIC(밀물·구멍 없음)이라 기존 맵은 그대로다.
 */
export type MapDynamic = { tide: Tide; holes: ReadonlySet<string> }
export const STATIC_DYNAMIC: MapDynamic = { tide: 'high', holes: new Set<string>() }
/** 한 방문에 열어 둘 수 있는 얼음 구멍 수 */
export const MAX_HOLES = 3

/** 구멍을 하나 더한다. 같은 칸은 한 번, MAX_HOLES를 넘으면 가장 오래된 것이 다시 언다. 입력은 바꾸지 않는다 */
export function addHole(holes: readonly string[], tx: number, ty: number): string[] {
  const k = `${tx},${ty}`
  if (holes.includes(k)) return [...holes]
  return [...holes, k].slice(-MAX_HOLES)
}

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
export type Gate = { area: AreaId; tiles: Rect; look: 'broken-bridge' | 'rubble' | 'driftwood' | 'vines' | 'snowdrift'; front: TileFacing }

/** 배 타는 곳. front에서 facing을 보면 { kind: 'dock', target }. boat는 배 그림 위치(물 위, 칸 좌표). */
export type Dock = { front: TileFacing; target: AreaId; entry: TileFacing; boat: { tx: number; ty: number } }

/**
 * 순간이동기. tiles는 구조물 칸(2×2)으로 늘 못 걷는다. rows에서는 걸을 수 있는 땅이고 그림은 월드 레이어가 덮는다.
 * front는 순간이동으로 도착해 서는 칸과 방향: 구조물에 붙은 칸이고 facing은 구조물을 등진다(도착하자마자 다시 열리지 않게).
 * 구조물에 붙은 칸에서 구조물을 보면 { kind: 'teleporter' }.
 */
export type Teleporter = { tiles: Rect; front: TileFacing }

/** 명예의 전당 액자 칸: 이 게임 기록 하나(record) 또는 사이트 게시판 순번(site) */
export type FameSlot = { group: 'record'; key: string } | { group: 'site'; index: number }
/** 내 섬 자원 칸: 나무(도끼 → 나무), 바위(곡괭이 → 돌), 철광(곡괭이 → 철) */
export type NodeKind = 'tree' | 'rock' | 'iron'
export type MapNode = { id: string; tx: number; ty: number; kind: NodeKind }
/** 칸 위 물건 그림. id는 상호작용에 돌려줄 값(가구 id) */
export type MapProp = { tx: number; ty: number; sprite: string; id?: string }
/** 고정물(자판기·행거·노트북 등) 앞에서 할 수 있는 일 */
export type FixtureAct =
  | { kind: 'shop' }
  | { kind: 'wardrobe' }
  | { kind: 'laptop' }
  | { kind: 'elevator' }
  | { kind: 'notice'; text: string }
  | { kind: 'fame'; slot: FameSlot }
  | { kind: 'fridge' }
  | { kind: 'trash' }
  | { kind: 'workbench' }
/** front 칸에 서서 front.facing을 보면 act */
export type Fixture = { front: TileFacing; act: FixtureAct }
/**
 * 칸 사이 벽 모서리. v: [x, y0, y1] = x 열의 왼쪽 모서리를 y0..y1 줄(포함)에서 막는다.
 * h: [y, x0, x1] = y 줄의 위쪽 모서리를 x0..x1 열(포함)에서 막는다. 얇은 유리벽처럼 칸을 차지하지 않는 벽.
 */
export type WallSpec = {
  v?: readonly (readonly [x: number, y0: number, y1: number])[]
  h?: readonly (readonly [y: number, x0: number, x1: number])[]
}

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
  /** 건물(마을회관) 자리(타일, 문 줄 포함). 문은 맨 아래 줄의 doorTx 열이고 걸을 수 있다(보통 안쪽 출구). 문이 없는 맵은 null */
  building: { tx: number; ty: number; w: number; h: number; doorTx: number } | null
  spawn: { pos: Vec; facing: Facing }
  /** 물 종류(밀물 진흙 mud, 얼음 구멍 hole 포함) → 낚시 자리 id. 여기 없는 물은 낚시할 수 없다 */
  spots: Partial<Record<SpotKey, string>>
  exits: readonly Exit[]
  gates: readonly Gate[]
  docks: readonly Dock[]
  /** 실내(동굴 등): 비·눈·밤 색조를 그리지 않는다 */
  indoor: boolean
  /** 세계 지도 위 맵 왼쪽 위의 칸 좌표. 순간이동 거리 계산용 */
  world: { tx: number; ty: number }
  /** 순간이동기. 없는 맵은 null */
  teleporter: Teleporter | null
  /** 물때가 있는 맵(진흙 칸 그림·걷기가 물때를 따른다) */
  tidal: boolean
  /** 안개(장면 효과만) */
  fog: boolean
  /** 늘 눈: 비 오는 날을 계절과 무관하게 눈으로 그린다(출현 조건은 그대로 rain) */
  snowy: boolean
  /** 칸 사이 벽 모서리 키(`v:x,y` = x 열 왼쪽, `h:x,y` = y 줄 위쪽) */
  walls: ReadonlySet<string>
  /** 고정물 */
  fixtures: readonly Fixture[]
  /** 큰 지도·미니맵에 그리는 맵인가(실내 지역 마을회관은 false) */
  onWorldMap: boolean
  /** 칸 그림 대신 정적 레이어에 (0,0)부터 그릴 스프라이트 이름. 없으면 null */
  backdrop: string | null
  /** 자원 칸(내 섬 B): 그 칸을 보면 { kind: 'node' }. 드러난 칸만 */
  nodes: readonly MapNode[]
  /** 칸 위에 그리는 물건(집 안 가구). 그 칸은 rows에서 이미 못 걷는 칸이다 */
  props: readonly MapProp[]
  /** 가구를 놓는 맵(집 안): 빈 바닥을 보면 { kind: 'furnSpot' } */
  placeable: boolean
  /** 건물 외관 스프라이트(건물 사각형 왼쪽 아래에 맞춰 그린다). 기본 마을회관 'hall-exterior', 내 섬은 'tent' */
  buildingSprite: string
}

export function tileAt(map: MapDef, tx: number, ty: number): TileKind | null {
  if (ty < 0 || ty >= map.h || tx < 0 || tx >= map.w) return null
  return TILE_CHARS[map.rows[ty][tx]] ?? null
}

/** rows의 칸만 본 걷기 가능 여부(문 잠김 무시). 진흙은 썰물에만, 얼음은 구멍이 아닐 때 */
function tileWalkable(map: MapDef, tx: number, ty: number, dyn: MapDynamic = STATIC_DYNAMIC): boolean {
  const kind = tileAt(map, tx, ty)
  if (kind === 'mud') return dyn.tide === 'low'
  if (kind === 'ice') return !dyn.holes.has(`${tx},${ty}`)
  return kind !== null && WALKABLE.has(kind)
}

/** 그 칸이 지금 물이면 spots 열쇠(늘 물 종류·밀물 진흙 'mud'·얼음 구멍 'hole'), 아니면 null */
function waterKeyAt(map: MapDef, tx: number, ty: number, dyn: MapDynamic): SpotKey | null {
  const kind = tileAt(map, tx, ty)
  if (kind === 'mud') return dyn.tide === 'high' ? 'mud' : null
  if (kind === 'ice') return dyn.holes.has(`${tx},${ty}`) ? 'hole' : null
  return kind !== null && WATER_KINDS.has(kind) ? (kind as WaterKind) : null
}

/** (tx,ty)에서 (tx+dx,ty+dy) 이웃 칸으로 가는 모서리가 벽인가. dx·dy는 하나만 ±1 */
export function blockedBetween(map: MapDef, tx: number, ty: number, dx: number, dy: number): boolean {
  if (map.walls.size === 0) return false
  if (dx !== 0) return map.walls.has(`v:${dx > 0 ? tx + 1 : tx},${ty}`)
  return map.walls.has(`h:${tx},${dy > 0 ? ty + 1 : ty}`)
}

/** 픽셀 사각형의 열린 안쪽(x0<x<x1, y0<y<y1)을 벽 모서리가 지나는가 */
export function edgeHits(map: MapDef, x0: number, y0: number, x1: number, y1: number): boolean {
  if (map.walls.size === 0) return false
  const eps = 1e-6
  const tx0 = Math.floor((x0 + eps) / TILE)
  const tx1 = Math.floor((x1 - eps) / TILE)
  const ty0 = Math.floor((y0 + eps) / TILE)
  const ty1 = Math.floor((y1 - eps) / TILE)
  // 세로 모서리 X*TILE이 x0<..<x1 안에 있으면, 사각형이 걸친 줄들에서 그 모서리를 본다
  for (let X = tx0 + 1; X <= tx1; X++) for (let ty = ty0; ty <= ty1; ty++) if (map.walls.has(`v:${X},${ty}`)) return true
  for (let Y = ty0 + 1; Y <= ty1; Y++) for (let tx = tx0; tx <= tx1; tx++) if (map.walls.has(`h:${tx},${Y}`)) return true
  return false
}

function wallKeys(spec: WallSpec | undefined): ReadonlySet<string> {
  const out = new Set<string>()
  for (const [x, y0, y1] of spec?.v ?? []) for (let y = y0; y <= y1; y++) out.add(`v:${x},${y}`)
  for (const [y, x0, x1] of spec?.h ?? []) for (let x = x0; x <= x1; x++) out.add(`h:${x},${y}`)
  return out
}

const inRect = (r: Rect, tx: number, ty: number): boolean => tx >= r.tx && tx < r.tx + r.w && ty >= r.ty && ty < r.ty + r.h

/** 걸을 수 있는 칸인가. 순간이동기 칸과 잠긴 문(opened에 그 지역이 없음)의 칸은 못 걷고, 열린 문 칸은 rows 원래 칸의 규칙대로. */
export function isWalkable(map: MapDef, tx: number, ty: number, opened: Opened, dyn: MapDynamic = STATIC_DYNAMIC): boolean {
  if (!tileWalkable(map, tx, ty, dyn)) return false
  if (map.teleporter && inRect(map.teleporter.tiles, tx, ty)) return false
  return !map.gates.some((g) => !opened.has(g.area) && inRect(g.tiles, tx, ty))
}

export function tileOf(pos: Vec): { tx: number; ty: number } {
  return { tx: Math.floor(pos.x / TILE), ty: Math.floor(pos.y / TILE) }
}

/**
 * 서 있는 칸. 발 중심이 든 칸이 (rows 기준) 걷는 칸이면 그 칸, 아니면(물 칸 안의 둥근 땅·나무 칸 아래쪽 등 — 걷기 판정은
 * 그린 물가선·물체 발밑을 쓴다) 8이웃 가운데 걷는 칸 중 발 중심에서 칸 사각형까지 가장 가까운 칸
 * (같으면 위·아래·왼쪽·오른쪽, 그다음 대각선). 그런 칸이 없으면 tileOf.
 */
export function standTile(map: MapDef, pos: Vec, dyn: MapDynamic = STATIC_DYNAMIC): { tx: number; ty: number } {
  const here = tileOf(pos)
  if (tileWalkable(map, here.tx, here.ty, dyn)) return here
  let best: { tx: number; ty: number } | null = null
  let bestD = Infinity
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const tx = here.tx + dx
    const ty = here.ty + dy
    if (!tileWalkable(map, tx, ty, dyn)) continue
    const ox = Math.max(tx * TILE - pos.x, 0, pos.x - (tx + 1) * TILE)
    const oy = Math.max(ty * TILE - pos.y, 0, pos.y - (ty + 1) * TILE)
    const d = Math.hypot(ox, oy)
    if (d < bestD - 1e-9) {
      best = { tx, ty }
      bestD = d
    }
  }
  return best ?? here
}

function tileCenter(tx: number, ty: number): Vec {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }
}

function findTiles(map: MapDef, kind: TileKind): { tx: number; ty: number }[] {
  const out: { tx: number; ty: number }[] = []
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) if (tileAt(map, tx, ty) === kind) out.push({ tx, ty })
  return out
}

// 건물 자리: 문 D와 건물 B를 감싸는 사각형. 맵 글자에서 읽어 오므로 맵을 고치면 함께 바뀐다.
function computeBuilding(map: MapDef): MapDef['building'] {
  const doors = findTiles(map, 'door')
  if (doors.length === 0) return null
  if (doors.length !== 1) throw new Error(`map needs exactly one door, found ${doors.length}`)
  const parts = [...findTiles(map, 'building'), doors[0]]
  const tx = Math.min(...parts.map((p) => p.tx))
  const ty = Math.min(...parts.map((p) => p.ty))
  const w = Math.max(...parts.map((p) => p.tx)) - tx + 1
  const h = Math.max(...parts.map((p) => p.ty)) - ty + 1
  if (doors[0].ty !== ty + h - 1) throw new Error('building door must be in the bottom row of the building')
  return { tx, ty, w, h, doorTx: doors[0].tx }
}

export type MapOpts = {
  spots?: MapDef['spots']; exits?: Exit[]; gates?: Gate[]; docks?: Dock[]; indoor?: boolean
  world?: MapDef['world']; teleporter?: Teleporter
  tidal?: boolean; fog?: boolean; snowy?: boolean
  walls?: WallSpec; fixtures?: Fixture[]; onWorldMap?: boolean; backdrop?: string; buildingSprite?: string; nodes?: MapNode[]; props?: MapProp[]; placeable?: boolean
}

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
  map.fixtures.forEach((f, i) => {
    if (!tileWalkable(map, f.front.tx, f.front.ty)) throw new Error(`fixture ${i} front is not walkable`)
  })
  const tp = map.teleporter
  if (tp) {
    const { tiles, front } = tp
    if (!rectInside(map, tiles)) throw new Error('teleporter tiles are outside the map')
    for (let ty = tiles.ty; ty < tiles.ty + tiles.h; ty++) for (let tx = tiles.tx; tx < tiles.tx + tiles.w; tx++) {
      if (!tileWalkable(map, tx, ty)) throw new Error(`teleporter tile (${tx},${ty}) is not ground`)
    }
    if (!tileWalkable(map, front.tx, front.ty) || inRect(tiles, front.tx, front.ty)) {
      throw new Error('teleporter front is not a walkable tile outside the teleporter')
    }
    const touches = Object.values(STEP).some(({ dx, dy }) => inRect(tiles, front.tx + dx, front.ty + dy))
    const { dx, dy } = STEP[front.facing]
    if (!touches) throw new Error('teleporter front does not touch the teleporter')
    if (inRect(tiles, front.tx + dx, front.ty + dy)) throw new Error('teleporter front must face away from the teleporter')
  }
}

/** 행 문자열로 맵을 만든다. 행 길이가 다르거나, 상점 문이 둘 이상이거나, 문·선착장 정의가 잘못되면 throw. */
export function defineMap(id: AreaId, rows: readonly string[], opts: MapOpts = {}): MapDef {
  if (rows.length === 0) throw new Error('map needs at least one row')
  const w = rows[0].length
  rows.forEach((row, i) => {
    if (row.length !== w) throw new Error(`map row ${i} has length ${row.length}, expected ${w}`)
  })
  const map: MapDef = {
    id, rows, w, h: rows.length, building: null, spawn: { pos: { x: 0, y: 0 }, facing: 'down' },
    spots: opts.spots ?? {}, exits: opts.exits ?? [], gates: opts.gates ?? [], docks: opts.docks ?? [], indoor: opts.indoor ?? false,
    world: opts.world ?? { tx: 0, ty: 0 }, teleporter: opts.teleporter ?? null,
    tidal: opts.tidal ?? false, fog: opts.fog ?? false, snowy: opts.snowy ?? false,
    walls: wallKeys(opts.walls), fixtures: opts.fixtures ?? [], onWorldMap: opts.onWorldMap ?? true, backdrop: opts.backdrop ?? null,
    buildingSprite: opts.buildingSprite ?? 'hall-exterior',
    nodes: opts.nodes ?? [],
    props: opts.props ?? [],
    placeable: opts.placeable ?? false,
  }
  checkPlaces(map)
  map.building = computeBuilding(map)
  // 시작 위치: 문 앞(문 바로 아래 타일), 문이 없으면 첫 걸을 수 있는 칸
  const at = doorSpot(map) ?? firstWalkable(map)
  map.spawn = { pos: tileCenter(at.tx, at.ty), facing: 'down' }
  return map
}

function firstWalkable(map: MapDef): { tx: number; ty: number } {
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) if (tileWalkable(map, tx, ty)) return { tx, ty }
  throw new Error('map has no walkable tile')
}

/** 건물 문 바로 아래 타일. 건물이 없으면 null. */
export function doorSpot(map: MapDef): { tx: number; ty: number } | null {
  return map.building ? { tx: map.building.doorTx, ty: map.building.ty + map.building.h } : null
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
  // 출구는 발 중심이 그 칸에 실제로 들어갔을 때만(standTile을 쓰지 않는다: 출구 옆 물 칸의 둥근 땅에서 넘어가지 않게)
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
export function reachableTiles(
  map: MapDef, starts: readonly { tx: number; ty: number }[], opened: Opened, dyn: MapDynamic = STATIC_DYNAMIC,
): ReadonlySet<string> {
  const seen = new Set<string>()
  const queue: { tx: number; ty: number }[] = []
  const visit = (tx: number, ty: number) => {
    const k = `${tx},${ty}`
    if (seen.has(k) || !isWalkable(map, tx, ty, opened, dyn)) return
    seen.add(k)
    queue.push({ tx, ty })
  }
  for (const s of starts) visit(s.tx, s.ty)
  for (let i = 0; i < queue.length; i++) {
    const { tx, ty } = queue[i]
    for (const { dx, dy } of Object.values(STEP)) if (!blockedBetween(map, tx, ty, dx, dy)) visit(tx + dx, ty + dy)
  }
  return seen
}

/**
 * 밀물이 들어올 때 진흙 위 캐릭터를 세울 칸: from에서 진흙 칸만 지나(4방향) 닿는 가장 가까운 "늘 걷는 칸"
 * (밀물 기준으로 걸을 수 있는 칸). 같은 거리면 ty, 그다음 tx가 작은 쪽. from이 이미 늘 걷는 칸이면 from. 없으면 null.
 */
export function nearestDryTile(map: MapDef, from: { tx: number; ty: number }, opened: Opened): { tx: number; ty: number } | null {
  const dry = (tx: number, ty: number) => isWalkable(map, tx, ty, opened, STATIC_DYNAMIC)
  if (dry(from.tx, from.ty)) return { tx: from.tx, ty: from.ty }
  const seen = new Set<string>([`${from.tx},${from.ty}`])
  let layer = [{ tx: from.tx, ty: from.ty }]
  while (layer.length > 0) {
    const next: { tx: number; ty: number }[] = []
    const found: { tx: number; ty: number }[] = []
    for (const c of layer) {
      for (const { dx, dy } of Object.values(STEP)) {
        if (blockedBetween(map, c.tx, c.ty, dx, dy)) continue
        const n = { tx: c.tx + dx, ty: c.ty + dy }
        const k = `${n.tx},${n.ty}`
        if (seen.has(k)) continue
        seen.add(k)
        if (dry(n.tx, n.ty)) found.push(n)
        else if (tileAt(map, n.tx, n.ty) === 'mud') next.push(n)
      }
    }
    if (found.length > 0) return found.sort((a, b) => a.ty - b.ty || a.tx - b.tx)[0]
    layer = next
  }
  return null
}

export type Interaction =
  | FixtureAct
  | { kind: 'fish'; spot: string }
  | { kind: 'gate'; area: AreaId }
  | { kind: 'dock'; target: AreaId }
  | { kind: 'teleporter' }
  | { kind: 'drill' }
  | { kind: 'node'; id: string; res: NodeKind }
  | { kind: 'furn'; tx: number; ty: number; id: string }
  | { kind: 'furnSpot'; tx: number; ty: number }
  // 내 섬 꾸미기 모드(화면이 만든다, interactionAt은 돌려주지 않는다)
  | { kind: 'decoSpot'; tx: number; ty: number }
  | { kind: 'decoHere'; tx: number; ty: number }
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

// 서 있는 타일 = standTile(pos), 앞 타일 = 서 있는 타일 + facing.
// 잠긴 문의 front에서 그 방향을 보면 gate, 선착장 front에서 그 방향을 보면 dock(열림과 무관: 화면이 구매/출발을 가른다).
// 앞 칸이 순간이동기 구조물이면 teleporter(켜짐과 무관: 화면이 목록/안내를 가른다).
// 고정물 front에서 그 방향을 보면 고정물의 act. 그 외: 앞이 물이고 spotFor가 값을 주면 낚시, 그 외(폭포·절벽 포함) null.
// 낚시 5부: 앞이 얼음이고 구멍이 아니면(맵에 얼음 구멍 자리가 있을 때) drill, 앞이 구멍·밀물 진흙이면 그 자리 낚시.
export function interactionAt(map: MapDef, pos: Vec, facing: Facing, opened: Opened, dyn: MapDynamic = STATIC_DYNAMIC): Interaction {
  const here = standTile(map, pos, dyn)
  const gate = map.gates.find((g) => !opened.has(g.area) && standsAt(here, facing, g.front))
  if (gate) return { kind: 'gate', area: gate.area }
  const dock = map.docks.find((d) => standsAt(here, facing, d.front))
  if (dock) return { kind: 'dock', target: dock.target }
  const fixture = map.fixtures.find((f) => standsAt(here, facing, f.front))
  if (fixture) return fixture.act
  const { dx, dy } = STEP[facing]
  if (map.teleporter && inRect(map.teleporter.tiles, here.tx + dx, here.ty + dy)) return { kind: 'teleporter' }
  const node = map.nodes.find((n) => n.tx === here.tx + dx && n.ty === here.ty + dy)
  if (node) return { kind: 'node', id: node.id, res: node.kind }
  const prop = map.props.find((p) => p.tx === here.tx + dx && p.ty === here.ty + dy)
  if (prop?.id) return { kind: 'furn', tx: prop.tx, ty: prop.ty, id: prop.id }
  if (map.placeable && tileAt(map, here.tx + dx, here.ty + dy) === 'floor') return { kind: 'furnSpot', tx: here.tx + dx, ty: here.ty + dy }
  const fx = here.tx + dx
  const fy = here.ty + dy
  const front = tileAt(map, fx, fy)
  if (front === 'ice' && map.spots.hole !== undefined && !dyn.holes.has(`${fx},${fy}`)) return { kind: 'drill' }
  const key = waterKeyAt(map, fx, fy, dyn)
  if (key === 'mud' || key === 'hole') {
    const spot = map.spots[key]
    return spot === undefined ? null : { kind: 'fish', spot }
  }
  const spot = spotFor(map, tileAt(map, here.tx, here.ty), front)
  return spot === null ? null : { kind: 'fish', spot }
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

// 찌가 떨어질 월드 위치. 발에서 facing 방향으로 (1.5 + 3.5 * power) 타일.
// 앞 타일부터 한 칸씩 나아가다(물 종류가 섞여도 계속) 물이 아닌 타일(맵 밖 포함)을 만나면 그 직전 물 타일의 중앙.
// 끝 지점 타일까지 모두 물이면 끝 지점 그대로. 앞 타일부터 물이 아니면(낚시 불가 자리) 앞 타일 중앙.
// 밀물 진흙·얼음 구멍도 물로 본다(dyn).
export function castTarget(map: MapDef, pos: Vec, facing: Facing, power: number, dyn: MapDynamic = STATIC_DYNAMIC): Vec {
  const { dx, dy } = STEP[facing]
  const dist = (1.5 + 3.5 * clamp01(power)) * TILE
  const end = { x: pos.x + dx * dist, y: pos.y + dy * dist }
  const from = standTile(map, pos, dyn)
  const to = tileOf(end)
  const steps = Math.abs(to.tx - from.tx) + Math.abs(to.ty - from.ty)
  for (let k = 1; k <= steps; k++) {
    if (waterKeyAt(map, from.tx + dx * k, from.ty + dy * k, dyn) === null) {
      const back = Math.max(1, k - 1)
      return tileCenter(from.tx + dx * back, from.ty + dy * back)
    }
  }
  return end
}

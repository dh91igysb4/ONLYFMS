// 낚시 마을 타일맵. 순수 모듈: DOM·React·외부 의존 없음.
// 좌표: 타일 (tx, ty)는 정수, 월드 픽셀 Vec은 타일 * TILE. 캐릭터 pos는 발 중앙.
// 위쪽은 풀밭 마을(상점, 나무, 꽃, 울타리, 돌, 굽은 길), 가운데는 모래사장, 아래는 바다와 나무 부두 하나.

export const TILE = 16

export type TileKind = 'water' | 'sand' | 'grass' | 'path' | 'pier' | 'tree' | 'flower' | 'fence' | 'rock' | 'building' | 'door'
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
}

// 테두리는 모두 걸을 수 없다: 위·옆 마을은 나무, 모래사장 양옆은 바위, 바다는 물.
// 상점은 B 블록(문 D 포함)이 SHOP 사각형을 정확히 채운다. 문 아래 타일이 SHOP_SPOT.
// 길(=)은 문 → 아래 → 오른쪽 → 아래 → 오른쪽 → 아래로 꺾이며 부두(#) 위 모래사장에 닿는다.
// 앞바다 바위(o)는 장식이자 찌가 바위 앞 물에서 멈추는 지점.
export const MAP_ROWS: readonly string[] = [
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'TTTTTT,T,,,,,,,,TT,T,TT,,,,TT,T,,TT,T,TT,T,TTTTT',
  'TT,T,,,,,,BBBBB,f,,f,,,,,,,,T,,,,,,,,,,,,,,,,,TT',
  'TT,,,,T,,,BBBBB,,f,,f,,,f,,,,,,,,,,,T,,,T,,,,,TT',
  'T,,,,f,,,,BBBBB,||||||,,,,,,,,T,,,,,,,T,,,,,,,TT',
  'TT,,,,,,,,BBDBB,,,,,,,,,,,,,,,,,,,,,,,,,,,T,,,,T',
  'TT,f,,,,f,,,=,,,,,,,,,,,,,,T,,,,,,,,,T,,,,,,,,,T',
  'T,,,,,,,,,,,=,,f,,,,,,,,,,,,,,,,f,,,,,,,,T,,,,TT',
  'T,,|||||||,,=,,,,,,,,,o,,,,,,,,,,,,T,,,,,,,,,,TT',
  'TT,|f,,,f|,,=======,,,,,,,,,,,,T,,,,,,,T,,,,T,,T',
  'TT,|,ff,,,,,,,,,,,=,,,,,,,,,f,,,,,,,,,,,,,f,,,,T',
  'T,,|,,ff,,,,,f,,,,=,,,f,,,,,,,,,,T,,,,o,,,,,,,TT',
  'T,,|,f,,,|,,T,,T,,=,,,,,,,,,,,T,,,,,,,,,,,,T,,TT',
  'TT,|||||||,,,,,,,,========,,,,,,,,,,T,,,T,,,,,,T',
  'TT,,,,,,,,,,,,,,,,,,,,,,,=,,,,,,,,f,,,,,,,,,,,,T',
  'T,T,f,,,T,,f,,o,,,,,,,T,,=,,,f,o,,,,,f,,,,,,T,TT',
  'T,,,,,o,,,,,,,,,,,,,f,,,,=,,,,,,,,,,,,,,,,,,,,,T',
  'T,,......,,,,,,,,,,,.....=.....,,,,,,.....,,,,,T',
  'o...........,,,,,...............,,,........,,,.o',
  'o..............................................o',
  'o...........................................o..o',
  'o.........o....................................o',
  'o................................o.............o',
  'o..................o...........................o',
  'o~~............................................o',
  'o~~~~..........~~~...........................~~o',
  '~~~~~~~~~~~~~~~~~~~~~~~~~#~~~~~~~~~~~~~~.....~~~',
  '~~~~~~~~o~~~~~~~~~~~~~~~~#~~~~~~~~~~~~~~~...~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~#~~~~~~~~~~o~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~o~~~~#~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~#~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
]

export const MAP_W = MAP_ROWS[0].length
export const MAP_H = MAP_ROWS.length

const WALKABLE: ReadonlySet<TileKind> = new Set<TileKind>(['sand', 'grass', 'path', 'pier', 'flower'])

const STEP: Readonly<Record<Facing, { dx: number; dy: number }>> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}

export function tileAt(tx: number, ty: number): TileKind | null {
  if (ty < 0 || ty >= MAP_H || tx < 0 || tx >= MAP_W) return null
  return TILE_CHARS[MAP_ROWS[ty][tx]] ?? null
}

export function isWalkable(tx: number, ty: number): boolean {
  const kind = tileAt(tx, ty)
  return kind !== null && WALKABLE.has(kind)
}

export function tileOf(pos: Vec): { tx: number; ty: number } {
  return { tx: Math.floor(pos.x / TILE), ty: Math.floor(pos.y / TILE) }
}

function tileCenter(tx: number, ty: number): Vec {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }
}

function findTiles(kind: TileKind): { tx: number; ty: number }[] {
  const out: { tx: number; ty: number }[] = []
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) if (tileAt(tx, ty) === kind) out.push({ tx, ty })
  return out
}

// 상점 건물 자리(타일, 문 줄 포함). 문은 맨 아래 줄의 doorTx 열. 건물 스프라이트는 이 사각형에 맞춰 그린다.
// 지금 맵: tx 10, ty 2, 5×4 타일, 문 tx 12 (ty 5). 맵 글자에서 읽어 오므로 맵을 고치면 함께 바뀐다.
export const SHOP: { tx: number; ty: number; w: number; h: number; doorTx: number } = (() => {
  const doors = findTiles('door')
  if (doors.length !== 1) throw new Error(`map needs exactly one door, found ${doors.length}`)
  const parts = [...findTiles('building'), doors[0]]
  const tx = Math.min(...parts.map((p) => p.tx))
  const ty = Math.min(...parts.map((p) => p.ty))
  const w = Math.max(...parts.map((p) => p.tx)) - tx + 1
  const h = Math.max(...parts.map((p) => p.ty)) - ty + 1
  if (doors[0].ty !== ty + h - 1) throw new Error('shop door must be in the bottom row of the building')
  return { tx, ty, w, h, doorTx: doors[0].tx }
})()

// 문 바로 아래 타일. 여기 서서 위를 보면 상점.
export const SHOP_SPOT: { tx: number; ty: number } = { tx: SHOP.doorTx, ty: SHOP.ty + SHOP.h }

export const SPAWN: { pos: Vec; facing: Facing } = { pos: tileCenter(SHOP_SPOT.tx, SHOP_SPOT.ty), facing: 'down' }

// 부두는 모래사장에서 아래(바다 쪽)로 뻗는다. 맨 끝 = 가장 아래 부두 타일.
export const PIER_END: { tx: number; ty: number } = (() => {
  const pier = findTiles('pier')
  if (pier.length === 0) throw new Error('map needs a pier')
  const maxTy = Math.max(...pier.map((p) => p.ty))
  const ends = pier.filter((p) => p.ty === maxTy)
  if (ends.length !== 1) throw new Error('pier must end in a single tile')
  return ends[0]
})()

export type Interaction = { kind: 'shop' } | { kind: 'fish'; spot: 'pier' | 'shore' } | null

// 서 있는 타일 = tileOf(pos), 앞 타일 = 서 있는 타일 + facing.
// 앞이 문이고 위를 보면 상점, 앞이 물이면 낚시(서 있는 타일이 부두면 'pier'), 그 외 null.
export function interactionAt(pos: Vec, facing: Facing): Interaction {
  const here = tileOf(pos)
  const { dx, dy } = STEP[facing]
  const front = tileAt(here.tx + dx, here.ty + dy)
  if (front === 'door') return facing === 'up' ? { kind: 'shop' } : null
  if (front === 'water') return { kind: 'fish', spot: tileAt(here.tx, here.ty) === 'pier' ? 'pier' : 'shore' }
  return null
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

// 찌가 떨어질 월드 위치. 발에서 facing 방향으로 (1.5 + 3.5 * power) 타일.
// 앞 타일부터 한 칸씩 나아가다 물이 아닌 타일(맵 밖 포함)을 만나면 그 직전 물 타일의 중앙.
// 끝 지점 타일까지 모두 물이면 끝 지점 그대로. 앞 타일부터 물이 아니면(낚시 불가 자리) 앞 타일 중앙.
export function castTarget(pos: Vec, facing: Facing, power: number): Vec {
  const { dx, dy } = STEP[facing]
  const dist = (1.5 + 3.5 * clamp01(power)) * TILE
  const end = { x: pos.x + dx * dist, y: pos.y + dy * dist }
  const from = tileOf(pos)
  const to = tileOf(end)
  const steps = Math.abs(to.tx - from.tx) + Math.abs(to.ty - from.ty)
  for (let k = 1; k <= steps; k++) {
    if (tileAt(from.tx + dx * k, from.ty + dy * k) !== 'water') {
      const back = Math.max(1, k - 1)
      return tileCenter(from.tx + dx * back, from.ty + dy * back)
    }
  }
  return end
}

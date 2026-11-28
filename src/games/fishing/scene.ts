// 낚시 마을 장면 그리기(설계 §4.5, §6.1). 타일맵을 카메라로 잘라 그리고, 그 위에 찌·캐릭터·나무 윗부분·HUD를 얹는다.
// 좌표: 월드 픽셀(맵 왼쪽 위 = 0,0), 화면 = 월드 - camera. 캐릭터 pos는 발 중앙.
// 캔버스는 CSS로 정수 배 확대하고 image-rendering: pixelated, ctx.imageSmoothingEnabled = false.
// 그리기는 fillRect만 쓴다(정적 레이어 캐시를 화면에 옮길 때만 drawImage). HUD 시계 글자도 픽셀 숫자 스프라이트다.
// 캔버스 내부 색은 theme 토큰 규칙의 승인된 예외(설계 §5)다.
import { effectiveBarSize, surgePhase, type Bar, type BarParams } from './minigame.ts'
import { STATIC_DYNAMIC, TILE, tileAt, type Facing, type MapDef, type MapDynamic, type Opened, type Rect, type TileKind, type Vec } from './map.ts'
import type { Player } from './walk.ts'
import { SPRITES, drawSprite, drawSpriteData, type Sprite } from './sprites.ts'
import { composePose, decodeOutfit, playerSprites } from './outfit.ts'
import { FAME_ROW, type FameFrame } from './fame.ts'
import type { Outfit } from './wardrobe.ts'
import { computeGround, ON_NEIGHBOUR_GROUND, WATER_GROUND, type Ground } from './ground.ts'
import { FOAM_BAND, SAND_BAND, SHORE_LINE, WET_BAND, shoreBands, shoreClassAt, shoreField, type ShoreField } from './shore.ts'
import { footprintAlpha, NO_FOOTPRINTS, stepFootprints, type Footprints } from './footprints.ts'
import { formatClock, isSnow, nightLevel, type Conditions, type Tide } from './clock.ts'

export type Phase = 'idle' | 'charging' | 'waiting' | 'bite' | 'fighting' | 'caught' | 'lost'
/** tMs: 애니메이션 시계(ms). 계속 늘어나기만 하면 된다. gauge는 0~1. camera는 화면 왼쪽 위의 월드 좌표. */
export type WorldScene = {
  map: MapDef
  phase: Phase
  tMs: number
  gauge: number
  player: Player
  camera: Vec
  /** 찌가 떨어진 월드 위치. waiting·bite·fighting(·lost의 물결)에서 그린다 */
  bobber: Vec | null
  bar: Bar | null
  barParams: BarParams | null
  caughtSpecies: string | null
  /** 게임 시계·날씨(HUD 시계, 밤 색조, 비·눈) */
  cond: Conditions
  /** HUD 시계를 이 y(논리 px) 아래에 둔다. 터치에서 캔버스 위에 겹치는 안내 줄을 피한다. 데스크톱은 0 */
  hudTop: number
  /** 지역 전환 페이드: 화면 전체 검정 채우기 알파(0~1). 0이면 그리지 않는다 */
  fade: number
  /** 열린 지역. 여기 없는 지역의 문은 잠긴 그림(look)으로 덮는다 */
  opened: Opened
  /** 이 맵의 순간이동기가 켜져 있는가(등롱 불빛) */
  teleporterOn: boolean
  /** 입은 옷. 없으면 원래 그림. 옷차림마다 15장을 한 번만 합성해 캐시한다(outfit.ts) */
  outfit?: Outfit
  /** 맵의 움직이는 상태(물때·얼음 구멍). 없으면 STATIC_DYNAMIC */
  dyn?: MapDynamic
  /** 얼음 구멍을 뚫는 중: 칸과 지난 시간(ms). 없으면 null */
  drill?: { tx: number; ty: number; ms: number } | null
  /** 신화를 잡은 뒤 지난 시간(ms). MYTHIC_FLASH_MS 동안 캐릭터 둘레에 빛고리. 없으면 null */
  mythicFlashMs?: number | null
  /** 자랑: 내 캐릭터가 머리 위로 든 어종 id. 없으면 null·생략 */
  holding?: string | null
  /** 같은 지역의 다른 사람(온라인 설계 §4.3). 그리기만 하고 판정에는 쓰지 않는다 */
  others?: ScenePeer[]
  /** 마을회관 명예의 전당 액자(fame.ts). backdrop 맵에서만 그린다 */
  fame?: readonly FameFrame[]
}

/** 같은 지역 친구 한 명. pos는 발 중앙(월드 픽셀) */
/** holding: 자랑으로 머리 위에 든 어종 id(설계 2026-11-25-fishing-brag-discard). 없으면 null·생략 */
export type ScenePeer = { pos: Vec; facing: Facing; moving: boolean; walkMs: number; act: 'walk' | 'fish'; outfit: Outfit; holding?: string | null }

/** 화면 좌표 사각형 */
export type Box = { x: number; y: number; w: number; h: number }

/** 가장 작은 화면(논리 크기). 화면 쪽 fitScene이 이보다 작게 만들지 않는다. */
export const SCENE_W = 160
export const SCENE_H = 240
export type SceneSize = { w: number; h: number }

const WATER_FRAME_MS = 500
const WALK_FRAME_MS = 200
/** 나무·야자수 밑동(줄기 아래 끝)의 칸 안 y. 캐릭터 발이 이보다 위면 윗부분이 캐릭터를 가린다. */
const TREE_BASE = 10
/** 16×32 스프라이트로 윗칸까지 솟는 타일: 아래 16px는 정적 레이어, 위 16px는 캐릭터와 발 y 순으로 */
const TALL_SPRITE: Readonly<Partial<Record<TileKind, string>>> = { tree: 'tile-tree', palm: 'tile-palm', reed: 'tile-reed', deadtree: 'tile-deadtree', snowpine: 'tile-snowpine', mast: 'tile-mast' }

// 스프라이트 크기
const PLAYER_W = 16
const PLAYER_H = 24

// 자세별 낚싯대 끝(스프라이트 안 좌표, 오른쪽을 볼 때). 왼쪽은 x를 거울로 뒤집는다.
export const ROD_TIP: Readonly<Record<string, [number, number]>> = {
  'player-idle-down': [14, 2],
  'player-cast': [5, 0],
  'player-reel': [15, 23],
  'player-cast-up': [3, 0],
  'player-reel-up': [14, 0],
  'player-cast-side': [0, 0],
  'player-reel-side': [15, 16],
}

// 세로 트랙(fighting): 트랙 + 틈 + 진행 게이지를 hudSide 쪽 가장자리에 둔다
const TRACK_W = 18
const TRACK_MAX_H = 132
const METER_GAP = 3
const METER_W = 6
const HUD_MARGIN = 7
const HUD_W = TRACK_W + METER_GAP + METER_W
const GAUGE_W = 30

const C = {
  outline: '#2a2135',
  sandWet: '#c7a96e',
  footprint: '#b0915a', // 모래 발자국(젖은 모래보다 한 단계 짙게)
  foam: '#e9f6fb',
  bogRim: '#65805a', // 수렁 둘레 늪물(늪 바탕과 같은 색)
  bogEdge: '#3e3a2a', // 수렁 가장자리 진흙
  sedge: '#6f9a52', // 늪 물가 풀(풀밭과 늪 사이)
  sedgeDark: '#58794a', // 물가 풀 끝 그늘
  snowLip: '#f4f8fb', // 물가 눈 턱
  snowShade: '#9fb8c8', // 눈 턱 그늘
  iceRim: '#8fb4c8', // 얼음판 가장자리
  iceShine: '#f6fbfd', // 얼음판 가장자리 빛
  grass: '#78b85c',
  grassDark: '#5f9e4a',
  pierFace: '#6e4526',
  pierFaceDark: '#4e3019',
  pierShadow: '#246593',
  groundShadow: '#1f2a1c55',
  line: '#eef6fa',
  ripple: '#a6dcf2',
  gaugeBg: '#3b3350',
  gaugeLow: '#5ccf6e',
  gaugeMid: '#ffd23f',
  gaugeHigh: '#ff7a59',
  gaugeShine: '#ffffff',
  trackWood: '#a8723f',
  trackWoodLight: '#d39a5f',
  trackInner: '#173a52',
  trackInnerLine: '#1f4a66',
  bar: '#6fdc7e',
  barLight: '#b6f5bf',
  barDark: '#3fa956',
  progLow: '#ff7a59',
  progMid: '#ffd23f',
  progHigh: '#6fdc7e',
  night: '10, 16, 40',
  clockPlate: 'rgba(20, 16, 40, 0.65)',
  rain: '#bfe6f7',
  snow: '#ffffff',
  fog: '24, 32, 30', // 늪 안개(어두운 녹회색)
  mythicRing: '#fff1a8',
  mythicRingEdge: '#ffc94a',
  tidePlate: 'rgba(20, 16, 40, 0.65)',
  surgeEdge: '#ffd23f', // 신화 용솟음 동안 트랙 테두리가 이 색과 외곽선을 번갈아
}

// 비·눈 입자(화면 좌표). 개수 상한 80.
const RAIN_COUNT = 60
const SNOW_COUNT = 40
const RAIN_SPEED = 0.3 // px/ms
const SNOW_SPEED = 0.035
// 시계 판: [여백][계절 아이콘][틈][날씨 아이콘][틈][HH:MM][여백], 높이 12
const CLOCK_PAD = 2
const CLOCK_ICON_GAP = 2
const CLOCK_TEXT_GAP = 3
const DIGIT_GAP = 1
const CLOCK_H = 12
const CLOCK_MARGIN = 3
const SEASON_ICON_W = SPRITES['season-spring'].w
const WEATHER_ICON_W = SPRITES['icon-sun'].w
const CLOCK_TEXT_W = 4 * SPRITES['digit-0'].w + SPRITES['digit-colon'].w + 4 * DIGIT_GAP
const CLOCK_W = CLOCK_PAD + SEASON_ICON_W + CLOCK_ICON_GAP + WEATHER_ICON_W + CLOCK_TEXT_GAP + CLOCK_TEXT_W + CLOCK_PAD

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string): void {
  let x = Math.round(x0)
  let y = Math.round(y0)
  const tx = Math.round(x1)
  const ty = Math.round(y1)
  const dx = Math.abs(tx - x)
  const dy = -Math.abs(ty - y)
  const sx = x < tx ? 1 : -1
  const sy = y < ty ? 1 : -1
  let err = dx + dy
  ctx.fillStyle = color
  for (;;) {
    ctx.fillRect(x, y, 1, 1)
    if (x === tx && y === ty) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
  }
}

// 위에서 본 물결 고리(살짝 납작한 타원)
function ripple(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const steps = Math.max(12, Math.round(r * 5))
  ctx.fillStyle = color
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.55), 1, 1)
  }
}

type Part = { col0: number; col1: number; row0: number; row1: number }

/** 스프라이트의 일부(열 [col0, col1) × 줄 [row0, row1))만 제자리에 그린다. x, y는 스프라이트 왼쪽 위 자리. */
function drawSpritePart(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, part: Part): void {
  const sp = SPRITES[name]
  for (let row = part.row0; row < part.row1; row++) {
    const ln = sp.rows[row]
    let col = part.col0
    while (col < part.col1) {
      const ch = ln[col]
      if (ch === '.') {
        col++
        continue
      }
      let end = col + 1
      while (end < part.col1 && ln[end] === ch) end++
      ctx.fillStyle = sp.palette[ch]
      ctx.fillRect(x + col, y + row, end - col, 1)
      col = end
    }
  }
}

const TREE_BOTTOM: Part = { col0: 0, col1: TILE, row0: TILE, row1: 2 * TILE }
const TREE_TOP: Part = { col0: 0, col1: TILE, row0: 0, row1: TILE }
/** 가로 울타리 기둥이 놓인 열(tile-fence의 5~10열). 끝 칸은 기둥 바깥 난간을 잘라 낸다. */
const FENCE_POST_COL0 = 5
const FENCE_POST_COL1 = 11

/** 타일마다 고정된 작은 난수(풀 무늬·풀 가장자리가 프레임마다 바뀌지 않게) */
function hash(a: number, b: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}

// ── 땅: 타일 아래 깔리는 바탕 ────────────────────────────────────

/** 그리기에 쓰는 맵 + 계산해 둔 땅. tide는 진흙 그림을 정한다(물때 없는 맵은 늘 'high') */
type MapGfx = { map: MapDef; ground: readonly (Ground | null)[]; tide: Tide; field: ShoreField }

function groundAt(g: MapGfx, tx: number, ty: number): Ground | null {
  if (tx < 0 || ty < 0 || tx >= g.map.w || ty >= g.map.h) return null
  return g.ground[ty * g.map.w + tx]
}

// ── 정적 레이어 ─────────────────────────────────────────────────

/** 물 타일 두 장 중 지금 것(0/1). 파도 거품도 같은 박자로 움직인다. */
function waterFrame(tMs: number): number {
  return ((Math.floor(tMs / WATER_FRAME_MS) % 2) + 2) % 2
}

/** 거품 점선: 8px마다 5px, 물 프레임마다 4px 밀린다. at은 월드 좌표(가로 줄은 x, 세로 줄은 y) */
const foamOn = (at: number, k: number): boolean => (((at - k * 4) % 8) + 8) % 8 < 5

function foamRow(ctx: CanvasRenderingContext2D, x: number, y: number, k: number): void {
  for (let i = 0; i < TILE; i++) if (foamOn(x + i, k)) rect(ctx, x + i, y, 1, 1, C.foam)
}

function foamCol(ctx: CanvasRenderingContext2D, x: number, y: number, k: number): void {
  for (let i = 0; i < TILE; i++) if (foamOn(y + i, k)) rect(ctx, x, y + i, 1, 1, C.foam)
}

/** 물 칸 가장자리에 모래가 닿으면 젖은 모래 띠와 파도 거품 */
function drawShoreEdges(ctx: CanvasRenderingContext2D, g: MapGfx, tx: number, ty: number, k: number): void {
  const x = tx * TILE
  const y = ty * TILE
  const sand = (dx: number, dy: number) => groundAt(g, tx + dx, ty + dy) === 'sand'
  const up = sand(0, -1)
  const down = sand(0, 1)
  const left = sand(-1, 0)
  const right = sand(1, 0)
  if (up) {
    rect(ctx, x, y, TILE, 2, C.sandWet)
    foamRow(ctx, x, y + 2, k)
  }
  if (down) {
    rect(ctx, x, y + TILE - 2, TILE, 2, C.sandWet)
    foamRow(ctx, x, y + TILE - 3, k)
  }
  if (left) {
    rect(ctx, x, y, 2, TILE, C.sandWet)
    foamCol(ctx, x + 2, y, k)
  }
  if (right) {
    rect(ctx, x + TILE - 2, y, 2, TILE, C.sandWet)
    foamCol(ctx, x + TILE - 3, y, k)
  }
  // 대각선으로만 모래가 닿는 안쪽 모서리
  const corners: [number, number, boolean, number, number][] = [
    [-1, -1, !up && !left, 0, 0],
    [1, -1, !up && !right, TILE - 2, 0],
    [-1, 1, !down && !left, 0, TILE - 2],
    [1, 1, !down && !right, TILE - 2, TILE - 2],
  ]
  for (const [dx, dy, open, cx, cy] of corners) {
    if (!open || !sand(dx, dy)) continue
    rect(ctx, x + cx, y + cy, 2, 2, C.sandWet)
    rect(ctx, x + (cx === 0 ? 2 : cx - 1), y + (cy === 0 ? 2 : cy - 1), 1, 1, C.foam)
  }
}

/** 모래 칸 가장자리에 풀이 닿으면 들쭉날쭉한 풀 가장자리(1~3px)를 모래 쪽으로 늘어뜨린다 */
function drawGrassFringe(ctx: CanvasRenderingContext2D, g: MapGfx, tx: number, ty: number): void {
  const x = tx * TILE
  const y = ty * TILE
  const grass = (dx: number, dy: number) => groundAt(g, tx + dx, ty + dy) === 'grass'
  for (let i = 0; i < TILE; i++) {
    if (grass(0, -1)) {
      const d = 1 + (hash(x + i, y) % 3)
      rect(ctx, x + i, y, 1, d, C.grass)
      if (d > 1) rect(ctx, x + i, y + d - 1, 1, 1, C.grassDark)
    }
    if (grass(0, 1)) {
      const d = 1 + (hash(x + i, y + TILE) % 3)
      rect(ctx, x + i, y + TILE - d, 1, d, C.grass)
      if (d > 1) rect(ctx, x + i, y + TILE - d, 1, 1, C.grassDark)
    }
    if (grass(-1, 0)) {
      const d = 1 + (hash(x, y + i) % 3)
      rect(ctx, x, y + i, d, 1, C.grass)
      if (d > 1) rect(ctx, x + d - 1, y + i, 1, 1, C.grassDark)
    }
    if (grass(1, 0)) {
      const d = 1 + (hash(x + TILE, y + i) % 3)
      rect(ctx, x + TILE - d, y + i, d, 1, C.grass)
      if (d > 1) rect(ctx, x + TILE - d, y + i, 1, 1, C.grassDark)
    }
  }
}

/** 울타리: 위·아래로만 이어지면 세로 난간, 아니면 가로 난간(옆에 울타리가 없는 쪽 난간은 기둥에서 끊는다) */
function drawFence(ctx: CanvasRenderingContext2D, g: MapGfx, tx: number, ty: number): void {
  const fence = (dx: number, dy: number) => tileAt(g.map, tx + dx, ty + dy) === 'fence'
  const x = tx * TILE
  const y = ty * TILE
  const left = fence(-1, 0)
  const right = fence(1, 0)
  if (!left && !right && (fence(0, -1) || fence(0, 1))) {
    drawSprite(ctx, 'tile-fence-v', x, y, 1)
    return
  }
  if (left && right) {
    drawSprite(ctx, 'tile-fence', x, y, 1)
    return
  }
  drawSpritePart(ctx, 'tile-fence', x, y, {
    col0: left ? 0 : FENCE_POST_COL0,
    col1: right ? TILE : FENCE_POST_COL1,
    row0: 0,
    row1: TILE,
  })
}

/** 물 칸 그림 이름 앞부분(다리 밑은 강물). 없으면 바다(부두·선착장 밑 포함) */
const WATER_SPRITE: Readonly<Partial<Record<TileKind, string>>> = {
  river: 'river', pond: 'pond', basin: 'basin', bridge: 'river',
  lake: 'lake', 'cave-pool': 'cave-pool', crystal: 'crystal', lava: 'lava', lagoon: 'lagoon',
  creek: 'creek', marsh: 'marsh', bog: 'bog', boardwalk: 'marsh',
  hotspring: 'hotspring', deep: 'deep',
}

/** 물 칸 그림 이름 앞부분. 바위는 이웃(상하좌우) 물 칸 그림 중 가장 많은 것(같으면 위·아래·왼쪽·오른쪽 순서로 먼저 센 것) */
function waterSpriteAt(map: MapDef, tx: number, ty: number): string {
  const kind = tileAt(map, tx, ty)
  if (kind === null || !ON_NEIGHBOUR_GROUND.has(kind)) return (kind && WATER_SPRITE[kind]) ?? 'water'
  const count = new Map<string, number>()
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const k = tileAt(map, tx + dx, ty + dy)
    // 진흙 이웃은 밀물 흙탕물(이 칸이 물 위에 놓이는 것은 밀물일 때뿐이다 — 썰물이면 진흙이 모래 땅이라 여기 오지 않는다)
    if (k === 'mud') {
      count.set('tile-mud-wet', (count.get('tile-mud-wet') ?? 0) + 1)
      continue
    }
    if (k === null || !WATER_GROUND.has(k) || k === 'falls') continue
    const name = WATER_SPRITE[k] ?? 'water'
    count.set(name, (count.get(name) ?? 0) + 1)
  }
  let best = 'water'
  let most = 0
  for (const [name, n] of count) {
    if (n > most) {
      best = name
      most = n
    }
  }
  return best
}

// ── 부드러운 물가(픽셀) ─────────────────────────────────────────

const ORTHO_FIRST: readonly [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]

/** 스프라이트 (i, j) 픽셀 색. 투명이면 null */
function spriteColor(name: string, i: number, j: number): string | null {
  const s = SPRITES[name]
  if (!s) return null
  const ch = s.rows[j]?.[i]
  return ch === undefined || ch === '.' || ch === ' ' ? null : (s.palette[ch] ?? null)
}

/** 둘레(3×3, 없으면 5×5)에서 cls가 want인 가장 가까운 칸 */
function nearestOfClass(g: MapGfx, tx: number, ty: number, want: 'water' | 'land'): { tx: number; ty: number } | null {
  for (const [dx, dy] of ORTHO_FIRST) if (shoreClassAt(g.field, tx + dx, ty + dy) === want) return { tx: tx + dx, ty: ty + dy }
  for (let r = 2; r <= 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (shoreClassAt(g.field, tx + dx, ty + dy) === want) return { tx: tx + dx, ty: ty + dy }
  }
  return null
}

/** 땅 칸의 기본 그림 이름(물가 픽셀에서 '원래 땅'으로 쓴다) */
function landSprite(g: MapGfx, tx: number, ty: number, ground: Ground): string {
  const kind = tileAt(g.map, tx, ty)
  if (kind === 'path') return 'tile-path'
  if (kind === 'flower') return 'tile-flower'
  if (ground === 'snow') return hash(tx, ty) % 6 === 0 ? 'tile-snow-drift' : 'tile-snow'
  if (ground === 'cave') return 'tile-cave-floor'
  if (ground === 'sand') return 'tile-sand'
  return hash(tx, ty) % 4 === 0 ? 'tile-grass-alt' : 'tile-grass'
}

/**
 * 물가 칸 픽셀 덧그리기. 칸의 기본 그림(물 칸은 물, 땅 칸은 땅)은 이미 그려져 있고, 기본과 다른 띠의 픽셀만 칠한다.
 * v ≥ WET_BAND 물, SHORE_LINE~FOAM_BAND 젖은 모래(눈은 눈 턱, 늪은 사초), FOAM_BAND~WET_BAND 거품 점선, SAND_BAND~SHORE_LINE 모래 띠(눈·동굴은 제 땅), 그 아래 원래 땅.
 * 늪·수렁 물가는 모래 띠 없이 풀, 젖은 띠는 사초 색(늪지에 모래사장이 생기지 않게).
 * 같은 색이 이어지는 가로 구간은 사각형 하나로.
 */
function drawShorePixels(ctx: CanvasRenderingContext2D, g: MapGfx, tx: number, ty: number, k: number, bands: Float32Array): void {
  const isWater = shoreClassAt(g.field, tx, ty) === 'water'
  const frame = (k + tx + ty * 3) % 2
  const wt = isWater ? { tx, ty } : nearestOfClass(g, tx, ty, 'water')
  const waterName = `${wt ? waterSpriteAt(g.map, wt.tx, wt.ty) : 'water'}-${frame}`
  const lt = isWater ? nearestOfClass(g, tx, ty, 'land') : { tx, ty }
  const lg = (lt && groundAt(g, lt.tx, lt.ty)) || 'sand'
  const land: Ground = lg === 'water' ? 'sand' : lg
  const native = lt ? landSprite(g, lt.tx, lt.ty, land) : 'tile-sand'
  // 늪·수렁 물가: 모래 띠 없이 풀, 젖은 띠는 물가 풀(사초) 색
  const sedgy = waterName.startsWith('marsh') || waterName.startsWith('bog')
  const x0 = tx * TILE
  const y0 = ty * TILE
  for (let j = 0; j < TILE; j++) {
    let runColor: string | null = null
    let runStart = 0
    const flush = (end: number) => {
      if (runColor) rect(ctx, x0 + runStart, y0 + j, end - runStart, 1, runColor)
      runColor = null
    }
    for (let i = 0; i < TILE; i++) {
      const v = bands[j * TILE + i]
      let color: string | null
      if (isWater ? v >= WET_BAND : v < SAND_BAND) color = null // 이미 그린 기본 그림
      else if (v >= WET_BAND) color = spriteColor(waterName, i, j)
      else if (v >= SHORE_LINE) {
        if (land === 'cave') color = spriteColor(waterName, i, j)
        else if (sedgy) color = v < FOAM_BAND ? C.sedge : C.sedgeDark
        else if (land === 'snow') color = v < FOAM_BAND ? C.snowLip : C.snowShade
        else if (v < FOAM_BAND) color = C.sandWet
        else color = foamOn(x0 + i + y0 + j, k) ? C.foam : spriteColor(waterName, i, j)
      } else if (v >= SAND_BAND) color = sedgy && !isWater ? null : spriteColor((land === 'sand' || land === 'grass') && !sedgy ? 'tile-sand' : native, i, j)
      else color = spriteColor(native, i, j)
      if (color === null) {
        flush(i)
        continue
      }
      if (color !== runColor) {
        flush(i)
        runColor = color
        runStart = i
      }
    }
    flush(TILE)
  }
}

/** 칸 하나: 땅 → 물가 거품·풀 가장자리 → 위에 얹는 것(나무·야자수 밑동·바위·울타리·부두·선착장 판자). 모두 자기 칸 안에 그린다. */
function drawTile(ctx: CanvasRenderingContext2D, g: MapGfx, tx: number, ty: number, k: number): void {
  const kind = tileAt(g.map, tx, ty)
  if (kind === null) return
  const x = tx * TILE
  const y = ty * TILE
  const ground = groundAt(g, tx, ty)

  if (kind === 'mud') {
    // 밀물이면 얕은 흙탕물(두 장, 물결 박자 그대로)과 물가 거품, 썰물이면 진흙
    if (g.tide === 'high') {
      drawSprite(ctx, `tile-mud-wet-${(k + tx + ty * 3) % 2}`, x, y, 1)
      drawShoreEdges(ctx, g, tx, ty, k)
    } else drawSprite(ctx, 'tile-mud', x, y, 1)
    return
  }
  if (kind === 'ice') {
    drawSprite(ctx, 'tile-ice', x, y, 1)
    drawIceRim(ctx, g, tx, ty)
    return
  }
  // 집 안(배경 그림이 없는 실내): 나무 바닥·벽
  if ((kind === 'floor' || kind === 'wall') && !g.map.backdrop) {
    drawSprite(ctx, kind === 'floor' ? 'home-floor' : 'home-wall', x, y, 1)
    if (kind === 'wall') {
      const prop = g.map.props.find((p) => p.tx === tx && p.ty === ty)
      if (prop) {
        drawSprite(ctx, 'home-floor', x, y, 1)
        drawSprite(ctx, prop.sprite, x, y, 1)
      }
    }
    return
  }
  if (kind === 'path') drawSprite(ctx, 'tile-path', x, y, 1)
  else if (kind === 'flower') drawSprite(ctx, 'tile-flower', x, y, 1)
  else if (kind === 'cliff') drawSprite(ctx, 'tile-cliff', x, y, 1)
  else if (kind === 'cave-wall') drawSprite(ctx, 'tile-cave-wall', x, y, 1)
  else if (kind === 'cave-mouth') drawSprite(ctx, 'tile-cave-mouth', x, y, 1)
  else if (kind === 'falls') drawSprite(ctx, `falls-${(k + tx) % 2}`, x, y, 1)
  else if (ground === 'water') {
    // 칸마다 위상을 어긋나게 해서 물결이 한꺼번에 깜빡이지 않게. 다리 밑은 강물, 바위 밑은 둘레의 물
    // 늪 칸 몇 곳(칸마다 고정)은 연잎이 뜬 그림
    const name = kind === 'marsh' && hash(tx, ty) % 9 === 0 ? 'marsh-lily' : waterSpriteAt(g.map, tx, ty)
    drawSprite(ctx, `${name}-${(k + tx + ty * 3) % 2}`, x, y, 1)
    const bands = shoreBands(g.field, tx, ty)
    if (bands) drawShorePixels(ctx, g, tx, ty, k, bands)
    else {
      drawShoreEdges(ctx, g, tx, ty, k)
      drawSnowEdges(ctx, g, tx, ty)
      if (kind === 'bog') drawBogRim(ctx, g, tx, ty)
      if (kind === 'marsh') drawSedgeFringe(ctx, g, tx, ty)
    }
  } else if (ground === 'snow') {
    // 칸 몇 곳(칸마다 고정)은 바람에 쌓인 눈더미 결
    drawSprite(ctx, hash(tx, ty) % 6 === 0 ? 'tile-snow-drift' : 'tile-snow', x, y, 1)
  } else if (ground === 'cave') {
    drawSprite(ctx, 'tile-cave-floor', x, y, 1)
  } else if (ground === 'sand') {
    drawSprite(ctx, 'tile-sand', x, y, 1)
    drawGrassFringe(ctx, g, tx, ty)
  } else {
    drawSprite(ctx, hash(tx, ty) % 4 === 0 ? 'tile-grass-alt' : 'tile-grass', x, y, 1)
  }
  // 물가 땅 칸: 그린 땅 위에 물·젖은 띠·모래 띠 픽셀을 덧그린다(걷기 판정과 같은 물 정도 값)
  if (ground !== 'water') {
    const bands = shoreBands(g.field, tx, ty)
    if (bands) drawShorePixels(ctx, g, tx, ty, k, bands)
  }

  const tall = TALL_SPRITE[kind]
  // 돛대는 갑판 위에 선다
  if (kind === 'mast') drawSprite(ctx, 'deck-plank', x, y, 1)
  if (tall) {
    drawSpritePart(ctx, tall, x, y - TILE, TREE_BOTTOM)
    // 내 섬 자원 나무: 열매 표시(개간 구역 나무와 구별)
    if (kind === 'tree' && g.map.nodes.some((n) => n.kind === 'tree' && n.tx === tx && n.ty === ty)) drawSprite(ctx, 'node-tree', x, y, 1)
  } else if (kind === 'rock') {
    if (ground === 'water') drawSprite(ctx, 'rock', x + 1, y + 4, 1)
    else drawSprite(ctx, ground === 'snow' ? 'tile-rock-snow' : 'tile-rock', x, y, 1)
    // 내 섬 철광: 바위 위에 철 무늬
    const node = g.map.nodes.find((n) => n.tx === tx && n.ty === ty)
    if (node?.kind === 'iron') drawSprite(ctx, 'iron-ore', x, y, 1)
    // 내 섬 자원 바위: 반짝이 표시
    if (node) drawSprite(ctx, 'node-rock', x, y, 1)
  } else if (kind === 'bench') drawSprite(ctx, 'workbench', x, y, 1)
  else if (kind === 'deco') {
    const prop = g.map.props.find((p) => p.tx === tx && p.ty === ty)
    if (prop) drawSprite(ctx, prop.sprite, x, y, 1)
  }
  else if (kind === 'fence') drawFence(ctx, g, tx, ty)
  else if (kind === 'pier') drawSprite(ctx, 'pier-plank', x, y, 1)
  else if (kind === 'bridge') drawSprite(ctx, 'bridge-plank', x, y, 1)
  else if (kind === 'dock') drawSprite(ctx, 'dock-plank', x, y, 1)
  else if (kind === 'boardwalk') drawSprite(ctx, boardwalkVertical(g.map, tx, ty) ? 'boardwalk-plank-v' : 'boardwalk-plank', x, y, 1)
  else if (kind === 'deck') drawSprite(ctx, 'deck-plank', x, y, 1)
  else if (kind === 'hull') drawSprite(ctx, hullSide(g.map, tx, ty) ? 'tile-hull-v' : 'tile-hull', x, y, 1)
}

/** 얼음판 가장자리(얼음이 아닌 쪽 변)에 짙은 테 1px와 그 안쪽 빛 1px: 눈밭과 얼음판의 경계가 보이게 */
function drawIceRim(ctx: CanvasRenderingContext2D, g: MapGfx, tx: number, ty: number): void {
  const x = tx * TILE
  const y = ty * TILE
  const edge = (dx: number, dy: number) => tileAt(g.map, tx + dx, ty + dy) !== 'ice'
  if (edge(0, -1)) {
    rect(ctx, x, y, TILE, 1, C.iceRim)
    rect(ctx, x, y + 1, TILE, 1, C.iceShine)
  }
  if (edge(0, 1)) rect(ctx, x, y + TILE - 1, TILE, 1, C.iceRim)
  if (edge(-1, 0)) rect(ctx, x, y, 1, TILE, C.iceRim)
  if (edge(1, 0)) rect(ctx, x + TILE - 1, y, 1, TILE, C.iceRim)
}

/** 물 칸 가장자리에 눈이 닿으면 눈 턱과 그늘. 온천 둘레가 눈에 파묻혀 보이게 */
function drawSnowEdges(ctx: CanvasRenderingContext2D, g: MapGfx, tx: number, ty: number): void {
  const x = tx * TILE
  const y = ty * TILE
  const snow = (dx: number, dy: number) => groundAt(g, tx + dx, ty + dy) === 'snow'
  // 위쪽은 물 위로 내민 눈 턱과 그늘, 나머지 변은 눈 1px + 돌 테 1px
  if (snow(0, -1)) {
    rect(ctx, x, y, TILE, 2, C.snowLip)
    rect(ctx, x, y + 2, TILE, 1, C.snowShade)
  }
  if (snow(0, 1)) {
    rect(ctx, x, y + TILE - 2, TILE, 1, C.snowShade)
    rect(ctx, x, y + TILE - 1, TILE, 1, C.snowLip)
  }
  if (snow(-1, 0)) {
    rect(ctx, x, y, 1, TILE, C.snowLip)
    rect(ctx, x + 1, y, 1, TILE, C.snowShade)
  }
  if (snow(1, 0)) {
    rect(ctx, x + TILE - 1, y, 1, TILE, C.snowLip)
    rect(ctx, x + TILE - 2, y, 1, TILE, C.snowShade)
  }
}

/**
 * 늪물 칸 가장자리에 풀이 닿으면 물가 풀(사초) 띠: 칸마다 고정된 들쭉날쭉 2~4px, 풀색에서 늪색으로 한 단계 어둡게.
 * 늪지 풀밭 섬이 늪 위에 네모로 떠 보이지 않게 물가를 부드럽게 잇는다.
 */
function drawSedgeFringe(ctx: CanvasRenderingContext2D, g: MapGfx, tx: number, ty: number): void {
  const x = tx * TILE
  const y = ty * TILE
  const grass = (dx: number, dy: number) => groundAt(g, tx + dx, ty + dy) === 'grass'
  const up = grass(0, -1)
  const down = grass(0, 1)
  const left = grass(-1, 0)
  const right = grass(1, 0)
  for (let i = 0; i < TILE; i++) {
    const d = (a: number, b: number) => 2 + (hash(a, b) % 3)
    if (up) {
      const n = d(x + i, y)
      rect(ctx, x + i, y, 1, n - 1, C.sedge)
      rect(ctx, x + i, y + n - 1, 1, 1, C.sedgeDark)
    }
    if (down) {
      const n = d(x + i, y + TILE)
      rect(ctx, x + i, y + TILE - n + 1, 1, n - 1, C.sedge)
      rect(ctx, x + i, y + TILE - n, 1, 1, C.sedgeDark)
    }
    if (left) {
      const n = d(x, y + i)
      rect(ctx, x, y + i, n - 1, 1, C.sedge)
      rect(ctx, x + n - 1, y + i, 1, 1, C.sedgeDark)
    }
    if (right) {
      const n = d(x + TILE, y + i)
      rect(ctx, x + TILE - n + 1, y + i, n - 1, 1, C.sedge)
      rect(ctx, x + TILE - n, y + i, 1, 1, C.sedgeDark)
    }
  }
  // 대각선으로만 풀이 닿는 모서리: 작은 풀 덩이
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    if (!grass(dx, dy) || grass(dx, 0) || grass(0, dy)) continue
    rect(ctx, dx < 0 ? x : x + TILE - 3, dy < 0 ? y : y + TILE - 3, 3, 3, C.sedge)
  }
}

/** 선체 옆판: 왼쪽이나 오른쪽이 갑판이면 세로 판자(배 옆면), 아니면(뱃머리·선미, 위·아래가 갑판) 가로 그림 */
function hullSide(map: MapDef, tx: number, ty: number): boolean {
  const deck = (dx: number) => {
    const k = tileAt(map, tx + dx, ty)
    return k === 'deck' || k === 'mast'
  }
  return deck(-1) || deck(1)
}

/** 위아래로만 데크가 이어지는 칸(세로 데크 그림). 갈림길·가로 데크·외톨이는 가로 그림 */
function boardwalkVertical(map: MapDef, tx: number, ty: number): boolean {
  const bw = (dx: number, dy: number) => tileAt(map, tx + dx, ty + dy) === 'boardwalk'
  return (bw(0, -1) || bw(0, 1)) && !bw(-1, 0) && !bw(1, 0)
}

/**
 * 수렁 가장자리: 수렁이 아닌 쪽 변에 늪물 띠(칸마다 고정된 들쭉날쭉 1~3px)와 진흙 테두리, 두 변이 열린 모서리는 둥글게 깎는다.
 * 네모난 웅덩이가 아니라 늪에 고인 검은 물처럼 보이게. 정적 레이어라 매 프레임 비용 없음.
 */
function drawBogRim(ctx: CanvasRenderingContext2D, g: MapGfx, tx: number, ty: number): void {
  const x = tx * TILE
  const y = ty * TILE
  const open = (dx: number, dy: number) => tileAt(g.map, tx + dx, ty + dy) !== 'bog'
  const up = open(0, -1)
  const down = open(0, 1)
  const left = open(-1, 0)
  const right = open(1, 0)
  for (let i = 0; i < TILE; i++) {
    const d = (a: number, b: number) => 1 + (hash(a, b) % 3)
    if (up) {
      const n = d(x + i, y)
      rect(ctx, x + i, y, 1, n, C.bogRim)
      rect(ctx, x + i, y + n, 1, 1, C.bogEdge)
    }
    if (down) {
      const n = d(x + i, y + TILE)
      rect(ctx, x + i, y + TILE - n, 1, n, C.bogRim)
      rect(ctx, x + i, y + TILE - n - 1, 1, 1, C.bogEdge)
    }
    if (left) {
      const n = d(x, y + i)
      rect(ctx, x, y + i, n, 1, C.bogRim)
      rect(ctx, x + n, y + i, 1, 1, C.bogEdge)
    }
    if (right) {
      const n = d(x + TILE, y + i)
      rect(ctx, x + TILE - n, y + i, n, 1, C.bogRim)
      rect(ctx, x + TILE - n - 1, y + i, 1, 1, C.bogEdge)
    }
  }
  // 둥근 모서리: 두 변이 열린 모서리를 계단 모양(반지름 약 7px)으로 늪물로 채운다
  const steps = [7, 5, 4, 3, 2, 1, 1]
  const corner = (cx: number, cy: number, sx: number, sy: number) => {
    steps.forEach((w, r) => {
      const yy = cy + sy * r - (sy < 0 ? 1 : 0)
      rect(ctx, sx > 0 ? cx : cx - w, yy, w, 1, C.bogRim)
    })
  }
  if (up && left) corner(x, y, 1, 1)
  if (up && right) corner(x + TILE, y, -1, 1)
  if (down && left) corner(x, y + TILE, 1, -1)
  if (down && right) corner(x + TILE, y + TILE, -1, -1)
  // 안쪽 모서리(두 변은 수렁인데 대각선만 늪): 진흙 점 두 개로 꺾인 물가를 잇는다
  const diag = (dx: number, dy: number) => !open(dx, 0) && !open(0, dy) && open(dx, dy)
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    if (!diag(dx, dy)) continue
    const cx = dx < 0 ? x : x + TILE - 2
    const cy = dy < 0 ? y : y + TILE - 2
    rect(ctx, cx, cy, 2, 2, C.bogRim)
    rect(ctx, dx < 0 ? cx + 2 : cx - 1, cy, 1, 2, C.bogEdge)
  }
}

/** 부두 칸 바깥으로 삐져나오는 것: 그늘, 기둥, 끝 옆면, 외곽선 */
function drawPierExtras(ctx: CanvasRenderingContext2D, g: MapGfx, tx: number, ty: number): void {
  const x = tx * TILE
  const y = ty * TILE
  const above = tileAt(g.map, tx, ty - 1) === 'pier'
  const end = tileAt(g.map, tx, ty + 1) !== 'pier'
  let fromEnd = 0
  while (tileAt(g.map, tx, ty + fromEnd + 1) === 'pier') fromEnd++
  const face = end ? 4 : 0
  // 물 위로 드리우는 그늘(오른쪽·아래)
  rect(ctx, x + TILE, y, 3, TILE + face, C.pierShadow)
  if (end) rect(ctx, x + 2, y + TILE + face, TILE + 1, 3, C.pierShadow)
  // 기둥은 끝에서부터 두 칸마다, 모래에 닿는 첫 칸은 빼고
  if (above && fromEnd % 2 === 0) {
    drawSprite(ctx, 'pier-post', x - 8, y + 4, 1)
    drawSprite(ctx, 'pier-post', x + TILE, y + 4, 1)
  }
  if (end) {
    rect(ctx, x, y + TILE, TILE, face, C.pierFace)
    rect(ctx, x, y + TILE + face - 1, TILE, 1, C.pierFaceDark)
  }
  rect(ctx, x - 1, y, 1, TILE + face, C.outline)
  rect(ctx, x + TILE, y, 1, TILE + face, C.outline)
}

/** 움직이지 않는 맵(물 k번 장)을 타일 범위 [tx0..tx1]×[ty0..ty1]만큼 월드 좌표로 그린다. */
function drawStatic(ctx: CanvasRenderingContext2D, g: MapGfx, k: number, tx0: number, ty0: number, tx1: number, ty1: number): void {
  const { map } = g
  // 실내 배경 맵(마을회관): 칸 그림 대신 큰 그림 한 장
  if (map.backdrop) {
    drawSprite(ctx, map.backdrop, 0, 0, 1)
    return
  }
  const x0 = Math.max(0, tx0)
  const y0 = Math.max(0, ty0)
  const x1 = Math.min(map.w - 1, tx1)
  const y1 = Math.min(map.h - 1, ty1)
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) drawTile(ctx, g, tx, ty, k)
  // 부두 꾸밈은 옆·아래 칸으로 삐져나오므로 한 칸 넓게 본다
  for (let ty = Math.max(0, y0 - 1); ty <= Math.min(map.h - 1, y1 + 1); ty++) {
    for (let tx = Math.max(0, x0 - 1); tx <= Math.min(map.w - 1, x1 + 1); tx++) {
      if (tileAt(map, tx, ty) === 'pier') drawPierExtras(ctx, g, tx, ty)
    }
  }
  // 건물 외관(마을회관·텐트): 건물 사각형 왼쪽 아래에 맞춰(위로는 사각형을 넘을 수 있다)
  const b = map.building
  const art = SPRITES[map.buildingSprite]
  if (b && art) {
    const right = b.tx + b.w - 1
    const bottom = b.ty + b.h - 1
    if (b.tx <= x1 && right >= x0 && b.ty <= y1 && bottom >= y0) {
      drawSprite(ctx, map.buildingSprite, b.tx * TILE, (b.ty + b.h) * TILE - art.h, 1)
    }
  }
}

/**
 * 맵 캐시: 한 번에 맵 하나만 가진다(map.id가 바뀌면 이전 것을 버린다).
 * gfx는 계산해 둔 땅, frames는 물 타일 두 장 각각에 맞춘 맵 전체를 오프스크린 캔버스에 한 번 그려 둔 것이다.
 * 맵을 바꾼 프레임에는 0번 장만 만들고 1번 장은 다음 프레임에 만든다(한 프레임에 큰 맵 둘을 그리면 멈칫한다).
 * 1번 장이 생길 때까지는 0번 장을 두 물 모양에 모두 쓴다.
 * 오프스크린 2D 컨텍스트를 못 얻으면(jsdom 등) frames 없이 매 프레임 보이는 타일만 직접 그린다.
 */
type Cache = { gfx: MapGfx; frames: HTMLCanvasElement[] | null }
let cache: Cache | null = null

function renderFrame(g: MapGfx, k: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = g.map.w * TILE
  c.height = g.map.h * TILE
  const cx = c.getContext('2d')
  if (!cx) {
    c.width = c.height = 0
    return null
  }
  cx.imageSmoothingEnabled = false
  drawStatic(cx, g, k, 0, 0, g.map.w - 1, g.map.h - 1)
  return c
}

/** 버리는 캔버스의 픽셀 메모리를 바로 돌려준다(iOS는 가비지 컬렉션을 기다려 주지 않는다) */
function disposeCache(c: Cache | null): void {
  for (const f of c?.frames ?? []) f.width = f.height = 0
}

/** 맵 캐시를 놓아 준다(게임 화면을 떠날 때). 다음 그리기에서 다시 만든다. */
export function releaseSceneCache(): void {
  disposeCache(cache)
  cache = null
  if (fogCache) fogCache.canvas.width = fogCache.canvas.height = 0
  fogCache = null
}

/**
 * 물때 맵은 물때마다 따로 만든다(바뀔 때 한 번 — 실제 4~8분에 한 번, 동시에 하나만 가진다).
 * 물때 없는 맵은 늘 'high'로 본다(진흙이 없으니 그림은 같다).
 */
function mapCache(map: MapDef, tide: Tide = 'high'): Cache {
  const t: Tide = map.tidal ? tide : 'high'
  if (!cache || cache.gfx.map.id !== map.id || cache.gfx.map !== map || cache.gfx.tide !== t) {
    disposeCache(cache)
    const gfx: MapGfx = { map, ground: computeGround(map, t), tide: t, field: shoreField(map, t) }
    const first = renderFrame(gfx, 0)
    cache = { gfx, frames: first ? [first] : null }
  } else if (cache.frames && cache.frames.length < 2) {
    const second = renderFrame(cache.gfx, 1)
    if (second) cache.frames.push(second)
    else {
      disposeCache(cache)
      cache.frames = null
    }
  }
  return cache
}

// ── 캐릭터 ──────────────────────────────────────────────────────

/** 미니게임 HUD를 둘 쪽: 캐릭터가 화면 왼쪽 절반이면 오른쪽 */
export function hudSide(playerScreenX: number, w: number): 'left' | 'right' {
  return playerScreenX < w / 2 ? 'right' : 'left'
}

/**
 * HUD 자리(화면 좌표). track은 싸움 트랙 + 진행 게이지의 바깥 상자(외곽선 포함)로 hudSide 쪽 가장자리,
 * clock은 시계 판으로 트랙 반대쪽 위, hudTop 아래. 둘은 좌우로 갈라 놓아 겹치지 않는다.
 */
export function hudLayout(playerScreenX: number, w: number, h: number, hudTop: number): { track: Box; clock: Box } {
  const side = hudSide(playerScreenX, w)
  const trackH = Math.min(TRACK_MAX_H, h - 2 * HUD_MARGIN)
  const tx = side === 'right' ? w - HUD_MARGIN - HUD_W : HUD_MARGIN
  const ty = Math.round((h - trackH) / 2)
  const cx = side === 'right' ? CLOCK_MARGIN : w - CLOCK_MARGIN - CLOCK_W
  const cy = Math.min(h - CLOCK_H, Math.max(0, Math.round(hudTop)) + CLOCK_MARGIN)
  return {
    track: { x: tx - 1, y: ty - 1, w: HUD_W + 2, h: trackH + 2 },
    clock: { x: cx, y: cy, w: CLOCK_W, h: CLOCK_H },
  }
}

type Pose = { name: string; flipX: boolean }

function poseFor(phase: Phase, p: Player): Pose {
  const dir = p.facing === 'left' || p.facing === 'right' ? 'side' : p.facing
  const flipX = p.facing === 'left'
  const suffix = dir === 'down' ? '' : `-${dir}`
  if (phase === 'charging' || phase === 'waiting' || phase === 'bite') return { name: `player-cast${suffix}`, flipX }
  if (phase === 'fighting') return { name: `player-reel${suffix}`, flipX }
  if (p.moving) return { name: `player-walk-${dir}-${Math.floor(p.walkMs / WALK_FRAME_MS) % 2}`, flipX }
  return { name: `player-idle-${dir}`, flipX }
}

function rodTip(pose: Pose, x: number, y: number): [number, number] | null {
  const tip = ROD_TIP[pose.name]
  if (!tip) return null
  return [x + (pose.flipX ? PLAYER_W - 1 - tip[0] : tip[0]), y + tip[1]]
}

// ── HUD ─────────────────────────────────────────────────────────

function drawGauge(ctx: CanvasRenderingContext2D, gauge: number, cx: number, top: number, w: number, h: number): void {
  const x = Math.min(w - GAUGE_W - 2, Math.max(2, Math.round(cx - GAUGE_W / 2)))
  const y = Math.min(h - 8, Math.max(2, top - 10))
  rect(ctx, x - 1, y - 1, GAUGE_W + 2, 7, C.outline)
  rect(ctx, x, y, GAUGE_W, 5, C.gaugeBg)
  const g = Math.min(1, Math.max(0, gauge))
  const fill = Math.round(g * GAUGE_W)
  const color = g < 0.5 ? C.gaugeLow : g < 0.85 ? C.gaugeMid : C.gaugeHigh
  if (fill > 0) {
    rect(ctx, x, y, fill, 5, color)
    rect(ctx, x, y, fill, 1, C.gaugeShine)
  }
  // 눈금 4칸
  for (let i = 1; i < 4; i++) rect(ctx, x + Math.round((GAUGE_W * i) / 4), y + 3, 1, 2, C.outline)
}

/** box: hudLayout의 track(외곽선 포함 바깥 상자) */
function drawTrack(ctx: CanvasRenderingContext2D, bar: Bar, params: BarParams, tMs: number, box: Box): void {
  const tx = box.x + 1
  const ty = box.y + 1
  const trackH = box.h - 2
  const inner = { x: tx + 3, y: ty + 3, w: TRACK_W - 6, h: trackH - 6 }
  const meterX = tx + TRACK_W + METER_GAP

  // 틀. 신화 용솟음 동안은 테두리가 깜박인다
  const surging = params.behavior === 'surge' && surgePhase(bar.t) === 'surge'
  rect(ctx, tx - 1, ty - 1, TRACK_W + 2, trackH + 2, surging && Math.floor(tMs / 120) % 2 === 0 ? C.surgeEdge : C.outline)
  rect(ctx, tx, ty, TRACK_W, trackH, C.trackWood)
  rect(ctx, tx, ty, TRACK_W, 1, C.trackWoodLight)
  rect(ctx, tx, ty, 1, trackH, C.trackWoodLight)
  rect(ctx, inner.x - 1, inner.y - 1, inner.w + 2, inner.h + 2, C.outline)
  rect(ctx, inner.x, inner.y, inner.w, inner.h, C.trackInner)
  for (let y = inner.y + 6; y < inner.y + inner.h; y += 12) rect(ctx, inner.x + 2, y, inner.w - 4, 1, C.trackInnerLine)

  // 바: 위치 0 = 트랙 아래
  const barH = Math.max(4, Math.round(effectiveBarSize(params, bar.t) * inner.h))
  const barTop = Math.round(inner.y + (1 - bar.barPos) * inner.h - barH / 2)
  const top = Math.max(inner.y, Math.min(inner.y + inner.h - barH, barTop))
  rect(ctx, inner.x, top, inner.w, barH, C.bar)
  rect(ctx, inner.x, top, inner.w, 1, C.barLight)
  rect(ctx, inner.x, top + barH - 1, inner.w, 1, C.barDark)

  // 물고기 아이콘은 바 위에 그려 겹쳐도 보이게. 살짝 좌우로 꿈틀댄다
  const fish = SPRITES['track-fish']
  const wiggle = Math.floor(tMs / 150) % 2
  const fy = Math.round(inner.y + (1 - bar.fishPos) * inner.h - fish.h / 2)
  const fyc = Math.max(inner.y - 1, Math.min(inner.y + inner.h - fish.h + 1, fy))
  drawSprite(ctx, 'track-fish', inner.x + Math.floor((inner.w - fish.w) / 2) + wiggle, fyc, 1)

  // 진행 게이지(트랙 옆, 아래에서 차오름)
  rect(ctx, meterX - 1, ty - 1, METER_W + 2, trackH + 2, C.outline)
  rect(ctx, meterX, ty, METER_W, trackH, C.gaugeBg)
  const p = Math.min(1, Math.max(0, bar.progress))
  const ph = Math.round(p * trackH)
  const pc = p < 0.3 ? C.progLow : p < 0.65 ? C.progMid : C.progHigh
  if (ph > 0) {
    rect(ctx, meterX, ty + trackH - ph, METER_W, ph, pc)
    rect(ctx, meterX, ty + trackH - ph, 1, ph, C.gaugeShine)
  }
}

/**
 * 캐릭터 머리 위(화면 좌표, 캔버스 안으로 당김): 잡은 물고기를 2배로 들어 보이거나,
 * 놓친 물고기 그림자가 물보라 속으로 사라진다. 화면 가운데 위는 HTML 결과 알림 자리라 피한다.
 * cx = 캐릭터 가운데 x, top = 캐릭터 그림 위 끝 y.
 */
function drawOutcome(ctx: CanvasRenderingContext2D, s: WorldScene, cx: number, top: number, w: number): void {
  const t = s.tMs
  const inX = (x: number, sw: number) => Math.max(0, Math.min(w - sw, x))
  // 자랑으로 다른 물고기를 들었으면 그 물고기만 보인다(같은 자리에 겹치지 않게)
  if (s.phase === 'caught' && !s.holding && s.caughtSpecies && SPRITES[`fish-${s.caughtSpecies}`]) {
    const fish = SPRITES[`fish-${s.caughtSpecies}`]
    const fx = inX(cx - fish.w, fish.w * 2)
    const fy = Math.max(0, top - fish.h * 2 - 2 - (Math.floor(t / 400) % 2))
    drawSprite(ctx, `fish-${s.caughtSpecies}`, fx, fy, 2)
    const blink = Math.floor(t / 250) % 2
    drawSprite(ctx, 'sparkle', fx - 6, fy + (blink ? 2 : 8), 1)
    drawSprite(ctx, 'sparkle', fx + fish.w * 2 + 1, fy + (blink ? 10 : 4), 1)
    if (blink) drawSprite(ctx, 'sparkle', fx + fish.w - 2, fy - 4, 1)
  } else if (s.phase === 'lost') {
    const shadow = SPRITES['fish-shadow']
    const drift = Math.floor((t % 1200) / 300)
    const sx = inX(cx - shadow.w + drift * 2, shadow.w * 2)
    const sy = Math.max(4, top - shadow.h * 2 - 4)
    drawSprite(ctx, 'fish-shadow', sx, sy, 2)
    drawSprite(ctx, 'splash', sx - 4, sy - 4 + (Math.floor(t / 150) % 2), 1)
  }
}

/** 비·눈: tMs로만 정해지는 위치라 같은 시각이면 같은 그림. 겨울(또는 늘 눈 맵)이면 눈, 아니면 비. */
function drawPrecipitation(ctx: CanvasRenderingContext2D, cond: Conditions, tMs: number, w: number, h: number, snowy = false): void {
  if (cond.weather !== 'rain') return
  const snow = snowy || isSnow(cond)
  const count = snow ? SNOW_COUNT : RAIN_COUNT
  const speed = snow ? SNOW_SPEED : RAIN_SPEED
  ctx.fillStyle = snow ? C.snow : C.rain
  for (let i = 0; i < count; i++) {
    const x0 = hash(i, 1) % w
    const y0 = hash(i, 2) % h
    const v = 0.8 + (hash(i, 3) % 5) / 10
    const y = (y0 + tMs * speed * v) % h
    if (snow) {
      const x = x0 + Math.round(Math.sin(tMs / 700 + i) * 3)
      ctx.fillRect(Math.round(x), Math.round(y), 2, 2)
    } else {
      ctx.fillRect(Math.round(x0 - y * 0.1), Math.round(y), 1, 3)
    }
  }
}

/** 밤 색조: 화면 전체를 한 번에 덮는다 */
function drawNightTint(ctx: CanvasRenderingContext2D, cond: Conditions, w: number, h: number): void {
  const level = nightLevel(cond.gameMinute)
  if (level <= 0) return
  ctx.fillStyle = `rgba(${C.night}, ${0.5 * level})`
  ctx.fillRect(0, 0, w, h)
}

/** HUD 시계: 반투명 판 위에 계절 아이콘, 날씨 아이콘, 픽셀 숫자 `14:30`(10분 단위). box는 hudLayout의 clock. */
function drawClock(ctx: CanvasRenderingContext2D, cond: Conditions, box: Box, snowy = false): void {
  rect(ctx, box.x, box.y, box.w, box.h, C.clockPlate)
  let x = box.x + CLOCK_PAD
  drawSprite(ctx, `season-${cond.season}`, x, box.y + 2, 1)
  x += SEASON_ICON_W + CLOCK_ICON_GAP
  drawSprite(ctx, cond.weather === 'sun' ? 'icon-sun' : snowy || isSnow(cond) ? 'icon-snow' : 'icon-rain', x, box.y + 2, 1)
  x += WEATHER_ICON_W + CLOCK_TEXT_GAP
  for (const ch of formatClock(cond.gameMinute)) {
    const name = ch === ':' ? 'digit-colon' : `digit-${ch}`
    drawSprite(ctx, name, x, box.y + 3, 1)
    x += SPRITES[name].w + DIGIT_GAP
  }
}

/** 물때 맵의 HUD: 시계 판 바로 아래 작은 판에 썰물·밀물 아이콘 */
function drawTideIcon(ctx: CanvasRenderingContext2D, tide: Tide, clock: Box): void {
  const size = SPRITES['icon-tide-low'].w + 4
  rect(ctx, clock.x, clock.y + clock.h + 1, size, size, C.tidePlate)
  drawSprite(ctx, `icon-tide-${tide}`, clock.x + 2, clock.y + clock.h + 3, 1)
}

// ── 안개(늪지, 장면 효과만) ───────────────────────────────────────
/** 캐릭터 둘레 이 반지름(px)까지 맑고(전체 어둡게만), FOG_FAR까지 짙어진다 */
const FOG_NEAR = 4 * TILE
const FOG_FAR = 7 * TILE
/** 맑은 둘레에도 남는 짙기 비율(화면 전체 어둡게) */
const FOG_BASE = 0.25
/** 비네트를 칠하는 칸 크기(px). 캐시가 없을 때(직접 그리기)도 이 크기로 칠한다 */
const FOG_CELL = 8
/** 안개 짙기 0~0.75: 기본 0.35 + 밤 0.25 × nightLevel + 비 0.15 */
export function fogDensity(cond: Conditions): number {
  return Math.min(0.75, 0.35 + 0.25 * nightLevel(cond.gameMinute) + (cond.weather === 'rain' ? 0.15 : 0))
}
/** 캐릭터와의 거리(px)에 따른 비네트 알파 비율(0~1) */
function fogRamp(d: number): number {
  if (d <= FOG_NEAR) return FOG_BASE
  if (d >= FOG_FAR) return 1
  return FOG_BASE + ((1 - FOG_BASE) * (d - FOG_NEAR)) / (FOG_FAR - FOG_NEAR)
}
/** 화면 크기(w, h)별 비네트 캔버스(2w × 2h, 가운데가 캐릭터 자리). 화면을 떠나면 releaseSceneCache가 비운다 */
let fogCache: { w: number; h: number; canvas: HTMLCanvasElement } | null = null
function fogCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (fogCache && fogCache.w === w && fogCache.h === h) return fogCache.canvas
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = 2 * w
  c.height = 2 * h
  const cx = c.getContext('2d')
  if (!cx) {
    c.width = c.height = 0
    return null
  }
  if (fogCache) fogCache.canvas.width = fogCache.canvas.height = 0
  for (let y = 0; y < 2 * h; y += FOG_CELL) {
    for (let x = 0; x < 2 * w; x += FOG_CELL) {
      const a = fogRamp(Math.hypot(x + FOG_CELL / 2 - w, y + FOG_CELL / 2 - h))
      cx.fillStyle = `rgba(${C.fog}, ${a.toFixed(3)})`
      cx.fillRect(x, y, FOG_CELL, FOG_CELL)
    }
  }
  fogCache = { w, h, canvas: c }
  return c
}
/** 안개: 밤 색조 다음·HUD 앞. 캐시 캔버스가 있으면 drawImage 한 번(globalAlpha = 짙기), 없으면 칸마다 칠한다 */
function drawFog(ctx: CanvasRenderingContext2D, cond: Conditions, px: number, py: number, w: number, h: number): void {
  const density = fogDensity(cond)
  const vignette = fogCanvas(w, h)
  if (vignette) {
    const prev = ctx.globalAlpha
    ctx.globalAlpha = density
    ctx.drawImage(vignette, Math.round(px - w), Math.round(py - h))
    ctx.globalAlpha = prev ?? 1
    return
  }
  for (let y = 0; y < h; y += FOG_CELL) {
    for (let x = 0; x < w; x += FOG_CELL) {
      const a = density * fogRamp(Math.hypot(x + FOG_CELL / 2 - px, y + FOG_CELL / 2 - py))
      ctx.fillStyle = `rgba(${C.fog}, ${a.toFixed(3)})`
      ctx.fillRect(x, y, FOG_CELL, FOG_CELL)
    }
  }
}

/** 신화 빛고리를 보이는 시간 */
export const MYTHIC_FLASH_MS = 1500
/** 캐릭터 둘레로 퍼지는 빛고리 두 겹(화면 좌표 cx, cy = 캐릭터 가운데) */
function drawMythicRing(ctx: CanvasRenderingContext2D, ms: number, cx: number, cy: number): void {
  const t = ms / MYTHIC_FLASH_MS
  ripple(ctx, cx, cy, 8 + t * 18, C.mythicRing)
  ripple(ctx, cx, cy, 4 + t * 12, C.mythicRingEdge)
}

// ── 한 프레임 ───────────────────────────────────────────────────

/**
 * 장면 한 프레임. size는 캔버스의 논리 크기다.
 * 정적 맵 → 잠긴 문·배 → 찌·낚싯줄 → 캐릭터와 나무 윗부분(발 y 순) → 입질 느낌표 → 비·눈 → 밤 색조(실내는 둘 다 없음)
 * → 게이지·트랙·결과 → 시계 순으로 그린다.
 */
// ── 모래 발자국(화면 전용) ───────────────────────────────────────

/** 내 캐릭터 발자국. 맵(·물때)이 바뀌면 비운다 */
let footprints: Footprints = NO_FOOTPRINTS
let footprintsKey = ''

function updateFootprints(g: MapGfx, s: WorldScene): void {
  const key = `${g.map.id}:${g.tide}`
  if (key !== footprintsKey) {
    footprints = NO_FOOTPRINTS
    footprintsKey = key
  }
  footprints = stepFootprints(footprints, s.player.pos, s.tMs, (x, y) => groundAt(g, Math.floor(x / TILE), Math.floor(y / TILE)) === 'sand')
}

/** 발자국: 발 중앙 아래 2×1 점. 왼발·오른발을 좌우로 벌린다. 월드 좌표 */
function drawFootprints(ctx: CanvasRenderingContext2D, tMs: number): void {
  const prev = ctx.globalAlpha
  for (const f of footprints.prints) {
    const a = footprintAlpha(f, tMs)
    if (a <= 0) continue
    ctx.globalAlpha = prev * a
    rect(ctx, Math.round(f.x) + (f.side === 0 ? -3 : 1), Math.round(f.y) - 1, 2, 1, C.footprint)
  }
  ctx.globalAlpha = prev
}

export function drawWorld(ctx: CanvasRenderingContext2D, s: WorldScene, size: SceneSize): void {
  const w = Math.max(1, Math.floor(size.w) || 0)
  const h = Math.max(1, Math.floor(size.h) || 0)
  const cam = { x: Math.round(s.camera.x), y: Math.round(s.camera.y) }
  const k = waterFrame(s.tMs)
  ctx.imageSmoothingEnabled = false

  const dyn = s.dyn ?? STATIC_DYNAMIC
  const { gfx, frames } = mapCache(s.map, dyn.tide)
  updateFootprints(gfx, s)
  if (frames) ctx.drawImage(frames[k] ?? frames[0], cam.x, cam.y, w, h, 0, 0, w, h)
  else {
    ctx.save()
    ctx.translate(-cam.x, -cam.y)
    try {
      drawStatic(ctx, gfx, k, Math.floor(cam.x / TILE), Math.floor(cam.y / TILE), Math.floor((cam.x + w - 1) / TILE), Math.floor((cam.y + h - 1) / TILE))
    } finally {
      ctx.restore()
    }
  }

  const pose = poseFor(s.phase, s.player)
  const shake = s.phase === 'fighting' ? (Math.floor(s.tMs / 90) % 2 === 0 ? -1 : 1) : 0
  const px = Math.round(s.player.pos.x) - PLAYER_W / 2 + shake
  const py = Math.round(s.player.pos.y) - PLAYER_H

  ctx.save()
  ctx.translate(-cam.x, -cam.y)
  try {
    drawFootprints(ctx, s.tMs)
    drawWorldLayer(ctx, s, pose, px, py, cam, w, h)
  } finally {
    ctx.restore()
  }

  // 실내(동굴 등)에는 비·눈이 오지 않고 밤 색조도 없다. 시계는 그대로
  const screenX = Math.round(s.player.pos.x) - cam.x
  if (!s.map.indoor) {
    drawPrecipitation(ctx, s.cond, s.tMs, w, h, s.map.snowy)
    drawNightTint(ctx, s.cond, w, h)
  }
  // 안개는 밤 색조 다음, HUD 앞. 캐릭터 몸 가운데를 맑은 둘레의 중심으로
  if (s.map.fog) drawFog(ctx, s.cond, screenX, Math.round(s.player.pos.y) - cam.y - PLAYER_H / 2, w, h)
  const flash = s.mythicFlashMs
  if (flash != null && flash >= 0 && flash < MYTHIC_FLASH_MS) drawMythicRing(ctx, flash, screenX, Math.round(s.player.pos.y) - cam.y - PLAYER_H / 2)

  // HUD (화면 좌표)
  const hud = hudLayout(screenX, w, h, s.hudTop)
  if (s.phase === 'charging') drawGauge(ctx, s.gauge, screenX, py - cam.y, w, h)
  if (s.phase === 'fighting' && s.bar && s.barParams) drawTrack(ctx, s.bar, s.barParams, s.tMs, hud.track)
  drawOutcome(ctx, s, screenX, py - cam.y, w)
  // 시계는 낚시 트랙의 반대쪽 위, 모든 단계에서
  drawClock(ctx, s.cond, hud.clock, s.map.snowy)
  if (s.map.tidal) drawTideIcon(ctx, dyn.tide, hud.clock)
  // 지역 전환 페이드는 HUD까지 덮도록 맨 마지막에, 화면 전체를 한 번에
  if (s.fade > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, s.fade)})`
    ctx.fillRect(0, 0, w, h)
  }
}

/** 타일 사각형이 화면 타일 범위 [tx0..tx1]×[ty0..ty1]과 겹치는가 */
const rectInView = (r: Rect, tx0: number, ty0: number, tx1: number, ty1: number): boolean =>
  r.tx <= tx1 && r.tx + r.w - 1 >= tx0 && r.ty <= ty1 && r.ty + r.h - 1 >= ty0

/**
 * 잠긴 문과 선착장의 배(월드 좌표, 캐릭터·찌보다 먼저). 정적 캐시에는 넣지 않아 지역이 열려도 캐시를 다시 만들지 않는다.
 * 무너진 다리는 칸마다 물(물결 박자 그대로)을 깔고 끊긴 판자를 얹는다. 돌무더기는 캐시의 바닥 위에 바로 얹는다.
 * 같은 그림이 줄지어 보이지 않게 칸마다 좌우를 번갈아 뒤집는다.
 */
function drawPlaces(ctx: CanvasRenderingContext2D, s: WorldScene, k: number, tx0: number, ty0: number, tx1: number, ty1: number): void {
  for (const gate of s.map.gates) {
    if (s.opened.has(gate.area) || !rectInView(gate.tiles, tx0, ty0, tx1, ty1)) continue
    const { tiles } = gate
    for (let ty = tiles.ty; ty < tiles.ty + tiles.h; ty++) {
      for (let tx = tiles.tx; tx < tiles.tx + tiles.w; tx++) {
        const kind = tileAt(s.map, tx, ty)
        if (gate.look === 'broken-bridge' && kind !== null && WATER_GROUND.has(kind)) {
          drawSprite(ctx, `${WATER_SPRITE[kind] ?? 'water'}-${(k + tx + ty * 3) % 2}`, tx * TILE, ty * TILE, 1)
        }
        drawSprite(ctx, `gate-${gate.look}`, tx * TILE, ty * TILE, 1, (tx + ty) % 2 === 1 ? { flipX: true } : undefined)
      }
    }
  }
  const boatW = Math.ceil(SPRITES.boat.w / TILE)
  for (const dock of s.map.docks) {
    if (!rectInView({ tx: dock.boat.tx, ty: dock.boat.ty, w: boatW, h: 1 }, tx0, ty0, tx1, ty1)) continue
    // 물 타일과 같은 박자로 1px 출렁인다
    drawSprite(ctx, 'boat', dock.boat.tx * TILE, dock.boat.ty * TILE + k, 1)
  }
}

/** 얼음 구멍(맵 캐시 밖, 매 프레임)과 뚫는 중인 금. 구멍은 방문 동안 최대 3개라 싸다 */
function drawHoles(ctx: CanvasRenderingContext2D, s: WorldScene, k: number, tx0: number, ty0: number, tx1: number, ty1: number): void {
  for (const key of s.dyn?.holes ?? []) {
    const [tx, ty] = key.split(',').map(Number)
    if (tx < tx0 || tx > tx1 || ty < ty0 || ty > ty1) continue
    drawSprite(ctx, `tile-hole-${(k + tx + ty * 3) % 2}`, tx * TILE, ty * TILE, 1)
  }
  const d = s.drill
  if (d) drawSprite(ctx, `drill-${d.ms < 400 ? 0 : d.ms < 800 ? 1 : 2}`, d.tx * TILE, d.ty * TILE, 1)
}

/** 순간이동기 탑: 구조물 칸(2×2) 왼쪽 위에서 한 칸 위부터 그린다(탑 끝이 위 칸으로 솟는다). 켜져 있으면 등롱 불빛을 얹는다 */
function drawTeleporter(ctx: CanvasRenderingContext2D, s: WorldScene, r: Rect, k: number): void {
  const x = r.tx * TILE
  const y = (r.ty + r.h) * TILE - SPRITES.teleporter.h
  drawSprite(ctx, 'teleporter', x, y, 1)
  if (s.teleporterOn) drawSprite(ctx, `teleporter-glow-${k}`, x, y, 1)
}

/** 월드 좌표로 그리는 움직이는 것들 */
const FAME_C = { gold: '#c9a54a', goldDark: '#8a6d2a', board: '#7a5232', boardLight: '#a8774a', glass: '#d8e7ee', face: '#9aa3ab', plate: '#e9e2cf' }
const faceCache = new Map<string, Sprite>()
/** 캐릭터 기록 문자열 → 정면 그림의 머리(가운데 12×12) */
function faceOf(avatar: string): Sprite {
  const hit = faceCache.get(avatar)
  if (hit) return hit
  const full = composePose('player-idle-down', decodeOutfit(avatar))
  const sp: Sprite = { ...full, w: 12, h: 12, rows: full.rows.slice(0, 12).map((r) => r.slice(2, 14)) }
  faceCache.set(avatar, sp)
  return sp
}

/** 명예의 전당 벽 전시(1줄): 박제는 나무 판 + 물고기, 액자는 금테 + 1위 얼굴(없으면 빈 얼굴) */
function drawFame(ctx: CanvasRenderingContext2D, frames: readonly FameFrame[]): void {
  const y = FAME_ROW * TILE
  for (const f of frames) {
    const x = f.tx * TILE
    if (f.look === 'mount') {
      rect(ctx, x + 2, y + 1, 2 * TILE - 4, TILE - 2, FAME_C.board)
      rect(ctx, x + 4, y + 3, 2 * TILE - 8, TILE - 6, FAME_C.boardLight)
      if (f.species && SPRITES[`fish-${f.species}`]) drawSprite(ctx, `fish-${f.species}`, x + TILE / 2, y, 1)
      rect(ctx, x + 10, y + TILE, 12, 2, FAME_C.plate)
      continue
    }
    rect(ctx, x + 1, y + 1, TILE - 2, TILE - 2, FAME_C.gold)
    rect(ctx, x + 2, y + 2, TILE - 4, TILE - 4, FAME_C.glass)
    if (f.avatar) drawSpriteData(ctx, faceOf(f.avatar), x + 2, y + 2, 1)
    else {
      rect(ctx, x + 5, y + 4, 6, 5, FAME_C.face)
      rect(ctx, x + 4, y + 10, 8, 3, FAME_C.face)
    }
    rect(ctx, x + 4, y + TILE, 8, 2, f.empty ? FAME_C.goldDark : FAME_C.plate)
  }
}

function drawWorldLayer(ctx: CanvasRenderingContext2D, s: WorldScene, pose: Pose, px: number, py: number, cam: Vec, w: number, h: number): void {
  const t = s.tMs
  const b = s.bobber ? { x: Math.round(s.bobber.x), y: Math.round(s.bobber.y) } : null
  const tip = rodTip(pose, px, py)
  const tx0 = Math.floor(cam.x / TILE)
  const tx1 = Math.floor((cam.x + w - 1) / TILE)
  const ty0 = Math.floor(cam.y / TILE)
  const ty1 = Math.floor((cam.y + h - 1) / TILE) + 1

  // 바닥에 붙은 것(잠긴 문·배·얼음 구멍·뚫는 금)이 맨 먼저
  if (s.map.backdrop && s.fame) drawFame(ctx, s.fame)
  drawPlaces(ctx, s, waterFrame(t), tx0, ty0, tx1, ty1)
  drawHoles(ctx, s, waterFrame(t), tx0, ty0, tx1, ty1)

  // 물 위 요소(물결·찌·줄)는 캐릭터보다 먼저
  if (b) {
    if (s.phase === 'waiting') {
      ripple(ctx, b.x, b.y + 2, 3 + ((t % 1400) / 1400) * 7, C.ripple)
    } else if (s.phase === 'bite') {
      ripple(ctx, b.x, b.y + 2, 4 + ((t % 500) / 500) * 4, C.ripple)
      ripple(ctx, b.x, b.y + 2, 9 + ((t % 500) / 500) * 4, C.foam)
    } else if (s.phase === 'lost') {
      ripple(ctx, b.x, b.y + 1, 5 + ((t % 1200) / 1200) * 8, C.ripple)
    }
    if (s.phase === 'waiting' || s.phase === 'bite') {
      const bob = s.phase === 'waiting' ? Math.floor(t / WATER_FRAME_MS) % 2 : 2 // 입질 때는 쑥 잠긴다
      if (tip) line(ctx, tip[0], tip[1], b.x, b.y - 5 + bob, C.line)
      drawSprite(ctx, 'bobber', b.x - 3, b.y - 5 + bob, 1)
    } else if (s.phase === 'fighting') {
      // 찌는 물속, 줄 끝에서 물보라가 좌우로 튄다
      const fx = b.x + Math.round(Math.sin(t / 260) * 6)
      ripple(ctx, fx, b.y, 6 + ((t % 400) / 400) * 3, C.ripple)
      if (tip) line(ctx, tip[0], tip[1], fx, b.y - 1, C.line)
      drawSprite(ctx, 'splash', fx - 4, b.y - 4 + (Math.floor(t / 120) % 2), 1)
    }
  }

  // 캐릭터와 서 있는 것들(나무·야자수 윗부분, 순간이동기 탑): 기준선이 캐릭터 발 이하면 캐릭터 뒤(먼저), 아니면 앞
  const tall: { key: number; draw: () => void }[] = []
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const kind = tileAt(s.map, tx, ty)
      const name = kind === null ? undefined : TALL_SPRITE[kind]
      if (name) tall.push({ key: ty * TILE + TREE_BASE, draw: () => drawSpritePart(ctx, name, tx * TILE, (ty - 1) * TILE, TREE_TOP) })
    }
  }
  const tp = s.map.teleporter
  // 탑 끝이 한 칸 위로 솟으므로 그 줄까지 화면에 걸치면 그린다. 기준선은 구조물 칸 아래 끝(캐릭터는 그 칸에 설 수 없다)
  if (tp && rectInView({ ...tp.tiles, ty: tp.tiles.ty - 1, h: tp.tiles.h + 1 }, tx0, ty0, tx1, ty1)) {
    tall.push({ key: (tp.tiles.ty + tp.tiles.h) * TILE, draw: () => drawTeleporter(ctx, s, tp.tiles, waterFrame(t)) })
  }
  // 기준선 순으로 그린다(이동기 바로 아래 칸의 나무처럼 훑은 순서와 깊이가 다른 경우)
  // 같은 지역 친구: 발 기준선으로 나무·탑과 함께 깊이를 맞춘다. 같은 높이면 친구가 먼저(내 캐릭터가 위)
  for (const o of s.others ?? []) {
    const ox = Math.round(o.pos.x) - PLAYER_W / 2
    const oy = Math.round(o.pos.y) - PLAYER_H
    if (ox + PLAYER_W < tx0 * TILE || ox > (tx1 + 1) * TILE || oy + PLAYER_H < ty0 * TILE || oy > (ty1 + 1) * TILE) continue
    tall.push({ key: o.pos.y - 0.001, draw: () => drawPeer(ctx, o, ox, oy) })
  }
  tall.sort((a, b) => a.key - b.key)
  const feet = s.player.pos.y
  for (const it of tall) if (it.key <= feet) it.draw()
  drawPlayer(ctx, s, pose, px, py, tip)
  for (const it of tall) if (it.key > feet) it.draw()

  // 자랑으로 든 물고기는 나무보다도 위(누가 무엇을 들었는지 가려지지 않게). 모르는 어종은 그리지 않는다
  if (s.holding) drawHeld(ctx, s.holding, Math.round(s.player.pos.x), py, t)
  for (const o of s.others ?? []) if (o.holding) drawHeld(ctx, o.holding, Math.round(o.pos.x), Math.round(o.pos.y) - PLAYER_H, t)

  // 입질 느낌표는 찌 위, 나무보다도 위
  if (b && s.phase === 'bite') {
    const hop = Math.floor(t / 120) % 2
    drawSprite(ctx, 'bang', b.x + 3, b.y - 28 - hop, 2)
  }
}

/** 머리 위로 든 물고기(월드 좌표, 잡았을 때 그림과 같은 2배·반짝임). cx = 캐릭터 가운데 x, top = 캐릭터 그림 위 끝 y */
function drawHeld(ctx: CanvasRenderingContext2D, species: string, cx: number, top: number, t: number): void {
  const name = `fish-${species}`
  const fish = SPRITES[name]
  if (!fish) return
  const fx = cx - fish.w
  const fy = top - fish.h * 2 - 2 - (Math.floor(t / 400) % 2)
  drawSprite(ctx, name, fx, fy, 2)
  const blink = Math.floor(t / 250) % 2
  drawSprite(ctx, 'sparkle', fx - 6, fy + (blink ? 2 : 8), 1)
  drawSprite(ctx, 'sparkle', fx + fish.w * 2 + 1, fy + (blink ? 10 : 4), 1)
}

/** 친구 캐릭터: 낚시 중이면 던진 자세, 아니면 내 캐릭터와 같은 대기·걷기 규칙. 찌·줄은 그리지 않는다 */
function drawPeer(ctx: CanvasRenderingContext2D, o: ScenePeer, px: number, py: number): void {
  const pose = poseFor(o.act === 'fish' ? 'waiting' : 'idle', o)
  rect(ctx, px + 3, py + PLAYER_H - 2, 10, 3, C.groundShadow)
  const flip = pose.flipX ? { flipX: true } : undefined
  const dressed = playerSprites(o.outfit)[pose.name]
  if (dressed) drawSpriteData(ctx, dressed, px, py, 1, flip)
  else drawSprite(ctx, pose.name, px, py, 1, flip)
}

function drawPlayer(ctx: CanvasRenderingContext2D, s: WorldScene, pose: Pose, px: number, py: number, tip: [number, number] | null): void {
  // 발밑 그림자
  rect(ctx, px + 3, py + PLAYER_H - 2, 10, 3, C.groundShadow)
  const flip = pose.flipX ? { flipX: true } : undefined
  const dressed = s.outfit ? playerSprites(s.outfit)[pose.name] : undefined
  if (dressed) drawSpriteData(ctx, dressed, px, py, 1, flip)
  else drawSprite(ctx, pose.name, px, py, 1, flip)
  if (s.phase === 'lost') {
    // 끊어진 줄이 낚싯대 끝에서 늘어지고, 진땀 한 방울
    if (tip) {
      line(ctx, tip[0], tip[1], tip[0] + 2, tip[1] + 6, C.line)
      line(ctx, tip[0] + 2, tip[1] + 6, tip[0] + 1, tip[1] + 11, C.line)
    }
    drawSprite(ctx, 'sweat', px - 2, py + 4 + (Math.floor(s.tMs / 300) % 2), 1)
  }
}

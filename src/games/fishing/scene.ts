// 낚시 마을 장면 그리기(설계 §4.5, §6.1). 타일맵을 카메라로 잘라 그리고, 그 위에 찌·캐릭터·나무 윗부분·HUD를 얹는다.
// 좌표: 월드 픽셀(맵 왼쪽 위 = 0,0), 화면 = 월드 - camera. 캐릭터 pos는 발 중앙.
// 캔버스는 CSS로 정수 배 확대하고 image-rendering: pixelated, ctx.imageSmoothingEnabled = false.
// 그리기는 fillRect만 쓴다(정적 레이어 캐시를 화면에 옮길 때만 drawImage). HUD 시계 글자도 픽셀 숫자 스프라이트다.
// 캔버스 내부 색은 theme 토큰 규칙의 승인된 예외(설계 §5)다.
import type { Bar, BarParams } from './minigame.ts'
import { TILE, tileAt, type MapDef, type Vec } from './map.ts'
import type { Player } from './walk.ts'
import { SPRITES, drawSprite } from './sprites.ts'
import { formatClock, isSnow, nightLevel, type Conditions } from './clock.ts'

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
}

/** 화면 좌표 사각형 */
export type Box = { x: number; y: number; w: number; h: number }

/** 가장 작은 화면(논리 크기). 화면 쪽 fitScene이 이보다 작게 만들지 않는다. */
export const SCENE_W = 160
export const SCENE_H = 240
export type SceneSize = { w: number; h: number }

const WATER_FRAME_MS = 500
const WALK_FRAME_MS = 200
/** 나무 밑동(줄기 아래 끝)의 칸 안 y. 캐릭터 발이 이보다 위면 나무 윗부분이 캐릭터를 가린다. */
const TREE_BASE = 10

// 스프라이트 크기
const PLAYER_W = 16
const PLAYER_H = 24

// 자세별 낚싯대 끝(스프라이트 안 좌표, 오른쪽을 볼 때). 왼쪽은 x를 거울로 뒤집는다.
const ROD_TIP: Record<string, [number, number]> = {
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
  foam: '#e9f6fb',
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

type Ground = 'water' | 'sand' | 'grass'

function baseGround(map: MapDef, tx: number, ty: number): Ground | null {
  const kind = tileAt(map, tx, ty)
  if (kind === null || kind === 'rock') return null
  if (kind === 'water' || kind === 'pier') return 'water'
  if (kind === 'sand') return 'sand'
  return 'grass'
}

/** 바위는 이웃 땅 중 가장 많은 것 위에 놓는다(같으면 모래 > 풀 > 물). */
function rockGround(map: MapDef, tx: number, ty: number): Ground {
  const count: Record<Ground, number> = { sand: 0, grass: 0, water: 0 }
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const g = baseGround(map, tx + dx, ty + dy)
    if (g) count[g]++
  }
  let best: Ground = 'sand'
  for (const g of ['grass', 'water'] as Ground[]) if (count[g] > count[best]) best = g
  return best
}

/** 맵 전체의 바탕 땅(행 우선). 맵 캐시와 함께 만들고 버린다. */
function computeGround(map: MapDef): (Ground | null)[] {
  const ground: (Ground | null)[] = []
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      ground.push(tileAt(map, tx, ty) === 'rock' ? rockGround(map, tx, ty) : baseGround(map, tx, ty))
    }
  }
  return ground
}

/** 그리기에 쓰는 맵 + 계산해 둔 땅 */
type MapGfx = { map: MapDef; ground: readonly (Ground | null)[] }

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

/** 칸 하나: 땅 → 물가 거품·풀 가장자리 → 위에 얹는 것(나무 밑동·바위·울타리·부두 판자). 모두 자기 칸 안에 그린다. */
function drawTile(ctx: CanvasRenderingContext2D, g: MapGfx, tx: number, ty: number, k: number): void {
  const kind = tileAt(g.map, tx, ty)
  if (kind === null) return
  const x = tx * TILE
  const y = ty * TILE
  const ground = groundAt(g, tx, ty)

  if (kind === 'path') drawSprite(ctx, 'tile-path', x, y, 1)
  else if (kind === 'flower') drawSprite(ctx, 'tile-flower', x, y, 1)
  else if (ground === 'water') {
    // 칸마다 위상을 어긋나게 해서 물결이 한꺼번에 깜빡이지 않게
    drawSprite(ctx, (k + tx + ty * 3) % 2 === 0 ? 'water-0' : 'water-1', x, y, 1)
    drawShoreEdges(ctx, g, tx, ty, k)
  } else if (ground === 'sand') {
    drawSprite(ctx, 'tile-sand', x, y, 1)
    drawGrassFringe(ctx, g, tx, ty)
  } else {
    drawSprite(ctx, hash(tx, ty) % 4 === 0 ? 'tile-grass-alt' : 'tile-grass', x, y, 1)
  }

  if (kind === 'tree') drawSpritePart(ctx, 'tile-tree', x, y - TILE, TREE_BOTTOM)
  else if (kind === 'rock') {
    if (ground === 'water') drawSprite(ctx, 'rock', x + 1, y + 4, 1)
    else drawSprite(ctx, 'tile-rock', x, y, 1)
  } else if (kind === 'fence') drawFence(ctx, g, tx, ty)
  else if (kind === 'pier') drawSprite(ctx, 'pier-plank', x, y, 1)
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
  const shop = map.shop
  if (shop) {
    const shopRight = shop.tx + shop.w - 1
    const shopBottom = shop.ty + shop.h - 1
    if (shop.tx <= x1 && shopRight >= x0 && shop.ty <= y1 && shopBottom >= y0) {
      drawSprite(ctx, 'shop', shop.tx * TILE, shop.ty * TILE, 1)
    }
  }
}

/**
 * 맵 캐시: 한 번에 맵 하나만 가진다(map.id가 바뀌면 이전 것을 버린다).
 * gfx는 계산해 둔 땅, frames는 물 타일 두 장 각각에 맞춘 맵 전체를 오프스크린 캔버스 두 개에 한 번 그려 둔 것이다.
 * 오프스크린 2D 컨텍스트를 못 얻으면(jsdom 등) frames 없이 매 프레임 보이는 타일만 직접 그린다.
 */
type Cache = { gfx: MapGfx; frames: [HTMLCanvasElement, HTMLCanvasElement] | null }
let cache: Cache | null = null

function renderFrames(g: MapGfx): [HTMLCanvasElement, HTMLCanvasElement] | null {
  if (typeof document === 'undefined') return null
  const frames: HTMLCanvasElement[] = []
  for (const k of [0, 1]) {
    const c = document.createElement('canvas')
    c.width = g.map.w * TILE
    c.height = g.map.h * TILE
    const cx = c.getContext('2d')
    if (!cx) return null
    cx.imageSmoothingEnabled = false
    drawStatic(cx, g, k, 0, 0, g.map.w - 1, g.map.h - 1)
    frames.push(c)
  }
  return [frames[0], frames[1]]
}

/** 맵 캐시를 놓아 준다(게임 화면을 떠날 때). 다음 그리기에서 다시 만든다. */
export function releaseSceneCache(): void {
  cache = null
}

function mapCache(map: MapDef): Cache {
  if (!cache || cache.gfx.map.id !== map.id) {
    const gfx: MapGfx = { map, ground: computeGround(map) }
    cache = { gfx, frames: renderFrames(gfx) }
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

  // 틀
  rect(ctx, tx - 1, ty - 1, TRACK_W + 2, trackH + 2, C.outline)
  rect(ctx, tx, ty, TRACK_W, trackH, C.trackWood)
  rect(ctx, tx, ty, TRACK_W, 1, C.trackWoodLight)
  rect(ctx, tx, ty, 1, trackH, C.trackWoodLight)
  rect(ctx, inner.x - 1, inner.y - 1, inner.w + 2, inner.h + 2, C.outline)
  rect(ctx, inner.x, inner.y, inner.w, inner.h, C.trackInner)
  for (let y = inner.y + 6; y < inner.y + inner.h; y += 12) rect(ctx, inner.x + 2, y, inner.w - 4, 1, C.trackInnerLine)

  // 바: 위치 0 = 트랙 아래
  const barH = Math.max(4, Math.round(params.barSize * inner.h))
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
  if (s.phase === 'caught' && s.caughtSpecies && SPRITES[`fish-${s.caughtSpecies}`]) {
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

/** 비·눈: tMs로만 정해지는 위치라 같은 시각이면 같은 그림. 겨울이면 눈, 아니면 비. */
function drawPrecipitation(ctx: CanvasRenderingContext2D, cond: Conditions, tMs: number, w: number, h: number): void {
  if (cond.weather !== 'rain') return
  const snow = isSnow(cond)
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
function drawClock(ctx: CanvasRenderingContext2D, cond: Conditions, box: Box): void {
  rect(ctx, box.x, box.y, box.w, box.h, C.clockPlate)
  let x = box.x + CLOCK_PAD
  drawSprite(ctx, `season-${cond.season}`, x, box.y + 2, 1)
  x += SEASON_ICON_W + CLOCK_ICON_GAP
  drawSprite(ctx, cond.weather === 'sun' ? 'icon-sun' : isSnow(cond) ? 'icon-snow' : 'icon-rain', x, box.y + 2, 1)
  x += WEATHER_ICON_W + CLOCK_TEXT_GAP
  for (const ch of formatClock(cond.gameMinute)) {
    const name = ch === ':' ? 'digit-colon' : `digit-${ch}`
    drawSprite(ctx, name, x, box.y + 3, 1)
    x += SPRITES[name].w + DIGIT_GAP
  }
}

// ── 한 프레임 ───────────────────────────────────────────────────

/**
 * 장면 한 프레임. size는 캔버스의 논리 크기다.
 * 정적 맵 → 찌·낚싯줄 → 캐릭터와 나무 윗부분(발 y 순) → 입질 느낌표 → 비·눈 → 밤 색조 → 게이지·트랙·결과 → 시계 순으로 그린다.
 */
export function drawWorld(ctx: CanvasRenderingContext2D, s: WorldScene, size: SceneSize): void {
  const w = Math.max(1, Math.floor(size.w) || 0)
  const h = Math.max(1, Math.floor(size.h) || 0)
  const cam = { x: Math.round(s.camera.x), y: Math.round(s.camera.y) }
  const k = waterFrame(s.tMs)
  ctx.imageSmoothingEnabled = false

  const { gfx, frames } = mapCache(s.map)
  if (frames) ctx.drawImage(frames[k], cam.x, cam.y, w, h, 0, 0, w, h)
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
    drawWorldLayer(ctx, s, pose, px, py, cam, w, h)
  } finally {
    ctx.restore()
  }

  drawPrecipitation(ctx, s.cond, s.tMs, w, h)
  drawNightTint(ctx, s.cond, w, h)

  // HUD (화면 좌표)
  const screenX = Math.round(s.player.pos.x) - cam.x
  const hud = hudLayout(screenX, w, h, s.hudTop)
  if (s.phase === 'charging') drawGauge(ctx, s.gauge, screenX, py - cam.y, w, h)
  if (s.phase === 'fighting' && s.bar && s.barParams) drawTrack(ctx, s.bar, s.barParams, s.tMs, hud.track)
  drawOutcome(ctx, s, screenX, py - cam.y, w)
  // 시계는 낚시 트랙의 반대쪽 위, 모든 단계에서
  drawClock(ctx, s.cond, hud.clock)
}

/** 월드 좌표로 그리는 움직이는 것들 */
function drawWorldLayer(ctx: CanvasRenderingContext2D, s: WorldScene, pose: Pose, px: number, py: number, cam: Vec, w: number, h: number): void {
  const t = s.tMs
  const b = s.bobber ? { x: Math.round(s.bobber.x), y: Math.round(s.bobber.y) } : null
  const tip = rodTip(pose, px, py)

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

  // 캐릭터와 나무 윗부분: 발 y가 작은(먼) 것부터
  const trees: { x: number; y: number; key: number }[] = []
  const tx0 = Math.floor(cam.x / TILE)
  const tx1 = Math.floor((cam.x + w - 1) / TILE)
  const ty0 = Math.floor(cam.y / TILE)
  const ty1 = Math.floor((cam.y + h - 1) / TILE) + 1
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tileAt(s.map, tx, ty) === 'tree') trees.push({ x: tx * TILE, y: (ty - 1) * TILE, key: ty * TILE + TREE_BASE })
    }
  }
  const feet = s.player.pos.y
  for (const tr of trees) if (tr.key <= feet) drawSpritePart(ctx, 'tile-tree', tr.x, tr.y, TREE_TOP)
  drawPlayer(ctx, s, pose, px, py, tip)
  for (const tr of trees) if (tr.key > feet) drawSpritePart(ctx, 'tile-tree', tr.x, tr.y, TREE_TOP)

  // 입질 느낌표는 찌 위, 나무보다도 위
  if (b && s.phase === 'bite') {
    const hop = Math.floor(t / 120) % 2
    drawSprite(ctx, 'bang', b.x + 3, b.y - 28 - hop, 2)
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, s: WorldScene, pose: Pose, px: number, py: number, tip: [number, number] | null): void {
  // 발밑 그림자
  rect(ctx, px + 3, py + PLAYER_H - 2, 10, 3, C.groundShadow)
  drawSprite(ctx, pose.name, px, py, 1, pose.flipX ? { flipX: true } : undefined)
  if (s.phase === 'lost') {
    // 끊어진 줄이 낚싯대 끝에서 늘어지고, 진땀 한 방울
    if (tip) {
      line(ctx, tip[0], tip[1], tip[0] + 2, tip[1] + 6, C.line)
      line(ctx, tip[0] + 2, tip[1] + 6, tip[0] + 1, tip[1] + 11, C.line)
    }
    drawSprite(ctx, 'sweat', px - 2, py + 4 + (Math.floor(s.tMs / 300) % 2), 1)
  }
}

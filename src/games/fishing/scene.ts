// 낚시터 장면 그리기(설계 §4.4, §5). 논리 해상도는 w×h(최소 160×240), fillRect만 쓴다(배경 캐시를 붙일 때만 drawImage).
// 게임 요소(부두 끝·캐릭터·찌·트랙 등)는 가운데 놓인 160×240 안전 상자 안에 있고,
// 배경(모래·물·부두·바위·물고기 그림자)은 남는 칸까지 w×h 전체를 채운다.
// 캔버스는 CSS로 정수 배 확대하고 image-rendering: pixelated, ctx.imageSmoothingEnabled = false.
// 캔버스 내부 색은 theme 토큰 규칙의 승인된 예외(설계 §5)다.
import type { Bar, BarParams } from './minigame.ts'
import { SPRITES, drawSprite } from './sprites.ts'

export type Phase = 'idle' | 'charging' | 'waiting' | 'bite' | 'fighting' | 'caught' | 'lost'
/** tMs: 애니메이션 시계(ms). 계속 늘어나기만 하면 된다. gauge·castPower는 0~1. */
export type SceneState = {
  phase: Phase
  tMs: number
  gauge: number
  castPower: number
  bar: Bar | null
  barParams: BarParams | null
  caughtSpecies: string | null
}

/** 안전 상자(= 가장 작은 장면) 크기 */
export const SCENE_W = 160
export const SCENE_H = 240
export type SceneSize = { w: number; h: number }

const TILE = 16
const WATER_FRAME_MS = 500

// 모래톱 → 부두(위에서 내려옴) → 부두 끝에 캐릭터. 아래 좌표는 안전 상자 기준이다.
const SAND_H = 14
/** 모래·젖은 띠·파도 거품 아래 첫 줄 */
const SHORE_BOTTOM = SAND_H + 3
const PIER_X = 64
const PIER_W = 32
const PIER_END = 112
const PIER_FACE = 4
/** 부두 끝 옆면과 그 아래 그늘까지 */
const PIER_BOTTOM = PIER_END + PIER_FACE + 3
const POST_W = 8
const POST_H = 12
const POST_GAP = 40

const PLAYER_X = PIER_X + 8
const PLAYER_Y = PIER_END - 26

// 찌: castPower 0 → 부두 바로 아래, 1 → 화면 아래쪽
const BOBBER_X = PLAYER_X + 13
const BOBBER_MIN_Y = PIER_END + 20
const BOBBER_MAX_Y = SCENE_H - 22

// 자세별 낚싯대 끝(스프라이트 안 좌표)
const ROD_TIP: Record<string, [number, number]> = {
  'player-idle': [14, 2],
  'player-cast': [5, 0],
  'player-reel': [15, 23],
}

// 세로 트랙(fighting)
const TRACK_X = PLAYER_X + 36
const TRACK_Y = 20
const TRACK_W = 18
const TRACK_H = 132
const TRACK_INNER = { x: TRACK_X + 3, y: TRACK_Y + 3, w: TRACK_W - 6, h: TRACK_H - 6 }
const METER_X = TRACK_X + TRACK_W + 3
const METER_W = 6

const C = {
  outline: '#2a2135',
  sand: '#ead5a2',
  sandDark: '#d4b97f',
  sandWet: '#c7a96e',
  foam: '#e9f6fb',
  pierFace: '#6e4526',
  pierFaceDark: '#4e3019',
  shadow: '#246593',
  shadowDeck: '#9b6a3e',
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
}

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

// ── 배치: 크기(w×h)마다 한 번 정한다 ──────────────────────────────

/** 안전 상자의 위치와 주요 좌표(캔버스 기준) */
export type SceneLayout = {
  /** 안전 상자 왼쪽 위 */
  ox: number
  oy: number
  /** 캐릭터 스프라이트 왼쪽 위 */
  playerX: number
  playerY: number
  /** 부두 왼쪽 끝과 부두 끝(판자가 끝나는 줄) */
  pierX: number
  pierEnd: number
}

export function layout(w: number, h: number): SceneLayout {
  const ox = Math.floor((w - SCENE_W) / 2)
  const oy = Math.floor((h - SCENE_H) / 2)
  return { ox, oy, playerX: ox + PLAYER_X, playerY: oy + PLAYER_Y, pierX: ox + PIER_X, pierEnd: oy + PIER_END }
}

type Box = { x: number; y: number; w: number; h: number }
const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** 물고기 그림자가 헤엄치는 가로 줄 */
type Lane = { y: number; speed: number; offset: number }
type World = { w: number; h: number; L: SceneLayout; posts: number[]; rocks: [number, number][]; lanes: Lane[] }

const ROCK_W = 14
const ROCK_H = 9
const SHADOW_H = 5
/** 그림자 줄 하나가 차지하는 대략의 높이. 장면이 길어지면 줄이 늘어난다. */
const LANE_SPACING = 55
const LANE_SPEEDS = [9, 6, 7.5, 5, 8, 6.5]
/** 바위 후보 자리(전체 영역 비율). 앞에서부터 막히지 않은 자리를 쓴다. 처음 둘은 원래 160×240 장면의 바위 자리다. */
const ROCK_SPOTS: [number, number][] = [
  [0.07, 0.65], [0.92, 0.85], [0.05, 0.32], [0.95, 0.45], [0.25, 0.93], [0.75, 0.62], [0.15, 0.5],
  [0.85, 0.25], [0.35, 0.75], [0.65, 0.95], [0.03, 0.8], [0.97, 0.7], [0.3, 0.4], [0.7, 0.38],
  [0.12, 0.2], [0.88, 0.92],
]
const ROCK_NUDGE = [0, -8, 8, -16, 16]

/** 부두 기둥 y: 40px 간격으로 내려가고, 마지막은 늘 부두 끝 바로 위 */
function postYs(pierEnd: number): number[] {
  const last = pierEnd - POST_H
  const ys: number[] = []
  for (let y = 24; y < last - 20; y += POST_GAP) ys.push(y)
  ys.push(last)
  return ys
}

/** 그림자 줄은 부두 끝 아래 물에만 둔다(부두·모래 위로 지나가지 않게). */
function laneLayout(L: SceneLayout, h: number): Lane[] {
  const top = L.oy + PIER_BOTTOM + 8
  const bottom = h - 6 - SHADOW_H
  const n = Math.max(2, Math.floor((h - top) / LANE_SPACING))
  return Array.from({ length: n }, (_, i) => ({
    y: Math.round(top + ((i + 0.5) * (bottom - top)) / n),
    speed: LANE_SPEEDS[i % LANE_SPEEDS.length],
    offset: 30 + i * 90,
  }))
}

/** 바위는 모래·부두·찌 자리·대결 트랙·그림자 줄·다른 바위와 겹치지 않는 후보 자리에 놓는다. */
function rockLayout(w: number, h: number, L: SceneLayout, lanes: Lane[]): [number, number][] {
  const want = Math.max(2, Math.round((w * h) / 30000))
  const blocked: Box[] = [
    { x: 0, y: 0, w, h: SHORE_BOTTOM + 3 },
    { x: L.pierX - POST_W - 4, y: 0, w: PIER_W + 2 * POST_W + 8, h: L.oy + PIER_BOTTOM + 4 },
    { x: L.ox + BOBBER_X - 14, y: L.pierEnd, w: 28, h: h - L.pierEnd },
    { x: L.ox + TRACK_X - 3, y: L.oy + TRACK_Y - 3, w: METER_X + METER_W - TRACK_X + 6, h: TRACK_H + 6 },
    ...lanes.map((l) => ({ x: 0, y: l.y - 3, w, h: SHADOW_H + 6 })),
  ]
  const rocks: [number, number][] = []
  for (const [fx, fy] of ROCK_SPOTS) {
    if (rocks.length >= want) break
    const x = Math.round(fx * (w - ROCK_W))
    for (const dy of ROCK_NUDGE) {
      const y = Math.round(fy * (h - ROCK_H)) + dy
      if (y + ROCK_H > h - 2) continue
      const box = { x: x - 2, y: y - 2, w: ROCK_W + 4, h: ROCK_H + 4 }
      if (blocked.some((b) => overlaps(box, b))) continue
      rocks.push([x, y])
      blocked.push(box)
      break
    }
  }
  return rocks
}

function makeWorld(w: number, h: number): World {
  const L = layout(w, h)
  const lanes = laneLayout(L, h)
  return { w, h, L, posts: postYs(L.pierEnd), rocks: rockLayout(w, h, L, lanes), lanes }
}

// ── 배경 ─────────────────────────────────────────────────────────

/** 물 타일 두 장 중 지금 것(0/1). 파도 거품도 같은 박자로 움직인다. */
function waterFrame(tMs: number): number {
  return ((Math.floor(tMs / WATER_FRAME_MS) % 2) + 2) % 2
}

function drawWater(ctx: CanvasRenderingContext2D, w: number, h: number, k: number): void {
  for (let ty = 0; ty * TILE < h; ty++) {
    for (let tx = 0; tx * TILE < w; tx++) {
      // 칸마다 위상을 어긋나게 해서 물결이 한꺼번에 깜빡이지 않게
      const f = (k + tx + ty * 3) % 2
      drawSprite(ctx, f === 0 ? 'water-0' : 'water-1', tx * TILE, ty * TILE, 1)
    }
  }
}

const SAND_SPECKS: [number, number][] = [[9, 3], [27, 8], [44, 4], [113, 6], [131, 2], [148, 9], [21, 11], [139, 11]]

function drawShore(ctx: CanvasRenderingContext2D, world: World, k: number): void {
  const { w, L } = world
  rect(ctx, 0, 0, w, SAND_H, C.sand)
  // 모래 알갱이 무늬는 160px마다 되풀이하고, 안전 상자 안은 원래 장면과 같게 맞춘다
  for (let base = L.ox - Math.ceil(L.ox / SCENE_W) * SCENE_W; base < w; base += SCENE_W) {
    for (const [x, y] of SAND_SPECKS) if (base + x >= 0 && base + x < w) rect(ctx, base + x, y, 2, 1, C.sandDark)
  }
  rect(ctx, 0, SAND_H, w, 2, C.sandWet)
  // 파도 거품: 500ms마다 한 칸 밀린다
  for (let x = -8 + k * 4; x < w; x += 8) rect(ctx, x, SAND_H + 2, 5, 1, C.foam)
}

function drawPier(ctx: CanvasRenderingContext2D, world: World): void {
  const { pierX: x, pierEnd: end } = world.L
  // 부두가 물 위에 드리우는 그늘(오른쪽·아래)
  rect(ctx, x + PIER_W, SAND_H, 3, end - SAND_H + PIER_FACE, C.shadow)
  rect(ctx, x + 2, end + PIER_FACE, PIER_W + 1, 3, C.shadow)
  for (const y of world.posts) {
    drawSprite(ctx, 'pier-post', x - POST_W, y, 1)
    drawSprite(ctx, 'pier-post', x + PIER_W, y, 1)
  }
  for (let y = end - TILE; y > -TILE; y -= TILE) {
    drawSprite(ctx, 'pier-plank', x, y, 1)
    drawSprite(ctx, 'pier-plank', x + TILE, y, 1)
  }
  // 부두 끝 옆면
  rect(ctx, x, end, PIER_W, PIER_FACE, C.pierFace)
  rect(ctx, x, end + PIER_FACE - 1, PIER_W, 1, C.pierFaceDark)
  rect(ctx, x - 1, 0, 1, end + PIER_FACE, C.outline)
  rect(ctx, x + PIER_W, 0, 1, end + PIER_FACE, C.outline)
}

/** 움직이지 않는 배경 전부(물 타일 k번 장). */
function drawStatic(ctx: CanvasRenderingContext2D, world: World, k: number): void {
  drawWater(ctx, world.w, world.h, k)
  for (const [x, y] of world.rocks) drawSprite(ctx, 'rock', x, y, 1)
  drawShore(ctx, world, k)
  drawPier(ctx, world)
}

/** 천천히 헤엄치는 물고기 그림자(화면 밖으로 나가면 반대편에서 다시). 줄이 바위·부두와 겹치지 않아 배경 위에 그려도 된다. */
function drawShadows(ctx: CanvasRenderingContext2D, world: World, tMs: number): void {
  const span = world.w + 20
  for (const lane of world.lanes) {
    const x = world.w - ((((tMs * lane.speed) / 1000 + lane.offset) % span) + span) % span
    drawSprite(ctx, 'fish-shadow', Math.round(x), lane.y, 1)
  }
}

/**
 * 크기별 배경 캐시: 물 타일 두 장 각각에 맞춘 정적 배경을 오프스크린 캔버스 두 개에 한 번 그려 둔다.
 * 오프스크린 2D 컨텍스트를 못 얻으면(jsdom 등) frames 없이 매 프레임 직접 그린다.
 */
type Background = { world: World; frames: [HTMLCanvasElement, HTMLCanvasElement] | null }
let background: Background | null = null

function renderFrames(world: World): [HTMLCanvasElement, HTMLCanvasElement] | null {
  if (typeof document === 'undefined') return null
  const frames: HTMLCanvasElement[] = []
  for (const k of [0, 1]) {
    const c = document.createElement('canvas')
    c.width = world.w
    c.height = world.h
    const cx = c.getContext('2d')
    if (!cx) return null
    cx.imageSmoothingEnabled = false
    drawStatic(cx, world, k)
    frames.push(c)
  }
  return [frames[0], frames[1]]
}

function backgroundFor(w: number, h: number): Background {
  if (background && background.world.w === w && background.world.h === h) return background
  const world = makeWorld(w, h)
  background = { world, frames: renderFrames(world) }
  return background
}

function bobberY(castPower: number): number {
  const p = Math.min(1, Math.max(0, castPower))
  return Math.round(BOBBER_MIN_Y + p * (BOBBER_MAX_Y - BOBBER_MIN_Y))
}

function poseFor(phase: Phase): string {
  if (phase === 'charging') return 'player-cast'
  if (phase === 'waiting' || phase === 'bite' || phase === 'fighting') return 'player-reel'
  return 'player-idle'
}

function drawGauge(ctx: CanvasRenderingContext2D, gauge: number): void {
  const w = 30
  const x = PLAYER_X + 8 - w / 2
  const y = PLAYER_Y - 10
  rect(ctx, x - 1, y - 1, w + 2, 7, C.outline)
  rect(ctx, x, y, w, 5, C.gaugeBg)
  const g = Math.min(1, Math.max(0, gauge))
  const fill = Math.round(g * w)
  const color = g < 0.5 ? C.gaugeLow : g < 0.85 ? C.gaugeMid : C.gaugeHigh
  if (fill > 0) {
    rect(ctx, x, y, fill, 5, color)
    rect(ctx, x, y, fill, 1, C.gaugeShine)
  }
  // 눈금 4칸
  for (let i = 1; i < 4; i++) rect(ctx, x + Math.round((w * i) / 4), y + 3, 1, 2, C.outline)
}

function drawTrack(ctx: CanvasRenderingContext2D, bar: Bar, params: BarParams, tMs: number): void {
  const inner = TRACK_INNER
  // 틀
  rect(ctx, TRACK_X - 1, TRACK_Y - 1, TRACK_W + 2, TRACK_H + 2, C.outline)
  rect(ctx, TRACK_X, TRACK_Y, TRACK_W, TRACK_H, C.trackWood)
  rect(ctx, TRACK_X, TRACK_Y, TRACK_W, 1, C.trackWoodLight)
  rect(ctx, TRACK_X, TRACK_Y, 1, TRACK_H, C.trackWoodLight)
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

  // 진행 게이지(트랙 오른쪽, 아래에서 차오름)
  rect(ctx, METER_X - 1, TRACK_Y - 1, METER_W + 2, TRACK_H + 2, C.outline)
  rect(ctx, METER_X, TRACK_Y, METER_W, TRACK_H, C.gaugeBg)
  const p = Math.min(1, Math.max(0, bar.progress))
  const ph = Math.round(p * TRACK_H)
  const pc = p < 0.3 ? C.progLow : p < 0.65 ? C.progMid : C.progHigh
  if (ph > 0) {
    rect(ctx, METER_X, TRACK_Y + TRACK_H - ph, METER_W, ph, pc)
    rect(ctx, METER_X, TRACK_Y + TRACK_H - ph, 1, ph, C.gaugeShine)
  }
}

/**
 * 장면 한 프레임. size는 캔버스의 논리 크기(최소 160×240)다.
 * 배경은 w×h 전체에, 게임 요소는 가운데 160×240 안전 상자 안에 그린다.
 */
export function drawScene(ctx: CanvasRenderingContext2D, s: SceneState, size: SceneSize): void {
  const w = Math.max(SCENE_W, Math.floor(size.w) || 0)
  const h = Math.max(SCENE_H, Math.floor(size.h) || 0)
  ctx.imageSmoothingEnabled = false
  const bg = backgroundFor(w, h)
  const k = waterFrame(s.tMs)
  if (bg.frames) ctx.drawImage(bg.frames[k], 0, 0)
  else drawStatic(ctx, bg.world, k)
  drawShadows(ctx, bg.world, s.tMs)

  ctx.save()
  ctx.translate(bg.world.L.ox, bg.world.L.oy)
  try {
    drawForeground(ctx, s)
  } finally {
    ctx.restore()
  }
}

/** 안전 상자 좌표(0~160 × 0~240)로 그리는 게임 요소 */
function drawForeground(ctx: CanvasRenderingContext2D, s: SceneState): void {
  const t = s.tMs
  const pose = poseFor(s.phase)
  const shake = s.phase === 'fighting' ? (Math.floor(t / 90) % 2 === 0 ? -1 : 1) : 0
  const px = PLAYER_X + shake
  const by = bobberY(s.castPower)
  const bx = BOBBER_X

  // 물 위 요소(찌·고리·물보라)는 캐릭터·줄보다 먼저
  if (s.phase === 'waiting') {
    const r = 3 + ((t % 1400) / 1400) * 7
    ripple(ctx, bx, by + 7, r, C.ripple)
  } else if (s.phase === 'bite') {
    ripple(ctx, bx, by + 7, 4 + ((t % 500) / 500) * 4, C.ripple)
    ripple(ctx, bx, by + 7, 9 + ((t % 500) / 500) * 4, C.foam)
  } else if (s.phase === 'lost') {
    ripple(ctx, bx, by + 6, 5 + ((t % 1200) / 1200) * 8, C.ripple)
  }

  // 캐릭터 발밑 그림자
  rect(ctx, PLAYER_X + 2, PLAYER_Y + 22, 12, 3, C.shadowDeck)
  drawSprite(ctx, pose, px, PLAYER_Y, 1)

  const [tipX, tipY] = ROD_TIP[pose]
  const rodX = px + tipX
  const rodY = PLAYER_Y + tipY

  if (s.phase === 'waiting' || s.phase === 'bite') {
    const bob = s.phase === 'waiting' ? Math.floor(t / WATER_FRAME_MS) % 2 : 2 // 입질 때는 쑥 잠긴다
    line(ctx, rodX, rodY, bx, by + bob, C.line)
    drawSprite(ctx, 'bobber', bx - 3, by + bob, 1)
    if (s.phase === 'bite') {
      const hop = Math.floor(t / 120) % 2
      drawSprite(ctx, 'bang', bx + 6, by - 24 - hop, 2)
    }
  } else if (s.phase === 'fighting') {
    // 찌는 물속, 줄 끝에서 물보라가 좌우로 튄다
    const fx = bx + Math.round(Math.sin(t / 260) * 6)
    ripple(ctx, fx, by + 5, 6 + ((t % 400) / 400) * 3, C.ripple)
    line(ctx, rodX, rodY, fx, by + 4, C.line)
    drawSprite(ctx, 'splash', fx - 4, by + 1 + (Math.floor(t / 120) % 2), 1)
  } else if (s.phase === 'lost') {
    // 끊어진 줄이 낚싯대 끝에서 늘어진다
    line(ctx, rodX, rodY, rodX + 2, rodY + 6, C.line)
    line(ctx, rodX + 2, rodY + 6, rodX + 1, rodY + 11, C.line)
    drawSprite(ctx, 'sweat', px - 2, PLAYER_Y + 4 + (Math.floor(t / 300) % 2), 1)
  }

  if (s.phase === 'charging') drawGauge(ctx, s.gauge)

  if (s.phase === 'fighting' && s.bar && s.barParams) drawTrack(ctx, s.bar, s.barParams, t)

  if (s.phase === 'caught' && s.caughtSpecies && SPRITES[`fish-${s.caughtSpecies}`]) {
    // 잡은 물고기를 머리 위로 2배 크기로 들어 보인다
    const fx = PLAYER_X + 8 - 16
    const fy = PLAYER_Y - 36 - (Math.floor(t / 400) % 2)
    drawSprite(ctx, `fish-${s.caughtSpecies}`, fx, fy, 2)
    const blink = Math.floor(t / 250) % 2
    drawSprite(ctx, 'sparkle', fx - 6, fy + (blink ? 2 : 8), 1)
    drawSprite(ctx, 'sparkle', fx + 33, fy + (blink ? 10 : 4), 1)
    if (blink) drawSprite(ctx, 'sparkle', fx + 14, fy - 6, 1)
  }
}

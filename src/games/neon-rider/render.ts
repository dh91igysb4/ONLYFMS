// 네온 라이더 캔버스 2D 그리기(설계 §7). 시뮬은 읽기만 한다. React를 쓰지 않는다.
// 좌표: 시뮬 u(1/16 mm, y 위) → 화면 CSS px(y 아래). 캔버스 내부 색은 theme 토큰 규칙의 승인된 예외다.
// 입자·팝업은 화면 전용 상태로, 연속한 render 호출 사이의 SimState 변화(lastAward.tick, gems, dead)로 만든다.
// 화면 전용이라 부동소수와 Math.random을 쓴다(결정성은 sim.ts의 몫).
import { wakeBlock } from './blocks.ts'
import type { BlockState } from './blocks.ts'
import { CAR_LEN, MM, PERFECT_MULT, SUBSTEPS, VIEW_CARS, WHEELBASE, WHEEL_R } from './constants.ts'
import { carById } from './cars.ts'
import type { Box } from './collide.ts'
import type { Course } from './course.ts'
import { bladeAngles, shapeAt } from './hazards.ts'
import { moverSegsAt } from './movers.ts'
import type { Seg } from './pieces.ts'
import { moverRuns, scoreOf } from './sim.ts'
import { TURN } from './trig.ts'
import type { SimState } from './sim.ts'

export type Camera = { x: number; y: number; scale: number } // (x, y): 화면 기준점에 오는 세계 좌표. scale: px / u

// 카메라 기준점: 차 중심 아래의 길이 화면 가로 28%, 세로 53%에 온다 [M14].
const ANCHOR_X = 0.28
const ANCHOR_Y = 0.53
const CAM_EASE = 0.12 // 60 fps 한 프레임(CAM_FRAME_MS)마다 세로 목표까지 남은 거리 중 줄이는 비율. 프레임 간격에 맞춰 1 − (1 − CAM_EASE)^(dt/CAM_FRAME_MS)로 바꿔 쓴다
const CAM_FRAME_MS = 1000 / 60
const CAM_MAX_DT_MS = 100 // 탭이 오래 멈췄다 돌아온 프레임에서 한 번에 너무 많이 따라가지 않게
const CAR_TOP_LIMIT = 0.16 // 차가 화면 위아래 이 비율 안쪽에 머물도록 세로를 당긴다
const CAR_BOTTOM_LIMIT = 0.86
const PARALLAX = [0.15, 0.3] // 먼 층, 가까운 층

const FONT_STACK = "'Pretendard Variable', Pretendard, system-ui, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"

const SKY_TOP = '#7c2fd4'
const SKY_MID = '#3a1673'
const SKY_BOTTOM = '#0c0720'
const FAR_BLOCK = 'rgba(40, 14, 92, 0.55)'
const NEAR_BLOCK = 'rgba(22, 10, 52, 0.8)'
const TRACK_GLOW = 'rgba(255, 60, 190, 0.3)'
const TRACK_CORE = '#ffd6f2'
const TRACK_MID = '#ff4fc3'
const YELLOW = '#ffe14a'
const CAR_BODY = '#ffd93a'
const CAR_DARK = '#3b1d5c'
const WHITE = '#ffffff'
const TIRE = '#14121c'
// 위험물(빨강), 움직이는 길(노랑·초록 고리), 블록(흰 윤곽): 캔버스 내부 색 예외.
const HAZ_RED = '#ff3355'
const HAZ_GLOW = 'rgba(255, 51, 85, 0.3)'
const HAZ_CORE = '#ffc2cc'
const MOVER_GLOW = 'rgba(255, 225, 74, 0.3)'
const MOVER_CORE = '#fff6c0'
const GREEN = '#39ff88'
const GREEN_GLOW = 'rgba(57, 255, 136, 0.3)'
const GREEN_CORE = '#d4ffe6'
const BLOCK_FILL = 'rgba(255, 255, 255, 0.16)'
const BLOCK_GLOW = 'rgba(255, 255, 255, 0.28)'
const TAU = Math.PI * 2

const POPUP_MS = 900
const PRAISE_MS = 800
const DEATH_PARTICLES = 24
const GEM_PARTICLES = 8

// 차 옆모습(mm). a: 뒷바퀴 중심에서 앞바퀴 쪽, b: 축선에서 위. 실제 차 비율(쿠페 지붕 꼭대기 580 mm).
// 판정은 두 바퀴(반지름 180)·지붕 원(축 가운데 위 headOffset, 반지름 headR)·차대 캡슐(축선을 bodyDY 올린 선분, 반지름 bodyR)이고 차마다 cars.ts 값이다.
// 그림의 모든 가장자리는 그 차의 이 합집합에서 40 mm 안에 둔다(render.test가 차마다 변마다 표본을 잡아 확인한다).
// 쿠페의 꼬리~앞끝은 녹화의 2000 mm(CAR_LEN, 화면 축척 단위)보다 짧은 약 1815 mm다.
export type CarArt = readonly (readonly [number, number])[]
export const CAR_ART: Record<string, CarArt> = {
  // 쿠페: 트렁크·보닛은 캡슐 위 끝(360), 실내는 지붕 원(580)
  coupe: [[-180, 40], [-200, 210], [-150, 330], [350, 370], [470, 480], [600, 572], [830, 572], [960, 460], [1060, 385], [1460, 330], [1595, 210], [1590, 60], [1450, 25]],
  // 픽업: 뒤 짐칸(평평, 410) + 높은 운전석(700) + 보닛
  pickup: [[-180, 40], [-175, 330], [-110, 400], [400, 425], [450, 625], [550, 700], [860, 700], [970, 590], [1010, 432], [1480, 415], [1595, 270], [1590, 60], [1450, 25]],
  // 버기: 낮은 통 차체(지붕 없음). 롤케이지 막대는 CAR_BARS
  buggy: [[-150, 30], [-160, 260], [-100, 300], [450, 300], [1450, 280], [1560, 180], [1520, 30]],
  // 스포츠카: 낮고 긴 쐐기에 꼬리 립, 둥근 실내
  sports: [[-140, 40], [-155, 190], [-120, 280], [-40, 305], [430, 310], [510, 400], [620, 475], [800, 475], [920, 400], [1040, 320], [1450, 245], [1550, 135], [1500, 20]],
  // F1: 얇은 차체, 조종석 턱(헬멧), 뾰족한 코와 앞날개, 꼬리 뒷날개
  f1: [[-110, 30], [-150, 110], [-150, 150], [-100, 190], [-30, 212], [10, 175], [150, 120], [500, 115], [600, 170], [635, 225], [645, 335], [755, 335], [780, 240], [800, 170], [900, 110], [1350, 70], [1560, 45], [1540, -10], [1440, -10]],
  // 스케이트보드: 얇은 판과 위로 휜 양 끝
  skate: [[-120, 70], [-110, 160], [1420, 160], [1520, 100], [1490, 40], [1400, 80], [0, 80], [-80, 40]],
}
// 롤케이지 막대(차 id → 꺾은선 목록). 굵은 선으로 그려 사이가 비어 보인다. 판정 합집합에서 40 mm 안.
export const CAR_BARS: Record<string, readonly CarArt[]> = {
  buggy: [[[490, 300], [560, 470], [840, 470], [920, 300]], [[700, 470], [700, 300]]],
}
// 차마다 네온 색(캔버스 내부 색 예외). 평평한 단색 + 같은 색 빛 번짐 두 겹 + 흰 데칼 + 흰 바퀴.
export const CAR_COLOR: Record<string, string> = {
  coupe: '#fff23a',
  pickup: '#39ff88',
  buggy: '#ff8a1f',
  sports: '#ff2bd6',
  f1: '#b46bff',
  skate: '#00e5ff',
}
// 흰 데칼(차 id → 다각형, 차 그림 안). 번개·사선 한 줄.
export const CAR_DECAL: Record<string, CarArt> = {
  coupe: [[100, 150], [800, 240], [650, 265], [1350, 240], [400, 190], [550, 180]],
  pickup: [[0, 200], [700, 270], [580, 295], [1350, 270], [300, 230], [450, 220]],
  buggy: [[0, 150], [600, 210], [500, 225], [1250, 200], [300, 175], [420, 168]],
  sports: [[100, 120], [700, 200], [580, 220], [1250, 190], [350, 160], [480, 150]],
  f1: [[200, 60], [700, 90], [620, 100], [1100, 75], [400, 75], [480, 70]],
  skate: [[0, 112], [1400, 112], [1400, 128], [0, 128]],
}
// 유리창(차 id → 다각형). 없으면 안 그린다.
export const CAR_WINDOW: Record<string, CarArt> = {
  coupe: [[480, 395], [610, 540], [820, 540], [935, 440], [1000, 395]],
  pickup: [[470, 450], [570, 660], [840, 660], [990, 460]],
  sports: [[520, 330], [630, 445], [790, 445], [930, 330]],
  f1: [[655, 190], [665, 300], [735, 300], [745, 190]],
}

const PRAISE: readonly (readonly string[])[] = [
  ['nice!', 'clean!'],
  ['double!', 'so smooth!'],
  ['triple!'],
  ['unreal!', 'dizzy yet?'],
]

export function praiseFor(flips: number, perfect: boolean, tick: number): string {
  const list = PRAISE[Math.min(PRAISE.length, Math.max(1, flips)) - 1]
  const word = list[Math.abs(Math.floor(tick)) % list.length]
  return perfect ? `perfect ${word}` : word
}

// 위험물 바깥선(세계 좌표 u, y 위, 화면 전용 부동소수). 판정 경계(원·캡슐)와 45 mm 안에 긋는다:
// 판정 경계의 모든 점이 그린 선에서, 그린 선의 모든 점이 판정 경계에서 45 mm 안이다(설계 §5.4, render.test가 표본으로 확인).
// 톱니·가시의 끝은 판정 경계 + HAZ_TEETH, 골은 − HAZ_TEETH. 그래서 이빨이 얕고, 모양은 안쪽 장식선으로 보여 준다.
const HAZ_TEETH = 40 * MM
const SAW_PITCH = 300 * MM // 톱니 하나(끝 → 끝)의 둘레 길이 목표
const SPIKE_PITCH = 200 * MM // 가시 하나의 밑변 길이 목표
const CAP_STEPS = 8 // 캡슐 반원을 나누는 수
type Pt = [number, number]

/** 톱니 원반: 중심 (x, y), 판정 반지름 r. spin은 화면 전용 회전(라디안). */
export function sawOutline(x: number, y: number, r: number, spin: number): Pt[] {
  const teeth = Math.max(12, Math.round((TAU * r) / SAW_PITCH))
  const out: Pt[] = []
  for (let i = 0; i < teeth * 2; i++) {
    const a = spin + (i * Math.PI) / teeth
    const rr = i % 2 === 0 ? r + HAZ_TEETH : Math.max(0, r - HAZ_TEETH)
    out.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr])
  }
  return out
}

// 막대 (x0, y0)–(x1, y1)의 단위 방향 u와, 위(세계 y +)를 향하는 수직 n.
function barFrame(x0: number, y0: number, x1: number, y1: number): { len: number; ux: number; uy: number; nx: number; ny: number } {
  const len = Math.hypot(x1 - x0, y1 - y0)
  const ux = len > 0 ? (x1 - x0) / len : 1
  const uy = len > 0 ? (y1 - y0) / len : 0
  let nx = -uy
  let ny = ux
  if (ny < 0 || (ny === 0 && nx < 0)) {
    nx = -nx
    ny = -ny
  }
  return { len, ux, uy, nx, ny }
}

// 중심 (cx, cy), 반지름 r의 반원: 방향 (ax, ay)에서 시작해 (dx, dy) 쪽을 지나 반대 방향까지(양 끝 포함).
function halfCircle(cx: number, cy: number, r: number, ax: number, ay: number, dx: number, dy: number): Pt[] {
  const out: Pt[] = []
  for (let k = 0; k <= CAP_STEPS; k++) {
    const t = (k * Math.PI) / CAP_STEPS
    const c = Math.cos(t)
    const sn = Math.sin(t)
    out.push([cx + (ax * c + dx * sn) * r, cy + (ay * c + dy * sn) * r])
  }
  return out
}

/** 가시 띠: 판정 캡슐(막대 둘레 r) 전체를 채우고, 위쪽 가장자리만 톱날로 긋는다. */
export function spikeOutline(x0: number, y0: number, x1: number, y1: number, r: number): Pt[] {
  const { len, ux, uy, nx, ny } = barFrame(x0, y0, x1, y1)
  const out: Pt[] = [[x0 - nx * r, y0 - ny * r]]
  // 아래 변 → 끝 (x1, y1) 쪽 반원(아래 → 앞 → 위) → 위 톱날(뒤로) → 시작 (x0, y0) 쪽 반원(위 → 뒤 → 아래)
  out.push(...halfCircle(x1, y1, r, -nx, -ny, ux, uy))
  const m = Math.max(1, Math.round(len / SPIKE_PITCH))
  for (let i = 1; i < 2 * m; i++) {
    const t = len - (i * len) / (2 * m)
    const off = i % 2 === 1 ? r + HAZ_TEETH : r - HAZ_TEETH
    out.push([x0 + ux * t + nx * off, y0 + uy * t + ny * off])
  }
  out.push(...halfCircle(x0, y0, r, nx, ny, -ux, -uy))
  return out
}

/** 창: 밑 (x0, y0)은 판정 캡슐처럼 둥글고, 폭 2r의 자루가 끝 (x1, y1)까지 간 뒤 캡슐 끝 반원의 45° 어깨를 지나 끝 + r + HAZ_TEETH에서 뾰족해진다. */
export function spearOutline(x0: number, y0: number, x1: number, y1: number, r: number): Pt[] {
  const len = Math.hypot(x1 - x0, y1 - y0)
  const ux = len > 0 ? (x1 - x0) / len : 1
  const uy = len > 0 ? (y1 - y0) / len : 0
  const nx = -uy
  const ny = ux
  const d = r * Math.SQRT1_2
  return [
    [x1 + nx * r, y1 + ny * r],
    [x1 + (ux + nx) * d, y1 + (uy + ny) * d],
    [x1 + ux * (r + HAZ_TEETH), y1 + uy * (r + HAZ_TEETH)],
    [x1 + (ux - nx) * d, y1 + (uy - ny) * d],
    [x1 - nx * r, y1 - ny * r],
    ...halfCircle(x0, y0, r, -nx, -ny, -ux, -uy),
  ]
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function scaleFor(widthPx: number): number {
  return widthPx / (VIEW_CARS * CAR_LEN)
}

export function toScreen(cam: Camera, widthPx: number, heightPx: number, x: number, y: number): { x: number; y: number } {
  return { x: widthPx * ANCHOR_X + (x - cam.x) * cam.scale, y: heightPx * ANCHOR_Y - (y - cam.y) * cam.scale }
}

/** dtMs: 직전 카메라(last)를 그린 뒤 지난 시간. 세로 따라가기가 프레임 수가 아니라 시간에 맞춰 움직인다. */
export function cameraFor(prev: SimState, cur: SimState, alpha: number, widthPx: number, heightPx: number, last: Camera | null, dtMs = CAM_FRAME_MS): Camera {
  const scale = scaleFor(widthPx)
  const x = lerp((prev.rear.x + prev.front.x) / 2, (cur.rear.x + cur.front.x) / 2, alpha)
  const carY = lerp((prev.rear.y + prev.front.y) / 2, (cur.rear.y + cur.front.y) / 2, alpha)
  const target = carY - WHEEL_R // 평지라면 차 아래 길
  if (!last) return { x, y: target, scale }
  const ease = 1 - Math.pow(1 - CAM_EASE, Math.max(0, Math.min(CAM_MAX_DT_MS, dtMs)) / CAM_FRAME_MS)
  let y = last.y + (target - last.y) * ease
  // 차가 화면 위·아래 끝으로 밀려나지 않게 당긴다. 목표 쪽으로만 당기므로 목표를 넘지 않는다.
  const carScreenY = heightPx * ANCHOR_Y - (carY - y) * scale
  const minY = heightPx * CAR_TOP_LIMIT
  const maxY = heightPx * CAR_BOTTOM_LIMIT
  if (carScreenY < minY) y = carY - (heightPx * ANCHOR_Y - minY) / scale
  else if (carScreenY > maxY) y = carY - (heightPx * ANCHOR_Y - maxY) / scale
  if ((y - target) * (last.y - target) < 0) y = target
  return { x, y, scale }
}

// 시작 번호에서 앞뒤로 걸으며 x 범위 [xMin, xMax]와 겹치는 선분 번호의 범위를 찾는다.
// 길이 뒤로 휘는 곳(고리)을 놓치지 않도록, 범위에서 SLACK 넘게 벗어난 선분을 만나야 멈춘다.
const RANGE_SLACK = 8 * CAR_LEN
const RANGE_MAX_WALK = 4000
export function visibleSegRange(course: Course, from: number, xMin: number, xMax: number): { lo: number; hi: number } {
  let lo = Infinity
  let hi = -Infinity
  const visible = (g: Seg) => Math.max(g.x0, g.x1) >= xMin && Math.min(g.x0, g.x1) <= xMax
  for (let i = from, n = 0; i >= 0 && n < RANGE_MAX_WALK; i--, n++) {
    const g = course.seg(i)
    if (Math.max(g.x0, g.x1) < xMin - RANGE_SLACK) break
    if (visible(g)) { lo = Math.min(lo, i); hi = Math.max(hi, i) }
  }
  for (let i = from + 1, n = 0; n < RANGE_MAX_WALK; i++, n++) {
    const g = course.seg(i)
    if (Math.min(g.x0, g.x1) > xMax + RANGE_SLACK) break
    if (visible(g)) { lo = Math.min(lo, i); hi = Math.max(hi, i) }
  }
  return lo === Infinity ? { lo: from, hi: from - 1 } : { lo, hi }
}

// 실루엣 블록의 결정적 의사 난수(화면 전용).
function hash(n: number, salt: number): number {
  let h = Math.imul(n ^ Math.imul(salt, 0x9e3779b1), 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

type Particle = { x: number; y: number; vx: number; vy: number; born: number; life: number; size: number }
type Popup = { text: string; born: number } // 차의 현재 화면 위치 옆에 그린다
type Praise = { text: string; born: number }

export type Renderer = {
  resize(widthPx: number, heightPx: number, dpr: number): void
  render(prev: SimState, cur: SimState, alpha: number, course: Course, nowMs: number): void
  dispose(): void
}

/** 차 하나를 그린다(게임 화면·상점 미리보기 공용). R·F는 뒷·앞바퀴 중심 화면 좌표, len은 둘 사이 px, wr은 바퀴 반지름 px. */
export function paintCar(c: CanvasRenderingContext2D, carId: string, R: { x: number; y: number }, F: { x: number; y: number }, len: number, wr: number): void {
  const id = carById(carId).id
  const ux = (F.x - R.x) / (len || 1)
  const uy = (F.y - R.y) / (len || 1)
  const k = (len / WHEELBASE) * MM // px / mm (바퀴 사이 실제 거리에 맞춘다)
  const poly = (pts: CarArt) => {
    c.beginPath()
    pts.forEach(([a, b], i) => {
      const x = R.x + (ux * a + uy * b) * k
      const y = R.y + (uy * a - ux * b) * k
      if (i === 0) c.moveTo(x, y)
      else c.lineTo(x, y)
    })
    c.closePath()
  }
  const col = CAR_COLOR[id] ?? CAR_BODY
  const path = (pts: CarArt) => {
    c.beginPath()
    pts.forEach(([a, b], i) => {
      const x = R.x + (ux * a + uy * b) * k
      const y = R.y + (uy * a - ux * b) * k
      if (i === 0) c.moveTo(x, y)
      else c.lineTo(x, y)
    })
  }
  const bars = CAR_BARS[id] ?? []
  const barW = Math.max(1.5, 50 * k)
  c.lineJoin = 'round'
  c.lineCap = 'round'
  // 빛 번짐: 같은 색 반투명 테두리 두 겹(블러 없이)
  for (const [alpha, mm] of [[0.13, 110], [0.3, 45]] as const) {
    c.globalAlpha = alpha
    c.strokeStyle = col
    c.lineWidth = Math.max(1, mm * k)
    poly(CAR_ART[id])
    c.stroke()
    for (const bar of bars) {
      path(bar)
      c.lineWidth = barW + Math.max(1, mm * k)
      c.stroke()
    }
  }
  c.globalAlpha = 1
  poly(CAR_ART[id])
  c.fillStyle = col
  c.fill()
  for (const bar of bars) {
    path(bar)
    c.strokeStyle = col
    c.lineWidth = barW
    c.stroke()
  }
  if (CAR_WINDOW[id]) {
    poly(CAR_WINDOW[id])
    c.fillStyle = CAR_DARK
    c.fill()
  }
  if (CAR_DECAL[id]) {
    poly(CAR_DECAL[id])
    c.fillStyle = WHITE
    c.fill()
  }
  // 바퀴: 검은 타이어 + 흰 휠 + 차 색 허브, 바깥에만 차 색 반투명 빛 띠
  for (const p of [R, F]) {
    for (const [alpha, f] of [[0.12, 1.3], [0.22, 1.13]] as const) {
      c.globalAlpha = alpha
      c.beginPath()
      c.arc(p.x, p.y, Math.max(2, wr * f), 0, TAU)
      c.fillStyle = col
      c.fill()
    }
    c.globalAlpha = 1
    c.beginPath()
    c.arc(p.x, p.y, Math.max(1.5, wr), 0, TAU)
    c.fillStyle = TIRE
    c.fill()
    c.beginPath()
    c.arc(p.x, p.y, Math.max(1, wr * 0.62), 0, TAU)
    c.fillStyle = WHITE
    c.fill()
    c.beginPath()
    c.arc(p.x, p.y, Math.max(0.8, wr * 0.26), 0, TAU)
    c.fillStyle = col
    c.fill()
  }
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext('2d')
  let disposed = false
  let w = 0
  let h = 0
  let dpr = 1
  let sky: CanvasGradient | null = null

  // 화면 전용 상태. 새 판(코스가 바뀌거나 tick이 줄어듦)이면 비운다.
  let cam: Camera | null = null
  let lastCourse: Course | null = null
  let lastTick = -1
  let lastNow = 0
  let seenAward = -1
  let seenGems = 0
  let seenDead = false
  // 그린 뒤 사라지게 할 보석 id. 시뮬이 충돌 창을 벗어난 id를 takenGems에서 버려도(gemFloor로 다시 줍지 않는다)
  // 여기서는 잊지 않아 주운 보석이 다시 나타나지 않는다. 새 판(reset)에서만 비운다.
  const taken = new Set<number>()
  let particles: Particle[] = []
  let popups: Popup[] = []
  let praise: Praise | null = null

  const reset = (cur: SimState, nowMs: number) => {
    cam = null
    taken.clear()
    particles = []
    popups = []
    praise = null
    seenAward = cur.lastAward ? cur.lastAward.tick : -1
    seenGems = cur.gems
    seenDead = cur.dead !== null
    lastNow = nowMs
  }

  const font = (weight: number, px: number) => `${weight} ${Math.round(px)}px ${FONT_STACK}`

  const burst = (x: number, y: number, n: number, speed: number, life: number, size: number, now: number) => {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2
      const v = speed * (0.35 + Math.random() * 0.65)
      particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + speed * 0.4,
        born: now, life: life * (0.7 + Math.random() * 0.6), size: size * (0.6 + Math.random() * 0.8),
      })
    }
  }

  // 상태 변화로 효과를 만든다.
  const detect = (cur: SimState, nowMs: number) => {
    const cx = (cur.rear.x + cur.front.x) / 2
    const cy = (cur.rear.y + cur.front.y) / 2
    for (const id of cur.takenGems) taken.add(id)
    if (cur.lastAward && cur.lastAward.tick !== seenAward) {
      seenAward = cur.lastAward.tick
      const { flips, perfect, points, tick } = cur.lastAward
      if (points > 0) popups.push({ text: `+${points}`, born: nowMs })
      if (flips > 0) praise = { text: praiseFor(flips, perfect, tick), born: nowMs }
    }
    if (cur.gems > seenGems) burst(cx, cy + WHEEL_R, GEM_PARTICLES * (cur.gems - seenGems), 1.4 * CAR_LEN, 450, 0.05, nowMs)
    seenGems = cur.gems
    if (cur.dead && !seenDead && cur.dead !== 'give_up') burst(cx, cy, DEATH_PARTICLES, 2.6 * CAR_LEN, 1200, 0.08, nowMs)
    seenDead = cur.dead !== null
  }

  const drawBackground = (c: CanvasRenderingContext2D, view: Camera) => {
    if (!sky) {
      sky = c.createLinearGradient(0, 0, 0, h)
      sky.addColorStop(0, SKY_TOP)
      sky.addColorStop(0.55, SKY_MID)
      sky.addColorStop(1, SKY_BOTTOM)
    }
    c.fillStyle = sky
    c.fillRect(0, 0, w, h)
    const carPx = CAR_LEN * view.scale
    for (let layer = 0; layer < PARALLAX.length; layer++) {
      const p = PARALLAX[layer]
      const cell = carPx * (layer === 0 ? 0.8 : 1.2)
      const shift = view.x * view.scale * p
      // 세로도 조금 따라 움직이되 화면 아래를 벗어나지 않게 묶는다.
      const lift = Math.max(-h * 0.08, Math.min(h * 0.08, -view.y * view.scale * p * 0.25))
      const baseTop = h * (layer === 0 ? 0.62 : 0.74) + lift
      const span = h * (layer === 0 ? 0.16 : 0.12)
      c.fillStyle = layer === 0 ? FAR_BLOCK : NEAR_BLOCK
      const first = Math.floor(shift / cell) - 1
      const last = Math.ceil((shift + w) / cell) + 1
      c.beginPath()
      for (let n = first; n <= last; n++) {
        const r = hash(n, layer + 1)
        if (r < 0.12) continue // 틈
        const bw = cell * (0.55 + 0.45 * hash(n, layer + 11))
        const top = baseTop - span * r
        const x = n * cell - shift
        c.rect(x, top, bw, h - top)
        // 계단식 윗단
        if (hash(n, layer + 21) > 0.6) c.rect(x + bw * 0.25, top - span * 0.18, bw * 0.4, span * 0.18)
      }
      c.fill()
    }
  }

  const drawTrack = (c: CanvasRenderingContext2D, view: Camera, course: Course, lo: number, hi: number) => {
    const carPx = CAR_LEN * view.scale
    c.lineJoin = 'round'
    c.lineCap = 'round'
    c.beginPath()
    let penX = 0
    let penY = 0
    for (let i = lo; i <= hi; i++) {
      const g = course.seg(i)
      const a = toScreen(view, w, h, g.x0, g.y0)
      const b = toScreen(view, w, h, g.x1, g.y1)
      if (i === lo || Math.abs(a.x - penX) > 0.5 || Math.abs(a.y - penY) > 0.5) c.moveTo(a.x, a.y)
      c.lineTo(b.x, b.y)
      penX = b.x
      penY = b.y
    }
    // 같은 경로를 세 번 긋는다: 넓고 옅은 빛, 중간 분홍, 가늘고 밝은 심.
    c.strokeStyle = TRACK_GLOW
    c.lineWidth = Math.max(7, carPx * 0.2)
    c.stroke()
    c.strokeStyle = TRACK_MID
    c.lineWidth = Math.max(2.5, carPx * 0.065)
    c.stroke()
    c.strokeStyle = TRACK_CORE
    c.lineWidth = Math.max(1, carPx * 0.025)
    c.stroke()

    // 부스터: 길 위에 놓인 노란 겹화살표(»).
    const s = Math.max(3.5, carPx * 0.07)
    c.strokeStyle = YELLOW
    c.lineWidth = Math.max(1.5, carPx * 0.035)
    c.beginPath()
    for (let i = lo; i <= hi; i++) {
      const g = course.seg(i)
      if (!g.boost) continue
      const a = toScreen(view, w, h, g.x0, g.y0)
      const b = toScreen(view, w, h, g.x1, g.y1)
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len < 1) continue
      const ux = (b.x - a.x) / len
      const uy = (b.y - a.y) / len
      const nx = uy // 화면에서 길의 윗방향
      const ny = -ux
      const step = carPx * 0.42
      for (let d = step * 0.6; d < len - s; d += step) {
        for (const off of [0, s * 1.1]) {
          const tx = a.x + ux * (d + off) + nx * s * 1.4
          const ty = a.y + uy * (d + off) + ny * s * 1.4
          c.moveTo(tx - ux * s + nx * s, ty - uy * s + ny * s)
          c.lineTo(tx, ty)
          c.lineTo(tx - ux * s - nx * s, ty - uy * s - ny * s)
        }
      }
    }
    c.stroke()
  }

  // 움직이는 길: 같은 선분 경로를 세 번 긋는다(넓고 옅은 빛, 본색, 가는 심). 시각은 시뮬과 같은 moverSegsAt.
  const drawMovers = (c: CanvasRenderingContext2D, view: Camera, course: Course, cur: SimState, Tr: number, box: Box) => {
    const runs = moverRuns(cur, course.moversNear(box))
    if (runs.length === 0) return
    const carPx = CAR_LEN * view.scale
    c.lineJoin = 'round'
    c.lineCap = 'round'
    for (const look of ['yellow', 'green'] as const) {
      c.beginPath()
      let any = false
      for (const { m, T0 } of runs) {
        if (m.look !== look) continue
        // 시작 전(T0 이후에야 움직임)에는 처음 자세로 선다.
        const T = T0 === null ? Tr : Math.max(Tr, T0)
        for (const g of moverSegsAt(m, T, T0)) {
          const a = toScreen(view, w, h, g.x0, g.y0)
          const b = toScreen(view, w, h, g.x1, g.y1)
          c.moveTo(a.x, a.y)
          c.lineTo(b.x, b.y)
          any = true
        }
      }
      if (!any) continue
      c.strokeStyle = look === 'green' ? GREEN_GLOW : MOVER_GLOW
      c.lineWidth = Math.max(7, carPx * 0.2)
      c.stroke()
      c.strokeStyle = look === 'green' ? GREEN : YELLOW
      c.lineWidth = Math.max(2.5, carPx * 0.065)
      c.stroke()
      c.strokeStyle = look === 'green' ? GREEN_CORE : MOVER_CORE
      c.lineWidth = Math.max(1, carPx * 0.025)
      c.stroke()
    }
  }

  // 블록: 깨어 있는 것은 prev·cur 꼭짓점 보간, 아직 안 깬 것은 처음 자세. 끝난 것(id가 blocksDone)은 그리지 않는다.
  const drawBlocks = (c: CanvasRenderingContext2D, view: Camera, course: Course, prev: SimState, cur: SimState, alpha: number, box: Box) => {
    const carPx = CAR_LEN * view.scale
    const quads: number[][] = []
    const add = (a: readonly number[], b: readonly number[]) => {
      const q: number[] = []
      for (let i = 0; i < 4; i++) {
        const p = toScreen(view, w, h, lerp(a[4 * i], b[4 * i], alpha), lerp(a[4 * i + 1], b[4 * i + 1], alpha))
        q.push(p.x, p.y)
      }
      if (Math.max(q[0], q[2], q[4], q[6]) < -carPx || Math.min(q[0], q[2], q[4], q[6]) > w + carPx) return
      if (Math.max(q[1], q[3], q[5], q[7]) < -carPx || Math.min(q[1], q[3], q[5], q[7]) > h + carPx) return
      quads.push(q)
    }
    const awake = new Set<number>()
    for (const bs of cur.blocks) {
      awake.add(bs.id)
      const before: BlockState | undefined = prev.blocks.find((x) => x.id === bs.id)
      add((before ?? bs).p, bs.p)
    }
    for (const b of course.blocksNear(box)) {
      if (awake.has(b.id) || cur.blocksDone.includes(b.id)) continue
      const p = wakeBlock(b).p
      add(p, p)
    }
    if (quads.length === 0) return
    c.lineJoin = 'round'
    c.beginPath()
    for (const q of quads) {
      c.moveTo(q[0], q[1])
      c.lineTo(q[2], q[3])
      c.lineTo(q[4], q[5])
      c.lineTo(q[6], q[7])
      c.closePath()
    }
    c.fillStyle = BLOCK_FILL
    c.fill()
    c.strokeStyle = BLOCK_GLOW
    c.lineWidth = Math.max(6, carPx * 0.16)
    c.stroke()
    c.strokeStyle = WHITE
    c.lineWidth = Math.max(1.5, carPx * 0.04)
    c.stroke()
  }

  // 세계 좌표 다각형을 지금 경로에 닫힌 도형으로 더한다.
  const poly = (c: CanvasRenderingContext2D, view: Camera, pts: readonly Pt[]) => {
    for (let i = 0; i < pts.length; i++) {
      const p = toScreen(view, w, h, pts[i][0], pts[i][1])
      if (i === 0) c.moveTo(p.x, p.y)
      else c.lineTo(p.x, p.y)
    }
    c.closePath()
  }

  // 위험물: 모양과 위치는 시뮬과 같은 shapeAt·bladeAngles(시각 Tr). 톱니의 도는 모습만 화면 전용이다.
  const drawHazards = (c: CanvasRenderingContext2D, view: Camera, course: Course, Tr: number, nowMs: number, box: Box) => {
    const carPx = CAR_LEN * view.scale
    c.lineJoin = 'round'
    c.lineCap = 'round'
    for (const z of course.hazardsNear(box)) {
      const sh = shapeAt(z, Tr)
      if (!sh) continue
      const glowW = Math.max(5, carPx * 0.1)
      const coreW = Math.max(1.2, carPx * 0.03)
      let decor: (() => void) | null = null // 바깥선 안쪽의 장식선(본색 위에 심 색으로 긋는다)
      c.beginPath()
      if (sh.s === 'disc') {
        const o = toScreen(view, w, h, sh.x, sh.y)
        const r = sh.r * view.scale
        if (z.look === 'saw') {
          // 바깥선은 판정 원 ± HAZ_TEETH의 얕은 톱니(sawOutline), 도는 큰 톱니 모양은 안쪽 장식선으로 그린다.
          const spin = nowMs / 1500
          poly(c, view, sawOutline(sh.x, sh.y, sh.r, spin))
          decor = () => {
            const teeth = 8
            for (let i = 0; i <= teeth * 2; i++) {
              const ang = spin + (i * Math.PI) / teeth
              const rr = i % 2 === 0 ? r * 0.82 : r * 0.6
              const x = o.x + Math.cos(ang) * rr
              const y = o.y + Math.sin(ang) * rr
              if (i === 0) c.moveTo(x, y)
              else c.lineTo(x, y)
            }
          }
        } else {
          c.moveTo(o.x + r, o.y)
          c.arc(o.x, o.y, r, 0, TAU)
        }
      } else if (sh.s === 'blades') {
        const o = toScreen(view, w, h, sh.x, sh.y)
        const ro = sh.rOut * view.scale
        const ri = sh.rIn * view.scale
        const k = TAU / TURN
        for (const a of bladeAngles(z, Tr)) {
          // 시뮬 각도는 반시계(y 위), 캔버스 각도는 시계(y 아래): 부호를 뒤집는다.
          const a0 = -a * k
          const a1 = -(a + sh.w) * k
          if (sh.w >= TURN) {
            c.moveTo(o.x + ro, o.y)
            c.arc(o.x, o.y, ro, 0, TAU)
            if (ri > 0) {
              c.moveTo(o.x + ri, o.y)
              c.arc(o.x, o.y, ri, 0, TAU, true)
            }
            continue
          }
          if (ri > 0) {
            c.moveTo(o.x + Math.cos(a0) * ro, o.y + Math.sin(a0) * ro)
            c.arc(o.x, o.y, ro, a0, a1, true)
            c.arc(o.x, o.y, ri, a1, a0, false)
          } else {
            c.moveTo(o.x, o.y)
            c.arc(o.x, o.y, ro, a0, a1, true)
          }
          c.closePath()
        }
      } else {
        const A = toScreen(view, w, h, sh.x0, sh.y0)
        const B = toScreen(view, w, h, sh.x1, sh.y1)
        const r = sh.r * view.scale
        const len = Math.hypot(B.x - A.x, B.y - A.y)
        const ux = len > 0 ? (B.x - A.x) / len : 1
        const uy = len > 0 ? (B.y - A.y) / len : 0
        let nx = uy // 화면에서 위쪽을 향하는 막대의 수직 방향
        let ny = -ux
        if (ny > 0 || (ny === 0 && nx < 0)) {
          nx = -nx
          ny = -ny
        }
        if (z.look === 'laser') {
          c.moveTo(A.x, A.y)
          c.lineTo(B.x, B.y)
          c.strokeStyle = HAZ_GLOW
          c.lineWidth = Math.max(5, r * 2 + 4)
          c.stroke()
          c.strokeStyle = HAZ_RED
          c.lineWidth = Math.max(2, r * 2)
          c.stroke()
          c.strokeStyle = HAZ_CORE
          c.lineWidth = Math.max(1, r * 0.8)
          c.stroke()
          continue
        }
        if (z.look === 'spikes') {
          // 바깥선은 판정 캡슐 전체(위쪽만 얕은 톱날, spikeOutline). 큰 삼각형 줄은 안쪽 장식선: 밑변은 아래 가장자리, 꼭짓점은 위 가장자리.
          poly(c, view, spikeOutline(sh.x0, sh.y0, sh.x1, sh.y1, sh.r))
          decor = () => {
            const pitch = Math.max(4, r * 1.6)
            const n = Math.max(1, Math.ceil(len / pitch))
            const step = len / n
            for (let i = 0; i < n; i++) {
              const bx = A.x + ux * step * i - nx * r
              const by = A.y + uy * step * i - ny * r
              if (bx < -step * 2 || bx > w + step * 2 || by < -r * 4 - step || by > h + r * 4 + step) continue
              c.moveTo(bx, by)
              c.lineTo(bx + ux * step * 0.5 + nx * 2 * r, by + uy * step * 0.5 + ny * 2 * r)
              c.lineTo(bx + ux * step, by + uy * step)
            }
          }
        } else if (z.look === 'spear' && len >= 1) {
          // 뾰족한 막대: 판정 캡슐 폭 2r의 자루가 끝까지 가고, 캡슐 끝에서 뾰족해진다(spearOutline).
          poly(c, view, spearOutline(sh.x0, sh.y0, sh.x1, sh.y1, sh.r))
        } else {
          // plain·길이 0: 막대 둘레(캡슐)를 굵은 선으로
          c.moveTo(A.x, A.y)
          c.lineTo(B.x, B.y)
          c.strokeStyle = HAZ_GLOW
          c.lineWidth = Math.max(glowW, r * 2 + glowW)
          c.stroke()
          c.strokeStyle = HAZ_RED
          c.lineWidth = Math.max(2, r * 2)
          c.stroke()
          continue
        }
      }
      c.strokeStyle = HAZ_GLOW
      c.lineWidth = glowW
      c.stroke()
      c.fillStyle = HAZ_RED
      c.fill()
      c.strokeStyle = HAZ_CORE
      c.lineWidth = coreW
      c.stroke()
      if (decor) {
        c.beginPath()
        decor()
        c.stroke()
      }
    }
  }

  const drawGems = (c: CanvasRenderingContext2D, view: Camera, course: Course, lo: number, hi: number, nowMs: number) => {
    if (hi < lo) return
    const carPx = CAR_LEN * view.scale
    const r = Math.max(4, carPx * 0.1) * (1 + 0.12 * Math.sin(nowMs / 160))
    c.fillStyle = YELLOW
    c.beginPath()
    for (const g of course.gemsBetween(lo, hi)) {
      if (taken.has(g.id)) continue
      const p = toScreen(view, w, h, g.x, g.y)
      if (p.x < -r || p.x > w + r || p.y < -r || p.y > h + r) continue
      c.moveTo(p.x, p.y - r)
      c.lineTo(p.x + r * 0.7, p.y)
      c.lineTo(p.x, p.y + r)
      c.lineTo(p.x - r * 0.7, p.y)
      c.closePath()
    }
    c.fill()
  }

  const drawCar = (c: CanvasRenderingContext2D, view: Camera, prev: SimState, cur: SimState, alpha: number) => {
    const car = cur.car
    const R = toScreen(view, w, h, lerp(prev.rear.x, cur.rear.x, alpha), lerp(prev.rear.y, cur.rear.y, alpha))
    const F = toScreen(view, w, h, lerp(prev.front.x, cur.front.x, alpha), lerp(prev.front.y, cur.front.y, alpha))
    const len = Math.hypot(F.x - R.x, F.y - R.y) || 1
    paintCar(c, car, R, F, len, WHEEL_R * view.scale)
  }

  const drawEffects = (c: CanvasRenderingContext2D, view: Camera, car: { x: number; y: number }, nowMs: number, dt: number) => {
    const carPx = CAR_LEN * view.scale
    const g = 5 * CAR_LEN // u/s²
    particles = particles.filter((p) => nowMs - p.born < p.life)
    for (const p of particles) {
      p.vy -= g * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      const s = toScreen(view, w, h, p.x, p.y)
      const t = (nowMs - p.born) / p.life
      const size = Math.max(1.5, p.size * carPx * (1 - t * 0.5))
      c.globalAlpha = 1 - t
      c.fillStyle = YELLOW
      c.fillRect(s.x - size / 2, s.y - size / 2, size, size)
    }
    c.globalAlpha = 1
    popups = popups.filter((p) => nowMs - p.born < POPUP_MS)
    c.textAlign = 'left'
    c.textBaseline = 'middle'
    c.font = font(600, Math.max(16, carPx * 0.4))
    for (const p of popups) {
      const t = (nowMs - p.born) / POPUP_MS
      c.globalAlpha = Math.min(1, (1 - t) * 2.5)
      c.fillStyle = WHITE
      c.fillText(p.text, car.x + carPx * 0.45, car.y - carPx * 0.45 - t * carPx * 0.6)
    }
    c.globalAlpha = 1
    if (praise) {
      const t = (nowMs - praise.born) / PRAISE_MS
      if (t >= 1) praise = null
      else {
        const size = Math.min(w * 0.075, h * 0.05) * (t < 0.12 ? 0.8 + (t / 0.12) * 0.2 : 1)
        c.globalAlpha = t > 0.75 ? (1 - t) / 0.25 : 1
        c.font = font(300, Math.max(16, size))
        c.textAlign = 'left'
        c.fillStyle = WHITE
        c.fillText(praise.text, w * 0.06, h * 0.26)
        c.globalAlpha = 1
      }
    }
  }

  const drawHud = (c: CanvasRenderingContext2D, cur: SimState) => {
    const big = Math.min(w * 0.15, h * 0.1)
    const top = Math.max(14, h * 0.035)
    const score = String(scoreOf(cur))
    c.textBaseline = 'top'
    c.textAlign = 'center'
    c.font = font(200, big)
    c.fillStyle = WHITE
    c.fillText(score, w / 2, top)
    if (cur.pending && cur.pending.flips > 0) {
      const pts = cur.pending.flips * (cur.pending.perfect ? PERFECT_MULT : 1)
      const half = c.measureText(score).width / 2
      c.textAlign = 'left'
      c.font = font(300, big * 0.45)
      c.fillStyle = YELLOW
      c.fillText(`+${pts}`, w / 2 + half + big * 0.15, top + big * 0.12)
    }
    // 오른쪽 위 보석 수
    const small = Math.max(14, big * 0.34)
    const gy = top + small * 0.6
    const gx = w - Math.max(14, w * 0.04)
    c.textAlign = 'right'
    c.textBaseline = 'middle'
    c.font = font(400, small)
    c.fillStyle = WHITE
    const label = String(cur.gems)
    c.fillText(label, gx, gy)
    const dx = gx - c.measureText(label).width - small * 0.55
    const r = small * 0.38
    c.fillStyle = YELLOW
    c.beginPath()
    c.moveTo(dx, gy - r)
    c.lineTo(dx + r * 0.7, gy)
    c.lineTo(dx, gy + r)
    c.lineTo(dx - r * 0.7, gy)
    c.closePath()
    c.fill()
  }

  return {
    resize(widthPx, heightPx, ratio) {
      if (disposed || !ctx) return
      w = widthPx
      h = heightPx
      dpr = ratio
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      sky = null
    },
    render(prev, cur, alpha, course, nowMs) {
      if (disposed || !ctx || w <= 0 || h <= 0) return
      if (course !== lastCourse || cur.tick < lastTick) reset(cur, nowMs)
      lastCourse = course
      lastTick = cur.tick
      const frameMs = nowMs - lastNow
      const dt = Math.max(0, Math.min(0.05, frameMs / 1000))
      lastNow = nowMs
      detect(cur, nowMs)
      const view = cameraFor(prev, cur, alpha, w, h, cam, frameMs)
      cam = view

      const c = ctx
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.globalAlpha = 1
      drawBackground(c, view)
      const margin = CAR_LEN
      const xMin = view.x - (w * ANCHOR_X) / view.scale - margin
      const xMax = view.x + (w * (1 - ANCHOR_X)) / view.scale + margin
      const { lo, hi } = visibleSegRange(course, cur.progress, xMin, xMax)
      drawTrack(c, view, course, lo, hi)
      // 움직이는 것들은 화면 상자(세계 좌표)만 가져온다. 시각 Tr = prev 틱의 부분 틱 + 보간(정수).
      const yMin = view.y - (h * (1 - ANCHOR_Y)) / view.scale - margin
      const yMax = view.y + (h * ANCHOR_Y) / view.scale + margin
      const box: Box = { x0: xMin, y0: yMin, x1: xMax, y1: yMax }
      const Tr = prev.tick * SUBSTEPS + Math.round(alpha * SUBSTEPS)
      drawMovers(c, view, course, cur, Tr, box)
      drawBlocks(c, view, course, prev, cur, alpha, box)
      drawHazards(c, view, course, Tr, nowMs, box)
      drawGems(c, view, course, lo, hi, nowMs)
      if (cur.dead !== 'crash') drawCar(c, view, prev, cur, alpha)
      const car = toScreen(
        view, w, h,
        lerp((prev.rear.x + prev.front.x) / 2, (cur.rear.x + cur.front.x) / 2, alpha),
        lerp((prev.rear.y + prev.front.y) / 2, (cur.rear.y + cur.front.y) / 2, alpha),
      )
      drawEffects(c, view, car, nowMs, dt)
      drawHud(c, cur)
    },
    dispose() {
      disposed = true
      particles = []
      popups = []
      praise = null
    },
  }
}

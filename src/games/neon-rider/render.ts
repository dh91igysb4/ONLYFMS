// 네온 라이더 캔버스 2D 그리기(설계 §7). 시뮬은 읽기만 한다. React를 쓰지 않는다.
// 좌표: 시뮬 u(1/16 mm, y 위) → 화면 CSS px(y 아래). 캔버스 내부 색은 theme 토큰 규칙의 승인된 예외다.
// 입자·팝업은 화면 전용 상태로, 연속한 render 호출 사이의 SimState 변화(lastAward.tick, gems, dead)로 만든다.
// 화면 전용이라 부동소수와 Math.random을 쓴다(결정성은 sim.ts의 몫).
import { MM, PERFECT_MULT, VIEW_CARS, WHEELBASE, WHEEL_R } from './constants.ts'
import type { Course } from './course.ts'
import type { Seg } from './pieces.ts'
import { scoreOf } from './sim.ts'
import type { SimState } from './sim.ts'

export type Camera = { x: number; y: number; scale: number } // (x, y): 화면 기준점에 오는 세계 좌표. scale: px / u

// 차 전체 길이(뒤 꼬리~앞바퀴) 2000 mm [M1]. TODO: constants.ts로 옮긴다(다른 작업이 그 파일을 고치는 중이라 임시로 여기 둔다).
export const CAR_LEN = 2000 * MM

// 카메라 기준점: 차 중심 아래의 길이 화면 가로 28%, 세로 53%에 온다 [M14].
const ANCHOR_X = 0.28
const ANCHOR_Y = 0.53
const CAM_EASE = 0.12 // 프레임마다 세로 목표까지 남은 거리 중 줄이는 비율
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
const WHEEL_FILL = '#160a2c'
const WHITE = '#ffffff'

const POPUP_MS = 900
const PRAISE_MS = 800
const DEATH_PARTICLES = 24
const GEM_PARTICLES = 8

// 차 옆모습(mm). a: 뒷바퀴 중심에서 앞바퀴 쪽, b: 축선에서 위. 지붕 꼭대기 380 mm [M13], 꼬리~앞바퀴 앞끝 2000 mm.
const BODY: readonly (readonly [number, number])[] = [
  [-420, 70], [-410, 250], [140, 360], [430, 380], [880, 250], [1580, 150], [1580, 60],
]
const WINDOW: readonly (readonly [number, number])[] = [[230, 320], [440, 338], [740, 255], [260, 255]]

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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function scaleFor(widthPx: number): number {
  return widthPx / (VIEW_CARS * CAR_LEN)
}

export function toScreen(cam: Camera, widthPx: number, heightPx: number, x: number, y: number): { x: number; y: number } {
  return { x: widthPx * ANCHOR_X + (x - cam.x) * cam.scale, y: heightPx * ANCHOR_Y - (y - cam.y) * cam.scale }
}

export function cameraFor(prev: SimState, cur: SimState, alpha: number, widthPx: number, heightPx: number, last: Camera | null): Camera {
  const scale = scaleFor(widthPx)
  const x = lerp((prev.rear.x + prev.front.x) / 2, (cur.rear.x + cur.front.x) / 2, alpha)
  const carY = lerp((prev.rear.y + prev.front.y) / 2, (cur.rear.y + cur.front.y) / 2, alpha)
  const target = carY - WHEEL_R // 평지라면 차 아래 길
  if (!last) return { x, y: target, scale }
  let y = last.y + (target - last.y) * CAM_EASE
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
type Popup = { x: number; y: number; text: string; born: number }
type Praise = { text: string; born: number }

export type Renderer = {
  resize(widthPx: number, heightPx: number, dpr: number): void
  render(prev: SimState, cur: SimState, alpha: number, course: Course, nowMs: number): void
  dispose(): void
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
      if (points > 0) popups.push({ x: cx, y: cy, text: `+${points}`, born: nowMs })
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
    const R = toScreen(view, w, h, lerp(prev.rear.x, cur.rear.x, alpha), lerp(prev.rear.y, cur.rear.y, alpha))
    const F = toScreen(view, w, h, lerp(prev.front.x, cur.front.x, alpha), lerp(prev.front.y, cur.front.y, alpha))
    const len = Math.hypot(F.x - R.x, F.y - R.y) || 1
    const ux = (F.x - R.x) / len
    const uy = (F.y - R.y) / len
    const k = (len / WHEELBASE) * MM // px / mm (바퀴 사이 실제 거리에 맞춘다)
    const pt = (a: number, b: number): [number, number] => [R.x + (ux * a + uy * b) * k, R.y + (uy * a - ux * b) * k]
    const poly = (pts: readonly (readonly [number, number])[]) => {
      c.beginPath()
      pts.forEach(([a, b], i) => {
        const [x, y] = pt(a, b)
        if (i === 0) c.moveTo(x, y)
        else c.lineTo(x, y)
      })
      c.closePath()
    }
    c.lineJoin = 'round'
    poly(BODY)
    c.fillStyle = CAR_BODY
    c.fill()
    poly(WINDOW)
    c.fillStyle = CAR_DARK
    c.fill()
    const wr = WHEEL_R * view.scale
    c.lineWidth = Math.max(1, wr * 0.32)
    for (const p of [R, F]) {
      c.beginPath()
      c.arc(p.x, p.y, Math.max(1.5, wr - c.lineWidth / 2), 0, Math.PI * 2)
      c.fillStyle = WHEEL_FILL
      c.fill()
      c.strokeStyle = WHITE
      c.stroke()
    }
  }

  const drawEffects = (c: CanvasRenderingContext2D, view: Camera, nowMs: number, dt: number) => {
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
    c.font = font(500, Math.max(13, carPx * 0.28))
    for (const p of popups) {
      const t = (nowMs - p.born) / POPUP_MS
      const s = toScreen(view, w, h, p.x, p.y)
      c.globalAlpha = Math.min(1, (1 - t) * 2.5)
      c.fillStyle = WHITE
      c.fillText(p.text, s.x + carPx * 0.45, s.y - carPx * 0.45 - t * carPx * 0.6)
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
      const dt = Math.max(0, Math.min(0.05, (nowMs - lastNow) / 1000))
      lastNow = nowMs
      detect(cur, nowMs)
      const view = cameraFor(prev, cur, alpha, w, h, cam)
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
      drawGems(c, view, course, lo, hi, nowMs)
      if (cur.dead !== 'crash') drawCar(c, view, prev, cur, alpha)
      drawEffects(c, view, nowMs, dt)
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

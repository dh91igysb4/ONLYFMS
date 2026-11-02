// 양치 캔버스 그리기 (순수 그리기 도우미). 캔버스 안의 색은 테마와 상관없는 고정색이다
// (CLAUDE.md 금지 사항의 예외: 양치 캔버스 내부 색).
// 치아는 mask.ts의 같은 도형 정의(ZONE_SHAPES)로 그린다. 그래서 보이는 치아와 판정 치아가 칸 해상도 안에서 일치한다.
// 그리기는 부동소수를 써도 된다(판정에 쓰이지 않는다).
import { H, LH, LW, MAX_THICK, R, W, CELL } from './constants.ts'
import {
  AXIS, KIND_CANINE, KIND_INCISOR, KIND_MOLAR, KIND_PREMOLAR, ZONE_SHAPES, type Box, type Ellipse,
} from './mask.ts'

const SKIN = '#eab69c'
const SKIN_SHADE = '#d99c82'
const LIP_UP = '#b84f5d'
const LIP_LO = '#d06674'
const LIP_LINE = 'rgba(80, 16, 28, 0.55)'
const MOUTH = '#2a0e15'
const MOUTH_DEEP = '#1a070c'
const GUM = '#e27f88'
const GUM_EDGE = 'rgba(150, 46, 60, 0.55)'
const PALATE = '#e996a0'
const PALATE_DEEP = '#c9707d'
const RIDGE = 'rgba(160, 60, 75, 0.45)'
const TONGUE = '#d66b78'
const TONGUE_DEEP = '#b24f5e'
const TOOTH_HI = '#fffdf8'
const TOOTH_MID = '#f3eee2'
const TOOTH_LO = '#ddd3bd'
const TOOTH_EDGE = 'rgba(110, 80, 60, 0.45)'
const GROOVE = 'rgba(150, 120, 85, 0.55)'
const BRUSH = 'rgba(120, 200, 255, 0.9)'
const PLAQUE: readonly [number, number, number] = [218, 190, 58]

type V = 'front' | 'inner' | 'chew'
const VIEW: readonly V[] = ['front', 'inner', 'chew', 'front', 'inner', 'chew']
/** 씹는 면 구역의 치열 타원(그림용 — mask.ts 치아 배치와 같은 값) [cx, cy, rx, ry] */
const ARCH: Readonly<Record<number, Ellipse>> = { 2: [240, 330, 196, 292], 5: [240, -10, 196, 292] }

/** 두께 → 플라그 불투명도. 얇은 플라그도 보이게 바닥값을 둔다. */
function plaqueAlpha(t: number): number {
  return 0.25 + (0.7 * Math.min(t, MAX_THICK)) / MAX_THICK
}

/** 상자 b의 축 좌표(p: 너비 방향, q: 잇몸→끝 방향)로 변환을 건다. mask.ts inBox의 역변환. */
function enterBox(g: CanvasRenderingContext2D, b: Box): void {
  const [, cx, cy, ax, ay] = b
  const l2 = ax * ax + ay * ay
  const k = AXIS / l2
  g.translate(cx, cy)
  g.transform(k * ay, -k * ax, k * ax, k * ay, 0, 0)
}

/** 축 좌표에서 둥근 상자 경로 (잇몸 쪽 q < 0 반지름 rg, 끝 쪽 re) */
function boxPath(g: CanvasRenderingContext2D, b: Box): void {
  const [, , , , , hw, hh, rg, re] = b
  g.moveTo(-hw + rg, -hh)
  g.lineTo(hw - rg, -hh)
  g.arc(hw - rg, -hh + rg, rg, -Math.PI / 2, 0)
  g.lineTo(hw, hh - re)
  g.arc(hw - re, hh - re, re, 0, Math.PI / 2)
  g.lineTo(-hw + re, hh)
  g.arc(-hw + re, hh - re, re, Math.PI / 2, Math.PI)
  g.lineTo(-hw, -hh + rg)
  g.arc(-hw + rg, -hh + rg, rg, Math.PI, Math.PI * 1.5)
  g.closePath()
}

function addBox(g: CanvasRenderingContext2D, b: Box): void {
  g.save()
  enterBox(g, b)
  boxPath(g, b)
  g.restore()
}

/** 상자 축 좌표 (p, q) → 논리 좌표 */
function boxPoint(b: Box, p: number, q: number): [number, number] {
  const [, cx, cy, ax, ay] = b
  const k = AXIS / (ax * ax + ay * ay)
  return [cx + k * (ay * p + ax * q), cy + k * (-ax * p + ay * q)]
}

function ellipsePath(g: CanvasRenderingContext2D, e: Ellipse): void {
  g.ellipse(e[0], e[1], e[2], e[3], 0, 0, Math.PI * 2)
}

const inE = (e: Ellipse, x: number, y: number) =>
  ((x - e[0]) / e[2]) ** 2 + ((y - e[1]) / e[3]) ** 2 <= 1

type Opening = { a: Ellipse; b: Ellipse; ta: number; tb: number; left: [number, number]; right: [number, number]; top: number; bottom: number }

/** 두 타원의 교집합(입술 안쪽): 중심이 아래인 타원 a의 위쪽 호 + 중심이 위인 타원 b의 아래쪽 호 */
function opening(inside: readonly Ellipse[]): Opening {
  const [a, b] = inside[0][1] > inside[1][1] ? [inside[0], inside[1]] : [inside[1], inside[0]]
  // a의 위쪽 호에서 b를 벗어나는 오른쪽 각 (−π/2 → 0)
  let lo = -Math.PI / 2, hi = 0
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2
    if (inE(b, a[0] + a[2] * Math.cos(m), a[1] + a[3] * Math.sin(m))) lo = m
    else hi = m
  }
  const ta = lo
  const px = a[0] + a[2] * Math.cos(ta), py = a[1] + a[3] * Math.sin(ta)
  const tb = Math.atan2((py - b[1]) / b[3], (px - b[0]) / b[2])
  return { a, b, ta, tb, left: [2 * a[0] - px, py], right: [px, py], top: a[1] - a[3], bottom: b[1] + b[3] }
}

function openingPath(g: CanvasRenderingContext2D, o: Opening): void {
  const { a, b, ta, tb } = o
  g.ellipse(a[0], a[1], a[2], a[3], 0, -Math.PI - ta, ta)
  g.ellipse(b[0], b[1], b[2], b[3], 0, tb, Math.PI - tb)
  g.closePath()
}

/** 입술: 윗입술(큐피드 활 모양)과 아랫입술을 입 둘레에 채운다 */
function drawLips(g: CanvasRenderingContext2D, o: Opening): void {
  const [lx, ly] = o.left, [rx, ry] = o.right
  const cx = (lx + rx) / 2
  const up = o.top - 40, dip = o.top - 30
  const lo = o.bottom + 50
  // 윗입술
  const ug = g.createLinearGradient(0, up, 0, o.top + 20)
  ug.addColorStop(0, LIP_UP)
  ug.addColorStop(1, '#a3434f')
  g.fillStyle = ug
  g.beginPath()
  g.moveTo(lx - 16, ly + 2)
  g.bezierCurveTo(lx + 40, ly - 40, cx - 110, up + 4, cx - 50, up)
  g.quadraticCurveTo(cx - 20, up, cx, dip)
  g.quadraticCurveTo(cx + 20, up, cx + 50, up)
  g.bezierCurveTo(cx + 110, up + 4, rx - 40, ry - 40, rx + 16, ry + 2)
  g.closePath()
  g.fill()
  // 아랫입술
  const lg = g.createLinearGradient(0, o.bottom - 10, 0, lo)
  lg.addColorStop(0, '#b9525f')
  lg.addColorStop(0.4, LIP_LO)
  lg.addColorStop(1, '#c25c69')
  g.fillStyle = lg
  g.beginPath()
  g.moveTo(rx + 16, ry + 2)
  g.bezierCurveTo(rx - 20, lo - 10, cx + 120, lo, cx, lo)
  g.bezierCurveTo(cx - 120, lo, lx + 20, lo - 10, lx - 16, ly + 2)
  g.closePath()
  g.fill()
  // 입술 윤기·입꼬리 그늘
  g.fillStyle = 'rgba(255, 255, 255, 0.18)'
  g.beginPath()
  g.ellipse(cx - 30, (o.bottom + lo) / 2 + 6, 60, 9, -0.05, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = 'rgba(150, 70, 60, 0.35)'
  g.lineWidth = 2
  g.lineCap = 'round'
  g.beginPath()
  g.moveTo(cx - 14, dip - 4)
  g.lineTo(cx - 10, dip - 40)
  g.moveTo(cx + 14, dip - 4)
  g.lineTo(cx + 10, dip - 40)
  g.stroke()
  g.fillStyle = 'rgba(90, 20, 30, 0.6)'
  for (const [x, y, s] of [[lx, ly, -1], [rx, ry, 1]] as const) {
    g.beginPath()
    g.ellipse(x + s * 4, y, 9, 5, 0, 0, Math.PI * 2)
    g.fill()
  }
}

function drawTooth(g: CanvasRenderingContext2D, b: Box, view: V): void {
  const [kind, , , , , hw, hh] = b
  g.save()
  enterBox(g, b)
  g.beginPath()
  boxPath(g, b)
  let fill: CanvasGradient
  if (view === 'chew') {
    fill = g.createRadialGradient(-hw * 0.25, -hh * 0.25, 1, 0, 0, Math.max(hw, hh) * 1.1)
    fill.addColorStop(0, TOOTH_HI)
    fill.addColorStop(0.65, TOOTH_MID)
    fill.addColorStop(1, TOOTH_LO)
  } else {
    fill = g.createLinearGradient(0, -hh, 0, hh)
    fill.addColorStop(0, TOOTH_LO)
    fill.addColorStop(0.3, TOOTH_MID)
    fill.addColorStop(0.75, TOOTH_HI)
    fill.addColorStop(1, view === 'front' && kind === KIND_INCISOR ? '#e6e8ea' : TOOTH_MID)
  }
  g.fillStyle = fill
  g.fill()
  // 옆면 그늘: 가장자리를 살짝 어둡게
  const side = g.createLinearGradient(-hw, 0, hw, 0)
  side.addColorStop(0, 'rgba(150, 120, 90, 0.28)')
  side.addColorStop(0.22, 'rgba(150, 120, 90, 0)')
  side.addColorStop(0.78, 'rgba(150, 120, 90, 0)')
  side.addColorStop(1, 'rgba(150, 120, 90, 0.28)')
  g.fillStyle = side
  g.fill()
  g.lineWidth = 1.5
  g.strokeStyle = TOOTH_EDGE
  g.stroke()

  g.strokeStyle = GROOVE
  g.lineCap = 'round'
  if (view === 'front') {
    // 반짝임
    g.fillStyle = 'rgba(255, 255, 255, 0.55)'
    g.beginPath()
    g.ellipse(-hw * 0.35, -hh * 0.05, hw * 0.13, hh * 0.38, 0, 0, Math.PI * 2)
    g.fill()
  } else if (view === 'inner') {
    if (kind === KIND_INCISOR || kind === KIND_CANINE) {
      // 혀 쪽 면의 오목함과 잇몸 쪽 융기(cingulum)
      g.fillStyle = 'rgba(190, 165, 130, 0.28)'
      g.beginPath()
      g.ellipse(0, hh * 0.15, hw * 0.55, hh * 0.55, 0, 0, Math.PI * 2)
      g.fill()
      g.lineWidth = 2
      g.beginPath()
      g.ellipse(0, -hh * 0.45, hw * 0.45, hh * 0.25, 0, Math.PI * 0.1, Math.PI * 0.9)
      g.stroke()
    } else {
      // 혀 쪽 교두 두 개
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(0, hh * 0.95)
      g.quadraticCurveTo(0, hh * 0.2, 0, -hh * 0.3)
      g.stroke()
      g.fillStyle = 'rgba(255, 255, 255, 0.4)'
      g.beginPath()
      g.ellipse(-hw * 0.45, hh * 0.35, hw * 0.2, hh * 0.3, 0, 0, Math.PI * 2)
      g.ellipse(hw * 0.45, hh * 0.35, hw * 0.2, hh * 0.3, 0, 0, Math.PI * 2)
      g.fill()
    }
  } else {
    g.lineWidth = 2.2
    if (kind === KIND_INCISOR) {
      g.beginPath()
      g.moveTo(-hw * 0.7, hh * 0.25)
      g.quadraticCurveTo(0, hh * 0.45, hw * 0.7, hh * 0.25)
      g.stroke()
    } else if (kind === KIND_CANINE) {
      g.beginPath()
      g.moveTo(-hw * 0.55, hh * 0.1)
      g.lineTo(0, -hh * 0.15)
      g.lineTo(hw * 0.55, hh * 0.1)
      g.stroke()
    } else if (kind === KIND_PREMOLAR) {
      g.beginPath()
      g.moveTo(-hw * 0.6, 0)
      g.quadraticCurveTo(0, hh * 0.15, hw * 0.6, 0)
      g.stroke()
    } else if (kind === KIND_MOLAR) {
      g.beginPath()
      g.moveTo(-hw * 0.65, -hh * 0.05)
      g.quadraticCurveTo(0, hh * 0.12, hw * 0.65, -hh * 0.05)
      g.moveTo(-hw * 0.05, -hh * 0.65)
      g.quadraticCurveTo(hw * 0.12, 0, -hw * 0.05, hh * 0.65)
      g.stroke()
    }
  }
  g.restore()
}

/** 치아 사이 잇몸 경계 점: 치아 잇몸 끝 가운데와 이웃 치아 사이 꼭지(papilla) */
function gumPoints(teeth: readonly Box[], depth: number): [number, number][] {
  const pts: [number, number][] = []
  for (let t = 0; t < teeth.length; t++) {
    const b = teeth[t]
    const [, , , , , hw, hh, rg] = b
    if (t === 0) pts.push(boxPoint(b, -hw - 30, -hh + rg + depth))
    pts.push(boxPoint(b, 0, -hh + 2))
    if (t + 1 < teeth.length) {
      const n = teeth[t + 1]
      const p1 = boxPoint(b, hw, -hh + rg + depth)
      const p2 = boxPoint(n, -n[5], -n[6] + n[7] + depth)
      pts.push([(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2])
    } else pts.push(boxPoint(b, hw + 30, -hh + rg + depth))
  }
  return pts
}

/** 잇몸 영역: 화면 가장자리(edgeY)에서 잇몸 경계 점까지 */
function gumRegion(g: CanvasRenderingContext2D, pts: [number, number][], edgeY: number): void {
  g.moveTo(-40, edgeY)
  g.lineTo(-40, pts[0][1])
  for (const [x, y] of pts) g.lineTo(x, y)
  g.lineTo(LW + 40, pts[pts.length - 1][1])
  g.lineTo(LW + 40, edgeY)
  g.closePath()
}

function drawGum(g: CanvasRenderingContext2D, teeth: readonly Box[], edgeY: number, color: string, depth = 8): void {
  const pts = gumPoints(teeth, depth)
  g.beginPath()
  gumRegion(g, pts, edgeY)
  g.fillStyle = color
  g.fill()
  g.lineJoin = 'round'
  g.lineWidth = 3
  g.strokeStyle = GUM_EDGE
  g.stroke()
}

function drawRidges(g: CanvasRenderingContext2D, cx: number, y0: number, dir: number, n: number, w: number): void {
  g.strokeStyle = RIDGE
  g.lineCap = 'round'
  g.lineWidth = 3
  for (let k = 0; k < n; k++) {
    const y = y0 + dir * k * 16
    for (const s of [-1, 1]) {
      g.beginPath()
      g.moveTo(cx + s * 8, y)
      g.bezierCurveTo(cx + s * w * 0.35, y - dir * 10, cx + s * w * 0.6, y + dir * 8, cx + s * w * (0.85 - k * 0.1), y - dir * 4)
      g.stroke()
    }
  }
  // 입천장 가운데 솔기
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(cx, y0 - dir * 6)
  g.lineTo(cx, y0 + dir * 180)
  g.stroke()
}

function drawTongue(g: CanvasRenderingContext2D, e: Ellipse): void {
  const grad = g.createRadialGradient(e[0], e[1] - e[3] * 0.3, 4, e[0], e[1], Math.max(e[2], e[3]))
  grad.addColorStop(0, TONGUE)
  grad.addColorStop(0.75, TONGUE)
  grad.addColorStop(1, TONGUE_DEEP)
  g.fillStyle = grad
  g.beginPath()
  ellipsePath(g, e)
  g.fill()
  g.strokeStyle = 'rgba(120, 30, 45, 0.45)'
  g.lineWidth = 3
  g.stroke()
  // 가운데 홈
  g.strokeStyle = 'rgba(140, 40, 55, 0.4)'
  g.lineCap = 'round'
  g.lineWidth = 4
  g.beginPath()
  const top = e[1] - e[3], bottom = e[1] + e[3]
  const dir = e[1] > LH / 2 ? 1 : -1
  const from = dir > 0 ? top + 22 : bottom - 22
  g.moveTo(e[0], from)
  g.lineTo(e[0], from + dir * e[3] * 0.9)
  g.stroke()
  // 윤기
  g.fillStyle = 'rgba(255, 255, 255, 0.12)'
  g.beginPath()
  g.ellipse(e[0] - e[2] * 0.35, dir > 0 ? top + e[3] * 0.45 : bottom - e[3] * 0.45, e[2] * 0.2, e[3] * 0.18, 0, 0, Math.PI * 2)
  g.fill()
}

function drawBackground(g: CanvasRenderingContext2D, zone: number): void {
  const s = ZONE_SHAPES[zone]
  const view = VIEW[zone]
  const upper = zone < 3
  if (view === 'front') {
    const skin = g.createLinearGradient(0, 0, 0, LH)
    skin.addColorStop(0, SKIN)
    skin.addColorStop(1, SKIN_SHADE)
    g.fillStyle = skin
    g.fillRect(0, 0, LW, LH)
    const o = opening(s.inside)
    drawLips(g, o)
    g.beginPath()
    openingPath(g, o)
    g.fillStyle = MOUTH
    g.fill()
    return
  }
  g.fillStyle = MOUTH
  g.fillRect(0, 0, LW, LH)
  if (view === 'inner') {
    if (upper) {
      // 입천장: 치아 위쪽 전체
      const pts = gumPoints(s.teeth, 10)
      const grad = g.createRadialGradient(LW / 2, 40, 10, LW / 2, 60, 300)
      grad.addColorStop(0, PALATE_DEEP)
      grad.addColorStop(0.45, PALATE)
      grad.addColorStop(1, GUM)
      g.beginPath()
      gumRegion(g, pts, -40)
      g.fillStyle = grad
      g.fill()
      g.lineWidth = 3
      g.strokeStyle = GUM_EDGE
      g.stroke()
      drawRidges(g, LW / 2, 128, -1, 4, 120)
      // 아래쪽 혀끝 (치아에 겹치지 않는 곳)
      g.fillStyle = '#9c4050'
      g.beginPath()
      g.ellipse(LW / 2, LH + 50, 190, 64, 0, 0, Math.PI * 2)
      g.fill()
    } else {
      const pts = gumPoints(s.teeth, 10)
      g.beginPath()
      gumRegion(g, pts, LH + 40)
      g.fillStyle = GUM
      g.fill()
      g.lineWidth = 3
      g.strokeStyle = GUM_EDGE
      g.stroke()
    }
    return
  }
  // 씹는 면: 치열 따라 잇몸 띠, 안쪽에 입천장(위) 또는 혀(아래)
  const a = ARCH[zone]
  g.lineWidth = 104
  g.strokeStyle = GUM
  g.beginPath()
  ellipsePath(g, a)
  g.stroke()
  const inner: Ellipse = [a[0], a[1], a[2] - 52, a[3] - 52]
  if (upper) {
    const grad = g.createRadialGradient(a[0], a[1], 20, a[0], a[1], inner[3])
    grad.addColorStop(0, PALATE_DEEP)
    grad.addColorStop(0.6, PALATE)
    grad.addColorStop(1, GUM)
    g.fillStyle = grad
    g.beginPath()
    ellipsePath(g, inner)
    g.fill()
    drawRidges(g, a[0], a[1] - a[3] + 70, 1, 4, 110)
  } else {
    drawTongue(g, [a[0], a[1] - 10, a[2] - 66, a[3] - 66])
  }
}

let plaqueCanvas: HTMLCanvasElement | null = null

function drawPlaque(g: CanvasRenderingContext2D, teeth: readonly Box[], thick: readonly number[]): void {
  if (typeof document === 'undefined') return
  if (!plaqueCanvas) {
    plaqueCanvas = document.createElement('canvas')
    plaqueCanvas.width = W
    plaqueCanvas.height = H
  }
  const pg = plaqueCanvas.getContext('2d')
  if (!pg) return
  const img = pg.createImageData(W, H)
  const d = img.data
  for (let i = 0; i < W * H; i++) {
    const t = thick[i]
    if (!(t > 0)) continue
    d[4 * i] = PLAQUE[0]
    d[4 * i + 1] = PLAQUE[1]
    d[4 * i + 2] = PLAQUE[2]
    d[4 * i + 3] = Math.round(255 * plaqueAlpha(t))
  }
  pg.putImageData(img, 0, 0)
  g.save()
  g.beginPath()
  for (const b of teeth) addBox(g, b)
  g.clip()
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.drawImage(plaqueCanvas, 0, 0, W, H, 0, 0, W * CELL, H * CELL)
  g.restore()
}

export function drawZone(
  g: CanvasRenderingContext2D,
  zone: number,
  thick: readonly number[],
  cursor: readonly [number, number] | null,
): void {
  const s = ZONE_SHAPES[zone]
  const view = VIEW[zone]
  const upper = zone < 3
  g.save()
  g.clearRect(0, 0, LW, LH)
  drawBackground(g, zone)
  if (view === 'front') {
    g.save()
    g.beginPath()
    openingPath(g, opening(s.inside))
    g.clip()
    // 입 안 깊은 곳
    const deep = g.createLinearGradient(0, upper ? 0 : LH, 0, upper ? LH : 0)
    deep.addColorStop(0.45, MOUTH)
    deep.addColorStop(1, MOUTH_DEEP)
    g.fillStyle = deep
    g.fillRect(0, 0, LW, LH)
    if (upper) {
      g.fillStyle = '#7a2c3a'
      g.beginPath()
      g.ellipse(LW / 2, LH + 10, 190, 90, 0, 0, Math.PI * 2)
      g.fill()
    }
    drawGum(g, s.teeth, upper ? -40 : LH + 40, GUM)
  }
  for (const b of s.teeth) drawTooth(g, b, view)
  drawPlaque(g, s.teeth, thick)
  if (view === 'front') {
    g.restore()
    // 입술 안쪽 경계 그늘
    g.beginPath()
    openingPath(g, opening(s.inside))
    g.lineWidth = 3
    g.strokeStyle = LIP_LINE
    g.stroke()
  }
  for (const e of s.outside) drawTongue(g, e)
  g.restore()
  if (cursor) {
    g.strokeStyle = BRUSH
    g.lineWidth = 3
    g.beginPath()
    g.arc(cursor[0], cursor[1], (R + 0.5) * CELL, 0, Math.PI * 2)
    g.stroke()
  }
}

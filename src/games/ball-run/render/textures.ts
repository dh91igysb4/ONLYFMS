// 볼 런 장면 텍스처(설계 §6.2). 장면 내부 색은 theme 토큰 규칙의 승인된 예외다.
import { CanvasTexture, SRGBColorSpace } from 'three'

export const FLOOR_COLOR = '#23285e'
export const FLOOR_LINE = '#8ea4ff'
export const BUILDING_COLOR = '#2b2f7a'
export const BUILDING_LINE = '#6f7cff'
export const BLOCK_COLOR = '#c13cff'
export const BLOCK_EDGE = '#f2b8ff'
export const BALL_COLOR = '#d4149c'
export const BALL_BAND = '#f05cc4'

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2D 캔버스를 만들 수 없어요')
  return [c, ctx]
}

function finish(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

// 바닥 한 칸(1 m) = 텍스처 한 장. 테두리 선은 칸 가장자리에 반씩 걸쳐 이웃 칸과 합쳐 한 줄이 된다.
export function gridTexture(): CanvasTexture {
  const S = 256
  const [c, ctx] = canvas(S, S)
  ctx.fillStyle = FLOOR_COLOR
  ctx.fillRect(0, 0, S, S)
  ctx.strokeStyle = FLOOR_LINE
  // 번짐(넓고 옅게) → 선(좁고 진하게)
  for (const [width, alpha] of [[28, 0.12], [14, 0.3], [6, 1]] as const) {
    ctx.globalAlpha = alpha
    ctx.lineWidth = width
    ctx.strokeRect(0, 0, S, S)
  }
  ctx.globalAlpha = 1
  return finish(c)
}

// 건물 옆면: 남색 바탕에 밝은 격자(창). 세로로 긴 건물에 맞춰 세로가 길다.
export function buildingTexture(): CanvasTexture {
  const W = 128
  const H = 512
  const [c, ctx] = canvas(W, H)
  ctx.fillStyle = BUILDING_COLOR
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = BUILDING_LINE
  ctx.globalAlpha = 0.45
  ctx.lineWidth = 2
  const cols = 6
  const rows = 32
  ctx.beginPath()
  for (let i = 0; i <= cols; i++) {
    const x = Math.round((i * W) / cols)
    ctx.moveTo(x, 0)
    ctx.lineTo(x, H)
  }
  for (let j = 0; j <= rows; j++) {
    const y = Math.round((j * H) / rows)
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
  }
  ctx.stroke()
  ctx.globalAlpha = 1
  return finish(c)
}

// 블록 면: 마젠타 바탕 + 밝은 테두리(발광 맵으로도 쓴다).
export function blockTexture(): CanvasTexture {
  const S = 128
  const [c, ctx] = canvas(S, S)
  ctx.fillStyle = BLOCK_COLOR
  ctx.fillRect(0, 0, S, S)
  ctx.strokeStyle = BLOCK_EDGE
  for (const [width, alpha] of [[20, 0.25], [8, 1]] as const) {
    ctx.globalAlpha = alpha
    ctx.lineWidth = width
    ctx.strokeRect(0, 0, S, S)
  }
  ctx.globalAlpha = 1
  return finish(c)
}

// 공: 구르는 게 보이도록 옅은 띠 두 줄.
export function ballTexture(): CanvasTexture {
  const W = 256
  const H = 128
  const [c, ctx] = canvas(W, H)
  ctx.fillStyle = BALL_COLOR
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = BALL_BAND
  ctx.fillRect(0, 0, 18, H)
  ctx.fillRect(W / 2, 0, 18, H)
  return finish(c)
}

// 공 그림자: 가운데가 진한 원형 그라데이션(투명 바탕).
export function shadowTexture(): CanvasTexture {
  const S = 64
  const [c, ctx] = canvas(S, S)
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(0,0,0,0.7)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  return finish(c)
}

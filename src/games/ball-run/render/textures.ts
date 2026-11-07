// 볼 런 장면 텍스처(설계 §6.2, v2 §4). 색은 원작 녹화 프레임에서 뽑았다. 장면 내부 색은 theme 토큰 규칙의 승인된 예외다.
import { CanvasTexture, EquirectangularReflectionMapping, RepeatWrapping, SRGBColorSpace } from 'three'

export const FLOOR_COLOR = '#333877'
export const FLOOR_LINE = '#959dfa'
export const BUILDING_COLOR = '#1f2050'
export const BUILDING_LINE = '#5f78f0'
export const BLOCK_COLOR = '#ab24fb'
export const BLOCK_EDGE = '#ea6cff'
export const BALL_COLOR = '#9a0478'
export const WALL_COLOR = '#8818d0'
export const WALL_LINE = '#c45cff'
export const WALL_TOP = '#ff7cf4'
export const CHEVRON_COLOR = '#00f0f8'

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2D 캔버스를 만들 수 없어요')
  return [c, ctx]
}

function finish(c: HTMLCanvasElement, repeat = false): CanvasTexture {
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  if (repeat) {
    t.wrapS = RepeatWrapping
    t.wrapT = RepeatWrapping
  }
  return t
}

// 바닥 한 칸(1 m) = 텍스처 한 장. 테두리 선은 칸 가장자리에 반씩 걸쳐 이웃 칸과 합쳐 칸 폭의 약 10% 굵기 한 줄이 된다.
// 터널 아치 판에도 같은 텍스처를 쓴다(반복).
export function gridTexture(): CanvasTexture {
  const S = 256
  const [c, ctx] = canvas(S, S)
  ctx.fillStyle = FLOOR_COLOR
  ctx.fillRect(0, 0, S, S)
  ctx.strokeStyle = FLOOR_LINE
  ctx.lineWidth = 26
  ctx.strokeRect(0, 0, S, S)
  return finish(c, true)
}

// 건물 옆면: 짙은 남색 바탕에 하늘빛 창 격자. 텍스처 한 장 = CELL_W × CELL_H(m) 창 하나(반복).
export const WINDOW_W = 1.5
export const WINDOW_H = 1.2
export function buildingTexture(): CanvasTexture {
  const S = 64
  const [c, ctx] = canvas(S, S)
  ctx.fillStyle = BUILDING_COLOR
  ctx.fillRect(0, 0, S, S)
  ctx.strokeStyle = BUILDING_LINE
  ctx.lineWidth = 6
  ctx.strokeRect(0, 0, S, S)
  return finish(c, true)
}

// 블록 면: 마젠타 바탕 + 밝은 테두리. 1 m 정육면체 하나 = 한 장(기둥은 세로로 반복).
export function blockTexture(): CanvasTexture {
  const S = 128
  const [c, ctx] = canvas(S, S)
  ctx.fillStyle = BLOCK_COLOR
  ctx.fillRect(0, 0, S, S)
  ctx.strokeStyle = BLOCK_EDGE
  ctx.lineWidth = 8
  ctx.strokeRect(0, 0, S, S)
  return finish(c, true)
}

// 터널 옆 발광 벽: 마젠타 바탕, 1 m마다 세로 갈빗대, 위 가장자리 밝은 선. u는 z 1 m, v는 바닥 → 위.
export function wallTexture(): CanvasTexture {
  const W = 128
  const H = 128
  const [c, ctx] = canvas(W, H)
  ctx.fillStyle = WALL_COLOR
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = WALL_LINE
  ctx.fillRect(0, 0, 5, H)
  ctx.fillRect(W - 5, 0, 5, H)
  ctx.fillRect(0, Math.round(H * 0.5) - 2, W, 4)
  ctx.fillStyle = WALL_TOP
  ctx.fillRect(0, 0, W, 9)
  return finish(c, true)
}

// 터널 바닥 가속 화살표: 투명 바탕에 앞(캔버스 위쪽)을 가리키는 하늘색 갈매기 하나. 한 장 = 폭 CHEVRON_W × 길이 CHEVRON_P(m).
export const CHEVRON_W = 7
export const CHEVRON_P = 2.5
export function chevronTexture(): CanvasTexture {
  const PX = 100 // m당 픽셀
  const W = CHEVRON_W * PX
  const H = CHEVRON_P * PX
  const [c, ctx] = canvas(W, H)
  ctx.strokeStyle = CHEVRON_COLOR
  ctx.lineWidth = 0.42 * PX
  ctx.lineCap = 'round'
  ctx.lineJoin = 'miter'
  const pad = 0.35 * PX
  const tip = 0.6 * PX
  const foot = tip + 0.9 * PX
  ctx.beginPath()
  ctx.moveTo(pad, foot)
  ctx.lineTo(W / 2, tip)
  ctx.lineTo(W - pad, foot)
  ctx.stroke()
  const t = finish(c)
  t.wrapT = RepeatWrapping
  return t
}

// 공 반사용 환경 맵(등장방형): 위는 밝은 라벤더 띠, 가운데 마젠타, 아래는 남색. 광택 공의 가로 반사 띠를 흉내 낸다.
export function ballEnvTexture(): CanvasTexture {
  const W = 256
  const H = 128
  const [c, ctx] = canvas(W, H)
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.22, '#ffb8f4')
  g.addColorStop(0.4, '#c04cc8')
  g.addColorStop(0.5, '#3a1050')
  g.addColorStop(0.62, '#20184a')
  g.addColorStop(1, '#333877')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  const t = finish(c)
  t.mapping = EquirectangularReflectionMapping
  return t
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

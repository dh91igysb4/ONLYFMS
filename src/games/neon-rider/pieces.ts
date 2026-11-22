// 장애물 템플릿 → 선분. 순수 정수 TS (설계 §6). 좌표 x 앞, y 위, 단위 u.
import { MM, SEG_LEN } from './constants.ts'
import { TRIG_ONE, TURN, cosT, sinT } from './trig.ts'

export type Seg = { x0: number; y0: number; x1: number; y1: number; boost: boolean }
export type Prim =
  | { t: 'line'; dx: number; dy: number }
  | { t: 'arc'; r: number; a0: number; a1: number } // 현재 점에서 시작. a0→a1(TURN 단위), a1>a0이면 반시계
  | { t: 'gap'; dx: number; dy: number } // 길 없이 펜만 이동
  | { t: 'boost'; len: number } // 수평 부스터 직선
  | { t: 'gem'; dx: number; dy: number } // 현재 점 기준 위치에 보석 하나(펜은 그대로)
export type Template = { id: string; tier: 1 | 2 | 3 | 4; prims: readonly Prim[] }
export type Built = {
  segs: Seg[]
  gems: { x: number; y: number }[]
  endX: number
  endY: number
  minY: number
}

// 호 길이 = r·|Δa|·2π/TURN. 2π를 정수비 25/4(약간 크게)로 근사해 선분을 조금 더 잘게 쪼갠다.
const ARC_NUM = 25
const ARC_DEN = 4

function arcPoint(cx: number, cy: number, r: number, a: number): { x: number; y: number } {
  return { x: cx + Math.floor((r * cosT(a)) / TRIG_ONE), y: cy + Math.floor((r * sinT(a)) / TRIG_ONE) }
}

function arcCount(r: number, span: number): number {
  const unit = ARC_DEN * TURN * SEG_LEN
  return Math.max(1, Math.floor((r * Math.abs(span) * ARC_NUM + unit - 1) / unit))
}

export function buildTemplate(t: Template): Built {
  const segs: Seg[] = []
  const gems: { x: number; y: number }[] = []
  let px = 0
  let py = 0
  let minY = 0
  let any = false
  const push = (x1: number, y1: number, boost: boolean) => {
    segs.push({ x0: px, y0: py, x1, y1, boost })
    px = x1
    py = y1
    minY = any ? Math.min(minY, Math.min(segs[segs.length - 1].y0, y1)) : Math.min(segs[segs.length - 1].y0, y1)
    any = true
  }
  for (const p of t.prims) {
    if (p.t === 'line') push(px + p.dx, py + p.dy, false)
    else if (p.t === 'boost') push(px + p.len, py, true)
    else if (p.t === 'gap') {
      px += p.dx
      py += p.dy
    } else if (p.t === 'gem') gems.push({ x: px + p.dx, y: py + p.dy })
    else {
      const start = arcPoint(0, 0, p.r, p.a0)
      const cx = px - start.x
      const cy = py - start.y
      const n = arcCount(p.r, p.a1 - p.a0)
      for (let i = 1; i <= n; i++) {
        const q = arcPoint(cx, cy, p.r, p.a0 + Math.floor(((p.a1 - p.a0) * i) / n))
        push(q.x, q.y, false)
      }
    }
  }
  return { segs, gems, endX: px, endY: py, minY }
}

// 호 시작점을 기준으로 한 원 위의 점 (보석 배치용).
function onArc(r: number, a0: number, a: number, inset: number): { dx: number; dy: number } {
  const s = arcPoint(0, 0, r, a0)
  const q = arcPoint(0, 0, r - inset, a)
  return { dx: q.x - s.x, dy: q.y - s.y }
}

const mm = (n: number): number => n * MM

// 완만한 언덕: 오르막 오목호 → 볼록 꼭대기 → 내리막 오목호. 높이 약 2대(4 m), 길이 약 26 m.
const HILL_R = mm(12000)
const HILL_A = TURN / 16 + TURN / 32 // 약 34°
const hill: Template = {
  id: 'hill',
  tier: 1,
  prims: [
    { t: 'line', dx: mm(10000), dy: 0 },
    { t: 'arc', r: HILL_R, a0: (TURN * 3) / 4, a1: (TURN * 3) / 4 + HILL_A },
    { t: 'arc', r: HILL_R, a0: TURN / 4 + HILL_A, a1: TURN / 4 - HILL_A },
    { t: 'arc', r: HILL_R, a0: (TURN * 3) / 4 - HILL_A, a1: (TURN * 3) / 4 },
    { t: 'line', dx: mm(10000), dy: 0 },
  ],
}

// 오르막 끝 낭떠러지: 3 m 상승 → 틈(낙차 4 m) → 낮은 착지 평지.
const ramp: Template = {
  id: 'ramp',
  tier: 1,
  prims: [
    { t: 'line', dx: mm(10000), dy: 0 },
    { t: 'line', dx: mm(9000), dy: mm(3000) },
    { t: 'gap', dx: mm(7000), dy: -mm(4000) },
    { t: 'line', dx: mm(24000), dy: 0 },
  ],
}

// 반원 그릇(반지름 5 m)과 바닥의 보석 4개.
const BOWL_R = mm(5000)
const BOWL_INSET = mm(800)
const bowlGem = (a: number): Prim => ({ t: 'gem', ...onArc(BOWL_R, TURN / 2, a, BOWL_INSET) })
const bowl: Template = {
  id: 'bowl',
  tier: 1,
  prims: [
    { t: 'line', dx: mm(8000), dy: 0 },
    bowlGem((TURN * 5) / 8),
    bowlGem((TURN * 11) / 16),
    bowlGem((TURN * 13) / 16),
    bowlGem((TURN * 7) / 8),
    { t: 'arc', r: BOWL_R, a0: TURN / 2, a1: TURN },
    { t: 'line', dx: mm(8000), dy: 0 },
  ],
}

export const TEMPLATES: readonly Template[] = [hill, ramp, bowl]

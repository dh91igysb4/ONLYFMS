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

// 호 길이 = r·|Δa|·2π/TURN. 2π를 정수비 44/7(≈ 6.2857, 2π보다 약간 크다)로 근사해 선분이 SEG_LEN보다 길어지지 않게 한다.
const ARC_NUM = 44
const ARC_DEN = 7

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
  let minY = Infinity
  const push = (x1: number, y1: number, boost: boolean) => {
    minY = Math.min(minY, py, y1)
    segs.push({ x0: px, y0: py, x1, y1, boost })
    px = x1
    py = y1
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
  if (segs.length === 0) throw new Error(`선분이 없는 템플릿: ${t.id}`)
  return { segs, gems, endX: px, endY: py, minY }
}

// 호 시작점을 기준으로 한 원 위의 점 (보석 배치용).
function onArc(r: number, a0: number, a: number, inset: number): { dx: number; dy: number } {
  const s = arcPoint(0, 0, r, a0)
  const q = arcPoint(0, 0, r - inset, a)
  return { dx: q.x - s.x, dy: q.y - s.y }
}

const mm = (n: number): number => n * MM
const Q = TURN / 4
const deg = (d: number): number => Math.floor((d * TURN) / 360) // 각도(도) → TURN 단위 정수

// 진행 방향 h0 → h1(TURN 단위, x축 기준 반시계)로 꺾이는 반지름 r 호. h1 > h0면 왼쪽(오목하게 위로), 작으면 오른쪽.
function bend(r: number, h0: number, h1: number): Prim {
  return h1 > h0 ? { t: 'arc', r, a0: h0 - Q, a1: h1 - Q } : { t: 'arc', r, a0: h0 + Q, a1: h1 + Q }
}

const line = (dx: number, dy: number): Prim => ({ t: 'line', dx: mm(dx), dy: mm(dy) })
const gap = (dx: number, dy: number): Prim => ({ t: 'gap', dx: mm(dx), dy: mm(dy) })
const gem = (dx: number, dy: number): Prim => ({ t: 'gem', dx: mm(dx), dy: mm(dy) })

// ---- tier 1 ----

// 완만한 언덕: 오르막 오목호 → 볼록 꼭대기 → 내리막 오목호. 높이 약 2대(4 m), 길이 약 26 m.
const HILL_R = mm(12000)
const HILL_A = TURN / 16 + TURN / 32 // 약 34°
const hill: Template = {
  id: 'hill',
  tier: 1,
  prims: [
    line(10000, 0),
    bend(HILL_R, 0, HILL_A),
    bend(HILL_R, HILL_A, -HILL_A),
    bend(HILL_R, -HILL_A, 0),
    line(10000, 0),
  ],
}

// 오르막 끝 낭떠러지: 3 m 상승 → 틈(낙차 4 m) → 낮은 착지 평지.
const ramp: Template = {
  id: 'ramp',
  tier: 1,
  prims: [line(10000, 0), line(9000, 3000), gap(7000, -4000), line(24000, 0)],
}

// 그릇: 둥근 턱(볼록, 반지름 6 m) → 오목호(반지름 10 m, ±40°) → 둥근 턱 → 평지. 깊이 약 3.7 m(턱 1.4 + 호 2.3).
// 가장자리가 40°라 수직 벽이 없고, 나가는 턱에서 살짝 떠오른다. 바닥 근처 보석 4개는 지면에서 0.5 m 안쪽(차체 판정원이 닿는다).
const BOWL_R = mm(10000)
const BOWL_LIP = mm(6000)
const BOWL_A = deg(40) // 40°
const BOWL_INSET = mm(500)
const bowlGem = (a: number): Prim => ({ t: 'gem', ...onArc(BOWL_R, (TURN * 3) / 4 - BOWL_A, a, BOWL_INSET) })
const bowl: Template = {
  id: 'bowl',
  tier: 1,
  prims: [
    line(8000, 0),
    bend(BOWL_LIP, 0, -BOWL_A),
    bowlGem((TURN * 3) / 4 - Math.floor((BOWL_A * 3) / 5)),
    bowlGem((TURN * 3) / 4 - Math.floor(BOWL_A / 5)),
    bowlGem((TURN * 3) / 4 + Math.floor(BOWL_A / 5)),
    bowlGem((TURN * 3) / 4 + Math.floor((BOWL_A * 3) / 5)),
    bend(BOWL_R, -BOWL_A, BOWL_A),
    bend(BOWL_LIP, BOWL_A, 0),
    line(8000, 0),
  ],
}

// 연속 물결: 반지름 12 m 호로 진행 방향을 ±24° 사이로 흔든다. 꼭대기 2개, 평지 위로 약 1 m.
const WAVE_R = mm(12000)
const WAVE_A = deg(24)
const waves: Template = {
  id: 'waves',
  tier: 1,
  prims: [
    line(6000, 0),
    bend(WAVE_R, 0, WAVE_A),
    bend(WAVE_R, WAVE_A, -WAVE_A),
    bend(WAVE_R, -WAVE_A, WAVE_A),
    bend(WAVE_R, WAVE_A, -WAVE_A),
    bend(WAVE_R, -WAVE_A, 0),
    line(6000, 0),
  ],
}

// ---- tier 2 ----

// 위 삼각 열: 밑변 8 m(차 4대)·높이 2.5 m 삼각 3개를 평지 위에 늘어놓는다.
const SPIKE_W = 8000
const SPIKE_H = 2500
const spike = (): Prim[] => [line(SPIKE_W / 2, SPIKE_H), line(SPIKE_W / 2, -SPIKE_H)]
const spikes: Template = {
  id: 'spikes',
  tier: 2,
  prims: [line(6000, 0), ...spike(), line(2000, 0), ...spike(), line(2000, 0), ...spike(), line(10000, 0)],
}

// 쿼터파이프: 오목호로 70°까지 솟구쳐 위로 튀어 오른다. 앞쪽 아래 내리막에 내린다.
const QP_R = mm(3500)
const QP_A = deg(70) // 70°
const quarter: Template = {
  id: 'quarter',
  tier: 2,
  prims: [line(6000, 0), bend(QP_R, 0, QP_A), gap(2500, 0), line(10000, -7000), bend(mm(6000), -deg(36), 0), line(10000, 0)],
}

// S자: 오목 → 볼록으로 3 m 올라선 뒤, 볼록 → 오목으로 내려온다(반지름 4 m, 50°).
const S_R = mm(4000)
const S_A = deg(50)
const scurve: Template = {
  id: 'scurve',
  tier: 2,
  prims: [line(6000, 0), bend(S_R, 0, S_A), bend(S_R, S_A, 0), line(3000, 0), bend(S_R, 0, -S_A), bend(S_R, -S_A, 0), line(8000, 0)],
}

// 부스터 직선 + 점프대: 부스터(»») 6 m → 25° 점프대 → 틈 14 m → 완만한 착지 경사. 비행 궤적 위에 보석 줄.
const boostjump: Template = {
  id: 'boostjump',
  tier: 2,
  prims: [
    line(4000, 0),
    { t: 'boost', len: mm(6000) },
    line(3000, 0),
    bend(mm(6000), 0, deg(25)),
    gem(2000, 1000), // 점프대 끝 기준. BOOST_V 이륙 궤적(차 중심)을 따라 놓았다
    gem(5000, 1600),
    gem(8000, 1800),
    gem(11000, 1500),
    gap(14000, 0),
    line(14000, -500), // 끝 높이가 부스터 높이보다 낮지 않아 나가는 속력이 BOOST_V를 넘지 않는다(누름은 V_MAX까지만 민다)
    line(16000, 0),
  ],
}

// ---- tier 3 ----

// 루프(반지름 3.5 m) 뒤 점프대와 틈. 입구·출구가 겹치는 루프 아래쪽 선분은 진행 번호로 88개쯤 떨어져 있어 충돌 창(±40) 밖이다.
const LOOP_R = mm(3500)
const loop: Template = {
  id: 'loop',
  tier: 3,
  prims: [line(6000, 0), bend(LOOP_R, 0, TURN), line(8000, 0), line(6000, 1500), gap(5000, -2000), line(16000, 0)],
}

// 계단식 낙하: 2 m씩 4번 떨어지는 4 m 계단. 모서리마다 0.1 m 틈(앞으로만 끊기는 gap이라 수직 낙하 대신).
const drop = (): Prim => gap(100, -2000)
const steps: Template = {
  id: 'steps',
  tier: 3,
  prims: [line(4000, 0), drop(), line(4000, 0), drop(), line(4000, 0), drop(), line(4000, 0), drop(), line(12000, 0)],
}

// 위·아래 삼각 교차: 위 삼각 사이가 바닥 없는 3 m 틈이고, 그 위에 거꾸로 매달린 삼각이 있다.
// 위 삼각 꼭대기에서 힘껏 뛰면 매달린 삼각에 부딪히므로, 오르막에서 떼어 낮게 건너야 한다.
// (틈은 앞으로만 끊긴다: 매달린 삼각은 펜을 위로 옮겨 그리고 다시 내려온다.)
const HANG_Y = 6400 // 매달린 삼각 밑변 높이(평지 기준). 꼭짓점은 HANG_Y - HANG_H
const HANG_W = 1000 // 밑변의 절반
const HANG_H = 2000
const PIT_EDGE = 500 // 틈 가장자리에서 매달린 삼각 밑변 끝까지
const hangOverPit = (): Prim[] => [gap(PIT_EDGE, HANG_Y), line(HANG_W, -HANG_H), line(HANG_W, HANG_H), gap(PIT_EDGE, -HANG_Y)]
const spikes2: Template = {
  id: 'spikes2',
  tier: 3,
  prims: [line(6000, 0), ...spike(), ...hangOverPit(), ...spike(), ...hangOverPit(), ...spike(), line(10000, 0)],
}

// ---- tier 4 ----

// 끊어진 호 징검다리: 점프대에서 떠서 오목 호(가운데가 낮은 짧은 그릇) 3개를 차례로 건넌다.
// 각 호는 내려가며 받아 주고(-30°) 올라가며 다음 호로 던진다(+30°).
const ARC_R = mm(5000)
const ARC_A = deg(30)
const ARC_GAP = 4500
const hop = (): Prim => bend(ARC_R, -ARC_A, ARC_A)
const arcs: Template = {
  id: 'arcs',
  tier: 4,
  prims: [line(6000, 0), bend(mm(5000), 0, ARC_A), gap(ARC_GAP, 0), hop(), gap(ARC_GAP, 0), hop(), gap(ARC_GAP, 0), hop(), gap(ARC_GAP + 2000, -2000), line(16000, 0)],
}

// 연속 루프: 루프 두 개 뒤 높은 점프대.
const loop2: Template = {
  id: 'loop2',
  tier: 4,
  prims: [line(6000, 0), bend(LOOP_R, 0, TURN), line(4000, 0), bend(mm(4000), 0, TURN), line(8000, 0), line(6000, 1500), gap(5000, -2000), line(16000, 0)],
}

export const TEMPLATES: readonly Template[] = [hill, ramp, bowl, waves, spikes, quarter, scurve, boostjump, loop, steps, spikes2, arcs, loop2]

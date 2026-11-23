// 장애물 템플릿 → 선분. 순수 정수 TS (설계 §6). 좌표 x 앞, y 위, 단위 u.
import type { BlockDef } from './blocks.ts'
import { LEAD_FLAT_MAX, MM, SEG_LEN, TAIL_FLAT_MAX } from './constants.ts'
import type { HazardDef, HazardShape } from './hazards.ts'
import type { MoverDef } from './movers.ts'
import { TRIG_ONE, TURN, cosT, sinT } from './trig.ts'

export type Seg = { x0: number; y0: number; x1: number; y1: number; boost: boolean }
export type Prim =
  | { t: 'line'; dx: number; dy: number }
  | { t: 'arc'; r: number; a0: number; a1: number } // 현재 점에서 시작. a0→a1(TURN 단위), a1>a0이면 반시계
  | { t: 'gap'; dx: number; dy: number } // 길 없이 펜만 이동
  | { t: 'boost'; len: number } // 수평 부스터 직선
  | { t: 'gem'; dx: number; dy: number } // 현재 점 기준 위치에 보석 하나(펜은 그대로)
  // 아래 셋의 좌표(도형·선분·기준점·pass.x·블록 위치)는 (현재 점 + (dx, dy))를 원점으로 한 상대 좌표. 펜은 그대로. 설계 §4.3.
  | { t: 'hazard'; dx: number; dy: number; h: HazardDef }
  | { t: 'mover'; dx: number; dy: number; m: MoverDef }
  | { t: 'block'; dx: number; dy: number; b: BlockDef }
// trimFlats: 앞뒤 맨 평지를 LEAD_FLAT_MAX·TAIL_FLAT_MAX로 자른다. TEMPLATES의 템플릿은 모두 켠다(테스트용 지형은 끈 채로 쓴다).
export type Template = { id: string; tier: 1 | 2 | 3 | 4; prims: readonly Prim[]; trimFlats?: boolean }
// hazards·movers·blocks는 템플릿 좌표(코스가 구간을 만들 때 월드로 옮긴다).
export type Built = {
  segs: Seg[]
  gems: { x: number; y: number }[]
  hazards: HazardDef[]
  movers: MoverDef[]
  blocks: BlockDef[]
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

function shiftShape(s: HazardShape, dx: number, dy: number): HazardShape {
  if (s.s === 'bar') return { ...s, x0: s.x0 + dx, y0: s.y0 + dy, x1: s.x1 + dx, y1: s.y1 + dy }
  return { ...s, x: s.x + dx, y: s.y + dy }
}

/** 위험물을 (dx, dy)만큼 옮긴다. 움직임(swing 진폭 등)은 상대량이라 그대로. */
export function shiftHazard(h: HazardDef, dx: number, dy: number): HazardDef {
  return { ...h, shape: shiftShape(h.shape, dx, dy) }
}

/** 움직이는 길을 (dx, dy)만큼 옮긴다: 선분·기준점·pass.x. */
export function shiftMover(m: MoverDef, dx: number, dy: number): MoverDef {
  return {
    ...m,
    segs: m.segs.map((s) => ({ ...s, x0: s.x0 + dx, y0: s.y0 + dy, x1: s.x1 + dx, y1: s.y1 + dy })),
    pivotX: m.pivotX + dx,
    pivotY: m.pivotY + dy,
    start: m.start.k === 'pass' ? { ...m.start, x: m.start.x + dx } : m.start,
  }
}

export function shiftBlock(b: BlockDef, dx: number, dy: number): BlockDef {
  return { ...b, x: b.x + dx, y: b.y + dy }
}

export function buildTemplate(t: Template): Built {
  const segs: Seg[] = []
  const gems: { x: number; y: number }[] = []
  const hazards: HazardDef[] = []
  const movers: MoverDef[] = []
  const blocks: BlockDef[] = []
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
    else if (p.t === 'hazard') hazards.push(shiftHazard(p.h, px + p.dx, py + p.dy))
    else if (p.t === 'mover') movers.push(shiftMover(p.m, px + p.dx, py + p.dy))
    else if (p.t === 'block') blocks.push(shiftBlock(p.b, px + p.dx, py + p.dy))
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
  const built = { segs, gems, hazards, movers, blocks, endX: px, endY: py, minY }
  return t.trimFlats ? trimFlats(built) : built
}

// 템플릿 앞뒤의 맨 평지(부스터가 아닌 수평 선분이 끊김 없이 이어진 부분)를 LEAD_FLAT_MAX·TAIL_FLAT_MAX로 자른다.
// 녹화처럼 장애물이 짧은 평지를 사이에 두고 이어지게 하려는 것(constants.ts REST_LEN 주석). 앞을 자르면 나머지를 그만큼 왼쪽으로 옮긴다.
function trimFlats(b: Built): Built {
  const flat = (s: Seg): boolean => !s.boost && s.y0 === s.y1
  let segs = b.segs
  let { gems, hazards, movers, blocks } = b
  let lead = 0
  let k = 0 // 앞쪽 맨 평지 선분 수
  for (; k < segs.length && flat(segs[k]) && segs[k].y0 === segs[0].y0 && (k === 0 || segs[k].x0 === segs[k - 1].x1); k++)
    lead += segs[k].x1 - segs[k].x0
  let endX = b.endX
  const d = lead - LEAD_FLAT_MAX
  if (d > 0) {
    // 앞쪽 평지 선분만 잘라 낸다(고리처럼 뒤로 도는 선분이 x < 0으로 가도 그대로 둔다).
    const moved = segs.map((s) => ({ ...s, x0: s.x0 - d, x1: s.x1 - d }))
    const head = moved.slice(0, k).filter((s) => s.x1 > 0).map((s) => (s.x0 < 0 ? { ...s, x0: 0 } : s))
    segs = [...head, ...moved.slice(k)]
    gems = gems.map((g) => ({ x: g.x - d, y: g.y }))
    hazards = hazards.map((h) => shiftHazard(h, -d, 0))
    movers = movers.map((m) => shiftMover(m, -d, 0))
    blocks = blocks.map((k) => shiftBlock(k, -d, 0))
    endX -= d
  }
  let tail = 0
  const n = segs.length
  for (let i = n - 1; i >= 0 && flat(segs[i]) && segs[i].y1 === segs[n - 1].y1 && (i === n - 1 || segs[i].x1 === segs[i + 1].x0); i--)
    tail += segs[i].x1 - segs[i].x0
  let cut = tail - TAIL_FLAT_MAX
  if (cut > 0) {
    const out = segs.slice()
    while (cut > 0) {
      const last = out[out.length - 1]
      const len = last.x1 - last.x0
      if (len <= cut) {
        out.pop()
        cut -= len
      } else {
        out[out.length - 1] = { ...last, x1: last.x1 - cut }
        cut = 0
      }
    }
    segs = out
    endX = segs[segs.length - 1].x1
  }
  return { ...b, segs, gems, hazards, movers, blocks, endX }
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

const boost = (len: number): Prim => ({ t: 'boost', len: mm(len) })
const tanDeg = (d: number, dx: number): number => Math.floor((dx * sinT(deg(d))) / cosT(deg(d))) // 기울기 d°인 직선이 dx만큼 갈 때의 높이(mm)

// 템플릿마다 근거가 된 녹화 시각(s)을 적는다. 목록은 측정 기록의 "영상 장애물 목록"(S1~S33)이다.
// 치수는 녹화의 차 길이(약 2 m, 화면 폭의 1/9) 비율로 쟀다. "대" = 차 한 대 길이.

// ---- tier 1 ----

// [S1, 0–12·105 s] 큰 언덕: 오르막 오목호 → 볼록 꼭대기 → 내리막 오목호. 높이 약 2대(4 m), 길이 약 13대(26 m).
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

// [S2, 59–63·178·208–219·237·290 s] 낮은 물결: 반지름 10 m 호로 진행 방향을 ±20° 사이로 흔든다. 마루 3개,
// 마루–골 약 2.4 m(1.2대), 마루 간격 약 13.7 m(6.8대). 첫 마루 위 공중에 비스듬한 보석 3개(208–211 s, 앞 절벽에서 날아온 궤적).
const WAVE_R = mm(10000)
const WAVE_A = deg(20)
const waves: Template = {
  id: 'waves',
  tier: 1,
  prims: [
    line(6000, 0),
    bend(WAVE_R, 0, WAVE_A),
    gem(2900, 3600), // 이 호 끝(오르막 중간) 기준. 마루는 약 3.4 m 앞·0.6 m 위
    gem(3900, 2600),
    gem(4900, 1600),
    bend(WAVE_R, WAVE_A, -WAVE_A),
    bend(WAVE_R, -WAVE_A, WAVE_A),
    bend(WAVE_R, WAVE_A, -WAVE_A),
    bend(WAVE_R, -WAVE_A, WAVE_A),
    bend(WAVE_R, WAVE_A, -WAVE_A),
    bend(WAVE_R, -WAVE_A, 0),
    line(6000, 0),
  ],
}

// [S4, 57.4·160·288 s] 그릇: 둥근 턱(볼록, 반지름 4 m) → 오목호(반지름 8 m, ±45°) → 둥근 턱 → 평지.
// 너비 약 8.5대, 깊이 약 3.5 m(턱 1.2 + 호 2.3). 바닥 근처 보석 5개는 지면에서 0.5 m 안쪽(차체 판정원이 닿는다).
const BOWL_R = mm(8000)
const BOWL_LIP = mm(4000)
const BOWL_A = deg(45)
const BOWL_INSET = mm(500)
const bowlGem = (k: number): Prim => ({ t: 'gem', ...onArc(BOWL_R, (TURN * 3) / 4 - BOWL_A, (TURN * 3) / 4 + Math.floor((BOWL_A * k * 2) / 5), BOWL_INSET) })
const bowl: Template = {
  id: 'bowl',
  tier: 1,
  prims: [
    line(8000, 0),
    bend(BOWL_LIP, 0, -BOWL_A),
    bowlGem(-2),
    bowlGem(-1),
    bowlGem(0),
    bowlGem(1),
    bowlGem(2),
    bend(BOWL_R, -BOWL_A, BOWL_A),
    bend(BOWL_LIP, BOWL_A, 0),
    line(8000, 0),
  ],
}

// [S8, 99–106·28.5 s] 부스터 평지: 부스터(»») 4 m → 평지 8 m → 반지름 12 m·±30° 언덕(높이 약 3.2 m).
// 부스터 속도(BOOST_V)로 마루를 넘으면 차가 높이 뜬다(녹화 105.5 s).
const boostflat: Template = {
  id: 'boostflat',
  tier: 1,
  prims: [line(4000, 0), boost(4000), line(8000, 0), bend(mm(12000), 0, deg(30)), bend(mm(12000), deg(30), -deg(30)), bend(mm(12000), -deg(30), 0), line(6000, 0)],
}

// [S14, 87–93 s] 위·아래 삼각 열: 평지 위 △(밑변 5.4 m = 2.7대, 높이 3 m)와 평지 아래 ▽(같은 크기, 윗변이 곧 길)가 번갈아 △▽△▽△▽△.
// ▽의 두 옆변은 길 아래의 장식이다: 윗변(길) 끝에서 1 mm 앞으로 펜을 옮겨(gap은 앞으로만) 오른쪽 → 꼭짓점 → 왼쪽으로 거꾸로 긋고,
// 다시 윗변 끝 1 mm 앞으로 돌아와 길을 잇는다. 길에는 1 mm 틈만 생긴다(바퀴 반지름 180 mm).
const TRI_W = 2700 // 밑변의 절반
const TRI_H = 3000
const triUp = (): Prim[] => [line(TRI_W, TRI_H), line(TRI_W, -TRI_H)]
const triDown = (): Prim[] => [line(2 * TRI_W, 0), gap(1, 0), line(-TRI_W, -TRI_H), line(-TRI_W, TRI_H), gap(2 * TRI_W, 0)]
const spikes: Template = {
  id: 'spikes',
  tier: 1,
  prims: [line(5000, 0), ...triUp(), ...triDown(), ...triUp(), ...triDown(), ...triUp(), ...triDown(), ...triUp(), line(8000, 0)],
}

// [S16, 165.5–167·151.8·247·275.6 s] 골짜기와 뾰족 봉우리: S자 내리막(2.2 m, 비탈 위 보석 2개 152.6 s) → 평평한 바닥 8 m(4대)
// → 35° 직선 오르막 3.5 m → 뾰족한 꼭대기 → 35° 직선 내리막 → 오목호로 평지.
const valley: Template = {
  id: 'valley',
  tier: 1,
  prims: [
    line(4000, 0),
    bend(mm(6000), 0, -deg(35)),
    gem(700, 300),
    gem(2000, -500),
    bend(mm(6000), -deg(35), 0),
    line(8000, 0),
    line(5000, tanDeg(35, 5000)),
    line(3000, -tanDeg(35, 3000)),
    bend(mm(4000), -deg(35), 0),
    line(6000, 0),
  ],
}

// [S12, 153.6·186.5–187·293–295 s] 고원 절벽: 반지름 12 m·35° 오목·볼록 S자로 약 4.3 m 올라 3 m 고원 → 수직 낭떠러지로 원래 높이.
const cliff: Template = {
  id: 'cliff',
  tier: 1,
  prims: [line(4000, 0), bend(mm(12000), 0, deg(35)), bend(mm(12000), deg(35), 0), line(3000, 0), gap(500, -4300), line(10000, 0)],
}

// [S13·S32, 184.6·290.6·310–315 s] 낭떠러지: 평지가 끊기고 5 m(2.5대) 아래 평지. 아래 평지 바로 위(0.6 m)에 보석 4개 줄.
const ledge: Template = {
  id: 'ledge',
  tier: 1,
  prims: [line(6000, 0), gap(500, -5000), line(3000, 0), gem(500, 600), gem(1400, 600), gem(2300, 600), gem(3200, 600), line(8000, 0)],
}

// [S11, 112–116·154–156·159.8 s] 급경사 내리막: 볼록 마루(반지름 5 m) → 65° 직선 → 오목, 모두 약 10 m(5대) 낮아진다.
// 마루 너머 공중에 보석 5개가 세로로 비스듬히 줄지어 있다(V_MAX로 마루를 날아 넘는 궤적이 아래쪽 보석을 지난다).
const bigdrop: Template = {
  id: 'bigdrop',
  tier: 1,
  prims: [
    line(6000, 0),
    gem(6500, 1200), // 마루(볼록호 시작) 기준
    gem(6800, 100),
    gem(7100, -1000),
    gem(7400, -2100),
    gem(7700, -3200),
    bend(mm(5000), 0, -deg(65)),
    line(2000, -tanDeg(65, 2000)),
    bend(mm(5000), -deg(65), 0),
    line(8000, 0),
  ],
}

// [S17, 138.2·192.5·309 s] 직선 오르막 → 고원: 30° 직선으로 3.5 m 올라 평지에 머문다.
const rampflat: Template = {
  id: 'rampflat',
  tier: 1,
  prims: [line(4000, 0), line(6000, 3500), line(10000, 0)],
}

// [S7·S30, 155.6–158·110.6–113 s] 점프대와 내리막 착지: 평지에서 오목호(반지름 5 m)로 45°까지 휘어 오르는 턱 → 틈 8 m(3 m 낮아짐)
// → −32° 내리막 7 m → 오목호로 평지. 녹화의 킥커 → 공중의 볼록 내리막 착지를 부스터 없이 줄인 것이다.
// 내리막이 더 길면(9 m) 나가는 속력이 BOOST_V 턱밑(5150)까지 올라 줄였다.
// 곧은 경사로는 이륙각이 경사보다 한참 낮아(18° 경사에서 10~12°) 체공이 약 50틱이라 한 바퀴를 돌 수 없었다.
const ramp: Template = {
  id: 'ramp',
  tier: 1,
  prims: [line(8000, 0), bend(mm(5000), 0, deg(45)), gap(8000, -3000), line(7000, -4360), bend(mm(8000), -deg(32), 0), line(14000, 0)],
}

// ---- tier 2 ----

// [S7·S6, 93.6–97 s] 킥커 → 컵: 오목호(반지름 6 m)로 60°까지 3 m 오르는 킥커 → 틈 6.3 m(3.2대) → 왼쪽 벽이 거의 수직인
// 너비 약 5 m·깊이 2.3 m 컵(바닥에 보석 4개) → 둥근 마루 → 평지. 끝 높이는 시작보다 약 2.2 m 높다.
const cup: Template = {
  id: 'cup',
  tier: 2,
  prims: [
    line(4000, 0),
    bend(mm(6000), 0, deg(60)),
    gap(6300, -200),
    bend(mm(2800), -deg(80), 0),
    gem(-1200, 550), // 컵 바닥 기준
    gem(-400, 480),
    gem(400, 480),
    gem(1200, 550),
    bend(mm(2800), 0, deg(45)),
    bend(mm(3000), deg(45), 0),
    line(6000, 0),
  ],
}

// [S7, 93.6·120.6 s] 쿼터파이프: 오목호로 70°까지 솟구쳐 위로 튀어 오른다. 앞쪽 아래 내리막에 내린다.
const QP_R = mm(3500)
const QP_A = deg(70)
const quarter: Template = {
  id: 'quarter',
  tier: 2,
  prims: [line(6000, 0), bend(QP_R, 0, QP_A), gap(2500, 0), line(10000, -7000), bend(mm(6000), -deg(36), 0), line(10000, 0)],
}

// [S9·S30, 155.6–158·284.8 s] 부스터 + 점프대: 부스터(»») 6 m → 30° 점프대 → 틈 17 m(1.5 m 낮아짐) → −20° 내리막 → +10° 오르막 → 평지.
// 녹화는 화살표가 휘어 오르는 킥커 위에 있지만 부스터 선분은 수평이라 킥커 바로 앞에 둔다.
// 부스터가 어느 진입 속도든 BOOST_V로 올려 주므로 체공은 늘 약 76틱이다. 비행 궤적 위에 보석 4개.
const boostjump: Template = {
  id: 'boostjump',
  tier: 2,
  prims: [
    line(4000, 0),
    boost(6000),
    line(3000, 0),
    bend(mm(6000), 0, deg(30)),
    gem(3000, 1500), // 점프대 끝 기준. 이륙 궤적(차 중심)을 따라 놓았다
    gem(6500, 2350),
    gem(10000, 2420),
    gem(13500, 1680),
    gap(17000, -1500),
    line(10000, -3640),
    bend(mm(12000), -deg(20), deg(10)),
    line(20000, 3527),
    bend(mm(10000), deg(10), 0),
    line(10000, 0),
  ],
}

// [S20, 119.5–133 s] 바닥 가시 띠: 오목호(반지름 5 m)로 55°까지 2.1 m 오르는 킥커 뒤의 평지가 빨간 가시 띠다.
// 닿으면 죽는 지형이 시뮬에 없어서 바닥 없는 틈 7 m로 대신한다(빠지면 fall). 녹화의 띠는 약 24 m로 더 길지만
// 그 위의 움직이는 노란 초승달(M5)을 디딤돌로 건넌다. 그것 없이 한 번에 건널 수 있는 길이(V_MAX 이륙 약 7.8 m 비행)로 줄였다.
const spikefloor: Template = {
  id: 'spikefloor',
  tier: 2,
  prims: [line(4000, 0), bend(mm(5000), 0, deg(55)), gap(7000, -2100), line(12000, 0)],
}

// [S19, 181.4–182 s] 가시 구덩이: S자(반지름 7.5 m, 30°)로 2 m 올라선 고원 3 m → 너비 5.2 m(2.6대) 구덩이 → 2.4 m 낮은 반대편 2 m
// → S자 내리막 → 평지. 구덩이 바닥의 빨간 가시는 바닥 없는 틈으로 대신한다. 녹화의 구덩이는 6.3 m(3.2대)이지만
// V_MAX 수평 비행(2.4 m 떨어지는 동안 약 5.8 m)으로는 앞바퀴가 반대편 모서리에 걸려 떨어져 5.2 m로 줄였다.
const spikepit: Template = {
  id: 'spikepit',
  tier: 2,
  prims: [
    line(4000, 0),
    bend(mm(7500), 0, deg(30)),
    bend(mm(7500), deg(30), 0),
    line(3000, 0),
    gap(5200, -2400),
    line(2000, 0),
    bend(mm(6000), 0, -deg(30)),
    bend(mm(6000), -deg(30), 0),
    line(6000, 0),
  ],
}

// [S15, 69.5–71·74.5 s] 지붕 징검다리: 35° 직선 오르막 3.5 m가 공중에서 끊김 → 틈 4.6 m(2.3대) → 다음 지붕 35° 오르막 3.4 m
// → 뾰족한 꼭대기 → 35° 직선 내리막으로 원래 높이 → 평지.
const roofs: Template = {
  id: 'roofs',
  tier: 2,
  prims: [line(4000, 0), line(5000, 3500), gap(4600, -100), line(4800, 3400), line(9600, -6800), line(6000, 0)],
}

// [S10, 109.6 s] 높은 계단 오르막: 부스터 4 m → 오목(반지름 3 m) → 70° 직선 → 볼록 → 고원. 약 8.4 m(4.2대) 오른다.
// 부스터 속도(BOOST_V, 최대 약 11 m 오름)로만 올라설 수 있다.
const stepup: Template = {
  id: 'stepup',
  tier: 2,
  prims: [line(3000, 0), boost(4000), line(3000, 0), bend(mm(3000), 0, deg(70)), line(1600, tanDeg(70, 1600)), bend(mm(3000), deg(70), 0), line(8000, 0)],
}

// [S21, 52–53·214 s] 마루 사이 틈: S자(반지름 8 m)로 오르다 15° 위를 향한 채 끊김 → 틈 5 m → 0.6 m 낮은 볼록 내리막 → 평지.
const crestgap: Template = {
  id: 'crestgap',
  tier: 2,
  prims: [
    line(4000, 0),
    bend(mm(8000), 0, deg(30)),
    bend(mm(8000), deg(30), deg(15)),
    gap(5000, -600),
    bend(mm(8000), 0, -deg(30)),
    bend(mm(8000), -deg(30), 0),
    line(6000, 0),
  ],
}

// [S18, 189.4–191 s] 톱니 계단: 55° 오르막 0.8 m + 평지 1.5 m를 3번, 마지막 오르막에서 공중으로 끊김(3.2 m 위)
// → 원래 높이 평지.
const tooth = (): Prim[] => [line(550, 800), line(1500, 0)]
const stairs: Template = {
  id: 'stairs',
  tier: 2,
  prims: [line(4000, 0), ...tooth(), ...tooth(), ...tooth(), line(550, 800), gap(1000, -3200), line(10000, 0)],
}

// [S4·S5, 57.4–58.5·288–290 s] 그릇 → 절벽: 볼록(5 m) → 50° 직선 → 오목(6 m)으로 약 5.7 m 내려간 그릇(바닥 보석 5개)
// → 오목·볼록으로 3.6 m 올라 고원 3 m → 수직 낭떠러지 3 m("big air!").
const bowldrop: Template = {
  id: 'bowldrop',
  tier: 2,
  prims: [
    line(4000, 0),
    bend(mm(5000), 0, -deg(50)),
    line(1500, -tanDeg(50, 1500)),
    bend(mm(6000), -deg(50), 0),
    gem(-1600, 600), // 그릇 바닥 기준
    gem(-800, 520),
    gem(0, 500),
    gem(800, 520),
    gem(1600, 600),
    bend(mm(6000), 0, deg(50)),
    bend(mm(4000), deg(50), 0),
    line(3000, 0),
    gap(500, -3000),
    line(8000, 0),
  ],
}

// ---- tier 3 ----

// [S23, 64.5–67 s] 루프: 완만한 오르막(2 m) → 반지름 3.7 m 루프(안쪽 보석 6개) → 완만한 내리막.
// 입구·출구가 겹치는 루프 아래쪽 선분은 진행 번호로 90개쯤 떨어져 있어 충돌 창(±40) 밖이다.
// 녹화 루프 안의 회전하는 빨간 호(M2)는 움직이는 구조물이라 넣지 않았다.
const LOOP_R = mm(3700)
const LOOP_INSET = mm(600)
const loopGem = (k: number): Prim => ({ t: 'gem', ...onArc(LOOP_R, -Q, -Q + Math.floor((TURN * k) / 7), LOOP_INSET) })
const loop: Template = {
  id: 'loop',
  tier: 3,
  prims: [
    line(3000, 0),
    bend(mm(8000), 0, deg(20)),
    line(3000, tanDeg(20, 3000)),
    bend(mm(8000), deg(20), 0),
    loopGem(1),
    loopGem(2),
    loopGem(3),
    loopGem(4),
    loopGem(5),
    loopGem(6),
    bend(LOOP_R, 0, TURN),
    bend(mm(8000), 0, -deg(20)),
    line(3000, -tanDeg(20, 3000)),
    bend(mm(8000), -deg(20), 0),
    line(6000, 0),
  ],
}

// [S3, 28.5–38 s] 높은 혹 두 개: 부스터 4 m 뒤 높이 약 9 m(4.5대)의 혹 둘. 옆면 70°, 꼭대기는 반지름 4 m 볼록.
// 부스터 속도로만 넘는다(녹화도 부스터 직후).
const hump = (): Prim[] => [
  bend(mm(4000), 0, deg(70)),
  line(1400, tanDeg(70, 1400)),
  bend(mm(4000), deg(70), -deg(70)),
  line(1400, -tanDeg(70, 1400)),
  bend(mm(4000), -deg(70), 0),
]
const humps: Template = {
  id: 'humps',
  tier: 3,
  prims: [line(3000, 0), boost(4000), line(3000, 0), ...hump(), line(1000, 0), ...hump(), line(6000, 0)],
}

// [S22, 293.6–300.6 s] 물결 오르막 → 킥커: 반지름 8 m·35° S자 두 개로 5.8 m 올라 오목호(5 m)로 60°에서 끊김
// → 6 m 아래(시작보다 약 2.3 m 위) 평지.
const sCurve = (): Prim[] => [bend(mm(8000), 0, deg(35)), bend(mm(8000), deg(35), 0), line(1000, 0)]
const sinuous: Template = {
  id: 'sinuous',
  tier: 3,
  prims: [line(4000, 0), ...sCurve(), ...sCurve(), bend(mm(5000), 0, deg(60)), gap(6000, -6000), line(10000, 0)],
}

// [S29, 271.5–273.5 s] 떠 있는 ▽ 발판: 오목호(5 m)로 60°까지 2.5 m 오르는 킥커 → 2.5 m 앞·1.2 m 위에 윗변 6 m(3대)·깊이 3 m
// 역삼각(윗변에 보석 4개, 아래는 비어 있음) → 그 앞 2.5 m, 킥커 끝보다 1.2 m 낮은 평지.
// 녹화의 윗변은 킥커 끝보다 약 2.7 m 위지만 V_MAX 이륙으로는 닿지 않아(앞 모서리에 부딪힘) 1.2 m로 낮췄다.
// 역삼각은 윗변(왼→오) → 오른쪽 변(아래 왼쪽으로) → 왼쪽 변(위 왼쪽으로)으로 거꾸로 그리고, 앞으로 gap해서 평지로 간다.
const vplat: Template = {
  id: 'vplat',
  tier: 3,
  prims: [
    line(4000, 0),
    bend(mm(5000), 0, deg(60)),
    gap(2500, 1200),
    gem(750, 500),
    gem(2250, 500),
    gem(3750, 500),
    gem(5250, 500),
    line(6000, 0),
    line(-3000, -3000),
    line(-3000, 3000),
    gap(8500, -2400),
    line(10000, 0),
  ],
}

// 떠 있는 원호(컬·나선·갈고리). 펜(H, 길 위)에서 1 mm 앞·h 위가 호의 오른쪽 아래 끝이고, 반시계로 꼭대기를 지나 왼쪽 끝까지 긋는다.
// 그다음 H 바로 앞(3 mm)으로 돌아와 길을 잇는다(gap은 앞으로만, 호는 길 위에 떠 있다). 호 안쪽(0.5 m)에 보석 5개.
// 녹화에서 차는 앞 봉우리·킥커에서 날아 이 호 안쪽을 타고 돌았다. 여기서는 길이 호 아래로 이어져 있어 호를 타지 않고도 지나가고,
// 더 빠르게 날아 호 안쪽에 닿으면 보석을 줍는 보너스 길이 된다(V_MAX로는 닿지 않는다. 손맛 확인 때 높이를 다시 본다).
function floatArc(r: number, a0: number, a1: number, h: number): Prim[] {
  const g = (k: number): Prim => ({ t: 'gem', ...onArc(r, a0, a0 + Math.floor(((a1 - a0) * k) / 6), mm(500)) })
  const ex = arcPoint(0, 0, r, a1).x - arcPoint(0, 0, r, a0).x
  const ey = arcPoint(0, 0, r, a1).y - arcPoint(0, 0, r, a0).y
  return [gap(1, h), g(1), g(2), g(3), g(4), g(5), { t: 'arc', r, a0, a1 }, { t: 'gap', dx: -ex + mm(2), dy: -ey - mm(h) }]
}

// [S24, 165.5–170.6 s] 열린 고리(컬): S자 내리막(2.2 m) → 평지 3 m → 30° 뾰족 봉우리(1.15 m) → V 바닥 → 30° 직선 오르막 → 평지.
// V 바닥 위 3.2 m에 반지름 3.6 m(1.8대)의 원호(−20° → 꼭대기 → 200°, 아래가 열림)가 떠 있다.
const curl: Template = {
  id: 'curl',
  tier: 3,
  prims: [
    line(4000, 0),
    bend(mm(6000), 0, -deg(35)),
    bend(mm(6000), -deg(35), 0),
    line(3000, 0),
    line(2000, tanDeg(30, 2000)),
    line(2000, -tanDeg(30, 2000)),
    line(2000, 0),
    ...floatArc(mm(3600), -deg(20), deg(200), 3200),
    line(4000, 0),
    line(4000, tanDeg(30, 4000)),
    line(5000, 0),
  ],
}

// [S26, 77–80 s] 갈고리 컬: 둥근 턱 → 컵(반지름 2.5 m, 오른쪽 테두리 60°) → 테두리 위 1.8 m에 반지름 2.2 m의 물음표 모양 원호(−30° → 160°)
// → 틈 2.5 m → 35° 직선 내리막 → 평지. 녹화에서 차는 갈고리 끝에서 위로 튀어 거꾸로 돈 뒤 오른쪽 컵에 내렸다.
const hook: Template = {
  id: 'hook',
  tier: 3,
  prims: [
    line(4000, 0),
    bend(mm(2000), 0, -deg(60)),
    bend(mm(2500), -deg(60), deg(60)),
    ...floatArc(mm(2200), -deg(30), deg(160), 1800),
    gap(2500, 0),
    line(4500, -tanDeg(35, 4500)),
    bend(mm(6000), -deg(35), 0),
    line(6000, 0),
  ],
}

// ---- tier 4 ----

// [S30, 316.8–321.2 s] 떠 있는 호 징검다리: 점프대에서 떠서 오목 호(가운데가 낮은 짧은 그릇) 3개를 차례로 건넌다.
// 각 호는 내려가며 받아 주고(-30°) 올라가며 다음 호로 던진다(+30°). 호는 1.5 m 틈마다 1 m씩 낮아진다:
// 진입 속도가 0 ~ BOOST_V 어디든 날아간 궤적이 틈에 빠지지 않고 뒤의 호나 착지 평지에 걸린다.
// 녹화의 톱날 원반 배열(M3)은 넣지 않았다.
const ARC_R = mm(5000)
const ARC_A = deg(30)
const ARC_GAP = 1500
const ARC_DROP = 1000
const hop = (): Prim => bend(ARC_R, -ARC_A, ARC_A)
const arcs: Template = {
  id: 'arcs',
  tier: 4,
  prims: [line(6000, 0), bend(mm(5000), 0, ARC_A), gap(ARC_GAP, -ARC_DROP), hop(), gap(ARC_GAP, -ARC_DROP), hop(), gap(ARC_GAP, -ARC_DROP), hop(), gap(ARC_GAP, -ARC_DROP), line(16000, 0)],
}

// [S27, 81–87 s] 연속 루프: 루프 두 개 뒤 높은 점프대. 녹화의 '9'자 고리 두 개는 움직이는 노란 조각(M6)으로 이어지는데,
// 그 조각이 이어 준 자리를 고정된 길로 두면 닫힌 루프 두 개가 된다.
const loop2: Template = {
  id: 'loop2',
  tier: 4,
  prims: [line(6000, 0), bend(mm(3500), 0, TURN), line(4000, 0), bend(mm(4000), 0, TURN), line(8000, 0), line(6000, 1500), gap(5000, -2000), line(16000, 0)],
}

// [S25, 275.6–278.6 s] 큰 나선: 30° 봉우리(1.7 m) 너머 골짜기 위 3.5 m에 반지름 5.5 m(2.75대)의 원호(−40° → 꼭대기 → 200°).
const spiral: Template = {
  id: 'spiral',
  tier: 4,
  prims: [
    line(4000, 0),
    bend(mm(6000), 0, -deg(35)),
    bend(mm(6000), -deg(35), 0),
    line(3000, 0),
    line(3000, tanDeg(30, 3000)),
    line(3000, -tanDeg(30, 3000)),
    line(4000, 0),
    ...floatArc(mm(5500), -deg(40), deg(200), 3500),
    line(6000, 0),
    line(4000, tanDeg(30, 4000)),
    line(5000, 0),
  ],
}

export const TEMPLATES: readonly Template[] = [
  // tier 1
  hill, waves, bowl, boostflat, spikes, valley, cliff, ledge, bigdrop, rampflat, ramp,
  // tier 2
  cup, quarter, boostjump, spikefloor, spikepit, roofs, stepup, crestgap, stairs, bowldrop,
  // tier 3
  loop, humps, sinuous, vplat, curl, hook,
  // tier 4
  arcs, loop2, spiral,
].map((t) => ({ ...t, trimFlats: true }))

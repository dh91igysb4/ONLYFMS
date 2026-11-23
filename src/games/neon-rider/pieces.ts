// 장애물 템플릿 → 선분. 순수 정수 TS (설계 §6). 좌표 x 앞, y 위, 단위 u.
import type { BlockDef } from './blocks.ts'
import { LEAD_FLAT_MAX, MM, SEG_LEN, TAIL_FLAT_MAX } from './constants.ts'
import type { HazardDef, HazardLook, HazardShape } from './hazards.ts'
import type { Key, Motion } from './motion.ts'
import type { MoverDef, MoverLook, MoverStart } from './movers.ts'
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

// 위험물 prim. 위치·치수는 mm, 각도는 TURN. 기준점은 펜 + (dx, dy)이고 도형은 그 점에 놓인다(설계 §4.3).
const STILL: Motion = { k: 'none' }
const hazard = (dx: number, dy: number, shape: HazardShape, motion: Motion, look: HazardLook): Prim => ({ t: 'hazard', dx: mm(dx), dy: mm(dy), h: { shape, motion, look } })
const saw = (dx: number, dy: number, r: number, motion: Motion = STILL): Prim => hazard(dx, dy, { s: 'disc', x: 0, y: 0, r: mm(r) }, motion, 'saw')
// 도는 날 n개(폭 w TURN). 시작각 a0, 각속도 w TURN/틱(음수면 시계 방향).
const blades = (dx: number, dy: number, rIn: number, rOut: number, n: number, width: number, a0: number, w: number, look: HazardLook): Prim =>
  hazard(dx, dy, { s: 'blades', x: 0, y: 0, rIn: mm(rIn), rOut: mm(rOut), n, w: width }, { k: 'rotate', a0, w }, look)

// 움직이는 길 prim(설계 §4.3·§6). 기준점은 펜 + (dx, dy)(mm)이고, 선분·회전 중심은 그 점 기준 u 좌표다.
// 구동은 선분 방향으로 밀므로(sim.ts pushAlong) 차가 탈 선분은 차가 지나가는 방향(왼쪽 → 오른쪽)으로 놓는다.
const P = (x: number, y: number): { x: number; y: number } => ({ x, y })
const segOf = (a: { x: number; y: number }, b: { x: number; y: number }): Seg => ({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, boost: false })
const mover = (dx: number, dy: number, segs: Seg[], pivot: { x: number; y: number }, motion: Motion, start: MoverStart, look: MoverLook = 'yellow'): Prim =>
  ({ t: 'mover', dx: mm(dx), dy: mm(dy), m: { segs, pivotX: pivot.x, pivotY: pivot.y, motion, start, look } })
// 중심 (cx, cy)·반지름 r(u)인 원 위 a0 → a1(TURN) 호를 선분으로(buildTemplate의 arc와 같은 나눔). a1 > a0이면 반시계, 선분 방향도 a0 → a1.
function arcSegs(cx: number, cy: number, r: number, a0: number, a1: number): Seg[] {
  const n = arcCount(r, a1 - a0)
  const out: Seg[] = []
  let q = arcPoint(cx, cy, r, a0)
  for (let i = 1; i <= n; i++) {
    const e = arcPoint(cx, cy, r, a0 + Math.floor(((a1 - a0) * i) / n))
    out.push(segOf(q, e))
    q = e
  }
  return out
}
const turnKeys = (...ks: [number, number][]): Motion => ({ k: 'keys', keys: ks.map(([t, a]): Key => ({ t, dx: 0, dy: 0, a })) })
// 넘어지는 블록: 펜에서 dx(mm) 앞, 길 위에 선 너비 w·높이 h(mm) 상자(바닥 변 가운데가 기준점).
const block = (dx: number, w: number, h: number): Prim => ({ t: 'block', dx: mm(dx), dy: 0, b: { x: 0, y: 0, w: mm(w), h: mm(h), a: 0 } })

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
// 골 위의 빨간 톱니 둘(M3): 첫 골 위 높이 뜬 큰 톱니(62–63.5 s, 지름 약 4.5대, 아래 끝이 골에서 약 2.7대 위)와
// 둘째 골 위 톱니(216–217.75 s, 지름 약 2.2대, 아래 끝이 마루 높이쯤. 녹화에서는 마루에서 뜬 차가 여기 박혀 죽었다).
// 길을 따라 달리면(V_MAX에서 바퀴가 뜨지 않는다) 닿지 않고, 마루에서 뜨면 닿는다.
const WAVE_R = mm(10000)
const WAVE_A = deg(20)
const WAVE_HALF = 3410 // 호 하나의 가로 절반(mm): 호 끝(변곡점)에서 골·마루까지
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
    saw(WAVE_HALF, 9400, 4500), // 첫 골 위
    bend(WAVE_R, -WAVE_A, WAVE_A),
    bend(WAVE_R, WAVE_A, -WAVE_A),
    saw(WAVE_HALF, 3200, 2250), // 둘째 골 위
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
// 비행 경로 위·아래의 빨간 톱니(M3, 54·156.5–158·285.5–287.5 s): 킥커 앞 위쪽의 큰 톱니(지름 약 2.5대)와 틈 가운데 아래쪽 톱니.
// 궤적(차 중심)에서 톱니 가장자리까지 약 2 m라 공중에서 돌아도 닿지 않는다(차 중심에서 차 끝까지 약 1 m).
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
    saw(5500, 7000, 2500),
    saw(13000, -1700, 1800),
    gap(17000, -1500),
    line(10000, -3640),
    bend(mm(12000), -deg(20), deg(10)),
    line(20000, 3527),
    bend(mm(10000), deg(10), 0),
    line(10000, 0),
  ],
}

// [S19, 181.4–182 s] 가시 구덩이: S자(반지름 7.5 m, 30°)로 2 m 올라선 고원 3 m → 너비 5.2 m(2.6대)·깊이 4.6 m(2.3대)의 네모 구덩이
// → 2.4 m 낮은 반대편 2 m → S자 내리막 → 평지. 녹화의 구덩이는 6.3 m(3.2대)이지만 V_MAX 수평 비행(2.4 m 떨어지는 동안 약 5.8 m)으로는
// 앞바퀴가 반대편 모서리에 걸려 5.2 m로 줄였다. 구덩이 바닥은 길로 메우고 그 위 전체에 빨간 가시 막대(높이 0.4 m)를 얹는다.
// 막대 양 끝은 벽에서 0.1 m 안쪽이라 벽(옆 길)에 닿지 않는다. 빠지면 가시에 닿아 crash.
const PIT_W = 5200
const PIT_SPIKE_R = 200
const PIT_SPIKE_IN = PIT_SPIKE_R + 100 // 벽에서 막대 끝점까지
const spikepit: Template = {
  id: 'spikepit',
  tier: 2,
  prims: [
    line(4000, 0),
    bend(mm(7500), 0, deg(30)),
    bend(mm(7500), deg(30), 0),
    line(3000, 0),
    line(0, -4600),
    hazard(0, 0, { s: 'bar', x0: mm(PIT_SPIKE_IN), y0: mm(PIT_SPIKE_R), x1: mm(PIT_W - PIT_SPIKE_IN), y1: mm(PIT_SPIKE_R), r: mm(PIT_SPIKE_R) }, STILL, 'spikes'),
    line(PIT_W, 0),
    line(0, 2200),
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
// 빨간 톱니(M3) 둘: 틈 안, 턱보다 약 0.75 m 아래가 위 끝인 톱니(32.5 s, 지름 약 1.3대)와 건너편 위 높이 뜬 톱니(213–215.5 s).
const crestgap: Template = {
  id: 'crestgap',
  tier: 2,
  prims: [
    line(4000, 0),
    bend(mm(8000), 0, deg(30)),
    bend(mm(8000), deg(30), deg(15)),
    saw(2500, -2050, 1300),
    saw(6570, 3200, 1300),
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

// [M3, 316.8–320.5 s] 톱니 밭: 부스터 4 m → 30° 짧은 직선 킥커(부스터 킥커 S9) → 공중에 빨간 톱니 9개가 엇갈린 줄로 떠 있고
// 그 사이로 날아간다 → 공중에서 시작하는 35° 직선 내리막(S30, 318.5 s)에 내려 평지로. 톱니 지름 약 1.6대.
// 부스터가 진입 속도와 상관없이 BOOST_V로 올려 주므로 궤적이 늘 같다. 톱니는 궤적(차 중심)에서 가장자리까지 1.5 m 넘게 띄웠다.
const sawfield: Template = {
  id: 'sawfield',
  tier: 2,
  prims: [
    line(4000, 0),
    boost(4000),
    line(2000, tanDeg(30, 2000)),
    // 킥커 끝 기준. 궤적 위 줄(+3.6 m)·아래 줄(−3.6 m)이 엇갈리고, 더 위(+8 m)와 더 아래(−8 m)에 몇 개
    saw(4000, 5650, 1600),
    saw(9500, 6800, 1600),
    saw(15000, 6350, 1600),
    saw(6500, -800, 1600),
    saw(12000, -400, 1600),
    saw(17500, -1550, 1600),
    saw(9000, -4850, 1600),
    saw(14500, -5150, 1600),
    saw(12000, 11150, 1600),
    gap(21500, -1650),
    line(3000, -tanDeg(35, 3000)),
    bend(mm(8000), -deg(35), 0),
    line(8000, 0),
  ],
}

// [위키 5쪽(2점), M3] 왕복 톱니: S자로 1.5 m 내려간 골 위에서 큰 빨간 톱니(지름 5 m, 약 2.5대)가 2초마다 위아래로 오간다.
// 위키 그림은 골 위에 떠 있는 큰 톱니이고, 본문에 "움직이며 왕복운동을 할 때도 있으니 주의하도록 하자"고 되어 있다.
// 가장 낮을 때는 길을 막고, 가장 높을 때는 아래 끝이 길 위 3.4 m다. V_MAX 도착 때 12위상 중 10에서 지나간다.
const SWING_R = 2500
const SWING_HALF = 3381 // 골 호 시작에서 골 바닥까지 가로(8 m · sin 25°)
const SWING_LOW = 1950 // 가장 낮을 때 톱니 중심: 골 바닥(호 시작보다 0.75 m 아래) 위 2.7 m. 아래 끝이 길 위 0.2 m라 차를 막는다
const SWING_RISE = 3200 // 가장 높을 때 아래 끝이 길 위 3.4 m
const SWING_P = 120
const sawswing: Template = {
  id: 'sawswing',
  tier: 2,
  prims: [
    line(5000, 0),
    bend(mm(8000), 0, -deg(25)),
    saw(SWING_HALF, SWING_LOW, SWING_R, { k: 'swing', ax: 0, ay: mm(SWING_RISE), period: SWING_P, phase: 0 }),
    bend(mm(8000), -deg(25), deg(25)),
    bend(mm(8000), deg(25), 0),
    line(8000, 0),
  ],
}

// [위키 10·11쪽(16·49점)] 배럴형 바퀴: 45° 직선 오르막(4.8 m)이 공중에서 끊김 → 틈 → 같은 높이에서 시작하는 45° 내리막 → 평지.
// 틈 위에 마주 보는 두 부채꼴(나비넥타이, 각 100°) 모양 빨간 바퀴 둘이 위아래로 놓여 함께 돈다. 아래 바퀴 중심은 턱보다 약 1.2 m 아래,
// 위 바퀴는 약 7.5 m 위, 반지름 약 2.4 m(1.2대). 위키: "그냥 넘어갈 수 있다", "충분히 속도를 낸 후 돌지만 않으면 타이밍과 상관없이 건널 수 있다".
const BARREL_GAP = 6500
const barrel: Template = {
  id: 'barrel',
  tier: 2,
  prims: [
    line(4000, 0),
    line(4800, 4800),
    blades(BARREL_GAP / 2, -1200, 0, 2400, 2, deg(100), 0, 23, 'blades'),
    blades(BARREL_GAP / 2, 7500, 0, 2400, 2, deg(100), 0, 23, 'blades'),
    gap(BARREL_GAP, 0),
    line(4000, -4000),
    bend(mm(6000), -deg(45), 0),
    line(8000, 0),
  ],
}

// [M4, 280.5–281.9 s] 팩맨 원반: 37° 직선 오르막(3.5 m)이 공중에서 끊김 → 틈 → 같은 높이에서 시작하는 37° 내리막(3.7 m) → 평지.
// 오르막 끝 옆(틈 위)에 빨간 원반 둘이 위아래로 놓여 돈다. 아래 원반 중심은 턱보다 0.9 m 아래, 위 원반은 5.6 m 위, 반지름 1.9 m.
// 녹화에서 확대된 장면(281.3 s)은 입이 뚫린 원반(팩맨)처럼 보이고, 멀리서 본 장면(281.8 s)은 마주 보는 부채꼴처럼 보인다.
// 위키의 배럴형 바퀴(barrel)와 같은 배치라, 여기서는 3/4바퀴 원반(입 90°)으로 만들고 위·아래가 반대로 돈다.
const PAC_GAP = 6000
const pacman: Template = {
  id: 'pacman',
  tier: 2,
  prims: [
    line(4000, 0),
    line(4600, tanDeg(37, 4600)),
    blades(PAC_GAP / 2, -900, 0, 1900, 1, (TURN * 3) / 4, 0, 20, 'pacman'),
    blades(PAC_GAP / 2, 5600, 0, 1900, 1, (TURN * 3) / 4, TURN / 2, -20, 'pacman'),
    gap(PAC_GAP, 0),
    line(4900, -tanDeg(37, 4900)),
    bend(mm(6000), -deg(37), 0),
    line(8000, 0),
  ],
}

// [위키 15~17쪽(23점)] 굽은 길: 45° 직선 오르막(4.8 m)이 공중에서 끊기고, 큰 원호 세 개가 바람개비처럼 놓인다.
// ① 오르막 끝 위의 볼록한 호(반지름 4.5 m) ② 그 오른쪽 아래의 그릇 호(반지름 3.1 m) ③ 그 오른쪽 위의 '(' 모양 호(반지름 3.2 m),
// 그리고 아래의 26° 내리막 → 평지. 위키 그림(1화면 = 9대, 1 m = 40 px)에서 잰 원 중심을 쓴다.
// 차는 오르막에서 날아 ①의 안쪽(천장)에 닿고 ②에 떨어져 그릇을 타고 오른쪽 벽으로 솟아, ③의 열린 쪽 안을 지나 높이 뜬 뒤 내리막에 내린다
// (계속 누르면 공중에서 한 바퀴 돌아 내린다).
// 그림과 다른 점: 틈은 앞으로만 끊겨야 해서(코스 규칙) ①의 왼쪽 끝(오르막 위로 겹치는 부분)과 ②의 왼쪽 벽을 잘랐다. ②는 그림(29°)보다
// 일찍(−10°) 끝내 차가 거의 곧게 솟게 했다(그림대로면 차가 ②에서 왼쪽 위로 날아 ③에 거꾸로 닿는다). ③은 아래 끝이 ②의 끝보다 오른쪽에 오고
// ②의 오른쪽 벽을 타는 차와 1 m 넘게 떨어지도록 중심을 다시 잡았다(그림에서는 ③의 아래 끝이 ②의 벽에서 약 1.5 m 안쪽).
// 호는 모두 차가 지나가는 방향으로 그린다(구동 방향이 선분 방향이다).
const CURVE_A = { cx: 6275, cy: 2200, r: 4500, a0: 108, a1: 48 } // 시계 방향
const CURVE_B = { cx: 10500, cy: 6250, r: 3075, a0: 250, a1: 350 } // 반시계
const CURVE_C = { cx: 14150, cy: 9271, r: 3200, a0: 240, a1: 117 } // 시계
const CURVE_LAND = { x: 14575, y: 2825 }
// 오르막 끝(4800, 4800)에서 시작해 호마다 [그 시작점까지 gap, 호]를 잇고, 마지막에 착지 내리막 시작점까지 gap.
function curveArcs(): Prim[] {
  const out: Prim[] = []
  let px = mm(4800)
  let py = mm(4800)
  for (const c of [CURVE_A, CURVE_B, CURVE_C]) {
    const s = arcPoint(mm(c.cx), mm(c.cy), mm(c.r), deg(c.a0))
    const e = arcPoint(mm(c.cx), mm(c.cy), mm(c.r), deg(c.a1))
    out.push({ t: 'gap', dx: s.x - px, dy: s.y - py }, { t: 'arc', r: mm(c.r), a0: deg(c.a0), a1: deg(c.a1) })
    px = e.x
    py = e.y
  }
  out.push({ t: 'gap', dx: mm(CURVE_LAND.x) - px, dy: mm(CURVE_LAND.y) - py })
  return out
}
const curve: Template = {
  id: 'curve',
  tier: 2,
  prims: [line(4000, 0), line(4800, 4800), ...curveArcs(), line(4000, -tanDeg(26, 4000)), bend(mm(8000), -deg(26), 0), line(8000, 0)],
}

// [위키 17쪽] 스마일: "복잡해 보이는 구조이지만 모양이 스마일이다. 그냥 쭉 눌러주면 지나가지는 쉬운 장애물"(그림 없음, 본문만).
// 얼굴 모양으로 만들었다: 둥근 턱(반지름 4 m)으로 내려가 입 모양 오목호(반지름 9 m, ±30°)를 지나 둥근 턱으로 올라온다.
// 입 위 양쪽(입 가운데에서 ±2.5 m, 바닥 위 약 4.5 m)에 눈 고리(반지름 1 m. 더 작으면 선분 사이 꺾임이 15°를 넘는다), 그 위로 얼굴 윤곽 반원(반지름 6.5 m, 끝이 평지 위 2.5 m)이 떠 있다.
// 떠 있는 고리·반원은 길 위 공중에 있어 계속 누르고 달리면 닿지 않는다.
const SMILE_R = mm(9000)
const SMILE_A = deg(30)
const SMILE_EYE = deg(16) // 입 가운데에서 ±2.5 m(9 m · sin 16°)
// 펜(길 위) 1 mm 앞·h 위가 아래 끝인 반지름 r 고리를 한 바퀴 긋고, 펜 2 mm 앞으로 돌아온다(길에 2 mm 틈).
const eye = (h: number, r: number): Prim[] => [gap(1, h), { t: 'arc', r: mm(r), a0: -Q, a1: TURN - Q }, gap(1, -h)]
const smile: Template = {
  id: 'smile',
  tier: 1,
  prims: [
    line(5000, 0),
    bend(mm(4000), 0, -SMILE_A),
    bend(SMILE_R, -SMILE_A, -SMILE_EYE),
    ...eye(3150, 1000),
    bend(SMILE_R, -SMILE_EYE, SMILE_EYE),
    ...eye(3150, 1000),
    bend(SMILE_R, SMILE_EYE, SMILE_A),
    bend(mm(4000), SMILE_A, 0),
    { t: 'gap', dx: mm(1), dy: mm(2500) },
    { t: 'arc', r: mm(6500), a0: 0, a1: TURN / 2 },
    { t: 'gap', dx: mm(13002), dy: -mm(2500) },
    line(6000, 0),
  ],
}

// ---- tier 3 ----

// [S23, 64.5–67 s] 루프: 완만한 오르막(2 m) → 반지름 3.7 m 루프(안쪽 보석 6개) → 완만한 내리막.
// 입구·출구가 겹치는 루프 아래쪽 선분은 진행 번호로 90개쯤 떨어져 있어 충돌 창(±40) 밖이다.
// 루프 안의 회전하는 빨간 호(M2, 64.8–66.6 s): 루프와 같은 중심, 루프 반지름의 약 0.6배인 원 위의 두꺼운 호 2개(각 약 80°)가
// 0.5초에 약 60° 돈다(23 TURN/틱). 루프를 타는 차(안쪽으로 약 0.56 m)와 호 바깥 사이는 약 0.7 m라, 루프에서 떨어질 때만 닿는다.
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
    blades(0, 3700, 2000, 2400, 2, deg(80), 0, 23, 'ring'),
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

// [위키 13쪽(34점)] 원형 배럴: "가운데가 뚫려있는 원형 배럴. 별로 어렵지 않다. 저 장애물이 나온다면 사진처럼 그냥 밑으로 빠지는 것도 방법".
// 그림처럼 둥근 마루에서 길이 가파르게 깊은 골(약 6 m)로 떨어졌다가 반대편으로 올라온다. 골 위, V_MAX로 마루를 떠난 궤적에
// 가운데가 빈 고리(바깥 반지름 2.4 m, 두께 0.4 m의 호 2개)가 시계 방향으로 천천히(약 11초에 한 바퀴) 돈다. 위키 그림의 호는 70°쯤이지만
// V_MAX 도착 때 절반 넘는 위상에서 지나가도록 50°로 줄였다(12위상 중 7). 고리 틈이 맞을 때 가운데로 날아 지나가거나,
// 떼고 천천히 마루를 넘어 골을 타고 고리 밑으로 빠져나간다. 건너편은 볼록 마루 뒤 35° 내리막이라 V_MAX로 날아온 차가 내리막에 내린다.
const RING_OUT = 2400
const RING_IN = 2000
const RING_W = deg(50)
const ringbarrel: Template = {
  id: 'ringbarrel',
  tier: 3,
  prims: [
    line(4000, 0),
    bend(mm(4000), 0, deg(25)),
    bend(mm(1500), deg(25), -deg(70)),
    blades(2270, 1270, RING_IN, RING_OUT, 2, RING_W, Q, -6, 'ring'), // 마루 끝 기준. V_MAX 궤적이 고리 가운데를 지난다
    line(1200, -tanDeg(70, 1200)),
    bend(mm(2000), -deg(70), deg(65)),
    bend(mm(1500), deg(65), -deg(35)),
    line(6000, -tanDeg(35, 6000)),
    bend(mm(6000), -deg(35), 0),
    line(8000, 0),
  ],
}

// [위키 9쪽(38점)] 길쭉한 창: 물결 길(마루–골 1.3 m, 마루 간격 13.5 m) 밑에서 빨간 창 셋(골·마루·골, 6.7 m 간격)이
// "플레이어의 접근에 상관없이 일정한 시간을 두고 땅 위로 튀어오른다". 창은 길 아래 5 m에서 길 위 2.5 m까지 솟는다(폭 0.2 m).
// 주기 2초(숨음 1초 → 솟음 0.2초 → 서 있음 0.4초 → 내려감 0.4초). 창 사이의 위상 차는 V_MAX로 창 사이를 달리는 시간(약 34틱)이라,
// V_MAX로 달리면 세 창을 같은 위상에서 만난다.
const SPEAR_R = mm(9000)
const SPEAR_A = deg(22)
const SPEAR_HALF = 3371 // 호 하나의 가로 절반(mm): 9 m · sin 22°
const SPEAR_DIP = 655 // 호 하나의 높이(mm): 9 m · (1 − cos 22°)
const SPEAR_LAG = 34 // 틱
const spear = (dy: number, lag: number): Prim =>
  hazard(SPEAR_HALF, dy, { s: 'bar', x0: 0, y0: mm(-5000), x1: 0, y1: mm(-1500), r: mm(100) },
    { k: 'pop', period: 120, phase: -lag, hide: 60, rise: 12, up: 24, fall: 24, height: mm(4000) }, 'spear')
const spears: Template = {
  id: 'spears',
  tier: 3,
  prims: [
    line(5000, 0),
    bend(SPEAR_R, 0, -SPEAR_A),
    spear(-SPEAR_DIP, 0), // 골(호 시작보다 SPEAR_DIP 아래)
    bend(SPEAR_R, -SPEAR_A, SPEAR_A),
    spear(SPEAR_DIP, SPEAR_LAG), // 마루
    bend(SPEAR_R, SPEAR_A, -SPEAR_A),
    spear(-SPEAR_DIP, 2 * SPEAR_LAG), // 골
    bend(SPEAR_R, -SPEAR_A, SPEAR_A),
    bend(SPEAR_R, SPEAR_A, 0),
    line(6000, 0),
  ],
}

// ---- tier 4 ----

// [S30, 316.8–321.2 s] 떠 있는 호 징검다리: 점프대에서 떠서 오목 호(가운데가 낮은 짧은 그릇) 3개를 차례로 건넌다.
// 각 호는 내려가며 받아 주고(-30°) 올라가며 다음 호로 던진다(+30°). 호는 1.5 m 틈마다 1 m씩 낮아진다:
// 진입 속도가 0 ~ BOOST_V 어디든 날아간 궤적이 틈에 빠지지 않고 뒤의 호나 착지 평지에 걸린다.
// 녹화에서 이 앞에 있던 톱날 원반 배열(M3, 318–320 s)은 따로 톱니 밭(sawfield)으로 만들었다.
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

// [S27·M6, 81–87 s] 연속 루프('9'자 고리): 평지에서 오목호(4 m)로 70°까지 휘어 오른 길이 노란 줄기(4.9 m)를 지나 '9'의 머리(반지름 3.5 m)로 들어간다.
// 머리는 줄기 끝에서 반시계로 꼭대기를 지나 290° 돌아, 아래쪽에서 오른쪽을 향해 끝난다(녹화 81.6–82.4 s: 줄기 윗부분이 노랗고 머리 끝은 열려 있다).
// 차가 머리로 들어서면(줄기 끝 x를 넘으면) 줄기가 가운데를 축으로 시계 방향 70° 돌아, 머리 아래 끝과 다음 고리를 잇는 수평 조각이 된다
// (82.6 s 비스듬함 → 83.35 s 수평에 가까움 → 83.6 s 다음 고리로 이어짐). 줄기 길이가 2R·tan(70°/2)이면 줄기의 가운데가 곧 연결 조각의 가운데라
// 회전만으로 두 자리를 잇는다. 그 뒤는 예전처럼 닫힌 고리(4 m) → 높은 점프대. 머리 아래 끝이 들어오는 길보다 약 4.9 m 높다.
// 설계 §6.4 표의 움직임은 rotate·swing(time)이지만, 녹화의 조각은 차가 머리를 도는 동안 한 번 자리를 바꿔서 pass·keys로 만들었다.
const NINE_R = mm(3500)
const NINE_A = deg(70) // 줄기 기울기 = 연결 조각이 되며 도는 각
const NINE_L = Math.floor((2 * NINE_R * sinT(Math.floor(NINE_A / 2))) / cosT(Math.floor(NINE_A / 2)))
const NINE_TOP = arcPoint(0, 0, NINE_L, NINE_A) // 줄기 아래 끝(펜) 기준 위 끝 = 머리 시작
const NINE_MID = P(Math.floor(NINE_TOP.x / 2), Math.floor(NINE_TOP.y / 2))
const NINE_C = P(NINE_TOP.x - arcPoint(0, 0, NINE_R, NINE_A - Q).x, NINE_TOP.y - arcPoint(0, 0, NINE_R, NINE_A - Q).y) // 머리 중심
const NINE_END = arcPoint(NINE_C.x, NINE_C.y, NINE_R, 3 * Q) // 머리 아래 끝
const NINE_NEXT = P(NINE_MID.x + Math.floor(NINE_L / 2), NINE_MID.y) // 연결 조각 오른쪽 끝 = 다음 고리 시작
const NINE_PASS = 300 // 줄기 끝 x보다 이만큼 앞에서 차 중심이 넘으면 센다(mm)
const NINE_DELAY = 20 // 틱: 뒷바퀴가 줄기를 떠날 때까지
const NINE_TURN_T = 30 // 틱: 줄기 → 연결 조각
const loop2: Template = {
  id: 'loop2',
  tier: 4,
  prims: [
    line(6000, 0),
    bend(mm(4000), 0, NINE_A),
    mover(0, 0, [segOf(P(0, 0), NINE_TOP)], NINE_MID, turnKeys([0, 0], [NINE_TURN_T, -NINE_A]), { k: 'pass', x: NINE_TOP.x - mm(NINE_PASS), delay: NINE_DELAY }),
    { t: 'gap', dx: NINE_TOP.x, dy: NINE_TOP.y },
    { t: 'arc', r: NINE_R, a0: NINE_A - Q, a1: 3 * Q },
    { t: 'gap', dx: NINE_NEXT.x - NINE_END.x, dy: NINE_NEXT.y - NINE_END.y },
    bend(mm(4000), 0, TURN),
    line(8000, 0),
    line(6000, 1500),
    gap(5000, -2000),
    line(16000, 0),
  ],
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

// [위키 12쪽(91점), 36쪽 '여담'] 환풍기: 평지 길이 빨간 환풍기 위를 지난다. 위키 그림의 환풍기는 마주 보는 날 2개(각 약 75°)와
// 가운데 둥근 축이고, 중심이 길 아래(반지름의 약 절반)에 있어 위쪽 날이 길 위로 솟는다. 위키: "환풍기가 배럴형 끝판왕. 일단 살아남을
// 확률이 적다", "환풍기가 연속으로 두 개가 이어지는 코스가 있는데, 하나를 넘어가고 속도가 줄어들어야 안정적으로 넘어갈 수 있다".
// 그래서 환풍기 둘을 12 m 간격으로 둔다. 날(반지름 3.5 m, 각 65°)은 시계 방향(길 위에서 차와 같은 방향)으로 돈다.
// 중심을 길 2.5 m 아래에 두어 날이 길 위로 1 m 솟는다(그림은 약 2 m). 그림대로면 어떤 위상에서도 거의 지나갈 수 없어 낮췄다.
// 그래도 V_MAX 도착 때 지나가는 위상은 12개 중 5개로 절반에 못 미친다(가장 어려운 tier 4, 위키도 "살아남을 확률이 적다").
// V_MAX로 달리면 두 환풍기 사이(12 m, 약 66틱)에 날이 반 바퀴쯤 돌아 둘째 환풍기를 거의 같은 위상에서 만난다.
const FAN_R = 3500
const FAN_DEPTH = 2500 // 길에서 환풍기 중심까지
const FAN_GAP = 12000
const fan = (): Prim => blades(0, -FAN_DEPTH, 0, FAN_R, 2, deg(65), 0, -32, 'blades')
const fans: Template = {
  id: 'fans',
  tier: 4,
  // 환풍기 자리마다 길에 1 mm 틈: 앞뒤 평지 자르기(trimFlats)가 길 전체를 맨 평지로 보지 않게 한다
  prims: [line(6000, 0), fan(), gap(1, 0), line(FAN_GAP, 0), fan(), gap(1, 0), line(8000, 0)],
}

// ---- 움직이는 길·블록 (설계 §6·§7·§9) ----

// [M8, 237.6–239.5 s] 노란 평지: 평지 끝에 길 높이로 이어진 노란 토막(4 m, 약 2대). 차가 올라타면 왼쪽에서 80% 지점을 축으로
// 시계 방향으로 넘어가 선다(238.77 s 약 −10°, 238.9 s 약 −70°). 축 왼쪽에 실린 차는 위로 튕겨 올라(녹화: 높이 떠 공중제비 두 번)
// 2.3 m 낮은 앞 평지에 내린다. 설계 §6.4 표는 swing·time이지만 녹화는 밟으면 넘어지는 판이라 touch·keys로 만들었다.
// 밟힌 뒤 4틱부터 6틱 동안 4°만 기울고(뒷바퀴가 판에 올라설 때까지. 일찍 크게 돌면 판의 왼쪽 끝이 차체를 쳐 올려 crash),
// 다음 8틱에 75°까지 넘어간다(빠른 날 조건 안에서 가장 빠르게). V_MAX로 오면 약 3 m 튀어 오른다.
// 녹화에서는 판이 판 시작(점수 0)에 나왔고, 넘어간 판은 비스듬히 선 채로 남는다(아래 끝이 길 0.8 m 아래, 앞 평지보다 높다).
const FLAT_L = 4000
const FLAT_PIVOT = 3200
const yellowflat: Template = {
  id: 'yellowflat',
  tier: 1,
  prims: [
    line(6000, 0),
    mover(0, 0, [segOf(P(0, 0), P(mm(FLAT_L), 0))], P(mm(FLAT_PIVOT), 0), turnKeys([0, 0], [6, -deg(4)], [14, -deg(75)]), { k: 'touch', delay: 4 }),
    gap(FLAT_L + 1500, -2300),
    line(12000, 0),
  ],
}

// 일회성 도로(위키 7쪽, 녹화 M1): 길이 점선 조각으로 바뀐 너비 w(mm) 구덩이. 조각은 밟히면 곧(3틱) 조금씩 기울며 떨어진다(fall, 조각마다 touch).
// 구덩이(깊이 4.5 m, 녹화 약 2.3대) 바닥에는 빨간 가시 띠(가시 구덩이와 같은 막대, 벽에서 0.1 m 안쪽)를 길 위에 얹는다. 빠지면 가시에 닿아 crash.
// 조각 약 0.77 m·틈 0.08 m(녹화: 조각 약 0.35대, 틈 약 0.1대 = 0.2 m. 틈이 0.1 m를 넘으면 손을 뗀 차가 조각 모서리마다 튀어 올라 속도를 잃어 좁혔다).
// 밟힌 뒤 10틱에 떨어지기 시작해 V_MAX로 지나는 차의 뒷바퀴까지는 받쳐 주고, 느리면 차 밑에서 떨어진다. 녹화에서 뒤쪽 조각부터 왼쪽 끝이 내려가며 떨어진다.
const OT_DEPTH = 4500
const OT_PITCH = 850
const OT_GAP = 80
const OT_DELAY = 10 // 위키: "닿으면 그 즉시 중력을 따르게 되며, 느리게 통과할 경우 떨어져 죽을 수 있으니"
const OT_TILT = 3 // TURN/틱, 반시계(왼쪽 끝이 내려감)
function crumble(w: number): Prim[] {
  const n = Math.floor((w + OT_PITCH / 2) / OT_PITCH)
  const out: Prim[] = []
  for (let k = 0; k < n; k++) {
    const x0 = Math.floor((w * k) / n) + OT_GAP / 2
    const len = Math.floor((w * (k + 1)) / n) - OT_GAP / 2 - x0
    out.push(mover(x0, 0, [segOf(P(0, 0), P(mm(len), 0))], P(Math.floor(mm(len) / 2), 0), { k: 'fall', w: OT_TILT }, { k: 'touch', delay: OT_DELAY }))
  }
  return out
}
const crumblePit = (w: number): Prim[] => [
  ...crumble(w),
  line(0, -OT_DEPTH),
  hazard(0, 0, { s: 'bar', x0: mm(PIT_SPIKE_IN), y0: mm(PIT_SPIKE_R), x1: mm(w - PIT_SPIKE_IN), y1: mm(PIT_SPIKE_R), r: mm(PIT_SPIKE_R) }, STILL, 'spikes'),
  line(w, 0),
  line(0, OT_DEPTH),
]

// [위키 7쪽(10점), M1 26.5–28·282.6–284.6 s] 일회성 도로: 평지 사이 너비 12 m(6대) 구덩이 하나를 점선 조각 14개가 잇는다.
// 위키: "느리게 통과할 경우 떨어져 죽을 수 있으니 주의하라".
const onetime: Template = {
  id: 'onetime',
  tier: 2,
  prims: [line(6000, 0), ...crumblePit(12000), line(8000, 0)],
}

// [M1, 73.3–74.5 s] 일회성 도로 두 덩어리: 너비 8 m·7 m(4대·3.5대) 구덩이 둘 사이에 고정 길 4 m(약 2대).
const onetime2: Template = {
  id: 'onetime2',
  tier: 2,
  prims: [line(5000, 0), ...crumblePit(8000), line(4000, 0), ...crumblePit(7000), line(8000, 0)],
}

// [위키 6쪽(8점)] 스위치 도로 + 레이저: 오르막 끝(V)에서 노란 스위치가 위로 열린 원(반지름 4 m)의 오른쪽 아래 끝으로 이어진다.
// 차는 스위치를 타고 원으로 올라 반시계로 꼭대기를 돌아 왼쪽 아래 끝으로 내려온다. 그동안 스위치가 돌아(밟힌 뒤 40틱부터 40틱 동안)
// 원의 왼쪽 아래 끝에서 V로 내려가는 길이 되고, 차는 V에서 내리막으로 나간다(위키 그림: 스위치가 V에서 왼쪽 위 원 끝으로 놓인 뒤의 모습).
// 위키: "닿으면 일정 시간 후 지정 경로로 이동된다… 가던 도중 실수로 손을 놓아 버리면 그대로 떨어져 레이저에 닿아서 터져 죽는다".
// 그림의 원 안 빨간 두꺼운 호 둘(각 약 70°, 원 반지름의 약 0.6배)을 그대로 두고(멈춰 있음), 원 아래·스위치 밑에 가로 레이저를 놓는다.
// 그림과 다른 점: 원 반지름(그림 약 5 m)을 4 m로 줄였고(5 m는 V_MAX로 꼭대기를 못 돈다), 스위치가 원 끝의 접선과 같은 기울기(34°)가 되게
// 원 끝 자리를 정했다. 스위치는 V가 아니라 V 위의 점을 축으로 돈다: 그래야 선분 방향(구동 방향, sim.ts pushAlong)이 돈 뒤에도 앞을 향한다.
const SW_R = mm(4000)
const SW_A = deg(34) // 스위치 기울기
const SW_END = Q - SW_A // 원 끝점의 각(아래 세로선에서 ±): 여기서 원의 접선 기울기가 SW_A
const SW_L = Math.floor((SW_R * sinT(SW_A)) / cosT(SW_A)) // 스위치 길이
const SW_TIP = arcPoint(0, 0, SW_L, SW_A) // V 기준 원 오른쪽 아래 끝
const SW_CY = SW_TIP.y - arcPoint(0, 0, SW_R, -SW_END).y // V 기준 원 중심 높이(중심 x는 V와 같다)
const SW_CX = SW_TIP.x - arcPoint(0, 0, SW_R, -SW_END).x
const SW_LEFT = arcPoint(SW_CX, SW_CY, SW_R, TURN / 2 + SW_END) // 원 왼쪽 아래 끝
const SW_PIVOT = P(0, Math.floor((SW_L * TRIG_ONE) / (2 * sinT(SW_A)))) // V를 원 왼쪽 끝으로, 원 오른쪽 끝을 V로 옮기는 회전의 중심
const switchroad: Template = {
  id: 'switchroad',
  tier: 2,
  prims: [
    line(5000, 0),
    bend(mm(6000), 0, SW_A),
    line(1500, tanDeg(34, 1500)),
    // 여기가 V
    mover(0, 0, [segOf(P(0, 0), SW_TIP)], SW_PIVOT, turnKeys([0, 0], [40, -2 * SW_A]), { k: 'touch', delay: 40 }),
    { t: 'hazard', dx: SW_CX, dy: SW_CY, h: { shape: { s: 'blades', x: 0, y: 0, rIn: mm(2100), rOut: mm(2500), n: 2, w: deg(70) }, motion: { k: 'rotate', a0: -deg(35), w: 0 }, look: 'ring' } },
    hazard(0, -3000, { s: 'bar', x0: mm(-2500), y0: 0, x1: mm(2500), y1: 0, r: mm(50) }, STILL, 'laser'),
    { t: 'gap', dx: SW_TIP.x, dy: SW_TIP.y },
    { t: 'arc', r: SW_R, a0: -SW_END, a1: TURN / 2 + SW_END },
    { t: 'gap', dx: -SW_LEFT.x, dy: -SW_LEFT.y },
    line(2500, -tanDeg(34, 2500)),
    bend(mm(6000), -SW_A, 0),
    line(2000, 0),
    // 원 꼭대기(약 11 m)에서 내려온 속력(약 5700 u/틱)을 BOOST_V 아래로 줄이는 오르막
    bend(mm(8000), 0, deg(25)),
    line(4000, tanDeg(25, 4000)),
    bend(mm(24000), deg(25), 0), // 큰 반지름 마루: 그 속력에서도 바퀴가 뜨지 않는다
    line(6000, 0),
  ],
}

// [위키 21쪽(12점)] 원숭이 꼬리: "스위치 도로처럼 자동차가 지나가면 도로의 방향이 바뀐다". 그림은 오르막 끝이 '9'처럼 위로 말린 꼬리이고,
// 말리기 시작하는 토막만 색이 다르다. 30° 오르막 끝의 노란 토막(3 m)이 처음에는 75°로 서서 말린 꼬리(반지름 2.5 m 원호, 위에 떠 있음)로 이어지다가,
// 차가 오르막을 오르면(차 중심이 토막 3.2 m 앞을 넘으면) 아래 끝을 축으로 24틱 동안 시계 방향 50° 돌아 25° 킥커가 된다.
// V_MAX로 오면 앞바퀴가 토막에 닿은 뒤 몇 틱 더 돌다 멈춘다(길이 바뀌는 것이 보인다).
// 차는 킥커에서 날아 앞의 30° 내리막에 내린다. 말린 꼬리는 길 위에 떠 있어 닿지 않는다.
const TAIL_LEN = 3000
const TAIL_UP = deg(75)
const TAIL_DOWN = deg(25)
const TAIL_R = mm(2500)
const TAIL_TIP = arcPoint(0, 0, mm(TAIL_LEN), TAIL_UP)
const TAIL_C = P(TAIL_TIP.x - arcPoint(0, 0, TAIL_R, TAIL_UP - Q).x, TAIL_TIP.y - arcPoint(0, 0, TAIL_R, TAIL_UP - Q).y)
const TAIL_END = arcPoint(TAIL_C.x, TAIL_C.y, TAIL_R, TURN / 2)
const TAIL_LIP = arcPoint(0, 0, mm(TAIL_LEN), TAIL_DOWN)
const TAIL_LAND = P(TAIL_LIP.x + mm(4000), TAIL_LIP.y - mm(500))
const monkeytail: Template = {
  id: 'monkeytail',
  tier: 2,
  prims: [
    line(5000, 0),
    bend(mm(8000), 0, deg(30)),
    line(4000, tanDeg(30, 4000)),
    mover(0, 0, [segOf(P(0, 0), TAIL_TIP)], P(0, 0), turnKeys([0, 0], [24, TAIL_DOWN - TAIL_UP]), { k: 'pass', x: mm(-3200), delay: 0 }),
    { t: 'gap', dx: TAIL_TIP.x, dy: TAIL_TIP.y },
    { t: 'arc', r: TAIL_R, a0: TAIL_UP - Q, a1: TURN / 2 },
    { t: 'gap', dx: TAIL_LAND.x - TAIL_END.x, dy: TAIL_LAND.y - TAIL_END.y },
    line(6000, -tanDeg(30, 6000)),
    bend(mm(8000), -deg(30), 0),
    line(8000, 0),
  ],
}

// [위키 14쪽(67점)] 오메가 점프: "오메가 모양의 점프대. 배럴처럼 돌아간다. 위쪽으로 가서 뒷바퀴로만 점프하면 쉽게 넘어갈 수 있다".
// 그림: 노란 Ω(둥근 머리 반지름 약 3.2 m, 양쪽 발 약 1.1 m)가 떠 있고 그 밑은 어두운 구덩이, 오른쪽 아래(약 4 m)에 평지가 이어진다.
// Ω는 발(0.8 m) → 오목호(1.2 m, 0 → 60°) → 볼록 머리(반지름 3.2 m, 120°) → 오목호 → 발로 만들고, 머리 중심을 축으로 시계 방향으로
// 천천히(약 11초에 한 바퀴) 돈다. 그림의 다리는 거의 수직이지만 머리의 적도 밑은 차가 탈 수 없는 처마라 머리를 120°로 줄이고 다리를 오목호로 이었다.
// 그림의 평지(발 높이)로는 발이 길 높이에 올 때만 올라설 수 있어(시계 방향으로 돌면 왼발이 들린다) 25° 오르막(1.5 m)으로 바꾸고,
// Ω 꼭대기를 턱보다 0.3 m 위에 두어 "위쪽으로 가서" 머리 위에 내리게 했다. 머리에 실리면 시계 방향 회전이 차를 앞으로 실어 보내고,
// 오른쪽으로 떨어져 턱 6 m 아래 평지에 내린다. 구덩이에 빠지면 fall.
const OM_R = 3200
const OM_FR = 1200 // 다리 오목호 반지름
const OM_FOOT = 800
const OM_W = -6 // TURN/틱, 시계 방향
const omegaSegs = (): Seg[] => {
  const R = mm(OM_R)
  const r = mm(OM_FR)
  const jl = arcPoint(0, 0, R, deg(150))
  const jr = arcPoint(0, 0, R, deg(30))
  const cl = P(jl.x - arcPoint(0, 0, r, -deg(30)).x, jl.y - arcPoint(0, 0, r, -deg(30)).y)
  const cr = P(jr.x - arcPoint(0, 0, r, -deg(150)).x, jr.y - arcPoint(0, 0, r, -deg(150)).y)
  return [
    segOf(P(cl.x - mm(OM_FOOT), cl.y - r), P(cl.x, cl.y - r)),
    ...arcSegs(cl.x, cl.y, r, -Q, -deg(30)),
    ...arcSegs(0, 0, R, deg(150), deg(30)),
    ...arcSegs(cr.x, cr.y, r, -deg(150), -Q),
    segOf(P(cr.x, cr.y - r), P(cr.x + mm(OM_FOOT), cr.y - r)),
  ]
}
const omega: Template = {
  id: 'omega',
  tier: 4,
  prims: [
    line(4000, 0),
    bend(mm(6000), 0, deg(25)),
    line(2000, tanDeg(25, 2000)),
    // 머리 중심: 턱에서 4.9 m 앞·2.9 m 아래(꼭대기가 턱 0.3 m 위). 도는 발끝(중심에서 약 4.7 m)이 턱·평지에 닿지 않는다
    mover(4900, -2900, omegaSegs(), P(0, 0), { k: 'rotate', a0: 0, w: OM_W }, { k: 'time' }),
    gap(4900 + 3800, -6000),
    line(12000, 0),
  ],
}

// [M7, 192.5–201 s] 초록 회전 고리(1부): 35° 직선 오르막(3.5 m) 끝에서 날아, 앞쪽 아래의 초록 고리(반지름 4 m, 300° 열린 원) 꼭대기를 타고 넘는다.
// 고리는 시계 방향으로 돌아(약 7초에 한 바퀴) 꼭대기에 실린 차를 앞으로 실어 보낸다. 녹화: 196.5–198 s 차가 고리 바깥 꼭대기를 지나 오른쪽으로 떠난다.
// 고리 밑은 구덩이, 고리 오른쪽 아래에 평지. 고리 꼭대기는 턱보다 1 m 위.
// [M7, 202–208 s] C자 호(2부): 짧은 30° 킥커(0.7 m) 앞의 초록 C자 호(반지름 3 m, 240°)를 같은 방법으로 타고 넘어 S자 내리막에 내린다.
// 녹화의 C자 호는 길 끝에 바닥이 닿은 고리라 차가 안쪽 바닥으로 들어가 돌아 오른 뒤 위로 튀어 나갔다. 그대로 만들면 호의 왼쪽 위 부분이
// 길 위로 드리워져, 입이 그쪽에 있지 않은 위상에서는 차가 호 바깥에 막혀 멈춘다(빠져나갈 수 없음). 그래서 1부처럼 위에서 타고 넘는 호로 바꿨다.
// 두 호 모두 시계 방향으로 돌고 선분도 시계 방향(꼭대기 선분이 앞을 향한다)이다. 입이 꼭대기 근처일 때 오면 호 안으로 떨어진다.
const GR_R = mm(4000)
const GC_R = mm(3000)
const greenring: Template = {
  id: 'greenring',
  tier: 3,
  prims: [
    line(5000, 0),
    line(5000, tanDeg(35, 5000)),
    mover(5500, -3000, arcSegs(0, 0, GR_R, deg(150), -deg(150)), P(0, 0), { k: 'rotate', a0: 0, w: -10 }, { k: 'time' }, 'green'),
    gap(10000, -4500),
    line(6000, 0),
    bend(mm(5000), 0, deg(30)),
    mover(4500, -2200, arcSegs(0, 0, GC_R, deg(120), deg(120) - deg(240)), P(0, 0), { k: 'rotate', a0: TURN / 2, w: -8 }, { k: 'time' }, 'green'),
    gap(8100, -3500),
    bend(mm(6000), 0, -deg(30)),
    bend(mm(6000), -deg(30), 0),
    line(6000, 0),
  ],
}

// [S20·M5, 119.5–133 s] 가시 띠 + 노란 초승달: 오목호(8 m)로 55°까지 3.4 m 오르는 킥커 뒤, 원래 높이의 길 위에 빨간 가시 띠(18 m)가 깔려 있고,
// 띠 위에 노란 초승달(반지름 3.5 m, 240° 호) 둘이 떠서 시계 방향으로 돈다(약 8.5초에 한 바퀴). 둘째는 첫째보다 60° 앞선 각에서 시작한다.
// 차는 킥커에서 날아 첫째 초승달 바깥 꼭대기에 내리고, 시계 방향 회전에 실려 둘째로, 다시 띠 너머로 건너간다.
// 녹화와 다른 점(녹화로는 스크립트 입력이 하나도 못 건너 통과 가능하게 바꿨다, 판정 기록): 녹화의 띠는 약 24 m, 초승달은 반지름 약 2.8 m·220°에
// 약 5초에 한 바퀴, 차가 왼쪽 위로 열린 초승달 "안"에 내려 타고(121.6 s "+1") 안쪽 벽을 올라 튕겨 나갔다(121.8 → 123.05 s 입이 왼쪽 위 → 위 → 오른쪽 위).
// 여기서는 띠를 18 m로 줄이고, 초승달을 키우고 천천히 돌려 바깥 꼭대기를 타고 넘게 했다. 킥커 높이(녹화 약 3 m)·초승달 높이(띠 위 약 5 m)는 녹화와 비슷하다.
// 바닥에서 뗌(공중에서 떼기) 입력으로 12위상 중 7에서 건넌다. 초승달 자리를 0.5 m만 옮겨도 크게 줄어드니 손볼 때 함께 본다.
// 가시는 바닥 길 위에 얹은 막대(가시 구덩이와 같다)라 띠에 닿으면 crash. 띠 끝 1.5 m 뒤의 1 mm 틈은 앞뒤 평지 자르기가 띠 바닥을 자르지 않게 한다.
// 초승달 선분은 시계 방향(바깥 꼭대기 선분이 앞을 향한다). 처음 자세는 입이 아래.
const SF_KR = mm(8000)
const SF_KICK = arcPoint(0, 0, SF_KR, deg(55) - Q).y - arcPoint(0, 0, SF_KR, -Q).y
const SF_LEN = 18000
const SF_W = -8 // TURN/틱
const crescent = (x: number, a0: number): Prim =>
  mover(x, 4700, arcSegs(0, 0, mm(3500), deg(330) + deg(240), deg(330)), P(0, 0), { k: 'rotate', a0, w: SF_W }, { k: 'time' })
const spikefloor: Template = {
  id: 'spikefloor',
  tier: 3,
  prims: [
    line(4000, 0),
    { t: 'arc', r: SF_KR, a0: -Q, a1: deg(55) - Q },
    { t: 'gap', dx: mm(100), dy: -SF_KICK },
    hazard(0, 0, { s: 'bar', x0: mm(PIT_SPIKE_IN), y0: mm(PIT_SPIKE_R), x1: mm(PIT_SPIKE_IN + SF_LEN), y1: mm(PIT_SPIKE_R), r: mm(PIT_SPIKE_R) }, STILL, 'spikes'),
    crescent(7500, 0),
    crescent(14000, deg(60)),
    line(PIT_SPIKE_IN + SF_LEN + 1500, 0),
    gap(1, 0),
    line(6000, 0),
  ],
}

// [위키 8쪽(96점)] 넘어지는 블록: "건드리면 넘어지는 블록도 있다. 앞으로 가는 것을 방해하기 때문에 제거한 후 이동. 이 블록에서는 두 블록 사이에
// 끼어있지만 않으면 뒤집혀도 살 수 있다". 그림은 평지 위에 쓰러져 누운 흰 막대들(길이 약 1.6~3.5 m, 두께 약 0.3 m)이라, 세워 둔 키 큰 막대를
// 차가 쓰러뜨린 뒤로 보았다(제목 "수직 직선 장애물 도로"). 너비 0.3 m·높이 1.6~2.4 m 막대 8개를 3 m 간격으로 세운다
// (판정 기록: 가로·세로 ≥ 200 mm, 블록 사이 ≥ 블록 너비, 키 작은 블록 셋을 붙이지 않음, 한꺼번에 깨어 있는 블록 ≤ 20).
// 그림에서 누운 막대 사이 길 높이의 작은 빨간 네모는 무엇인지 알 수 없어 넣지 않았다. 앞의 1 mm 틈과 끝 구덩이는 평지 자르기가 막대 길을 자르지 않게 한다.
// 막대 길 끝에 바닥 없는 구덩이(너비 2.5 m, 건너편 1.5 m 낮음)를 둔다(판정 기록: 막대를 다음 템플릿에 가져가지 않게). 쓰러진 막대(두께 0.3 m >
// 바퀴 반지름)는 차가 넘지 못하고 밀고 가는데, 밀리는 막대는 차와 같은 속도라 구덩이도 차와 함께 건넌다(시드 코스 40개 × 입력 3가지에서
// 구덩이에 떨어진 막대 0개). 그래서 막대를 실제로 치우는 것은 "가운데가 자기 구간 끝 x를 넘으면 끝난다" 규칙이다(sim.ts nextBlocks, 설계 §7.3).
// 구덩이는 같은 시험에서 이 구간의 죽음을 늘리지 않았다(계속 누름 40/40 건넘).
const POLE_H = [1600, 2000, 2400, 2000, 1600, 2400, 2000, 1600]
const POLE_W = 300
const POLE_STEP = 3000
const POLE_PIT_W = 2500
const POLE_PIT_DROP = 1500
const blocks: Template = {
  id: 'blocks',
  tier: 4,
  prims: [
    line(6000, 0),
    gap(1, 0),
    ...POLE_H.map((h, i) => block(3000 + i * POLE_STEP, POLE_W, h)),
    line(3000 + POLE_H.length * POLE_STEP + 2000, 0),
    gap(POLE_PIT_W, -POLE_PIT_DROP),
    line(6000, 0),
  ],
}

export const TEMPLATES: readonly Template[] = [
  // tier 1
  hill, waves, bowl, boostflat, spikes, valley, cliff, ledge, bigdrop, rampflat, ramp, smile, yellowflat,
  // tier 2
  cup, quarter, boostjump, spikepit, roofs, stepup, crestgap, stairs, bowldrop, sawfield, sawswing, barrel, pacman, curve,
  onetime, onetime2, switchroad, monkeytail,
  // tier 3
  loop, humps, sinuous, vplat, curl, hook, ringbarrel, spears, spikefloor, greenring,
  // tier 4
  arcs, loop2, spiral, fans, omega, blocks,
].map((t) => ({ ...t, trimFlats: true }))

import { COL_MAX, COL_MIN, GATE_H, LEDGE, PILLAR_H, RAMP_STEP, SPEED_TABLE, STEEP_STEP, V_MAX } from './constants.ts'

// pad: 점프대('J'). 왕복 블록('M') 칸은 평평한 바닥이고 큐브는 행 단위(ParsedSegment.movers, Course.moverAt)로 따로 둔다.
export type Cell = { floor: null | { h0: number; h1: number }; block: boolean; blockH?: number; bank?: -1 | 1; pad?: true }
export type SegmentKind = 'tunnel' | 'descent' | 'obstacle'
// v6: minLevel..maxLevel = 이 조각을 지나는 속도 단계(= 단계, 최고 SPEED_TABLE 끝). 생성기는 지금 단계가 이 범위 안인 조각만 뽑고,
// 밸런스 게이트도 이 범위의 속도만 본다. 없으면 모든 단계(0..끝).
export type SegmentTemplate = { id: string; kind: SegmentKind; tier: 1 | 2 | 3 | 4; rows: string[]; minLevel?: number; maxLevel?: number }
export type ParsedSegment = {
  id: string
  kind: SegmentKind
  tier: 1 | 2 | 3 | 4
  minLevel: number
  maxLevel: number
  length: number
  cells: Cell[][] // cells[rowIndex][col - COL_MIN], 높이는 조각 시작 기준 상대값(mm)
  movers: (null | { x0: number; x1: number })[] // 행마다 왕복 블록이 오가는 범위(바깥 'M' 칸 가운데 x, mm). 없으면 null.
  dh: number
}

// v3: 이음 행은 가운데 3칸(열 -1..1). 길은 어디서나 3칸 이하이고 조각 끝에서 가운데 3칸으로 돌아온다.
export const JOINT = '..___..'
const COLS = COL_MAX - COL_MIN + 1
const LAST_LEVEL = SPEED_TABLE.length - 1
// 이음 행 가운데 3칸의 인덱스 범위(열 -1..1).
const MID_LO = JOINT.indexOf('_')
const MID_HI = JOINT.lastIndexOf('_')

export function parseSegment(t: SegmentTemplate): ParsedSegment {
  const fail = (msg: string): never => {
    throw new Error(`segment ${t.id}: ${msg}`)
  }
  const { rows } = t
  if (rows.length < 2) fail('rows too short')
  const minLevel = t.minLevel ?? 0
  const maxLevel = t.maxLevel ?? LAST_LEVEL
  if (!(Number.isInteger(minLevel) && Number.isInteger(maxLevel) && minLevel >= 0 && minLevel <= maxLevel && maxLevel <= LAST_LEVEL)) {
    fail(`bad level band ${minLevel}..${maxLevel}`)
  }
  if (rows[0] !== JOINT || rows[rows.length - 1] !== JOINT) fail('must start and end with the joint row')

  const h: number[] = new Array(COLS).fill(0)
  const cells: Cell[][] = []
  const movers: ParsedSegment['movers'] = []
  rows.forEach((row, r) => {
    if (row.length !== COLS) fail(`row ${r} must have ${COLS} chars`)
    // 왕복 블록 행: 'M'이 정확히 3칸 이어져 있고 그 행의 길 전부여야 한다(큐브 1 m가 어디 있든 한쪽에 1 m 이상 빈 칸).
    const m0 = row.indexOf('M')
    if (m0 < 0) movers.push(null)
    else {
      if (!/^\.*MMM\.*$/.test(row)) fail(`row ${r}: a shuttle row must be exactly 3 contiguous 'M' cells and nothing else`)
      movers.push({ x0: (m0 + COL_MIN) * 1000, x1: (m0 + 2 + COL_MIN) * 1000 })
    }
    const out: Cell[] = []
    for (let i = 0; i < COLS; i++) {
      const ch = row[i]
      // 터널 안은 가운데 3칸 바닥 '_'만(벽이 ±1.5 m에 선다), 나머지는 구멍.
      if (t.kind === 'tunnel' && r > 0 && r < rows.length - 1 && ch !== JOINT[i]) {
        fail(`row ${r}: tunnel rows must be '${JOINT}'`)
      }
      switch (ch) {
        case '_':
        case 'M':
          out.push({ floor: { h0: h[i], h1: h[i] }, block: false })
          break
        case 'J':
          out.push({ floor: { h0: h[i], h1: h[i] }, block: false, pad: true })
          break
        case 'B':
          out.push({ floor: { h0: h[i], h1: h[i] }, block: true })
          break
        case '/':
          out.push({ floor: { h0: h[i], h1: h[i] + RAMP_STEP }, block: false })
          h[i] += RAMP_STEP
          break
        case '\\':
          out.push({ floor: { h0: h[i], h1: h[i] - RAMP_STEP }, block: false })
          h[i] -= RAMP_STEP
          break
        case '!':
          out.push({ floor: { h0: h[i], h1: h[i] - STEEP_STEP }, block: false })
          h[i] -= STEEP_STEP
          break
        case 'v':
          h[i] -= LEDGE
          out.push({ floor: { h0: h[i], h1: h[i] }, block: false })
          break
        case '<':
        case '>':
          out.push({ floor: { h0: h[i], h1: h[i] }, block: false, bank: ch === '<' ? -1 : 1 })
          break
        case 'P':
          out.push({ floor: { h0: h[i], h1: h[i] }, block: true, blockH: PILLAR_H })
          break
        case 'G':
          out.push({ floor: { h0: h[i], h1: h[i] }, block: true, blockH: GATE_H })
          break
        case '.':
          out.push({ floor: null, block: false })
          break
        default:
          fail(`row ${r}: invalid char '${ch}'`)
      }
    }
    cells.push(out)
  })

  const mid = h.slice(MID_LO, MID_HI + 1)
  if (mid.some((v) => v !== mid[0])) fail('center columns must end at the same height')
  return { id: t.id, kind: t.kind, tier: t.tier, minLevel, maxLevel, length: rows.length, cells, movers, dh: mid[0] }
}

const J = JOINT
const rep = (row: string, n: number): string[] => new Array<string>(Math.max(0, n)).fill(row)
// 3칸 길(v3: 길 폭은 어디서나 3칸 이하). 가운데(열 -1..1)가 이음 행과 같다. L3/R3은 한 칸 옆으로 옮겨 간 길.
const N3 = '..___..'
const L3 = '.___...'
const R3 = '...___.'
const RS = '..!!!..' // 3칸 급경사 한 행(−500 mm)
const RL = '..vvv..' // 3칸 단차(−1000 mm)
const D3 = '..' + '\\'.repeat(3) + '..' // 3칸 완만한 내리막(−250 mm)
const N2 = '..__...' // 2칸(열 -1, 0)
const R2 = '...__..' // 2칸(열 0, 1)
const N1 = '..._...' // 1칸(열 0)
const U3 = '..///..' // 3칸 오르막(+250 mm)
// v4 기믹
const PAD = '..JJJ..' // 3칸 점프대(길 전체라 반만 밟고 지나칠 수 없다)
const GAP = '.......' // 길 전체 구멍
const WALL = '..BBB..' // 길 전체 1 m 블록 벽(점프로만 넘는다)
const SHUT = '..MMM..' // 3칸 길 위 좌우 왕복 블록
const F = (n: number): string[] => rep(N3, n)
const D = (n: number): string[] => rep(D3, n)
const S = (n: number): string[] => rep(RS, n)

// ---- v6 속도 묶음
// 설계 기준은 틱으로 잰다(옆 최고 117 mm/틱·가속 25 mm/틱²는 그대로). v3까지는 모든 조각이 최고 속도(794 mm/틱)에서도 지나가야 해서
// 간격을 최고 속도 행 수로 잡았다 — 초반(거의 모든 판이 노는 곳)에는 사건 사이 1~2초가 빈 직선이었다. v6은 조각마다 속도 묶음을 두고
// 묶음 최고 속도에서 같은 틱이 되는 행 수로 간격을 줄인다(bandRows). 사람에게 필요한 반응 여유(틱)는 그대로다.
/** 최고 속도에서 rowsAtTop행 걸리는 틱 동안 SPEED_TABLE[maxLevel]로 지나는 행 수(올림). */
export function bandRows(rowsAtTop: number, maxLevel: number): number {
  return Math.ceil((rowsAtTop * SPEED_TABLE[maxLevel]) / V_MAX)
}
export type Band = {
  id: 'a' | 'b' | 'c'
  minLevel: number
  maxLevel: number
  s1: number // 차선 1칸 옮김에 필요한 빈 행(최고 속도 12행)
  s2: number // 2칸(21행)
  s3: number // 3칸(28행)
  e1: number // 1칸 틈으로 들어가면 더(5행)
  clear: number // 왕복 블록 앞뒤 평평한 3칸 길(26행)
  bank: number // 같은 쪽으로 미는 기운 판 연속 최대(13행, 내림)
  ledge: number // 단차 뒤 착지 평지(15행)
  flight: number // 점프대 뒤 날아 넘는 구간(구멍·'BBB' 벽): 묶음 최저 속도에서 착지 행 − 4
  land: number // 점프대 뒤 착지 평지 끝(42행): 묶음 최고 속도 착지 행 + 여유
  rampLand: number // 오르막(4행) 끝 구멍 2행 뒤 착지 평지: 묶음 최고 속도 착지 행 + 3
}
function band(id: Band['id'], minLevel: number, maxLevel: number, flight: number, rampLand: number): Band {
  const r = (n: number) => bandRows(n, maxLevel)
  const bank = Math.floor((13 * SPEED_TABLE[maxLevel]) / V_MAX)
  return { id, minLevel, maxLevel, s1: r(12), s2: r(21), s3: r(28), e1: r(5), clear: r(26), bank, ledge: r(15), flight, land: r(42), rampLand }
}
// 점프대 착지 행(시뮬로 잰 값, sim.test): 단계 1 → +15, 3 → +17, 4 → +19, 8 → +24, 9 → +25, 16 → +35.
// 오르막 끝 점프 착지(오르막 끝에서): 단계 3 → +12, 8 → +21, 16 → +45(묶음 c는 착지 평지가 너무 길어 쓰지 않는다).
export const BANDS: readonly Band[] = [band('a', 1, 3, 11, 15), band('b', 4, 8, 14, 24), band('c', 9, 16, 18, 48)]

// 설계 기준(v6, 묶음 b의 행 수 = 최고 속도 기준 × 묶음 최고 속도 / 794, 올림):
// - 길을 막거나 좁히는 행(블록 행, 구멍이 새로 생기는 행 = 길이 좁아지거나 옆으로 옮겨 가는 행, 왕복 블록 행) 사이 빈 행:
//   1칸 옮김 s1, 2칸 s2, 3칸 s3, 1칸 틈으로 들어가면 +e1. 이음 행(가운데 3칸)도 그런 행으로 친다.
//   옮겨 가는 길 사이가 구멍·블록으로 끊긴 동안은 세지 않는다(레일 끝에서부터 센다). 경사 행·점프 구멍 행도 옮길 시간으로 센다.
// - 같은 쪽으로 미는 기운 판은 연속 bank행 이하. 길게 이으려면 평지를 끼우거나 방향을 바꾼다. 양쪽으로 미는 행 수는 같다.
// - 구멍 열은 높이가 그대로라 3칸 길은 모든 열이 같은 높이인 평지에서만 옆으로 옮겨 가거나 좁아진다. 경사·급경사·단차는 가운데
//   3칸 길 전체에서만 쓰고, 그 뒤에는 바깥 열을 다시 쓰지 않는다(좁힌 길은 다시 넓힌 뒤에 내려간다).
// - 사건 사이 빈 행은 가능하면 완만한 내리막(D3)으로 채운다(내리막 길 위 장애물 — 원작처럼 계속 내려간다).
// - 점프대 'J'는 길 전체 3칸. 뒤 flight행 안은 날아 넘는 자리(구멍, +8행 'BBB' 벽, 평지), land행까지 평평한 3칸 착지 평지.
// - 왕복 블록 'M' 행은 3칸 길 전체. 앞뒤 clear행은 같은 칸의 3칸 길(평지 또는 내리막)만, 점프 착지 구간 + clear 안에는 두지 않는다.
// - tier 1 기믹 조각은 기믹 하나와 평평하거나 내려가는 가운데 3칸 길뿐. 코스의 첫 장애물은 늘 'm1-shuttle-a'다.

// 시작 터널(속도 단계 1로 센다 — 시작 직후 '속도 증가' 한 번). 첫 화면이 터널 안이다. 판을 시작하는 자리라 길이는 그대로 둔다.
export const START: SegmentTemplate = { id: 'start', kind: 'tunnel', tier: 1, rows: [J, ...rep(N3, 38), J] }

// 터널: 평평한 3칸 바닥(화면에 가속 화살표, ±1.5 m에 마젠타 벽). 지날 때마다 속도 단계 +1. v6: 터널 안 속도(뽑힌 단계 + 1)로
// 0.8초 이하(묶음 최저 속도 기준), 8행 이상.
const tunnel = (id: string, length: number, minLevel: number, maxLevel: number): SegmentTemplate => ({
  id, kind: 'tunnel', tier: 1, minLevel, maxLevel, rows: [J, ...rep(N3, length - 2), J],
})
export const TUNNELS: readonly SegmentTemplate[] = [
  tunnel('tunnel-12', 12, 1, 4),
  tunnel('tunnel-14', 14, 1, 4),
  tunnel('tunnel-15', 15, 5, 9),
  tunnel('tunnel-17', 17, 5, 9),
  tunnel('tunnel-20', 20, 10, 16),
  tunnel('tunnel-24', 24, 10, 16),
]

type Recipe = { base: string; kind: SegmentKind; tier: 1 | 2 | 3 | 4; bands: readonly Band['id'][]; rows: (b: Band) => string[] }
const ALL: readonly Band['id'][] = ['a', 'b', 'c']
const BC: readonly Band['id'][] = ['b', 'c']

// 내리막: 터널 출구 뒤 3칸 능선(녹화 11.0~12.5 s, 15.75~16.75 s, 22.75~23.75 s, 31.5~32.25 s). 조각마다 4 m 이상 내려간다.
// v6: 곧게 내려가기만 하지 않는다 — 능선이 좌우로 번갈아 좁아지고, 블록을 피하고, 단차 뒤 착지 길이 옮겨 간다.
const DESCENT_RECIPES: readonly Recipe[] = [
  // 급경사 능선 위 평평한 턱마다 블록(녹화 4.0~5.25 s, 16.0~16.75 s).
  {
    base: 'd-steep-blocks', kind: 'descent', tier: 1, bands: ALL,
    rows: (b) => [...S(b.s1), '..B__..', ...S(b.s1), '..__B..', ...S(b.s1 + b.e1), '.._B_..', ...S(b.s1)],
  },
  // 혀 모양 능선: 급경사 뒤 평평한 능선이 왼쪽 2칸 → 3칸 → 오른쪽 2칸, 다시 급경사 뒤 2칸 → 1칸(녹화 12.0 s, 16.0 s).
  {
    base: 'd-ridge', kind: 'descent', tier: 1, bands: ALL,
    rows: (b) => [
      ...S(b.s1), ...rep(N2, b.s1 + 1), N3, ...rep(R2, b.s1 + 1), N3, ...S(4), ...rep(N2, b.s1 + b.e1 + 1), ...rep(N1, 4), N2, N3, ...S(2),
    ],
  },
  // 단차 뒤 착지 길이 2칸으로 좁아져 옮겨 간다(떨어지는 동안 옮긴다). 두 번째 단차 뒤는 반대쪽.
  {
    base: 'd-ledge-offset', kind: 'descent', tier: 1, bands: ALL,
    rows: (b) => [...S(b.s1 - 1), RL, ...rep(N2, b.s1 + 1), N3, ...S(2), RL, ...rep(R2, b.s1 + 1), N3, ...S(b.s1)],
  },
  // 급경사 + 단차 계단, 턱마다 블록(녹화 22.75~23.75 s).
  {
    base: 'd-terraces', kind: 'descent', tier: 1, bands: ALL,
    rows: (b) => [
      ...S(3), RL, ...F(b.ledge), '..B__..', ...S(b.s1), '..__B..', ...S(2), RL, ...F(b.ledge), '.._B_..', ...S(b.s1),
    ],
  },
]

// 장애물: 3칸 길 위 블록·기둥·문·벽 통로·레일·기운 판·옆으로 옮겨 가는 길·기믹. 전체로는 오르지 않는다.
// v6: 조각 하나에 결정이 여러 번 이어진다(묶음 최소 간격으로).
const OBSTACLE_RECIPES: readonly Recipe[] = [
  // ---- tier 1
  // 흩어진 블록 1칸(녹화 17.0~19.5 s). 가운데 블록은 양옆 1칸 틈.
  {
    base: 'o1-scatter', kind: 'obstacle', tier: 1, bands: ALL,
    rows: (b) => [...D(b.s1), '..__B..', ...D(b.s1), '..B__..', ...D(b.s1 + b.e1), '.._B_..', ...D(b.s1), '..__B..', ...D(b.s1)],
  },
  // 길 가장자리 큰 기둥(녹화 17.75 s, 19.0 s), 마지막은 기둥 사이 1칸.
  {
    base: 'o1-edge-pillars', kind: 'obstacle', tier: 1, bands: ALL,
    rows: (b) => [
      ...D(b.s1), '..P__..', '..P__..', ...D(b.s1), '..__P..', '..__P..', ...D(b.s1 + b.e1), '..P_P..', '..P_P..', ...D(b.s1),
    ],
  },
  // 왼쪽으로 옮겨 간 길의 가장자리 블록, 돌아와 내리막 끝 가운데 1칸 문(녹화 27.0 s)과 블록.
  {
    base: 'o1-gate-wide', kind: 'obstacle', tier: 1, bands: ALL,
    rows: (b) => [
      ...F(b.s1), ...rep(L3, b.s1 + 1), '.__B...', ...rep(L3, b.s1), N3, ...D(b.s1 + b.e1), '..G_G..', ...D(b.s1), '..B__..', ...D(b.s1),
    ],
  },
  // 2칸으로 좁아진 길이 옆으로 옮겨 가고, 넓어진 뒤 내리막 블록.
  {
    base: 'o1-narrow2', kind: 'obstacle', tier: 1, bands: ALL,
    rows: (b) => [...D(b.s1), ...rep(N2, b.s1 + 1), ...rep(R2, b.s1 + 1), N3, ...D(b.s1 - 1), '..__B..', ...D(b.s1)],
  },
  // 좌우로 기운 3칸 판(같은 쪽 두 번은 평지 한 행으로 끊는다), 내리막 블록(녹화 4.5 s, 7.0 s의 맛보기).
  {
    base: 'o1-bank-intro', kind: 'obstacle', tier: 1, bands: ALL,
    rows: (b) => [
      ...rep('..>>>..', b.bank), N3, ...rep('..>>>..', b.bank), ...rep('..<<<..', b.bank), N3, ...rep('..<<<..', b.bank),
      ...D(b.s1), '..B__..', ...D(b.s1),
    ],
  },
  // 완만한 내리막 끝 블록과 블록 사이 1칸.
  {
    base: 'o1-down-blocks', kind: 'obstacle', tier: 1, bands: ALL,
    rows: (b) => [...D(b.s1), '..B__..', ...D(b.s1 + b.e1), '..B_B..', ...D(b.s1 + b.e1), '.._B_..', ...D(b.s1)],
  },
  // 오르막 끝 구멍 점프(묶음 a·b: 착지 평지가 짧다), 내려와 블록.
  {
    base: 'o1-ramp-jump', kind: 'obstacle', tier: 1, bands: ['a', 'b'],
    rows: (b) => [...D(2), ...rep(U3, 4), GAP, GAP, ...F(b.rampLand), ...D(4), '..__B..', ...D(b.s1)],
  },
  // 왕복 블록 하나만, 앞뒤로는 평평하거나 내려가는 3칸 길(v5: 첫 장애물로 늘 나온다).
  { base: 'm1-shuttle', kind: 'obstacle', tier: 1, bands: ALL, rows: (b) => [...D(b.clear - 2), ...F(2), SHUT, ...F(2), ...D(b.clear - 2)] },
  // 점프대 → 길 전체 구멍 → 착지 평지(v5).
  {
    base: 'j1-pad-gap', kind: 'obstacle', tier: 1, bands: ALL,
    rows: (b) => [...D(b.s1), PAD, ...rep(GAP, b.flight), ...F(b.land - b.flight)],
  },
  // ---- tier 2
  // 1칸 틈이 길 양끝을 오간다.
  {
    base: 'o2-zigzag', kind: 'obstacle', tier: 2, bands: ALL,
    rows: (b) => [...D(b.s2 + b.e1), '..BB_..', ...D(b.s2 + b.e1), '.._BB..', ...D(b.s2 + b.e1), '..BB_..', ...D(b.s1)],
  },
  // 가운데 1칸 문 뒤 블록 벽 사이 1칸 통로(녹화 27.0~27.5 s), 이어서 좌우 블록.
  {
    base: 'o2-gate-corridor', kind: 'obstacle', tier: 2, bands: ALL,
    rows: (b) => [
      ...D(b.s1 + b.e1), '..G_G..', ...rep('..B_B..', b.s1), ...D(b.s1), '..B__..', ...D(b.s1), '..__B..', ...D(b.s1),
    ],
  },
  // 마젠타 띠로 갈라진 1칸 레일 두 줄(녹화 28.5~29.0 s) → 가운데 1칸 틈.
  {
    base: 'o2-rails-strips', kind: 'obstacle', tier: 2, bands: ALL,
    rows: (b) => [...D(b.s1 + b.e1), ...rep('.._B_..', Math.max(6, b.s1)), ...D(b.s1 + b.e1), '..B_B..', ...D(b.s1)],
  },
  // 기운 3칸 판이 좌우로 번갈아 기울며 옆으로 옮겨 간다(녹화 4.5~8.0 s), 돌아와 내리막 블록.
  {
    base: 'o2-bank-alt', kind: 'obstacle', tier: 2, bands: ALL,
    rows: (b) => [
      ...F(b.s1 - b.bank), ...bankRun(b, '..>>>..', N3), ...bankRun(b, '.<<<...', L3), ...bankRun(b, '..>>>..', N3),
      ...bankRun(b, '...<<<.', R3), N3, ...D(b.s1), '..B__..', ...D(b.s1),
    ],
  },
  // 블록 → 왕복 블록 → 점프대(v6: 결정이 이어진다).
  {
    base: 'm2-chain', kind: 'obstacle', tier: 2, bands: ALL,
    rows: (b) => [...D(b.s1), '..B__..', ...D(b.clear), SHUT, ...D(b.clear), PAD, ...rep(GAP, b.flight), ...F(b.land - b.flight)],
  },
  // 점프대 → 구멍 → 길 전체 1 m 블록 벽(점프로만 넘는다) → 구멍 → 착지(v4).
  {
    base: 'j2-pad-wall', kind: 'obstacle', tier: 2, bands: ALL,
    rows: (b) => [...D(b.s1), PAD, ...rep(GAP, 7), WALL, ...rep(GAP, b.flight - 8), ...F(b.land - b.flight)],
  },
  // ---- tier 3
  // 기둥 낀 블록 사이로 지그재그, 끝은 가운데 1칸 틈.
  {
    base: 'o3-slalom', kind: 'obstacle', tier: 3, bands: BC,
    rows: (b) => [...D(b.s2 + b.e1), '..PB_..', ...D(b.s2 + b.e1), '.._BP..', ...D(b.s1 + b.e1), '..P_B..', ...D(b.s1)],
  },
  // 왼쪽으로 옮겨 간 길의 1칸 문 뒤 벽 통로, 돌아와 가운데 문과 통로(녹화 27.0 s, 30.0 s), 내리막 블록.
  {
    base: 'o3-gate-narrow', kind: 'obstacle', tier: 3, bands: BC,
    rows: (b) => [
      ...F(b.s1), ...rep(L3, b.s1 + b.e1 + 1), '.G_G...', ...rep('.B_B...', b.s1), N3, ...D(b.s1 + b.e1), '..G_G..', ...rep('..B_B..', b.s1),
      ...D(b.s1), '..__B..', ...D(b.s1),
    ],
  },
  // 기운 판이 미는 쪽과 반대로 옮겨 가는 굽은 길, 이어서 가운데 블록.
  {
    base: 'o3-bank-wind', kind: 'obstacle', tier: 3, bands: BC,
    rows: (b) => [
      ...F(b.s1 - b.bank), ...bankRun(b, '..<<<..', N3), ...bankRun(b, '...>>>.', R3), ...bankRun(b, '..<<<..', N3),
      ...bankRun(b, '.>>>...', L3), N3, ...D(b.s1 + b.e1), '.._B_..', ...D(b.s1),
    ],
  },
  // 단차로 내려선 판 위 블록, 다시 단차와 블록.
  {
    base: 'o3-ledge-blocks', kind: 'obstacle', tier: 3, bands: BC,
    rows: (b) => [...D(2), RL, ...F(b.ledge), '..B_B..', ...D(b.s1 + b.e1), '.._B_..', ...D(2), RL, ...F(b.ledge), '..__B..', ...D(b.s1)],
  },
  // 왕복 블록 둘(행 위상이 어긋난다), 앞뒤 블록.
  {
    base: 'm3-two-shuttles', kind: 'obstacle', tier: 3, bands: BC,
    rows: (b) => [...D(b.s1), '..B__..', ...D(b.clear), SHUT, ...D(b.clear), SHUT, ...D(b.clear), '..__B..', ...D(b.s1)],
  },
  // 2칸으로 좁아졌다가 왼쪽으로 옮겨 간 3칸 길 위 왕복 블록(v4), 돌아와 내리막 블록.
  {
    base: 'm3-narrow-shuttle', kind: 'obstacle', tier: 3, bands: BC,
    rows: (b) => [
      ...F(b.s1), ...rep(N2, b.s1), ...rep(L3, b.clear), '.MMM...', ...rep(L3, b.clear), N3, ...D(b.s1), '..B__..', ...D(b.s1),
    ],
  },
  // 점프대 → 구멍 → 착지 뒤 바로 블록 둘.
  {
    base: 'j3-pad-blocks', kind: 'obstacle', tier: 3, bands: BC,
    rows: (b) => [...D(b.s1), PAD, ...rep(GAP, b.flight), ...F(b.land - b.flight), ...D(2), '..B__..', ...D(b.s1), '..__B..', ...D(b.s1)],
  },
  // ---- tier 4
  // 섬 건너기: 점프대 → 구멍 → 섬 → 점프대 → 구멍 → 착지(v4).
  {
    base: 'j4-islands', kind: 'obstacle', tier: 4, bands: BC,
    rows: (b) => [...D(b.s1), PAD, ...rep(GAP, b.flight), ...F(b.land - b.flight), PAD, ...rep(GAP, b.flight), ...F(b.land - b.flight)],
  },
  // 점프대로 구멍을 넘고 왕복 블록(v4).
  {
    base: 'mj4-pad-shuttle', kind: 'obstacle', tier: 4, bands: BC,
    rows: (b) => [...D(b.s1), PAD, ...rep(GAP, b.flight), ...F(b.land - b.flight), ...D(b.clear), SHUT, ...D(b.clear)],
  },
  // 촘촘한 블록 벽, 1칸 틈이 옮겨 간다.
  {
    base: 'o4-dense', kind: 'obstacle', tier: 4, bands: BC,
    rows: (b) => [
      ...D(b.s1), '..B__..', ...D(b.s1 + b.e1), '..B_B..', ...D(b.s1 + b.e1), '..BB_..', ...D(b.s2 + b.e1), '.._BB..', ...D(b.s1 + b.e1),
      '..B_B..', ...D(b.s1),
    ],
  },
  // 기운 판이 미는 쪽으로 옮겨 가는 굽은 3칸 길(바깥 열까지). 길이 옮겨 가는 곳에 평평한 한 행을 끼운다.
  {
    base: 'o4-bank-shift', kind: 'obstacle', tier: 4, bands: BC,
    rows: (b) => [
      ...F(b.s1 - b.bank), ...rep('..>>>..', b.bank), R3, ...rep('...>>>.', b.bank), ...rep('...<<<.', b.bank), N3,
      ...bankRun(b, '..<<<..', N3), L3, ...rep('.<<<...', b.bank), ...rep('.>>>...', b.bank), N3, ...D(b.s1 + b.e1), '.._B_..', ...D(b.s1),
    ],
  },
  // 1칸 문 → 벽 통로 → 마젠타 띠 양옆 1칸 레일 → 가운데 1칸 틈.
  {
    base: 'o4-gate-rails', kind: 'obstacle', tier: 4, bands: BC,
    rows: (b) => [
      ...D(b.s1 + b.e1), '..G_G..', ...rep('..B_B..', b.s1), ...D(b.s1 + b.e1), ...rep('.._B_..', Math.max(6, b.s1)), ...D(b.s1 + b.e1),
      '..B_B..', ...D(b.s1),
    ],
  },
]

// 기운 판 bank행 + 같은 칸 평지(bank < s1 + 1이면 다음에 길이 옮겨 가기 전 빈 행 s1을 채운다).
const bankRun = (b: Band, row: string, flat: string): string[] => [...rep(row, b.bank), ...rep(flat, b.s1 + 1 - b.bank)]

function instantiate(recipes: readonly Recipe[]): SegmentTemplate[] {
  return recipes.flatMap((r) =>
    BANDS.filter((b) => r.bands.includes(b.id)).map((b) => ({
      id: `${r.base}-${b.id}`, kind: r.kind, tier: r.tier, minLevel: b.minLevel, maxLevel: b.maxLevel, rows: [J, ...r.rows(b), J],
    })),
  )
}
export const DESCENTS: readonly SegmentTemplate[] = instantiate(DESCENT_RECIPES)
export const OBSTACLES: readonly SegmentTemplate[] = instantiate(OBSTACLE_RECIPES)
/** 조각의 속도 묶음(BANDS). 묶음이 없는(모든 단계) 조각은 undefined. */
export function bandOf(t: { minLevel?: number; maxLevel?: number }): Band | undefined {
  return BANDS.find((b) => b.minLevel === t.minLevel && b.maxLevel === t.maxLevel)
}

export const TEMPLATES: readonly SegmentTemplate[] = [...TUNNELS, ...DESCENTS, ...OBSTACLES]
export const PARSED_TUNNELS: readonly ParsedSegment[] = TUNNELS.map(parseSegment)
export const PARSED_DESCENTS: readonly ParsedSegment[] = DESCENTS.map(parseSegment)
export const PARSED_OBSTACLES: readonly ParsedSegment[] = OBSTACLES.map(parseSegment)
export const PARSED: readonly ParsedSegment[] = [...PARSED_TUNNELS, ...PARSED_DESCENTS, ...PARSED_OBSTACLES]
export const START_PARSED: ParsedSegment = parseSegment(START)

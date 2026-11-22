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
// - 장애물 조각은 평지(내리막은 v5처럼 몇 행만). 강제로 옮겨야 하는 행 사이는 손을 놓으면 1초 안에 길을 벗어나는 구간으로 잇는다:
//   앉아 있을 안전한 칸이 없게 번갈아 막는 블록(가운데·양옆 1칸 틈, 2칸 건너기), 한 칸씩 옮겨 가는 1~2칸 길, 굽는 벽 통로, 기운 판.
// - 점프대 'J'는 길 전체 3칸. 뒤 flight행 안은 날아 넘는 자리(구멍, +8행 'BBB' 벽, 평지), land행까지 평평한 3칸 착지 평지,
//   착지 평지 바로 뒤에 다음 결정(날아가는 동안 미리 옮길 수 있다).
// - 왕복 블록 'M' 행은 3칸 길 전체. 앞뒤 clear행은 같은 칸의 평평한 3칸 길만, 점프 착지 구간 + clear 안에는 두지 않는다.
// - 첫 장애물 'm1-shuttle-*'은 왕복 블록 하나와 평평한 3칸 길뿐. 다른 tier 1 기믹 조각은 기믹 하나 + tier 1 장애물.

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

// ---- 간격 맞춰 잇기(v6)
// 막는 행(블록·기둥·문·왕복 블록 행, 바닥 열이 빠지는 행) 사이에 설계 간격(묶음 행 수)만큼 채움 행(기본 평평한 3칸)을 넣는다.
// 항목: 막는 행 하나 또는 막는 행 묶음(배열, 간격은 묶음 끝에서 다음까지), { raw }는 그대로 붙이는 행(간격 셈에 들어간다),
// { fill }은 이후 채움 행을 바꾼다. 가운데 3칸 안의 항목만 쓴다(채움 행이 가운데 3칸이라).
const NEED_TOP = [0, 12, 21, 28, 34, 40, 46]
const ENTRY_TOP = 5
type Item = string | string[] | { raw: string[] } | { fill: string }
const passOf = (row: string): number[] => [...row].flatMap((ch, i) => ('.BPG'.includes(ch) ? [] : [i]))
const floorsOf = (row: string): number[] => [...row].flatMap((ch, i) => (ch === '.' ? [] : [i]))
function widthAt(cells: number[], i: number): number {
  let w = 1
  for (let k = i - 1; cells.includes(k); k--) w++
  for (let k = i + 1; cells.includes(k); k++) w++
  return w
}
function gapNeed(b: Band, from: string, to: string): number {
  const P = passOf(from)
  const Q = passOf(to)
  let need = 0
  for (const a of P) {
    let best = Infinity
    for (const c of Q) {
      const k = Math.abs(a - c)
      const n = k === 0 ? 0 : bandRows(NEED_TOP[k], b.maxLevel) + (widthAt(Q, c) === 1 ? bandRows(ENTRY_TOP, b.maxLevel) : 0)
      best = Math.min(best, n)
    }
    need = Math.max(need, best)
  }
  return need
}
const isConstraint = (prev: string, row: string): boolean =>
  floorsOf(row).length > 0 && passOf(row).length > 0 && (/[BPGM]/.test(row) || floorsOf(prev).some((c) => !floorsOf(row).includes(c)))
function chain(b: Band, ...items: Item[]): string[] {
  const out: string[] = []
  let fill = N3
  let last = J // 마지막 막는 행
  let prev = J
  let since = 0 // 마지막 막는 행 뒤 행 수
  const push = (row: string): void => {
    if (isConstraint(prev, row)) {
      last = row
      since = 0
    } else since++
    out.push(row)
    prev = row
  }
  for (const it of items) {
    if (typeof it === 'object' && !Array.isArray(it)) {
      if ('fill' in it) fill = it.fill
      else it.raw.forEach(push)
      continue
    }
    const rows = typeof it === 'string' ? [it] : it
    // 채움 행이 막는 행이 되면(바깥 열이 빠지는 등) 그 행부터 다시 센다.
    while (gapNeed(b, last, rows[0]) > since) push(fill)
    rows.forEach(push)
  }
  while (gapNeed(b, last, J) > since) push(fill)
  return out
}
// 기운 판 bank행 + 같은 칸 평지(bank < s1 + 1이면 다음에 길이 옮겨 가기 전 빈 행 s1을 채운다).
const bankRun = (b: Band, row: string, flat: string): string[] => [...rep(row, b.bank), ...rep(flat, b.s1 + 1 - b.bank)]
const L1 = '.._....' // 1칸(열 -1)
const R1 = '...._..' // 1칸(열 1)
const g1 = (b: Band): number => b.s1 + b.e1 // 1칸 옮겨 1칸 틈으로
// 1칸 길 구간 길이: 손 뗀 공이 그 구간을 날아 건너지 못하게(가장자리에서 150 mm 떨어지는 6틱 + 여유, 묶음 최고 속도).
const nr = (b: Band): number => Math.max(4, bandRows(7, b.maxLevel))
// 점프대 → 구멍(flight) → 착지 평지(land까지). 앞뒤 결정은 chain으로 잇는다.
const jump = (b: Band): Item => ({ raw: [N3, N3, PAD, ...rep(GAP, b.flight), ...F(b.land - b.flight)] })

// 내리막: 터널 출구 뒤 3칸 능선(녹화 11.0~12.5 s, 15.75~16.75 s, 22.75~23.75 s, 31.5~32.25 s). 조각마다 4 m 이상 내려간다.
// v6: 곧게 내려가기만 하지 않는다 — 턱마다 블록, 좌우로 굽으며 1칸까지 좁아지는 능선, 단차 뒤 좁아져 옮겨 가는 착지 길.
const DESCENT_RECIPES: readonly Recipe[] = [
  // 급경사 능선 뒤 평평한 턱에 번갈아 막는 블록(녹화 4.0~5.25 s, 16.0~16.75 s).
  {
    base: 'd-steep-blocks', kind: 'descent', tier: 1, bands: ALL,
    rows: (b) => chain(b, { raw: S(8) }, '.._B_..', '..B_B..', '.._B_..', '..B_B..', '..BB_..'),
  },
  // 굽는 능선: 급경사 뒤 왼쪽 2칸 → 왼쪽 1칸 → 2칸 → 가운데 1칸 → 오른쪽 2칸 → 오른쪽 1칸(녹화 12.0 s, 16.0 s).
  {
    base: 'd-ridge', kind: 'descent', tier: 1, bands: ALL,
    rows: (b) => [
      ...S(Math.max(8, b.s1)), ...rep(N2, g1(b) + 1), ...rep(L1, nr(b)), ...rep(N2, g1(b)), ...rep(N1, nr(b)), ...rep(R2, g1(b)),
      ...rep(R1, nr(b)), R2, N3,
    ],
  },
  // 단차 뒤 착지 길이 2칸 → 1칸으로 좁아져 옆으로 옮겨 가고, 다시 단차 뒤 블록.
  {
    base: 'd-ledge-offset', kind: 'descent', tier: 1, bands: ALL,
    rows: (b) =>
      chain(b, { raw: [...S(b.s1 - 1), RL, ...rep(N2, g1(b) + 1), ...rep(L1, nr(b)), ...rep(N2, b.s1), N3, ...S(3), RL] }, '..B_B..', '.._B_..'),
  },
  // 급경사 + 단차 계단, 착지 턱마다 블록(녹화 22.75~23.75 s).
  {
    base: 'd-terraces', kind: 'descent', tier: 1, bands: ALL,
    rows: (b) =>
      chain(b, { raw: [...S(3), RL, ...F(b.ledge)] }, '.._B_..', '..B_B..', { raw: [...S(2), RL, ...F(b.ledge)] }, '..B_B..', '.._BB..'),
  },
]

// 장애물: 3칸 길 위 블록·기둥·문·벽 통로·레일·기운 판·옆으로 옮겨 가는 길·기믹. 전체로는 오르지 않는다.
// v6: 결정이 묶음 최소 간격으로 이어지고, 앉아 있을 안전한 칸이 없게 번갈아 막는다.
const OBSTACLE_RECIPES: readonly Recipe[] = [
  // ---- tier 1
  // 가운데 블록과 양옆 블록이 번갈아(녹화 17.0~19.5 s).
  { base: 'o1-scatter', kind: 'obstacle', tier: 1, bands: ALL, rows: (b) => chain(b, '.._B_..', '..B_B..', '.._B_..', '..B_B..', '.._B_..') },
  // 큰 기둥 둘이 틈을 좌우로 옮긴다(녹화 17.75 s, 19.0 s).
  {
    base: 'o1-edge-pillars', kind: 'obstacle', tier: 1, bands: ALL,
    rows: (b) => chain(b, rep('..P_P..', 2), rep('..PP_..', 2), rep('..P_P..', 2), rep('.._PP..', 2)),
  },
  // 가운데 1칸 문(녹화 27.0 s)과 블록이 번갈아.
  { base: 'o1-gate-wide', kind: 'obstacle', tier: 1, bands: ALL, rows: (b) => chain(b, '..G_G..', '.._B_..', '..G_G..', '..BB_..') },
  // 2칸 길이 한 칸씩 왼쪽 끝에서 오른쪽 끝까지 옮겨 간다(휘는 길).
  {
    base: 'o1-narrow2', kind: 'obstacle', tier: 1, bands: ALL,
    rows: (b) => {
      const k = b.s1 + 1
      return [...F(b.s2), ...rep('.__....', k), ...rep(N2, k), ...rep(R2, k), ...rep('....__.', k), R2, N3]
    },
  },
  // 같은 쪽으로 두 번 미는 기운 판(사이 평지 한 행), 반대쪽도 두 번, 자리를 잡을 평지 뒤 블록(녹화 4.5 s, 7.0 s).
  {
    base: 'o1-bank-intro', kind: 'obstacle', tier: 1, bands: ALL,
    rows: (b) =>
      chain(b, { raw: [...rep('..>>>..', b.bank), N3, ...rep('..>>>..', b.bank), ...rep('..<<<..', b.bank), N3, ...rep('..<<<..', b.bank), ...F(b.s1)] }, '..B_B..', '.._B_..'),
  },
  // 완만한 내리막 끝 번갈아 막는 블록.
  { base: 'o1-down-blocks', kind: 'obstacle', tier: 1, bands: ALL, rows: (b) => chain(b, { raw: D(4) }, '.._B_..', '..B_B..', '..BB_..') },
  // 오르막 끝 구멍 점프(묶음 a·b: 착지 평지가 짧다), 내려와 블록.
  {
    base: 'o1-ramp-jump', kind: 'obstacle', tier: 1, bands: ['a', 'b'],
    rows: (b) => chain(b, '.._B_..', { raw: [...rep(U3, 4), GAP, GAP, ...F(b.rampLand), ...D(4)] }, '..B_B..', '.._B_..'),
  },
  // 왕복 블록 하나만, 앞뒤로 평평한 3칸 길(v5: 첫 장애물로 늘 나온다).
  { base: 'm1-shuttle', kind: 'obstacle', tier: 1, bands: ALL, rows: (b) => [...F(b.clear), SHUT, ...F(b.clear)] },
  // 블록 → 점프대 → 길 전체 구멍 → 착지 → 블록(v5·v6).
  { base: 'j1-pad-gap', kind: 'obstacle', tier: 1, bands: ALL, rows: (b) => chain(b, '..B_B..', '.._B_..', jump(b), '.._B_..') },
  // ---- tier 2
  // 1칸 틈이 길 양끝을 오간다.
  { base: 'o2-zigzag', kind: 'obstacle', tier: 2, bands: ALL, rows: (b) => chain(b, '..BB_..', '.._BB..', '..BB_..', '.._BB..') },
  // 가운데 1칸 문 뒤 블록 벽 사이 1칸 통로(녹화 27.0~27.5 s), 틈이 옮겨 가고 다시 문과 통로.
  {
    base: 'o2-gate-corridor', kind: 'obstacle', tier: 2, bands: ALL,
    rows: (b) => chain(b, '.._B_..', ['..G_G..', ...rep('..B_B..', b.s1)], '.._BB..', ['..G_G..', ...rep('..B_B..', 3)], '..BB_..'),
  },
  // 마젠타 띠로 갈라진 1칸 레일 두 줄(녹화 28.5~29.0 s) → 가운데 1칸 틈 → 레일 → 틈.
  {
    base: 'o2-rails-strips', kind: 'obstacle', tier: 2, bands: ALL,
    rows: (b) => chain(b, rep('.._B_..', 7), '..B_B..', rep('.._B_..', 4), '..BB_..'),
  },
  // 기운 3칸 판이 좌우로 번갈아 기울며 옆으로 옮겨 간다(녹화 4.5~8.0 s), 돌아와 블록.
  {
    base: 'o2-bank-alt', kind: 'obstacle', tier: 2, bands: ALL,
    rows: (b) =>
      chain(
        b,
        { raw: [...F(b.s1 - b.bank), ...bankRun(b, '..>>>..', N3), ...bankRun(b, '.<<<...', L3), ...bankRun(b, '..>>>..', N3), ...bankRun(b, '...<<<.', R3), N3] },
        '..B_B..', '.._B_..',
      ),
  },
  // 1칸 레일이 한 칸씩 옮겨 가는 굽은 길(사이는 2칸 이음).
  {
    base: 'o2-winding-rail', kind: 'obstacle', tier: 2, bands: ALL,
    rows: (b) => [
      ...F(b.s2 + b.e1), ...rep(L1, nr(b)), ...rep(N2, g1(b)), ...rep(N1, nr(b)), ...rep(R2, g1(b)), ...rep(R1, nr(b)), ...rep(R2, g1(b)),
      ...rep(N1, nr(b)), ...rep(N2, g1(b)), ...rep(L1, nr(b)), N2, N3,
    ],
  },
  // 블록 → 왕복 블록 → 점프대 → 블록(v6: 결정이 이어진다).
  {
    base: 'm2-chain', kind: 'obstacle', tier: 2, bands: ALL,
    rows: (b) => chain(b, '.._B_..', { raw: [...F(b.clear), SHUT, ...F(b.clear)] }, '.._B_..', jump(b), '.._BB..'),
  },
  // 블록 → 점프대 → 구멍 → 길 전체 1 m 블록 벽(점프로만 넘는다) → 구멍 → 착지 → 블록(v4).
  {
    base: 'j2-pad-wall', kind: 'obstacle', tier: 2, bands: ALL,
    rows: (b) =>
      chain(b, '..B_B..', '.._B_..', { raw: [N3, N3, PAD, ...rep(GAP, 7), WALL, ...rep(GAP, b.flight - 8), ...F(b.land - b.flight)] }, '..BB_..'),
  },
  // ---- tier 3
  // 기둥 낀 블록 사이로 지그재그.
  { base: 'o3-slalom', kind: 'obstacle', tier: 3, bands: BC, rows: (b) => chain(b, '..PB_..', '.._BP..', '..P_B..', '..BP_..', '.._B_..') },
  // 1칸 문 뒤 벽 통로, 왼쪽으로 옮겨 간 둘째 문과 통로, 다시 가운데(녹화 27.0 s, 30.0 s).
  {
    base: 'o3-gate-narrow', kind: 'obstacle', tier: 3, bands: BC,
    rows: (b) =>
      chain(b, '.._B_..', ['..G_G..', ...rep('..B_B..', b.s1)], ['.G_G...', ...rep('.B_B...', b.s1)], ['..G_G..', ...rep('..B_B..', 4)], '.._BB..'),
  },
  // 기운 판이 미는 쪽과 반대로 옮겨 가는 굽은 길, 이어서 블록.
  {
    base: 'o3-bank-wind', kind: 'obstacle', tier: 3, bands: BC,
    rows: (b) =>
      chain(
        b,
        { raw: [...F(b.s1 - b.bank), ...bankRun(b, '..<<<..', N3), ...bankRun(b, '...>>>.', R3), ...bankRun(b, '..<<<..', N3), ...bankRun(b, '.>>>...', L3), N3] },
        '.._B_..', '..BB_..',
      ),
  },
  // 단차로 내려선 판 위 블록, 다시 단차와 블록.
  {
    base: 'o3-ledge-blocks', kind: 'obstacle', tier: 3, bands: BC,
    rows: (b) => chain(b, { raw: [RL, ...F(b.ledge)] }, '.._B_..', '..B_B..', { raw: [RL, ...F(b.ledge)] }, '..B_B..', '..BB_..'),
  },
  // 블록 → 왕복 블록 둘(행 위상이 어긋난다) → 블록.
  {
    base: 'm3-two-shuttles', kind: 'obstacle', tier: 3, bands: BC,
    rows: (b) => chain(b, '.._B_..', { raw: [...F(b.clear), SHUT, ...F(b.clear), SHUT, ...F(b.clear)] }, '.._BB..'),
  },
  // 2칸으로 좁아졌다가 왼쪽으로 옮겨 간 3칸 길 위 왕복 블록(v4), 돌아와 블록.
  {
    base: 'm3-narrow-shuttle', kind: 'obstacle', tier: 3, bands: BC,
    rows: (b) =>
      chain(b, '.._B_..', { raw: [...F(b.s1), ...rep(N2, b.s1), ...rep(L3, b.clear), '.MMM...', ...rep(L3, b.clear), N3] }, '..B_B..', '.._B_..'),
  },
  // 블록 → 점프대 → 구멍 → 착지 뒤 바로 블록 둘.
  { base: 'j3-pad-blocks', kind: 'obstacle', tier: 3, bands: BC, rows: (b) => chain(b, '.._B_..', jump(b), '.._BB..', '..BB_..') },
  // ---- tier 4
  // 섬 건너기: 점프대 → 구멍 → 섬(착지 뒤 블록) → 점프대 → 구멍 → 착지 → 블록(v4).
  { base: 'j4-islands', kind: 'obstacle', tier: 4, bands: BC, rows: (b) => chain(b, '.._B_..', jump(b), '..BB_..', jump(b), '.._BB..') },
  // 점프대로 구멍을 넘고 블록, 왕복 블록, 블록(v4).
  {
    base: 'mj4-pad-shuttle', kind: 'obstacle', tier: 4, bands: BC,
    rows: (b) => chain(b, '..B_B..', '.._B_..', jump(b), '.._BB..', { raw: [...F(b.clear), SHUT, ...F(b.clear)] }, '..BB_..'),
  },
  // 촘촘한 블록 벽, 1칸 틈이 옮겨 간다.
  {
    base: 'o4-dense', kind: 'obstacle', tier: 4, bands: BC,
    rows: (b) => chain(b, '..BB_..', '..B_B..', '.._BB..', '..B_B..', '..BB_..', '.._B_..'),
  },
  // 기운 판이 미는 쪽으로 옮겨 가는 굽은 3칸 길(바깥 열까지). 길이 옮겨 가는 곳에 평평한 한 행을 끼운다. 이어서 블록.
  {
    base: 'o4-bank-shift', kind: 'obstacle', tier: 4, bands: BC,
    rows: (b) =>
      chain(
        b,
        {
          raw: [
            ...F(b.s1 - b.bank), ...rep('..>>>..', b.bank), R3, ...rep('...>>>.', b.bank), ...rep('...<<<.', b.bank), N3,
            ...bankRun(b, '..<<<..', N3), L3, ...rep('.<<<...', b.bank), ...rep('.>>>...', b.bank), N3,
          ],
        },
        '..B_B..', '..BB_..',
      ),
  },
  // 1칸 문 → 벽 통로 → 마젠타 띠 양옆 1칸 레일 → 가운데 1칸 틈 → 블록.
  {
    base: 'o4-gate-rails', kind: 'obstacle', tier: 4, bands: BC,
    rows: (b) => chain(b, '.._B_..', ['..G_G..', ...rep('..B_B..', b.s1)], rep('.._B_..', 7), '..B_B..', '.._BB..'),
  },
]

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

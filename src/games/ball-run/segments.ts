import { COL_MAX, COL_MIN, GATE_H, LEDGE, PILLAR_H, RAMP_STEP, STEEP_STEP } from './constants.ts'

// pad: 점프대('J'). 왕복 블록('M') 칸은 평평한 바닥이고 큐브는 행 단위(ParsedSegment.movers, Course.moverAt)로 따로 둔다.
export type Cell = { floor: null | { h0: number; h1: number }; block: boolean; blockH?: number; bank?: -1 | 1; pad?: true }
export type SegmentKind = 'tunnel' | 'descent' | 'obstacle'
export type SegmentTemplate = { id: string; kind: SegmentKind; tier: 1 | 2 | 3 | 4; rows: string[] }
export type ParsedSegment = {
  id: string
  kind: SegmentKind
  tier: 1 | 2 | 3 | 4
  length: number
  cells: Cell[][] // cells[rowIndex][col - COL_MIN], 높이는 조각 시작 기준 상대값(mm)
  movers: (null | { x0: number; x1: number })[] // 행마다 왕복 블록이 오가는 범위(바깥 'M' 칸 가운데 x, mm). 없으면 null.
  dh: number
}

// v3: 이음 행은 가운데 3칸(열 -1..1). 길은 어디서나 3칸 이하이고 조각 끝에서 가운데 3칸으로 돌아온다.
export const JOINT = '..___..'
const COLS = COL_MAX - COL_MIN + 1
// 이음 행 가운데 3칸의 인덱스 범위(열 -1..1).
const MID_LO = JOINT.indexOf('_')
const MID_HI = JOINT.lastIndexOf('_')

export function parseSegment(t: SegmentTemplate): ParsedSegment {
  const fail = (msg: string): never => {
    throw new Error(`segment ${t.id}: ${msg}`)
  }
  const { rows } = t
  if (rows.length < 2) fail('rows too short')
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
  return { id: t.id, kind: t.kind, tier: t.tier, length: rows.length, cells, movers, dh: mid[0] }
}

const J = JOINT
const rep = (row: string, n: number): string[] => new Array<string>(n).fill(row)
// 3칸 길(v3: 길 폭은 어디서나 3칸 이하). 가운데(열 -1..1)가 이음 행과 같다. L3/R3은 한 칸, LL3는 두 칸 옆으로 옮겨 간 길.
const N3 = '..___..'
const L3 = '.___...'
const LL3 = '___....'
const R3 = '...___.'
const RS = '..!!!..' // 3칸 급경사 한 행(−500 mm)
const RL = '..vvv..' // 3칸 단차(−1000 mm)
const D3 = '..' + '\\'.repeat(3) + '..' // 3칸 완만한 내리막(−250 mm)
const U3 = '..///..' // 3칸 오르막(+250 mm)
const N2 = '..__...' // 2칸(열 -1, 0)
const N1 = '..._...' // 1칸(열 0)
// v4 기믹
const PAD = '..JJJ..' // 3칸 점프대(길 전체라 반만 밟고 지나칠 수 없다)
const GAP = '.......' // 길 전체 구멍
const WALL = '..BBB..' // 길 전체 1 m 블록 벽(점프로만 넘는다)
const SHUT = '..MMM..' // 3칸 길 위 좌우 왕복 블록

// 설계 기준(v3, 최고 속도 794 mm/틱 = v2의 1.7배, 옆 최고 117 mm/틱·가속 25 mm/틱²는 그대로):
// - 길을 막거나 좁히는 행(블록 행, 구멍이 새로 생기는 행 = 길이 좁아지거나 옆으로 옮겨 가는 행) 사이 빈 행:
//   1칸 옮김 12행, 2칸 21행, 3칸 28행, 1칸 틈으로 들어가면 +5행(v2의 7·12·16, +3의 1.7배). 이음 행(가운데 3칸)도 그런 행으로 친다.
//   옮겨 가는 길 사이가 구멍·블록으로 끊긴 동안은 세지 않는다(레일 끝에서부터 센다).
// - 3칸 길이 한 칸 옆으로 옮겨 가면 같은 자리에 13행 이상 머문다(떠나는 칸에서 12행).
// - 단차 뒤 착지까지 최고 속도에서 약 14행 → 단차 뒤 15행 이상 평지.
// - 같은 쪽으로 미는 기운 판은 연속 13행 이하. 길게 이으려면 평지를 끼우거나 방향을 바꾼다.
// - 구멍 열은 높이가 그대로라 3칸 길은 모든 열이 같은 높이인 평지에서만 옆으로 옮겨 간다(단차·경사는 가운데 3칸에서만).
//   능선은 다 내려간 뒤에 좁힌다(끊긴 열이 끝 이음에서 같은 높이로 돌아와야 하므로). 한 열만 따로 떨어지는 숨은 턱은 두지 않는다.
// - 오르막 끝 구멍 점프는 최고 속도에서 약 45행 난다(오르막 기울기 × 속도가 두 배 가까이 커져서) → 착지 평지 50행.
// v4 기믹(전진 속도는 입력과 무관 → 길 전체를 막는 시간 기믹은 없다. 움직이는 장애물은 늘 지나갈 칸을 남긴다):
// - 점프대 'J'는 길 전체 3칸. 1단계(360)에서 점프대 뒤 약 15행, 최고 속도에서 약 35행에 내린다. 점프대 뒤 11행 안은 날아 넘는 자리
//   (구멍은 14행까지 모든 속도에서 넘지만 8행만 쓴다), 'BBB' 벽은 모든 속도에서 넘는 +7..+10행 가운데 +9행, 착지 평지는 +42행까지.
// - 왕복 블록 'M' 행은 3칸 길 전체. 앞뒤 26행(2칸 옮김 21 + 1칸 틈 5)은 평평한 3칸 길만, 점프 착지 구간(+42행) 안에는 두지 않는다.
//   tier 1에는 기믹이 없다(첫 단계는 기본기).

// 시작 터널(속도 단계 1로 센다 — 시작 직후 '속도 증가' 한 번). 첫 화면이 터널 안이다.
export const START: SegmentTemplate = { id: 'start', kind: 'tunnel', tier: 1, rows: [J, ...rep(N3, 38), J] }

// 터널: 평평한 3칸 바닥(화면에 가속 화살표, ±1.5 m에 마젠타 벽). 지날 때마다 속도 단계 +1.
export const TUNNELS: readonly SegmentTemplate[] = [
  { id: 'tunnel-24', kind: 'tunnel', tier: 1, rows: [J, ...rep(N3, 22), J] },
  { id: 'tunnel-27', kind: 'tunnel', tier: 1, rows: [J, ...rep(N3, 25), J] },
  { id: 'tunnel-30', kind: 'tunnel', tier: 1, rows: [J, ...rep(N3, 28), J] },
]

// 내리막: 터널 출구 뒤 3칸 능선(녹화 11.0~12.5 s, 15.75~16.75 s, 22.75~23.75 s, 31.5~32.25 s). 조각마다 4 m 이상 내려간다.
// 능선은 급경사·단차로 내려가며 군데군데 2칸·1칸까지 좁아진다.
export const DESCENTS: readonly SegmentTemplate[] = [
  // 곧게 뻗은 3칸 능선 급경사, 단차 하나, 다시 급경사(녹화 31.5~32.25 s).
  { id: 'd-steep', kind: 'descent', tier: 1, rows: [J, ...rep(N3, 3), ...rep(RS, 6), RL, ...rep(N3, 16), ...rep(RS, 4), ...rep(N3, 14), J] },
  // 급경사와 단차 계단 두 번. 두 번째 단차 뒤 착지한 능선이 잠깐 2칸으로 좁아진다.
  {
    id: 'd-steps', kind: 'descent', tier: 1,
    rows: [J, ...rep(N3, 2), ...rep(RS, 3), RL, ...rep(N3, 16), ...rep(RS, 2), RL, ...rep(N3, 16), ...rep(N2, 14), ...rep(N3, 12), J],
  },
  // 혀 모양 능선: 3칸 급경사 뒤 평평한 능선이 2칸 → 1칸 → 2칸 → 3칸(녹화 12.0 s, 16.0 s).
  {
    id: 'd-ridge', kind: 'descent', tier: 1,
    rows: [J, ...rep(N3, 2), ...rep(RS, 8), ...rep(N3, 12), ...rep(N2, 18), ...rep(N1, 12), ...rep(N2, 6), ...rep(N3, 10), J],
  },
  // 더 길게 좁아지는 능선: 3칸 급경사 두 번과 단차로 다 내려간 뒤 평평한 능선이 2칸 → 1칸으로 오래 좁아진다.
  // (끊긴 열은 높이가 그대로라 끝 이음에서 다시 쓰려면 다 내려간 뒤에 끊는다. 한 열만 미리 떨어뜨려 두는 숨은 함정은 두지 않는다.)
  {
    id: 'd-narrow-long', kind: 'descent', tier: 1,
    rows: [
      J, ...rep(N3, 2), ...rep(RS, 4), ...rep(N3, 12), RS, RS, RL, ...rep(N3, 15), ...rep(N2, 18), ...rep(N1, 18), ...rep(N2, 6),
      ...rep(N3, 6), J,
    ],
  },
  // 짧은 급경사 + 단차가 세 번 이어지는 계단식 능선(녹화 22.75~23.75 s).
  {
    id: 'd-terraces', kind: 'descent', tier: 1,
    rows: [J, ...rep(N3, 2), RS, RS, RL, ...rep(N3, 15), RS, RS, RL, ...rep(N3, 15), RS, RS, RL, ...rep(N3, 15), J],
  },
  // 급경사 능선 아래 작은 블록(녹화 4.0~5.25 s, 16.0~16.75 s).
  {
    id: 'd-steep-blocks', kind: 'descent', tier: 1,
    rows: [J, ...rep(N3, 2), ...rep(RS, 8), ...rep(N3, 10), '..B__..', ...rep(N3, 13), '..__B..', ...rep(N3, 12), J],
  },
]

// 장애물: 3칸 길 위 블록·기둥·문·벽 통로·레일·기운 판·옆으로 옮겨 가는 길. 전체로는 오르지 않는다.
export const OBSTACLES: readonly SegmentTemplate[] = [
  // ---- tier 1
  // 흩어진 블록 1칸(녹화 17.0~19.5 s). 가운데 블록은 양옆 1칸 틈.
  {
    id: 'o1-scatter', kind: 'obstacle', tier: 1,
    rows: [J, ...rep(N3, 12), '..__B..', ...rep(N3, 12), '..B__..', ...rep(N3, 17), '.._B_..', ...rep(N3, 17), '..__B..', ...rep(N3, 6), J],
  },
  // 길 가장자리 큰 기둥(녹화 17.75 s, 19.0 s), 마지막은 기둥 사이 1칸.
  {
    id: 'o1-edge-pillars', kind: 'obstacle', tier: 1,
    rows: [J, ...rep(N3, 12), '..P__..', '..P__..', ...rep(N3, 12), '..__P..', '..__P..', ...rep(N3, 17), '..P_P..', '..P_P..', ...rep(N3, 6), J],
  },
  // 가운데 1칸 문(마젠타 큐브 둘 + 위 남색 가로대, 녹화 27.0 s) 뒤 왼쪽으로 옮겨 간 길의 가장자리 블록.
  {
    id: 'o1-gate-wide', kind: 'obstacle', tier: 1,
    rows: [J, ...rep(N3, 17), '..G_G..', ...rep(N3, 12), ...rep(L3, 13), '.__B...', ...rep(L3, 12), ...rep(N3, 6), J],
  },
  // 2칸으로 좁아진 길이 옆으로 옮겨 간다.
  { id: 'o1-narrow2', kind: 'obstacle', tier: 1, rows: [J, ...rep(N3, 12), ...rep(N2, 13), ...rep('...__..', 13), ...rep(N3, 6), J] },
  // 좌우로 번갈아 기운 3칸 판(녹화 4.5 s, 7.0 s의 맛보기).
  {
    id: 'o1-bank-intro', kind: 'obstacle', tier: 1,
    rows: [J, ...rep(N3, 8), ...rep('..>>>..', 9), ...rep(N3, 10), ...rep('..<<<..', 9), ...rep(N3, 10), J],
  },
  // 완만한 내리막 끝 블록과 블록 사이 1칸.
  {
    id: 'o1-down-blocks', kind: 'obstacle', tier: 1,
    rows: [J, N3, N3, ...rep(D3, 4), ...rep(N3, 10), '..B__..', ...rep(N3, 17), '..B_B..', ...rep(N3, 6), J],
  },
  // ---- tier 2
  // 가운데 1칸 문 뒤 블록 벽 사이 1칸 통로(녹화 27.0~27.5 s).
  {
    id: 'o2-gate-corridor', kind: 'obstacle', tier: 2,
    rows: [J, ...rep(N3, 17), '..G_G..', ...rep('..B_B..', 10), ...rep(N3, 12), '..B__..', ...rep(N3, 6), J],
  },
  // 구멍으로 갈라진 1칸 레일 두 줄.
  { id: 'o2-rails', kind: 'obstacle', tier: 2, rows: [J, ...rep(N3, 17), ...rep('.._._..', 17), ...rep(N3, 6), J] },
  // 1칸 틈이 길 양끝을 오간다(두 칸 건너기 21 + 5행).
  {
    id: 'o2-zigzag', kind: 'obstacle', tier: 2,
    rows: [J, ...rep(N3, 26), '..BB_..', ...rep(N3, 26), '.._BB..', ...rep(N3, 26), '..BB_..', ...rep(N3, 6), J],
  },
  // 휘는 길 흉내: 3칸 길이 13행마다 한 칸씩 왼쪽 끝까지 옮겨 갔다가 오른쪽으로 돌아온다.
  {
    id: 'o2-shift-path', kind: 'obstacle', tier: 2,
    rows: [J, ...rep(N3, 12), ...rep(L3, 13), ...rep(LL3, 13), ...rep(L3, 13), ...rep(N3, 13), ...rep(R3, 13), ...rep(N3, 6), J],
  },
  // 기운 3칸 판이 좌우로 번갈아 기울며 옆으로 옮겨 간다(녹화 4.5~8.0 s).
  {
    id: 'o2-bank-alt', kind: 'obstacle', tier: 2,
    rows: [
      J, ...rep(N3, 4), ...rep('..>>>..', 13), ...rep('.<<<...', 13), ...rep('..>>>..', 13), ...rep('...<<<.', 13), ...rep(N3, 12), J,
    ],
  },
  // 기둥과 블록 사이 1칸 틈(녹화 25.5 s 큰 블록, 35.25 s 높은 기둥).
  {
    id: 'o2-pillar-blocks', kind: 'obstacle', tier: 2,
    rows: [J, ...rep(N3, 17), '..P_B..', ...rep(N3, 17), '..BP_..', ...rep(N3, 12), '..P__..', '..P__..', ...rep(N3, 6), J],
  },
  // 단차로 내려선 판 위 블록.
  {
    id: 'o2-ledge-blocks', kind: 'obstacle', tier: 2,
    rows: [J, N3, N3, RL, ...rep(N3, 15), '..B_B..', ...rep(N3, 12), '..__B..', ...rep(N3, 6), RL, ...rep(N3, 15), J],
  },
  // 점프대 → 길 전체 구멍 8행 → 긴 착지 평지(v4).
  { id: 'j2-pad-gap', kind: 'obstacle', tier: 2, rows: [J, ...rep(N3, 20), PAD, ...rep(GAP, 8), ...rep(N3, 44), J] },
  // 왕복 블록 하나(v4). 큐브 반대쪽으로 비켜 지난다.
  { id: 'm2-shuttle', kind: 'obstacle', tier: 2, rows: [J, ...rep(N3, 30), SHUT, ...rep(N3, 30), J] },
  // ---- tier 3
  // 점프대 → 길 전체 1 m 블록 벽(점프로만 넘는다, v4).
  { id: 'j3-pad-wall', kind: 'obstacle', tier: 3, rows: [J, ...rep(N3, 20), PAD, ...rep(N3, 8), WALL, ...rep(N3, 44), J] },
  // 2칸으로 좁아졌다가 왼쪽으로 옮겨 간 3칸 길 위 왕복 블록(v4).
  {
    id: 'm3-narrow-shuttle', kind: 'obstacle', tier: 3,
    rows: [J, ...rep(N3, 12), ...rep(N2, 14), ...rep(L3, 30), '.MMM...', ...rep(L3, 26), ...rep(N3, 14), J],
  },
  // 멀리 떨어진 왕복 블록 둘(행 위상이 35 × MOVER_ROW_OFFSET ≈ 반 주기 어긋난다, v4).
  { id: 'm3-two-shuttles', kind: 'obstacle', tier: 3, rows: [J, ...rep(N3, 30), SHUT, ...rep(N3, 34), SHUT, ...rep(N3, 30), J] },
  // 1칸 문(마젠타 큐브 둘 + 남색 가로대) 뒤 벽 통로, 왼쪽으로 옮겨 간 둘째 문과 통로(녹화 27.0 s, 30.0 s).
  {
    id: 'o3-gate-narrow', kind: 'obstacle', tier: 3,
    rows: [J, ...rep(N3, 17), '..G_G..', ...rep('..B_B..', 10), ...rep(N3, 17), '.G_G...', ...rep('.B_B...', 8), ...rep(N3, 6), J],
  },
  // 마젠타 띠로 갈라진 1칸 레일 두 줄(녹화 28.5~29.0 s).
  { id: 'o3-rails-strips', kind: 'obstacle', tier: 3, rows: [J, ...rep(N3, 17), ...rep('.._B_..', 20), ...rep(N3, 6), J] },
  // 기운 판이 미는 쪽과 반대로 옮겨 가는 굽은 길. 양쪽으로 미는 행 수가 같다(drift는 줄지 않는다).
  {
    id: 'o3-bank-wind', kind: 'obstacle', tier: 3,
    rows: [
      J, ...rep(N3, 4), ...rep('..<<<..', 13), ...rep('...>>>.', 13), ...rep('..<<<..', 13), ...rep('.>>>...', 13), ...rep(N3, 12), J,
    ],
  },
  // 기둥 낀 블록 사이로 지그재그, 끝은 가운데 1칸 틈.
  {
    id: 'o3-slalom', kind: 'obstacle', tier: 3,
    rows: [J, ...rep(N3, 26), '..PB_..', ...rep(N3, 26), '.._BP..', ...rep(N3, 17), '..P_B..', ...rep(N3, 6), J],
  },
  // 오르막 끝 구멍 점프.
  {
    id: 'o3-jump', kind: 'obstacle', tier: 3,
    rows: [J, ...rep(N3, 4), ...rep(U3, 4), '.......', '.......', ...rep(N3, 50), ...rep(D3, 4), ...rep(N3, 6), J],
  },
  // 완만히 내려가 높은 기둥 사이 1칸 통로, 그다음 가장자리 기둥 줄이 좌우로 바뀐다.
  {
    id: 'o3-down-corridor', kind: 'obstacle', tier: 3,
    rows: [
      J, N3, N3, ...rep(D3, 4), ...rep(N3, 12), ...rep('..P_P..', 12), ...rep(N3, 6), ...rep('..P__..', 8), ...rep(N3, 12),
      ...rep('..__P..', 8), ...rep(N3, 10), J,
    ],
  },
  // ---- tier 4
  // 섬 건너기: 점프대 → 구멍 → 37행 섬(최고 속도에서도 섬 위에 내린다) → 점프대 → 구멍 → 착지(v4).
  {
    id: 'j4-islands', kind: 'obstacle', tier: 4,
    rows: [J, ...rep(N3, 16), PAD, ...rep(GAP, 8), ...rep(N3, 37), PAD, ...rep(GAP, 8), ...rep(N3, 44), J],
  },
  // 점프대로 구멍을 넘고 한참 뒤 왕복 블록(v4).
  {
    id: 'mj4-pad-shuttle', kind: 'obstacle', tier: 4,
    rows: [J, ...rep(N3, 16), PAD, ...rep(GAP, 8), ...rep(N3, 70), SHUT, ...rep(N3, 30), J],
  },
  // 왼쪽 1칸 레일 → 3칸 건널목 → 오른쪽 1칸 레일.
  {
    id: 'o4-rails-switch', kind: 'obstacle', tier: 4,
    rows: [J, ...rep(N3, 26), ...rep('.._....', 14), ...rep(N3, 26), ...rep('...._..', 14), ...rep(N3, 6), J],
  },
  // 1칸 문 → 벽 통로 → 마젠타 띠 양옆 1칸 레일.
  {
    id: 'o4-gate-rails', kind: 'obstacle', tier: 4,
    rows: [J, ...rep(N3, 17), '..G_G..', ...rep('..B_B..', 8), ...rep(N3, 17), ...rep('.._B_..', 12), ...rep(N3, 6), J],
  },
  // 기운 판이 미는 쪽으로 옮겨 가는 굽은 3칸 길(바깥 열까지). 같은 쪽으로 미는 판은 10행까지만 잇고, 길이 옮겨 가는 곳에
  // 평평한 3행을 끼워 숨 돌릴 틈을 둔다(같은 쪽 기운 판 연속 13행 이하). 양쪽으로 미는 행 수가 같다(30행씩).
  {
    id: 'o4-bank-shift', kind: 'obstacle', tier: 4,
    rows: [
      J, ...rep(N3, 4), ...rep('..>>>..', 10), ...rep(R3, 3), ...rep('...>>>.', 10), ...rep('...<<<.', 10), ...rep(N3, 3),
      ...rep('..<<<..', 10), ...rep(L3, 3), ...rep('.<<<...', 10), ...rep('.>>>...', 10), ...rep(N3, 12), J,
    ],
  },
  // 촘촘한 블록 벽, 1칸 틈이 옮겨 간다.
  {
    id: 'o4-dense', kind: 'obstacle', tier: 4,
    rows: [
      J, ...rep(N3, 12), '..B__..', ...rep(N3, 17), '..B_B..', ...rep(N3, 17), '..BB_..', ...rep(N3, 26), '.._BB..', ...rep(N3, 17),
      '..B_B..', ...rep(N3, 12), J,
    ],
  },
  // 단차로 내려서자마자 1칸 레일, 다시 단차.
  {
    id: 'o4-ledge-rails', kind: 'obstacle', tier: 4,
    rows: [J, N3, N3, RL, ...rep(N3, 15), ...rep('.._._..', 17), ...rep(N3, 6), RL, ...rep(N3, 15), J],
  },
]

export const TEMPLATES: readonly SegmentTemplate[] = [...TUNNELS, ...DESCENTS, ...OBSTACLES]
export const PARSED_TUNNELS: readonly ParsedSegment[] = TUNNELS.map(parseSegment)
export const PARSED_DESCENTS: readonly ParsedSegment[] = DESCENTS.map(parseSegment)
export const PARSED_OBSTACLES: readonly ParsedSegment[] = OBSTACLES.map(parseSegment)
export const PARSED: readonly ParsedSegment[] = [...PARSED_TUNNELS, ...PARSED_DESCENTS, ...PARSED_OBSTACLES]
export const START_PARSED: ParsedSegment = parseSegment(START)

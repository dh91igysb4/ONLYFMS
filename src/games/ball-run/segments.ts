import { COL_MAX, COL_MIN, GATE_H, LEDGE, PILLAR_H, RAMP_STEP, STEEP_STEP } from './constants.ts'

export type Cell = { floor: null | { h0: number; h1: number }; block: boolean; blockH?: number; bank?: -1 | 1 }
export type SegmentKind = 'tunnel' | 'descent' | 'obstacle'
export type SegmentTemplate = { id: string; kind: SegmentKind; tier: 1 | 2 | 3 | 4; rows: string[] }
export type ParsedSegment = {
  id: string
  kind: SegmentKind
  tier: 1 | 2 | 3 | 4
  length: number
  cells: Cell[][] // cells[rowIndex][col - COL_MIN], 높이는 조각 시작 기준 상대값(mm)
  dh: number
}

export const JOINT = '._____.'
const COLS = COL_MAX - COL_MIN + 1

export function parseSegment(t: SegmentTemplate): ParsedSegment {
  const fail = (msg: string): never => {
    throw new Error(`segment ${t.id}: ${msg}`)
  }
  const { rows } = t
  if (rows.length < 2) fail('rows too short')
  if (rows[0] !== JOINT || rows[rows.length - 1] !== JOINT) fail('must start and end with the joint row')

  const h: number[] = new Array(COLS).fill(0)
  const cells: Cell[][] = []
  rows.forEach((row, r) => {
    if (row.length !== COLS) fail(`row ${r} must have ${COLS} chars`)
    const out: Cell[] = []
    for (let i = 0; i < COLS; i++) {
      const ch = row[i]
      // 터널 안은 바닥 '_'만. 바깥 열(벽 바깥)은 구멍이어도 된다.
      if (t.kind === 'tunnel' && r > 0 && r < rows.length - 1 && ch !== '_' && !(ch === '.' && (i === 0 || i === COLS - 1))) {
        fail(`row ${r}: tunnel allows only '_' (and '.' in the outer columns)`)
      }
      switch (ch) {
        case '_':
          out.push({ floor: { h0: h[i], h1: h[i] }, block: false })
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

  const mid = h.slice(1, COLS - 1)
  if (mid.some((v) => v !== mid[0])) fail('middle columns must end at the same height')
  return { id: t.id, kind: t.kind, tier: t.tier, length: rows.length, cells, dh: mid[0] }
}

const J = JOINT
const rep = (row: string, n: number): string[] => new Array<string>(n).fill(row)
const W = '._____.' // 5칸 평지(이음 행과 같은 폭)
const S = '.!!!!!.' // 5칸 급경사 한 행(−500 mm)
const L = '.vvvvv.' // 5칸 단차(−1000 mm)
const N3 = '..___..' // 가운데 3칸
const D5 = '.' + '\\'.repeat(5) + '.' // 5칸 완만한 내리막(−250 mm)
const U5 = './////.' // 5칸 오르막(+250 mm)

// 설계 기준(최고 속도 467 mm/틱, 옆 최고 117 mm/틱·가속 25 mm/틱²):
// - 필요한 차선 변경 사이 빈 행: 1칸 7행 이상, 2칸 12행, 3칸 16행. 1칸 틈으로 들어가면 +3행(1칸 10행, 2칸 15행).
//   2칸 틈을 지난 공은 틈의 어느 칸에든 있을 수 있으니 먼 쪽 칸 기준으로 센다.
// - 조각 첫 장애물은 이음 행 뒤 6~9행(앞 조각 끝에서 공이 어디 있든 건너올 거리).
// - 단차 뒤 착지까지 최고 속도에서 약 8행 → 단차 뒤 9행 이상 평지.
// - 같은 쪽으로 미는 기운 판은 연속 8행 이하. 길게 이으려면 평지를 끼우거나 방향을 바꾼다.
// - 칸 높이가 다른 열은 벽, 구멍 열은 높이가 그대로라 좁은 능선이 내려갈 만큼 바깥 열을 먼저 떨어뜨린 뒤 끊는다(fallAway).

// 시작 터널(속도 단계 1로 센다 — 시작 직후 '속도 증가' 한 번). 첫 화면이 터널 안이다.
export const START: SegmentTemplate = { id: 'start', kind: 'tunnel', tier: 1, rows: [J, ...rep(W, 22), J] }

// 터널: 평평한 5칸 바닥(화면에 가속 화살표, ±2.5 m에 마젠타 벽). 지날 때마다 속도 단계 +1.
export const TUNNELS: readonly SegmentTemplate[] = [
  { id: 'tunnel-14', kind: 'tunnel', tier: 1, rows: [J, ...rep(W, 12), J] },
  { id: 'tunnel-16', kind: 'tunnel', tier: 1, rows: [J, ...rep(W, 14), J] },
  { id: 'tunnel-18', kind: 'tunnel', tier: 1, rows: [J, ...rep(W, 16), J] },
]

// 내리막: 터널 출구 뒤 좁은 능선(녹화 11.0~12.5 s, 15.75~16.75 s, 22.75~23.75 s, 31.5~32.25 s). 조각마다 4 m 이상 내려간다.
// 앞 6행은 5칸 그대로(공이 어디서 오든 옆으로 비킬 거리), 그다음 바깥 판이 한쪽씩 떨어져 나가 3칸 능선이 되고,
// 능선은 급경사·단차로 내려가며 군데군데 2칸·1칸까지 좁아진다. 구멍 열은 높이가 그대로라서, 능선이 앞으로 내려갈 만큼
// 바깥 판이 미리 단차('v')로 떨어진 뒤 끊긴다(fallAway). 능선 옆 열이 끊길 때도 같다('..__v..').
const RS = '..!!!..' // 3칸 능선 급경사(−500 mm)
const RL = '..vvv..' // 3칸 능선 단차(−1000 mm)
const N2 = '..__...' // 2칸 능선
const N1 = '..._...' // 1칸 능선
// 5칸 → 4칸 → 3칸. 오른쪽(+2) 판이 drop만큼 단차로 떨어진 뒤 끊기고, 4행 뒤 왼쪽(−2) 판이 같은 식으로 끊긴다.
// 가운데 3칸은 평평하다. 첫 행은 조각의 7행째 이후에 둔다(최고 속도에서 1칸 비키는 7행).
const fallAway = (drop: number): string[] => {
  const k = Math.floor(drop / 1000)
  const out: string[] = []
  for (let i = 0; i < 4 + k; i++) {
    const right = i < k ? 'v' : '.'
    const left = i < 4 ? '_' : i - 4 < k ? 'v' : '.'
    out.push(`.${left}___${right}.`)
  }
  return out
}

export const DESCENTS: readonly SegmentTemplate[] = [
  // 곧게 뻗은 3칸 능선 급경사(녹화 31.5~32.25 s).
  {
    id: 'd-steep', kind: 'descent', tier: 1,
    rows: [J, W, ...rep(S, 5), ...fallAway(3000), ...rep(RS, 6), ...rep(N3, 16), J],
  },
  // 급경사와 단차 계단 두 번. 두 번째 단차 뒤 착지한 능선이 잠깐 2칸으로 좁아진다.
  {
    id: 'd-steps', kind: 'descent', tier: 1,
    rows: [
      J, W, S, S, S, L, W, ...fallAway(2000), N3, N3, RS, RS, RL, ...rep(N3, 6), ...rep(N2, 4), ...rep(N3, 5), J,
    ],
  },
  // 혀 모양 능선: 3칸 급경사 뒤 평평한 능선이 2칸 → 1칸 → 2칸 → 3칸(녹화 12.0 s, 16.0 s).
  {
    id: 'd-ridge', kind: 'descent', tier: 1,
    rows: [
      J, W, ...rep(S, 5), ...fallAway(2000), ...rep(RS, 4), ...rep(N3, 4), ...rep(N2, 4), ...rep(N1, 4), ...rep(N2, 4),
      ...rep(N3, 4), J,
    ],
  },
  // 더 길게 좁아지는 능선: 3칸 급경사 → 2칸 급경사 끝에 단차 → 1칸 능선.
  {
    id: 'd-narrow-long', kind: 'descent', tier: 1,
    rows: [
      J, W, ...rep(S, 5), ...fallAway(3000), RS, RS, N3, N3, '..__v..', '..__v..', '..!!...', '..!!...', '..vv...',
      ...rep(N2, 7), ...rep(N1, 4), N2, N2, J,
    ],
  },
  // 짧은 급경사 + 단차가 세 번 이어지는 계단식 능선(녹화 22.75~23.75 s).
  {
    id: 'd-terraces', kind: 'descent', tier: 1,
    rows: [J, W, S, S, L, W, W, ...fallAway(4000), RS, RS, RL, ...rep(N3, 9), RS, RS, RL, ...rep(N3, 9), J],
  },
  // 급경사 능선 아래 멀리 보이는 작은 블록(녹화 4.0~5.25 s, 16.0~16.75 s). 가운데로 가면 닿지 않는다.
  {
    id: 'd-steep-blocks', kind: 'descent', tier: 1,
    rows: [
      J, W, ...rep(S, 5), ...fallAway(2000), ...rep(RS, 4), ...rep(N3, 6), '..B__..', ...rep(N3, 7), '..__B..',
      ...rep(N3, 6), J,
    ],
  },
]

// 장애물: 5칸 격자 위 블록·기둥·문·벽 통로·레일·기운 판·비스듬히 옮겨 가는 길. 전체로는 오르지 않는다.
export const OBSTACLES: readonly SegmentTemplate[] = [
  // ---- tier 1
  // 흩어진 블록 1칸(녹화 17.0~19.5 s).
  {
    id: 'o1-scatter', kind: 'obstacle', tier: 1,
    rows: [J, ...rep(W, 6), '.___B_.', ...rep(W, 7), '._B___.', ...rep(W, 7), '.__B__.', ...rep(W, 6), J],
  },
  // 가장자리 큰 기둥 사이 블록(녹화 17.75 s, 19.0 s).
  {
    id: 'o1-edge-pillars', kind: 'obstacle', tier: 1,
    rows: [J, ...rep(W, 5), '.P___P.', '.P___P.', ...rep(W, 10), '.P_B_P.', ...rep(W, 7), '.P___P.', '.P___P.', ...rep(W, 5), J],
  },
  // 3칸으로 좁아진 판 끝 가운데 1칸 문(마젠타 큐브 둘 + 위 남색 가로대, 녹화 27.0 s) 뒤 넓은 판, 가장자리 블록.
  {
    id: 'o1-gate-wide', kind: 'obstacle', tier: 1,
    rows: [J, ...rep(W, 7), ...rep(N3, 4), '..G_G..', ...rep(W, 10), '.B___B.', ...rep(W, 6), J],
  },
  // 가운데 3칸으로 좁아지는 판.
  { id: 'o1-narrow3', kind: 'obstacle', tier: 1, rows: [J, ...rep(W, 3), ...rep(N3, 10), ...rep(W, 4), J] },
  // 좌우로 번갈아 기운 3칸 판(녹화 4.5 s, 7.0 s의 맛보기).
  {
    id: 'o1-bank-intro', kind: 'obstacle', tier: 1,
    rows: [J, ...rep(W, 4), ...rep('..>>>..', 5), ...rep(W, 5), ...rep('..<<<..', 5), ...rep(W, 5), J],
  },
  // 완만한 내리막 끝 가장자리 블록과 1칸 블록 둘.
  {
    id: 'o1-down-blocks', kind: 'obstacle', tier: 1,
    rows: [J, W, W, ...rep(D5, 4), ...rep(W, 6), '.B___B.', ...rep(W, 10), '._B_B_.', ...rep(W, 6), J],
  },
  // ---- tier 2
  // 왼쪽 가운데 1칸 문 뒤 2칸 벽 통로(녹화 27.0~27.5 s).
  {
    id: 'o2-gate-corridor', kind: 'obstacle', tier: 2,
    rows: [J, ...rep(W, 8), '.G_GBB.', ...rep('.B__BB.', 8), ...rep(W, 6), J],
  },
  // 구멍으로 갈라진 1칸 레일 두 줄.
  { id: 'o2-rails', kind: 'obstacle', tier: 2, rows: [J, ...rep(W, 8), ...rep('.._._..', 10), ...rep(W, 6), J] },
  // 틈이 좌우로 옮겨 가는 블록 벽. 반대쪽 2칸 틈 사이는 16행(틈 바깥쪽 칸에서 3칸 건너는 경우).
  {
    id: 'o2-zigzag', kind: 'obstacle', tier: 2,
    rows: [J, ...rep(W, 8), '.BBB__.', ...rep(W, 16), '.__BBB.', ...rep(W, 16), '.BBB__.', ...rep(W, 5), J],
  },
  // 휘는 길 흉내: 3칸 길이 7행마다 한 칸씩 옆으로 옮겨 간다.
  {
    id: 'o2-shift-path', kind: 'obstacle', tier: 2,
    rows: [
      J, ...rep(W, 3), ...rep(N3, 3), ...rep('.___...', 7), ...rep('___....', 7), ...rep('.___...', 7),
      ...rep(N3, 7), ...rep('...___.', 7), ...rep(N3, 3), ...rep(W, 3), J,
    ],
  },
  // 기운 3칸 판이 좌우로 번갈아 기울며 옆으로 옮겨 간다(녹화 4.5~8.0 s).
  {
    id: 'o2-bank-alt', kind: 'obstacle', tier: 2,
    rows: [
      J, ...rep(W, 4), ...rep('..>>>..', 6), ...rep('.<<<...', 6), ...rep('..>>>..', 6), ...rep('...<<<.', 6),
      ...rep(W, 4), J,
    ],
  },
  // 가장자리 기둥과 블록(녹화 25.5 s 큰 블록, 35.25 s 높은 기둥).
  {
    id: 'o2-pillar-blocks', kind: 'obstacle', tier: 2,
    rows: [J, ...rep(W, 7), '.P_B_P.', ...rep(W, 10), '.__BP_.', ...rep(W, 8), '.P___P.', '.P___P.', ...rep(W, 4), J],
  },
  // 단차로 내려선 판 위 블록.
  {
    id: 'o2-ledge-blocks', kind: 'obstacle', tier: 2,
    rows: [J, W, W, L, ...rep(W, 10), '._B_B_.', ...rep(W, 8), '.B___B.', ...rep(W, 3), L, ...rep(W, 9), J],
  },
  // ---- tier 3
  // 3칸 판 끝 1칸 문(마젠타 큐브 둘 + 남색 가로대) 뒤 3칸 벽 통로(녹화 27.0 s, 30.0 s).
  {
    id: 'o3-gate-narrow', kind: 'obstacle', tier: 3,
    rows: [J, ...rep(W, 5), ...rep(N3, 4), '..G_G..', ...rep('.B___B.', 8), ...rep(W, 5), J],
  },
  // 마젠타 띠로 갈라진 1칸 레일 두 줄(녹화 28.5~29.0 s).
  { id: 'o3-rails-strips', kind: 'obstacle', tier: 3, rows: [J, ...rep(W, 8), ...rep('.._B_..', 12), ...rep(W, 6), J] },
  // 기운 판이 미는 쪽과 반대로도 옮겨 가는 굽은 길. 양쪽으로 미는 행 수가 같다(drift는 줄지 않는다).
  {
    id: 'o3-bank-wind', kind: 'obstacle', tier: 3,
    rows: [
      J, ...rep(W, 4), ...rep('..<<<..', 6), ...rep('...>>>.', 6), ...rep('..<<<..', 6), ...rep('.>>>...', 6),
      ...rep(N3, 4), ...rep(W, 4), J,
    ],
  },
  // 기둥 낀 블록 벽 사이로 지그재그, 끝은 1칸 틈.
  {
    id: 'o3-slalom', kind: 'obstacle', tier: 3,
    rows: [J, ...rep(W, 8), '.PBB__.', ...rep(W, 16), '.__BBP.', ...rep(W, 16), '.PB_BP.', ...rep(W, 5), J],
  },
  // 오르막 끝 구멍 점프.
  {
    id: 'o3-jump', kind: 'obstacle', tier: 3,
    rows: [J, ...rep(W, 4), ...rep(U5, 4), '.......', '.......', ...rep(W, 18), ...rep(D5, 4), ...rep(W, 3), J],
  },
  // 완만히 내려가 높은 기둥 통로, 통로 안 블록과 1칸 틈.
  {
    id: 'o3-down-corridor', kind: 'obstacle', tier: 3,
    rows: [
      J, W, W, ...rep(D5, 4), ...rep(W, 5), ...rep('.P___P.', 6), '.P_B_P.', ...rep('.P___P.', 8), '.PB_BP.',
      ...rep('.P___P.', 4), ...rep(W, 4), J,
    ],
  },
  // ---- tier 4
  // 왼쪽 1칸 레일 → 3칸 건널목 → 오른쪽 1칸 레일.
  {
    id: 'o4-rails-switch', kind: 'obstacle', tier: 4,
    rows: [J, ...rep(W, 7), ...rep('.._....', 8), ...rep(N3, 12), ...rep('...._..', 8), N3, N3, ...rep(W, 3), J],
  },
  // 1칸 문 → 벽 통로 → 벽 사이 1칸 레일.
  {
    id: 'o4-gate-rails', kind: 'obstacle', tier: 4,
    rows: [J, ...rep(W, 8), '.BG_GB.', ...rep('.B___B.', 8), ...rep('.B_B_B.', 8), ...rep(W, 5), J],
  },
  // 기운 판이 미는 쪽으로 옮겨 가는 굽은 3칸 길(바깥 열까지). 같은 쪽으로 미는 판은 6행까지만 잇고, 길이 옮겨 가는 곳에
  // 평평한 2행을 끼워 숨 돌릴 틈을 둔다(같은 쪽 기운 판 연속 8행 이하). 양쪽으로 미는 행 수가 같다(18행씩).
  {
    id: 'o4-bank-shift', kind: 'obstacle', tier: 4,
    rows: [
      J, ...rep(W, 4), ...rep('..>>>..', 6), ...rep('...___.', 2), ...rep('...>>>.', 6), ...rep('...<<<.', 6),
      ...rep('..___..', 2), ...rep('..<<<..', 6), ...rep('.___...', 2), ...rep('.<<<...', 6), ...rep('.>>>...', 6),
      ...rep('..___..', 7), ...rep(W, 4), J,
    ],
  },
  // 촘촘한 블록 벽, 틈이 옮겨 가다 1칸 틈으로 끝난다.
  {
    id: 'o4-dense', kind: 'obstacle', tier: 4,
    rows: [
      J, ...rep(W, 9), '.BBB__.', ...rep(W, 16), '.__BBB.', ...rep(W, 10), '._BB_B.', ...rep(W, 15), '.B_BBB.',
      ...rep(W, 12), '.BB_BB.', ...rep(W, 4), J,
    ],
  },
  // 단차로 내려서자마자 1칸 레일, 다시 단차.
  {
    id: 'o4-ledge-rails', kind: 'obstacle', tier: 4,
    rows: [J, W, W, L, ...rep(W, 10), ...rep('.._._..', 10), ...rep(W, 3), L, ...rep(W, 9), J],
  },
]

export const TEMPLATES: readonly SegmentTemplate[] = [...TUNNELS, ...DESCENTS, ...OBSTACLES]
export const PARSED_TUNNELS: readonly ParsedSegment[] = TUNNELS.map(parseSegment)
export const PARSED_DESCENTS: readonly ParsedSegment[] = DESCENTS.map(parseSegment)
export const PARSED_OBSTACLES: readonly ParsedSegment[] = OBSTACLES.map(parseSegment)
export const PARSED: readonly ParsedSegment[] = [...PARSED_TUNNELS, ...PARSED_DESCENTS, ...PARSED_OBSTACLES]
export const START_PARSED: ParsedSegment = parseSegment(START)

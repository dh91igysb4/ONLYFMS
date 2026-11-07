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
      if (t.kind === 'tunnel' && r > 0 && r < rows.length - 1 && ch !== '_') {
        fail(`row ${r}: tunnel allows only '_'`)
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
const F = '_______'
const DOWN = '\\'.repeat(7)
const UP = '///////'
const HOLES = '.......'

export const START: SegmentTemplate = { id: 'start', kind: 'tunnel', tier: 1, rows: [J, ...rep(F, 34), J] }

// 모든 조각은 이음 행으로 시작하고 끝난다. 점프 뒤에는 최고 속도(약 15 m 비행)에서도 착지할 평지를 둔다.
export const TEMPLATES: readonly SegmentTemplate[] = [
  // ---- tier 1
  { id: 't1-straight', kind: 'obstacle', tier: 1, rows: [J, ...rep(F, 10), J] },
  { id: 't1-block-left', kind: 'obstacle', tier: 1, rows: [J, ...rep(F, 4), ...rep('_BB____', 2), ...rep(F, 5), J] },
  { id: 't1-block-mid', kind: 'obstacle', tier: 1, rows: [J, ...rep(F, 4), ...rep('__BBB__', 2), ...rep(F, 5), J] },
  { id: 't1-block-right', kind: 'obstacle', tier: 1, rows: [J, ...rep(F, 4), ...rep('____BB_', 2), ...rep(F, 5), J] },
  {
    id: 't1-narrow3',
    kind: 'obstacle', tier: 1,
    rows: [J, ...rep(J, 2), ...rep('..___..', 8), ...rep(J, 2), J],
  },
  { id: 't1-gentle-down', kind: 'obstacle', tier: 1, rows: [J, ...rep(F, 3), ...rep(DOWN, 2), ...rep(F, 5), J] },
  // ---- tier 2
  {
    // 벽 사이 12행: 최고 속도에서 4칸 벽을 반대편으로 돌아가려면(약 1.85 m 옆 이동) 약 7.4 m가 든다.
    // 첫 벽 앞 9행: 앞 조각이 공을 바깥으로 몰아도 첫 벽까지 건너올 거리.
    id: 't2-zigzag',
    kind: 'obstacle', tier: 2,
    rows: [
      J, ...rep(F, 9),
      ...rep('BBBB___', 2), ...rep(F, 12),
      ...rep('___BBBB', 2), ...rep(F, 12),
      ...rep('BBBB___', 2), ...rep(F, 3), J,
    ],
  },
  {
    id: 't2-bridge2',
    kind: 'obstacle', tier: 2,
    rows: [J, ...rep(J, 2), ...rep('..___..', 2), ...rep('...__..', 8), ...rep('..___..', 2), ...rep(J, 2), J],
  },
  {
    id: 't2-hill',
    kind: 'obstacle', tier: 2,
    rows: [J, ...rep(F, 3), ...rep(UP, 3), ...rep(F, 2), ...rep(DOWN, 3), ...rep(F, 3), J],
  },
  {
    // 블록 사이 12행: 8행이면 최고 속도에서 가운데로 건너가지 못해 바깥 열(±3)로만 빠지고, 다음 조각 첫 벽에 걸린다.
    id: 't2-tunnel-two-blocks',
    kind: 'obstacle', tier: 2,
    rows: [J, ...rep(F, 4), ...rep('_BBB___', 2), ...rep(F, 12), ...rep('___BBB_', 2), ...rep(F, 4), J],
  },
  {
    // 바깥 틈(±3)으로 빠지면 다음 벽까지 크게 옮겨야 하므로 벽 사이 12행, 끝 평지 6행.
    id: 't2-double-block',
    kind: 'obstacle', tier: 2,
    rows: [J, ...rep(F, 4), ...rep('_BB_BB_', 2), ...rep(F, 12), ...rep('__B_B__', 2), ...rep(F, 6), J],
  },
  // ---- tier 3
  {
    // 왼쪽 4칸만 오르막 -> 높이가 다른 두 갈래. 각 갈래에 블록 하나.
    id: 't3-two-branches',
    kind: 'obstacle', tier: 3,
    rows: [
      J, ...rep(F, 3), ...rep('////___', 2), ...rep('____B__', 1), ...rep('_______', 5),
      ...rep('_B_____', 1), ...rep('_______', 2), ...rep('\\\\\\\\___', 2), ...rep(F, 3), J,
    ],
  },
  {
    // 오르막 4행 끝에서 구멍 2행. 착지 바닥은 오르막 끝 높이.
    id: 't3-jump',
    kind: 'obstacle', tier: 3,
    rows: [J, ...rep(F, 4), ...rep(UP, 4), ...rep(HOLES, 2), ...rep(F, 18), ...rep(DOWN, 4), ...rep(F, 3), J],
  },
  {
    id: 't3-jump-short',
    kind: 'obstacle', tier: 3,
    rows: [J, ...rep(F, 4), ...rep(UP, 5), ...rep(HOLES, 1), ...rep(F, 18), ...rep(DOWN, 5), ...rep(F, 3), J],
  },
  {
    id: 't3-bridge1',
    kind: 'obstacle', tier: 3,
    rows: [J, ...rep(J, 2), ...rep('..___..', 2), ...rep('..._...', 10), ...rep('..___..', 2), ...rep(J, 2), J],
  },
  {
    // 블록 벽 사이 2칸 틈. 틈 위치가 한 칸 이동한다.
    id: 't3-wall-gap',
    kind: 'obstacle', tier: 3,
    rows: [J, ...rep(F, 4), ...rep('BB__BBB', 2), ...rep(F, 8), ...rep('BBBB__B', 2), ...rep(F, 8), ...rep('BB__BBB', 2), ...rep(F, 4), J],
  },
  // ---- tier 4
  {
    // 1칸 다리가 0 -> 1 -> 0 -> -1 로 옮겨 간다. 갈아타는 곳은 2칸 폭.
    id: 't4-bridge-zigzag',
    kind: 'obstacle', tier: 4,
    rows: [
      J, ...rep(J, 2), ...rep('..___..', 2),
      ...rep('..._...', 6), ...rep('...__..', 4),
      ...rep('...._..', 6), ...rep('...__..', 4),
      ...rep('..._...', 6), ...rep('..__...', 4),
      ...rep('.._....', 6),
      ...rep('..___..', 2), ...rep(J, 2), J,
    ],
  },
  {
    // 점프 직후 착지가 끝난 뒤(최고 속도 비행 약 15 m) 블록 벽.
    id: 't4-jump-block',
    kind: 'obstacle', tier: 4,
    rows: [
      J, ...rep(F, 4), ...rep(UP, 4), ...rep(HOLES, 2), ...rep(F, 17), ...rep('__BBB__', 2),
      ...rep(F, 2), ...rep(DOWN, 4), ...rep(F, 3), J,
    ],
  },
  {
    // 틈이 오른쪽 -> 왼쪽 -> 양 끝 -> 가운데로 옮겨 간다. 큰 옆 이동(약 1.85 m) 앞은 12행, 작은 이동 앞은 8~10행.
    // 첫 벽 앞 9행은 t2-zigzag와 같은 이유.
    id: 't4-tunnel-dense',
    kind: 'obstacle', tier: 4,
    rows: [
      J, ...rep(F, 9),
      ...rep('BBBB___', 2), ...rep(F, 12),
      ...rep('___BBBB', 2), ...rep(F, 10),
      ...rep('__BBB__', 2), ...rep(F, 8),
      ...rep('BB___BB', 2), ...rep(F, 3), J,
    ],
  },
  {
    // 긴 내리막 끝, 왼쪽 4칸이 구멍(오른쪽 3칸은 바닥).
    id: 't4-downhill-hole',
    kind: 'obstacle', tier: 4,
    rows: [J, ...rep(F, 3), ...rep(DOWN, 5), ...rep(F, 2), ...rep('....___', 2), ...rep(F, 5), J],
  },
]

export const PARSED: readonly ParsedSegment[] = TEMPLATES.map(parseSegment)
export const START_PARSED: ParsedSegment = parseSegment(START)

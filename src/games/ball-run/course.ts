// 시드 기반 코스 생성기. 순수 정수 연산, 외부 의존 없음.
import { COL_MAX, COL_MIN, TIER_WEIGHTS, obstaclesInStage } from './constants.ts'
import { JOINT, PARSED_DESCENTS, PARSED_OBSTACLES, PARSED_TUNNELS, START_PARSED, parseSegment } from './segments.ts'
import type { Cell, ParsedSegment, SegmentKind } from './segments.ts'

export type SegmentInfo = {
  id: string
  tier: 1 | 2 | 3 | 4
  startRow: number
  length: number
  mirrored: boolean
  base: number
  kind: SegmentKind
}

export interface Course {
  readonly seed: string
  cell(col: number, row: number): Cell
  segmentAt(row: number): SegmentInfo
  segmentsBetween(fromRow: number, toRow: number): SegmentInfo[]
  /** 시작 행이 row 이하인 터널 조각 수(시작 터널 포함). row < 0은 0행으로 본다. */
  boostsBefore(row: number): number
}

const COLS = COL_MAX - COL_MIN + 1
const HOLE: Cell = Object.freeze({ floor: null, block: false })

function fnv(h: number, v: number): number {
  return Math.imul(h ^ v, 0x01000193) >>> 0
}

// 시드 앞 16바이트 + salt를 FNV-1a로 섞어 sfc32 상태 4개를 만든다. 출력은 [0, 2^32) 정수.
export function u32Stream(seed: string, salt: string): () => number {
  const bytes: number[] = []
  for (let i = 0; i < 16; i++) {
    const v = parseInt(seed.slice(i * 2, i * 2 + 2), 16)
    bytes.push(Number.isNaN(v) ? seed.charCodeAt(i) & 255 : v)
  }
  const st: number[] = []
  for (let k = 0; k < 4; k++) {
    let h = (0x811c9dc5 ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0
    for (const b of bytes) h = fnv(h, b)
    h = fnv(h, 0xff)
    for (let i = 0; i < salt.length; i++) h = fnv(h, salt.charCodeAt(i) & 255)
    h ^= h >>> 15
    h = Math.imul(h, 0x2c1b3c6d) >>> 0
    h ^= h >>> 12
    st.push(h >>> 0)
  }
  let [a, b, c, d] = st
  const next = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return t >>> 0
  }
  for (let i = 0; i < 12; i++) next()
  return next
}

export function decorRandom(seed: string): () => number {
  return u32Stream(seed, 'decor')
}

// tunnels: 이 조각까지(포함) 놓인 터널 조각 수.
type Placed = SegmentInfo & { grid: Cell[][]; tunnels: number }

function place(seg: ParsedSegment, mirrored: boolean, startRow: number, base: number, tunnelsBefore: number): Placed {
  const grid: Cell[][] = []
  for (const row of seg.cells) {
    const out: Cell[] = new Array(COLS)
    for (let i = 0; i < COLS; i++) {
      const src = row[mirrored ? COLS - 1 - i : i]
      out[i] =
        src.floor === null
          ? HOLE
          : {
              floor: { h0: src.floor.h0 + base, h1: src.floor.h1 + base },
              block: src.block,
              ...(src.blockH !== undefined ? { blockH: src.blockH } : {}),
              ...(src.bank !== undefined ? { bank: (mirrored ? -src.bank : src.bank) as -1 | 1 } : {}),
            }
    }
    grid.push(out)
  }
  const tunnels = tunnelsBefore + (seg.kind === 'tunnel' ? 1 : 0)
  return { id: seg.id, tier: seg.tier, startRow, length: seg.length, mirrored, base, kind: seg.kind, grid, tunnels }
}

function buildCourse(seed: string, pick: (placed: Placed[], startRow: number) => { seg: ParsedSegment; mirrored: boolean }): Course {
  const placed: Placed[] = []
  const first = pick(placed, 0)
  placed.push(place(first.seg, first.mirrored, 0, 0, 0))
  let endRow = first.seg.length
  let endBase = first.seg.dh

  const ensure = (row: number): void => {
    while (endRow <= row) {
      const p = pick(placed, endRow)
      placed.push(place(p.seg, p.mirrored, endRow, endBase, placed[placed.length - 1].tunnels))
      endRow += p.seg.length
      endBase += p.seg.dh
    }
  }
  const find = (row: number): Placed => {
    let lo = 0
    let hi = placed.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (placed[mid].startRow <= row) lo = mid
      else hi = mid - 1
    }
    return placed[lo]
  }
  const info = (p: Placed): SegmentInfo => ({
    id: p.id, tier: p.tier, startRow: p.startRow, length: p.length, mirrored: p.mirrored, base: p.base,
    kind: p.kind,
  })

  return {
    seed,
    cell(col, row) {
      if (col < COL_MIN || col > COL_MAX || row < 0) return HOLE
      ensure(row)
      const p = find(row)
      return p.grid[row - p.startRow][col - COL_MIN]
    },
    segmentAt(row) {
      ensure(Math.max(row, 0))
      return info(find(Math.max(row, 0)))
    },
    segmentsBetween(fromRow, toRow) {
      const from = Math.max(fromRow, 0)
      ensure(Math.max(toRow, from))
      const out: SegmentInfo[] = []
      for (let i = placed.indexOf(find(from)); i < placed.length && placed[i].startRow <= toRow; i++) out.push(info(placed[i]))
      return out
    },
    boostsBefore(row) {
      const r = Math.max(row, 0)
      ensure(r)
      return find(r).tunnels
    },
  }
}

function stageWeights(stage: number): readonly [number, number, number, number] {
  let w = TIER_WEIGHTS[0].w
  for (const b of TIER_WEIGHTS) if (b.fromStage <= stage) w = b.w
  return w
}

/**
 * 캐시 없이 새 코스 인스턴스를 만든다 (테스트·getCourse용).
 * 순서: 시작 터널 → 내리막 → 장애물 × obstaclesInStage(단계) → 터널 → 내리막 → … (설계 v2 §3.3)
 * 단계 = 지금까지 놓인 터널 수(시작 터널 포함).
 */
export function makeCourse(seed: string): Course {
  const next = u32Stream(seed, 'course')
  return buildCourse(seed, (placed) => {
    if (placed.length === 0) return { seg: START_PARSED, mirrored: false }
    // 매번 난수 3개를 고정 순서로 뽑아 흐름이 조각 종류·후보 수에 흔들리지 않게 한다.
    const rTier = next()
    const rPick = next()
    const rMirror = next()
    const mirrored = (rMirror & 1) === 1
    const prev = placed[placed.length - 1]
    const stage = prev.tunnels
    if (prev.kind === 'tunnel') return { seg: PARSED_DESCENTS[rPick % PARSED_DESCENTS.length], mirrored }
    let obstacles = 0
    for (let i = placed.length - 1; placed[i].kind === 'obstacle'; i--) obstacles++
    if (obstacles >= obstaclesInStage(stage)) return { seg: PARSED_TUNNELS[rPick % PARSED_TUNNELS.length], mirrored }

    // 장애물: 단계 가중치로 tier를 고르고, 최근 장애물 3개는 피한다.
    const w = stageWeights(stage)
    const total = w[0] + w[1] + w[2] + w[3]
    const r = rTier % total
    let tier = 0
    for (let acc = w[0]; tier < 3 && r >= acc; ) acc += w[++tier]
    tier += 1
    const recent = new Set<string>()
    for (let i = placed.length - 1; i >= 0 && recent.size < 3; i--) if (placed[i].kind === 'obstacle') recent.add(placed[i].id)
    let cands = PARSED_OBSTACLES.filter((p) => p.tier === tier && !recent.has(p.id))
    if (cands.length === 0) cands = PARSED_OBSTACLES.filter((p) => w[p.tier - 1] > 0 && !recent.has(p.id))
    return { seg: cands[rPick % cands.length], mirrored }
  })
}

const FLAT: ParsedSegment = parseSegment({
  id: 'flat',
  kind: 'obstacle',
  tier: 1,
  rows: [JOINT, ...new Array<string>(62).fill('_______'), JOINT],
})

export function courseFromSegments(list: { seg: ParsedSegment; mirrored: boolean }[]): Course {
  let i = 0
  return buildCourse('', () => (i < list.length ? list[i++] : { seg: FLAT, mirrored: false }))
}

const cache = new Map<string, Course>()
export function getCourse(seed: string): Course {
  if (!/^[0-9a-f]{32}$/.test(seed)) throw new Error('invalid seed')
  const hit = cache.get(seed)
  if (hit) {
    cache.delete(seed)
    cache.set(seed, hit)
    return hit
  }
  const c = makeCourse(seed)
  cache.set(seed, c)
  if (cache.size > 4) cache.delete(cache.keys().next().value as string)
  return c
}

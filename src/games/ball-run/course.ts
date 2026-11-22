// 시드 기반 코스 생성기. 순수 정수 연산, 외부 의존 없음.
import { COL_MAX, COL_MIN, GIMMICK_WEIGHT, MOVER_PERIOD, MOVER_ROW_OFFSET, SPEED_TABLE, TIER_WEIGHTS, obstaclesInStage } from './constants.ts'
import type { Mover } from './mover.ts'
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
  /** row 행의 좌우 왕복 블록(위치는 mover.ts moverX). 없으면 null. */
  moverAt(row: number): Mover | null
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

// tunnels: 이 조각까지(포함) 놓인 터널 조각 수. movers: 조각 안 행마다 왕복 블록.
type Placed = SegmentInfo & { grid: Cell[][]; tunnels: number; movers: (Mover | null)[] }
type Pick = { seg: ParsedSegment; mirrored: boolean; phase?: number }

function place(p: Pick, startRow: number, base: number, tunnelsBefore: number): Placed {
  const { seg, mirrored } = p
  const phase = p.phase ?? 0
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
              ...(src.pad ? { pad: true as const } : {}),
            }
    }
    grid.push(out)
  }
  // 반전하면 x 범위 부호를 뒤집는다(moverX가 정확한 거울상을 낸다). 위상은 그대로.
  const movers = seg.movers.map((m, r): Mover | null =>
    m === null
      ? null
      : {
          x0: mirrored ? 0 - m.x0 : m.x0,
          x1: mirrored ? 0 - m.x1 : m.x1,
          h: seg.cells[r][m.x0 / 1000 - COL_MIN].floor!.h0 + base,
          phase: (phase + r * MOVER_ROW_OFFSET) % MOVER_PERIOD,
        },
  )
  const tunnels = tunnelsBefore + (seg.kind === 'tunnel' ? 1 : 0)
  return { id: seg.id, tier: seg.tier, startRow, length: seg.length, mirrored, base, kind: seg.kind, grid, tunnels, movers }
}

function buildCourse(seed: string, pick: (placed: Placed[], startRow: number) => Pick): Course {
  const placed: Placed[] = []
  const first = pick(placed, 0)
  placed.push(place(first, 0, 0, 0))
  let endRow = first.seg.length
  let endBase = first.seg.dh

  const ensure = (row: number): void => {
    while (endRow <= row) {
      const p = pick(placed, endRow)
      placed.push(place(p, endRow, endBase, placed[placed.length - 1].tunnels))
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
    moverAt(row) {
      if (row < 0) return null
      ensure(row)
      const p = find(row)
      return p.movers[row - p.startRow]
    },
  }
}

// v5: 코스의 첫 장애물(단계 1)은 늘 이 조각 — 모든 판이 처음 10초 안에 움직이는 블록을 만난다. v6: 속도 묶음 a(단계 1~3)의 것.
export const FIRST_OBSTACLE = 'm1-shuttle-a'
const FIRST_PARSED = PARSED_OBSTACLES.find((p) => p.id === FIRST_OBSTACLE)!
const isGimmick = (p: ParsedSegment): boolean => p.movers.some((m) => m !== null) || p.cells.some((row) => row.some((c) => c.pad === true))
const GIMMICK = new Set(PARSED_OBSTACLES.filter(isGimmick).map((p) => p.id))

// v6: 속도 단계 level에서 쓸 수 있는 조각(SegmentTemplate.minLevel..maxLevel). 단계가 표 끝을 넘으면 끝 단계로 본다.
const LAST_LEVEL = SPEED_TABLE.length - 1
export function inBand(p: ParsedSegment, stage: number): boolean {
  const level = Math.min(stage, LAST_LEVEL)
  return p.minLevel <= level && level <= p.maxLevel
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
 * v6: 조각은 그 조각을 지나는 속도 단계의 묶음에서만 뽑는다(터널은 지나는 동안 단계 + 1, 내리막·장애물은 지금 단계).
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
    // 왕복 블록 위상: 반전 동전과 같은 셋째 난수의 위 비트(난수 개수는 그대로 3개).
    const phase = (rMirror >>> 1) % MOVER_PERIOD
    const prev = placed[placed.length - 1]
    const stage = prev.tunnels
    if (prev.kind === 'tunnel') {
      const ds = PARSED_DESCENTS.filter((p) => inBand(p, stage))
      return { seg: ds[rPick % ds.length], mirrored, phase }
    }
    let obstacles = 0
    for (let i = placed.length - 1; placed[i].kind === 'obstacle'; i--) obstacles++
    if (obstacles >= obstaclesInStage(stage)) {
      const ts = PARSED_TUNNELS.filter((p) => inBand(p, stage + 1))
      return { seg: ts[rPick % ts.length], mirrored, phase }
    }

    // 첫 장애물은 늘 tier 1 왕복 블록(난수 3개는 그대로 뽑았고, 반전·위상도 그대로 쓴다).
    if (!placed.some((p) => p.kind === 'obstacle')) return { seg: FIRST_PARSED, mirrored, phase }

    // 장애물: 단계 가중치로 tier를 고르고, 최근 장애물 3개는 피한다.
    const w = stageWeights(stage)
    const total = w[0] + w[1] + w[2] + w[3]
    const r = rTier % total
    let tier = 0
    for (let acc = w[0]; tier < 3 && r >= acc; ) acc += w[++tier]
    tier += 1
    const recent = new Set<string>()
    for (let i = placed.length - 1; i >= 0 && recent.size < 3; i--) if (placed[i].kind === 'obstacle') recent.add(placed[i].id)
    const pool = PARSED_OBSTACLES.filter((p) => inBand(p, stage) && !recent.has(p.id))
    let cands = pool.filter((p) => p.tier === tier)
    if (cands.length === 0) cands = pool.filter((p) => w[p.tier - 1] > 0)
    // 기믹 조각은 GIMMICK_WEIGHT번 센다.
    let wsum = 0
    for (const p of cands) wsum += GIMMICK.has(p.id) ? GIMMICK_WEIGHT : 1
    let rp = rPick % wsum
    let k = 0
    for (;;) {
      const wk = GIMMICK.has(cands[k].id) ? GIMMICK_WEIGHT : 1
      if (rp < wk) break
      rp -= wk
      k++
    }
    return { seg: cands[k], mirrored, phase }
  })
}

const FLAT: ParsedSegment = parseSegment({
  id: 'flat',
  kind: 'obstacle',
  tier: 1,
  rows: [JOINT, ...new Array<string>(62).fill('_______'), JOINT],
})

// phase: 왕복 블록 조각 위상(기본 0). 밸런스 테스트가 위상을 돌려 본다.
export function courseFromSegments(list: Pick[]): Course {
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

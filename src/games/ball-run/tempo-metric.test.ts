import { describe, expect, it } from 'vitest'
import { ROW, SPEED_TABLE, TICK_HZ } from './constants.ts'
import { courseFromSegments } from './course.ts'
import { JOINT, parseSegment } from './segments.ts'
import { scanCourse, tempoStats } from './tempo-metric.ts'

const rep = (row: string, n: number): string[] => new Array<string>(n).fill(row)
const seg = (kind: 'tunnel' | 'obstacle', rows: string[]) => parseSegment({ id: kind === 'tunnel' ? 't' : 'o', kind, tier: 1, rows })

describe('tempo metric (test helper)', () => {
  const T = seg('tunnel', [JOINT, ...rep(JOINT, 8), JOINT]) // rows 0..9
  const O = seg('obstacle', [
    JOINT, // 10 plain
    '..___..', // 11 plain
    '..B__..', // 12 event, forcing (column -1 blocked)
    '..___..', // 13 plain
    '..\\\\\\..', // 14 event (slope), not forcing
    '..__...', // 15 event, forcing (column 1 lost)
    '..__...', // 16 plain
    '..>>...', // 17 event, forcing (bank starts)
    '..>>...', // 18 event, not forcing
    '..JJ...', // 19 event (pad), not forcing
    '.......', // 20 event (flight), not forcing
    '..__...', // 21 event (floor set changed), not forcing (landing)
    '..MMM..', // 22 event, forcing (shuttle)
    JOINT, // 23 plain
  ])
  const c = courseFromSegments([{ seg: T, mirrored: false }, { seg: O, mirrored: false }])

  it('classifies plain, event and forcing rows', () => {
    const rows = scanCourse(c, 1.2).slice(10, 24)
    expect(rows.map((r) => (r.plain ? 'p' : 'e')).join('')).toBe('ppepeepeeeeeep')
    expect(rows.map((r) => (r.forcing ? 'f' : '.')).join('')).toBe('..f..f.f....f.')
    expect(rows.every((r) => !r.tunnel)).toBe(true)
    expect(scanCourse(c, 1).slice(0, 10).every((r) => r.tunnel && r.plain && !r.forcing)).toBe(true)
  })

  it('time per row follows the stage speed', () => {
    const rows = scanCourse(c, 1)
    expect(rows[0].stage).toBe(1)
    expect(rows[0].dt).toBeCloseTo(ROW / (SPEED_TABLE[1] * TICK_HZ))
    expect(rows.reduce((a, r) => a + r.dt, 0)).toBeGreaterThanOrEqual(1)
  })

  it('aggregates fractions, forcing spacing and longest plain stretch outside tunnels', () => {
    // 1.2초 = 26행(0..25). 24행은 7칸 평지로 넓어져 사건 행, 25행은 평범한 행.
    const { all, bands } = tempoStats([{ seed: 'x', course: c }], 1.2)
    const dt = ROW / (SPEED_TABLE[1] * TICK_HZ)
    expect(all.time).toBeCloseTo(26 * dt)
    expect(all.forcing).toBe(4)
    expect(bands['1-3'].forcing).toBe(4)
    expect(bands['4-8'].time).toBe(0)
    expect(all.meanBetweenForcing).toBeCloseTo((26 * dt) / 4)
    expect(all.longestTunnel).toBeCloseTo(10 * dt)
    expect(all.longestPlain).toBeCloseTo(2 * dt) // 10..11행
    expect(all.plainTime).toBeCloseTo((10 + 2 + 1 + 1 + 1 + 1) * dt)
  })
})

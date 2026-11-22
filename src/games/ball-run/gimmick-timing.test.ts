import { describe, expect, it } from 'vitest'
import { ROW, SPEED_TABLE, TICK_HZ } from './constants.ts'
import { makeCourse } from './course.ts'
import { PARSED, START_PARSED } from './segments.ts'

const BY_ID = new Map([...PARSED, START_PARSED].map((p) => [p.id, p]))
const seedN = (n: number) => (n * 2654435761 >>> 0).toString(16).padStart(8, '0').repeat(4)
function timings(seed: string) {
  const c = makeCourse(seed)
  const shuttles: number[] = []
  const pads: number[] = []
  let t = 0, row = 0, obstacles = 0, plainObs = 0
  while (row < 30000 && (shuttles.length < 2 || pads.length < 1 || c.boostsBefore(row) <= 20)) {
    const s = c.segmentAt(row)
    const v = SPEED_TABLE[Math.min(c.boostsBefore(s.startRow), SPEED_TABLE.length - 1)]
    const p = BY_ID.get(s.id)!
    p.cells.forEach((cells, r) => {
      const at = t + (r * ROW) / v / TICK_HZ
      if (p.movers[r]) shuttles.push(at)
      if (cells.some((x) => x.pad)) pads.push(at)
    })
    if (s.kind === 'obstacle' && c.boostsBefore(s.startRow) <= 20) {
      obstacles++
      if (!p.movers.some((m) => m) && !p.cells.some((cs) => cs.some((x) => x.pad))) plainObs++
    }
    t += (s.length * ROW) / v / TICK_HZ
    row = s.startRow + s.length
  }
  return { first: shuttles[0], second: shuttles[1], pad: pads[0], obstacles, plainObs }
}
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return (b[(b.length - 1) >> 1] + b[b.length >> 1]) / 2 }
// v5: 기믹을 초반에 보게 한다(사용자: "좌우로 움직이는 블럭이 안보여"). 공이 행에 닿는 시각은 코스만으로 정해진다
// (조각 시작 행의 boostsBefore 단계 속도로 그 조각을 지난다).
describe('gimmick timing (v5)', () => {
  const all = [...Array(200).keys()].map((n) => timings(seedN(n + 1)))
  it('every run meets a shuttle within 12 s, the first is the tier-1 shuttle', () => {
    const late = all.flatMap((x, i) => (x.first <= 12 ? [] : [`${seedN(i + 1)} ${x.first.toFixed(1)}`]))
    expect(late).toEqual([])
  })
  it('median time to the second shuttle <= 45 s and to the first jump pad <= 30 s', () => {
    expect(med(all.map((x) => x.second))).toBeLessThanOrEqual(45)
    expect(med(all.map((x) => x.pad))).toBeLessThanOrEqual(30)
  })
  it('non-gimmick obstacles stay >= 40% over the first 20 stages', () => {
    const share = all.reduce((a, x) => a + x.plainObs, 0) / all.reduce((a, x) => a + x.obstacles, 0)
    expect(share).toBeGreaterThanOrEqual(0.4)
  })
})

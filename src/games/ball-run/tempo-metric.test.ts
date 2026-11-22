import { describe, expect, it } from 'vitest'
import { ROW, SPEED_TABLE, TICK_HZ } from './constants.ts'
import { courseFromSegments } from './course.ts'
import { JOINT, parseSegment } from './segments.ts'
import { scanCourse, tempoStats } from './tempo-metric.ts'

const rep = (row: string, n: number): string[] => new Array<string>(n).fill(row)
const N3 = '..___..'

describe('tempo metric (test helper)', () => {
  const T = parseSegment({ id: 'tm-t', kind: 'tunnel', tier: 1, rows: [JOINT, ...rep(JOINT, 8), JOINT] }) // rows 0..9
  const O = parseSegment({
    id: 'tm-o', kind: 'obstacle', tier: 1,
    rows: [
      JOINT, // 10
      ...rep(N3, 30), // 11..40
      '.._B_..', // 41: 가운데 블록 — 강제 행, 그 앞 1초(단계 1에서 약 21행) 안은 손 놓으면 부딪히는 조향 행
      ...rep(N3, 5), // 42..46
      '..\\\\\\..', '..\\\\\\..', // 47..48: 열이 그대로인 경사 — 평범한 행
      '..vvv..', // 49: 단차 — 평범한 행
      '..__...', // 50: 착지 길이 좁아짐 — 사건, 강제 행
      '..>>...', // 51: 기운 판 시작 — 강제 행
      JOINT, // 52
    ],
  })
  const segs = new Map([T, O].map((p) => [p.id, p]))
  const c = courseFromSegments([{ seg: T, mirrored: false }, { seg: O, mirrored: false }])
  const rows = scanCourse(c, 2.6, segs)
  const at = (r: number) => rows[r]

  it('plain ignores height: slopes and ledges with unchanged columns are plain', () => {
    expect(rows.length).toBeGreaterThan(53)
    for (const r of [11, 30, 42, 47, 48, 49]) expect(at(r).plain, `row ${r}`).toBe(true)
    for (const r of [41, 50, 51]) expect(at(r).plain, `row ${r}`).toBe(false)
    expect(at(47).slope && at(48).slope).toBe(true)
  })

  it('forcing rows are structural; steering rows come from the hands-off sim', () => {
    expect(rows.filter((x) => x.forcing).map((x) => x.row)).toEqual([41, 50, 51])
    // 블록 1초 앞은 조향, 훨씬 앞은 쉬는 행.
    for (const r of [30, 35, 40]) expect(at(r).steering && !at(r).idle, `row ${r}`).toBe(true)
    for (const r of [11, 12, 15]) expect(at(r).idle, `row ${r}`).toBe(true)
    expect(at(41).idle).toBe(false)
    for (const r of [1, 5]) expect(at(r).tunnel && at(r).idle).toBe(true)
  })

  it('aggregates idle fraction, forcing spacing and longest idle stretch outside tunnels', () => {
    const dt = ROW / (SPEED_TABLE[1] * TICK_HZ)
    expect(at(0).dt).toBeCloseTo(dt)
    const { all, bands } = tempoStats([{ seed: 'x', course: c }], 2.6, segs)
    const idle = rows.filter((x) => x.idle).length
    expect(all.time).toBeCloseTo(rows.length * dt)
    expect(all.idleFrac).toBeCloseTo(idle / rows.length)
    expect(all.forcing).toBe(3)
    expect(bands['1-3'].forcing).toBe(3)
    expect(bands['4-8'].time).toBe(0)
    expect(all.meanBetweenForcing).toBeCloseTo((rows.length * dt) / 3)
    expect(all.longestTunnel).toBeCloseTo(10 * dt)
    let run = 0
    let best = 0
    for (const x of rows) {
      run = x.idle && !x.tunnel ? run + 1 : 0
      best = Math.max(best, run)
    }
    expect(all.longestIdle).toBeCloseTo(best * dt)
    expect(best).toBeGreaterThanOrEqual(5)
  })
})

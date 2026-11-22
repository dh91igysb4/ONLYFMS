// 템포 게이트. v6(사용자: "게임 템포가 너무 느려. 가만히 있어도 되는 부분이 너무 많아") 뒤 v7(사용자: "지금이랑 아까의 중간 정도로")
// — v5(쉬는 시간 89.7%, 강제 행 1.57초)와 v6(30.0%, 0.64초)의 가운데. 너무 촘촘해도, 너무 성겨도 실패한다. 지표는 tempo-metric.ts.
// 쉬는 행 = 강제 행도 조향 행(손 놓은 공이 1초 안에 실패)도 아닌 행. 경사·단차도 열이 그대로면 손댈 일이 없는 행이다.
import { describe, expect, it } from 'vitest'
import { makeCourse } from './course.ts'
import { STAGE_BANDS, tempoStats } from './tempo-metric.ts'

const seedN = (n: number) => ((n * 2654435761) >>> 0).toString(16).padStart(8, '0').repeat(4)
const SEEDS = 120
const SECONDS = 90

describe('tempo (v7: between v5 and v6)', () => {
  const { all, bands } = tempoStats([...Array(SEEDS).keys()].map((n) => ({ seed: seedN(n + 1), course: makeCourse(seedN(n + 1)) })), SECONDS)
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`

  it('idle-time fraction 55-65% overall and 50-70% in every stage band', () => {
    expect(all.idleFrac, pct(all.idleFrac)).toBeGreaterThanOrEqual(0.55)
    expect(all.idleFrac, pct(all.idleFrac)).toBeLessThanOrEqual(0.65)
    for (const b of STAGE_BANDS) {
      expect(bands[b.name].idleFrac, `${b.name} ${pct(bands[b.name].idleFrac)}`).toBeGreaterThanOrEqual(0.5)
      expect(bands[b.name].idleFrac, `${b.name} ${pct(bands[b.name].idleFrac)}`).toBeLessThanOrEqual(0.7)
    }
  })

  it('a forcing row every 1.0-1.2 s on average in every stage band', () => {
    for (const b of STAGE_BANDS) {
      expect(bands[b.name].time, b.name).toBeGreaterThan(0)
      expect(bands[b.name].meanBetweenForcing, b.name).toBeGreaterThanOrEqual(1.0)
      expect(bands[b.name].meanBetweenForcing, b.name).toBeLessThanOrEqual(1.2)
    }
  })

  it('no idle stretch outside tunnels longer than 2.5 s; tunnels (but the start) 0.8 s or less', () => {
    expect(all.longestIdle, all.longestIdleAt).toBeLessThanOrEqual(2.5)
    expect(all.longestTunnel).toBeLessThanOrEqual(0.8)
  })

  it('obstacle segments stay (nearly) level: no slope filler, little drop outside descents', () => {
    expect(all.slopeFracOutsideDescents, pct(all.slopeFracOutsideDescents)).toBeLessThanOrEqual(0.02)
    expect(all.dropPerMinOutsideDescents).toBeLessThanOrEqual(10)
  })
})

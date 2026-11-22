// v6 템포 게이트(사용자: "게임 템포가 너무 느려. 가만히 있어도 되는 부분이 너무 많아"). 지표는 tempo-metric.ts, 코스만으로 잰다.
import { describe, expect, it } from 'vitest'
import { makeCourse } from './course.ts'
import { STAGE_BANDS, tempoStats } from './tempo-metric.ts'

const seedN = (n: number) => ((n * 2654435761) >>> 0).toString(16).padStart(8, '0').repeat(4)
const SEEDS = 120
const SECONDS = 90

describe('tempo (v6)', () => {
  const { all, bands } = tempoStats([...Array(SEEDS).keys()].map((n) => ({ seed: seedN(n + 1), course: makeCourse(seedN(n + 1)) })), SECONDS)
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`

  it('plain-time fraction <= 40% overall and <= 45% in every stage band', () => {
    expect(all.plainFrac, pct(all.plainFrac)).toBeLessThanOrEqual(0.4)
    for (const b of STAGE_BANDS) expect(bands[b.name].plainFrac, `${b.name} ${pct(bands[b.name].plainFrac)}`).toBeLessThanOrEqual(0.45)
  })

  it('a forcing row every 1.0 s or less on average in every stage band', () => {
    for (const b of STAGE_BANDS) {
      expect(bands[b.name].time, b.name).toBeGreaterThan(0)
      expect(bands[b.name].meanBetweenForcing, b.name).toBeLessThanOrEqual(1.0)
    }
  })

  it('no plain stretch outside tunnels longer than 1.2 s; tunnels (but the start) 0.8 s or less', () => {
    expect(all.longestPlain, all.longestPlainAt).toBeLessThanOrEqual(1.2)
    expect(all.longestTunnel).toBeLessThanOrEqual(0.8)
  })
})

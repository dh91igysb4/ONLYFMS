import { describe, expect, it } from 'vitest'
import { rngFromSeed } from '../../shared/rng.ts'
import { RODS, SPECIES, type Behavior } from './data.ts'
import { MAX_DT_MS, barParams, barResult, gaugeAt, initBar, stepBar, type Bar } from './minigame.ts'

function seeded(n: number): () => number {
  const seed = new Uint8Array(16)
  for (let i = 0; i < 16; i++) seed[i] = (n * 31 + i * 17) & 255
  return rngFromSeed(seed)
}

describe('gaugeAt', () => {
  it('is a triangle wave with a 1600ms period', () => {
    expect(gaugeAt(0)).toBe(0)
    expect(gaugeAt(800)).toBe(1)
    expect(gaugeAt(1600)).toBe(0)
    expect(gaugeAt(400)).toBeCloseTo(0.5)
    expect(gaugeAt(1200)).toBeCloseTo(0.5)
    expect(gaugeAt(2400)).toBe(1)
  })
})

describe('barParams', () => {
  it('bar grows with rod tier', () => {
    const t1 = barParams('anchovy', 1).barSize
    const t4 = barParams('anchovy', 4).barSize
    expect(t1).toBeCloseTo(0.22 * (1 + RODS[0].barBonus))
    expect(t4).toBeCloseTo(t1 * 1.45)
  })
  it('difficulty comes from species', () => {
    expect(barParams('anchovy', 1).difficulty).toBe(SPECIES.find((s) => s.id === 'anchovy')!.difficulty)
    expect(barParams('grouper', 1).difficulty).toBe(0.95)
  })
})

describe('barParams behavior', () => {
  it('barParams는 어종의 behavior를 담는다 (pufferfish → floater, octopus → sinker)', () => {
    expect(barParams('pufferfish', 1).behavior).toBe('floater')
    expect(barParams('octopus', 1).behavior).toBe('sinker')
    expect(barParams('goby', 1).behavior).toBe('mixed')
  })
})

describe('initBar', () => {
  it('starts at progress 0.3, perfect, centered', () => {
    expect(initBar()).toEqual({ barPos: 0.5, barVel: 0, fishPos: 0.5, fishTarget: 0.5, progress: 0.3, perfect: true, t: 0 })
  })
})

describe('stepBar', () => {
  const params = { ...barParams('anchovy', 1), behavior: 'mixed' as const } // 기존 동작(mixed)을 고정

  it('holding moves bar up, releasing moves it down', () => {
    const up = stepBar(initBar(), true, 16, params, seeded(1))
    const down = stepBar(initBar(), false, 16, params, seeded(1))
    expect(up.barPos).toBeGreaterThan(0.5)
    expect(down.barPos).toBeLessThan(0.5)
  })

  it('clamps the bar to [barSize/2, 1 - barSize/2] and zeroes velocity at the ends', () => {
    const rng = seeded(2)
    let bar = initBar()
    for (let i = 0; i < 300; i++) bar = stepBar(bar, true, 16, params, rng)
    expect(bar.barPos).toBeCloseTo(1 - params.barSize / 2)
    expect(bar.barVel).toBe(0)
    for (let i = 0; i < 600; i++) bar = stepBar(bar, false, 16, params, rng)
    expect(bar.barPos).toBeCloseTo(params.barSize / 2)
    expect(bar.barVel).toBe(0)
  })

  it('fish inside bar raises progress; outside lowers it and clears perfect', () => {
    const inside: Bar = { ...initBar(), barPos: 0.5, fishPos: 0.5, fishTarget: 0.5 }
    const a = stepBar(inside, false, 16, params, () => 0.5)
    expect(a.progress).toBeGreaterThan(0.3)
    expect(a.perfect).toBe(true)
    const outside: Bar = { ...initBar(), barPos: 0.2, fishPos: 0.9, fishTarget: 0.9 }
    const b = stepBar(outside, false, 16, params, () => 0.9)
    expect(b.progress).toBeLessThan(0.3)
    expect(b.perfect).toBe(false)
  })

  it('does not mutate its input and accumulates clamped time', () => {
    const bar = initBar()
    const copy = { ...bar }
    const next = stepBar(bar, true, 5000, params, seeded(3))
    expect(bar).toEqual(copy)
    expect(next.t).toBe(MAX_DT_MS)
  })

  it('huge dt is clamped', () => {
    const bar = initBar()
    expect(stepBar(bar, false, 5000, params, seeded(4))).toEqual(stepBar(bar, false, 50, params, seeded(4)))
  })

  it('keeps progress within [0, 1]', () => {
    let bar = initBar()
    for (let i = 0; i < 1000; i++) bar = stepBar(bar, false, 16, params, seeded(5))
    expect(bar.progress).toBeGreaterThanOrEqual(0)
    expect(bar.progress).toBeLessThanOrEqual(1)
  })
})

function run(speciesId: string, tier: 1 | 2 | 3 | 4, strategy: (b: Bar) => boolean, seedN: number, ms: number) {
  const params = { ...barParams(speciesId, tier), behavior: 'mixed' as const } // 기존 동작(mixed)을 고정
  const rng = seeded(seedN)
  let bar = initBar()
  let elapsed = 0
  while (elapsed < ms && barResult(bar) === 'playing') {
    bar = stepBar(bar, strategy(bar), 16, params, rng)
    elapsed += 16
  }
  return { bar, elapsed }
}

describe('simulation', () => {
  const track = (b: Bar) => b.fishPos > b.barPos

  it('easy fish with perfect tracking is caught within 6s', () => {
    for (const id of ['anchovy', 'goby', 'mackerel']) {
      for (let s = 1; s <= 10; s++) {
        const { bar, elapsed } = run(id, 1, track, s, 6000)
        expect(barResult(bar), `${id} seed ${s}`).toBe('caught')
        expect(elapsed).toBeLessThanOrEqual(6000)
      }
    }
  })

  it('easy fish is lost within 6s when never held', () => {
    // 바가 바닥에 붙어 있으니 물고기가 우연히 바닥에 오래 머무는 시드는 예외다. 대부분은 6초 안에 놓친다.
    let lost = 0
    for (let s = 1; s <= 10; s++) {
      const { bar, elapsed } = run('anchovy', 1, () => false, s, 6000)
      expect(barResult(bar), `seed ${s}`).not.toBe('caught')
      if (barResult(bar) === 'lost') {
        lost++
        expect(elapsed).toBeLessThanOrEqual(6000)
      }
    }
    expect(lost).toBeGreaterThanOrEqual(8)
  })

  it('hardest fish is catchable but not trivial with rod 3 tracking', () => {
    let caught = 0
    for (let s = 1; s <= 20; s++) if (barResult(run('grouper', 3, track, s, 30000).bar) === 'caught') caught++
    expect(caught).toBeGreaterThan(0)
  })

  it('hard fish (grouper, rod 3) moves faster than anchovy', () => {
    const dist = (id: string) => {
      const params = { ...barParams(id, 3), behavior: 'mixed' as const }
      const rng = seeded(7)
      let bar = initBar()
      let total = 0
      for (let i = 0; i < 312; i++) {
        const next = stepBar({ ...bar, progress: 0.5 }, false, 16, params, rng)
        total += Math.abs(next.fishPos - bar.fishPos)
        bar = next
      }
      return total
    }
    expect(dist('grouper')).toBeGreaterThan(dist('anchovy') * 1.5)
  })

  it('positions stay within [0, 1] over 60s of random input', () => {
    const params = { ...barParams('grouper', 1), behavior: 'mixed' as const }
    const rng = seeded(9)
    const input = seeded(10)
    let bar = initBar()
    for (let i = 0; i < 3750; i++) {
      bar = stepBar({ ...bar, progress: 0.5 }, input() < 0.5, 16, params, rng)
      for (const v of [bar.barPos, bar.fishPos, bar.fishTarget]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('behavior 시뮬레이션 (난이도 0.5, 60초, 바는 안 누름)', () => {
  function sim(behavior: Behavior, seedN = 11) {
    const params = { barSize: 0.22, difficulty: 0.5, behavior }
    const rng = seeded(seedN)
    let bar = initBar()
    let sum = 0
    let move = 0
    const n = Math.floor(60000 / 16)
    for (let i = 0; i < n; i++) {
      const next = stepBar({ ...bar, progress: 0.5 }, false, 16, params, rng)
      move += Math.abs(next.fishPos - bar.fishPos)
      sum += next.fishPos
      bar = next
    }
    return { mean: sum / n, move }
  }

  it('floater는 위쪽, sinker는 아래쪽에 머문다', () => {
    expect(sim('floater').mean).toBeGreaterThan(0.6)
    expect(sim('sinker').mean).toBeLessThan(0.4)
  })

  it('mixed는 가운데 근처다', () => {
    const { mean } = sim('mixed')
    expect(mean).toBeGreaterThan(0.35)
    expect(mean).toBeLessThan(0.65)
  })

  it('이동량은 dart > mixed > smooth (여러 시드 평균)', () => {
    const avg = (b: Behavior) => [11, 12, 13, 14, 15].reduce((a, n) => a + sim(b, n).move, 0) / 5
    const dart = avg('dart')
    const mixed = avg('mixed')
    const smooth = avg('smooth')
    expect(dart).toBeGreaterThan(mixed)
    expect(mixed).toBeGreaterThan(smooth)
  })

  it('mixed는 변경 전 구현과 같은 궤적이다 (골든: seed 11, 60초)', () => {
    // 행동 유형 도입 전 minigame.ts(589b409)로 구한 값
    const { mean, move } = sim('mixed', 11)
    expect(mean).toBeCloseTo(1897.822500257715 / 3750, 9)
    expect(move).toBeCloseTo(35.29450431521198, 9)
  })

  it('모든 유형에서 위치가 [0, 1] 안에 머문다', () => {
    for (const behavior of ['mixed', 'smooth', 'dart', 'floater', 'sinker'] as const) {
      const params = { barSize: 0.22, difficulty: 1, behavior }
      const rng = seeded(21)
      let bar = initBar()
      for (let i = 0; i < 2000; i++) {
        bar = stepBar({ ...bar, progress: 0.5 }, i % 40 < 20, 16, params, rng)
        for (const v of [bar.barPos, bar.fishPos, bar.fishTarget]) {
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})

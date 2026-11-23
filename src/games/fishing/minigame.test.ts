import { describe, expect, it } from 'vitest'
import { rngFromSeed } from '../../shared/rng.ts'
import { BUFF_FX, RODS, SPECIES, TACKLE_FX, tackleSlots, type Behavior, type BuffId, type RodTier, type TackleId } from './data.ts'
import { MAX_DT_MS, barParams, barResult, effectiveBarSize, gaugeAt, initBar, stepBar, surgePhase, type Bar, type BarParams } from './minigame.ts'
import { M1_FIXTURE, withTempData } from './testFixtures.ts'

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

describe('barParams 찌', () => {
  it('equipped 없음 → drain 1·pull 0·barSize 지금 값', () => {
    const base = barParams('anchovy', 2)
    expect(base.drain).toBe(1)
    expect(base.pull).toBe(0)
    expect(barParams('anchovy', 2, []).barSize).toBe(base.barSize)
    expect(base.barSize).toBeCloseTo(0.22 * (1 + RODS[1].barBonus))
  })
  it('cork → barSize ×1.2, trap → drain TACKLE_FX.trapDrain, barbed → pull > 0', () => {
    const base = barParams('anchovy', 2)
    const cork = barParams('anchovy', 2, ['cork'])
    expect(cork.barSize).toBeCloseTo(base.barSize * TACKLE_FX.corkBar)
    expect(cork.drain).toBe(1)
    expect(cork.pull).toBe(0)
    const trap = barParams('anchovy', 2, ['trap'])
    expect(trap.drain).toBe(TACKLE_FX.trapDrain)
    expect(trap.barSize).toBe(base.barSize)
    const barbed = barParams('anchovy', 2, ['barbed'])
    expect(barbed.pull).toBeGreaterThan(0)
    expect(barbed.drain).toBe(1)
  })
  it('세 개 조합은 각각 반영', () => {
    const p = barParams('anchovy', 2, ['cork', 'trap', 'barbed'])
    expect(p.barSize).toBeCloseTo(barParams('anchovy', 2).barSize * 1.2)
    expect(p.drain).toBe(TACKLE_FX.trapDrain)
    expect(p.pull).toBeGreaterThan(0)
  })
})

describe('찌 효과 stepBar', () => {
  const calm = () => 0.99 // 목표 변경 없음
  it('trap: 바 밖 1초 진행도 감소량이 trapDrain 배', () => {
    const base = { ...barParams('anchovy', 1), behavior: 'mixed' as const }
    const trap = { ...base, drain: TACKLE_FX.trapDrain }
    const start = { ...initBar(), barPos: 0.8, fishPos: 0.1, fishTarget: 0.1, progress: 0.8 }
    const run = (params: typeof base) => {
      let bar = start
      for (let i = 0; i < 50; i++) bar = stepBar(bar, true, 20, params, calm)
      return 0.8 - bar.progress
    }
    expect(run(trap)).toBeCloseTo(run(base) * TACKLE_FX.trapDrain, 9)
    expect(run(base)).toBeGreaterThan(0)
  })
  it('barbed: 누르는 동안 바 안 위쪽 끝 근처 물고기가 있으면 바가 그쪽으로 더 끌린다, 바 밖이면 효과 없음', () => {
    const base = { ...barParams('anchovy', 1), behavior: 'mixed' as const }
    const barbed = barParams('anchovy', 1, ['barbed'])
    const top = base.barSize / 2 - 0.01
    const inside = { ...initBar(), barPos: 0.5, fishPos: 0.5 + top, fishTarget: 0.5 + top }
    const a = stepBar(inside, true, 20, base, calm)
    const b = stepBar(inside, true, 20, { ...base, pull: barbed.pull }, calm)
    expect(b.barPos).toBeGreaterThan(a.barPos)
    const outside = { ...inside, fishPos: 0.5 + base.barSize, fishTarget: 0.5 + base.barSize }
    const c = stepBar(outside, true, 20, base, calm)
    const d = stepBar(outside, true, 20, { ...base, pull: barbed.pull }, calm)
    expect(d.barPos).toBe(c.barPos)
  })
  it('barbed만으로는 혼자 다 잡지 못한다: 안 눌러도 빠른 dart 물고기(난이도 .7)는 빠져나간다', () => {
    const params = { ...barParams('anchovy', 1, ['barbed']), difficulty: 0.7, behavior: 'dart' as const }
    const rng = seeded(5)
    let bar = initBar()
    let escaped = false
    for (let i = 0; i < 1250; i++) {
      bar = stepBar({ ...bar, progress: 0.5 }, false, 16, params, rng)
      if (Math.abs(bar.fishPos - bar.barPos) > params.barSize / 2) escaped = true
    }
    expect(escaped).toBe(true)
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
    const params = { barSize: 0.22, difficulty: 0.5, behavior, drain: 1, pull: 0 }
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
      const params = { barSize: 0.22, difficulty: 1, behavior, drain: 1, pull: 0 }
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

describe('barParams: 더 새 서버가 준 모르는 값', () => {
  it('모르는 어종이면 throw하지 않고 중립값(난이도 0.5, mixed)', () => {
    const p = barParams('fish-from-the-future', 2)
    expect(p.difficulty).toBe(0.5)
    expect(p.behavior).toBe('mixed')
    expect(p.barSize).toBeCloseTo(barParams('goby', 2).barSize)
  })
  it('모르는 낚싯대 단계면 기본 바(보너스 없음)', () => {
    const p = barParams('goby', 9 as never)
    expect(p.barSize).toBeCloseTo(0.22)
    expect(p.difficulty).toBe(SPECIES.find((s) => s.id === 'goby')!.difficulty)
  })
})

/** 60초 동안 strategy로 누른다. 결과와 끝난 시각 */
function fight(params: BarParams, seedN: number, strategy: (b: Bar, hist: Bar[]) => boolean) {
  const rng = seeded(seedN)
  let bar = initBar()
  const hist: Bar[] = []
  let t = 0
  for (; t < 60000 && barResult(bar) === 'playing'; t += 16) {
    hist.push(bar)
    bar = stepBar(bar, strategy(bar, hist), 16, params, rng)
  }
  return { result: barResult(bar), t, perfect: bar.perfect }
}
/** 사람 비슷한 봇: 200ms 늦게 본 물고기·바 위치로 누른다(속도 보정 0.12) */
const human200 = (_b: Bar, hist: Bar[]) => {
  const s = hist[Math.max(0, hist.length - 1 - Math.round(200 / 16))]
  return s.fishPos - s.barPos - 0.12 * s.barVel > 0
}
const rate = (params: BarParams, strategy: (b: Bar, hist: Bar[]) => boolean, n: number, seed0: number) => {
  let caught = 0
  for (let i = 0; i < n; i++) if (fight(params, seed0 + i, strategy).result === 'caught') caught++
  return caught / n
}

describe('안 누르면 잡히지 않는다 (바닥에 내려앉은 바는 줄이 느슨하다)', () => {
  // 낚싯대 칸 수 안의 찌 조합: 칸 0 → 없음, 1 → 하나씩, 2·3 → 코르크+가시(+함정)까지
  const combos = (tier: number): TackleId[][] => {
    const slots = tackleSlots(tier)
    const out: TackleId[][] = [[]]
    if (slots >= 1) out.push(['cork'], ['barbed'], ['trap'])
    if (slots >= 2) out.push(['cork', 'barbed'], ['barbed', 'trap'])
    if (slots >= 3) out.push(['cork', 'barbed', 'trap'])
    return out
  }

  it('모든 어종 × 낚을 수 있는 모든 낚싯대(1~6) × 칸 안의 모든 찌 조합(코르크·가시·함정), 60초 안 누르면 잡히는 비율 ≤ 5% (실제 0)', () => {
    let worst = 0
    const seen = new Set<string>()
    for (const s of SPECIES) {
      for (const r of RODS) {
        if (r.tier < s.minRod) continue
        for (const eq of combos(r.tier)) {
          const v = rate(barParams(s.id, r.tier, eq), () => false, 20, 500)
          seen.add(s.behavior)
          worst = Math.max(worst, v)
          expect(v, `${s.id} rod ${r.tier} ${eq.join('+')}`).toBeLessThanOrEqual(0.05)
        }
      }
    }
    expect(worst).toBe(0)
    expect([...seen].sort()).toEqual(['dart', 'floater', 'mixed', 'sinker', 'smooth'])
  })

  it('바닥에 막 닿은 바(500ms 안)는 아직 센다: 바닥 근처에서 살살 누르는 것은 봐준다', () => {
    const params = { barSize: 0.22, difficulty: 0, behavior: 'sinker' as const, drain: 1, pull: 0 }
    const calm = () => 0.99
    let bar: Bar = { ...initBar(), barPos: 0.11, fishPos: 0.05, fishTarget: 0.05, progress: 0.5 }
    bar = stepBar(bar, false, 16, params, calm)
    expect(bar.progress).toBeGreaterThan(0.5)
    for (let i = 0; i < 40; i++) bar = stepBar(bar, false, 16, params, calm)
    const p = bar.progress
    bar = stepBar(bar, false, 16, params, calm)
    expect(bar.progress).toBeLessThan(p) // 640ms 뒤에는 느슨해져 줄어든다
    bar = stepBar(bar, true, 16, params, calm)
    expect(bar.slackMs).toBe(0)
  })

  it('가시 바늘은 누를 때만 바를 끈다', () => {
    const base = { ...barParams('anchovy', 3, ['barbed']), behavior: 'mixed' as const }
    const calm = () => 0.99
    const inside = { ...initBar(), barPos: 0.5, fishPos: 0.6, fishTarget: 0.6 }
    expect(stepBar(inside, false, 20, base, calm).barPos).toBe(stepBar(inside, false, 20, { ...base, pull: 0 }, calm).barPos)
    expect(stepBar(inside, true, 20, base, calm).barPos).toBeGreaterThan(stepBar(inside, true, 20, { ...base, pull: 0 }, calm).barPos)
  })
})

describe('난이도는 그대로 (사람 비슷한 봇의 잡는 비율, 바꾸기 전 구현 3097fc9로 잰 값 ±15%p)', () => {
  // [어종, 낚싯대, 찌, 옛 구현 잡는 비율(시드 900~939)]
  const cases: [string, RodTier, TackleId[], number][] = [
    ['grouper', 3, [], 0], // 전설 다금바리, 가장 낮은 낚싯대
    ['grouper', 4, ['cork'], 0.6],
    ['golden-mandarin', 3, ['cork'], 0.275], // 전설 황금 쏘가리
    ['silver-king-trout', 4, [], 0.15], // 전설 은빛 대왕송어(dart)
    ['fire-dragonfish', 4, ['cork'], 0.95], // 전설 화룡어(dart)
    ['lava-eel', 3, [], 0], // 동굴 수입의 대부분
    ['lava-eel', 6, ['cork'], 0.75],
    ['rockfish', 1, [], 0.275], // sinker, 바닥 근처에서 살살 눌러야 한다
    ['yellowtail', 2, [], 0.95], // smooth
  ]
  it.each(cases)('%s 낚싯대 %i %j: 옛 값 %f', (id, tier, eq, old) => {
    const v = rate(barParams(id, tier, eq), human200, 40, 900)
    expect(Math.abs(v - old)).toBeLessThanOrEqual(0.15)
  })
})

// ---------------------------------------------------------------- 낚시 5부 M1: 신화 용솟음(surge)·백룡의 숨결
describe('barParams 버프', () => {
  it('dragon-breath → barSize ×dragonBar, 코르크와 곱; 다른·모르는 버프는 무시', () => {
    const base = barParams('anchovy', 4).barSize
    expect(barParams('anchovy', 4, [], ['dragon-breath']).barSize).toBeCloseTo(base * BUFF_FX.dragonBar)
    expect(barParams('anchovy', 4, ['cork'], ['dragon-breath']).barSize).toBeCloseTo(base * TACKLE_FX.corkBar * BUFF_FX.dragonBar)
    expect(barParams('anchovy', 4, [], ['imugi-scale', 'dragon-pearl']).barSize).toBe(base)
    expect(barParams('anchovy', 4, [], ['zzz' as BuffId]).barSize).toBe(base)
  })
  it('최대 바: 6단계 + 코르크 + 숨결 = 0.22 × 1.5 × 1.2 × 1.08', () => {
    expect(barParams('anchovy', 6, ['cork'], ['dragon-breath']).barSize).toBeCloseTo(0.22 * 1.5 * 1.2 * 1.08)
  })
})

describe('surgePhase', () => {
  it('3,400ms 주기, 앞 1,000ms 고요', () => {
    expect([0, 999, 1000, 3399, 3400, 5000, 6799, 6800, -1].map(surgePhase)).toEqual(['calm', 'calm', 'surge', 'surge', 'calm', 'surge', 'surge', 'calm', 'surge'])
  })
  it('effectiveBarSize: 용솟음 동안만 0.21까지 줄고, 다른 유형·고요·작은 바는 그대로', () => {
    const p = barParams('anchovy', 6, ['cork'])
    expect(effectiveBarSize({ ...p, behavior: 'surge' }, 2000)).toBe(0.21)
    expect(effectiveBarSize({ ...p, behavior: 'surge' }, 500)).toBe(p.barSize)
    expect(effectiveBarSize({ ...p, behavior: 'dart' }, 2000)).toBe(p.barSize)
    expect(effectiveBarSize({ ...p, barSize: 0.15, behavior: 'surge' }, 2000)).toBe(0.15)
    // 용솟음 상한은 백룡의 숨결과도 무관하다(숨결은 고요·다른 물고기에서만)
    const breath = barParams('anchovy', 6, ['cork'], ['dragon-breath'])
    expect(effectiveBarSize({ ...breath, behavior: 'surge' }, 2000)).toBe(0.21)
    expect(effectiveBarSize({ ...breath, behavior: 'surge' }, 500)).toBeCloseTo(breath.barSize)
  })
})

describe('surge 움직임', () => {
  const params = (d = 1): BarParams => ({ barSize: 0.22, difficulty: d, behavior: 'surge', drain: 1, pull: 0 })
  it('용솟음 구간 ms당 이동량 > 고요 구간의 3배(여러 시드), 위치는 [0, 1]', () => {
    for (const d of [0.97, 1]) {
      let calm = 0, calmMs = 0, surge = 0, surgeMs = 0
      for (const n of [21, 22, 23, 24, 25]) {
        const rng = seeded(n)
        let bar = initBar()
        for (let i = 0; i < 60000 / 16; i++) {
          const ph = surgePhase(bar.t)
          const next = stepBar({ ...bar, progress: 0.5 }, false, 16, params(d), rng)
          expect(next.fishPos).toBeGreaterThanOrEqual(0)
          expect(next.fishPos).toBeLessThanOrEqual(1)
          if (ph === 'calm') { calm += Math.abs(next.fishPos - bar.fishPos); calmMs += 16 } else { surge += Math.abs(next.fishPos - bar.fishPos); surgeMs += 16 }
          bar = next
        }
      }
      expect(surge / surgeMs).toBeGreaterThan(3 * (calm / calmMs))
    }
  })
  it('고요 구간에는 트랙 가운데(0.3~0.7) 근처에 머문다', () => {
    const rng = seeded(31)
    let bar: Bar = { ...initBar(), t: 0 }
    const calmPos: number[] = []
    for (let i = 0; i < 60000 / 16; i++) {
      bar = stepBar({ ...bar, progress: 0.5 }, false, 16, params(), rng)
      if (surgePhase(bar.t) === 'calm' && bar.t % 3400 > 600) calmPos.push(bar.fishPos)
    }
    const inside = calmPos.filter((p) => p >= 0.25 && p <= 0.75).length / calmPos.length
    expect(inside).toBeGreaterThan(0.8)
  })
})

describe('신화 surge: 안 누르면 못 잡고, 사람 비슷한 봇은 잡을 수 있다', () => {
  withTempData(M1_FIXTURE)
  const combos = (tier: number): TackleId[][] => {
    const slots = tackleSlots(tier)
    const out: TackleId[][] = [[]]
    if (slots >= 1) out.push(['cork'], ['barbed'], ['trap'])
    if (slots >= 2) out.push(['cork', 'barbed'], ['barbed', 'trap'])
    if (slots >= 3) out.push(['cork', 'barbed', 'trap'])
    return out
  }
  it('surge 어종(난이도 .97·1.0) × 낚싯대 5·6 × 찌 조합 × 버프 {없음, 숨결}: 60초 안 누르면 0', () => {
    for (const id of ['tmp-mythic', 'tmp-mythic2']) for (const tier of [5, 6] as const) for (const eq of combos(tier)) for (const buffs of [[], ['dragon-breath']] as BuffId[][]) {
      const p = barParams(id, tier, eq, buffs)
      expect(p.behavior).toBe('surge')
      expect(rate(p, () => false, 20, 500), `${id} ${tier} ${eq.join('+')} ${buffs.join()}`).toBe(0)
    }
  })
  it('기존 모든 어종 × 낚싯대 × 찌 조합 × 백룡의 숨결: 60초 안 누르면 0', () => {
    for (const s of SPECIES) {
      if (s.area.startsWith('tmp-')) continue
      for (const r of RODS) {
        if (r.tier < s.minRod) continue
        for (const eq of combos(r.tier)) expect(rate(barParams(s.id, r.tier, eq, ['dragon-breath']), () => false, 20, 500), `${s.id} ${r.tier} ${eq.join('+')}`).toBe(0)
      }
    }
  })
  it('사람 비슷한 봇(200ms): 난이도 1.0, 6단계 + 코르크·가시 → 25~70%; 5단계 찌 없음 → 10% 이상', () => {
    const best = rate(barParams('tmp-mythic2', 6, ['cork', 'barbed']), human200, 100, 900)
    expect(best).toBeGreaterThanOrEqual(0.25)
    expect(best).toBeLessThanOrEqual(0.7)
    expect(rate(barParams('tmp-mythic2', 5, []), human200, 100, 900)).toBeGreaterThanOrEqual(0.1)
  })
  it('백룡의 숨결을 켜도 봇 범위 안이고, 끈 것보다 덜 잡지는 않는다', () => {
    const best = rate(barParams('tmp-mythic2', 6, ['cork', 'barbed'], ['dragon-breath']), human200, 100, 900)
    expect(best).toBeGreaterThanOrEqual(rate(barParams('tmp-mythic2', 6, ['cork', 'barbed']), human200, 100, 900))
    expect(best).toBeLessThanOrEqual(0.7)
    expect(rate(barParams('tmp-mythic2', 5, [], ['dragon-breath']), human200, 100, 900)).toBeGreaterThanOrEqual(0.1)
  })
})

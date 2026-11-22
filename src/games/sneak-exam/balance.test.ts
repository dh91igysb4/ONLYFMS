// 밸런스: 시드 200개에서 봇들이 내는 결과의 집계를 문턱값과 비교한다. 문턱값은 설계 §7·구현 계획 Task 5 기준(낮추지 않는다).
import { describe, expect, it } from 'vitest'
import { N_Q, TOTAL_TICKS } from './constants.ts'
import { getExam } from './exam.ts'
import { scoreOf } from './logic.ts'
import { applyCmd, initSim, step } from './sim.ts'
import { carefulBot, glassesBot, idleBot, recklessBot, runBot, type Bot } from './bots.ts'

const SEEDS = Array.from({ length: 200 }, (_, k) => (k + 1).toString(16).padStart(32, '0'))

type Agg = { caught: number; correct: number; score: number; correctByType: number[] }

function aggregate(bot: Bot): Agg {
  let caught = 0
  let correct = 0
  let score = 0
  const sum = [0, 0, 0]
  const cnt = [0, 0, 0]
  for (const seed of SEEDS) {
    const r = runBot(seed, bot)
    const t = getExam(seed).proctorType
    if (r.sim.end === 'caught') caught++
    correct += r.correct
    score += r.score
    sum[t] += r.correct
    cnt[t]++
  }
  const n = SEEDS.length
  return { caught: caught / n, correct: correct / n, score: score / n, correctByType: sum.map((v, t) => v / cnt[t]) }
}

const cache = new Map<Bot, Agg>()
const agg = (bot: Bot): Agg => {
  let a = cache.get(bot)
  if (!a) cache.set(bot, (a = aggregate(bot)))
  return a
}

describe('sneak-exam balance', () => {
  it('idle bot is never suspected', () => {
    let bad = ''
    for (const seed of SEEDS) {
      const exam = getExam(seed)
      let s = initSim(exam)
      while (!s.end) {
        s = step(s, exam)
        if (s.susp !== 0) bad ||= `${seed} tick ${s.tick}`
      }
      if (s.end !== 'timeout') bad ||= `${seed} end ${s.end}`
    }
    expect(bad).toBe('')
    const r = runBot(SEEDS[0], idleBot)
    expect(r.sim.end).toBe('timeout')
    expect(r.sim.tick).toBe(TOTAL_TICKS)
  })

  it('reckless bot is usually caught', () => {
    expect(agg(recklessBot).caught).toBeGreaterThanOrEqual(0.9)
  })

  it('careful bot', () => {
    const a = agg(carefulBot)
    expect(a.caught).toBeLessThanOrEqual(0.05)
    expect(a.correct).toBeGreaterThanOrEqual(6)
    for (const [t, v] of a.correctByType.entries()) expect(v, `type ${t}`).toBeGreaterThanOrEqual(5)
  })

  it('glasses only is safe but slow', () => {
    const a = agg(glassesBot)
    expect(a.caught).toBeLessThanOrEqual(0.05)
    expect(a.score).toBeLessThan(agg(carefulBot).score)
  })

  // 사람처럼 반응이 늦으면(감독관을 0.5초 전 모습으로 보면) 꽤 자주 걸려야 한다. 너무 쉽지도, 불가능하지도 않게.
  it('a careful bot that reacts half a second late is caught often, but not always', () => {
    let caught = 0
    for (const seed of SEEDS) if (runBot(seed, carefulBot, 30).sim.end === 'caught') caught++
    const rate = caught / SEEDS.length
    expect(rate).toBeGreaterThanOrEqual(0.3)
    expect(rate).toBeLessThanOrEqual(0.6)
  })

  it('guess-all is not competitive', () => {
    let total = 0
    for (const seed of SEEDS) {
      const exam = getExam(seed)
      let s = initSim(exam)
      for (let q = 0; q < N_Q; q++) s = applyCmd(s, ['m', q, 0])
      s = applyCmd(s, ['x'])
      total += scoreOf(s, exam)
    }
    expect(total / SEEDS.length).toBeLessThan(agg(carefulBot).score / 2)
  })
})

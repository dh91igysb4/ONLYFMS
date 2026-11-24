// 자유 플레이 골드 균형 (지갑 설계 §7.3). 기준 플레이로 쉬지 않고 하면(판 사이 5초) 시간당 FREE_REF(= REF / 4) ±20%.
// 기준 플레이 출처: 봇 — glassesBot 시드 100개 평균 점수 약 921, 평균 약 5,763틱(60Hz → 96초).
// carefulBot(1,375점)은 거의 최적이라 평균 플레이를 대표하지 못해 쓰지 않는다.
// 게임 로직이 바뀌어 봇 점수·시간이 ±10% 넘게 달라지면 실패한다 → perPoint를 다시 잡는다(manifest·마이그레이션 함께).
import { describe, expect, it } from 'vitest'
import { FREE_DAILY_CAP, FREE_REF, hourlyGold } from '../economy.ts'
import { glassesBot, runBot } from './bots.ts'
import { TICK_HZ } from './constants.ts'
import { manifest } from './manifest.ts'

const AVG_SCORE = 921
const PLAY_SEC = 96
const round10 = (x: number) => Math.round(x / 10) * 10

describe('sneak-exam 자유 플레이 골드', () => {
  const g = manifest.gold!
  it('기준 플레이 시간당 골드가 FREE_REF ±20%', () => {
    const h = hourlyGold(AVG_SCORE, PLAY_SEC, g.perPoint)
    expect(Math.abs(h - FREE_REF) / FREE_REF, `${h}`).toBeLessThanOrEqual(0.2)
  })
  it('playCap = 기준 한 판의 5배(10 단위), dailyCap = FREE_DAILY_CAP', () => {
    expect(g.playCap).toBe(round10(5 * Math.floor(AVG_SCORE * g.perPoint)))
    expect(g.dailyCap).toBe(FREE_DAILY_CAP)
  })
  it('glassesBot 시드 100개 평균 점수·시간이 기준의 ±10%', () => {
    const seeds = Array.from({ length: 100 }, (_, k) => (k + 1).toString(16).padStart(32, '0'))
    let score = 0
    let ticks = 0
    for (const seed of seeds) {
      const r = runBot(seed, glassesBot)
      score += r.score
      ticks += r.sim.tick
    }
    const avgScore = score / seeds.length
    const avgSec = ticks / seeds.length / TICK_HZ
    expect(Math.abs(avgScore - AVG_SCORE) / AVG_SCORE, `${avgScore}`).toBeLessThanOrEqual(0.1)
    expect(Math.abs(avgSec - PLAY_SEC) / PLAY_SEC, `${avgSec}`).toBeLessThanOrEqual(0.1)
  })
})

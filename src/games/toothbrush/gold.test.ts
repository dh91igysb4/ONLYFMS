// 자유 플레이 골드 균형 (지갑 설계 §7.3). 기준 플레이로 쉬지 않고 하면(판 사이 5초) 시간당 REF ±20%.
// 기준 플레이 출처: 봇 — aim(시드 20개 평균 약 7.40)과 sweep(약 4.22)의 평균 5.81, 판은 60초(TOTAL_TICKS).
// 게임 로직이 바뀌어 봇 점수가 ±10% 넘게 달라지면 실패한다 → perPoint를 다시 잡는다(manifest·마이그레이션 함께).
import { describe, expect, it } from 'vitest'
import { FREE_DAILY_CAP, hourlyGold, REF } from '../economy.ts'
import { playBot } from './bots.ts'
import { manifest } from './manifest.ts'

const AVG_SCORE = 5.81
const PLAY_SEC = 60
const round10 = (x: number) => Math.round(x / 10) * 10

describe('toothbrush 자유 플레이 골드', () => {
  const g = manifest.gold!
  it('기준 플레이 시간당 골드가 REF ±20%', () => {
    const h = hourlyGold(AVG_SCORE, PLAY_SEC, g.perPoint)
    expect(Math.abs(h - REF) / REF, `${h}`).toBeLessThanOrEqual(0.2)
  })
  it('playCap = 기준 한 판의 5배(10 단위), dailyCap = FREE_DAILY_CAP', () => {
    expect(g.playCap).toBe(round10(5 * Math.floor(AVG_SCORE * g.perPoint)))
    expect(g.dailyCap).toBe(FREE_DAILY_CAP)
  })
  it('봇 평균 점수가 기준의 ±10% (aim·sweep 시드 20개씩)', () => {
    const seeds = Array.from({ length: 20 }, (_, k) => new Uint8Array(16).fill(k + 1))
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const v = (avg(seeds.map((s) => playBot('aim', s))) + avg(seeds.map((s) => playBot('sweep', s)))) / 2
    expect(Math.abs(v - AVG_SCORE) / AVG_SCORE, `${v}`).toBeLessThanOrEqual(0.1)
  })
})

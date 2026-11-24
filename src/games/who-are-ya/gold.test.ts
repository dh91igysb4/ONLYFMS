// 자유 플레이 골드 균형 (지갑 설계 §7.3). 기준 플레이로 쉬지 않고 하면(판 사이 5초) 시간당 FREE_REF(= REF / 10) ±20%.
// 기준 플레이 출처: 가정: 자유 플레이 평균 6점, 한 판 90초.
// 운영 평균 점수로 확인할 것(배포 체크리스트 "지갑 배포 (2단계 자유 플레이 지급)"): ±30% 넘게 벗어나면 수치 조정 PR.
import { describe, expect, it } from 'vitest'
import { FREE_AVG_PLAY_MAX, FREE_DAILY_CAP, FREE_PLAY_CAP_MAX, FREE_REF, hourlyGold } from '../economy.ts'
import { manifest } from './manifest.ts'

const AVG_SCORE = 6
const PLAY_SEC = 90
const round10 = (x: number) => Math.round(x / 10) * 10

describe('who-are-ya 자유 플레이 골드', () => {
  const g = manifest.gold!
  it('기준 플레이 시간당 골드가 FREE_REF ±20%', () => {
    const h = hourlyGold(AVG_SCORE, PLAY_SEC, g.perPoint)
    expect(Math.abs(h - FREE_REF) / FREE_REF, `${h}`).toBeLessThanOrEqual(0.2)
  })
  it('기준 한 판 < FREE_AVG_PLAY_MAX, playCap = min(기준 한 판의 5배(10 단위), FREE_PLAY_CAP_MAX), dailyCap = FREE_DAILY_CAP', () => {
    expect(Math.floor(AVG_SCORE * g.perPoint)).toBeLessThan(FREE_AVG_PLAY_MAX)
    expect(g.playCap).toBe(Math.min(round10(5 * Math.floor(AVG_SCORE * g.perPoint)), FREE_PLAY_CAP_MAX))
    expect(g.dailyCap).toBe(FREE_DAILY_CAP)
  })
})

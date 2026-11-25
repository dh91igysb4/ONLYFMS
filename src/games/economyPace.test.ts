// 사이트 하루 상한 모양 검사 (지갑 설계 §4.1, §5.6).
// 2026-11-25부터 사이트 하루 상한은 미니게임(reason free) 수입에만 걸린다. 낚시 수입은 판매 마릿수 감쇠를 받고
// 진행 속도는 fishing/gold.test.ts가 econSim으로 잰다(설계 2026-11-25-fishing-sell-decay-design.md).
import { describe, expect, it } from 'vitest'
import { DAILY_SOFT_CAP, DAILY_SOFT_CAP_2, FREE_DAILY_CAP, SOFT_CAP_RATE, SOFT_CAP_RATE_2, SOFT_CAP_TIERS } from './economy.ts'
import { games } from './index.ts'

describe('상한 표', () => {
  it('SOFT_CAP_TIERS = [30,750 다] → [41,000까지 75%] → [그 위 50%]', () => {
    expect(SOFT_CAP_TIERS).toEqual([
      [DAILY_SOFT_CAP, 1],
      [DAILY_SOFT_CAP_2, SOFT_CAP_RATE],
      [Infinity, SOFT_CAP_RATE_2],
    ])
  })
  it('미니게임 게임별 하루 상한을 다 채워도 사이트 상한 첫 구간 안이다(상한은 안전망)', () => {
    const free = games.filter((g) => g.manifest.gold).length
    expect(free * FREE_DAILY_CAP).toBeLessThan(DAILY_SOFT_CAP)
  })
})

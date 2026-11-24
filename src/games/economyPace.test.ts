// 사이트 하루 상한 모양의 진행 속도 검사 (지갑 설계 §4.1, §5.6, 2026-11-24 2단 상한 개정).
//
// 목표(사용자 결정): 하루 1시간 → 낚시 장비·해금을 다 사는 데 약 한 달. 낚시 5부(설계 2026-11-24-fishing-world-5 §8)가
// 새 지역 해금 넷을 더해 목표를 약 34일(±20%, 27~41일)로 고쳤다. 오래 하는 사람은 빠르되
// 하루 3시간 ≥ 약 18일, 하루 5시간 ≥ 약 21일(사용자가 위임한 결정의 기준, 2026-11-24).
//
// 지갑 Task 4(낚시 logic.version 14)부터 낚시 시뮬레이션(src/games/fishing/econSim.ts)을 직접 쓴다.
// econSim.simulate는 day.tiers를 생략하면 이 파일과 같은 SOFT_CAP_TIERS(실제 _gold_move와 같은 상한)로 잰다.
// 그래서 이 검사와 fishing/gold.test.ts는 같은 수치를 본다(예전에는 다듬기 PR 곡선을 손으로 옮긴 사본이었다).
// econSim의 가정(지갑 설계 §4 REF 계산과 같음): 계절·시각·날씨 균등 평균, 성공률 80%, 싸움 8초, 다시 던지기 3초,
// 퍼펙트 20%, 전설 제외, 가방이 차면 상점 왕복. 살 수 있게 되는 순간 바로 산다.
import { describe, expect, it } from 'vitest'
import { DAILY_SOFT_CAP, DAILY_SOFT_CAP_2, SOFT_CAP_RATE, SOFT_CAP_RATE_2, SOFT_CAP_TIERS } from './economy.ts'
import { BUY_ORDER, simulate, totalSinks, type CapTiers } from './fishing/econSim.ts'

// 시뮬레이션 한 번이 수 초라 (시간, 상한) 조합마다 한 번만 돌린다
const memo = new Map<string, number>()
const daysFor = (hoursPerDay: number, tiers: CapTiers = SOFT_CAP_TIERS) => {
  const key = `${hoursPerDay}|${tiers === SOFT_CAP_TIERS ? 'now' : JSON.stringify(tiers)}`
  if (!memo.has(key)) memo.set(key, simulate(BUY_ORDER, { hoursPerDay, tiers }).at(-1)!.atDay)
  return memo.get(key)!
}
const OLD: CapTiers = [
  [DAILY_SOFT_CAP, 1],
  [Infinity, SOFT_CAP_RATE],
]
const near = (v: number, want: number, tol = 0.02) => expect(Math.abs(v - want) / want, `${v} vs ${want}`).toBeLessThan(tol)

describe('상한 표', () => {
  it('SOFT_CAP_TIERS = [30,750 다] → [41,000까지 20%] → [그 위 4%]', () => {
    expect(SOFT_CAP_TIERS).toEqual([
      [DAILY_SOFT_CAP, 1],
      [DAILY_SOFT_CAP_2, SOFT_CAP_RATE],
      [Infinity, SOFT_CAP_RATE_2],
    ])
  })
  it('econSim이 상한을 생략하면 SOFT_CAP_TIERS로 잰다(짧은 구매 목록으로 비교)', () => {
    const head = BUY_ORDER.slice(0, 10)
    expect(simulate(head, { hoursPerDay: 1 })).toEqual(simulate(head, { hoursPerDay: 1, tiers: SOFT_CAP_TIERS }))
    expect(simulate(head, { hoursPerDay: 1 })).not.toEqual(simulate(head, { hoursPerDay: 1, tiers: [[1000, 1], [Infinity, 0.5]] }))
  })
})

describe('검산: 낚시 5부 설계 표 재현 (옛 1단 상한)', () => {
  it('총액 = 낚시 5부 totalSinks 1,546,300', () => {
    expect(totalSinks()).toBe(1_546_300)
  })
  it('하루 1·3·5시간 = 34.3 / 18.1 / 12.4일', () => {
    near(daysFor(1, OLD), 34.28)
    near(daysFor(3, OLD), 18.06)
    near(daysFor(5, OLD), 12.41)
  })
})

describe('지금 상한 모양(SOFT_CAP_TIERS)의 진행 속도', () => {
  const d1 = daysFor(1)
  const d3 = daysFor(3)
  const d5 = daysFor(5)
  const d10 = daysFor(10)
  it('하루 1시간 ≈ 34일 목표 범위(±20%, 27~41일) 안', () => {
    expect(d1, `${d1}`).toBeGreaterThan(34 * 0.8)
    expect(d1, `${d1}`).toBeLessThan(34 * 1.2)
  })
  it('하루 3시간 ≥ 18일, 하루 5시간 ≥ 21일', () => {
    expect(d3, `${d3}`).toBeGreaterThanOrEqual(18)
    expect(d5, `${d5}`).toBeGreaterThanOrEqual(21)
  })
  it('오래 할수록 여전히 빠르다 (1시간 > 3시간 > 5시간 > 10시간)', () => {
    expect(d1).toBeGreaterThan(d3)
    expect(d3).toBeGreaterThan(d5)
    expect(d5).toBeGreaterThan(d10)
  })
  it('기록 값: 1·3·5·10시간 = 37.3 / 30.2 / 26.0 / 19.3일', () => {
    near(d1, 37.26)
    near(d3, 30.18)
    near(d5, 26.03)
    near(d10, 19.32)
  })
})

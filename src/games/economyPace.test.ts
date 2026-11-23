// 사이트 하루 상한 모양의 진행 속도 검사 (지갑 설계 §4.1, §5.6, 2026-11-24 2단 상한 개정).
//
// 목표(사용자 결정): 하루 1시간 → 낚시 장비·해금을 다 사는 데 약 30일. 오래 하는 사람은 빠르되
// 하루 3시간 ≥ 약 18일, 하루 5시간 ≥ 약 21일(사용자가 위임한 결정의 기준, 2026-11-24).
//
// 수입 곡선은 낚시 다듬기 PR(#81, origin/feat/fishing-polish c2afd73)의 src/games/fishing/econSim.ts를
// 그 브랜치 데이터로 돌려 얻은 값을 그대로 옮긴 것이다(이 브랜치에는 고급 장비 데이터가 없어 import할 수 없다).
//   - START: 처음(대나무·20칸·기본 지역)의 가장 좋은 자리 시간당 수입 bestSpot(...).income
//   - CURVE: BUY_ORDER 순서의 [가격, 산 뒤 시간당 수입 incomeAfter] (simulate()의 Milestone)
//   econSim의 가정(지갑 설계 §4 REF 계산과 같음): 계절·시각·날씨 균등 평균, 성공률 80%, 싸움 8초, 다시 던지기 3초,
//   퍼펙트 20%, 전설 제외, 가방이 차면 상점 왕복. 살 수 있게 되는 순간 바로 산다.
// 아래 simulateDays는 econSim.simulate(order, { hoursPerDay, cap, rate })의 하루 루프를 그대로 옮기되,
// 상한 계산만 SOFT_CAP_TIERS(구간 적분, 내림 없음)로 일반화했다. 낚시 다듬기 PR이 머지되면 econSim과
// fishing/gold.test.ts의 "하루 여러 시간" 기록 값도 이 상한 모양으로 바꾼다(그때는 econSim을 직접 import해도 된다).
// 검산: 옛 모양(30,750 + 넘은 몫 20%)으로 돌리면 다듬기 PR이 기록한 29.4 / 16.4 / 11.4일이 나온다.
import { describe, expect, it } from 'vitest'
import { DAILY_SOFT_CAP, SOFT_CAP_RATE, SOFT_CAP_TIERS } from './economy.ts'

const START = 11_499
const CURVE: readonly (readonly [price: number, incomeAfter: number])[] = [
  [1_500, 21_700], // 유리섬유 낚싯대
  [800, 22_258], // 가방 30칸
  [5_000, 22_258], // 산 호수 해금
  [8_000, 25_746], // 카본 낚싯대
  [1_500, 27_754], // 회전 찌
  [15_000, 53_652], // 동굴 해금
  [5_000, 55_739], // 가방 40칸
  [5_000, 60_929], // 호기심 찌
  [40_000, 75_771], // 명장의 낚싯대
  [50_000, 75_771], // 섬 해금
  [1_000, 75_771], // 코르크 찌
  [1_500, 75_771], // 함정 찌
  [2_000, 75_771], // 가시 바늘
  [280_000, 80_848], // 백골 낚싯대
  [50_000, 82_880], // 가방 50칸
  [620_000, 87_867], // 용왕의 낚싯대
  [100_000, 89_381], // 가방 60칸
]

type Tiers = readonly (readonly [upTo: number, rate: number])[]

/** 오늘 들어간 합계 s에서 원래 금액 raw가 실제로 들어갈 양(구간 적분, 내림 없음) */
function capped(raw: number, s: number, tiers: Tiers): number {
  let got = 0
  let left = raw
  for (const [upTo, rate] of tiers) {
    if (left <= 0) break
    const use = Math.min(left, Math.max(upTo - s - got, 0) / rate)
    got += use * rate
    left -= use
  }
  return got
}

/** econSim.simulate의 하루 루프(0.01시간 단위, 하루 hoursPerDay시간 뒤 오늘 합계 초기화). 다 사기까지 날짜 */
function simulateDays(hoursPerDay: number, tiers: Tiers): number {
  const STEP_H = 0.01
  let gold = 0
  let steps = 0
  let earnedToday = 0
  let income = START
  for (const [price, after] of CURVE) {
    while (gold < price) {
      const got = capped(income * STEP_H, earnedToday, tiers)
      earnedToday += got
      gold += got
      steps++
      if (Math.round(steps * STEP_H * 1e6) % Math.round(hoursPerDay * 1e6) === 0) earnedToday = 0
    }
    gold -= price
    income = after
  }
  return (steps * STEP_H) / hoursPerDay
}

const OLD: Tiers = [
  [DAILY_SOFT_CAP, 1],
  [Infinity, SOFT_CAP_RATE],
]
const near = (v: number, want: number, tol = 0.02) => expect(Math.abs(v - want) / want, `${v} vs ${want}`).toBeLessThan(tol)

describe('검산: 낚시 다듬기 PR 시뮬레이션 재현 (옛 1단 상한)', () => {
  it('곡선 총액 = 다듬기 PR totalSinks 1,186,300', () => {
    expect(CURVE.reduce((a, [p]) => a + p, 0)).toBe(1_186_300)
  })
  it('하루 1·3·5시간 = 29.4 / 16.4 / 11.4일', () => {
    near(simulateDays(1, OLD), 29.38)
    near(simulateDays(3, OLD), 16.38)
    near(simulateDays(5, OLD), 11.41)
  })
})

describe('지금 상한 모양(SOFT_CAP_TIERS)의 진행 속도', () => {
  const d1 = simulateDays(1, SOFT_CAP_TIERS)
  const d3 = simulateDays(3, SOFT_CAP_TIERS)
  const d5 = simulateDays(5, SOFT_CAP_TIERS)
  it('하루 1시간 ≈ 30일 (±10%)', () => {
    expect(Math.abs(d1 - 30) / 30, `${d1}`).toBeLessThan(0.1)
  })
  it('하루 3시간 ≥ 18일, 하루 5시간 ≥ 21일', () => {
    expect(d3, `${d3}`).toBeGreaterThanOrEqual(18)
    expect(d5, `${d5}`).toBeGreaterThanOrEqual(21)
  })
  it('오래 할수록 여전히 빠르다 (1시간 > 3시간 > 5시간 > 10시간)', () => {
    const d10 = simulateDays(10, SOFT_CAP_TIERS)
    expect(d1).toBeGreaterThan(d3)
    expect(d3).toBeGreaterThan(d5)
    expect(d5).toBeGreaterThan(d10)
  })
  it('기록 값 (설계 §4.1 효과 표): 1·3·5·10시간 = 29.6 / 25.0 / 22.0 / 17.0일', () => {
    near(simulateDays(1, SOFT_CAP_TIERS), 29.6)
    near(simulateDays(3, SOFT_CAP_TIERS), 25.0)
    near(simulateDays(5, SOFT_CAP_TIERS), 22.0)
    near(simulateDays(10, SOFT_CAP_TIERS), 17.0)
  })
})

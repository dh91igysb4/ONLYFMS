// 경제 상수 원본 (설계 docs/superpowers/specs/2026-11-23-wallet-design.md §4, §5.6, §12).
// 순수 모듈: React·외부 의존 없음 (Edge Function도 import할 수 있다).
// SQL이 쓰는 값은 _economy()에 사본이 있고, economy.test.ts가 마이그레이션의 마지막 정의와 비교한다.

/** 기준 시간당 수입(설계 §4). 2단계 낚싯대·마을 물가 낚시의 기대값. 2단계 PR의 src/games/fishing/gold.test.ts가 ±25%로 지킨다 */
export const REF = 20500

/**
 * 사이트 하루 상한(설계 §5.6, 2026-11-24 2단 상한 개정). world(+)·free·daily_prize의 오늘(KST) 실제 수입 합계 기준.
 * 들어간 합계가 DAILY_SOFT_CAP까지는 다, DAILY_SOFT_CAP_2까지는 SOFT_CAP_RATE, 그 위는 SOFT_CAP_RATE_2만 들어간다.
 */
export const DAILY_SOFT_CAP = REF * 1.5 // 30,750

/** 첫 상한을 넘은 몫의 지급률 */
export const SOFT_CAP_RATE = 0.2

/** 두 번째 상한(들어간 합계 기준). 하루 1시간 하는 사람의 끝 무렵 하루 들어옴(약 41,300)에 맞춘다 */
export const DAILY_SOFT_CAP_2 = REF * 2 // 41,000

/** 두 번째 상한을 넘은 몫의 지급률 */
export const SOFT_CAP_RATE_2 = 0.04

/** [들어간 합계 상한, 그 구간의 지급률]. 진행 속도 검사(economyPace.test.ts)가 이 표로 계산한다 */
export const SOFT_CAP_TIERS: readonly (readonly [upTo: number, rate: number])[] = [
  [DAILY_SOFT_CAP, 1],
  [DAILY_SOFT_CAP_2, SOFT_CAP_RATE],
  [Infinity, SOFT_CAP_RATE_2],
]

const PER_MILLE = 1000
const R1 = Math.round(SOFT_CAP_RATE * PER_MILLE) // 200
const R2 = Math.round(SOFT_CAP_RATE_2 * PER_MILLE) // 40

/**
 * _gold_move와 같은 식. 줄이는 reason(world·free)의 수입 `amount`가 실제로 들어갈 양.
 * earnedToday = 오늘(KST) 이미 들어간 수입 합계(my_wallet earned_today).
 * 정수 연산(지급률은 천분율)으로 부동소수 오차 없이 마지막에 한 번 내림한다.
 */
export function softCap(amount: number, earnedToday: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  const d = Math.floor(amount)
  const s = Number.isFinite(earnedToday) ? Math.max(0, Math.floor(earnedToday)) : 0
  const full = Math.min(d, Math.max(DAILY_SOFT_CAP - s, 0))
  const d1 = d - full
  if (d1 === 0) return full
  const room2 = Math.max(DAILY_SOFT_CAP_2 - Math.max(s, DAILY_SOFT_CAP), 0)
  // 첫 구간(20%)에 다 들어가면 floor(d1 × R1 / 1000)
  if (d1 * R1 <= room2 * PER_MILLE) return full + Math.floor((d1 * R1) / PER_MILLE)
  // room2를 채우고 남은 원래 금액(d1 − room2 × 1000 / R1)의 R2
  return full + room2 + Math.floor(((d1 * R1 - room2 * PER_MILLE) * R2) / (PER_MILLE * R1))
}

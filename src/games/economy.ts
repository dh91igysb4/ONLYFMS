// 경제 상수 원본 (설계 docs/superpowers/specs/2026-11-23-wallet-design.md §4, §5.6, §12).
// 순수 모듈: React·외부 의존 없음 (Edge Function도 import할 수 있다).
// SQL이 쓰는 값은 _economy()에 사본이 있고, economy.test.ts가 마이그레이션의 마지막 정의와 비교한다.

/** 기준 시간당 수입(설계 §4). 2단계 낚싯대·마을 물가 낚시의 기대값. 2단계 PR의 src/games/fishing/gold.test.ts가 ±25%로 지킨다 */
export const REF = 20500

/** 사이트 하루 상한(설계 §5.6). world(+)·free·daily_prize의 오늘(KST) 실제 수입 합계 기준 */
export const DAILY_SOFT_CAP = REF * 1.5 // 30,750

/** 상한을 넘은 몫의 지급률 */
export const SOFT_CAP_RATE = 0.2

/**
 * _gold_move와 같은 식. 줄이는 reason(world·free)의 수입 `amount`가 실제로 들어갈 양.
 * earnedToday = 오늘(KST) 이미 들어간 수입 합계(my_wallet earned_today).
 */
export function softCap(amount: number, earnedToday: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  const d = Math.floor(amount)
  const s = Number.isFinite(earnedToday) ? Math.max(0, Math.floor(earnedToday)) : 0
  const room = Math.max(DAILY_SOFT_CAP - s, 0)
  const full = Math.min(d, room)
  // (d − full) × 0.2를 부동소수 오차 없이 내림: 정수 연산으로 계산 (rate는 0.2 = 1/5)
  return full + Math.floor(((d - full) * Math.round(SOFT_CAP_RATE * 1000)) / 1000)
}

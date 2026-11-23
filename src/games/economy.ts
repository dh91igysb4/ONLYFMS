// 경제 상수 원본 (설계 docs/superpowers/specs/2026-11-23-wallet-design.md §4, §5.6, §12).
// 순수 모듈: React·외부 의존 없음 (Edge Function도 import할 수 있다).
// SQL이 쓰는 값은 _economy()에 사본이 있고, economy.test.ts가 마이그레이션의 마지막 정의와 비교한다.

/**
 * 기준 시간당 수입(설계 §4). 2단계 낚싯대·마을 물가 낚시의 기대값(20,515).
 * 이 값을 데이터로 지키는 검사는 낚시 다듬기 PR(#81)의 src/games/fishing/gold.test.ts(±25%)에 있다 — 그 PR이 머지되기 전 계보에는 없다
 */
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

// ---------------------------------------------------------------- 자유 플레이 (설계 §7, 지갑 2단계)

/** 자유 플레이 게임별 하루 상한(설계 §7.3). 그 게임으로 하루 1시간어치, 줄기 전 금액으로 센다 */
export const FREE_DAILY_CAP = REF * 1 // 20,500

/** 기준 플레이의 판 사이 대기(초, 설계 §7.3) */
export const FREE_GAP_SEC = 5

/**
 * 낚시 장비·해금 총액 목표(설계 §4.1, 참고값). 낚시 다듬기 PR(#81)은 총액이 아니라 "하루 1시간 + 사이트 상한으로 약 30일"을
 * 시뮬레이션으로 맞췄다(총액 1,186,300 = REF × 57.9, 고급 장비가 수입을 올리므로). 진행 속도 검사는 economyPace.test.ts와
 * 다듬기 PR의 fishing/gold.test.ts가 한다
 */
export const FISHING_SINK_TARGET = REF * 40 // 820,000

/** manifest `gold` = game_modes.gold_per_point·gold_play_cap·gold_daily_cap (registry.test.ts가 비교) */
export type FreeGold = { perPoint: number; playCap: number; dailyCap: number }

/**
 * floor(score × perPoint)를 SQL numeric과 똑같이. free_plays.score는 numeric(9,2), gold_per_point는 numeric(10,4)이라
 * 정수(점수 ×100, perPoint ×10,000)로 곱해 부동소수 오차(0.29 × 100 = 28.999…)를 피한다.
 */
function scoreGold(score: number, perPoint: number): number {
  return Math.floor((Math.round(score * 100) * Math.round(perPoint * 10000)) / 1_000_000)
}

/**
 * 서버와 같은 순서로 이번 판 골드를 미리 계산한다: 트리거(least(floor(score × perPoint), playCap) → 게임별 남은 몫)
 * → _gold_move(softCap). gameAskedToday = 오늘 이 게임 줄기 전 합계(my_wallet today[game]),
 * siteEarnedToday = my_wallet earned_today. asked = 사이트 상한 전 금액, got = 실제 들어갈 금액. 모두 0 이상 정수.
 */
export function freeGold(
  score: number,
  g: FreeGold | undefined,
  gameAskedToday: number,
  siteEarnedToday: number,
): { asked: number; got: number } {
  if (!g || !Number.isFinite(score) || score <= 0) return { asked: 0, got: 0 }
  const perPlay = Math.min(scoreGold(score, g.perPoint), g.playCap)
  const used = Number.isFinite(gameAskedToday) ? Math.max(0, gameAskedToday) : 0
  const asked = Math.max(0, Math.min(perPlay, g.dailyCap - used))
  return { asked, got: softCap(asked, siteEarnedToday) }
}

/** 기준 플레이의 시간당 골드(설계 §7.3): 3600 / (playSec + FREE_GAP_SEC) × floor(avgScore × perPoint) */
export function hourlyGold(avgScore: number, playSec: number, perPoint: number): number {
  return (3600 / (playSec + FREE_GAP_SEC)) * scoreGold(avgScore, perPoint)
}

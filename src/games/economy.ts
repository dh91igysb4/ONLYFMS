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

/**
 * 미니게임(자유 플레이) 기준 시간당 수입(설계 §7.3, 2026-11-24 개정). 기준 플레이로 쉬지 않고 했을 때 보너스 없이 버는 양.
 * 처음에는 REF와 같았지만 운영에서 미니게임 수입이 너무 커서 1/4로 줄였다. 도전과제 보너스(최대 ×5)를 다 받으면 REF × 1.25.
 */
export const FREE_REF = REF / 4 // 5,125

/** 자유 플레이 게임별 하루 상한(설계 §7.3). 그 게임으로 하루 1시간어치(FREE_REF), 줄기 전 금액으로 센다 */
export const FREE_DAILY_CAP = FREE_REF * 1 // 5,125

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
 * 도전과제 보너스 상한(%, 지갑 설계 §7.5). 지속형 게임이 game_records `free_bonus`에 쓴 값의 합을 이만큼에서 자른다.
 * 400 = ×5(낚시 도전과제 열 개). SQL 사본 _economy()->'free_bonus_max_pct'
 */
export const FREE_BONUS_MAX_PCT = 400

/** 보너스 %를 상한 안의 0 이상 정수로 (_free_bonus_pct와 같다) */
export function clampBonusPct(pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0
  return Math.min(Math.floor(pct), FREE_BONUS_MAX_PCT)
}

/** floor(n × (100 + pct) / 100) — 트리거 _free_plays_gold와 같은 정수 연산 */
export function withBonus(n: number, pct: number): number {
  return Math.floor((Math.floor(n) * (100 + clampBonusPct(pct))) / 100)
}

/**
 * 서버와 같은 순서로 이번 판 골드를 미리 계산한다: 트리거(least(floor(score × perPoint), playCap) × 보너스 → 게임별 남은 몫,
 * 하루 상한도 × 보너스) → _gold_move(softCap). gameAskedToday = 오늘 이 게임 줄기 전 합계(my_wallet today[game]),
 * siteEarnedToday = my_wallet earned_today, bonusPct = my_wallet free_bonus_pct(도전과제 보너스, 0이면 없음).
 * asked = 사이트 상한 전 금액, got = 실제 들어갈 금액. 모두 0 이상 정수. 사이트 하루 상한은 보너스와 무관하게 그대로다.
 */
export function freeGold(
  score: number,
  g: FreeGold | undefined,
  gameAskedToday: number,
  siteEarnedToday: number,
  bonusPct = 0,
): { asked: number; got: number } {
  if (!g || !Number.isFinite(score) || score <= 0) return { asked: 0, got: 0 }
  const perPlay = withBonus(Math.min(scoreGold(score, g.perPoint), g.playCap), bonusPct)
  const used = Number.isFinite(gameAskedToday) ? Math.max(0, gameAskedToday) : 0
  const asked = Math.max(0, Math.min(perPlay, withBonus(g.dailyCap, bonusPct) - used))
  return { asked, got: softCap(asked, siteEarnedToday) }
}

/** 기준 플레이의 시간당 골드(설계 §7.3): 3600 / (playSec + FREE_GAP_SEC) × floor(avgScore × perPoint) */
export function hourlyGold(avgScore: number, playSec: number, perPoint: number): number {
  return (3600 / (playSec + FREE_GAP_SEC)) * scoreGold(avgScore, perPoint)
}

// ---------------------------------------------------------------- 데일리 상금·판돈·참가비 (설계 §8.1, §9, §10, 지갑 3단계)

/** 데일리 상금 비율(설계 §8.1, 2026-11-24 개정). 6등 이하는 마지막 값 */
export const DAILY_PRIZE_RATES = [0.3, 0.25, 0.2, 0.15, 0.12, 0.1] as const

/** REF × 비율을 10 단위 내림: [6150, 5120, 4100, 3070, 2460, 2050]. SQL 사본 _economy()->'daily_prizes' */
export const DAILY_PRIZES: readonly number[] = DAILY_PRIZE_RATES.map((r) => Math.floor(Math.round(REF * r * 100) / 1000) * 10)

/** k등(1부터, 행동을 한 사람끼리 다시 센 등수) 상금. 정수가 아니거나 1 미만이면 0 */
export function dailyPrize(rank: number): number {
  if (!Number.isInteger(rank) || rank < 1) return 0
  return DAILY_PRIZES[Math.min(rank, DAILY_PRIZES.length) - 1]
}

/** 데일리 게임이 n개일 때 모든 데일리 1등 합계가 REF 이하인가(설계 §8.1: 넘으면 상금 표를 줄인다) */
export function dailyBudgetOk(n: number): boolean {
  return n * DAILY_PRIZES[0] <= REF
}

/** 대전 판돈 상한(설계 §9). 사람 사이에서 옮기는 돈이라 인플레이션과 무관 */
export const STAKE_MAX = REF * 2 // 41,000

/** 대회 참가비 상한(설계 §10) */
export const FEE_MAX = REF * 2 // 41,000

// 낚시 미니게임 물리. 순수 함수만: DOM·시계·Math.random 없이 난수는 rng 인자, 시간은 dtMs로만 받는다.
// 위치는 모두 0~1(트랙 아래 = 0).
import { RODS, SPECIES } from './data.ts'

export const MAX_DT_MS = 50

export type Bar = {
  barPos: number // 바 중심
  barVel: number // 초당 트랙 길이 단위
  fishPos: number
  fishTarget: number
  progress: number
  perfect: boolean
  t: number // 누적 경과 ms(MAX_DT_MS로 자른 값)
}
export type BarParams = { barSize: number; difficulty: number }

const BASE_BAR_SIZE = 0.22
const BAR_ACCEL_UP = 8 // 누르는 동안 위로 가속 (1/s²)
const BAR_ACCEL_DOWN = 6.5 // 놓으면 아래로 가속
const BAR_DRAG = 8 // 속도 감쇠(1/s), 살짝 둥둥 뜨는 느낌
const FISH_SPEED_MIN = 0.22 // 물고기 최대 이동 속도(1/s), difficulty 0 → 1에서 선형
const FISH_SPEED_MAX = 1.0
const RETARGET_RATE_MIN = 0.5 // 초당 목표 변경 확률 밀도
const RETARGET_RATE_MAX = 2.5
const PROGRESS_UP = 0.35 // 초당 진행 증가
const PROGRESS_DOWN = 0.3 // 초당 진행 감소
const GAUGE_PERIOD_MS = 1600

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

export function barParams(speciesId: string, rodTier: 1 | 2 | 3 | 4): BarParams {
  const species = SPECIES.find((s) => s.id === speciesId)
  const rod = RODS.find((r) => r.tier === rodTier)
  if (!species) throw new Error(`unknown species: ${speciesId}`)
  if (!rod) throw new Error(`unknown rod tier: ${rodTier}`)
  return { barSize: BASE_BAR_SIZE * (1 + rod.barBonus), difficulty: species.difficulty }
}

export function initBar(): Bar {
  return { barPos: 0.5, barVel: 0, fishPos: 0.5, fishTarget: 0.5, progress: 0.3, perfect: true, t: 0 }
}

export function stepBar(bar: Bar, held: boolean, dtMs: number, params: BarParams, rng: () => number): Bar {
  const clampedMs = Math.min(Math.max(dtMs, 0), MAX_DT_MS)
  const dt = clampedMs / 1000

  // 바: 가속도 + 감쇠, 양 끝에서 속도 0
  const lo = params.barSize / 2
  const hi = 1 - params.barSize / 2
  let barVel = (bar.barVel + (held ? BAR_ACCEL_UP : -BAR_ACCEL_DOWN) * dt) * Math.exp(-BAR_DRAG * dt)
  let barPos = bar.barPos + barVel * dt
  if (barPos <= lo) {
    barPos = lo
    barVel = 0
  } else if (barPos >= hi) {
    barPos = hi
    barVel = 0
  }

  // 물고기: 목표를 향해 이동, 가끔(어려울수록 자주) 새 목표
  const d = clamp01(params.difficulty)
  let fishTarget = bar.fishTarget
  const retargetRate = RETARGET_RATE_MIN + (RETARGET_RATE_MAX - RETARGET_RATE_MIN) * d
  if (rng() < 1 - Math.exp(-retargetRate * dt)) fishTarget = rng()
  const maxStep = (FISH_SPEED_MIN + (FISH_SPEED_MAX - FISH_SPEED_MIN) * d) * dt
  const gap = fishTarget - bar.fishPos
  let fishPos = Math.abs(gap) <= maxStep ? fishTarget : bar.fishPos + Math.sign(gap) * maxStep
  fishPos = clamp01(fishPos)
  if (fishPos === fishTarget && clampedMs > 0 && rng() < 0.5) fishTarget = rng() // 도착하면 곧 다시 움직인다

  // 진행도
  const inside = Math.abs(fishPos - barPos) <= params.barSize / 2
  const progress = clamp01(bar.progress + (inside ? PROGRESS_UP : -PROGRESS_DOWN) * dt)

  return { barPos, barVel, fishPos, fishTarget, progress, perfect: bar.perfect && inside, t: bar.t + clampedMs }
}

export function barResult(bar: Bar): 'playing' | 'caught' | 'lost' {
  if (bar.progress >= 1) return 'caught'
  if (bar.progress <= 0) return 'lost'
  return 'playing'
}

// 캐스팅 게이지: 0 → 1 → 0 삼각파
export function gaugeAt(tMs: number): number {
  const phase = (((tMs % GAUGE_PERIOD_MS) + GAUGE_PERIOD_MS) % GAUGE_PERIOD_MS) / GAUGE_PERIOD_MS
  return phase < 0.5 ? phase * 2 : 2 - phase * 2
}

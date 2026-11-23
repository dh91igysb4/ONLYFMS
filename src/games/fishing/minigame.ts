// 낚시 미니게임 물리. 순수 함수만: DOM·시계·Math.random 없이 난수는 rng 인자, 시간은 dtMs로만 받는다.
// 위치는 모두 0~1(트랙 아래 = 0).
import { RODS, SPECIES, TACKLE_FX, type Behavior, type RodTier, type TackleId } from './data.ts'

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
export type BarParams = {
  barSize: number
  difficulty: number
  behavior: Behavior
  drain: number // 물고기가 바 밖일 때 진행도 감소 배율(기본 1, trap 0.75)
  pull: number // 물고기가 바 안일 때 바를 물고기 쪽으로 끄는 세기(기본 0, barbed는 BARBED_PULL)
}

const BASE_BAR_SIZE = 0.22
const BAR_ACCEL_UP = 8 // 누르는 동안 위로 가속 (1/s²)
const BAR_ACCEL_DOWN = 6.5 // 놓으면 아래로 가속
const BAR_DRAG = 8 // 속도 감쇠(1/s), 살짝 둥둥 뜨는 느낌
const FISH_SPEED_MIN = 0.22 // 물고기 최대 이동 속도(1/s), difficulty 0 → 1에서 선형
const FISH_SPEED_MAX = 1.0
const RETARGET_RATE_MIN = 0.5 // 초당 목표 변경 확률 밀도
const RETARGET_RATE_MAX = 2.5
const SMOOTH_RETARGET_SCALE = 0.4 // smooth: 목표 변경 빈도 배율(절반 이하)
const SMOOTH_ARRIVE_RETARGET = 0.1 // smooth: 도착 직후 바로 다시 움직일 확률
const SMOOTH_GAIN = 4 // smooth: 목표까지 남은 거리 비례 속도(1/s), 가까울수록 느려진다
const SMOOTH_SNAP = 0.005
const DART_RETARGET_SCALE = 2.5 // dart: 목표 변경 빈도 배율
const DART_SPEED_SCALE = 1.5
const DART_MIN_JUMP = 0.4 // dart: 새 목표는 현재 위치에서 이만큼 이상 떨어진 곳
const FLOATER_MIN = 0.55 // floater: 새 목표 범위 0.55~1
// sinker: 새 목표는 손을 놓아 바닥에 붙은 바 바로 위(barSize + GAP ~ + GAP + SPAN). 트랙 아래쪽에 머물지만
// 쉬는 바에는 들어오지 않아, 살살 눌러 받쳐야 잡힌다(예전에는 0~0.45라 안 눌러도 잡혔다).
const SINKER_GAP = 0.03
// mixed·smooth·dart: 새 목표의 바닥 = 바 크기 × FLOOR_FRAC. 바닥에 붙은 바 깊숙이 머물지 않아 안 눌러도 잡히지 않는다
// (큰 바 0.41에서 예전에는 smooth 46%·mixed 30%·dart 12%가 안 눌러 잡혔다, minigame.test)
const FLOOR_FRAC = 0.8
const SINKER_SPAN = 0.27
// 가시 바늘: 바 중심과 물고기 거리(가속 = 거리 × pull, 1/s²). 70이면 바 가장자리(거리 0.1)에서
// 가속 약 7로 중력(6.5)·누르기(8)와 맞먹는다. 안에 든 물고기에 바가 눈에 띄게 달라붙지만,
// 손을 떼면 바는 여전히 천천히 가라앉고, 빠른 dart 물고기는 안 눌러도 빠져나간다.
export const BARBED_PULL = 70
const PROGRESS_UP = 0.35 // 초당 진행 증가
const PROGRESS_DOWN = 0.3 // 초당 진행 감소
const GAUGE_PERIOD_MS = 1600

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** 더 새 서버가 준 모르는 어종이면 이 값으로 싸운다(화면이 죽지 않게) */
const NEUTRAL_FISH = { difficulty: 0.5, behavior: 'mixed' as const }

export function barParams(speciesId: string, rodTier: RodTier, equipped: readonly TackleId[] = []): BarParams {
  const fish = SPECIES.find((s) => s.id === speciesId) ?? NEUTRAL_FISH
  // 모르는 낚싯대 단계는 보너스 없는 기본 바
  const barBonus = RODS.find((r) => r.tier === rodTier)?.barBonus ?? 0
  return {
    barSize: BASE_BAR_SIZE * (1 + barBonus) * (equipped.includes('cork') ? TACKLE_FX.corkBar : 1),
    difficulty: fish.difficulty,
    behavior: fish.behavior,
    drain: equipped.includes('trap') ? TACKLE_FX.trapDrain : 1,
    pull: equipped.includes('barbed') ? BARBED_PULL : 0,
  }
}

// 유형별 새 목표. rng는 한 번만 부른다(mixed는 예전과 같은 난수열).
function pickTarget(behavior: Behavior, fishPos: number, barSize: number, rng: () => number): number {
  const r = rng()
  // 손을 놓아 바닥에 붙은 바가 덮는 칸([0, barSize])보다 깊이(FLOOR_FRAC) 내려가지 않는다. 안 눌러도 잡히는 일을 막는다
  const floor = barSize * FLOOR_FRAC
  switch (behavior) {
    case 'floater':
      return FLOATER_MIN + (1 - FLOATER_MIN) * r
    case 'sinker':
      return Math.min(1, barSize + SINKER_GAP + SINKER_SPAN * r)
    case 'dart': {
      // 현재 위치에서 DART_MIN_JUMP 이상 떨어진 아래·위 구간(바닥 floor 위)을 이어 붙여 고른다
      const below = Math.max(0, fishPos - DART_MIN_JUMP - floor)
      const aboveLen = Math.max(0, 1 - Math.max(floor, fishPos + DART_MIN_JUMP))
      const total = below + aboveLen
      if (total <= 0) return floor + (1 - floor) * r
      const x = r * total
      return x < below ? floor + x : Math.max(floor, fishPos + DART_MIN_JUMP) + (x - below)
    }
    default:
      return floor + (1 - floor) * r
  }
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
  const wasInside = Math.abs(bar.fishPos - bar.barPos) <= params.barSize / 2
  const pullAccel = params.pull > 0 && wasInside ? (bar.fishPos - bar.barPos) * params.pull : 0
  let barVel = (bar.barVel + ((held ? BAR_ACCEL_UP : -BAR_ACCEL_DOWN) + pullAccel) * dt) * Math.exp(-BAR_DRAG * dt)
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
  const behavior = params.behavior
  let fishTarget = bar.fishTarget
  const retargetScale = behavior === 'smooth' ? SMOOTH_RETARGET_SCALE : behavior === 'dart' ? DART_RETARGET_SCALE : 1
  const retargetRate = (RETARGET_RATE_MIN + (RETARGET_RATE_MAX - RETARGET_RATE_MIN) * d) * retargetScale
  if (rng() < 1 - Math.exp(-retargetRate * dt)) fishTarget = pickTarget(behavior, bar.fishPos, params.barSize, rng)
  const speedScale = behavior === 'dart' ? DART_SPEED_SCALE : 1
  const maxStep = (FISH_SPEED_MIN + (FISH_SPEED_MAX - FISH_SPEED_MIN) * d) * speedScale * dt
  const gap = fishTarget - bar.fishPos
  // smooth는 남은 거리에 비례해 감속하며 다가간다
  const step = behavior === 'smooth' ? Math.min(maxStep, Math.abs(gap) * SMOOTH_GAIN * dt) : maxStep
  const snap = behavior === 'smooth' ? SMOOTH_SNAP : 0
  let fishPos = Math.abs(gap) <= Math.max(step, snap) ? fishTarget : bar.fishPos + Math.sign(gap) * step
  fishPos = clamp01(fishPos)
  const arriveRetarget = behavior === 'smooth' ? SMOOTH_ARRIVE_RETARGET : 0.5
  if (fishPos === fishTarget && clampedMs > 0 && rng() < arriveRetarget) fishTarget = pickTarget(behavior, fishPos, params.barSize, rng) // 도착하면 곧 다시 움직인다

  // 진행도
  const inside = Math.abs(fishPos - barPos) <= params.barSize / 2
  const progress = clamp01(bar.progress + (inside ? PROGRESS_UP : -PROGRESS_DOWN * params.drain) * dt)

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

// 레이스 세션 (레이싱 설계 §5.4, §6.3): 고정 60Hz 틱, 카운트다운, 진행도·체크포인트, 복귀, 도착.
// 기록은 출발 뒤 물리 틱 수다. 밀린 시간(탭 숨김)은 한 번에 몰아서 돌린다.
import { FALL_Y, STUCK_SECONDS, TICK_HZ } from './constants.ts'
import { arcLength, getCourse, progressAt } from './course/index.ts'
import { tangentAt } from './course/road.ts'
import type { Course } from './course/types.ts'
import { NITRO_START, stepNitro, type Nitro } from './nitro.ts'
import { carState, createCar, resetCar, stepCar, type Car, type CarState } from './physics/car.ts'
import { NO_CONTROLS, type Controls } from './physics/controls.ts'
import type { Rapier } from './physics/rapier.ts'
import { createWorld, type PhysWorld } from './physics/world.ts'
import { AIR_IDLE, trackAir, type AirTrack } from './stunt.ts'

/** 3·2·1 (틱) */
export const COUNTDOWN_TICKS = 3 * TICK_HZ
const DT = 1 / TICK_HZ
const STUCK_TICKS = STUCK_SECONDS * TICK_HZ
/** 드리프트로 볼 미끄러짐 각 (도) */
const DRIFT_SLIP_DEG = 10

export type RaceSnapshot = {
  /** 출발 뒤 틱. 카운트다운 중 음수, 도착 뒤 finishTicks에서 멈춘다 */
  tick: number
  countdown: number | null
  car: CarState
  nitro: Nitro
  /** 0..1 */
  progress: number
  finishTicks: number | null
  lastLanding: null | { flips: number; clean: boolean; tick: number }
}

export type Race = {
  pw: PhysWorld
  course: Course
  car: Car
  /** 만든 뒤 흐른 틱(카운트다운 포함) */
  elapsed: number
  /** 틱 단위 누적기 */
  acc: number
  nitro: Nitro
  air: AirTrack
  progressIndex: number
  lastCheckpoint: number
  stuck: number
  resetRequested: boolean
  finishTicks: number | null
  lastLanding: RaceSnapshot['lastLanding']
}

function poseAt(c: Course, i: number) {
  const p = c.centerline[i]
  const t = tangentAt(c, i)
  return { pos: { x: p.x, y: p.y + 1.2, z: p.z }, yaw: Math.atan2(t.x, t.z) }
}

export function createRace(R: Rapier, course: string | Course): Race {
  const c = typeof course === 'string' ? getCourse(course) : course
  const pw = createWorld(R, c)
  const car = createCar(pw, c.start)
  return {
    pw, course: c, car, elapsed: 0, acc: 0, nitro: NITRO_START, air: AIR_IDLE,
    progressIndex: 0, lastCheckpoint: 0, stuck: 0, resetRequested: false, finishTicks: null, lastLanding: null,
  }
}

export function requestReset(race: Race): void {
  race.resetRequested = true
}

function respawn(race: Race): void {
  resetCar(race.car, poseAt(race.course, race.lastCheckpoint))
  race.progressIndex = race.lastCheckpoint
  race.air = AIR_IDLE
  race.stuck = 0
}

function finite(s: CarState): boolean {
  return [s.pos.x, s.pos.y, s.pos.z, s.vel.x, s.vel.y, s.vel.z, s.quat.w].every(Number.isFinite)
}

function step(race: Race, input: Controls): void {
  const started = race.elapsed >= COUNTDOWN_TICKS
  const done = race.finishTicks !== null
  if (race.resetRequested && started && !done) {
    race.resetRequested = false
    respawn(race)
  }
  // 카운트다운 중에는 묶어 두고, 도착 뒤에는 서서히 멈춘다
  const c: Controls = !started ? NO_CONTROLS : done ? { ...NO_CONTROLS, brake: 0.5 } : input
  const before = carState(race.car)
  const airborne = !before.grounded
  const drifting = c.handbrake && before.grounded && before.slipDeg > DRIFT_SLIP_DEG
  race.nitro = stepNitro(race.nitro, { want: c.nitro, airborne, drifting, landed: null }, DT)
  stepCar(race.car, c, race.nitro.burning, DT)
  race.pw.world.step()
  race.elapsed++

  let s = carState(race.car)
  if (!finite(s) || s.pos.y < FALL_Y) {
    respawn(race)
    s = carState(race.car)
  }
  const a = trackAir(race.air, { grounded: s.grounded, localAngVel: s.localAngVel, upY: s.up.y }, DT)
  race.air = a.track
  if (a.landed) {
    race.nitro = stepNitro(race.nitro, { want: false, airborne: false, drifting: false, landed: a.landed }, 0)
    race.lastLanding = { flips: a.landed.flips, clean: a.landed.clean, tick: race.elapsed - COUNTDOWN_TICKS }
  }
  if (!started || done) return

  const p = progressAt(race.course, s.pos, race.progressIndex)
  race.progressIndex = p.index
  for (const cp of race.course.checkpoints) if (cp <= p.index && cp > race.lastCheckpoint) race.lastCheckpoint = cp
  if (p.index >= race.course.finish) {
    race.finishTicks = race.elapsed - COUNTDOWN_TICKS
    return
  }
  // 뒤집힌 채 멈춤
  const still = Math.hypot(s.vel.x, s.vel.y, s.vel.z) < 2
  race.stuck = s.up.y < 0.5 && still ? race.stuck + 1 : 0
  if (race.stuck >= STUCK_TICKS) respawn(race)
}

/** ms만큼 시간을 흘린다. 1/60초마다 한 틱. */
export function advance(race: Race, ms: number, controls: Controls): void {
  race.acc += (ms * TICK_HZ) / 1000
  while (race.acc >= 1 - 1e-6) {
    race.acc -= 1
    step(race, controls)
  }
}

export function snapshot(race: Race): RaceSnapshot {
  const rem = COUNTDOWN_TICKS - race.elapsed
  const s = arcLength(race.course)
  const progress = race.finishTicks !== null ? 1 : Math.min(1, s[race.progressIndex] / s[race.course.finish])
  return {
    tick: race.finishTicks ?? race.elapsed - COUNTDOWN_TICKS,
    countdown: rem > 0 ? Math.ceil(rem / TICK_HZ) : null,
    car: carState(race.car),
    nitro: race.nitro,
    progress,
    finishTicks: race.finishTicks,
    lastLanding: race.lastLanding,
  }
}

export function disposeRace(race: Race): void {
  race.pw.world.free()
}

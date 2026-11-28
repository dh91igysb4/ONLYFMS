// 레이스 세션 (레이싱 설계 §5.4, §6.3): 고정 60Hz 틱, 카운트다운, 진행도·체크포인트, 복귀, 도착.
// 기록은 출발 뒤 물리 틱 수다. advance는 받은 시간을 모두 틱으로 돌린다. 연습 화면(RacerGame)은 프레임당 250ms까지만
// 넘겨서 탭을 숨기면 레이스가 멈춘다. 2단계 대국 화면은 서버 시각 기준 경과로 따라잡아야 한다(설계 §6.3, 2단계 차단 사항).
import { FALL_Y, STUCK_SECONDS, TICK_HZ } from './constants.ts'
import { arcLength, getCourse, progressAt } from './course/index.ts'
import { tangentAt } from './course/road.ts'
import type { Course } from './course/types.ts'
import { NITRO_START, stepNitro, type Nitro } from './nitro.ts'
import { carState, createCar, resetCar, stepCar, type Car, type CarState } from './physics/car.ts'
import { NO_CONTROLS, type Controls } from './physics/controls.ts'
import type { Rapier } from './physics/rapier.ts'
import { createWorld, type PhysWorld } from './physics/world.ts'

/** 3·2·1 (틱) */
export const COUNTDOWN_TICKS = 3 * TICK_HZ
const DT = 1 / TICK_HZ
const STUCK_TICKS = STUCK_SECONDS * TICK_HZ

export type Pose = { pos: { x: number; y: number; z: number }; quat: { x: number; y: number; z: number; w: number } }

export type RaceSnapshot = {
  /** 출발 뒤 틱. 카운트다운 중 음수, 도착 뒤 finishTicks에서 멈춘다 */
  tick: number
  countdown: number | null
  car: CarState
  /** 직전 틱의 자세(그리기 보간용). 복귀 직후에는 새 자세와 같다 */
  prev: Pose
  nitro: Nitro
  /** 0..1 */
  progress: number
  finishTicks: number | null
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
  progressIndex: number
  lastCheckpoint: number
  stuck: number
  resetRequested: boolean
  finishTicks: number | null
  /** 직전 틱 자세 */
  prevPose: Pose
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
  const s0 = carState(car)
  return {
    prevPose: { pos: s0.pos, quat: s0.quat },
    pw, course: c, car, elapsed: 0, acc: 0, nitro: NITRO_START,
    progressIndex: 0, lastCheckpoint: 0, stuck: 0, resetRequested: false, finishTicks: null,
  }
}

export function requestReset(race: Race): void {
  race.resetRequested = true
}

function respawn(race: Race): void {
  resetCar(race.car, poseAt(race.course, race.lastCheckpoint))
  race.progressIndex = race.lastCheckpoint
  race.stuck = 0
  const s = carState(race.car)
  race.prevPose = { pos: s.pos, quat: s.quat }
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
  race.prevPose = { pos: before.pos, quat: before.quat }
  // 니트로는 출발 뒤부터만 쓰고 차오른다(자동 충전 대기는 출발 순간부터 센다)
  if (started && !done) race.nitro = stepNitro(race.nitro, c.nitro, DT)
  else race.nitro = { ...race.nitro, burning: false }
  stepCar(race.car, c, race.nitro.burning, DT)
  race.pw.world.step()
  race.elapsed++

  let s = carState(race.car)
  if (!finite(s) || s.pos.y < FALL_Y) {
    respawn(race)
    s = carState(race.car)
  }
  if (!started || done) return

  const p = progressAt(race.course, s.pos, race.progressIndex)
  // 전체 검색 결과(코스의 먼 곳)는 그 도로 위에 접지했을 때만 받는다. 떨어지는 중에 다른 구간 옆을 지나면
  // 진행도·체크포인트·도착이 앞으로 뛰어 코스 대부분을 건너뛴다(최종 리뷰 Important #1).
  const trusted = !p.global || (s.grounded && p.dist <= race.course.width[p.index])
  if (trusted) {
    race.progressIndex = p.index
    for (const cp of race.course.checkpoints) if (cp <= p.index && cp > race.lastCheckpoint) race.lastCheckpoint = cp
    if (p.index >= race.course.finish) {
      race.finishTicks = race.elapsed - COUNTDOWN_TICKS
      return
    }
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
    prev: race.prevPose,
    nitro: race.nitro,
    progress,
    finishTicks: race.finishTicks,
  }
}

export function disposeRace(race: Race): void {
  race.pw.world.free()
}

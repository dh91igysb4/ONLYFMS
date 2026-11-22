// 통과 게이트용 봇 (설계 §2, §8). 템플릿(들)을 이은 코스에서 앞 구간들을 살아서 넘는 누름 열을 찾는다.
// 순수 정수 TS. 무작위 없음: 탐색 순서와 동점 처리가 고정이라 결과가 늘 같다.
// 아래 수치는 시험 도구의 탐색 설정이다(게임 조정 수치가 아니다). 통과 규칙은 constants.ts의 PASS_AFTER_TICKS.
import { BOOST_V, MM, PASS_AFTER_TICKS, V_MAX, WHEEL_R } from './constants.ts'
import { courseOf } from './course.ts'
import type { Course } from './course.ts'
import { initSimAt, step } from './sim.ts'
import type { SimState } from './sim.ts'
import { atan2T, isqrt } from './trig.ts'

export type Entry = 'rest' | 'fast' // rest: 구간 시작점에 정지 / fast: V_MAX와 BOOST_V 양쪽으로 진입
/** bestX: 못 찾았을 때 차 중심이 간 가장 먼 곳(첫 구간 시작 기준, mm). */
export type PassResult = { ok: true; holds: boolean[] } | { ok: false; bestX: number }

const DECIDE_TICKS = 6 // 누름/뗌을 다시 정하는 간격
const STEP_BUDGET = 300000 // 넘어야 할 구간 하나당 sim 틱 상한
const BEAMS: readonly number[] = [8, 64, 400] // 차례로 넓히는 빔 폭
const POLICY_TICKS = 1500 // 정해진 입력으로 굴려 볼 때의 틱 상한(멈춰 버리는 경우)
// 중복 제거용 상태 양자화 폭.
const Q_POS = 40 * MM
const Q_VEL = 60
const Q_ANG = 48

/** 템플릿들을 차례로(끝나면 반복) 이은 코스와 첫 구간 시작에서 수평 속도 vx로 놓인 차. */
function setup(ids: readonly string[], vx: number): { course: Course; startX: number; s: SimState } {
  const course = courseOf(ids)
  const startX = course.section(0).startX
  return { course, startX, s: initSimAt(course, startX + WHEEL_R, vx) }
}

function centerX(s: SimState): number {
  return Math.floor((s.rear.x + s.front.x) / 2)
}

type Node = { s: SimState; holds: boolean[]; cross: number | null }

function keyOf(n: Node): string {
  const s = n.s
  const q = (v: number, d: number): number => Math.floor(v / d)
  return [
    q(s.rear.x, Q_POS), q(s.rear.y, Q_POS), q(s.front.x, Q_POS), q(s.front.y, Q_POS),
    q(s.rear.x - s.rear.px, Q_VEL), q(s.rear.y - s.rear.py, Q_VEL), q(s.front.x - s.front.px, Q_VEL), q(s.front.y - s.front.py, Q_VEL),
    q(atan2T(s.front.y - s.rear.y, s.front.x - s.rear.x), Q_ANG),
    s.rear.ground ? 1 : 0, s.front.ground ? 1 : 0, n.cross === null ? 0 : 1,
  ].join(',')
}

/**
 * ids 템플릿을 이은 코스의 앞 ids.length개 구간을 모두 넘는 누름 열을 빔 탐색으로 찾는다.
 * 넘었다 = 차 중심이 마지막 구간의 endX를 산 채로 넘고, PASS_AFTER_TICKS 뒤에도 살아 있다.
 */
export function findPassCourse(ids: readonly string[], vx: number): PassResult {
  const { course, startX, s } = setup(ids, vx)
  const endX = course.section(ids.length - 1).endX
  let budget = STEP_BUDGET * ids.length
  let best = 0
  for (const width of BEAMS) {
    let beam: Node[] = [{ s, holds: [], cross: null }]
    while (beam.length > 0 && budget > 0) {
      const next: Node[] = []
      const seen = new Set<string>()
      for (const n of beam) {
        for (const hold of [true, false]) {
          let c = n.s
          let cross = n.cross
          const holds = n.holds.slice()
          let done = false
          for (let t = 0; t < DECIDE_TICKS; t++) {
            c = step(c, hold, course)
            holds.push(hold)
            budget--
            if (c.dead) break
            if (cross === null && centerX(c) > endX) cross = c.tick
            if (cross !== null && c.tick >= cross + PASS_AFTER_TICKS) {
              done = true
              break
            }
          }
          best = Math.max(best, centerX(c) - startX)
          if (c.dead) continue
          if (done) return { ok: true, holds }
          const child = { s: c, holds, cross }
          const k = keyOf(child)
          if (seen.has(k)) continue
          seen.add(k)
          next.push(child)
        }
      }
      // 진행 번호가 큰 순, 같으면 차 중심 x가 큰 순. 정렬은 안정적이라 동점은 생성 순서(누름 먼저)를 따른다.
      next.sort((a, b) => b.s.progress - a.s.progress || centerX(b.s) - centerX(a.s))
      beam = next.slice(0, width)
    }
    if (budget <= 0) break
  }
  return { ok: false, bestX: Math.floor(best / MM) }
}

/** 템플릿 하나(반복 코스)의 첫 구간을 수평 진입 속도 vx(u/틱)로 넘는 누름 열. */
export function findPassFrom(templateId: string, vx: number): PassResult {
  return findPassCourse([templateId], vx)
}

/** rest는 정지 진입, fast는 V_MAX와 BOOST_V 진입이 모두 통과해야 한다(누름 열은 V_MAX 쪽). 게이트 전체는 속도를 훑는다(balance.test). */
export function findPass(templateId: string, entry: Entry): PassResult {
  if (entry === 'rest') return findPassFrom(templateId, 0)
  const a = findPassFrom(templateId, V_MAX)
  if (!a.ok) return a
  const b = findPassFrom(templateId, BOOST_V)
  return b.ok ? a : b
}

/**
 * maxX: 차 중심이 간 가장 먼 곳(구간 시작 기준, mm).
 * exitV·exitGrounded: 차 중심이 구간 끝(= 다음 구간의 시작 평지 시작)을 넘은 틱의 중심 속력(u/틱)과 두 바퀴 접지 여부. 못 넘으면 0·false.
 */
export type RunResult = { passed: boolean; dead: SimState['dead']; ticks: number; maxX: number; gems: number; exitV: number; exitGrounded: boolean }

/** 정해진 입력(틱 → 누름)으로 템플릿 하나의 첫 구간을 굴려 본다. holds 배열이면 끝난 뒤는 뗌. */
export function runPolicy(templateId: string, vx: number, policy: boolean[] | ((tick: number) => boolean)): RunResult {
  const { course, startX, s: s0 } = setup([templateId], vx)
  const endX = course.section(0).endX
  let s = s0
  let cross: number | null = null
  let maxX = 0
  let exitV = 0
  let exitGrounded = false
  const result = (passed: boolean): RunResult => ({ passed, dead: s.dead, ticks: s.tick, maxX: Math.floor(maxX / MM), gems: s.gems, exitV, exitGrounded })
  for (let t = 0; t < POLICY_TICKS; t++) {
    const hold = typeof policy === 'function' ? policy(t) : t < policy.length && policy[t]
    s = step(s, hold, course)
    maxX = Math.max(maxX, centerX(s) - startX)
    if (s.dead) return result(false)
    if (cross === null && centerX(s) > endX) {
      cross = s.tick
      const vx2 = s.rear.x - s.rear.px + s.front.x - s.front.px
      const vy2 = s.rear.y - s.rear.py + s.front.y - s.front.py
      exitV = Math.floor(isqrt(vx2 * vx2 + vy2 * vy2) / 2)
      exitGrounded = s.rear.ground && s.front.ground
    }
    if (cross !== null && s.tick >= cross + PASS_AFTER_TICKS) return result(true)
  }
  return result(false)
}

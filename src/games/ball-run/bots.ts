// 밸런스 테스트용 앞을 내다보는 봇(설계 §7). step만 써서 후보 입력을 복제 상태로 미리 돌려 본다.
// 시뮬 내부 상태를 직접 바꾸지 않는다. 외부 의존 없음.
import { COL_MAX, COL_MIN } from './constants.ts'
import type { Course } from './course.ts'
import { initSim, step } from './sim.ts'
import type { SimState } from './sim.ts'

const DECIDE_EVERY = 6
const STAGE_A = 30
const STAGE_B = 60
const HORIZON = STAGE_A + STAGE_B

// target을 n틱 유지했을 때 끝 상태와 살아남은 틱 수. step은 새 객체를 돌려주므로 s는 그대로다.
function hold(s: SimState, target: number, n: number, course: Course): { end: SimState; alive: number } {
  let cur = s
  for (let i = 0; i < n; i++) {
    const next = step(cur, target, course)
    if (next.dead !== null) return { end: next, alive: i }
    cur = next
  }
  return { end: cur, alive: n }
}

// |목표|가 작은 순, 같으면 값이 작은 순. 이 순서로 보면 "처음 찾은 최장 생존"이 곧 동률 규칙의 답이다.
const byAbs = (a: number, b: number): number => Math.abs(a) - Math.abs(b) || a - b

function decide(s: SimState, prev: number, course: Course): number {
  const set = new Set<number>([s.x])
  for (let col = COL_MIN; col <= COL_MAX; col++) set.add(col * 1000)
  const cands = [...set].sort(byAbs)

  let best = prev
  let bestAlive = -1
  // 현재 목표를 끝까지 유지하는 계획.
  const keep = hold(s, prev, HORIZON, course).alive
  const consider = (target: number, alive: number): void => {
    if (alive > bestAlive || (alive === bestAlive && byAbs(target, best) < 0)) {
      best = target
      bestAlive = alive
    }
  }
  consider(prev, keep)
  for (const a of cands) {
    if (bestAlive === HORIZON && byAbs(a, best) >= 0) break
    const first = hold(s, a, STAGE_A, course)
    if (first.alive < STAGE_A) {
      consider(a, first.alive)
      continue
    }
    for (const b of cands) {
      consider(a, STAGE_A + hold(first.end, b, STAGE_B, course).alive)
      if (bestAlive === HORIZON && best === a) break
    }
  }
  return best
}

// 죽거나, maxTicks가 지나거나, z >= untilZ가 되면 끝 상태를 돌려준다.
export function runBot(course: Course, opts: { maxTicks: number; speedLevel?: number; untilZ?: number }): SimState {
  let s = initSim({ speedLevel: opts.speedLevel ?? 0 })
  let target = s.x
  const untilZ = opts.untilZ ?? Infinity
  while (s.dead === null && s.tick < opts.maxTicks && s.z < untilZ) {
    if (s.tick % DECIDE_EVERY === 0) target = decide(s, target, course)
    s = step(s, target, course)
  }
  return s
}

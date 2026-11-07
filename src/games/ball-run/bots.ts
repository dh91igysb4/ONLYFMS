// 밸런스 테스트용 앞을 내다보는 봇(설계 §7). step만 써서 후보 입력을 복제 상태로 미리 돌려 본다.
// 시뮬 내부 상태를 직접 바꾸지 않는다. 외부 의존 없음.
import { COL_MAX, COL_MIN } from './constants.ts'
import type { Course } from './course.ts'
import { initSim, step } from './sim.ts'
import type { SimState } from './sim.ts'

const DECIDE_EVERY = 6
const HORIZON = 90
// 계획 = 첫 목표를 A틱 유지한 뒤 둘째 목표를 HORIZON - A틱 유지. 긴 A(30)로 먼저 찾고, 끝까지 사는 계획이 없을 때만
// 짧은 A(12)로 다시 찾는다. 관성 때문에 촘촘한 1칸 틈(12행 간격)을 연달아 지날 때는 30틱(속도 13에서 약 13행)
// 동안 첫 목표를 붙들면 다음 틈에 늦는다(v2 o4-dense).
const STAGE_AS = [30, 12]

// target을 n틱 유지했을 때 끝 상태와 살아남은 틱 수. step은 새 객체를 돌려주므로 s는 그대로다.
// 떨어져 죽으면 마지막으로 바닥을 딛은 틱까지만 산 것으로 센다. 낙하 도중(최대 약 30틱)을 생존으로 치면 바깥 구멍으로
// 굴러 떨어지는 계획이 블록에 조금 늦게 부딪히는 계획보다 좋아 보인다.
function hold(s: SimState, target: number, n: number, course: Course): { end: SimState; alive: number } {
  let cur = s
  let lastGround = s.grounded ? 0 : -1
  for (let i = 0; i < n; i++) {
    const next = step(cur, target, course)
    if (next.dead !== null) return { end: next, alive: next.dead === 'fall' ? Math.max(0, lastGround) : i }
    if (next.grounded) lastGround = i + 1
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
  const consider = (target: number, alive: number): void => {
    if (alive > bestAlive || (alive === bestAlive && byAbs(target, best) < 0)) {
      best = target
      bestAlive = alive
    }
  }
  // 현재 목표를 끝까지 유지하는 계획.
  consider(prev, hold(s, prev, HORIZON, course).alive)
  for (const stageA of STAGE_AS) {
    if (bestAlive === HORIZON) break
    for (const a of cands) {
      if (bestAlive === HORIZON && byAbs(a, best) >= 0) break
      const first = hold(s, a, stageA, course)
      if (first.alive < stageA) {
        consider(a, first.alive)
        continue
      }
      for (const b of cands) {
        consider(a, stageA + hold(first.end, b, HORIZON - stageA, course).alive)
        if (bestAlive === HORIZON && best === a) break
      }
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

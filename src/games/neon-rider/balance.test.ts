// 통과 게이트의 빠른 부분 (설계 §2 "통과할 수 없는 구간이 나오면 실패", §8). 기본 `npm test`에서 돈다.
// 진입 속도 28가지 전부(gate/sweep.gate.test.ts)와 이어 붙인 두 구간 169쌍(gate/pairs.gate.test.ts)은 `npm run test:gate`.
import { describe, expect, it } from 'vitest'
import { BOOST_V, MM, V_MAX, WHEEL_R } from './constants.ts'
import { findPassFrom, runPolicy, type PassResult } from './bots.ts'
import { courseOf } from './course.ts'
import { TEMPLATES, buildTemplate } from './pieces.ts'
import { initSimAt, step } from './sim.ts'

const SMOKE: readonly number[] = [0, V_MAX, BOOST_V]
const SLOW = 60000 // 탐색이 드는 테스트의 시간 상한(ms)
const cache = new Map<string, PassResult>()
function found(id: string, vx: number): PassResult {
  const k = `${id}@${vx}`
  let r = cache.get(k)
  if (!r) {
    r = findPassFrom(id, vx)
    cache.set(k, r)
  }
  return r
}

describe('통과 게이트(빠른 부분)', () => {
  it.each(TEMPLATES.map((t) => t.id))('%s: 진입 속도 0·V_MAX·BOOST_V 통과, 넘겨주는 속력 ≤ BOOST_V', (id) => {
    for (const vx of SMOKE) {
      const r = found(id, vx)
      expect(r.ok, r.ok ? '' : `${id} vx=${vx}: 못 넘음, 가장 멀리 ${r.bestX} mm`).toBe(true)
      if (!r.ok) continue
      const run = runPolicy(id, vx, r.holds)
      expect(run.passed, `${id} vx=${vx} 재생`).toBe(true)
      expect(run.exitV, `${id} vx=${vx} 넘겨주는 속력`).toBeLessThanOrEqual(BOOST_V)
    }
  }, SLOW)

  it('결정적: 같은 질문에 같은 답', () => {
    expect(findPassFrom('quarter', V_MAX)).toEqual(findPassFrom('quarter', V_MAX))
  })

  it('아무것도 안 누르면(V_MAX 진입) 못 넘는 템플릿이 절반 이상', () => {
    const failed = TEMPLATES.filter((t) => !runPolicy(t.id, V_MAX, () => false).passed)
    expect(failed.length * 2).toBeGreaterThanOrEqual(TEMPLATES.length)
  })

  it('계속 누르기만 해서 넘는 tier 3·4 템플릿은 없다(정지·V_MAX 진입. BOOST_V 진입은 재지 않는다: steps는 계단을 다 날아 넘어 한 바퀴 돌고 내리고, spikes2도 계속 눌러 넘는다)', () => {
    for (const t of TEMPLATES.filter((x) => x.tier >= 3))
      for (const vx of [0, V_MAX]) expect(runPolicy(t.id, vx, () => true).passed, `${t.id} vx=${vx}`).toBe(false)
  })

  it('tier 1은 계속 누르거나 한 번 떼기만 하면 넘는다(정지 진입)', () => {
    // 누름 → (k틱에) 뗌 → (m틱에) 다시 누름, 6틱 간격 중 하나라도 통과하면 된다.
    for (const t of TEMPLATES.filter((x) => x.tier === 1)) {
      let ok = runPolicy(t.id, 0, () => true).passed
      for (let k = 0; !ok && k < 600; k += 6)
        for (let m = k + 6; !ok && m <= k + 120; m += 6) ok = runPolicy(t.id, 0, (i) => i < k || i >= m).passed
      expect(ok, t.id).toBe(true)
    }
  }, SLOW)

  it('계속 누름·안 누름으로 넘는 경우도 넘겨주는 속력 ≤ BOOST_V', () => {
    for (const t of TEMPLATES)
      for (const vx of SMOKE)
        for (const run of [runPolicy(t.id, vx, () => true), runPolicy(t.id, vx, () => false)])
          if (run.passed) expect(run.exitV, `${t.id} vx=${vx}`).toBeLessThanOrEqual(BOOST_V)
  }, SLOW)

  it('보석: 그릇 4개(정지·V_MAX 진입), 부스터 점프 궤적 4개(V_MAX 진입)를 찾은 통과 경로에서 줍는다', () => {
    for (const [id, vx, n] of [['bowl', 0, 4], ['bowl', V_MAX, 4], ['boostjump', V_MAX, 4]] as const) {
      const r = found(id, vx)
      expect(r.ok).toBe(true)
      if (r.ok) expect(runPolicy(id, vx, r.holds).gems, `${id} vx=${vx}`).toBe(n)
    }
  })
})

// 점프대가 있는 tier 1·2 템플릿에서 한 바퀴를 돌고 살아 내릴 수 있어야 한다(설계 §6). 누르고 있으면 한 바퀴에 약 66틱이 든다.
// 정책: 땅에서는 누르고, 차 중심이 점프대 턱을 지나 두 바퀴가 다 뜬 틱부터 N틱 누른 뒤 뗀다. 그 전의 작은 뜀(삼각 꼭대기 등)에서는 누르지 않는다.
const MIN_AIR = 70
const N_MAX = 100
const JUMPS = ['ramp', 'boostjump', 'spikes']
describe('한 바퀴 착지가 가능한 점프', () => {
  // longestAir: 턱 근처에서 뜬 뒤의 가장 긴 체공.
  function attempt(id: string, vx: number, n: number): { dead: boolean; flips: number; longestAir: number } {
    const b = buildTemplate(TEMPLATES.find((t) => t.id === id)!)
    const k = b.segs.findIndex((s, i) => i > 0 && s.x0 !== b.segs[i - 1].x1) // 첫 틈 뒤의 선분
    const course = courseOf([id])
    const sec = course.section(0)
    const lipX = course.seg(sec.firstSeg + k).x1 // 틈 앞 선분(템플릿 선분 k - 1)의 끝 = 턱. 구간의 첫 선분은 REST 평지라 하나 밀린다
    let s = initSimAt(course, sec.startX + WHEEL_R, vx)
    let airAt = -1
    let air = 0
    let longestAir = 0
    for (let t = 0; t < 1500 && !s.dead; t++) {
      const inAir = !s.rear.ground && !s.front.ground
      const cx = Math.floor((s.rear.x + s.front.x) / 2)
      if (airAt < 0 && inAir && cx > lipX) airAt = t
      s = step(s, !inAir || (airAt >= 0 && t - airAt < n), course)
      if (airAt >= 0 && !s.rear.ground && !s.front.ground) longestAir = Math.max(longestAir, ++air)
      else air = 0
      if (Math.floor((s.rear.x + s.front.x) / 2) > sec.endX + 3000 * MM) break
    }
    return { dead: s.dead !== null, flips: s.flipScore, longestAir }
  }

  it.each(JUMPS)('%s: 정지·V_MAX 진입 모두 뗀 채 날면 체공 ≥ 70틱이고 살며, 어떤 N에서는 한 바퀴 이상 돌고 살아 내린다', (id) => {
    for (const vx of [0, V_MAX]) {
      const still = attempt(id, vx, 0)
      expect(still.dead, `${id} vx=${vx} 회전 없이`).toBe(false)
      expect(still.longestAir, `${id} vx=${vx} 체공`).toBeGreaterThanOrEqual(MIN_AIR)
      let flipped = false
      for (let n = 2; n <= N_MAX && !flipped; n += 2) {
        const r = attempt(id, vx, n)
        flipped = !r.dead && r.flips >= 1
      }
      expect(flipped, `${id} vx=${vx} 한 바퀴 착지`).toBe(true)
    }
  })
})

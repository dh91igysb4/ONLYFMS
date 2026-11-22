// 통과 게이트 (설계 §2 "통과할 수 없는 구간이 나오면 실패", §8).
// 앞 구간이 넘겨줄 수 있는 진입 속도는 0 ~ BOOST_V 어디든이고 속도에 따라 통과 여부가 단조롭지 않으므로, 촘촘히 훑는다.
import { describe, expect, it } from 'vitest'
import { BOOST_V, V_MAX } from './constants.ts'
import { findPass, findPassFrom, runPolicy, type PassResult } from './bots.ts'
import { TEMPLATES } from './pieces.ts'

const SWEEP_STEP = 200
const SWEEP: readonly number[] = [...new Set([...Array.from({ length: Math.floor(BOOST_V / SWEEP_STEP) + 1 }, (_, i) => i * SWEEP_STEP), V_MAX, BOOST_V])].sort((a, b) => a - b)
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

describe('통과 게이트', () => {
  it.each(TEMPLATES.map((t) => t.id))('%s: 진입 속도 0 ~ BOOST_V 전부 통과, 넘겨주는 속력 ≤ BOOST_V', (id) => {
    for (const vx of SWEEP) {
      const r = found(id, vx)
      expect(r.ok, r.ok ? '' : `${id} vx=${vx}: 못 넘음, 가장 멀리 ${r.bestX} mm`).toBe(true)
      if (!r.ok) continue
      // 찾은 누름 열을 다시 굴려도 통과하고, 다음 구간 시작에서의 속력이 게이트가 재는 최고 진입 속도를 넘지 않는다
      const run = runPolicy(id, vx, r.holds)
      expect(run.passed, `${id} vx=${vx} 재생`).toBe(true)
      expect(run.exitV, `${id} vx=${vx} 넘겨주는 속력`).toBeLessThanOrEqual(BOOST_V)
    }
  }, SLOW)

  it('findPass는 rest = 정지, fast = V_MAX와 BOOST_V 둘 다', () => {
    const id = TEMPLATES[0].id
    expect(findPass(id, 'rest')).toEqual(found(id, 0))
    expect(findPass(id, 'fast')).toEqual(found(id, V_MAX))
  })

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
      for (const vx of [0, V_MAX, BOOST_V])
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

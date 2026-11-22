// 통과 게이트 (설계 §2 "통과할 수 없는 구간이 나오면 실패", §8).
import { describe, expect, it } from 'vitest'
import { BOOST_V, V_MAX } from './constants.ts'
import { findPass, findPassFrom, runPolicy, type PassResult } from './bots.ts'
import { TEMPLATES } from './pieces.ts'

const SPEEDS = [0, V_MAX, BOOST_V] as const
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
const fail = (id: string, label: string, r: PassResult): string => (r.ok ? '' : `${id} ${label}: 못 넘음, 가장 멀리 ${r.diedAt} mm`)

describe('통과 게이트', () => {
  it.each(TEMPLATES.map((t) => t.id))('%s: 정지 진입(rest)과 빠른 진입(fast = V_MAX·BOOST_V) 모두 통과', (id) => {
    for (const vx of SPEEDS) {
      const r = found(id, vx)
      expect(r.ok, fail(id, `vx=${vx}`, r)).toBe(true)
      // 찾은 누름 열을 그대로 다시 굴려도 통과한다
      if (r.ok) expect(runPolicy(id, vx, r.holds).passed, `${id} vx=${vx} 재생`).toBe(true)
    }
  })

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

  it('계속 누르기만 해서 넘는 tier 3·4 템플릿은 없다(정지·V_MAX 진입)', () => {
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
  })

  it('빠른 진입의 상한: 통과한 경로(찾은 열·계속 누름·안 누름)가 구간 끝을 넘는 속력은 BOOST_V 이하', () => {
    // 게이트가 재는 가장 빠른 진입 속도가 BOOST_V이므로, 어떤 템플릿도 그보다 빠르게 다음 구간에 넘겨주면 안 된다.
    for (const t of TEMPLATES)
      for (const vx of SPEEDS) {
        const r = found(t.id, vx)
        const runs = [runPolicy(t.id, vx, () => true), runPolicy(t.id, vx, () => false)]
        if (r.ok) runs.push(runPolicy(t.id, vx, r.holds))
        for (const run of runs) if (run.passed) expect(run.exitV, `${t.id} vx=${vx}`).toBeLessThanOrEqual(BOOST_V)
      }
  })

  it('보석: 그릇 4개, 부스터 점프 궤적 4개를 찾은 통과 경로에서 줍는다(V_MAX 진입)', () => {
    for (const [id, n] of [['bowl', 4], ['boostjump', 4]] as const) {
      const r = found(id, V_MAX)
      expect(r.ok).toBe(true)
      if (r.ok) expect(runPolicy(id, V_MAX, r.holds).gems, id).toBe(n)
    }
  })
})

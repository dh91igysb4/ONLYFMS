// 통과 게이트 전체 ①: 진입 속도 훑기 (설계 §2, §8). `npm run test:gate`로 돈다(기본 `npm test`에서는 빠진다).
// 앞 구간이 넘겨줄 수 있는 진입 속도는 0 ~ BOOST_V 어디든이고 속도에 따라 통과 여부가 단조롭지 않으므로, 촘촘히 훑는다.
import { describe, expect, it } from 'vitest'
import { BOOST_V, V_MAX } from '../constants.ts'
import { findPassFrom, runPolicy } from '../bots.ts'
import { TEMPLATES } from '../pieces.ts'

const SWEEP_STEP = 200
const SWEEP: readonly number[] = [...new Set([...Array.from({ length: Math.floor(BOOST_V / SWEEP_STEP) + 1 }, (_, i) => i * SWEEP_STEP), V_MAX, BOOST_V])].sort((a, b) => a - b)
const SLOW = 120000 // ms

describe('통과 게이트: 진입 속도 훑기', () => {
  it('진입 속도는 0 ~ BOOST_V의 28가지', () => {
    expect(SWEEP).toHaveLength(28)
    expect([SWEEP[0], SWEEP.at(-1)]).toEqual([0, BOOST_V])
    expect(SWEEP).toContain(V_MAX)
  })

  it.each(TEMPLATES.map((t) => t.id))('%s: 진입 속도 0 ~ BOOST_V 전부 통과, 넘겨주는 속력 ≤ BOOST_V', (id) => {
    for (const vx of SWEEP) {
      const r = findPassFrom(id, vx)
      expect(r.ok, r.ok ? '' : `${id} vx=${vx}: 못 넘음, 가장 멀리 ${r.bestX} mm`).toBe(true)
      if (!r.ok) continue
      // 찾은 누름 열을 다시 굴려도 통과하고, 다음 구간 시작에서의 속력이 게이트가 재는 최고 진입 속도를 넘지 않는다
      const run = runPolicy(id, vx, r.holds)
      expect(run.passed, `${id} vx=${vx} 재생`).toBe(true)
      expect(run.exitV, `${id} vx=${vx} 넘겨주는 속력`).toBeLessThanOrEqual(BOOST_V)
    }
  }, SLOW)
})

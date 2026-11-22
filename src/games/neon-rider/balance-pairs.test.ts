// 통과 게이트, 이어 붙인 두 구간 (설계 §2). 앞 템플릿이 차를 공중에 띄운 채나 빠른 속도로 넘겨줘도
// 다음 템플릿을 넘을 수 있는지, 순서쌍 A→B 169개 전부를 정지 진입에서 두 구간 모두 넘는지로 확인한다.
// balance.test.ts와 다른 파일이라 vitest가 병렬로 돌린다.
import { describe, expect, it } from 'vitest'
import { findPassCourse } from './bots.ts'
import { TEMPLATES } from './pieces.ts'

const SLOW = 90000 // ms

describe('통과 게이트: 두 구간 이어 넘기', () => {
  it.each(TEMPLATES.map((t) => t.id))('* → %s: 모든 앞 템플릿 뒤에서 넘는다(정지 진입)', (b) => {
    for (const a of TEMPLATES) {
      const r = findPassCourse([a.id, b], 0)
      expect(r.ok, r.ok ? '' : `${a.id} → ${b}: 못 넘음, 가장 멀리 ${r.bestX} mm`).toBe(true)
    }
  }, SLOW)
})

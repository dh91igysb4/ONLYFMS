// 통과 게이트 전체 ②: 이어 붙인 두 구간 (설계 §2, §8). `npm run test:gate`로 돈다(기본 `npm test`에서는 빠진다).
// 앞 템플릿이 차를 공중에 띄운 채나 빠른 속도로 넘겨줘도 다음 템플릿을 넘을 수 있는지,
// 순서쌍 A→B 169개 전부를 정지 진입에서 두 구간 모두 넘는지로 확인한다.
import { describe, expect, it } from 'vitest'
import { findPassCourse } from '../bots.ts'
import { TEMPLATES } from '../pieces.ts'

const SLOW = 120000 // ms

describe.skip('통과 게이트: 두 구간 이어 넘기', () => {
  // 사용자 결정(2026-11-23): 봇 통과 검증을 잠시 끈다. 영상과 같은 장애물을 먼저 넣고, 사용자가 플레이하며 불가능한 곳을 고친다. 다시 켜려면 skip을 지운다.
  it.each(TEMPLATES.map((t) => t.id))('* → %s: 모든 앞 템플릿 뒤에서 넘는다(정지 진입)', (b) => {
    for (const a of TEMPLATES) {
      const r = findPassCourse([a.id, b], 0)
      expect(r.ok, r.ok ? '' : `${a.id} → ${b}: 못 넘음, 가장 멀리 ${r.bestX} mm`).toBe(true)
    }
  }, SLOW)
})

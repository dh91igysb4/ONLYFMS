import { describe, expect, it } from 'vitest'
import * as C from './constants.ts'

describe('neon-rider 상수', () => {
  it('export한 숫자는 모두 정수다', () => {
    const numbers = Object.entries(C).filter(([, v]) => typeof v === 'number')
    expect(numbers.length).toBeGreaterThan(30)
    for (const [name, v] of numbers) expect(Number.isInteger(v), name).toBe(true)
    for (const tier of C.TIER_WEIGHTS) {
      expect(Number.isInteger(tier.from)).toBe(true)
      for (const w of tier.w) expect(Number.isInteger(w)).toBe(true)
    }
  })

  it('한 적분 단계의 최대 이동이 바퀴 반지름보다 작다(선분 관통 방지, 설계 §5.5)', () => {
    expect(Math.floor(C.V_TERMINAL / C.SUBSTEPS)).toBeLessThan(C.WHEEL_R)
    expect(C.V_TERMINAL).toBeGreaterThanOrEqual(C.BOOST_V)
    expect(C.V_TERMINAL).toBeGreaterThanOrEqual(C.V_MAX)
  })

  it('움직이는 길·블록 상수가 정수이고 양수다', () => {
    for (const v of [C.BODY_R, C.MOVER_MEMORY, C.BLOCK_MASS, C.BLOCK_CORNER_R, C.BLOCK_WAKE, C.BLOCK_MEMORY, C.CRUSH_DEPTH]) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThan(0)
    }
    expect(C.CRUSH_DEPTH).toBe(Math.floor(C.WHEEL_R / 2))
  })

  it('부스터 속도가 최고 속도보다 빠르다', () => {
    expect(C.BOOST_V).toBeGreaterThan(C.V_MAX)
  })

  it('차체 판정원이 바퀴 축선 위에 있다', () => {
    expect(C.HEAD_OFFSET - C.HEAD_R).toBeGreaterThan(0)
  })

  it('TIER_WEIGHTS의 from은 0에서 시작해 오름차순이다', () => {
    expect(C.TIER_WEIGHTS[0].from).toBe(0)
    for (let i = 1; i < C.TIER_WEIGHTS.length; i++) {
      expect(C.TIER_WEIGHTS[i].from).toBeGreaterThan(C.TIER_WEIGHTS[i - 1].from)
    }
  })
})

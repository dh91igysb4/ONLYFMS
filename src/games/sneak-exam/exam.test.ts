import { describe, expect, it } from 'vitest'
import { getExam } from './exam.ts'
import { QUESTIONS } from './questions.ts'
import { N_CHOICE, N_Q } from './constants.ts'

function seedOf(i: number): string {
  let s = ''
  for (let k = 0; k < 4; k++) s += (Math.imul(i + 1, 2654435761 + k * 97) >>> 0).toString(16).padStart(8, '0')
  return s
}

describe('getExam', () => {
  it('문제는 8개이고 중복 없이 은행 범위 안이다', () => {
    for (let i = 0; i < 50; i++) {
      const ids = getExam(seedOf(i)).questionIds
      expect(ids.length).toBe(N_Q)
      expect(new Set(ids).size).toBe(N_Q)
      for (const id of ids) {
        expect(Number.isInteger(id)).toBe(true)
        expect(id).toBeGreaterThanOrEqual(0)
        expect(id).toBeLessThan(QUESTIONS.length)
      }
    }
  })

  it('정답은 8개이고 각 0..4다', () => {
    const a = getExam(seedOf(3)).answers
    expect(a.length).toBe(N_Q)
    for (const v of a) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(N_CHOICE)
    }
  })

  it('같은 시드는 같은 시험이다', () => {
    const s = seedOf(9)
    expect(getExam(s)).toEqual(getExam(s))
  })

  it('시드 100개에서 감독관 성향 세 가지가 모두 나온다', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 100; i++) seen.add(getExam(seedOf(i)).proctorType)
    expect(seen).toEqual(new Set([0, 1, 2]))
  })

  it('rng0는 0..2^32-1 정수다', () => {
    const r = getExam(seedOf(5)).rng0
    expect(Number.isInteger(r)).toBe(true)
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThan(2 ** 32)
  })

  it('캐시가 넘쳐도 결과가 같다', () => {
    const first = getExam(seedOf(0))
    const copy = structuredClone(first)
    for (let i = 1; i < 20; i++) getExam(seedOf(i))
    expect(getExam(seedOf(0))).toEqual(copy)
  })
})

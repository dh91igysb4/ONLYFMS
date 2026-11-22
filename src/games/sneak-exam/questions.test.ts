import { describe, expect, it } from 'vitest'
import { QUESTIONS } from './questions.ts'

describe('문제 은행', () => {
  it('30개 이상이다', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(30)
  })

  it('id는 0부터 연속이다', () => {
    QUESTIONS.forEach((q, i) => expect(q.id).toBe(i))
  })

  it('선택지 5개가 서로 다르고 비어 있지 않다', () => {
    for (const q of QUESTIONS) {
      expect(q.choices.length).toBe(5)
      expect(new Set(q.choices).size).toBe(5)
      for (const c of q.choices) expect(c.trim()).not.toBe('')
    }
  })

  it('문구가 중복되지 않고 비어 있지 않다', () => {
    const texts = QUESTIONS.map((q) => q.text)
    for (const t of texts) expect(t.trim()).not.toBe('')
    expect(new Set(texts).size).toBe(texts.length)
  })
})

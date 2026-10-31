import { describe, expect, test } from 'vitest'
import { validateContest, type ContestInput } from './validate.ts'

const NOW = Date.UTC(2026, 9, 31, 0, 0, 0)
const MIN = 60_000
const DAY = 24 * 60 * MIN

function input(over: Partial<ContestInput> = {}): ContestInput {
  return {
    title: '금요 대회',
    startsAt: new Date(NOW + 60 * MIN),
    durationMin: 30,
    visibility: 'public',
    items: [{ game_id: 'test-guess', options: { range: '100' }, count: 3 }],
    official: false,
    ...over,
  }
}
const errs = (over: Partial<ContestInput> = {}) => validateContest(input(over), NOW)

describe('validateContest', () => {
  test('valid input has no errors', () => {
    expect(errs()).toEqual({})
  })

  test('title 1~40 chars (trimmed)', () => {
    expect(errs({ title: '' }).title).toBeTruthy()
    expect(errs({ title: '   ' }).title).toBeTruthy()
    expect(errs({ title: '가' }).title).toBeUndefined()
    expect(errs({ title: ' 가 ' }).title).toBeUndefined()
    expect(errs({ title: '가'.repeat(40) }).title).toBeUndefined()
    expect(errs({ title: '가'.repeat(41) }).title).toBeTruthy()
  })

  test('start must be now+5min .. now+30d', () => {
    expect(errs({ startsAt: new Date(NOW + 5 * MIN - 1) }).startsAt).toBeTruthy()
    expect(errs({ startsAt: new Date(NOW + 5 * MIN) }).startsAt).toBeUndefined()
    expect(errs({ startsAt: new Date(NOW + 30 * DAY) }).startsAt).toBeUndefined()
    expect(errs({ startsAt: new Date(NOW + 30 * DAY + 1) }).startsAt).toBeTruthy()
    expect(errs({ startsAt: new Date(NOW - MIN) }).startsAt).toBeTruthy()
    expect(errs({ startsAt: new Date('nope') }).startsAt).toBeTruthy()
  })

  test('duration 5~180 minutes, integer', () => {
    expect(errs({ durationMin: 4 }).durationMin).toBeTruthy()
    expect(errs({ durationMin: 5 }).durationMin).toBeUndefined()
    expect(errs({ durationMin: 180 }).durationMin).toBeUndefined()
    expect(errs({ durationMin: 181 }).durationMin).toBeTruthy()
    expect(errs({ durationMin: 30.5 }).durationMin).toBeTruthy()
    expect(errs({ durationMin: NaN }).durationMin).toBeTruthy()
  })

  test('items: total 1~10 questions, each count 1~10 integer', () => {
    const g = (count: number) => ({ game_id: 'test-guess', options: {}, count })
    expect(errs({ items: [] }).items).toBeTruthy()
    expect(errs({ items: [g(0)] }).items).toBeTruthy()
    expect(errs({ items: [g(1)] }).items).toBeUndefined()
    expect(errs({ items: [g(10)] }).items).toBeUndefined()
    expect(errs({ items: [g(11)] }).items).toBeTruthy()
    expect(errs({ items: [g(1.5)] }).items).toBeTruthy()
    expect(errs({ items: [g(5), g(5)] }).items).toBeUndefined()
    expect(errs({ items: [g(5), g(6)] }).items).toBeTruthy()
    expect(errs({ items: [{ game_id: '', options: {}, count: 1 }] }).items).toBeTruthy()
  })

  test('reports several fields at once, in Korean', () => {
    const e = errs({ title: '', durationMin: 1, items: [] })
    expect(Object.keys(e).sort()).toEqual(['durationMin', 'items', 'title'])
    expect(e.title).toMatch(/[가-힣]/)
  })
})

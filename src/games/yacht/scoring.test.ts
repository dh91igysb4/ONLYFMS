import { describe, expect, test } from 'vitest'
import { allowed, CATEGORIES, rawScore, scoreFor, total, yachtBonus } from './scoring.ts'
import type { Category, Sheet } from './scoring.ts'

describe('rawScore', () => {
  test('upper section', () => {
    expect(rawScore([1, 1, 1, 2, 3], 'aces')).toBe(3)
  })
  test('kinds and full house', () => {
    expect(rawScore([2, 2, 2, 5, 5], 'threeKind')).toBe(16)
    expect(rawScore([2, 2, 2, 5, 5], 'fourKind')).toBe(0)
    expect(rawScore([2, 2, 2, 5, 5], 'fullHouse')).toBe(25)
    expect(rawScore([4, 4, 4, 4, 1], 'fourKind')).toBe(17)
    expect(rawScore([4, 4, 4, 4, 1], 'threeKind')).toBe(17)
  })
  test('straights', () => {
    expect(rawScore([1, 2, 3, 4, 6], 'smallStraight')).toBe(30)
    expect(rawScore([1, 2, 3, 4, 6], 'largeStraight')).toBe(0)
    expect(rawScore([2, 3, 4, 5, 6], 'largeStraight')).toBe(40)
    expect(rawScore([2, 3, 4, 5, 6], 'smallStraight')).toBe(30)
  })
  test('yacht', () => {
    expect(rawScore([6, 6, 6, 6, 6], 'yacht')).toBe(50)
    expect(rawScore([6, 6, 6, 6, 6], 'fullHouse')).toBe(0)
    expect(rawScore([6, 6, 6, 6, 6], 'choice')).toBe(30)
    expect(rawScore([3, 3, 3, 3, 3], 'fullHouse')).toBe(0)
  })
})

describe('total', () => {
  test('upper bonus threshold 63', () => {
    expect(total({ aces: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 17 }, 0)).toBe(62)
    expect(total({ aces: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 }, 0)).toBe(63 + 35)
  })
  test('lower sum and yacht bonus', () => {
    expect(total({ choice: 20, yacht: 50 }, 200)).toBe(270)
  })
})

describe('joker', () => {
  const lower: Category[] = ['choice', 'threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yacht']
  const five = [5, 5, 5, 5, 5]
  test('matching upper box open is forced', () => {
    const sheet: Sheet = { yacht: 50 }
    expect(allowed(five, sheet)).toEqual(['fives'])
    expect(yachtBonus(five, sheet)).toBe(100)
  })
  test('upper filled -> any open lower box with joker values', () => {
    const sheet: Sheet = { yacht: 50, fives: 20 }
    expect(allowed(five, sheet)).toEqual(lower.filter((c) => c !== 'yacht'))
    expect(scoreFor(five, 'largeStraight', sheet)).toBe(40)
    expect(scoreFor(five, 'fullHouse', sheet)).toBe(25)
    expect(scoreFor(five, 'smallStraight', sheet)).toBe(30)
    expect(scoreFor(five, 'choice', sheet)).toBe(25)
  })
  test('upper and lower filled -> open upper boxes score 0', () => {
    const sheet: Sheet = { fives: 20 }
    for (const c of lower) sheet[c] = 1
    sheet.yacht = 50
    const a = allowed(five, sheet)
    expect(a).toEqual(['aces', 'twos', 'threes', 'fours', 'sixes'])
    expect(scoreFor(five, 'aces', sheet)).toBe(0)
  })
  test('yacht scratched (0): same placement, no bonus', () => {
    const sheet: Sheet = { yacht: 0 }
    expect(allowed(five, sheet)).toEqual(['fives'])
    expect(yachtBonus(five, sheet)).toBe(0)
  })
  test('yacht box open: not a joker', () => {
    expect(allowed(five, {})).toEqual(CATEGORIES)
    expect(scoreFor(five, 'yacht', {})).toBe(50)
    expect(yachtBonus(five, {})).toBe(0)
  })
  test('non-yacht dice are never joker', () => {
    expect(allowed([1, 2, 3, 4, 6], { yacht: 50 })).toEqual(CATEGORIES.filter((c) => c !== 'yacht'))
    expect(yachtBonus([1, 2, 3, 4, 6], { yacht: 50 })).toBe(0)
  })
})

import { expect, test, vi } from 'vitest'

vi.mock('../../games/index.ts', () => {
  const games = [
    { manifest: { id: 'int-game', scoreDecimals: 0 } },
    { manifest: { id: 'dec-game' } },
  ]
  return { games, getGame: (id: string) => games.find((g) => g.manifest.id === id) }
})

import { formatFreeScore } from './score.ts'

test('formats by the game scoreDecimals, defaulting to two decimals', () => {
  expect(formatFreeScore('int-game', 583)).toBe('583')
  expect(formatFreeScore('int-game', 583.4)).toBe('583')
  expect(formatFreeScore('dec-game', 7.4)).toBe('7.40')
  expect(formatFreeScore('nope', 7.4)).toBe('7.40')
  expect(formatFreeScore('dec-game', null)).toBe('0.00')
  expect(formatFreeScore('dec-game', undefined)).toBe('0.00')
})

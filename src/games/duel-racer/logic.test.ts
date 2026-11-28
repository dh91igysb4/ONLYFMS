import { expect, test } from 'vitest'
import { RACE_SECONDS } from './constants.ts'
import { logic } from './logic.ts'
import { manifest } from './manifest.ts'

test('init picks the first course', () => {
  expect(logic.init(() => 0, {})).toEqual({ course: 'neon-1' })
})

test('turn-based actions are refused', () => {
  const s = logic.init(() => 0, {})
  expect(logic.apply(s, 0, {} as never, () => 0)).toEqual({ error: 'realtime_only' })
  expect(logic.result(s)).toEqual({ over: false })
})

test('manifest marks a hidden realtime duel', () => {
  expect(manifest.category).toBe('duel')
  expect(manifest.hidden).toBe(true)
  expect(manifest.duel?.realtime).toEqual({ raceSeconds: RACE_SECONDS })
  expect(manifest.duel?.sameScreen).toBe(false)
  expect(manifest.modes).toEqual({ daily: false, contest: false, free: false })
})

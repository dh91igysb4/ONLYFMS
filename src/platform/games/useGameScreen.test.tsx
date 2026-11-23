import { renderHook } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { useGameScreen } from './useGameScreen.ts'

const marked = () => document.documentElement.classList.contains('game-screen')

afterEach(() => {
  document.documentElement.classList.remove('game-screen')
})

test('adds game-screen to <html> while mounted and removes it on unmount', () => {
  expect(marked()).toBe(false)
  const { unmount } = renderHook(() => useGameScreen())
  expect(marked()).toBe(true)
  unmount()
  expect(marked()).toBe(false)
})

test('two users at once: the class stays until the last one unmounts', () => {
  const a = renderHook(() => useGameScreen())
  const b = renderHook(() => useGameScreen())
  a.unmount()
  expect(marked()).toBe(true)
  b.unmount()
  expect(marked()).toBe(false)
})

test('inactive does nothing, and turning it on and off follows the flag', () => {
  const { rerender, unmount } = renderHook(({ on }) => useGameScreen(on), { initialProps: { on: false } })
  expect(marked()).toBe(false)
  rerender({ on: true })
  expect(marked()).toBe(true)
  rerender({ on: false })
  expect(marked()).toBe(false)
  unmount()
  expect(marked()).toBe(false)
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { CACHE_KEY, applyAppearance, resolveMode, useAppearance } from './appearance.ts'

type Listener = () => void

function stubMedia(matches: boolean) {
  const addEventListener = vi.fn()
  const removeEventListener = vi.fn()
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener, removeEventListener }))
  return { addEventListener, removeEventListener }
}

const bg = () => document.documentElement.style.getPropertyValue('--bg')

beforeEach(() => {
  document.documentElement.removeAttribute('style')
  localStorage.clear()
  document.head.innerHTML = '<meta name="theme-color" content="#000000">'
  stubMedia(true)
  applyAppearance('classic', 'dark') // 이전 테스트의 system 리스너 정리
  document.documentElement.removeAttribute('style')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('appearance', () => {
  it('applies_tokens_and_meta', () => {
    applyAppearance('navy', 'light')
    const s = document.documentElement.style
    expect(s.getPropertyValue('--bg')).toBe('#f1f4f9')
    expect(s.getPropertyValue('--accent-strong')).toBe('#1a5fb4')
    expect(s.getPropertyValue('--hit')).toBe('#2f8a3e')
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#f1f4f9')
  })

  it('writes_cache', () => {
    applyAppearance('navy', 'light')
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) as string)
    expect(cache.appearance).toBe('light')
    expect(cache.dark['--bg']).toBe('#0f1b2d')
    expect(cache.light['--bg']).toBe('#f1f4f9')
  })

  it('system_follows_media', () => {
    const m = stubMedia(true)
    applyAppearance('classic', 'system')
    expect(bg()).toBe('#1c1030')
    const listener = m.addEventListener.mock.calls[0][1] as Listener
    stubMedia(false)
    listener()
    expect(bg()).toBe('#f4f1fa')
  })

  it('leaving_system_removes_listener', () => {
    const m = stubMedia(true)
    applyAppearance('classic', 'system')
    applyAppearance('classic', 'dark')
    expect(m.removeEventListener).toHaveBeenCalled()
  })

  it('unknown_values_fall_back', () => {
    expect(() => applyAppearance('neon', 'dim')).not.toThrow()
    expect(bg()).toBe('#1c1030')
  })

  it('no_matchmedia_means_dark', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(resolveMode('system')).toBe('dark')
  })

  it('storage_throws_is_ignored', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => applyAppearance('navy', 'dark')).not.toThrow()
    expect(bg()).toBe('#0f1b2d')
  })

  it('hook_noop_without_profile', () => {
    renderHook(() => useAppearance(undefined, undefined))
    expect(bg()).toBe('')
  })

  it('legacy_media_listener_api', () => {
    const addListener = vi.fn()
    const removeListener = vi.fn()
    vi.stubGlobal('matchMedia', () => ({ matches: true, addListener, removeListener }))
    expect(() => applyAppearance('classic', 'system')).not.toThrow()
    expect(addListener).toHaveBeenCalledTimes(1)
    expect(() => applyAppearance('classic', 'dark')).not.toThrow()
    expect(removeListener).toHaveBeenCalledWith(addListener.mock.calls[0][0])
  })
})

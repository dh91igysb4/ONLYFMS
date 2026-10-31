import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import html from '../../index.html?raw'
import { CACHE_KEY } from './appearance.ts'

function extractScript(): string | null {
  const re = /<script(?![^>]*\btype="module")(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/
  const m = re.exec(html)
  return m ? m[1] : null
}

function run() {
  const code = extractScript()
  if (code === null) throw new Error('inline script not found')
  new Function(code)()
}

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => ({ matches }),
  })
}

describe('index.html 첫 렌더 전 스크립트', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('style')
    document.head.innerHTML = '<meta name="theme-color" content="#1c1030" />'
  })
  afterEach(() => {
    // @ts-expect-error 테스트에서 지정한 스텁 제거
    delete window.matchMedia
  })

  const bg = () => document.documentElement.style.getPropertyValue('--bg')
  const meta = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content')

  it('script_exists_and_uses_cache_key', () => {
    const code = extractScript()
    expect(code).not.toBeNull()
    expect(code).toContain(CACHE_KEY)
  })

  it('applies_cached_light', () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        appearance: 'light',
        dark: { '--bg': '#0f1b2d' },
        light: { '--bg': '#f1f4f9' },
      }),
    )
    run()
    expect(bg()).toBe('#f1f4f9')
    expect(meta()).toBe('#f1f4f9')
  })

  it('system_uses_media', () => {
    stubMatchMedia(true)
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        appearance: 'system',
        dark: { '--bg': '#0f1b2d' },
        light: { '--bg': '#f1f4f9' },
      }),
    )
    run()
    expect(bg()).toBe('#0f1b2d')
  })

  const systemCache = () =>
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        appearance: 'system',
        dark: { '--bg': '#0f1b2d' },
        light: { '--bg': '#f1f4f9' },
      }),
    )

  it('system_without_matchmedia_is_dark', () => {
    expect(window.matchMedia).toBeUndefined()
    systemCache()
    run()
    expect(bg()).toBe('#0f1b2d')
  })

  it('system_light_when_media_false', () => {
    stubMatchMedia(false)
    systemCache()
    run()
    expect(bg()).toBe('#f1f4f9')
  })

  it('no_cache_does_nothing', () => {
    expect(() => run()).not.toThrow()
    expect(bg()).toBe('')
  })

  it('broken_cache_does_nothing', () => {
    localStorage.setItem(CACHE_KEY, '{not json')
    expect(() => run()).not.toThrow()
    expect(bg()).toBe('')
  })

  it('rejects_non_hex_values', () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ appearance: 'light', dark: {}, light: { '--bg': 'url(x)' } }),
    )
    run()
    expect(bg()).toBe('')
    expect(meta()).toBe('#1c1030')
  })
})

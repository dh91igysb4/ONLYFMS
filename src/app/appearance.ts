import { useEffect } from 'react'
import { CSS_VAR, PALETTES, isAppearance, isPaletteId, resolveTokens } from './palettes.ts'
import type { Appearance, Mode, TokenName, Tokens } from './palettes.ts'

export const CACHE_KEY = 'onlyfms.appearance.v1'

const QUERY = '(prefers-color-scheme: dark)'

export function resolveMode(appearance: Appearance): Mode {
  if (appearance !== 'system') return appearance
  const mq = typeof window !== 'undefined' ? window.matchMedia?.(QUERY) : undefined
  if (!mq) return 'dark'
  return mq.matches ? 'dark' : 'light'
}

function toVars(tokens: Tokens): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of Object.keys(CSS_VAR) as TokenName[]) out[CSS_VAR[name]] = tokens[name]
  return out
}

// system 모드의 change 리스너는 모듈에 하나만 둔다.
let systemListener: { mq: MediaQueryList; fn: () => void } | null = null

function clearSystemListener() {
  if (systemListener) {
    systemListener.mq.removeEventListener('change', systemListener.fn)
    systemListener = null
  }
}

function paint(palette: string, mode: Mode) {
  const tokens = resolveTokens(palette, mode)
  const style = document.documentElement.style
  for (const [k, v] of Object.entries(toVars(tokens))) style.setProperty(k, v)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens.bg)
}

export function applyAppearance(palette: string, appearance: string): void {
  const pal = isPaletteId(palette) ? palette : 'classic'
  const app: Appearance = isAppearance(appearance) ? appearance : 'dark'

  paint(pal, resolveMode(app))

  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        appearance: app,
        dark: toVars(PALETTES[pal].dark),
        light: toVars(PALETTES[pal].light),
      }),
    )
  } catch {
    // 저장소를 못 써도 화면 적용은 이미 끝났다
  }

  clearSystemListener()
  if (app === 'system') {
    const mq = window.matchMedia?.(QUERY)
    if (mq) {
      const fn = () => paint(pal, resolveMode('system'))
      mq.addEventListener('change', fn)
      systemListener = { mq, fn }
    }
  }
}

export function useAppearance(palette: string | undefined, appearance: string | undefined): void {
  useEffect(() => {
    if (palette === undefined && appearance === undefined) return
    applyAppearance(palette ?? 'classic', appearance ?? 'dark')
  }, [palette, appearance])
}

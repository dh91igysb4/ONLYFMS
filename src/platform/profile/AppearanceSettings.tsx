import { useId, useState } from 'react'
import { ApiError, errorMessage, rpc } from '../../lib/api.ts'
import { PALETTES, PALETTE_IDS, isAppearance, isPaletteId } from '../../app/palettes.ts'
import type { Appearance } from '../../app/palettes.ts'
import { applyAppearance, resolveMode } from '../../app/appearance.ts'
import { useAuth } from '../auth/AuthProvider.tsx'

const APPEARANCE_LABEL: Record<Appearance, string> = {
  system: '시스템 설정 따르기',
  light: '라이트',
  dark: '다크',
}
const APPEARANCE_ORDER: Appearance[] = ['system', 'light', 'dark']

export function AppearanceSettings() {
  const { profile, refresh } = useAuth()
  const titleId = useId()
  const [palette, setPalette] = useState<string>(isPaletteId(profile?.palette) ? profile.palette : 'classic')
  const [appearance, setAppearance] = useState<string>(isAppearance(profile?.appearance) ? profile.appearance : 'dark')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mode = resolveMode(isAppearance(appearance) ? appearance : 'dark')

  async function change(nextPalette: string, nextAppearance: string) {
    const prev = { palette, appearance }
    setPalette(nextPalette)
    setAppearance(nextAppearance)
    setError(null)
    applyAppearance(nextPalette, nextAppearance)
    setSaving(true)
    try {
      await rpc('set_appearance', { p_palette: nextPalette, p_appearance: nextAppearance })
      await refresh()
    } catch (e) {
      setPalette(prev.palette)
      setAppearance(prev.appearance)
      applyAppearance(prev.palette, prev.appearance)
      setError(errorMessage(e instanceof ApiError ? e.code : 'network'))
    } finally {
      setSaving(false)
    }
  }

  const dot = (color: string) => (
    <span aria-hidden="true" style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', background: color, marginLeft: 4 }} />
  )

  return (
    <section className="stack" aria-labelledby={titleId}>
      <h3 className="section-title" id={titleId}>화면 설정</h3>

      <fieldset className="field">
        <legend>화면 모드</legend>
        {APPEARANCE_ORDER.map((a) => (
          <label key={a} className="radio">
            <input type="radio" name="appearance" value={a} checked={appearance === a} disabled={saving}
              onChange={() => change(palette, a)} /> {APPEARANCE_LABEL[a]}
          </label>
        ))}
      </fieldset>

      <fieldset className="field">
        <legend>팔레트</legend>
        {PALETTE_IDS.map((id) => {
          const t = PALETTES[id][mode]
          return (
            <label key={id} className="radio">
              <input type="radio" name="palette" value={id} checked={palette === id} disabled={saving}
                onChange={() => change(id, appearance)} /> {PALETTES[id].name}
              {dot(t.bg)}{dot(t.panel)}{dot(t.lime)}
            </label>
          )
        })}
      </fieldset>

      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  )
}

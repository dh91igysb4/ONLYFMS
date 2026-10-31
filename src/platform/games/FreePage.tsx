import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { errorMessage } from '../../lib/api.ts'
import { getGame } from '../../games/index.ts'
import { PlayRunner } from './PlayRunner.tsx'

export function FreePage() {
  const { game = '' } = useParams()
  const mod = getGame(game)
  const supported = !!mod?.manifest.modes.free
  const [options, setOptions] = useState<Record<string, string>>(() =>
    Object.fromEntries((mod?.manifest.options ?? []).map((o) => [o.key, o.default])),
  )
  const [round, setRound] = useState(0)

  if (!supported) return <p className="form-error" role="alert">{errorMessage('unknown_game')}</p>
  const next = () => setRound((n) => n + 1)

  return (
    <div className="stack">
      <h2>{mod.manifest.name} · 자유 플레이</h2>
      <div className="free-options">
        {mod.manifest.options.map((o) => (
          <label key={o.key} className="free-option">
            <span className="muted">{o.label}</span>
            <select
              className="input"
              value={options[o.key]}
              onChange={(e) => { setOptions({ ...options, [o.key]: e.target.value }); next() }}
            >
              {o.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
        ))}
        <button className="btn btn-ghost" onClick={next}>새 판</button>
      </div>
      <PlayRunner key={round} mode="local" gameId={game} options={options} onNext={next} />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ApiError, errorMessage, play } from '../../lib/api.ts'
import { getGame } from '../../games/index.ts'
import { PlayRunner } from './PlayRunner.tsx'

export function DailyPage() {
  const { game = '' } = useParams()
  const mod = getGame(game)
  const supported = !!mod?.manifest.modes.daily
  const [itemId, setItemId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!supported) return
    let alive = true
    setItemId(null)
    setError(null)
    play({ action: 'daily', game_id: game })
      .then((v) => {
        // daily 응답은 {contest_id, item_id}
        if (alive) setItemId((v as unknown as { item_id: string }).item_id)
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e instanceof ApiError ? e.code : 'unknown'))
      })
    return () => { alive = false }
  }, [game, supported, attempt])

  if (!supported) return <p className="form-error" role="alert">{errorMessage('unknown_game')}</p>
  return (
    <div className="stack">
      <h2>{mod.manifest.name} · 오늘의 데일리</h2>
      {error && (
        <>
          <p className="form-error" role="alert">{error}</p>
          <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
        </>
      )}
      {!error && !itemId && <p className="muted">불러오는 중…</p>}
      {itemId && <PlayRunner mode="server" itemId={itemId} />}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, errorMessage, rpc } from '../../lib/api.ts'
import { duels } from '../../games/index.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { duelRate } from './duelFormat.ts'
import { LbTable } from './LbTable.tsx'

type DuelRow = { handle: string; rating: number; rated_games: number; wins: number; draws: number; losses: number; placed: boolean }

export function DuelBoard() {
  const { profile } = useAuth()
  const visible = duels.filter((d) => !d.manifest.hidden || profile?.is_admin)
  const [game, setGame] = useState(visible[0]?.manifest.id ?? '')
  const [rows, setRows] = useState<{ game: string; rows: DuelRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!game) return
    let alive = true
    setError(null)
    rpc<DuelRow[]>('lb_duel', { p_game: game })
      .then((r) => { if (alive) setRows({ game, rows: r }) })
      .catch((e) => { if (alive) setError(errorMessage(e instanceof ApiError ? e.code : 'network')) })
    return () => { alive = false }
  }, [game, attempt])

  if (visible.length === 0) return <p className="muted">대전 게임이 없어요</p>

  const ready = rows && rows.game === game ? rows.rows : null
  const placed = ready?.filter((r) => r.placed) ?? []
  const pending = ready?.filter((r) => !r.placed) ?? []
  const meCls = (h: string) => (h === profile?.handle ? 'me' : undefined)

  return (
    <>
      <div className="lb-filters">
        <span className="lb-pill">
          <select aria-label="게임" value={game} onChange={(e) => { setGame(e.target.value); setRows(null) }}>
            {visible.map((d) => <option key={d.manifest.id} value={d.manifest.id}>{d.manifest.name}</option>)}
          </select>
        </span>
      </div>
      {error && (
        <div className="stack" role="alert">
          <p className="form-error">{error}</p>
          <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
        </div>
      )}
      {!error && !ready && <p className="page-note" role="status">불러오는 중…</p>}
      {!error && ready && ready.length === 0 && <p className="muted">아직 기록이 없어요</p>}
      {!error && placed.length > 0 && (
        <div className="lb-panel">
          <LbTable
            cols={[{ label: '순위', rank: true }, { label: '아이디' }, { label: '레이팅', num: true, sorted: true }, { label: '판수', num: true }, { label: '승률', num: true }]}
            rows={placed.map((r, i) => ({
              id: r.handle, top: i < 3, me: r.handle === profile?.handle,
              cells: [i + 1, <Link to={`/u/${r.handle}`}>{r.handle}</Link>, r.rating, r.rated_games, duelRate(r.wins, r.draws, r.losses)],
            }))}
          />
        </div>
      )}
      {!error && pending.length > 0 && (
        <>
          <h3 className="section-title">배치 중</h3>
          <ul className="list">
            {pending.map((r) => (
              <li key={r.handle} className={`list-row ${meCls(r.handle) ?? ''}`.trim()}>
                <Link to={`/u/${r.handle}`}>{r.handle}</Link> · {r.rated_games}판
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

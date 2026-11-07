import { Link } from 'react-router-dom'
import { games, getGame } from '../../../games/index.ts'
import { rpc } from '../../../lib/api.ts'
import { formatFreeScore } from '../../games/score.ts'
import { useAuth } from '../../auth/AuthProvider.tsx'
import { BlockFrame } from '../BlockFrame.tsx'
import { useBlockData } from '../useBlockData.ts'

type Row = {
  user_id: string; handle: string; plays: number; wins: number
  win_rate: number; current_streak: number; best_streak: number | null; avg_score: number
  best_score: number | null
}
type Item = { id: string; name: string; rows: Row[] }

export function StreakBlock({ title }: { title: string }) {
  const { profile } = useAuth()
  const { state, retry } = useBlockData<Item[]>(async () => {
    const targets = games.filter((g) => (!g.manifest.hidden || profile?.is_admin) && g.manifest.modes.free)
    return Promise.all(targets.map(async (g) => ({
      id: g.manifest.id,
      name: g.manifest.name,
      rows: (await rpc<Row[] | null>('lb_free', { p_game: g.manifest.id })) ?? [],
    })))
  }, [profile?.id, profile?.is_admin])

  return (
    <BlockFrame title={title} state={state} onRetry={retry}>
      {state.kind === 'done' && (state.data.length === 0
        ? <p className="muted">열린 자유 플레이 게임이 없어요</p>
        : state.data.map((it) => {
          const mine = it.rows.find((r) => r.user_id === profile?.id)
          return (
            <div key={it.id}>
              <h4>{it.name}</h4>
              {mine
                ? <p className="card-status">{getGame(it.id)?.manifest.freeStats === 'score'
                  ? `${mine.plays}판 · 최고 ${formatFreeScore(it.id, mine.best_score)}점`
                  : `${mine.plays}판 · 승률 ${Math.round(mine.win_rate * 100)}% · 연속 ${mine.current_streak} (최고 ${mine.best_streak ?? 0})`}</p>
                : <p className="muted">아직 기록이 없어요</p>}
              <div className="card-actions">
                <Link className="btn btn-ghost" to={`/play/${it.id}/free`}>자유 플레이</Link>
              </div>
            </div>
          )
        }))}
    </BlockFrame>
  )
}

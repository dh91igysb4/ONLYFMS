import { Link } from 'react-router-dom'
import { games } from '../../../games/index.ts'
import { rpc } from '../../../lib/api.ts'
import { now } from '../../../lib/serverTime.ts'
import { kstDate } from '../../../shared/kst.ts'
import { useAuth } from '../../auth/AuthProvider.tsx'
import { BlockFrame } from '../BlockFrame.tsx'
import { useBlockData } from '../useBlockData.ts'

type Row = { rank: number; user_id: string; score: number }
type Item = { id: string; name: string; rows: Row[] }

export function DailyBlock({ title }: { title: string }) {
  const { profile } = useAuth()
  const { state, retry } = useBlockData<Item[]>(async () => {
    const today = kstDate(now())
    const targets = games.filter((g) => (!g.manifest.hidden || profile?.is_admin) && g.manifest.modes.daily)
    return Promise.all(targets.map(async (g) => ({
      id: g.manifest.id,
      name: g.manifest.name,
      rows: (await rpc<Row[] | null>('lb_daily', { p_day: today, p_game: g.manifest.id })) ?? [],
    })))
  }, [profile?.id, profile?.is_admin])

  return (
    <BlockFrame title={title} state={state} onRetry={retry}>
      {state.kind === 'done' && (state.data.length === 0
        ? <p className="muted">열린 데일리 게임이 없어요</p>
        : state.data.map((it) => {
          const mine = it.rows.find((r) => r.user_id === profile?.id)
          return (
            <div key={it.id}>
              <h4>{it.name}</h4>
              <p className="card-status">{mine ? `${mine.score}점 · ${mine.rank}위 / ${it.rows.length}명` : '아직 끝내지 않았어요'}</p>
              <div className="card-actions">
                <Link className="btn btn-primary" to={`/play/${it.id}/daily`}>데일리</Link>
              </div>
            </div>
          )
        }))}
    </BlockFrame>
  )
}

import { games } from '../../../games/index.ts'
import { rpc } from '../../../lib/api.ts'
import { now } from '../../../lib/serverTime.ts'
import { kstDate, kstWeekStart } from '../../../shared/kst.ts'
import { useAuth } from '../../auth/AuthProvider.tsx'
import { BlockFrame } from '../BlockFrame.tsx'
import { useBlockData } from '../useBlockData.ts'

type Row = { rank: number; user_id: string; handle: string; score: number }
type Item = { id: string; name: string; rows: Row[] }

export function WeeklyBlock({ title }: { title: string }) {
  const { profile } = useAuth()
  const { state, retry } = useBlockData<Item[]>(async () => {
    const today = kstDate(now())
    const targets = games.filter((g) => (!g.manifest.hidden || profile?.is_admin) && g.manifest.modes.daily)
    return Promise.all(targets.map(async (g) => ({
      id: g.manifest.id,
      name: g.manifest.name,
      rows: (await rpc<Row[] | null>('lb_range', { p_from: kstWeekStart(today), p_to: today, p_game: g.manifest.id })) ?? [],
    })))
  }, [profile?.id, profile?.is_admin])

  const line = (r: Row) => (
    <li key={r.user_id} className={r.user_id === profile?.id ? 'me' : undefined}
      aria-current={r.user_id === profile?.id ? 'true' : undefined}>
      {`${r.rank}. ${r.handle} ${r.score}점`}
    </li>
  )

  return (
    <BlockFrame title={title} state={state} onRetry={retry}>
      {state.kind === 'done' && (state.data.length === 0
        ? <p className="muted">열린 데일리 게임이 없어요</p>
        : state.data.map((it) => {
          const top = it.rows.slice(0, 5)
          const mine = it.rows.slice(5).find((r) => r.user_id === profile?.id)
          return (
            <div key={it.id}>
              <h4>{it.name}</h4>
              {it.rows.length === 0
                ? <p className="muted">이번 주 기록이 없어요</p>
                : (
                  <ul className="home-list">
                    {top.map(line)}
                    {mine && <li aria-hidden="true">…</li>}
                    {mine && line(mine)}
                  </ul>
                )}
            </div>
          )
        }))}
    </BlockFrame>
  )
}
